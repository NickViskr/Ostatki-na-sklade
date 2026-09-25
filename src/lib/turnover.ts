/**
 * Item 78b (2026-09-21): capital turnover of the whole business — Ozon plus the own warehouse.
 *
 * KAN («Культура аналитики») computes `inventory_turnover_ratio` and `gmroi_percent` for the
 * Ozon stock only. The owner wants the same figures with the own warehouse in the denominator,
 * so this module rebuilds them per article and for the portfolio from two daily series:
 *  - «KAN дни» (`KanDayRow`): per Ozon product and day — stock cost, pieces, cost in delivery
 *    and in returns, cost of sales, gross profit, bought and ordered pieces;
 *  - «Снимки склада» (`SnapshotRow`): per article and day — pieces, average cost, capital.
 * Days before the first snapshot are reconstructed from the transaction journal: the shelf of
 * a past day is today's shelf minus the receipts after that day plus the expenses after it,
 * valued at today's average cost (corrections carry quantity 0 and do not move the shelf).
 *
 * Definitions (owner's questionnaire 2026-09-21, «как в KAN»):
 *  - average capital = mean over the period days of (warehouse capital + Ozon stock cost +
 *    cost in delivery + cost in returns); the reserve under supply orders is part of the shelf;
 *  - turns = cost of sales ÷ average capital; days per turn = period ÷ turns;
 *  - GMROI % = gross profit ÷ average capital × 100;
 *  - days of cover = (shelf + Ozon pieces now) ÷ (bought pieces ÷ period);
 *  - age = days since the last Ozon sale (ordered or bought), else since the last receipt;
 *  - status: slow when a turn takes longer than `slowDays` or there are no sales at all;
 *    fast when shorter than `fastDays`; a component of a virtual kit with no Ozon sales of its
 *    own is «component» — its capital sells inside the kit and is not a slow item.
 * Kits are their own products (owner: «по набору»): the kit's shelf is the computed kit
 * quantity at the kit's cost. The portfolio counts the warehouse capital of PHYSICAL articles
 * only, so a kit and its components are not added twice.
 */
import { KitItem, SKUItem, Transaction } from '../types';
import { resolveOzonArticle } from './ozonCoverage';
import { parseAppDate } from './utils';

export interface KanDayRow {
  date: string;
  article: string;
  productId: number;
  stockCost: number;
  stockQty: number;
  deliveringCost: number;
  returningCost: number;
  costOfSales: number;
  grossProfit: number;
  boughtQty: number;
  orderedQty: number;
}

export interface SnapshotRow {
  date: string;
  article: string;
  qty: number;
  avgCost: number;
  capital: number;
}

export interface TurnoverSettings {
  periodDays: number;
  slowDays: number;
  fastDays: number;
}

export interface ShelfItem {
  article: string;
  quantity: number;
  avgCost: number;
  /** A virtual kit: the quantity is computed from the components, the cost is their sum. */
  isVirtual?: boolean;
}

export type TurnoverStatus = 'fast' | 'normal' | 'slow' | 'component';

export interface ArticleTurnover {
  article: string;
  isKit: boolean;
  /** Names of the virtual kits this physical article is a component of. */
  kitOf: string[];
  /** Ozon products (KAN articles) mapped onto this article. */
  kanArticles: string[];
  shelfQty: number;
  shelfCapital: number;
  ozonQty: number;
  ozonStockCost: number;
  deliveringCost: number;
  returningCost: number;
  avgWarehouseCapital: number;
  avgOzonCapital: number;
  avgCapital: number;
  costOfSales: number;
  grossProfit: number;
  boughtQty: number;
  orderedQty: number;
  turns: number | null;
  daysPerTurn: number | null;
  gmroiPct: number | null;
  coverDays: number | null;
  lastSaleDay: string | null;
  lastReceiptDay: string | null;
  ageDays: number | null;
  status: TurnoverStatus;
}

export interface PortfolioTurnover {
  periodDays: number;
  fromDay: string;
  toDay: string;
  shelfCapital: number;
  ozonStockCost: number;
  deliveringCost: number;
  returningCost: number;
  capitalNow: number;
  avgCapital: number;
  avgWarehouseCapital: number;
  avgOzonCapital: number;
  costOfSales: number;
  grossProfit: number;
  turns: number | null;
  daysPerTurn: number | null;
  gmroiPct: number | null;
  /** Ozon-only turns on the Ozon stock cost alone: comparable with KAN's inventory_turnover_ratio. */
  ozonOnlyTurns: number | null;
  slowCapital: number;
  slowSharePct: number;
  fastCapital: number;
  counts: { fast: number; normal: number; slow: number; component: number };
}

export interface TurnoverResult {
  articles: ArticleTurnover[];
  portfolio: PortfolioTurnover;
}

export interface TurnoverInput {
  kanRows: KanDayRow[];
  snapshots: SnapshotRow[];
  shelf: ShelfItem[];
  transactions: Transaction[];
  skus: SKUItem[];
  kits: KitItem[];
  settings: TurnoverSettings;
  /** KAN's latest complete day; the period ends here. */
  latestKanDay: string;
  now?: Date;
}

const DAY_MS = 86400000;

export type GmroiTone = 'green' | 'yellow' | 'red' | 'none';

/** Item 78e: the colour of a GMROI figure by the owner's two thresholds (green ≥, red <). */
export function gmroiTone(pct: number | null, greenPct: number, redPct: number): GmroiTone {
  if (pct === null) return 'none';
  if (pct >= greenPct) return 'green';
  if (pct < redPct) return 'red';
  return 'yellow';
}

/**
 * The shelf as the «Склад» table shows it: physical articles as they are, a virtual kit as
 * the largest whole number of kits its components allow, priced at the components' sum.
 */
export function shelfFromStock(
  stock: Array<{ article: string; quantity: number; avgCost: number }>, kits: KitItem[]
): ShelfItem[] {
  const virtual = (kits || []).filter((k) => k.type === 'virtual');
  const byArticle = new Map<string, { article: string; quantity: number; avgCost: number }>();
  for (const s of stock || []) byArticle.set(s.article, s);
  const out: ShelfItem[] = [];
  const kitSkus = new Set(virtual.map((k) => k.kitSku));
  for (const s of stock || []) {
    if (kitSkus.has(s.article)) continue;
    out.push({ article: s.article, quantity: Number(s.quantity) || 0, avgCost: Number(s.avgCost) || 0 });
  }
  for (const k of virtual) {
    let minQty = Infinity;
    let cost = 0;
    for (const c of k.components || []) {
      const comp = byArticle.get(c.componentSku);
      const required = Number(c.quantity) || 1;
      minQty = Math.min(minQty, Math.floor((comp ? Number(comp.quantity) || 0 : 0) / required));
      cost += (comp ? Number(comp.avgCost) || 0 : 0) * required;
    }
    out.push({ article: k.kitSku, quantity: minQty === Infinity ? 0 : minQty, avgCost: cost, isVirtual: true });
  }
  return out;
}

export function shiftDay(isoDay: string, days: number): string {
  const d = new Date(isoDay + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function periodDays(toDay: string, count: number): string[] {
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) out.push(shiftDay(toDay, -i));
  return out;
}

function localDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysBetween(fromDay: string, toDay: string): number {
  return Math.round((Date.parse(toDay + 'T00:00:00Z') - Date.parse(fromDay + 'T00:00:00Z')) / DAY_MS);
}

/**
 * The shelf of one article on each period day: the snapshot when there is one, else the
 * journal walked back from today's shelf. Receipts after the day are subtracted, expenses
 * added; the day itself is included in the day's closing shelf (transactions ON the day have
 * already happened by its end).
 */
export function shelfHistory(
  article: string, shelfNow: number, days: string[], snapshots: SnapshotRow[], transactions: Transaction[]
): number[] {
  const snapByDay = new Map<string, number>();
  for (const s of snapshots) if (s.article === article) snapByDay.set(s.date, Number(s.qty) || 0);
  const moves: Array<{ day: string; delta: number }> = [];
  for (const t of transactions || []) {
    if (t.article !== article) continue;
    if (t.type !== 'Приход' && t.type !== 'Расход') continue;
    const d = parseAppDate(t.date);
    if (!d) continue;
    const q = Number(t.quantity) || 0;
    moves.push({ day: localDay(d), delta: t.type === 'Приход' ? q : -q });
  }
  return days.map((day) => {
    if (snapByDay.has(day)) return snapByDay.get(day)!;
    let qty = shelfNow;
    for (const m of moves) if (m.day > day) qty -= m.delta;
    return Math.max(0, qty);
  });
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export function buildTurnover(input: TurnoverInput): TurnoverResult {
  const now = input.now || new Date();
  const today = localDay(now);
  const period = Math.max(1, Math.round(input.settings.periodDays) || 90);
  const toDay = input.latestKanDay || shiftDay(today, -1);
  const days = periodDays(toDay, period);
  const fromDay = days[0];
  const daySet = new Set(days);

  // Kits: which physical article is a component of which virtual kit.
  const kitOf = new Map<string, string[]>();
  const kitCost = new Map<string, number>();
  const shelfByArticle = new Map<string, ShelfItem>();
  for (const s of input.shelf) shelfByArticle.set(s.article, s);
  for (const k of input.kits || []) {
    if (k.type !== 'virtual') continue;
    let cost = 0;
    for (const c of k.components || []) {
      const list = kitOf.get(c.componentSku) || [];
      list.push(k.kitSku);
      kitOf.set(c.componentSku, list);
      cost += (shelfByArticle.get(c.componentSku)?.avgCost || 0) * (Number(c.quantity) || 0);
    }
    kitCost.set(k.kitSku, cost);
  }

  // KAN rows in the period, grouped by the internal article.
  const kanByArticle = new Map<string, KanDayRow[]>();
  const kanNames = new Map<string, Set<string>>();
  for (const r of input.kanRows || []) {
    if (!daySet.has(r.date)) continue;
    const art = resolveOzonArticle(input.skus, r.article);
    const list = kanByArticle.get(art) || [];
    list.push(r);
    kanByArticle.set(art, list);
    const names = kanNames.get(art) || new Set<string>();
    names.add(r.article);
    kanNames.set(art, names);
  }

  // Last receipt per article, any time. Item 84 (stage 2): a quantity-0 «Приход» is a cost
  // correction («Доводка себестоимости»), not new goods — skipped so it does not reset
  // «лежит N дней» (turnoverDays.ts's lastReceiptByArticle does the same).
  const lastReceipt = new Map<string, string>();
  for (const t of input.transactions || []) {
    if (t.type !== 'Приход' || !(Number(t.quantity) > 0)) continue;
    const d = parseAppDate(t.date);
    if (!d) continue;
    const day = localDay(d);
    if (!lastReceipt.has(t.article) || day > lastReceipt.get(t.article)!) lastReceipt.set(t.article, day);
  }

  const articleSet = new Set<string>([...input.shelf.map((s) => s.article), ...kanByArticle.keys()]);
  const articles: ArticleTurnover[] = [];

  for (const article of articleSet) {
    const shelfItem = shelfByArticle.get(article);
    const isKit = shelfItem?.isVirtual === true || kitCost.has(article);
    const shelfQty = shelfItem ? Number(shelfItem.quantity) || 0 : 0;
    const unitCost = isKit ? (kitCost.get(article) ?? shelfItem?.avgCost ?? 0) : (shelfItem?.avgCost || 0);
    const shelfCapital = round2(shelfQty * unitCost);

    // Warehouse capital per day: snapshots carry their own cost; reconstructed days use today's.
    const snapCost = new Map<string, number>();
    for (const s of input.snapshots) if (s.article === article) snapCost.set(s.date, Number(s.avgCost) || 0);
    const history = shelfHistory(article, shelfQty, days, input.snapshots, isKit ? [] : input.transactions);
    let whSum = 0;
    for (let i = 0; i < days.length; i++) whSum += history[i] * (snapCost.has(days[i]) ? snapCost.get(days[i])! : unitCost);
    const avgWarehouseCapital = round2(whSum / period);

    const rows = kanByArticle.get(article) || [];
    let ozonSum = 0, costOfSales = 0, grossProfit = 0, boughtQty = 0, orderedQty = 0;
    let lastSaleDay: string | null = null;
    let lastDay = '';
    let ozonQty = 0, ozonStockCost = 0, deliveringCost = 0, returningCost = 0;
    for (const r of rows) {
      ozonSum += r.stockCost + r.deliveringCost + r.returningCost;
      // KAN reports the cost of sales as an expense, with a minus sign (live 2026-09-22:
      // `cost_price: -4063.26`); gross profit keeps its sign, it can be negative for real.
      costOfSales += Math.abs(r.costOfSales);
      grossProfit += r.grossProfit;
      boughtQty += r.boughtQty;
      orderedQty += r.orderedQty;
      if ((r.boughtQty > 0 || r.orderedQty > 0) && (!lastSaleDay || r.date > lastSaleDay)) lastSaleDay = r.date;
      if (r.date > lastDay) lastDay = r.date;
    }
    for (const r of rows) {
      if (r.date !== lastDay) continue;
      ozonQty += r.stockQty;
      ozonStockCost += r.stockCost;
      deliveringCost += r.deliveringCost;
      returningCost += r.returningCost;
    }
    const avgOzonCapital = round2(ozonSum / period);
    const avgCapital = round2(avgWarehouseCapital + avgOzonCapital);

    const turns = avgCapital > 0 ? costOfSales / avgCapital : null;
    const daysPerTurn = turns !== null && turns > 0 ? Math.round(period / turns) : null;
    const gmroiPct = avgCapital > 0 ? round2((grossProfit / avgCapital) * 100) : null;
    const coverDays = boughtQty > 0 ? Math.round((shelfQty + ozonQty) / (boughtQty / period)) : null;
    const lastReceiptDay = lastReceipt.get(article) || null;
    const ageBasis = lastSaleDay || lastReceiptDay;
    const ageDays = ageBasis ? Math.max(0, daysBetween(ageBasis, today)) : null;

    // Nothing anywhere and nothing sold: an article KAN still lists but the business no longer
    // holds (live 2026-09-22: six such rows). It is not «slow» — it is absent, and is left out.
    if (avgCapital === 0 && shelfQty === 0 && ozonQty === 0 && costOfSales === 0) continue;

    const kitsOfThis = kitOf.get(article) || [];
    let status: TurnoverStatus;
    if (kitsOfThis.length > 0 && rows.length === 0) status = 'component';
    else if (daysPerTurn === null) status = 'slow';
    else if (daysPerTurn > input.settings.slowDays) status = 'slow';
    else if (daysPerTurn < input.settings.fastDays) status = 'fast';
    else status = 'normal';

    articles.push({
      article, isKit, kitOf: kitsOfThis, kanArticles: [...(kanNames.get(article) || [])].sort(),
      shelfQty, shelfCapital, ozonQty, ozonStockCost: round2(ozonStockCost), deliveringCost: round2(deliveringCost),
      returningCost: round2(returningCost), avgWarehouseCapital, avgOzonCapital, avgCapital,
      costOfSales: round2(costOfSales), grossProfit: round2(grossProfit), boughtQty, orderedQty,
      turns: turns === null ? null : round2(turns), daysPerTurn, gmroiPct, coverDays, lastSaleDay, lastReceiptDay, ageDays, status,
    });
  }

  // Ranking: leaders first (fewest days per turn), no-sales last; components at the very end.
  const rank = (a: ArticleTurnover) => (a.status === 'component' ? 3 : a.daysPerTurn === null ? 2 : 1);
  articles.sort((a, b) => rank(a) - rank(b) || (a.daysPerTurn ?? 0) - (b.daysPerTurn ?? 0) || a.article.localeCompare(b.article, 'ru'));

  // Portfolio: physical articles only on the warehouse side (a kit's shelf IS its components).
  const physical = articles.filter((a) => !a.isKit);
  let shelfCapital = 0, avgWarehouseCapital = 0;
  for (const a of physical) { shelfCapital += a.shelfCapital; avgWarehouseCapital += a.avgWarehouseCapital; }
  let ozonStockCost = 0, deliveringCost = 0, returningCost = 0, avgOzonCapital = 0, costOfSales = 0, grossProfit = 0;
  let avgOzonStockOnly = 0;
  for (const a of articles) {
    ozonStockCost += a.ozonStockCost; deliveringCost += a.deliveringCost; returningCost += a.returningCost;
    avgOzonCapital += a.avgOzonCapital; costOfSales += a.costOfSales; grossProfit += a.grossProfit;
  }
  for (const r of input.kanRows || []) if (daySet.has(r.date)) avgOzonStockOnly += r.stockCost;
  avgOzonStockOnly /= period;
  const avgCapital = round2(avgWarehouseCapital + avgOzonCapital);
  const turns = avgCapital > 0 ? costOfSales / avgCapital : null;
  const capitalNow = round2(shelfCapital + ozonStockCost + deliveringCost + returningCost);
  const counts = { fast: 0, normal: 0, slow: 0, component: 0 };
  let slowCapital = 0, fastCapital = 0;
  for (const a of articles) {
    counts[a.status] += 1;
    // A slow kit freezes its components' capital: the kit's shelf counts here even though the
    // portfolio total counts the physical components (a share of a total, not an addition).
    const own = a.shelfCapital + a.ozonStockCost + a.deliveringCost + a.returningCost;
    if (a.status === 'slow') slowCapital += own;
    if (a.status === 'fast') fastCapital += own;
  }

  return {
    articles,
    portfolio: {
      periodDays: period, fromDay, toDay,
      shelfCapital: round2(shelfCapital), ozonStockCost: round2(ozonStockCost), deliveringCost: round2(deliveringCost),
      returningCost: round2(returningCost), capitalNow, avgCapital,
      avgWarehouseCapital: round2(avgWarehouseCapital), avgOzonCapital: round2(avgOzonCapital),
      costOfSales: round2(costOfSales), grossProfit: round2(grossProfit),
      turns: turns === null ? null : round2(turns),
      daysPerTurn: turns !== null && turns > 0 ? Math.round(period / turns) : null,
      gmroiPct: avgCapital > 0 ? round2((grossProfit / avgCapital) * 100) : null,
      ozonOnlyTurns: avgOzonStockOnly > 0 ? round2(costOfSales / avgOzonStockOnly) : null,
      slowCapital: round2(slowCapital), slowSharePct: capitalNow > 0 ? round2((slowCapital / capitalNow) * 100) : 0,
      fastCapital: round2(fastCapital), counts,
    },
  };
}
