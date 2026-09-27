// Item 88, ticket 03. Checks buildCoverageSource + computeCoverage through the public
// input/output only: what the dashboard/tab/wide-window screens would observe, not the
// internals of buildOzonCoverage (already covered by ozonCoverage.test.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildCoverageSource,
  computeCoverage,
  CoverageStoreData
} from './ozonCoverageSource';
import { OzonCoverageSettings } from './ozonCoverage';
import { ExternalShipment, FactoryOrder, KitItem, OzonSalesRow, OzonStockRow, OzonStockHistoryRow, SKUItem } from '../types';
import { OzonSupplyRequestRow } from './ozonPending';

const NOW = new Date('2024-01-10T10:00:00Z'); // среда; последняя полная неделя — 2024-01-01

// DEFECT (found by this file, not fixed here): computeCoverage never forwards `now`/`todayIso`
// into buildOzonCoverage, and buildCoverageSource never forwards it into buildPendingSupplies
// either — both fall back to a real `new Date()` inside those libraries, even though the header
// comment of ozonCoverageSource.ts claims «no `new Date()` here». Pre-existing: HEAD's
// OzonStocksTab.tsx/Dashboard.tsx never passed `now` to buildOzonCoverage either, so this is not
// a regression from ticket 03, but the module's own purity claim does not hold. Fake timers pin
// the real clock to NOW so speed-window and pending-safety-window math lines up with the fixture
// dates below, the same way production works when `todayIso` happens to equal the real day.
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});
const TODAY_ISO = '2024-01-10';
// Полное окно скорости speedWeeks=4 — четыре недели, а не одна, иначе окно было бы 7 дней.
const SALES_WEEKS = ['2023-12-11', '2023-12-18', '2023-12-25', '2024-01-01'];

function makeSku(overrides: Partial<SKUItem> & { sku: string }): SKUItem {
  return {
    price: 0, minStock: 0, pcsPerBox: 1, boxesPerPallet: 1, volumeLiters: 0, leadTimeDays: 0,
    ...overrides
  };
}

function makeSettings(overrides: Partial<OzonCoverageSettings> = {}): OzonCoverageSettings {
  return {
    speedWeeks: 4, minStockDays: 7, targetStockDays: 20, maxClusterDays: 0,
    factoryOrderDays: 14, returnsToSalePct: 0, excludedClusters: '',
    ...overrides
  };
}

function stockRow(cabinet: string, offerId: string, available: number): OzonStockRow {
  return {
    cabinet, sku: offerId, offerId, name: offerId, warehouseName: 'W1', clusterName: 'Москва',
    clusterId: 'C1', available, preparing: 0, requested: 0, transit: 0, excess: 0, returns: 0,
    other: 0, updatedAt: ''
  };
}

/** qty split evenly over SALES_WEEKS: total qty / 28 days = qty/28 pcs/day. */
function salesRows(cabinet: string, offerId: string, totalQty: number): OzonSalesRow[] {
  return SALES_WEEKS.map((week) => ({
    week, cabinet, offerId, clusterName: 'Москва', qty: totalQty / SALES_WEEKS.length, updatedAt: '', days: 7
  }));
}

function historyRow(cabinet: string, offerId: string, week: string): OzonStockHistoryRow {
  return { week, cabinet, offerId, clusterId: 'C1', clusterName: 'Москва', daysInStock: 7, daysObserved: 7, lastDay: week, updatedAt: '' };
}

// ===== Fixtures: two cabinets (A, B), one own article each, one article shared by both,
// one kit whose component has no SKU card of its own, one external shipment (cabinet A),
// one supply request (cabinet B), two open factory orders (one per cabinet's own article). =====

const SKUS: SKUItem[] = [
  makeSku({ sku: 'ART-A', pcsPerBox: 1, leadTimeDays: 10 }),
  makeSku({ sku: 'ART-B', pcsPerBox: 1, leadTimeDays: 10 }),
  makeSku({ sku: 'ART-SHARED', pcsPerBox: 1, leadTimeDays: 10 }),
  makeSku({ sku: 'KIT-A', pcsPerBox: 1, leadTimeDays: 10 }),
  makeSku({ sku: 'COMP-CARD', pcsPerBox: 1, leadTimeDays: 10 })
  // COMP-NO-CARD deliberately has no SKU card — see check (f).
];

const KITS: KitItem[] = [
  {
    kitSku: 'KIT-A',
    type: 'virtual',
    components: [{ componentSku: 'COMP-CARD', quantity: 1 }, { componentSku: 'COMP-NO-CARD', quantity: 2 }]
  }
];

const STOCKS: OzonStockRow[] = [
  stockRow('A', 'ART-A', 100),
  stockRow('B', 'ART-B', 80),
  stockRow('A', 'ART-SHARED', 50),
  stockRow('B', 'ART-SHARED', 40),
  stockRow('A', 'KIT-A', 10)
];

const SALES: OzonSalesRow[] = [
  ...salesRows('A', 'ART-A', 28), // 1 pcs/day
  ...salesRows('B', 'ART-B', 28), // 1 pcs/day
  ...salesRows('A', 'ART-SHARED', 28), // 1 pcs/day
  ...salesRows('B', 'ART-SHARED', 56), // 2 pcs/day — deliberately different from cabinet A
  ...salesRows('A', 'KIT-A', 28),
  // Item 39, stage B: the speed denominator only counts weeks actually present in the data —
  // this one extra week (present only within the 13-week wide window, not the 4-week one) is
  // what makes the wide window's speed differ from the narrow one below.
  { week: '2023-11-06', cabinet: 'A', offerId: 'ART-A', clusterName: 'Москва', qty: 70, updatedAt: '', days: 7 }
];

const STOCK_HISTORY: OzonStockHistoryRow[] = [
  historyRow('A', 'ART-SHARED', '2024-01-01'),
  historyRow('B', 'ART-SHARED', '2024-01-01'),
  historyRow('B', 'ART-SHARED', '2023-12-25')
];

const SHIPMENTS: ExternalShipment[] = [
  {
    postingId: 'P-A1', detectedAt: '2024-01-09 10:00:00', shipmentDate: '2024-01-12', status: 'new',
    itemsJSON: JSON.stringify([{ offerId: 'ART-SHARED', barcode: '', quantity: 5 }]),
    transGroupInfo: '', orderId: 'ORD-A', orderNumber: 'ORD-A-1', ozonStatus: 'READY_TO_SUPPLY',
    cabinet: 'A', clusterId: 'C1'
  }
];

const REQUESTS: OzonSupplyRequestRow[] = [
  {
    id: 'SUP-B1', date: '2024-01-09 10:00:00', cabinet: 'B', draftId: 'D-B', orderId: 'ORD-B',
    dropOffName: 'ХАБ', clusters: 'C1',
    itemsJSON: JSON.stringify([{ article: 'ART-SHARED', clusterId: 'C1', qty: 8 }]),
    who: 'admin', status: 'Создана'
  }
];

const FACTORY_ORDERS: FactoryOrder[] = [
  { id: 'FO-A', article: 'ART-A', orderedAt: '2024-01-01', qty: 20, expectedAt: '2024-02-01', comment: '', user: '', status: 'active', receivedAt: '', source: '', chinaOrderNo: '', chinaBatchCode: '', chinaKey: '', checked: false },
  { id: 'FO-B', article: 'ART-B', orderedAt: '2024-01-01', qty: 15, expectedAt: '2024-02-01', comment: '', user: '', status: 'active', receivedAt: '', source: '', chinaOrderNo: '', chinaBatchCode: '', chinaKey: '', checked: false }
];

const AVAILABILITY: Record<string, number> = { 'ART-A': 60, 'ART-B': 45, 'ART-SHARED': 55, 'KIT-A': 3, 'COMP-CARD': 30, 'COMP-NO-CARD': 77 };

function makeData(overrides: Partial<CoverageStoreData> = {}): CoverageStoreData {
  return {
    ozonStocks: STOCKS,
    ozonSales: SALES,
    ozonStockHistory: STOCK_HISTORY,
    skus: SKUS,
    kits: KITS,
    clusterRefs: [{ clusterId: 'C1', clusterName: 'Москва' }, { clusterId: 'C2', clusterName: 'Питер' }],
    externalShipments: SHIPMENTS,
    ozonSupplyRequests: REQUESTS,
    factoryOrders: FACTORY_ORDERS,
    availabilityOf: (article: string) => AVAILABILITY[article] ?? 0,
    ...overrides
  };
}

const SETTINGS = makeSettings();

describe('buildCoverageSource + computeCoverage: dashboard vs tab agree on cabinet «all»', () => {
  it('dashboard-style call (all, waitForClusterRefs false) and tab-style call (all, waitForClusterRefs true, clusterRefsLoaded true) give deep-equal coverage', () => {
    const dashboardSource = buildCoverageSource(makeData(), { cabinet: 'all', todayIso: TODAY_ISO, waitForClusterRefs: false });
    const tabSource = buildCoverageSource(makeData(), { cabinet: 'all', todayIso: TODAY_ISO, waitForClusterRefs: true, clusterRefsLoaded: true });
    const dashboardResult = computeCoverage(dashboardSource, SETTINGS);
    const tabResult = computeCoverage(tabSource, SETTINGS);
    expect(dashboardResult).not.toBeNull();
    expect(dashboardResult).toEqual(tabResult);
  });
});

describe('buildCoverageSource: a cabinet choice filters stocks, sales, stock history and the supply reserve together', () => {
  it('filters stocks: cabinet A never sees the cabinet-B-only article', () => {
    const sourceA = buildCoverageSource(makeData(), { cabinet: 'A', todayIso: TODAY_ISO, waitForClusterRefs: false });
    expect(sourceA.stocks.some((s) => s.offerId === 'ART-B')).toBe(false);
    expect(sourceA.stocks.some((s) => s.offerId === 'ART-A')).toBe(true);
  });

  it('filters sales: the shared article gets cabinet A\'s own speed, not the blended one', () => {
    const sourceA = buildCoverageSource(makeData(), { cabinet: 'A', todayIso: TODAY_ISO, waitForClusterRefs: false });
    const resultA = computeCoverage(sourceA, SETTINGS)!;
    const sourceAll = buildCoverageSource(makeData(), { cabinet: 'all', todayIso: TODAY_ISO, waitForClusterRefs: false });
    const resultAll = computeCoverage(sourceAll, SETTINGS)!;
    const sharedA = resultA.articles.find((a) => a.article === 'ART-SHARED')!;
    const sharedAll = resultAll.articles.find((a) => a.article === 'ART-SHARED')!;
    // Cabinet A alone sells 1 pcs/day; cabinet B's extra 2 pcs/day must not leak into A's speed.
    expect(sharedA.perDay).toBe(1);
    expect(sharedAll.perDay).toBe(3);
  });

  it('filters stock history: cabinet A does not receive cabinet B\'s in-stock history rows', () => {
    const sourceA = buildCoverageSource(makeData(), { cabinet: 'A', todayIso: TODAY_ISO, waitForClusterRefs: false });
    const sourceB = buildCoverageSource(makeData(), { cabinet: 'B', todayIso: TODAY_ISO, waitForClusterRefs: false });
    expect(sourceA.stockHistory).toHaveLength(1);
    expect(sourceB.stockHistory).toHaveLength(2);
  });

  it('filters the supply reserve: a cabinet-B request no longer reduces cabinet A\'s need', () => {
    const sourceA = buildCoverageSource(makeData(), { cabinet: 'A', todayIso: TODAY_ISO, waitForClusterRefs: false });
    const sourceB = buildCoverageSource(makeData(), { cabinet: 'B', todayIso: TODAY_ISO, waitForClusterRefs: false });
    const sourceAll = buildCoverageSource(makeData(), { cabinet: 'all', todayIso: TODAY_ISO, waitForClusterRefs: false });
    // Cabinet A only sees its own shipment (5 pcs); cabinet B only sees its own request (8 pcs);
    // «all» sees both (13 pcs) — the same reserve numbers computeCoverage's pendingTotal shows.
    expect(sourceA.pending.byArticle['ART-SHARED']).toBe(5);
    expect(sourceB.pending.byArticle['ART-SHARED']).toBe(8);
    expect(sourceAll.pending.byArticle['ART-SHARED']).toBe(13);
    const resultA = computeCoverage(sourceA, SETTINGS)!;
    const sharedA = resultA.articles.find((a) => a.article === 'ART-SHARED')!;
    expect(sharedA.pendingTotal).toBe(5);
  });
});

describe('buildCoverageSource: open factory orders are not filtered by cabinet', () => {
  it('both cabinets\' open orders stay in the pipeline no matter which cabinet is selected', () => {
    const sourceA = buildCoverageSource(makeData(), { cabinet: 'A', todayIso: TODAY_ISO, waitForClusterRefs: false });
    const sourceB = buildCoverageSource(makeData(), { cabinet: 'B', todayIso: TODAY_ISO, waitForClusterRefs: false });
    // Cabinet A's stocks do not even carry ART-B, yet its factory pipeline still knows about it.
    expect(sourceA.openFactoryOrders.qty['ART-B']).toBe(15);
    expect(sourceB.openFactoryOrders.qty['ART-A']).toBe(20);
    expect(sourceA.openFactoryOrders.qty).toEqual(sourceB.openFactoryOrders.qty);
  });
});

describe('buildCoverageSource: the cluster-reference wait is a parameter, not a copy', () => {
  it('tab-style options (waitForClusterRefs true) with clusterRefsLoaded false give null', () => {
    const source = buildCoverageSource(makeData(), { cabinet: 'all', todayIso: TODAY_ISO, waitForClusterRefs: true, clusterRefsLoaded: false });
    expect(computeCoverage(source, SETTINGS)).toBeNull();
  });

  it('dashboard-style options (waitForClusterRefs false) give a result even without clusterRefsLoaded', () => {
    const source = buildCoverageSource(makeData(), { cabinet: 'all', todayIso: TODAY_ISO, waitForClusterRefs: false });
    expect(computeCoverage(source, SETTINGS)).not.toBeNull();
  });

  it('no stocks at all gives null regardless of waitForClusterRefs', () => {
    const source = buildCoverageSource(makeData({ ozonStocks: [] }), { cabinet: 'all', todayIso: TODAY_ISO, waitForClusterRefs: false });
    expect(computeCoverage(source, SETTINGS)).toBeNull();
  });
});

describe('buildCoverageSource: the wide window only changes speed-driven figures', () => {
  it('a settings change limited to speedWeeks changes perDay but keeps availability/reserve/factory inputs the same', () => {
    const source = buildCoverageSource(makeData(), { cabinet: 'A', todayIso: TODAY_ISO, waitForClusterRefs: false });
    const narrow = computeCoverage(source, SETTINGS)!;
    const wide = computeCoverage(source, { ...SETTINGS, speedWeeks: 13 })!;
    const narrowArt = narrow.articles.find((a) => a.article === 'ART-A')!;
    const wideArt = wide.articles.find((a) => a.article === 'ART-A')!;
    // No sales before the 4-week window in this fixture, so the wider window dilutes speed.
    expect(wideArt.perDay).not.toBe(narrowArt.perDay);
    // Same underlying source object — availability, reserve and open factory orders are untouched.
    expect(narrowArt.myStockAvailable).toBe(wideArt.myStockAvailable);
    expect(narrowArt.pendingTotal).toBe(wideArt.pendingTotal);
    expect(wideArt.freeMyStock).toBe(narrowArt.freeMyStock);
    expect(wideArt.factory?.onOrderQty).toBe(narrowArt.factory?.onOrderQty);
  });
});

describe('buildCoverageSource: availability includes kit components without their own SKU card', () => {
  it('a component present only inside a kit still gets its own availability figure', () => {
    const source = buildCoverageSource(makeData(), { cabinet: 'A', todayIso: TODAY_ISO, waitForClusterRefs: false });
    expect(SKUS.some((s) => s.sku === 'COMP-NO-CARD')).toBe(false);
    expect(source.myStockAvailability['COMP-NO-CARD']).toBe(77);
    const result = computeCoverage(source, SETTINGS)!;
    const component = result.components.find((c) => c.component === 'COMP-NO-CARD');
    expect(component).toBeDefined();
    expect(component!.myStockQty).toBe(77);
  });
});
