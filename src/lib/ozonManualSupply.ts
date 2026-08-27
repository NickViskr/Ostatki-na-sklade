// ===== Item 63. A supply assembled by hand, not from recommendations =====
// Recommendations answer «where the goods are running out». They cannot answer
// «I want to move this stock there because I decided so» — and that is a normal
// need: the owner sees the per-cluster picture and redistributes it himself.
//
// The screen for that is the stocks table, which already shows the three levels
// article -> cluster -> warehouse. Item 63 adds a mode where every cluster row
// carries a checkbox and a quantity field, and the free stock of «Мой склад»
// shrinks as the owner spreads it around: the app must never let him promise Ozon
// more than he physically has.
//
// Owner's decision 27.08.2026: the quantity is typed next to the checkbox (not one
// box by default, not zero), and this selection is INDEPENDENT of the ticks in the
// recommendations panel — each has its own «Оформить поставку» button.
//
// The rules of items 58 (a direct cluster travels alone) and 59 (one supply belongs
// to one shop) are NOT re-implemented here: they live in ozonDirectSupply and
// ozonSupplyCabinet and are applied to this selection as they are.

import { sortClustersBySalesShare } from './ozonSupplyLines';

/** Отмеченный кластер и количество, которое владелец туда назначил. */
export interface ManualPick {
  article: string;
  clusterId: string;
  qty: number;
}

/** Что нужно знать о товаре, чтобы собрать из галочек заявку. */
export interface ManualArticleInfo {
  article: string;
  name: string;
  /** Штук в коробке. Ноль и мусор считаются единицей — иначе делим на ноль. */
  pcsPerBox: number;
  /** Свободный остаток «Моего склада» за вычетом резерва под уже созданные заявки. */
  freeMyStock: number;
  cabinets: string[];
  clusters: { clusterId: string; clusterName: string }[];
}

export interface ManualRow {
  article: string;
  name: string;
  clusterId: string;
  clusterName: string;
  boxes: number;
  qty: number;
  limitedByMyStock: boolean;
}

export interface ManualPlan {
  rows: ManualRow[];
  clusters: { clusterId: string; clusterName: string; qty: number }[];
  cabinets: string[];
  totalQty: number;
  totalBoxes: number;
  /** Товары, по которым назначено больше, чем есть. Пустой список — всё в порядке. */
  over: { article: string; name: string; free: number; asked: number }[];
}

export const MANUAL_KEY_SEPARATOR = '|||';

export const manualKey = (article: string, clusterId: string): string =>
  String(article || '') + MANUAL_KEY_SEPARATOR + String(clusterId || '');

const toWhole = (value: any): number => {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

const boxSize = (pcsPerBox: any): number => {
  const n = Math.floor(Number(pcsPerBox));
  return Number.isFinite(n) && n > 0 ? n : 1;
};

/**
 * Разбор состояния галочек. Ключ в объекте — сама галочка, значение — текст поля
 * количества: пустая строка это отмеченный кластер, которому количество ещё не задали.
 * Такой кластер в заявку попадает с нулём, как и в пункте 60.
 */
export function readManualPicks(raw: Record<string, string> | null | undefined): ManualPick[] {
  const src = raw || {};
  const out: ManualPick[] = [];
  for (const key of Object.keys(src)) {
    const parts = String(key).split(MANUAL_KEY_SEPARATOR);
    const article = parts[0] || '';
    const clusterId = parts[1] || '';
    if (!article || !clusterId) continue;
    out.push({ article, clusterId, qty: toWhole(src[key]) });
  }
  return out;
}

/** Кластеры, отмеченные хотя бы по одному товару: вход для правила прямой поставки. */
export function pickedClusterIds(picks: ManualPick[]): string[] {
  const out: string[] = [];
  for (const p of picks || []) {
    if (p.clusterId && out.indexOf(p.clusterId) < 0) out.push(p.clusterId);
  }
  return out;
}

/** Наборы магазинов отмеченных товаров: вход для правила «заявка одного магазина». */
export function pickedCabinetSets(picks: ManualPick[], cabinetsByArticle: Record<string, string[]>): string[][] {
  const map = cabinetsByArticle || {};
  const sets: string[][] = [];
  for (const p of picks || []) {
    if (p.article) sets.push(map[p.article] || []);
  }
  return sets;
}

/** Сколько всего назначено этому товару, кроме указанного кластера. */
export function assignedForArticle(picks: ManualPick[], article: string, exceptClusterId: string): number {
  const wanted = String(article || '');
  const skip = String(exceptClusterId || '');
  let sum = 0;
  for (const p of picks || []) {
    if (p.article !== wanted) continue;
    if (skip && p.clusterId === skip) continue;
    sum += p.qty;
  }
  return sum;
}

/**
 * Сколько ещё можно отдать этому товару, не считая указанный кластер. Никогда не
 * отрицательное: минус на экране выглядит поломкой, а не подсказкой.
 */
export function remainingForArticle(
  freeMyStock: number,
  picks: ManualPick[],
  article: string,
  exceptClusterId: string
): number {
  const free = toWhole(freeMyStock);
  const taken = assignedForArticle(picks, article, exceptClusterId);
  const left = free - taken;
  return left > 0 ? left : 0;
}

/**
 * Обрезка введённого количества. Пустое поле — это ноль, а не отказ: владелец
 * стирает цифру, чтобы набрать новую. Больше свободного остатка ввести нельзя.
 */
export function clampManualQty(
  raw: any,
  freeMyStock: number,
  picks: ManualPick[],
  article: string,
  clusterId: string
): number {
  const asked = toWhole(raw);
  const limit = remainingForArticle(freeMyStock, picks, article, clusterId);
  return asked > limit ? limit : asked;
}

/** Собрать заявку из галочек. Порядок строк — как у товаров и кластеров на экране. */
export function buildManualPlan(picks: ManualPick[], infos: ManualArticleInfo[]): ManualPlan {
  const list = picks || [];
  const rows: ManualRow[] = [];
  const clusters: { clusterId: string; clusterName: string; qty: number }[] = [];
  const clusterIndex: Record<string, number> = {};
  const cabinets: string[] = [];
  const over: { article: string; name: string; free: number; asked: number }[] = [];

  for (const info of infos || []) {
    if (!info || !info.article) continue;
    const mine = list.filter((p) => p.article === info.article);
    if (mine.length === 0) continue;

    const box = boxSize(info.pcsPerBox);
    const free = toWhole(info.freeMyStock);
    let asked = 0;

    for (const cluster of info.clusters || []) {
      const pick = mine.find((p) => p.clusterId === String(cluster.clusterId));
      if (!pick) continue;
      asked += pick.qty;
      rows.push({
        article: info.article,
        name: info.name || '',
        clusterId: String(cluster.clusterId),
        clusterName: String(cluster.clusterName || ''),
        boxes: Math.ceil(pick.qty / box),
        qty: pick.qty,
        limitedByMyStock: false
      });

      const cid = String(cluster.clusterId);
      if (clusterIndex[cid] === undefined) {
        clusterIndex[cid] = clusters.length;
        clusters.push({ clusterId: cid, clusterName: String(cluster.clusterName || ''), qty: 0 });
      }
      clusters[clusterIndex[cid]].qty += pick.qty;
    }

    for (const cab of info.cabinets || []) {
      if (cab && cabinets.indexOf(cab) < 0) cabinets.push(cab);
    }

    // Остаток мог измениться после обновления данных, когда галочки уже стояли.
    if (asked > free) over.push({ article: info.article, name: info.name || '', free, asked });
  }

  return {
    rows,
    clusters,
    cabinets,
    totalQty: rows.reduce((s, r) => s + r.qty, 0),
    totalBoxes: rows.reduce((s, r) => s + r.boxes, 0),
    over
  };
}

/* ---- Пункт 64. В ручном режиме видны ВСЕ кластеры поставки ------------------------
 * Таблица остатков показывает у товара только те кластеры, где он лежит или продаётся:
 * так устроено покрытие — список кластеров это объединение остатков и продаж. Для
 * рекомендаций этого достаточно, а для ручной поставки нет: везти товар в новый регион
 * как раз и значит выбрать кластер, где его сейчас НЕТ.
 * Решение владельца 27.08.2026: показывать весь список кластеров, по убыванию доли в
 * ОБЩЕМ объёме продаж — тот же порядок, что на графике «Доли кластеров в продажах» и в
 * мастере поставки, поэтому правило сортировки берётся оттуда, а не пишется заново.
 */

export interface ManualClusterRef {
  clusterId: string;
  clusterName: string;
}

/**
 * Полный список кластеров товара для режима выбора: к своим кластерам добавляются
 * остальные кластеры поставки, пустые строки для них делает вызывающий код —
 * форму строки таблицы этот модуль не знает и знать не должен.
 *
 * Кластер, который у товара УЖЕ есть, не подменяется пустышкой ни при каких условиях:
 * иначе на экране пропали бы остатки и рекомендация.
 */
export function manualClusterList<T extends { clusterId: string; clusterName: string }>(
  own: T[],
  refs: ManualClusterRef[],
  shareByClusterId: Record<string, number>,
  makeEmpty: (ref: ManualClusterRef) => T
): T[] {
  const out: T[] = [];
  const seen: Record<string, boolean> = {};

  for (const cls of own || []) {
    const id = String(cls.clusterId || '').trim();
    if (!id || seen[id]) continue;
    seen[id] = true;
    out.push(cls);
  }

  for (const ref of refs || []) {
    const id = String(ref && ref.clusterId ? ref.clusterId : '').trim();
    if (!id || seen[id]) continue;
    seen[id] = true;
    out.push(makeEmpty({ clusterId: id, clusterName: String(ref.clusterName || '').trim() }));
  }

  return sortClustersBySalesShare(out, shareByClusterId);
}
