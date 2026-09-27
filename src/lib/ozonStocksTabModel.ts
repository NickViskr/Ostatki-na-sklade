// Item 88, ticket 04: everything the «Остатки Озон» tab shows, computed in one tested module.
// Pure — no React, no store reads, no `new Date()`, no console. The screen (OzonStocksTab.tsx)
// keeps only UI state, formatting and drawing; every computed value below moved out of the
// screen VERBATIM (same order of operations, same sorting, same fallbacks) so the rendered DOM
// stays byte-identical. `buildOzonStocksTabModel` chains every stage for tests with plain data;
// the screen's own hook (`useOzonStocksTabModel.ts`) calls the same stage functions individually,
// one per `useMemo`, so a search keystroke does not recompute coverage.
import { FactoryOrder, KitItem, OzonSalesRow, OzonStockRow, SKUItem } from '../types';
import {
  ArticleCoverage,
  ComponentCoverage,
  KitBottleneck,
  OzonCoverageResult,
  OzonCoverageSettings,
  coverageTone,
  parseExcludedClusters,
  resolveOzonArticle,
} from './ozonCoverage';
import type { FactorySignal, FactoryOnOrderResult } from './ozonCoverage';
import { CoverageSource, computeCoverage } from './ozonCoverageSource';
import { PendingSuppliesResult } from './ozonPending';
import {
  buildManualPlan,
  ManualArticleInfo,
  ManualPick,
  ManualPlan,
  manualClusterList,
  pickedCabinetSets,
  pickedClusterIds,
  readManualPicks,
} from './ozonManualSupply';
import { canTickCluster } from './ozonSupplyLines';
import { isChinaFactoryOrder, splitFactoryOrders } from './factoryOrderDisplay';

// ===== Shared row/cluster shapes =====

export interface CoverageRowTotals {
  available: number;
  preparing: number;
  requested: number;
  transit: number;
  excess: number;
  returns: number;
  other: number;
}

export interface CoverageClusterRow {
  clusterId: string;
  clusterName: string;
  qtySold: number;
  perDay: number;
  available: number;
  transit: number;
  returns: number;
  estimated: number;
  coverageDays: number | null;
  excluded: boolean;
  priority: boolean;
  priorityK: number;
  unmetQty: number;
  pendingQty: number;
  requestedQty: number;
  ozonInFlightQty: number;
  inFlightQty: number;
  recommendation: ArticleCoverage['clusters'][number]['recommendation'];
  speedSharePct: number;
  shareWindowWeeks: number;
  /** Item 51. Full need of the cluster: whole boxes normally, a partial box for a slow cluster. */
  needQty: number;
  needBoxes: number;
  warehouses: OzonStockRow[];
}

export interface CoverageTabRow extends Omit<ArticleCoverage, 'clusters'> {
  name: string;
  cabinets: string[];
  totals: CoverageRowTotals;
  unboundRows: OzonStockRow[];
  unboundTotals: CoverageRowTotals;
  coverageDays: number | null;
  recommendedQty: number;
  recLimited: boolean;
  deficitQty: number;
  factoryDaysLeft: number | null;
  inFlightTotal: number;
  factoryThreshold: number;
  clusters: CoverageClusterRow[];
}

/** Item 64. A cluster the article never shipped to: the row exists, the numbers do not.
 *  Built here, not inside a rule: only the screen's row shape knows this. */
export const emptyManualCluster = (ref: { clusterId: string; clusterName: string }): CoverageClusterRow => ({
  clusterId: ref.clusterId,
  clusterName: ref.clusterName,
  qtySold: 0,
  perDay: 0,
  available: 0,
  transit: 0,
  returns: 0,
  estimated: 0,
  coverageDays: null,
  excluded: false,
  priority: false,
  priorityK: 1,
  unmetQty: 0,
  pendingQty: 0,
  requestedQty: 0,
  ozonInFlightQty: 0,
  inFlightQty: 0,
  needQty: 0,
  needBoxes: 0,
  recommendation: null,
  warehouses: [],
  speedSharePct: 0,
  shareWindowWeeks: 0,
});

// ===== Stage: coverage rows (was the `coverageRows` memo, ~lines 524-599) =====

const sumTotals = (list: OzonStockRow[]): CoverageRowTotals => ({
  available: list.reduce((s, w) => s + (w.available || 0), 0),
  preparing: list.reduce((s, w) => s + (w.preparing || 0), 0),
  requested: list.reduce((s, w) => s + (w.requested || 0), 0),
  transit: list.reduce((s, w) => s + (w.transit || 0), 0),
  excess: list.reduce((s, w) => s + (w.excess || 0), 0),
  returns: list.reduce((s, w) => s + (w.returns || 0), 0),
  other: list.reduce((s, w) => s + (w.other || 0), 0),
});

export function buildCoverageRows(
  coverage: OzonCoverageResult | null,
  filteredOzonStocks: OzonStockRow[],
  filteredOzonSales: OzonSalesRow[],
  skus: SKUItem[],
  minStockDays: number,
  deliveryToOzonDays: number,
  factoryOnOrder: Record<string, number>,
  pendingSupplies: PendingSuppliesResult
): CoverageTabRow[] {
  if (!coverage || !coverage.articles) return [];
  // Запасной источник кабинетов: у распроданного в ноль товара строк остатков нет,
  // а бейдж кабинета показать всё равно надо. Карта строится один раз — продаж тысячи строк,
  // а фильтр внутри цикла по артикулам дал бы квадрат.
  const cabinetsByArticle: Record<string, Set<string>> = {};
  for (const sale of filteredOzonSales) {
    const cab = String(sale.cabinet || '').trim();
    if (!cab) continue;
    const article = resolveOzonArticle(skus, sale.offerId);
    if (!cabinetsByArticle[article]) cabinetsByArticle[article] = new Set<string>();
    cabinetsByArticle[article].add(cab);
  }
  const rows = coverage.articles.map((art) => {
    const stockRows = filteredOzonStocks.filter(
      (s) => resolveOzonArticle(skus, s.offerId, s.sku) === art.article
    );
    const unboundRows = stockRows.filter((s) => !String(s.clusterId || '').trim());
    const artCoverageDays = art.perDay > 0
      ? (art.totalEstimated - art.perDay * minStockDays) / art.perDay
      : null;
    const box = art.pcsPerBox > 0 ? art.pcsPerBox : 1;
    const clustersWithNeed: CoverageClusterRow[] = art.clusters.map((cls) => {
      const needQty = cls.recommendation ? cls.recommendation.wantQty : 0;
      return {
        ...cls,
        needBoxes: Math.ceil(needQty / box),
        needQty,
        warehouses: stockRows.filter((s) => String(s.clusterId || '').trim() === cls.clusterId),
      };
    });
    // Название и кабинеты берутся из остатков, но у распроданного товара остатков нет:
    // название тогда достаётся из карточки SKU, кабинеты — из продаж.
    const stockName = stockRows.length > 0 ? (stockRows[0].name || '') : '';
    const skuCard = skus.find((s) => s.sku === art.article);
    const stockCabinets = Array.from(new Set(stockRows.map((s) => s.cabinet).filter(Boolean)));
    return {
      ...art,
      name: stockName || (skuCard ? (skuCard.name || '') : ''),
      cabinets: stockCabinets.length > 0
        ? stockCabinets
        : Array.from(cabinetsByArticle[art.article] || []),
      totals: sumTotals(stockRows),
      unboundRows,
      unboundTotals: sumTotals(unboundRows),
      coverageDays: artCoverageDays,
      recommendedQty: art.clusters.reduce((s, c) => s + (c.recommendation ? c.recommendation.qty : 0), 0),
      recLimited: art.clusters.some((c) => c.recommendation !== null && c.recommendation.limitedByMyStock),
      deficitQty: clustersWithNeed.reduce((s, c) => s + (c.recommendation && c.recommendation.boxes === 0 ? c.needQty : 0), 0),
      // Item 85: the same pipeline as calcFactorySignal — «Мой склад» net of the reserve and the
      // forecast speed, so «хватит на N дн.» never disagrees with the signal itself.
      factoryDaysLeft: art.factory ? art.factory.daysLeft : (art.forecastPerDay > 0 ? (art.totalEstimated + Math.max(0, art.freeMyStock) + (factoryOnOrder[art.article] || 0)) / art.forecastPerDay : null),
      inFlightTotal: art.clusters.reduce((s, c) => s + (c.inFlightQty || 0), 0) + (pendingSupplies.unboundInFlightByArticle[art.article] || 0),
      // Item 86 step C: same threshold as calcFactorySignal (lead + delivery to Ozon + minStockDays).
      factoryThreshold: (Number(art.leadTimeDays) || 0) + (Number(deliveryToOzonDays) || 0) + minStockDays,
      clusters: clustersWithNeed,
    };
  });
  rows.sort((a, b) => (b.perDay - a.perDay) || (b.totals.available - a.totals.available));
  return rows;
}

// ===== Stage: component rows and kit bottlenecks (~603-615) =====

export function buildComponentRows(coverage: OzonCoverageResult | null): ComponentCoverage[] {
  if (!coverage || !Array.isArray(coverage.components)) return [];
  return [...coverage.components].sort((a, b) => b.perDay - a.perDay);
}

export function buildBottleneckByKit(coverage: OzonCoverageResult | null): Record<string, KitBottleneck> {
  const map: Record<string, KitBottleneck> = {};
  if (!coverage || !Array.isArray(coverage.bottlenecks)) return map;
  for (const b of coverage.bottlenecks) map[b.kitSku] = b;
  return map;
}

// ===== Stage: visible rows (~617) =====

export function buildVisibleRows(
  coverageRows: CoverageTabRow[],
  searchQuery: string,
  onlyWithRecommendations: boolean
): CoverageTabRow[] {
  const q = searchQuery.trim().toLowerCase();
  return coverageRows.filter((row) => {
    if (onlyWithRecommendations && row.recommendedQty <= 0 && row.deficitQty <= 0 && !row.factory) return false;
    if (!q) return true;
    return String(row.article).toLowerCase().includes(q) || String(row.name || '').toLowerCase().includes(q);
  });
}

// ===== Stage: cluster shares (~626) =====

export interface ClusterShareEntry {
  clusterName: string;
  qty: number;
  priority: boolean;
  priorityK: number;
  pct: number;
}

export interface ClusterShares {
  list: ClusterShareEntry[];
  total: number;
  byClusterId: Record<string, number>;
}

export function buildClusterShares(coverageRows: CoverageTabRow[]): ClusterShares {
  const map: Record<string, { clusterName: string; qty: number; priority: boolean; priorityK: number }> = {};
  let total = 0;
  for (const row of coverageRows) {
    for (const cls of row.clusters) {
      if (!map[cls.clusterId]) {
        map[cls.clusterId] = { clusterName: cls.clusterName, qty: 0, priority: false, priorityK: 1 };
      }
      map[cls.clusterId].qty += cls.qtySold || 0;
      if (cls.priority) {
        map[cls.clusterId].priority = true;
        map[cls.clusterId].priorityK = cls.priorityK;
      }
      total += cls.qtySold || 0;
    }
  }
  const list = Object.values(map)
    .filter((c) => c.qty > 0)
    .map((c) => ({ ...c, pct: total > 0 ? (c.qty / total) * 100 : 0 }))
    .sort((a, b) => b.qty - a.qty);
  // Пункт 60. Тот же расчёт в виде «КластерID -> доля»: по нему мастер поставки
  // сортирует список кластеров, чтобы порядок совпадал с графиком долей.
  const byClusterId: Record<string, number> = {};
  Object.keys(map).forEach((clusterId) => {
    byClusterId[clusterId] = total > 0 ? (map[clusterId].qty / total) * 100 : 0;
  });
  return { list, total, byClusterId };
}

// ===== Stage: factory orders by article, active orders, hidden manual (~413-448, ~665-674) =====

export function buildFactoryOrdersByArticle(factoryOrders: FactoryOrder[] | null | undefined): Record<string, FactoryOrder[]> {
  const map: Record<string, FactoryOrder[]> = {};
  for (const o of factoryOrders || []) {
    if (String(o.status || '').trim() === 'received') continue;
    const key = String(o.article || '').trim();
    if (!key) continue;
    if (!map[key]) map[key] = [];
    map[key].push(o);
  }
  for (const key of Object.keys(map)) {
    map[key].sort((a, b) => String(a.expectedAt || '').localeCompare(String(b.expectedAt || '')));
  }
  return map;
}

/** MANUAL row only — the modal's «new order» form edits a manual order, never a China row. */
export function buildActiveFactoryOrders(factoryOrders: FactoryOrder[] | null | undefined): Record<string, FactoryOrder> {
  const map: Record<string, FactoryOrder> = {};
  for (const o of factoryOrders || []) {
    if (String(o.status || '').trim() === 'received') continue;
    if (isChinaFactoryOrder(o)) continue;
    const key = String(o.article || '').trim();
    if (key) map[key] = o;
  }
  return map;
}

export function buildHiddenManualIds(openFactoryOrders: FactoryOnOrderResult): Set<string> {
  return new Set(openFactoryOrders.hiddenManual.map((o) => o.id));
}

export function buildHiddenManualByArticle(openFactoryOrders: FactoryOnOrderResult): Record<string, FactoryOrder[]> {
  const map: Record<string, FactoryOrder[]> = {};
  for (const o of openFactoryOrders.hiddenManual) {
    const key = String(o.article || '').trim();
    if (!key) continue;
    if (!map[key]) map[key] = [];
    map[key].push(o);
  }
  return map;
}

// ===== Stage: the factory modal's row lookup (~676) =====

export interface FactoryModalRow {
  article: string;
  name: string;
  factory: FactorySignal | null;
  pcsPerBox: number;
  leadTimeDays: number;
}

export function findFactoryModalRow(
  coverageRows: CoverageTabRow[],
  componentRows: ComponentCoverage[],
  factoryModalArticle: string | null
): FactoryModalRow | null {
  if (!factoryModalArticle) return null;
  const row = coverageRows.find((r) => r.article === factoryModalArticle);
  if (row) return row;
  // Пункт 36. Заказ открывают и по компоненту комплекта, а его в строках основной таблицы
  // нет. Без этой подстановки в окно ушли бы коробка 1 и срок поставки 0 — заказ посчитался
  // бы неверно. Название берём пустым: в SKU Базе названий нет, окно покажет артикул.
  const comp = componentRows.find((c) => c.component === factoryModalArticle);
  if (!comp) return null;
  return {
    article: comp.component,
    name: '',
    factory: comp.factory,
    pcsPerBox: comp.pcsPerBox,
    leadTimeDays: comp.leadTimeDays,
  };
}

// ===== Stage: «Фабрика» cell state, per article and per kit component (~1531-1552, ~1779-1935, ~2201) =====

export type FactoryCellKind =
  | 'overdue'
  | 'order'
  | 'clusterDeficitWaiting'
  | 'clusterDeficit'
  | 'waiting'
  | 'bottleneck'
  | 'noLeadTime'
  | 'notNeeded';

export interface FactoryCellState {
  kind: FactoryCellKind;
  overdueList: FactoryOrder[];
  overdueQty: number;
  waitingList: FactoryOrder[];
  waitingQty: number;
  nearest: FactoryOrder | null;
  hiddenManual: FactoryOrder[];
  orderQty: number;
  clusterOnly: boolean;
  box: number;
}

/** The article row's «Фабрика» cell — one of eight states, same precedence as the JSX
 *  ternary chain it replaces: overdue orders win, then an open order, then the two
 *  cluster-only-deficit variants, then a waiting order, a kit bottleneck, a missing lead
 *  time, and finally «не нужно». */
export function buildArticleFactoryCellState(params: {
  factoryList: FactoryOrder[];
  todayIso: string;
  hiddenManualIds: Set<string>;
  hiddenManual: FactoryOrder[];
  factory: FactorySignal | null;
  pcsPerBox: number;
  leadTimeDays: number;
  isBottleneck: boolean;
}): FactoryCellState {
  const box = params.pcsPerBox > 0 ? params.pcsPerBox : 1;
  const split = splitFactoryOrders(params.factoryList, params.todayIso, params.hiddenManualIds);
  const overdueList = split.overdue;
  const overdueQty = overdueList.reduce((s, o) => s + (Number(o.qty) || 0), 0);
  const waitingList = split.waiting;
  const waitingQty = waitingList.reduce((s, o) => s + (Number(o.qty) || 0), 0);
  const nearest = waitingList[0] || null;
  const orderQty = params.factory ? params.factory.orderQty : 0;
  const clusterOnly = !!(params.factory && params.factory.reason === 'clusterDeficit' && params.factory.orderQty === 0);

  let kind: FactoryCellKind;
  if (overdueList.length > 0) kind = 'overdue';
  else if (orderQty > 0) kind = 'order';
  else if (clusterOnly) kind = waitingQty > 0 ? 'clusterDeficitWaiting' : 'clusterDeficit';
  else if (waitingQty > 0) kind = 'waiting';
  else if (params.isBottleneck) kind = 'bottleneck';
  else if ((Number(params.leadTimeDays) || 0) === 0) kind = 'noLeadTime';
  else kind = 'notNeeded';

  return { kind, overdueList, overdueQty, waitingList, waitingQty, nearest, hiddenManual: params.hiddenManual, orderQty, clusterOnly, box };
}

/** The kit component row's «Требуемый заказ» cell — same rule, narrower: no bottleneck and
 *  no missing-lead-time states (a component always has its own lead time or none is shown
 *  elsewhere), and the cluster-deficit state is never split by a waiting order. */
export function buildComponentFactoryCellState(params: {
  list: FactoryOrder[];
  todayIso: string;
  hiddenManualIds: Set<string>;
  factory: FactorySignal | null;
  pcsPerBox: number;
}): FactoryCellState {
  const box = params.pcsPerBox > 0 ? params.pcsPerBox : 1;
  const split = splitFactoryOrders(params.list, params.todayIso, params.hiddenManualIds);
  const overdueList = split.overdue;
  const overdueQty = overdueList.reduce((s, o) => s + (Number(o.qty) || 0), 0);
  const waitingList = split.waiting;
  const waitingQty = waitingList.reduce((s, o) => s + (Number(o.qty) || 0), 0);
  const nearest = waitingList[0] || null;
  const orderQty = params.factory ? params.factory.orderQty : 0;

  let kind: FactoryCellKind;
  if (overdueList.length > 0) kind = 'overdue';
  else if (params.factory && params.factory.orderQty > 0) kind = 'order';
  else if (params.factory && params.factory.unmetDeficitQty > 0) kind = 'clusterDeficit';
  else if (waitingQty > 0) kind = 'waiting';
  else kind = 'notNeeded';

  return { kind, overdueList, overdueQty, waitingList, waitingQty, nearest, hiddenManual: [], orderQty, clusterOnly: false, box };
}

/** The «Фабрика» cell state of every coverage row, by article — the whole point of the model:
 *  the screen must be able to read the cell it draws without calling the builder itself. */
export function buildFactoryCellByArticle(
  coverageRows: CoverageTabRow[],
  factoryOrdersByArticle: Record<string, FactoryOrder[]>,
  todayIso: string,
  hiddenManualIds: Set<string>,
  hiddenManualByArticle: Record<string, FactoryOrder[]>,
  bottleneckByKit: Record<string, KitBottleneck>
): Record<string, FactoryCellState> {
  const map: Record<string, FactoryCellState> = {};
  for (const row of coverageRows) {
    map[row.article] = buildArticleFactoryCellState({
      factoryList: factoryOrdersByArticle[row.article] || [],
      todayIso,
      hiddenManualIds,
      hiddenManual: hiddenManualByArticle[row.article] || [],
      factory: row.factory,
      pcsPerBox: row.pcsPerBox,
      leadTimeDays: row.leadTimeDays,
      isBottleneck: !!bottleneckByKit[row.article],
    });
  }
  return map;
}

/** The «Требуемый заказ» cell state of every component row, by component. */
export function buildFactoryCellByComponent(
  componentRows: ComponentCoverage[],
  factoryOrdersByArticle: Record<string, FactoryOrder[]>,
  todayIso: string,
  hiddenManualIds: Set<string>
): Record<string, FactoryCellState> {
  const map: Record<string, FactoryCellState> = {};
  for (const c of componentRows) {
    map[c.component] = buildComponentFactoryCellState({
      list: factoryOrdersByArticle[c.component] || [],
      todayIso,
      hiddenManualIds,
      factory: c.factory,
      pcsPerBox: c.pcsPerBox,
    });
  }
  return map;
}

// ===== Stage: cabinets by article, selected cabinet sets, supply stock options (~700-725) =====

export function buildCabinetsByArticleMap(coverageRows: CoverageTabRow[]): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const row of coverageRows) map[row.article] = row.cabinets || [];
  return map;
}

/** Item 59. A supply request belongs to ONE shop. Built from the recommendation ticks. */
export function buildSelectedCabinetSets(
  selectedSupply: Record<string, boolean>,
  cabinetsByArticleMap: Record<string, string[]>
): string[][] {
  const sets: string[][] = [];
  Object.keys(selectedSupply).forEach((key) => {
    if (!selectedSupply[key]) return;
    const article = key.split('|||')[0] || '';
    if (article) sets.push(cabinetsByArticleMap[article] || []);
  });
  return sets;
}

export interface SupplyStockOption {
  article: string;
  name: string;
  freeMyStock: number;
  cabinets: string[];
}

export function buildSupplyStockOptions(coverageRows: CoverageTabRow[]): SupplyStockOption[] {
  return coverageRows.map((row) => ({
    article: row.article,
    name: row.name || '',
    freeMyStock: Number(row.freeMyStock) || 0,
    cabinets: (row.cabinets || []) as string[],
  }));
}

// ===== Stage: supply cluster refs (~732) =====

export interface SupplyClusterRef {
  clusterId: string;
  clusterName: string;
}

export function buildSupplyClusterRefs(
  excludedClustersSetting: string,
  clusterRefs: { clusterId: string; clusterName: string }[]
): SupplyClusterRef[] {
  const excluded = parseExcludedClusters(excludedClustersSetting || '');
  return (clusterRefs || [])
    .filter((c) => c.clusterId && !excluded.has(String(c.clusterId)))
    .map((c) => ({ clusterId: String(c.clusterId), clusterName: String(c.clusterName || '') }));
}

// ===== Stage: manual infos and manual plan (~739-766) =====

export function buildManualInfos(
  coverageRows: CoverageTabRow[],
  supplyClusterRefs: SupplyClusterRef[],
  clusterSharesByClusterId: Record<string, number>
): ManualArticleInfo[] {
  return coverageRows.map((row) => ({
    article: row.article,
    name: row.name || '',
    pcsPerBox: Number(row.pcsPerBox) || 0,
    freeMyStock: Number(row.freeMyStock) || 0,
    cabinets: (row.cabinets || []) as string[],
    // Пункт 64. ТОТ ЖЕ список, что рисует таблица. Если брать только свои кластеры
    // товара, отмеченный новый кластер молча исчезнет из заявки.
    clusters: manualClusterList(row.clusters || [], supplyClusterRefs, clusterSharesByClusterId, emptyManualCluster).map((c) => ({
      clusterId: String(c.clusterId),
      clusterName: String(c.clusterName || ''),
    })),
  }));
}

export function buildManualPicks(manualQty: Record<string, string>): ManualPick[] {
  return readManualPicks(manualQty);
}

export function buildManualClusterIds(manualPicks: ManualPick[]): string[] {
  return pickedClusterIds(manualPicks);
}

export function buildManualCabinetSets(manualPicks: ManualPick[], cabinetsByArticleMap: Record<string, string[]>): string[][] {
  return pickedCabinetSets(manualPicks, cabinetsByArticleMap);
}

export function buildManualPlanStage(manualPicks: ManualPick[], manualInfos: ManualArticleInfo[]): ManualPlan {
  return buildManualPlan(manualPicks, manualInfos);
}

// ===== Stage: supply recommendations incl. the wide-window enrichment (~790-850) =====

export interface SupplyRecommendationRow {
  article: string;
  name: string;
  myStockAvailable: number;
  freeMyStock: number;
  shippableMyStock: number;
  sharedLimitedBy: string[];
  pendingTotal: number;
  minCoverage: number;
  clusters: CoverageClusterRow[];
  wide: boolean;
  leftover: number;
}

export interface FactoryRecommendationRow {
  article: string;
  name: string;
  factory: FactorySignal;
  leadTimeDays: number;
}

export interface OzonStocksRecommendations {
  supplies: SupplyRecommendationRow[];
  factories: FactoryRecommendationRow[];
  orderedCount: number;
  clusterDeficitCount: number;
}

export function buildRecommendations(
  coverageRows: CoverageTabRow[],
  wideArticles: Record<string, boolean>,
  wideCoverage: OzonCoverageResult | null,
  factoryOnOrder: Record<string, number>
): OzonStocksRecommendations {
  const supplies: SupplyRecommendationRow[] = [];
  const factories: FactoryRecommendationRow[] = [];
  let orderedCount = 0;
  let clusterDeficitCount = 0;
  for (const row of coverageRows) {
    // «Распределить весь остаток»: у переключённого товара кластеры берутся из расчёта по
    // окну тренда. Обогащение (needBoxes/needQty) повторяет то, что делает coverageRows,
    // потому что панель рисует обе выдачи одним и тем же кодом.
    const wideArticle = wideArticles[row.article] && wideCoverage
      ? wideCoverage.articles.find((a) => a.article === row.article)
      : undefined;
    const box = row.pcsPerBox > 0 ? row.pcsPerBox : 1;
    const sourceClusters: CoverageClusterRow[] = wideArticle
      ? wideArticle.clusters.map((cls) => {
          const needQty = cls.recommendation ? cls.recommendation.wantQty : 0;
          return { ...cls, needBoxes: Math.ceil(needQty / box), needQty, warehouses: [] };
        })
      : row.clusters;
    const clusters = sourceClusters.filter((c) => c.recommendation && (c.recommendation.boxes > 0 || c.needQty > 0));
    if (clusters.length > 0) {
      let minCoverage = Number.POSITIVE_INFINITY;
      for (const c of clusters) {
        const cov = c.coverageDays === null || c.coverageDays === undefined ? Number.POSITIVE_INFINITY : c.coverageDays;
        if (cov < minCoverage) minCoverage = cov;
      }
      supplies.push({
        article: row.article,
        name: row.name,
        myStockAvailable: row.myStockAvailable,
        freeMyStock: row.freeMyStock,
        shippableMyStock: row.shippableMyStock,
        sharedLimitedBy: row.sharedLimitedBy || [],
        pendingTotal: row.pendingTotal,
        minCoverage,
        clusters,
        wide: Boolean(wideArticle),
        // Сколько свободного остатка расчёт НЕ разложил: чтобы «весь остаток» не оказалось
        // обещанием, которого расчёт не выполнил.
        leftover: Math.max(0, (Number(row.freeMyStock) || 0) - clusters.reduce(
          (sum, c) => sum + (c.recommendation ? c.recommendation.qty : 0), 0
        )),
      });
    }
    // Пункт 35. В список попадает то, что реально надо дозаказать.
    // Размещённый заказ входит в ТРУБУ и сам по себе позицию из списка не убирает.
    if (row.factory && row.factory.orderQty > 0) {
      factories.push({ article: row.article, name: row.name, factory: row.factory, leadTimeDays: row.leadTimeDays });
    }
    if (row.factory && row.factory.orderQty === 0 && row.factory.reason === 'clusterDeficit') clusterDeficitCount++;
    if ((factoryOnOrder[row.article] || 0) > 0) orderedCount++;
  }
  supplies.sort((a, b) => a.minCoverage - b.minCoverage);
  factories.sort((a, b) => a.factory.daysLeft - b.factory.daysLeft);
  return { supplies, factories, orderedCount, clusterDeficitCount };
}

// ===== Stage: the supply plan from the ticked items (~856-909) =====

export interface SupplyPlanRow {
  article: string;
  name: string;
  clusterId: string;
  clusterName: string;
  boxes: number;
  qty: number;
  limitedByMyStock: boolean;
}

export interface SupplyPlanClusterBoxes {
  clusterId: string;
  clusterName: string;
  boxes: number;
}

export interface SupplyPlan {
  rows: SupplyPlanRow[];
  clusters: SupplyPlanClusterBoxes[];
  cabinets: string[];
  totalBoxes: number;
  totalQty: number;
  overLimit: SupplyPlanClusterBoxes[];
  limit: number;
}

export function buildSupplyPlan(
  recommendations: OzonStocksRecommendations,
  coverageRows: CoverageTabRow[],
  selectedSupply: Record<string, boolean>,
  maxBoxesPerCluster: number
): SupplyPlan {
  const rows: SupplyPlanRow[] = [];
  const boxesByCluster: Record<string, SupplyPlanClusterBoxes> = {};
  const cabinets = new Set<string>();

  // Заявка собирается ИЗ ТОГО ЖЕ СПИСКА, в котором пользователь ставил галочки.
  // Раньше здесь перебирался coverageRows — обычный расчёт, — а галочки ставились в
  // «Рекомендациях», где у товара, переключённого кнопкой «Распределить весь остаток»,
  // кластеры приходят из расчёта по окну тренда. Кластер, которого в обычном расчёте нет,
  // до окна не доезжал: отметил восемь, в окне оказалось четыре.
  const cabinetsByArticle: Record<string, string[]> = {};
  for (const row of coverageRows) cabinetsByArticle[row.article] = row.cabinets || [];

  const supplyKey = (article: string, clusterId: string) => `${article}|||${clusterId}`;

  for (const row of recommendations.supplies) {
    for (const c of row.clusters) {
      // Пункт 60. Кластер, которому поставка нужна, но свободного остатка на него не
      // хватило, тоже попадает в заявку — с нулём. Количество владелец распределяет сам
      // в окне оформления, там же где уменьшает другие кластеры.
      if (!c.recommendation) continue;
      if (!canTickCluster(c.recommendation.boxes, c.needBoxes)) continue;
      if (!selectedSupply[supplyKey(row.article, c.clusterId)]) continue;

      rows.push({
        article: row.article,
        name: row.name,
        clusterId: String(c.clusterId),
        clusterName: String(c.clusterName || ''),
        boxes: c.recommendation.boxes,
        qty: c.recommendation.qty,
        limitedByMyStock: c.recommendation.limitedByMyStock === true,
      });

      (cabinetsByArticle[row.article] || []).forEach((cab) => { if (cab) cabinets.add(cab); });

      const cid = String(c.clusterId);
      if (!boxesByCluster[cid]) {
        boxesByCluster[cid] = { clusterId: cid, clusterName: String(c.clusterName || ''), boxes: 0 };
      }
      boxesByCluster[cid].boxes += c.recommendation.boxes;
    }
  }

  const limit = Number(maxBoxesPerCluster) || 30;
  const overLimit = Object.values(boxesByCluster).filter((c) => c.boxes > limit);

  return {
    rows,
    clusters: Object.values(boxesByCluster),
    cabinets: Array.from(cabinets),
    totalBoxes: rows.reduce((s, r) => s + r.boxes, 0),
    totalQty: rows.reduce((s, r) => s + r.qty, 0),
    overLimit,
    limit,
  };
}

// ===== One input, one output: buildOzonStocksTabModel =====
// Chains every stage above in the same order the screen does. For tests with plain data; the
// screen's hook calls the same stages individually so React keeps its own memo granularity.

export interface OzonStocksTabModelInput {
  source: CoverageSource;
  settings: OzonCoverageSettings;
  maxBoxesPerCluster: number;
  factoryOrders: FactoryOrder[] | null | undefined;
  kits: KitItem[];
  wideArticles: Record<string, boolean>;
  selectedSupply: Record<string, boolean>;
  manualQty: Record<string, string>;
  searchQuery: string;
  onlyWithRecommendations: boolean;
  factoryModalArticle: string | null;
  /** The screen's own mount-time today, used by `splitFactoryOrders` — never read from the clock. */
  todayIso: string;
}

export interface OzonStocksTabModel {
  coverage: OzonCoverageResult | null;
  wideCoverage: OzonCoverageResult | null;
  coverageRows: CoverageTabRow[];
  componentRows: ComponentCoverage[];
  bottleneckByKit: Record<string, KitBottleneck>;
  visibleRows: CoverageTabRow[];
  clusterShares: ClusterShares;
  factoryOrdersByArticle: Record<string, FactoryOrder[]>;
  activeFactoryOrders: Record<string, FactoryOrder>;
  hiddenManualIds: Set<string>;
  hiddenManualByArticle: Record<string, FactoryOrder[]>;
  factoryCellByArticle: Record<string, FactoryCellState>;
  factoryCellByComponent: Record<string, FactoryCellState>;
  factoryModalRow: FactoryModalRow | null;
  cabinetsByArticleMap: Record<string, string[]>;
  selectedCabinetSets: string[][];
  supplyStockOptions: SupplyStockOption[];
  supplyClusterRefs: SupplyClusterRef[];
  manualPicks: ManualPick[];
  manualClusterIds: string[];
  manualCabinetSets: string[][];
  manualInfos: ManualArticleInfo[];
  manualPlan: ManualPlan;
  recommendations: OzonStocksRecommendations;
  supplyPlan: SupplyPlan;
}

/** Окно тренда из настроек: сколько недель берём, когда распределяем весь остаток. */
export function resolveWideWeeks(settings: OzonCoverageSettings): number {
  return Number(settings.trendWeeks) > 0 ? Math.floor(Number(settings.trendWeeks)) : 13;
}

export function buildOzonStocksTabModel(input: OzonStocksTabModelInput): OzonStocksTabModel {
  const coverage = computeCoverage(input.source, input.settings);

  const anyWide = Object.keys(input.wideArticles).some((a) => input.wideArticles[a]);
  const wideWeeks = resolveWideWeeks(input.settings);
  const wideCoverage = anyWide && input.source.ready
    ? computeCoverage(input.source, { ...input.settings, speedWeeks: wideWeeks })
    : null;

  const factoryOnOrder = input.source.openFactoryOrders.qty;
  const coverageRows = buildCoverageRows(
    coverage,
    input.source.stocks,
    input.source.sales,
    input.source.skus,
    input.settings.minStockDays,
    input.settings.deliveryToOzonDays || 0,
    factoryOnOrder,
    input.source.pending
  );
  const componentRows = buildComponentRows(coverage);
  const bottleneckByKit = buildBottleneckByKit(coverage);
  const visibleRows = buildVisibleRows(coverageRows, input.searchQuery, input.onlyWithRecommendations);
  const clusterShares = buildClusterShares(coverageRows);

  const factoryOrdersByArticle = buildFactoryOrdersByArticle(input.factoryOrders);
  const activeFactoryOrders = buildActiveFactoryOrders(input.factoryOrders);
  const hiddenManualIds = buildHiddenManualIds(input.source.openFactoryOrders);
  const hiddenManualByArticle = buildHiddenManualByArticle(input.source.openFactoryOrders);
  const factoryCellByArticle = buildFactoryCellByArticle(
    coverageRows, factoryOrdersByArticle, input.todayIso, hiddenManualIds, hiddenManualByArticle, bottleneckByKit
  );
  const factoryCellByComponent = buildFactoryCellByComponent(componentRows, factoryOrdersByArticle, input.todayIso, hiddenManualIds);
  const factoryModalRow = findFactoryModalRow(coverageRows, componentRows, input.factoryModalArticle);

  const cabinetsByArticleMap = buildCabinetsByArticleMap(coverageRows);
  const selectedCabinetSets = buildSelectedCabinetSets(input.selectedSupply, cabinetsByArticleMap);
  const supplyStockOptions = buildSupplyStockOptions(coverageRows);
  const supplyClusterRefs = buildSupplyClusterRefs(input.settings.excludedClusters, input.source.clusters);

  const manualPicks = buildManualPicks(input.manualQty);
  const manualClusterIds = buildManualClusterIds(manualPicks);
  const manualCabinetSets = buildManualCabinetSets(manualPicks, cabinetsByArticleMap);
  const manualInfos = buildManualInfos(coverageRows, supplyClusterRefs, clusterShares.byClusterId);
  const manualPlan = buildManualPlanStage(manualPicks, manualInfos);

  const recommendations = buildRecommendations(coverageRows, input.wideArticles, wideCoverage, factoryOnOrder);
  const supplyPlan = buildSupplyPlan(recommendations, coverageRows, input.selectedSupply, input.maxBoxesPerCluster);

  return {
    coverage,
    wideCoverage,
    coverageRows,
    componentRows,
    bottleneckByKit,
    visibleRows,
    clusterShares,
    factoryOrdersByArticle,
    activeFactoryOrders,
    hiddenManualIds,
    hiddenManualByArticle,
    factoryCellByArticle,
    factoryCellByComponent,
    factoryModalRow,
    cabinetsByArticleMap,
    selectedCabinetSets,
    supplyStockOptions,
    supplyClusterRefs,
    manualPicks,
    manualClusterIds,
    manualCabinetSets,
    manualInfos,
    manualPlan,
    recommendations,
    supplyPlan,
  };
}

// Re-exported for the screen: the colour of a cell by coverage tone, unchanged from ozonCoverage.
export { coverageTone };
