import { KitItem, OzonSalesRow, OzonStockRow, SKUItem } from '../types';

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

// ===== Часть 2: остатки по кластерам, покрытие, рекомендации, заказ на фабрике =====

export interface OzonCoverageSettings {
  /** Полных недель для расчёта скорости продаж. */
  speedWeeks: number;
  /** Неснижаемый остаток, дней продаж. */
  minStockDays: number;
  /** Целевой запас на Ozon, дней. Неснижаемый остаток входит ВНУТРЬ этого срока, а не прибавляется к нему. */
  targetStockDays: number;
  /** Максимальный срок продаж кластера после поставки, дней. 0 или отсутствие значения — отсекатель выключен. */
  maxClusterDays?: number;
  /** Объём заказа на фабрике, дней. */
  factoryOrderDays: number;
  /** % возвратов, возвращающихся в продажу (0–100). */
  returnsToSalePct: number;
  /** КластерID без поставок, через запятую. */
  excludedClusters: string;
  /** Приоритетные кластеры в формате «КластерID:коэффициент», через запятую. */
  priorityClusters?: string;
  /** Пункт 42. Порог дефицита, дней. 0 или отсутствие значения — коррекция скорости выключена. */
  deficitDays?: number;
  /** Пункт 42. Окно тренда, недель. */
  trendWeeks?: number;
  /** Пункт 42. Лучших недель окна для коррекции скорости. */
  bestWeeks?: number;
  /** Пункт 42. Минимум продаж за окно тренда для коррекции, шт. */
  minSalesForCorrection?: number;
  /** Пункт 42. Максимальный рост скорости при дефиците, раз. Меньше 1 — предел не применяется. */
  maxSpeedGrowth?: number;
  /** Пункт 38. Прирост объёма продаж, %: ручная надбавка к прогнозной скорости в контуре заказа на фабрике. */
  salesGrowthPct?: number;
}

export interface OzonClusterRef {
  clusterId: string;
  clusterName: string;
}

/** Разбор настройки excludedClusters (CSV КластерID) в множество. */
export function parseExcludedClusters(csv: string): Set<string> {
  return new Set(String(csv || '').split(',').map(s => s.trim()).filter(Boolean));
}

/**
 * Разбор настройки priorityClusters («КластерID:коэффициент» через запятую) в карту коэффициентов.
 * Некорректные и меньшие единицы коэффициенты игнорируются: приоритет не может понижать запас.
 */
export function parsePriorityClusters(csv: string): Record<string, number> {
  const map: Record<string, number> = {};
  const parts = String(csv || '').split(',').map(s => s.trim()).filter(Boolean);
  for (const part of parts) {
    const [rawId, rawK] = part.split(':');
    const id = String(rawId || '').trim();
    if (!id) continue;
    const k = Number(String(rawK || '').trim().replace(',', '.'));
    map[id] = isNaN(k) || k < 1 ? 1.5 : k;
  }
  return map;
}

/** Карта «название кластера -> КластерID» по справочнику «Кластеры Ozon». */
export function buildClusterNameToId(clusters: OzonClusterRef[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const c of clusters) {
    const name = String(c.clusterName || '').trim();
    const id = String(c.clusterId || '').trim();
    if (name && id) map[name] = id;
  }
  return map;
}

export interface ClusterStockAgg {
  clusterId: string;
  clusterName: string;
  available: number;
  transit: number;
  returns: number;
  /** «В заявках» по данным Ozon, шт. В расчётный остаток estimated НЕ входит. */
  requested: number;
  /** Расчётный остаток = Доступно + В пути + Возвраты × %возвратов. */
  estimated: number;
}

export interface ArticleStockAgg {
  article: string;
  /** Расчётный остаток по ВСЕМ строкам товара, включая строки без КластерID. */
  totalEstimated: number;
  /** Расчётный остаток строк без КластерID (в общие итоги, но не в кластеры). */
  unboundEstimated: number;
  /** Кластерные агрегаты, ключ — КластерID. */
  byCluster: Record<string, ClusterStockAgg>;
}

/**
 * Агрегация остатков Ozon по товарам и кластерам.
 * По ТЗ v3: расчётный остаток = Доступно + В пути + Возвраты × %возвратов;
 * «Готовим к продаже» и «В заявках» в расчёт не входят.
 * Строки без КластерID попадают только в totalEstimated / unboundEstimated.
 */
export function buildClusterStocks(
  stocks: OzonStockRow[],
  skus: SKUItem[],
  returnsToSalePct: number
): Record<string, ArticleStockAgg> {
  const pct = (Number(returnsToSalePct) || 0) / 100;
  const result: Record<string, ArticleStockAgg> = {};

  for (const row of stocks) {
    const article = resolveOzonArticle(skus, row.offerId, row.sku);
    if (!result[article]) {
      result[article] = { article, totalEstimated: 0, unboundEstimated: 0, byCluster: {} };
    }
    const agg = result[article];

    const available = Number(row.available) || 0;
    const transit = Number(row.transit) || 0;
    const returns = Number(row.returns) || 0;
    const requested = Number(row.requested) || 0;
    const estimated = available + transit + returns * pct;

    agg.totalEstimated += estimated;

    const clusterId = String(row.clusterId || '').trim();
    if (!clusterId) {
      agg.unboundEstimated += estimated;
      continue;
    }
    if (!agg.byCluster[clusterId]) {
      agg.byCluster[clusterId] = {
        clusterId,
        clusterName: String(row.clusterName || '').trim(),
        available: 0,
        transit: 0,
        returns: 0,
        requested: 0,
        estimated: 0
      };
    }
    const c = agg.byCluster[clusterId];
    c.available += available;
    c.transit += transit;
    c.returns += returns;
    c.requested += requested;
    c.estimated += estimated;
  }

  return result;
}

/**
 * Покрытие в днях.
 * Обычный кластер: (расчётный остаток − скорость × неснижаемые дни) ÷ скорость.
 * Исключённый кластер (без поставок): неснижаемый запас не применяется — остаток ÷ скорость.
 * Скорость 0 — покрытие не определено (null, трактуется как «бесконечное»).
 */
export function calcCoverageDays(
  estimated: number,
  perDay: number,
  minStockDays: number,
  excluded: boolean
): number | null {
  if (!(perDay > 0)) return null;
  if (excluded) return estimated / perDay;
  return (estimated - perDay * minStockDays) / perDay;
}

export interface SupplyRecommendation {
  /** Расчётная потребность, шт (до ограничения Моим складом и округления). */
  neededQty: number;
  /** Рекомендовано коробок (округление вверх, с ограничением Моим складом). */
  boxes: number;
  /** Рекомендовано штук = boxes × pcsPerBox. */
  qty: number;
  /** true, если рекомендация урезана остатком Моего склада. */
  limitedByMyStock: boolean;
}

/**
 * Рекомендация поставки в кластер.
 * Пункт 34, дефект 1: неснижаемый остаток входит ВНУТРЬ целевого запаса, поэтому
 * нужно = скорость × целевой запас − расчётный остаток (без слагаемого minStockDays).
 * Порог включения рекомендации равен целевому запасу.
 * Пункт 34, дефект 2: округление ВВЕРХ до целых коробок способно завалить медленный
 * кластер запасом на годы, поэтому кластер исключается целиком, если после поставки
 * его расчётный срок продаж превысит maxClusterDays.
 * Дальше — ограничение остатком Моего склада (в целых коробках).
 */
export function calcSupplyRecommendation(
  perDay: number,
  estimated: number,
  settings: OzonCoverageSettings,
  pcsPerBox: number,
  myStockAvailable: number
): SupplyRecommendation | null {
  if (!(perDay > 0)) return null;

  const need = perDay * settings.targetStockDays - estimated;
  if (need <= 0) return null;

  const box = pcsPerBox > 0 ? pcsPerBox : 1;
  const boxesNeeded = Math.ceil(need / box);

  const maxDays = Number(settings.maxClusterDays) || 0;
  if (maxDays > 0 && (estimated + boxesNeeded * box) / perDay > maxDays) return null;

  const maxBoxes = Math.floor(Math.max(0, myStockAvailable) / box);
  const boxes = Math.min(boxesNeeded, maxBoxes);

  return {
    neededQty: need,
    boxes,
    qty: boxes * box,
    limitedByMyStock: boxes < boxesNeeded
  };
}

export interface FactorySignal {
  /** На сколько дней хватит ТРУБЫ: ТРУБА ÷ скорость. */
  daysLeft: number;
  /** ТРУБА, шт: остаток всех кластеров Ozon + Мой склад + заказанное на фабрике и ещё не полученное. */
  pipelineQty: number;
  /** Заказано на фабрике и ещё не получено, шт. Просроченные заказы сюда НЕ входят. */
  onOrderQty: number;
  /** Порог срабатывания в днях: срок поставки + неснижаемый запас. */
  thresholdDays: number;
  /** Тот же порог в штуках: скорость × thresholdDays. */
  thresholdQty: number;
  /** Сколько дозаказать, шт, кратно коробке. 0 — заказывать не нужно. */
  orderQty: number;
  /** Тот же объём в коробках. */
  orderBoxes: number;
  /** Причина сигнала: 'total' — ТРУБА ниже порога; 'clusterDeficit' — ТРУБЫ хватает, но кластерам нужна поставка, а везти нечего. */
  reason: 'total' | 'clusterDeficit';
  /** Непокрытая потребность кластеров, шт. */
  unmetDeficitQty: number;
}

/**
 * Пункт 35. Сигнал «пора заказать на фабрике» по модели ТРУБА.
 * ТРУБА = остаток всех кластеров Ozon + Мой склад + заказанное на фабрике и ещё не полученное.
 * ПОРОГ = скорость × (срок поставки + неснижаемый запас).
 * ОБЪЁМ = скорость × (срок поставки + неснижаемый запас + объём заказа в днях) − ТРУБА,
 * округление вверх до целых коробок один раз по товару.
 * Сигнал больше НЕ гасится наличием заказа: заказ входит в ТРУБУ и уменьшает объём дозаказа.
 * Просроченный заказ в ТРУБУ не входит — вызывающая сторона такие заказы сюда не передаёт.
 * Если ТРУБЫ хватает, но у кластеров есть непокрытая потребность, возвращается reason
 * 'clusterDeficit' с orderQty = 0: товар есть, он просто лежит не в том кластере, заказывать не надо.
 * Остатки исключённых кластеров и строки без КластерID входят в ТРУБУ.
 */
export function calcFactorySignal(
  totalEstimated: number,
  myStockAvailable: number,
  perDay: number,
  leadTimeDays: number,
  pcsPerBox: number,
  settings: OzonCoverageSettings,
  unmetDeficitQty: number = 0,
  onOrderQty: number = 0
): FactorySignal | null {
  if (!(perDay > 0)) return null;
  const lead = Number(leadTimeDays) || 0;
  const onOrder = Math.max(0, Number(onOrderQty) || 0);
  const pipelineQty = totalEstimated + Math.max(0, myStockAvailable) + onOrder;
  const thresholdDays = lead + settings.minStockDays;
  const thresholdQty = perDay * thresholdDays;
  const belowThreshold = pipelineQty < thresholdQty;
  const unmet = Math.max(0, Number(unmetDeficitQty) || 0);
  if (!belowThreshold && unmet <= 0) return null;
  const box = pcsPerBox > 0 ? pcsPerBox : 1;
  const targetQty = perDay * (thresholdDays + settings.factoryOrderDays);
  const rawNeed = targetQty - pipelineQty;
  const orderQty = belowThreshold && rawNeed > 0 ? Math.ceil(rawNeed / box) * box : 0;
  return {
    daysLeft: pipelineQty / perDay,
    pipelineQty,
    onOrderQty: onOrder,
    thresholdDays,
    thresholdQty,
    orderQty,
    orderBoxes: Math.ceil(orderQty / box),
    reason: belowThreshold ? 'total' : 'clusterDeficit',
    unmetDeficitQty: unmet
  };
}

export interface ClusterCoverageRow {
  clusterId: string;
  clusterName: string;
  qtySold: number;
  perDay: number;
  /** Доля кластера в продажах этого товара, % (0–100). */
  sharePct: number;
  available: number;
  transit: number;
  returns: number;
  estimated: number;
  coverageDays: number | null;
  excluded: boolean;
  /** Кластер отмечен как приоритетный. */
  priority: boolean;
  /** Коэффициент повышенного запаса приоритетного кластера (1 — обычный кластер). */
  priorityK: number;
  /** Непокрытая потребность кластера, шт: сколько не досталось из-за нехватки на Моём складе. */
  unmetQty: number;
  /** Локальный зачёт по этому кластеру, шт (из уже созданных заявок). */
  pendingQty: number;
  /** «В заявках» по данным Ozon для этого кластера, шт. */
  requestedQty: number;
  /** Применённый к потребности зачёт = наибольшее из pendingQty и requestedQty, шт. */
  pendingEffective: number;
  recommendation: SupplyRecommendation | null;
}

export interface ArticleCoverage {
  article: string;
  qtySold: number;
  /** ФАКТИЧЕСКАЯ скорость продаж, шт/день. Тренд её не трогает: по ней считаются кластеры. */
  perDay: number;
  /** Пункт 38. Прогнозная скорость = perDay × тренд × (1 + прирост, %). Только для заказа на фабрике. */
  forecastPerDay: number;
  /** Пункт 38. Разбор тренда продаж. null — тренд не считался (продаж за окно нет). */
  trend: SalesTrend | null;
  pcsPerBox: number;
  leadTimeDays: number;
  myStockAvailable: number;
  totalEstimated: number;
  unboundEstimated: number;
  /** Продажи товара, не привязанные к кластеру («Без кластера» и неизвестные названия), шт. */
  unboundQtySold: number;
  /** Суммарная непокрытая потребность кластеров товара, шт. */
  unmetDeficitQty: number;
  /** Весь локальный зачёт по товару, шт (включая позиции без кластера). */
  pendingTotal: number;
  /** Свободный остаток Моего склада после резерва под созданные заявки, шт. */
  freeMyStock: number;
  clusters: ClusterCoverageRow[];
  factory: FactorySignal | null;
  /** Пункт 42. Разбор коррекции скорости при дефиците. null — коррекция не применялась. */
  speedCorrection: SpeedCorrectionInfo | null;
}

/**
 * Готовый локальный зачёт по созданным заявкам (пункт 23).
 * Структура повторяет PendingSuppliesResult из ozonPending.ts, но объявлена здесь отдельно:
 * прямой импорт создал бы кольцевую зависимость между модулями.
 */
export interface OzonPendingLike {
  /** Зачёт по кластерам: артикул -> КластерID -> шт. */
  byArticleCluster: Record<string, Record<string, number>>;
  /** Зачёт по товару целиком, шт (включая позиции без кластера). */
  byArticle: Record<string, number>;
}

// ===== Пункт 36: компоненты виртуальных комплектов =====

/**
 * Покрытие по одному компоненту виртуальных комплектов.
 * У фабрики заказывают не комплекты, а компоненты: сроки поставки и размеры коробок у них
 * свои, а один компонент может входить сразу в несколько комплектов и расходоваться кратно
 * быстрее. Поэтому сигнал заказа на фабрике считается здесь, а не по комплекту.
 */
export interface ComponentCoverage {
  /** Артикул компонента. */
  component: string;
  /** Скорость расхода, шт/день: Σ по комплектам (скорость комплекта × норма расхода). */
  perDay: number;
  /** Пункт 38. Прогнозная скорость расхода: то же, но по ПРОГНОЗНОЙ скорости комплектов. */
  forecastPerDay: number;
  /** ТРУБА, шт: fromKitsQty + Мой склад + заказанное на фабрике по этому компоненту. */
  pipelineQty: number;
  /** Собственный остаток компонента на Моём складе, шт. */
  myStockQty: number;
  /** Заказано на фабрике по самому компоненту и ещё не получено, шт. */
  onOrderQty: number;
  /** Пришло из расчётных остатков комплектов на Ozon, шт: Σ (totalEstimated комплекта × норма). */
  fromKitsQty: number;
  /** Срок поставки из карточки КОМПОНЕНТА в SKU Базе, дней. */
  leadTimeDays: number;
  /** Размер коробки из карточки КОМПОНЕНТА в SKU Базе, шт. */
  pcsPerBox: number;
  /** Сигнал «пора заказать на фабрике» по компоненту. */
  factory: FactorySignal | null;
  /** Артикулы виртуальных комплектов, в которые входит компонент. */
  usedInKits: string[];
}

/** Узкое место виртуального комплекта — компонент с наименьшим покрытием в днях. */
export interface KitBottleneck {
  kitSku: string;
  /** Артикул компонента с наименьшим покрытием. */
  componentSku: string;
  /** Покрытие узкого места, дней. null — скорость расхода 0, покрытие «бесконечное». */
  daysLeft: number | null;
  /** Сколько комплектов можно собрать прямо сейчас: min floor(остаток компонента ÷ норма). */
  canAssembleQty: number;
}

export interface OzonCoverageInput {
  stocks: OzonStockRow[];
  sales: OzonSalesRow[];
  skus: SKUItem[];
  clusters: OzonClusterRef[];
  settings: OzonCoverageSettings;
  /** Доступность на Моём складе по артикулу (виртуальные комплекты уже учтены вызывающей стороной). */
  myStockAvailability: Record<string, number>;
  /** Локальный зачёт по созданным заявкам; не передан — расчёт идёт как раньше. */
  pending?: OzonPendingLike;
  /** Пункт 35. Заказано на фабрике и ещё не получено, шт по артикулу. Просроченные заказы сюда не попадают. */
  factoryOnOrder?: Record<string, number>;
  /** Пункт 36. Состав комплектов; не передан — расчёт по компонентам не выполняется. */
  kits?: KitItem[];
  /** Момент расчёта; по умолчанию — текущее время. */
  now?: Date;
}

export interface OzonCoverageResult {
  speed: SalesSpeedResult;
  articles: ArticleCoverage[];
  /** Пункт 36. Покрытие по компонентам виртуальных комплектов. Без input.kits — пустой массив. */
  components: ComponentCoverage[];
  /** Пункт 36. Узкие места виртуальных комплектов. Без input.kits — пустой массив. */
  bottlenecks: KitBottleneck[];
  /** Пункт 38. Тренд продаж по артикулу. */
  trends: Record<string, SalesTrend>;
}

/** Пункт 42. Разбор коррекции скорости по одному товару. */
export interface SpeedCorrectionInfo {
  /** Скорость до коррекции, шт/день. */
  base: number;
  /** Скорость после коррекции, шт/день. */
  corrected: number;
  /** Во сколько раз выросла скорость. При базе 0 равен 0. */
  factor: number;
  /** Скорость по лучшим неделям до применения предела роста, шт/день. */
  raw: number;
  /** Предел роста сработал и обрезал коррекцию. */
  capped: boolean;
  /** Продано за окно тренда, шт. */
  windowQty: number;
  /** Недель с продажами в окне тренда. */
  weeksWithSales: number;
  /** Фактическая длина окна тренда, недель (может быть меньше настройки). */
  windowWeeks: number;
  /** На сколько дней хватало остатка Ozon по старой скорости. При базе 0 равен 0. */
  daysLeft: number;
  /** Лучшие недели окна: понедельник и количество. */
  bestWeeks: { week: string; qty: number }[];
}

/** Пункт 42. Минимум недель с продажами в окне тренда: защита от новинок. */
export const MIN_WEEKS_WITH_SALES = 6;

/**
 * Пункт 42. Коррекция скорости продаж при дефиците.
 * Скорость за 4 последние недели не отличает падение спроса от отсутствия товара:
 * у распроданного артикула она занижена в разы, а от неё считаются порог заказа,
 * потребность кластеров и отсекатель maxClusterDays.
 * Признак дефицита — ПУСТОЙ СКЛАД, а не падение продаж: если остатка Ozon
 * (доступно + в пути) хватает меньше чем на deficitDays, скорость берётся как среднее
 * по bestWeeks лучшим неделям окна тренда.
 * Скорость 0 при нулевом остатке — тоже дефицит: делить на ноль нельзя, товар считается
 * распроданным, а предел роста к нулю неприменим и не действует.
 * Защита от новинок и случайных всплесков: минимум minSalesForCorrection штук за окно
 * и минимум MIN_WEEKS_WITH_SALES недель с продажами.
 * В окно берутся только недельные строки («Дней» = 7): 28-дневные блоки архива дали бы
 * четырёхкратно завышенную «неделю».
 * Функция ИЗМЕНЯЕТ переданный объект speed и возвращает разбор по скорректированным товарам.
 */
export function applyDeficitSpeedCorrection(
  speed: SalesSpeedResult,
  stocks: OzonStockRow[],
  sales: OzonSalesRow[],
  skus: SKUItem[],
  settings: OzonCoverageSettings,
  now: Date
): Record<string, SpeedCorrectionInfo> {
  const out: Record<string, SpeedCorrectionInfo> = {};
  const deficitDays = Number(settings.deficitDays);
  if (!(deficitDays > 0)) return out;
  const trendWeeks = Number(settings.trendWeeks) > 0 ? Math.floor(Number(settings.trendWeeks)) : 13;
  const bestWeeksN = Number(settings.bestWeeks) > 0 ? Math.floor(Number(settings.bestWeeks)) : 4;
  const minSales = Number(settings.minSalesForCorrection) >= 0 ? Number(settings.minSalesForCorrection) : 50;
  const maxGrowth = Number(settings.maxSpeedGrowth);

  // Остаток Ozon по товару: доступно + в пути. Возвраты не берутся: их ещё нет в продаже.
  const onHand: Record<string, number> = {};
  for (const row of stocks) {
    const article = resolveOzonArticle(skus, row.offerId, row.sku);
    onHand[article] = (onHand[article] || 0) + (Number(row.available) || 0) + (Number(row.transit) || 0);
  }

  // Окно тренда обрезается по неделям, которые реально пришли с сервера.
  const presentWeeks = new Set<string>();
  for (const row of sales) {
    if ((Number(row.days) || 0) === 7) presentWeeks.add(String(row.week || '').trim());
  }
  const window = getLastFullWeeks(now, trendWeeks).filter(w => presentWeeks.has(w));
  if (window.length < MIN_WEEKS_WITH_SALES) return out;
  const windowSet = new Set(window);

  // Недельный ряд по товару и по товару с кластером.
  const byWeek: Record<string, Record<string, number>> = {};
  const byCluster: Record<string, Record<string, number>> = {};
  for (const row of sales) {
    if ((Number(row.days) || 0) !== 7) continue;
    const week = String(row.week || '').trim();
    if (!windowSet.has(week)) continue;
    const qty = Number(row.qty) || 0;
    if (!(qty > 0)) continue;
    const article = resolveOzonArticle(skus, row.offerId);
    if (!byWeek[article]) byWeek[article] = {};
    byWeek[article][week] = (byWeek[article][week] || 0) + qty;
    const cluster = String(row.clusterName || '').trim();
    if (!cluster) continue;
    if (!byCluster[article]) byCluster[article] = {};
    byCluster[article][cluster] = (byCluster[article][cluster] || 0) + qty;
  }

  const candidates = new Set<string>([...Object.keys(speed.perDayByArticle), ...Object.keys(byWeek)]);
  for (const article of candidates) {
    const base = Number(speed.perDayByArticle[article]) || 0;
    const stock = onHand[article] || 0;
    let daysLeft = 0;
    if (base > 0) {
      daysLeft = stock / base;
      if (daysLeft >= deficitDays) continue;
    } else if (stock > 0) {
      continue; // скорость 0 при живом остатке — это не дефицит, а отсутствие спроса
    }

    const weekQty = byWeek[article] || {};
    const values = window.map(w => weekQty[w] || 0);
    const weeksWithSales = values.filter(v => v > 0).length;
    if (weeksWithSales < MIN_WEEKS_WITH_SALES) continue;
    const windowQty = values.reduce((sum, v) => sum + v, 0);
    if (windowQty < minSales) continue;

    const ranked = window.map(w => ({ week: w, qty: weekQty[w] || 0 }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, bestWeeksN);
    if (!ranked.length) continue;
    const raw = ranked.reduce((sum, r) => sum + r.qty, 0) / ranked.length / 7;
    if (!(raw > base)) continue;

    // Предел роста применяется только к ненулевой базе: 5 × 0 = 0 обнулило бы коррекцию.
    const capApplies = base > 0 && maxGrowth >= 1;
    const corrected = capApplies ? Math.min(raw, base * maxGrowth) : raw;

    speed.perDayByArticle[article] = corrected;
    const clusterSpeeds = speed.perDayByArticleCluster[article];
    if (base > 0 && clusterSpeeds) {
      const factor = corrected / base;
      for (const name of Object.keys(clusterSpeeds)) clusterSpeeds[name] = clusterSpeeds[name] * factor;
    } else {
      // Базы нет: кластерные скорости строятся заново по долям продаж за окно тренда.
      const clusterQty = byCluster[article] || {};
      let total = 0;
      for (const name of Object.keys(clusterQty)) total += clusterQty[name];
      const fresh: Record<string, number> = {};
      if (total > 0) {
        for (const name of Object.keys(clusterQty)) fresh[name] = corrected * (clusterQty[name] / total);
      }
      speed.perDayByArticleCluster[article] = fresh;
    }

    out[article] = {
      base,
      corrected,
      factor: base > 0 ? corrected / base : 0,
      raw,
      capped: capApplies && corrected < raw,
      windowQty,
      weeksWithSales,
      windowWeeks: window.length,
      daysLeft,
      bestWeeks: ranked
    };
  }
  return out;
}

// ===== Пункт 38: тренд продаж =====

/**
 * Недель в месяце. Наклон регрессии измеряется в шт/неделю, а множитель нужен месячный:
 * именно так формула была восстановлена сверкой с замером 09.08.2026.
 */
const WEEKS_PER_MONTH = 4.345;

/** Пункт 38. Нижняя граница применённого тренда. */
const TREND_MIN = 0.7;

/** Пункт 38. Верхняя граница применённого тренда. */
const TREND_MAX = 1.5;

/**
 * Пункт 38. Минимум продаж за окно тренда, шт: на мелкой выборке наклон регрессии — шум
 * (в замере 09.08.2026 Этажерка_25_белая давала +95% на выборке в 23 штуки).
 * Порог из решения пользователя 09.08.2026, отдельной настройки для него намеренно не заводится.
 */
export const MIN_SALES_FOR_TREND = 50;

export interface SalesTrend {
  /** Сырой множитель до фильтров. */
  raw: number;
  /** Применённый множитель: 1.00, если сработал любой фильтр. */
  applied: number;
  /** Почему множитель отличается от сырого: null — фильтры не срабатывали. */
  reason: 'correction' | 'zeroWeek' | 'fewSales' | 'deficit' | 'clamped' | 'shortWindow' | null;
  /** Недельный ряд, по которому считался тренд (для подсказки в интерфейсе). */
  weeks: string[];
  weekQty: number[];
  /** Всего продано за окно, шт. */
  windowQty: number;
  /** Наклон регрессии, шт/неделю. */
  slope: number;
  /** Среднее за окно, шт/неделю. */
  mean: number;
  /** Сколько недель окна с нулевыми продажами. */
  zeroWeeks: number;
}

/**
 * Пункт 38. Тренд продаж по каждому товару.
 * Скорость за окно — плоское среднее, оно не видит направления спроса, а горизонт заказа
 * на фабрике около 110 дней, поэтому партия систематически расходится с реальностью.
 * По недельному ряду за окно строится линейная регрессия методом наименьших квадратов,
 * тренд = (среднее + наклон × WEEKS_PER_MONTH) ÷ среднее.
 * Окно и правила сборки ряда те же, что у коррекции скорости: берутся только недельные
 * строки («Дней» = 7), а окно урезается по неделям, реально пришедшим с сервера.
 * ФИЛЬТРЫ применяются строго по порядку, первый сработавший даёт множитель 1.00:
 * 1) короткое окно — меньше MIN_WEEKS_WITH_SALES недель с данными, тренд считать не на чем;
 * 2) сработала коррекция скорости при дефиците (пункт 42) — решение пользователя 19.08.2026:
 *    коррекция и тренд поднимают скорость одним и тем же способом, перемножение их пределов
 *    5× и 1,5× дало бы рост в 7,5 раза и затоваривание;
 * 3) в окне есть неделя с нулевыми продажами — это чаще старт продаж или отсутствие товара,
 *    а не спрос (в замере Миска_двойная получала +71% из-за пяти нулевых недель на старте);
 * 4) за окно продано меньше MIN_SALES_FOR_TREND штук — выборка слишком мелкая;
 * 5) товар в дефиците И тренд понижающий — падение продаж неотличимо от отсутствия товара.
 *    ПОВЫШАЮЩИЙ тренд при дефиците применяется как обычно.
 * Если не сработал ни один фильтр, тренд ограничивается диапазоном TREND_MIN…TREND_MAX.
 * Функция чистая: входные объекты не изменяются.
 */
export function buildSalesTrend(
  sales: OzonSalesRow[],
  skus: SKUItem[],
  settings: OzonCoverageSettings,
  now: Date,
  speed: SalesSpeedResult,
  stocks: OzonStockRow[],
  corrections: Record<string, SpeedCorrectionInfo>
): Record<string, SalesTrend> {
  const trendWeeks = Number(settings.trendWeeks) > 0 ? Math.floor(Number(settings.trendWeeks)) : 13;
  const deficitDays = Number(settings.deficitDays) > 0 ? Number(settings.deficitDays) : 0;

  // Остаток Ozon по товару: доступно + в пути, как в applyDeficitSpeedCorrection.
  const onHand: Record<string, number> = {};
  for (const row of stocks) {
    const article = resolveOzonArticle(skus, row.offerId, row.sku);
    onHand[article] = (onHand[article] || 0) + (Number(row.available) || 0) + (Number(row.transit) || 0);
  }

  // Окно тренда обрезается по неделям, которые реально пришли с сервера.
  const presentWeeks = new Set<string>();
  for (const row of sales) {
    if ((Number(row.days) || 0) === 7) presentWeeks.add(String(row.week || '').trim());
  }
  const window = getLastFullWeeks(now, trendWeeks).filter(w => presentWeeks.has(w));
  const windowSet = new Set(window);

  // Недельный ряд по товару. Артикул определяется через resolveOzonArticle БЕЗ «ШК Ozon» —
  // ровно так же, как в buildSalesSpeed и applyDeficitSpeedCorrection: расхождение способов
  // связывания продаж и остатков вынесено отдельным пунктом 39 плана и здесь не лечится.
  const byWeek: Record<string, Record<string, number>> = {};
  for (const row of sales) {
    if ((Number(row.days) || 0) !== 7) continue;
    const week = String(row.week || '').trim();
    if (!windowSet.has(week)) continue;
    const qty = Number(row.qty) || 0;
    if (!(qty > 0)) continue;
    const article = resolveOzonArticle(skus, row.offerId);
    if (!byWeek[article]) byWeek[article] = {};
    byWeek[article][week] = (byWeek[article][week] || 0) + qty;
  }

  const out: Record<string, SalesTrend> = {};
  const candidates = new Set<string>([...Object.keys(speed.perDayByArticle), ...Object.keys(byWeek)]);
  for (const article of candidates) {
    const weekQtyMap = byWeek[article] || {};
    const weekQty = window.map(w => weekQtyMap[w] || 0);
    const windowQty = weekQty.reduce((sum, v) => sum + v, 0);
    const zeroWeeks = weekQty.filter(v => v === 0).length;
    const mean = weekQty.length > 0 ? windowQty / weekQty.length : 0;

    // Наклон методом наименьших квадратов, x — порядковый номер недели от 0.
    let slope = 0;
    if (weekQty.length > 1) {
      const meanX = (weekQty.length - 1) / 2;
      let cov = 0;
      let varX = 0;
      for (let i = 0; i < weekQty.length; i++) {
        cov += (i - meanX) * (weekQty[i] - mean);
        varX += (i - meanX) * (i - meanX);
      }
      slope = varX > 0 ? cov / varX : 0;
    }
    // Среднее 0 — делить не на что, движения спроса нет.
    const raw = mean > 0 ? (mean + slope * WEEKS_PER_MONTH) / mean : 1;

    // Дефицит определяется так же, как в applyDeficitSpeedCorrection: пустой склад, а не
    // падение продаж. Скорость 0 при нулевом остатке — тоже дефицит, делить на ноль нельзя.
    const perDay = Number(speed.perDayByArticle[article]) || 0;
    const stock = onHand[article] || 0;
    const inDeficit = deficitDays > 0 && (perDay > 0 ? stock / perDay < deficitDays : stock <= 0);

    let reason: SalesTrend['reason'] = null;
    let applied = 1;
    if (window.length < MIN_WEEKS_WITH_SALES) {
      reason = 'shortWindow';
    } else if (corrections[article]) {
      reason = 'correction';
    } else if (zeroWeeks > 0) {
      reason = 'zeroWeek';
    } else if (windowQty < MIN_SALES_FOR_TREND) {
      reason = 'fewSales';
    } else if (inDeficit && raw < 1) {
      reason = 'deficit';
    } else {
      applied = Math.min(TREND_MAX, Math.max(TREND_MIN, raw));
      if (applied !== raw) reason = 'clamped';
    }

    out[article] = { raw, applied, reason, weeks: window, weekQty, windowQty, slope, mean, zeroWeeks };
  }
  return out;
}

/**
 * Пункт 36. Покрытие по компонентам виртуальных комплектов и узкие места комплектов.
 * Скорость компонента = Σ по комплектам (скорость комплекта шт/д × норма расхода).
 * Запас (ТРУБА) = Σ по комплектам (расчётный остаток комплекта на Ozon × норма)
 * + собственный остаток компонента на Моём складе + заказанное на фабрике по компоненту.
 * Расчётный остаток комплекта — готовое поле totalEstimated агрегата остатков: так цифры
 * компонента и комплекта не расходятся между собой.
 * Комплекты legacy игнорируются полностью: у них есть собственный остаток, их поведение прежнее.
 * Заказы на фабрике, оформленные на КОМПЛЕКТ, в компоненты НЕ разворачиваются: такой заказ
 * означает заказ одного конкретного компонента, а не всего состава.
 * Функция чистая: ничего не читает из стора и не изменяет входные объекты.
 */
export function buildComponentCoverage(
  kits: KitItem[],
  speed: SalesSpeedResult,
  stocksByArticle: Record<string, ArticleStockAgg>,
  skus: SKUItem[],
  myStockAvailability: Record<string, number>,
  factoryOnOrder: Record<string, number>,
  settings: OzonCoverageSettings,
  forecastPerDayByArticle?: Record<string, number>
): { components: ComponentCoverage[]; bottlenecks: KitBottleneck[] } {
  const virtualKits = (kits || []).filter(k => k && k.type === 'virtual');
  if (!virtualKits.length) return { components: [], bottlenecks: [] };

  // Накопление по компоненту: скорость и запас складываются по всем комплектам, где компонент
  // участвует (случай «Бутылок» и «Пакетов» — они входят сразу в два комплекта).
  const acc = new Map<string, { perDay: number; forecastPerDay: number; fromKitsQty: number; usedInKits: string[] }>();

  for (const kit of virtualKits) {
    const kitSku = String(kit.kitSku || '').trim();
    if (!kitSku) continue;
    const kitPerDay = Number(speed.perDayByArticle[kitSku]) || 0;
    // Пункт 38: заказ на фабрике считается по компонентам, поэтому в него идёт ПРОГНОЗНАЯ
    // скорость комплекта; без неё тренд не работал бы на большей части оборота.
    const kitForecastPerDay = forecastPerDayByArticle && forecastPerDayByArticle[kitSku] !== undefined
      ? Number(forecastPerDayByArticle[kitSku]) || 0
      : kitPerDay;
    const kitStock = stocksByArticle[kitSku];
    const kitEstimated = kitStock ? kitStock.totalEstimated : 0;

    for (const comp of kit.components || []) {
      const componentSku = String(comp.componentSku || '').trim();
      const norm = Number(comp.quantity) || 0;
      if (!componentSku || !(norm > 0)) continue;

      let row = acc.get(componentSku);
      if (!row) {
        row = { perDay: 0, forecastPerDay: 0, fromKitsQty: 0, usedInKits: [] };
        acc.set(componentSku, row);
      }
      row.perDay += kitPerDay * norm;
      row.forecastPerDay += kitForecastPerDay * norm;
      row.fromKitsQty += kitEstimated * norm;
      if (!row.usedInKits.includes(kitSku)) row.usedInKits.push(kitSku);
    }
  }

  const components: ComponentCoverage[] = [];
  const byComponent: Record<string, ComponentCoverage> = {};
  for (const [componentSku, row] of acc) {
    // Карточки компонента в SKU Базе может не быть: тогда коробка 1, срок поставки 0 —
    // так же, как для обычного товара без карточки в buildOzonCoverage.
    const skuItem = skus.find(s => s.sku === componentSku);
    const pcsPerBox = skuItem && skuItem.pcsPerBox > 0 ? skuItem.pcsPerBox : 1;
    const leadTimeDays = skuItem ? (Number(skuItem.leadTimeDays) || 0) : 0;
    const myStockQty = Number(myStockAvailability[componentSku]) || 0;
    const onOrderQty = Math.max(0, Number(factoryOnOrder[componentSku]) || 0);
    // Сигнал считается той же функцией, что и по обычным товарам: роль «остатка Ozon» играет
    // запас, пришедший из расчётных остатков комплектов. Дефицита кластеров у компонента нет.
    const factory = calcFactorySignal(
      row.fromKitsQty,
      myStockQty,
      row.forecastPerDay,
      leadTimeDays,
      pcsPerBox,
      settings,
      0,
      onOrderQty
    );

    const coverage: ComponentCoverage = {
      component: componentSku,
      perDay: row.perDay,
      forecastPerDay: row.forecastPerDay,
      pipelineQty: row.fromKitsQty + Math.max(0, myStockQty) + onOrderQty,
      myStockQty,
      onOrderQty,
      fromKitsQty: row.fromKitsQty,
      leadTimeDays,
      pcsPerBox,
      factory,
      usedInKits: row.usedInKits
    };
    components.push(coverage);
    byComponent[componentSku] = coverage;
  }

  const bottlenecks: KitBottleneck[] = [];
  for (const kit of virtualKits) {
    const kitSku = String(kit.kitSku || '').trim();
    if (!kitSku) continue;

    let worstSku = '';
    let worstDays: number | null = null;
    let canAssembleQty = Number.POSITIVE_INFINITY;

    for (const comp of kit.components || []) {
      const componentSku = String(comp.componentSku || '').trim();
      const norm = Number(comp.quantity) || 0;
      if (!componentSku || !(norm > 0)) continue;
      const row = byComponent[componentSku];
      if (!row) continue;

      // Покрытие компонента: запас ÷ скорость. Скорость 0 — покрытие «бесконечное» (null).
      const days = row.perDay > 0 ? row.pipelineQty / row.perDay : null;
      const current = days === null ? Number.POSITIVE_INFINITY : days;
      const worst = worstDays === null ? Number.POSITIVE_INFINITY : worstDays;
      if (!worstSku || current < worst) {
        worstSku = componentSku;
        worstDays = days;
      }
      // Собрать можно столько комплектов, на сколько хватает самого дефицитного компонента.
      canAssembleQty = Math.min(canAssembleQty, Math.floor(Math.max(0, row.myStockQty) / norm));
    }

    if (!worstSku) continue;
    bottlenecks.push({
      kitSku,
      componentSku: worstSku,
      daysLeft: worstDays,
      canAssembleQty: isFinite(canAssembleQty) ? canAssembleQty : 0
    });
  }

  return { components, bottlenecks };
}

/**
 * Сборный расчёт покрытия и рекомендаций по всем товарам.
 * Товары — объединение артикулов из остатков Ozon и продаж за окно скорости.
 */
export function buildOzonCoverage(input: OzonCoverageInput): OzonCoverageResult {
  const now = input.now || new Date();
  const speedWeeks = input.settings.speedWeeks > 0 ? input.settings.speedWeeks : 4;
  const weeks = getLastFullWeeks(now, speedWeeks);
  const speed = buildSalesSpeed(input.sales, input.skus, weeks);
  const stocksByArticle = buildClusterStocks(input.stocks, input.skus, input.settings.returnsToSalePct);
  const speedCorrections = applyDeficitSpeedCorrection(speed, input.stocks, input.sales, input.skus, input.settings, now);
  // Пункт 38. Тренд считается ПОСЛЕ коррекции скорости: сработавшая коррекция гасит тренд.
  const trends = buildSalesTrend(input.sales, input.skus, input.settings, now, speed, input.stocks, speedCorrections);
  // Прогнозная скорость = факт × тренд × (1 + прирост, %). Используется ТОЛЬКО в контуре заказа
  // на фабрике; рекомендации на поставку в кластеры Ozon считаются по фактической скорости.
  const salesGrowthK = 1 + (Number(input.settings.salesGrowthPct) || 0) / 100;
  const forecastPerDayByArticle: Record<string, number> = {};
  for (const article of Object.keys(speed.perDayByArticle)) {
    const trend = trends[article];
    forecastPerDayByArticle[article] = speed.perDayByArticle[article] * (trend ? trend.applied : 1) * salesGrowthK;
  }
  const nameToId = buildClusterNameToId(input.clusters);
  const excludedIds = parseExcludedClusters(input.settings.excludedClusters);
  const priorityMap = parsePriorityClusters(input.settings.priorityClusters || '');

  const articleSet = new Set<string>([
    ...Object.keys(stocksByArticle),
    ...Object.keys(speed.qtyByArticle)
  ]);

  // Пункт 36: заказ на фабрике по виртуальному комплекту не считается — только по компонентам.
  const virtualKitSkus = new Set<string>(
    (input.kits || [])
      .filter(k => k && k.type === 'virtual')
      .map(k => String(k.kitSku || '').trim())
      .filter(Boolean)
  );

  const articles: ArticleCoverage[] = [];

  for (const article of articleSet) {
    const stockAgg = stocksByArticle[article] || { article, totalEstimated: 0, unboundEstimated: 0, byCluster: {} };
    const skuItem = input.skus.find(s => s.sku === article);
    const pcsPerBox = skuItem && skuItem.pcsPerBox > 0 ? skuItem.pcsPerBox : 1;
    const leadTimeDays = skuItem ? (Number(skuItem.leadTimeDays) || 0) : 0;
    const myStockAvailable = Number(input.myStockAvailability[article]) || 0;
    // Локальный зачёт: товар из созданных заявок физически ещё лежит на Моём складе
    // (расход проводится только при ACCEPTED_AT_SUPPLY_WAREHOUSE), поэтому он резервируется
    // и не может быть повторно распределён в другой кластер.
    const pendingByCluster = (input.pending && input.pending.byArticleCluster[article]) || {};
    const pendingTotal = Math.max(0, Number(input.pending && input.pending.byArticle[article]) || 0);
    const freeMyStock = Math.max(0, myStockAvailable - pendingTotal);

    const qtyByClusterId: Record<string, number> = {};
    const perDayByClusterId: Record<string, number> = {};
    const clusterNamesById: Record<string, string> = {};
    let unboundQtySold = 0;

    const articleClusterQty = speed.qtyByArticleCluster[article] || {};
    const articleClusterPerDay = speed.perDayByArticleCluster[article] || {};
    for (const clusterName of Object.keys(articleClusterQty)) {
      const qty = articleClusterQty[clusterName];
      const id = nameToId[clusterName] || '';
      if (!id) {
        unboundQtySold += qty;
        continue;
      }
      qtyByClusterId[id] = (qtyByClusterId[id] || 0) + qty;
      perDayByClusterId[id] = (perDayByClusterId[id] || 0) + (articleClusterPerDay[clusterName] || 0);
      clusterNamesById[id] = clusterName;
    }

    const articleQtySold = speed.qtyByArticle[article] || 0;

    const clusterIds = new Set<string>([
      ...Object.keys(stockAgg.byCluster),
      ...Object.keys(qtyByClusterId)
    ]);

    const clusterRows: ClusterCoverageRow[] = [];
    for (const clusterId of clusterIds) {
      const st = stockAgg.byCluster[clusterId];
      const perDay = perDayByClusterId[clusterId] || 0;
      const qtySold = qtyByClusterId[clusterId] || 0;
      const isExcluded = excludedIds.has(clusterId);
      const estimated = st ? st.estimated : 0;
      const priorityK = isExcluded ? 1 : (priorityMap[clusterId] || 1);
      const isPriority = priorityK > 1;
      const effectiveSettings = isPriority
        ? {
            ...input.settings,
            minStockDays: input.settings.minStockDays * priorityK,
            targetStockDays: input.settings.targetStockDays * priorityK,
          }
        : input.settings;
      // Зачёт и колонка «В заявках» описывают одни и те же заявки — берётся наибольшее, не сумма.
      const pendingQty = Math.max(0, Number(pendingByCluster[clusterId]) || 0);
      const requestedQty = st ? Math.max(0, Number(st.requested) || 0) : 0;
      const pendingEffective = Math.max(pendingQty, requestedQty);
      // Покрытие в днях считается по чистому остатку Ozon: товар в заявке ещё не приехал,
      // продавать его нельзя. Зачёт влияет только на потребность в новой поставке.
      const coverage = calcCoverageDays(estimated, perDay, effectiveSettings.minStockDays, isExcluded);
      const recommendation = isExcluded
        ? null
        : calcSupplyRecommendation(perDay, estimated + pendingEffective, effectiveSettings, pcsPerBox, Number.MAX_SAFE_INTEGER);

      clusterRows.push({
        clusterId,
        clusterName: (st && st.clusterName) || clusterNamesById[clusterId] || clusterId,
        qtySold,
        perDay,
        sharePct: articleQtySold > 0 ? (qtySold / articleQtySold) * 100 : 0,
        available: st ? st.available : 0,
        transit: st ? st.transit : 0,
        returns: st ? st.returns : 0,
        estimated,
        coverageDays: coverage,
        excluded: isExcluded,
        priority: isPriority,
        priorityK,
        unmetQty: 0,
        pendingQty,
        requestedQty,
        pendingEffective,
        recommendation
      });
    }
    clusterRows.sort((a, b) => b.qtySold - a.qtySold);

    // Распределение остатка Моего склада между кластерами: остаток один на всех, поэтому
    // рекомендации выдаются по очереди — сначала приоритетные (по убыванию коэффициента),
    // затем остальные по возрастанию покрытия. Кому не хватило — урезанная рекомендация.
    const boxSize = pcsPerBox > 0 ? pcsPerBox : 1;
    let remainingStock = freeMyStock;
    const distributionOrder = clusterRows
      .filter(r => r.recommendation !== null)
      .sort((a, b) => {
        if (a.priority !== b.priority) return a.priority ? -1 : 1;
        if (a.priority && b.priority && a.priorityK !== b.priorityK) return b.priorityK - a.priorityK;
        const ca = a.coverageDays === null ? Number.POSITIVE_INFINITY : a.coverageDays;
        const cb = b.coverageDays === null ? Number.POSITIVE_INFINITY : b.coverageDays;
        return ca - cb;
      });
    for (const row of distributionOrder) {
      const rec = row.recommendation as SupplyRecommendation;
      const boxesNeeded = Math.ceil(rec.neededQty / boxSize);
      const boxesGiven = Math.min(boxesNeeded, Math.floor(remainingStock / boxSize));
      remainingStock -= boxesGiven * boxSize;
      row.unmetQty = (boxesNeeded - boxesGiven) * boxSize;
      row.recommendation = {
        neededQty: rec.neededQty,
        boxes: boxesGiven,
        qty: boxesGiven * boxSize,
        limitedByMyStock: boxesGiven < boxesNeeded
      };
    }

    const perDay = speed.perDayByArticle[article] || 0;
    const unmetDeficitQty = clusterRows.reduce((s, r) => s + (r.unmetQty || 0), 0);
    const onOrderQty = Math.max(0, Number(input.factoryOnOrder && input.factoryOnOrder[article]) || 0);
    const forecastPerDay = forecastPerDayByArticle[article] || 0;
    const factory = virtualKitSkus.has(article)
      ? null
      : calcFactorySignal(
          stockAgg.totalEstimated,
          myStockAvailable,
          forecastPerDay,
          leadTimeDays,
          pcsPerBox,
          input.settings,
          unmetDeficitQty,
          onOrderQty
        );

    articles.push({
      article,
      qtySold: articleQtySold,
      perDay,
      forecastPerDay,
      trend: trends[article] || null,
      pcsPerBox,
      leadTimeDays,
      myStockAvailable,
      totalEstimated: stockAgg.totalEstimated,
      unboundEstimated: stockAgg.unboundEstimated,
      unboundQtySold,
      unmetDeficitQty,
      pendingTotal,
      freeMyStock,
      clusters: clusterRows,
      factory,
      speedCorrection: speedCorrections[article] || null
    });
  }

  articles.sort((a, b) => b.perDay - a.perDay);

  const { components, bottlenecks } = buildComponentCoverage(
    input.kits || [],
    speed,
    stocksByArticle,
    input.skus,
    input.myStockAvailability,
    input.factoryOnOrder || {},
    input.settings,
    forecastPerDayByArticle
  );

  return { speed, articles, components, bottlenecks, trends };
}

