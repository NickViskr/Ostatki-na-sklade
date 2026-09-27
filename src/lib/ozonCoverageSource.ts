// ===== Item 88, ticket 03: one shared coverage source for all four screens =====
// The dashboard, the tab, the tab's wide window and the settings modal's «было → станет» used
// to assemble the coverage input (availability, supply reserve, open factory orders, cabinet
// filtering of stocks/sales/stock history) each on its own, near-copied. Now one pure function
// does it once per screen — a new input reaches all four places at once. No store access and
// no `new Date()` here — `todayIso` (open factory orders) is a caller-supplied input. Note: the
// coverage build and the pending reserve are not handed a `now`, so they still read the clock
// themselves, exactly as the screens called them before this ticket.
import { ExternalShipment, FactoryOrder, KitItem, OzonSalesRow, OzonStockHistoryRow, OzonStockRow, SKUItem } from '../types';
import { buildOzonCoverage, factoryOnOrderByArticle, OzonClusterRef, OzonCoverageResult, OzonCoverageSettings } from './ozonCoverage';
import type { FactoryOnOrderResult } from './ozonCoverage';
import { buildPendingSupplies, OzonSupplyRequestRow, PendingSuppliesResult } from './ozonPending';

export interface CoverageStoreData {
  ozonStocks: OzonStockRow[];
  ozonSales: OzonSalesRow[] | null | undefined;
  ozonStockHistory: OzonStockHistoryRow[] | null | undefined;
  skus: SKUItem[];
  kits: KitItem[];
  clusterRefs: OzonClusterRef[];
  externalShipments: ExternalShipment[] | null | undefined;
  ozonSupplyRequests: OzonSupplyRequestRow[] | null | undefined;
  factoryOrders: FactoryOrder[] | null | undefined;
  /** The store's getEffectiveAvailability. */
  availabilityOf: (article: string) => number;
}

export interface CoverageSourceOptions {
  /** 'all' means every cabinet — no filtering. */
  cabinet: string;
  todayIso: string;
  waitForClusterRefs: boolean;
  /** Read only when waitForClusterRefs is true. */
  clusterRefsLoaded?: boolean;
}

export interface CoverageSource {
  stocks: OzonStockRow[];
  sales: OzonSalesRow[];
  stockHistory: OzonStockHistoryRow[];
  pending: PendingSuppliesResult;
  factoryPipeline: FactoryOnOrderResult;
  myStockAvailability: Record<string, number>;
  skus: SKUItem[];
  kits: KitItem[];
  clusters: OzonClusterRef[];
  ready: boolean;
}

/** Builds the coverage input for one screen and one cabinet choice. Pure. */
export function buildCoverageSource(data: CoverageStoreData, opts: CoverageSourceOptions): CoverageSource {
  const cabinet = opts.cabinet;

  const stocks = cabinet === 'all'
    ? data.ozonStocks
    : data.ozonStocks.filter((s) => s.cabinet === cabinet);

  const sales = (() => {
    if (!data.ozonSales) return [];
    if (cabinet === 'all') return data.ozonSales;
    return data.ozonSales.filter((s) => s.cabinet === cabinet);
  })();

  const stockHistory = (() => {
    if (!data.ozonStockHistory) return [];
    if (cabinet === 'all') return data.ozonStockHistory;
    return data.ozonStockHistory.filter((s) => s.cabinet === cabinet);
  })();

  const shipments = cabinet === 'all'
    ? (data.externalShipments || [])
    : (data.externalShipments || []).filter((s) => String(s.cabinet || '') === cabinet);
  const requests = cabinet === 'all'
    ? (data.ozonSupplyRequests || [])
    : (data.ozonSupplyRequests || []).filter((r) => String(r.cabinet || '') === cabinet);
  const pending = buildPendingSupplies({ shipments, requests, skus: data.skus });

  // Item 35/83. Open factory orders — «ordered, not received» — are never filtered by cabinet:
  // a factory order is not tied to one Ozon shop. Not the «ТРУБА» itself — see CONTEXT.md.
  const factoryPipeline = factoryOnOrderByArticle(data.factoryOrders || [], opts.todayIso);

  // Item 85, step 1.6: the same availability the tab and the dashboard used, kit components
  // included — a shared component gets its own figure even without an SKU card of its own.
  const myStockAvailability: Record<string, number> = {};
  for (const s of data.skus) {
    myStockAvailability[s.sku] = data.availabilityOf(s.sku);
  }
  for (const k of data.kits) for (const c of k.components || []) {
    if (!(c.componentSku in myStockAvailability)) myStockAvailability[c.componentSku] = data.availabilityOf(c.componentSku);
  }

  const ready = stocks.length > 0 && (!opts.waitForClusterRefs || opts.clusterRefsLoaded === true);

  return {
    stocks,
    sales,
    stockHistory,
    pending,
    factoryPipeline,
    myStockAvailability,
    skus: data.skus,
    kits: data.kits,
    clusters: data.clusterRefs,
    ready,
  };
}

/** Runs the coverage build over an assembled source. Returns null while the source is not ready. */
export function computeCoverage(source: CoverageSource, settings: OzonCoverageSettings): OzonCoverageResult | null {
  if (!source.ready) return null;
  return buildOzonCoverage({
    stocks: source.stocks,
    sales: source.sales,
    skus: source.skus,
    clusters: source.clusters,
    settings,
    myStockAvailability: source.myStockAvailability,
    pending: source.pending,
    factoryOnOrder: source.factoryPipeline.qty,
    kits: source.kits,
    stockHistory: source.stockHistory,
  });
}
