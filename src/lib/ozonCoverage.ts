import { OzonSalesRow, SKUItem } from '../types';

// ===== Модуль планирования поставок Ozon =====
// Часть 1: недели по МСК, сопоставление артикулов, скорость продаж.
// Все функции чистые: без обращения к стору, без побочных эффектов.

const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Название кластера для продаж, не привязанных к кластеру (как пишет прокси). */
export const NO_CLUSTER_NAME = 'Без кластера';

/**
 * Понедельник недели по московскому времени для переданной даты.
 * Формат результата: 'yyyy-MM-dd' — совпадает с колонкой «Неделя» листа «Продажи Ozon».
 */
export function getMskWeekMonday(date: Date): string {
  const msk = new Date(date.getTime() + MSK_OFFSET_MS);
  const day = msk.getUTCDay();
  const diff = (day + 6) % 7;
  const monday = new Date(Date.UTC(msk.getUTCFullYear(), msk.getUTCMonth(), msk.getUTCDate() - diff));
  return monday.toISOString().slice(0, 10);
}

/**
 * Понедельники последних count ПОЛНЫХ недель по МСК, по возрастанию.
 * Текущая незавершённая неделя в список не входит.
 */
export function getLastFullWeeks(now: Date, count: number): string[] {
  const currentMonday = new Date(getMskWeekMonday(now) + 'T00:00:00Z');
  const weeks: string[] = [];
  for (let i = count; i >= 1; i--) {
    weeks.push(new Date(currentMonday.getTime() - i * WEEK_MS).toISOString().slice(0, 10));
  }
  return weeks;
}

/**
 * Сопоставление артикула Ozon с внутренним SKU (та же логика, что в ozonMatch):
 * 1) по «ШК Ozon» (числовой SKU Ozon), 2) по совпадению offer_id с внутренним артикулом.
 * Если не сопоставлено — возвращается offer_id как есть.
 */
export function resolveOzonArticle(skus: SKUItem[], offerId: string, ozonSku?: string): string {
  const offer = String(offerId || '').trim();
  const ozon = String(ozonSku || '').trim();
  if (ozon) {
    const byBarcode = skus.find(s => String(s.ozonBarcode || '').trim() === ozon);
    if (byBarcode) return byBarcode.sku;
  }
  if (offer) {
    const bySku = skus.find(s => s.sku.toLowerCase() === offer.toLowerCase());
    if (bySku) return bySku.sku;
  }
  return offer || ozon || 'НЕИЗВЕСТНО';
}

export interface SalesSpeedResult {
  /** Понедельники недель окна расчёта, по возрастанию. */
  weeks: string[];
  /** Длина окна в днях (= weeks.length * 7). */
  windowDays: number;
  /** Всего продано за окно, шт (все товары, все кластеры, включая «Без кластера»). */
  totalQty: number;
  /** Общая скорость продаж, шт/день. */
  totalPerDay: number;
  /** Продано за окно по внутреннему артикулу, шт. */
  qtyByArticle: Record<string, number>;
  /** Скорость по внутреннему артикулу, шт/день. */
  perDayByArticle: Record<string, number>;
  /** Продано за окно по названию кластера, шт (включая «Без кластера»). */
  qtyByCluster: Record<string, number>;
  /** Продано за окно: артикул -> название кластера -> шт. */
  qtyByArticleCluster: Record<string, Record<string, number>>;
  /** Скорость: артикул -> название кластера -> шт/день. */
  perDayByArticleCluster: Record<string, Record<string, number>>;
  /** Доли кластеров в продажах по всем товарам, % (0–100, без округления). */
  clusterSharesPct: Record<string, number>;
  /** Доли кластеров в продажах каждого товара, %: артикул -> кластер -> %. */
  clusterSharesPctByArticle: Record<string, Record<string, number>>;
}

/**
 * Скорость продаж по последним полным неделям.
 * По ТЗ v3: скорость = сумма продаж за weeks ÷ (число недель × 7 дней).
 * В расчёт берутся только строки листа «Продажи Ozon», чья «Неделя» входит в weeks
 * (28-дневные блоки в это окно попасть не могут — они старше свежей зоны).
 */
export function buildSalesSpeed(sales: OzonSalesRow[], skus: SKUItem[], weeks: string[]): SalesSpeedResult {
  const weekSet = new Set(weeks);
  const windowDays = weeks.length * 7;

  let totalQty = 0;
  const qtyByArticle: Record<string, number> = {};
  const qtyByCluster: Record<string, number> = {};
  const qtyByArticleCluster: Record<string, Record<string, number>> = {};

  for (const row of sales) {
    const week = String(row.week || '').trim();
    if (!weekSet.has(week)) continue;

    const qty = Number(row.qty) || 0;
    if (qty === 0) continue;

    const article = resolveOzonArticle(skus, row.offerId);
    const clusterName = String(row.clusterName || '').trim() || NO_CLUSTER_NAME;

    totalQty += qty;
    qtyByArticle[article] = (qtyByArticle[article] || 0) + qty;
    qtyByCluster[clusterName] = (qtyByCluster[clusterName] || 0) + qty;
    if (!qtyByArticleCluster[article]) qtyByArticleCluster[article] = {};
    qtyByArticleCluster[article][clusterName] = (qtyByArticleCluster[article][clusterName] || 0) + qty;
  }

  const perDayByArticle: Record<string, number> = {};
  for (const article of Object.keys(qtyByArticle)) {
    perDayByArticle[article] = windowDays > 0 ? qtyByArticle[article] / windowDays : 0;
  }

  const perDayByArticleCluster: Record<string, Record<string, number>> = {};
  for (const article of Object.keys(qtyByArticleCluster)) {
    perDayByArticleCluster[article] = {};
    for (const clusterName of Object.keys(qtyByArticleCluster[article])) {
      perDayByArticleCluster[article][clusterName] =
        windowDays > 0 ? qtyByArticleCluster[article][clusterName] / windowDays : 0;
    }
  }

  const clusterSharesPct: Record<string, number> = {};
  for (const clusterName of Object.keys(qtyByCluster)) {
    clusterSharesPct[clusterName] = totalQty > 0 ? (qtyByCluster[clusterName] / totalQty) * 100 : 0;
  }

  const clusterSharesPctByArticle: Record<string, Record<string, number>> = {};
  for (const article of Object.keys(qtyByArticleCluster)) {
    clusterSharesPctByArticle[article] = {};
    const articleQty = qtyByArticle[article] || 0;
    for (const clusterName of Object.keys(qtyByArticleCluster[article])) {
      clusterSharesPctByArticle[article][clusterName] =
        articleQty > 0 ? (qtyByArticleCluster[article][clusterName] / articleQty) * 100 : 0;
    }
  }

  return {
    weeks,
    windowDays,
    totalQty,
    totalPerDay: windowDays > 0 ? totalQty / windowDays : 0,
    qtyByArticle,
    perDayByArticle,
    qtyByCluster,
    qtyByArticleCluster,
    perDayByArticleCluster,
    clusterSharesPct,
    clusterSharesPctByArticle
  };
}
