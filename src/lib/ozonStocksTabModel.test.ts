// Item 88, ticket 04. Drives `buildOzonStocksTabModel` through its public input/output only —
// what the owner would see on screen: pieces, boxes, days, flags. Fixtures follow the same style
// as ozonCoverageSource.test.ts (fake clock pinned so sales-speed math is deterministic).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildCoverageSource, computeCoverage, CoverageStoreData } from './ozonCoverageSource';
import { OzonCoverageSettings } from './ozonCoverage';
import { buildOzonStocksTabModel, OzonStocksTabModel, OzonStocksTabModelInput } from './ozonStocksTabModel';
import { useOzonStocksTabModel } from '../components/useOzonStocksTabModel';
import { ExternalShipment, FactoryOrder, KitItem, OzonSalesRow, OzonStockRow, SKUItem } from '../types';
import { OzonSupplyRequestRow } from './ozonPending';

const NOW = new Date('2024-01-10T10:00:00Z'); // среда; последняя полная неделя — 2024-01-01
const TODAY_ISO = '2024-01-10';
const SALES_WEEKS = ['2023-12-11', '2023-12-18', '2023-12-25', '2024-01-01'];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

function makeSku(overrides: Partial<SKUItem> & { sku: string }): SKUItem {
  return { price: 0, minStock: 0, pcsPerBox: 1, boxesPerPallet: 1, volumeLiters: 0, leadTimeDays: 0, ...overrides };
}

function makeSettings(overrides: Partial<OzonCoverageSettings> = {}): OzonCoverageSettings {
  return {
    speedWeeks: 4, minStockDays: 7, targetStockDays: 20, maxClusterDays: 0,
    factoryOrderDays: 14, returnsToSalePct: 0, excludedClusters: '',
    ...overrides
  };
}

function stockRow(cabinet: string, offerId: string, clusterId: string, clusterName: string, available: number): OzonStockRow {
  return {
    cabinet, sku: offerId, offerId, name: `Name-${offerId}`, warehouseName: 'W1', clusterName,
    clusterId, available, preparing: 0, requested: 0, transit: 0, excess: 0, returns: 0,
    other: 0, updatedAt: ''
  };
}

/** qty split evenly over SALES_WEEKS: total qty / 28 days = qty/28 pcs/day, in one cluster. */
function salesRows(cabinet: string, offerId: string, clusterName: string, totalQty: number): OzonSalesRow[] {
  return SALES_WEEKS.map((week) => ({
    week, cabinet, offerId, clusterName, qty: totalQty / SALES_WEEKS.length, updatedAt: '', days: 7
  }));
}

function factoryOrder(overrides: Partial<FactoryOrder> & { id: string; article: string }): FactoryOrder {
  return {
    orderedAt: '2024-01-01', qty: 0, expectedAt: '', comment: '', user: '', status: 'active',
    receivedAt: '', source: '', chinaOrderNo: '', chinaBatchCode: '', chinaKey: '', checked: false,
    ...overrides
  };
}

function makeData(overrides: Partial<CoverageStoreData> & { availability?: Record<string, number> } = {}): CoverageStoreData {
  const { availability, ...rest } = overrides;
  const availMap = availability || {};
  return {
    ozonStocks: [],
    ozonSales: [],
    ozonStockHistory: [],
    skus: [],
    kits: [],
    clusterRefs: [
      { clusterId: 'C1', clusterName: 'Москва' },
      { clusterId: 'C2', clusterName: 'Питер' }
    ],
    externalShipments: [],
    ozonSupplyRequests: [],
    factoryOrders: [],
    availabilityOf: (article: string) => availMap[article] ?? 0,
    ...rest
  };
}

function makeInput(
  data: CoverageStoreData,
  overrides: Partial<OzonStocksTabModelInput> = {},
  sourceOpts: { cabinet?: string } = {}
): OzonStocksTabModelInput {
  const source = buildCoverageSource(data, {
    cabinet: sourceOpts.cabinet || 'all', todayIso: TODAY_ISO, waitForClusterRefs: false
  });
  return {
    source,
    settings: makeSettings(),
    maxBoxesPerCluster: 30,
    factoryOrders: data.factoryOrders,
    kits: data.kits,
    wideArticles: {},
    selectedSupply: {},
    manualQty: {},
    searchQuery: '',
    onlyWithRecommendations: false,
    factoryModalArticle: null,
    todayIso: TODAY_ISO,
    ...overrides
  };
}

// ===== A: supply recommendations per cluster =====

describe('buildOzonStocksTabModel: supply recommendations, one cluster, unlimited «Мой склад»', () => {
  const data = makeData({
    skus: [makeSku({ sku: 'SUP-1', pcsPerBox: 10, leadTimeDays: 5 })],
    ozonStocks: [stockRow('A', 'SUP-1', 'C1', 'Москва', 0)],
    ozonSales: salesRows('A', 'SUP-1', 'Москва', 140), // 5 pcs/day
    availability: { 'SUP-1': 1000 }
  });

  it('gives pieces, whole boxes and a non-limited recommendation for the deficit cluster', () => {
    const model = buildOzonStocksTabModel(makeInput(data));
    const row = model.recommendations.supplies.find((s) => s.article === 'SUP-1')!;
    expect(row).toBeDefined();
    const cluster = row.clusters.find((c) => c.clusterId === 'C1')!;
    expect(cluster.recommendation).not.toBeNull();
    expect(cluster.recommendation!.qty).toBe(100); // perDay 5 * targetStockDays 20
    expect(cluster.recommendation!.boxes).toBe(10); // box of 10
    expect(cluster.recommendation!.limitedByMyStock).toBe(false);
    expect(cluster.needBoxes).toBe(10);
  });
});

describe('buildOzonStocksTabModel: «Мой склад» limit — partial allocation', () => {
  const data = makeData({
    skus: [makeSku({ sku: 'SUP-1', pcsPerBox: 10, leadTimeDays: 5 })],
    ozonStocks: [stockRow('A', 'SUP-1', 'C1', 'Москва', 0)],
    ozonSales: salesRows('A', 'SUP-1', 'Москва', 140), // 5 pcs/day, need 100 pcs
    availability: { 'SUP-1': 40 }
  });

  it('cuts the recommendation to what «Мой склад» actually has and flags limitedByMyStock', () => {
    const model = buildOzonStocksTabModel(makeInput(data));
    const row = model.recommendations.supplies.find((s) => s.article === 'SUP-1')!;
    const cluster = row.clusters.find((c) => c.clusterId === 'C1')!;
    expect(cluster.recommendation!.qty).toBe(40);
    expect(cluster.recommendation!.boxes).toBe(4);
    expect(cluster.recommendation!.limitedByMyStock).toBe(true);
  });
});

describe('buildOzonStocksTabModel: leftover — unallocated free stock the calc did not need', () => {
  const data = makeData({
    skus: [makeSku({ sku: 'SUP-1', pcsPerBox: 10, leadTimeDays: 5 })],
    ozonStocks: [stockRow('A', 'SUP-1', 'C1', 'Москва', 0)],
    ozonSales: salesRows('A', 'SUP-1', 'Москва', 140), // needs 100 pcs
    availability: { 'SUP-1': 150 } // 50 more than the cluster needs
  });

  it('reports the 50 unused pieces as leftover, not silently dropped', () => {
    const model = buildOzonStocksTabModel(makeInput(data));
    const row = model.recommendations.supplies.find((s) => s.article === 'SUP-1')!;
    expect(row.leftover).toBe(50);
  });
});

describe('buildOzonStocksTabModel: a deficit cluster — need but no free stock', () => {
  const data = makeData({
    skus: [makeSku({ sku: 'SUP-1', pcsPerBox: 10, leadTimeDays: 5 })],
    ozonStocks: [stockRow('A', 'SUP-1', 'C1', 'Москва', 0)],
    ozonSales: salesRows('A', 'SUP-1', 'Москва', 140),
    availability: { 'SUP-1': 0 }
  });

  it('is still listed in supplies, with 0 boxes, not dropped', () => {
    const model = buildOzonStocksTabModel(makeInput(data));
    const row = model.recommendations.supplies.find((s) => s.article === 'SUP-1')!;
    expect(row).toBeDefined();
    const cluster = row.clusters.find((c) => c.clusterId === 'C1')!;
    expect(cluster.recommendation!.boxes).toBe(0);
    expect(cluster.needQty).toBeGreaterThan(0);
  });
});

describe('buildOzonStocksTabModel: supplies are ordered by minCoverage, worst first', () => {
  const data = makeData({
    skus: [
      makeSku({ sku: 'SUP-LOW', pcsPerBox: 1, leadTimeDays: 5 }), // coverage -7
      makeSku({ sku: 'SUP-HIGH', pcsPerBox: 1, leadTimeDays: 5 }) // coverage 0
    ],
    ozonStocks: [
      stockRow('A', 'SUP-LOW', 'C1', 'Москва', 0),
      stockRow('A', 'SUP-HIGH', 'C1', 'Москва', 14)
    ],
    ozonSales: [
      ...salesRows('A', 'SUP-LOW', 'Москва', 56), // 2 pcs/day
      ...salesRows('A', 'SUP-HIGH', 'Москва', 56) // 2 pcs/day
    ],
    availability: { 'SUP-LOW': 1000, 'SUP-HIGH': 1000 }
  });

  it('the article with the lower (worse) minCoverage sorts first', () => {
    const model = buildOzonStocksTabModel(makeInput(data));
    const articles = model.recommendations.supplies.map((s) => s.article);
    expect(articles.indexOf('SUP-LOW')).toBeLessThan(articles.indexOf('SUP-HIGH'));
    const low = model.recommendations.supplies.find((s) => s.article === 'SUP-LOW')!;
    const high = model.recommendations.supplies.find((s) => s.article === 'SUP-HIGH')!;
    expect(low.minCoverage).toBeLessThan(high.minCoverage);
  });
});

describe('buildOzonStocksTabModel: maxClusterDays ceiling shrinks the recommendation', () => {
  const data = makeData({
    skus: [makeSku({ sku: 'SUP-1', pcsPerBox: 10, leadTimeDays: 5 })],
    ozonStocks: [stockRow('A', 'SUP-1', 'C1', 'Москва', 0)],
    ozonSales: salesRows('A', 'SUP-1', 'Москва', 84), // 3 pcs/day
    availability: { 'SUP-1': 1000 }
  });
  const uncappedSettings = makeSettings({ targetStockDays: 7, maxClusterDays: 0 });
  const cappedSettings = makeSettings({ targetStockDays: 7, maxClusterDays: 8 });

  it('a low ceiling gives a smaller need than no ceiling at all, same everything else', () => {
    const uncapped = buildOzonStocksTabModel(makeInput(data, { settings: uncappedSettings }));
    const capped = buildOzonStocksTabModel(makeInput(data, { settings: cappedSettings }));
    const uncappedCluster = uncapped.recommendations.supplies.find((s) => s.article === 'SUP-1')!.clusters[0];
    const cappedCluster = capped.recommendations.supplies.find((s) => s.article === 'SUP-1')!.clusters[0];
    expect(cappedCluster.needQty).toBeLessThan(uncappedCluster.needQty);
    expect(cappedCluster.needBoxes).toBe(Math.ceil(cappedCluster.needQty / 10));
  });
});

// ===== B: the «Фабрика» cell — each kind =====

describe('buildOzonStocksTabModel: «Фабрика» cell — overdue manual order', () => {
  const data = makeData({
    skus: [makeSku({ sku: 'FAC-1', pcsPerBox: 1, leadTimeDays: 5 })],
    ozonStocks: [stockRow('A', 'FAC-1', 'C1', 'Москва', 1000)],
    ozonSales: salesRows('A', 'FAC-1', 'Москва', 28),
    availability: { 'FAC-1': 1000 },
    factoryOrders: [factoryOrder({ id: 'O1', article: 'FAC-1', qty: 10, expectedAt: '2024-01-05', status: 'active' })]
  });

  it('a manual order whose expected date has passed is «overdue», not counted as waiting', () => {
    const model = buildOzonStocksTabModel(makeInput(data));
    const cell = model.factoryCellByArticle['FAC-1'];
    expect(cell.kind).toBe('overdue');
    expect(cell.overdueList.map((o) => o.id)).toEqual(['O1']);
    expect(cell.waitingQty).toBe(0);
  });
});

describe('buildOzonStocksTabModel: «Фабрика» cell — order needed', () => {
  const data = makeData({
    skus: [makeSku({ sku: 'FAC-1', pcsPerBox: 10, leadTimeDays: 5 })],
    ozonStocks: [stockRow('A', 'FAC-1', 'C1', 'Москва', 0)],
    ozonSales: salesRows('A', 'FAC-1', 'Москва', 280), // 10 pcs/day, threshold 5+7=12d => 120 pcs
    availability: { 'FAC-1': 0 }
  });

  it('pipeline below threshold gives orderQty > 0 and kind «order», in whole boxes', () => {
    const model = buildOzonStocksTabModel(makeInput(data));
    const cell = model.factoryCellByArticle['FAC-1'];
    expect(cell.kind).toBe('order');
    expect(cell.orderQty).toBeGreaterThan(0);
    expect(cell.orderQty % 10).toBe(0);
    const rec = model.recommendations.factories.find((f) => f.article === 'FAC-1');
    expect(rec).toBeDefined();
    expect(rec!.factory.orderQty).toBe(cell.orderQty);
  });
});

describe('buildOzonStocksTabModel: «Фабрика» cell — waiting order counted, no further order needed', () => {
  const data = makeData({
    skus: [makeSku({ sku: 'FAC-1', pcsPerBox: 1, leadTimeDays: 5 })],
    ozonStocks: [stockRow('A', 'FAC-1', 'C1', 'Москва', 0)],
    ozonSales: salesRows('A', 'FAC-1', 'Москва', 28), // 1 pcs/day, threshold 5+7=12 pcs
    availability: { 'FAC-1': 20 }, // exactly funds the one cluster's need — no cluster deficit
    factoryOrders: [factoryOrder({ id: 'O1', article: 'FAC-1', qty: 50, expectedAt: '2024-02-01', status: 'active' })]
  });

  it('an order already in the pipeline covers the threshold: kind «waiting», orderQty 0', () => {
    const model = buildOzonStocksTabModel(makeInput(data));
    const cell = model.factoryCellByArticle['FAC-1'];
    expect(cell.kind).toBe('waiting');
    expect(cell.waitingQty).toBe(50);
    expect(cell.orderQty).toBe(0);
  });
});

describe('buildOzonStocksTabModel: «Фабрика» cell — cluster deficit, with and without a waiting order', () => {
  // Two clusters: C1 has plenty of stock (pipeline healthy overall), C2 has none — the article
  // needs no MORE factory order, but C2 itself cannot be supplied from anywhere.
  const baseData = (factoryOrders: FactoryOrder[]) => makeData({
    skus: [makeSku({ sku: 'FAC-1', pcsPerBox: 1, leadTimeDays: 0 })],
    ozonStocks: [
      stockRow('A', 'FAC-1', 'C1', 'Москва', 1000),
      stockRow('A', 'FAC-1', 'C2', 'Питер', 0)
    ],
    ozonSales: [
      ...salesRows('A', 'FAC-1', 'Москва', 28),
      ...salesRows('A', 'FAC-1', 'Питер', 28)
    ],
    availability: { 'FAC-1': 0 }, // nothing free to send to C2
    factoryOrders
  });

  it('clusterDeficit — no waiting order for the article', () => {
    const model = buildOzonStocksTabModel(makeInput(baseData([])));
    const cell = model.factoryCellByArticle['FAC-1'];
    expect(cell.kind).toBe('clusterDeficit');
    expect(cell.clusterOnly).toBe(true);
    expect(cell.waitingQty).toBe(0);
  });

  it('clusterDeficitWaiting — same deficit, but a waiting order also exists', () => {
    const orders = [factoryOrder({ id: 'O1', article: 'FAC-1', qty: 5, expectedAt: '2024-02-01', status: 'active' })];
    const model = buildOzonStocksTabModel(makeInput(baseData(orders)));
    const cell = model.factoryCellByArticle['FAC-1'];
    expect(cell.kind).toBe('clusterDeficitWaiting');
    expect(cell.waitingQty).toBe(5);
  });
});

describe('buildOzonStocksTabModel: «Фабрика» cell — kit bottleneck', () => {
  const data = makeData({
    skus: [
      makeSku({ sku: 'KIT-1', pcsPerBox: 1, leadTimeDays: 5 }),
      makeSku({ sku: 'COMP-1', pcsPerBox: 1, leadTimeDays: 5 })
    ],
    kits: [{ kitSku: 'KIT-1', type: 'virtual', components: [{ componentSku: 'COMP-1', quantity: 1 }] }],
    ozonStocks: [stockRow('A', 'KIT-1', 'C1', 'Москва', 1000)],
    ozonSales: salesRows('A', 'KIT-1', 'Москва', 28),
    availability: { 'KIT-1': 1000, 'COMP-1': 0 } // no bottles at all: the kit cannot be assembled
  });

  it('a component out of stock makes the kit article a «bottleneck» in its Фабрика cell', () => {
    const model = buildOzonStocksTabModel(makeInput(data));
    expect(Object.keys(model.bottleneckByKit)).toContain('KIT-1');
    const cell = model.factoryCellByArticle['KIT-1'];
    expect(cell.kind).toBe('bottleneck');
  });
});

describe('buildOzonStocksTabModel: «Фабрика» cell — no lead time / not needed', () => {
  const data = makeData({
    skus: [
      makeSku({ sku: 'FAC-NOLEAD', pcsPerBox: 1, leadTimeDays: 0 }),
      makeSku({ sku: 'FAC-OK', pcsPerBox: 1, leadTimeDays: 5 })
    ],
    ozonStocks: [
      stockRow('A', 'FAC-NOLEAD', 'C1', 'Москва', 1000),
      stockRow('A', 'FAC-OK', 'C1', 'Москва', 1000)
    ],
    ozonSales: [
      ...salesRows('A', 'FAC-NOLEAD', 'Москва', 28),
      ...salesRows('A', 'FAC-OK', 'Москва', 28)
    ],
    availability: { 'FAC-NOLEAD': 1000, 'FAC-OK': 1000 }
  });

  it('healthy pipeline, leadTimeDays 0 — «noLeadTime»; leadTimeDays > 0 — «notNeeded»', () => {
    const model = buildOzonStocksTabModel(makeInput(data));
    expect(model.factoryCellByArticle['FAC-NOLEAD'].kind).toBe('noLeadTime');
    expect(model.factoryCellByArticle['FAC-OK'].kind).toBe('notNeeded');
  });
});

describe('buildOzonStocksTabModel: a manual order hidden by a China row of the same article', () => {
  const data = makeData({
    skus: [makeSku({ sku: 'FAC-1', pcsPerBox: 1, leadTimeDays: 5 })],
    ozonStocks: [stockRow('A', 'FAC-1', 'C1', 'Москва', 0)],
    ozonSales: salesRows('A', 'FAC-1', 'Москва', 28),
    availability: { 'FAC-1': 0 },
    factoryOrders: [
      factoryOrder({ id: 'MANUAL', article: 'FAC-1', qty: 30, orderedAt: '2024-01-01', expectedAt: '2024-02-01', status: 'active', source: '' }),
      factoryOrder({ id: 'CHINA', article: 'FAC-1', qty: 30, orderedAt: '2024-01-02', expectedAt: '2024-02-05', status: 'active', source: 'Китай' })
    ]
  });

  it('the manual order is excluded from waiting qty and listed in hiddenManual', () => {
    const model = buildOzonStocksTabModel(makeInput(data));
    const cell = model.factoryCellByArticle['FAC-1'];
    expect(cell.waitingList.map((o) => o.id)).toEqual(['CHINA']);
    expect(cell.waitingQty).toBe(30);
    expect(cell.hiddenManual.map((o) => o.id)).toEqual(['MANUAL']);
    expect(model.hiddenManualIds.has('MANUAL')).toBe(true);
  });
});

describe('buildOzonStocksTabModel: recommendations.factories lists exactly the articles needing a new order', () => {
  const data = makeData({
    skus: [
      makeSku({ sku: 'FAC-NEED', pcsPerBox: 1, leadTimeDays: 5 }),
      makeSku({ sku: 'FAC-OK', pcsPerBox: 1, leadTimeDays: 5 })
    ],
    ozonStocks: [
      stockRow('A', 'FAC-NEED', 'C1', 'Москва', 0),
      stockRow('A', 'FAC-OK', 'C1', 'Москва', 1000)
    ],
    ozonSales: [
      ...salesRows('A', 'FAC-NEED', 'Москва', 28),
      ...salesRows('A', 'FAC-OK', 'Москва', 28)
    ],
    availability: { 'FAC-NEED': 0, 'FAC-OK': 1000 }
  });

  it('only FAC-NEED (orderQty > 0) is listed, FAC-OK (healthy) is not', () => {
    const model = buildOzonStocksTabModel(makeInput(data));
    const articles = model.recommendations.factories.map((f) => f.article);
    expect(articles).toEqual(['FAC-NEED']);
  });
});

// ===== C: supply plan equals exactly the ticked recommendations =====

describe('buildOzonStocksTabModel: the supply plan mirrors the ticks exactly', () => {
  const data = makeData({
    skus: [
      makeSku({ sku: 'SUP-A', pcsPerBox: 10, leadTimeDays: 5 }),
      makeSku({ sku: 'SUP-B', pcsPerBox: 10, leadTimeDays: 5 })
    ],
    ozonStocks: [
      stockRow('A', 'SUP-A', 'C1', 'Москва', 0),
      stockRow('A', 'SUP-B', 'C1', 'Москва', 0)
    ],
    ozonSales: [
      ...salesRows('A', 'SUP-A', 'Москва', 140), // needs 100 pcs / 10 boxes
      ...salesRows('A', 'SUP-B', 'Москва', 140)
    ],
    availability: { 'SUP-A': 1000, 'SUP-B': 1000 }
  });

  it('a ticked cluster enters the plan with its own boxes/qty and cabinet', () => {
    const model = buildOzonStocksTabModel(makeInput(data, { selectedSupply: { 'SUP-A|||C1': true } }));
    expect(model.supplyPlan.rows).toHaveLength(1);
    expect(model.supplyPlan.rows[0]).toMatchObject({ article: 'SUP-A', clusterId: 'C1', boxes: 10, qty: 100 });
    expect(model.supplyPlan.totalBoxes).toBe(10);
    expect(model.supplyPlan.totalQty).toBe(100);
    expect(model.supplyPlan.cabinets).toEqual(['A']);
    expect(model.supplyPlan.clusters).toEqual([{ clusterId: 'C1', clusterName: 'Москва', boxes: 10 }]);
  });

  it('an unticked cluster never enters the plan', () => {
    const model = buildOzonStocksTabModel(makeInput(data, { selectedSupply: { 'SUP-A|||C1': false } }));
    expect(model.supplyPlan.rows).toHaveLength(0);
  });

  it('overLimit flags a cluster whose ticked boxes exceed maxBoxesPerCluster', () => {
    const model = buildOzonStocksTabModel(makeInput(data, {
      selectedSupply: { 'SUP-A|||C1': true, 'SUP-B|||C1': true },
      maxBoxesPerCluster: 15
    }));
    expect(model.supplyPlan.totalBoxes).toBe(20); // 10 + 10 boxes, both article SUP-A and SUP-B
    expect(model.supplyPlan.overLimit).toEqual([{ clusterId: 'C1', clusterName: 'Москва', boxes: 20 }]);
  });
});

describe('buildOzonStocksTabModel: a wide-window cluster can be ticked and appears in the plan', () => {
  // All of SUP-WIDE's sales sit in one week that is OUTSIDE the narrow 4-week speed window but
  // INSIDE the 13-week wide one: the narrow build gives perDay 0 (no recommendation at all, the
  // article does not even reach `recommendations.supplies`), the wide build has real speed and a
  // real per-cluster recommendation — exactly the owner's story («отметил восемь, в окне
  // оказалось четыре»): a cluster reachable ONLY through the wide window must still be tickable.
  const data = makeData({
    skus: [makeSku({ sku: 'SUP-WIDE', pcsPerBox: 1, leadTimeDays: 5 })],
    ozonStocks: [stockRow('A', 'SUP-WIDE', 'C1', 'Москва', 0)],
    ozonSales: [
      { week: '2023-11-06', cabinet: 'A', offerId: 'SUP-WIDE', clusterName: 'Москва', qty: 28, updatedAt: '', days: 7 }
    ],
    availability: { 'SUP-WIDE': 1000 }
  });

  it('narrow window has no recommendation for the article at all; wide does; ticking the wide cluster reaches the plan', () => {
    const narrowModel = buildOzonStocksTabModel(makeInput(data));
    expect(narrowModel.recommendations.supplies.some((s) => s.article === 'SUP-WIDE')).toBe(false);

    const wideModel = buildOzonStocksTabModel(makeInput(data, {
      wideArticles: { 'SUP-WIDE': true },
      selectedSupply: { 'SUP-WIDE|||C1': true }
    }));
    const wideRow = wideModel.recommendations.supplies.find((s) => s.article === 'SUP-WIDE')!;
    expect(wideRow).toBeDefined();
    expect(wideRow.wide).toBe(true);
    expect(wideRow.clusters.some((c) => c.clusterId === 'C1')).toBe(true);
    expect(wideModel.supplyPlan.rows.some((r) => r.article === 'SUP-WIDE' && r.clusterId === 'C1')).toBe(true);
  });
});

// ===== D: cabinet filtering =====

describe('buildOzonStocksTabModel: cabinet filtering', () => {
  const data = makeData({
    skus: [makeSku({ sku: 'ART-A', pcsPerBox: 1 }), makeSku({ sku: 'ART-B', pcsPerBox: 1 })],
    ozonStocks: [
      stockRow('A', 'ART-A', 'C1', 'Москва', 10),
      stockRow('B', 'ART-B', 'C1', 'Москва', 10)
    ],
    ozonSales: [...salesRows('A', 'ART-A', 'Москва', 28), ...salesRows('B', 'ART-B', 'Москва', 28)],
    availability: { 'ART-A': 100, 'ART-B': 100 }
  });

  it('a model built for cabinet A shows only A\'s rows, not B\'s', () => {
    const model = buildOzonStocksTabModel(makeInput(data, {}, { cabinet: 'A' }));
    const articles = model.coverageRows.map((r) => r.article);
    expect(articles).toContain('ART-A');
    expect(articles).not.toContain('ART-B');
  });
});

// ===== E: visible rows =====

describe('buildOzonStocksTabModel: visible rows — search and «only with recommendations»', () => {
  const data = makeData({
    skus: [makeSku({ sku: 'FIND-ME', pcsPerBox: 1 }), makeSku({ sku: 'OTHER', pcsPerBox: 1 })],
    ozonStocks: [
      stockRow('A', 'FIND-ME', 'C1', 'Москва', 0),
      stockRow('A', 'OTHER', 'C1', 'Москва', 1000)
    ],
    ozonSales: [...salesRows('A', 'FIND-ME', 'Москва', 28), ...salesRows('A', 'OTHER', 'Москва', 28)],
    availability: { 'FIND-ME': 1000, 'OTHER': 1000 }
  });

  it('search by article filters to the matching row only', () => {
    const model = buildOzonStocksTabModel(makeInput(data, { searchQuery: 'find-me' }));
    expect(model.visibleRows.map((r) => r.article)).toEqual(['FIND-ME']);
  });

  it('search by name (case-insensitive substring) also matches', () => {
    const model = buildOzonStocksTabModel(makeInput(data, { searchQuery: 'name-find' }));
    expect(model.visibleRows.map((r) => r.article)).toEqual(['FIND-ME']);
  });

  it('«only with recommendations» drops the healthy article, keeps the deficit one', () => {
    const model = buildOzonStocksTabModel(makeInput(data, { onlyWithRecommendations: true }));
    expect(model.visibleRows.map((r) => r.article)).toEqual(['FIND-ME']);
  });
});

// ===== F: component rows sorted by speed; cluster shares sum to 100% =====

describe('buildOzonStocksTabModel: component rows sorted by speed, cluster shares sum to 100%', () => {
  const data = makeData({
    skus: [
      makeSku({ sku: 'KIT-1', pcsPerBox: 1, leadTimeDays: 5 }),
      makeSku({ sku: 'COMP-SLOW', pcsPerBox: 1, leadTimeDays: 5 }),
      makeSku({ sku: 'COMP-FAST', pcsPerBox: 1, leadTimeDays: 5 })
    ],
    kits: [{
      kitSku: 'KIT-1', type: 'virtual',
      components: [{ componentSku: 'COMP-SLOW', quantity: 1 }, { componentSku: 'COMP-FAST', quantity: 1 }]
    }],
    ozonStocks: [
      stockRow('A', 'KIT-1', 'C1', 'Москва', 1000),
      stockRow('A', 'KIT-1', 'C2', 'Питер', 1000)
    ],
    ozonSales: [
      ...salesRows('A', 'KIT-1', 'Москва', 28), // 1 pcs/day
      ...salesRows('A', 'KIT-1', 'Питер', 84) // 3 pcs/day — a faster cluster than Москва
    ],
    availability: { 'KIT-1': 1000, 'COMP-SLOW': 1000, 'COMP-FAST': 1000 }
  });

  it('components sort by perDay, fastest first', () => {
    const model = buildOzonStocksTabModel(makeInput(data));
    expect(model.componentRows.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < model.componentRows.length; i++) {
      expect(model.componentRows[i - 1].perDay).toBeGreaterThanOrEqual(model.componentRows[i].perDay);
    }
  });

  it('cluster shares add up to 100% across clusters carrying sales', () => {
    const model = buildOzonStocksTabModel(makeInput(data));
    const total = model.clusterShares.list.reduce((s, c) => s + c.pct, 0);
    expect(total).toBeCloseTo(100, 6);
  });
});

// ===== G: today's date flips a manual order between waiting and overdue =====

describe('buildOzonStocksTabModel: todayIso is an input — same orders, different outcome', () => {
  const data = makeData({
    skus: [makeSku({ sku: 'FAC-1', pcsPerBox: 1, leadTimeDays: 5 })],
    ozonStocks: [stockRow('A', 'FAC-1', 'C1', 'Москва', 0)],
    ozonSales: salesRows('A', 'FAC-1', 'Москва', 28),
    availability: { 'FAC-1': 0 },
    factoryOrders: [factoryOrder({ id: 'O1', article: 'FAC-1', qty: 10, expectedAt: '2024-01-15', status: 'active' })]
  });

  it('before the expected date the order is waiting; after, it is overdue', () => {
    const before = buildOzonStocksTabModel(makeInput(data, { todayIso: '2024-01-10' }));
    const after = buildOzonStocksTabModel(makeInput(data, { todayIso: '2024-01-20' }));
    expect(before.factoryCellByArticle['FAC-1'].kind).not.toBe('overdue');
    expect(before.factoryCellByArticle['FAC-1'].waitingQty).toBe(10);
    expect(after.factoryCellByArticle['FAC-1'].kind).toBe('overdue');
    expect(after.factoryCellByArticle['FAC-1'].overdueQty).toBe(10);
  });
});

// ===== Hook <-> model parity: the screen must compute exactly what the model computes =====

describe('useOzonStocksTabModel: parity with buildOzonStocksTabModel for the same inputs', () => {
  const data = makeData({
    skus: [
      makeSku({ sku: 'SUP-A', pcsPerBox: 10, leadTimeDays: 5 }),
      makeSku({ sku: 'FAC-1', pcsPerBox: 1, leadTimeDays: 5 })
    ],
    ozonStocks: [
      stockRow('A', 'SUP-A', 'C1', 'Москва', 0),
      stockRow('A', 'FAC-1', 'C1', 'Москва', 0)
    ],
    ozonSales: [
      ...salesRows('A', 'SUP-A', 'Москва', 140),
      ...salesRows('A', 'FAC-1', 'Москва', 28)
    ],
    availability: { 'SUP-A': 1000, 'FAC-1': 0 },
    factoryOrders: [factoryOrder({ id: 'O1', article: 'FAC-1', qty: 10, expectedAt: '2024-01-05', status: 'active' })]
  });

  it('coverage rows, recommendations, supply plan, factory cells, visible rows and shares are deep-equal', () => {
    const source = buildCoverageSource(data, { cabinet: 'all', todayIso: TODAY_ISO, waitForClusterRefs: false });
    const settings = makeSettings();
    const selectedSupply = { 'SUP-A|||C1': true };

    const model = buildOzonStocksTabModel({
      source, settings, maxBoxesPerCluster: 30, factoryOrders: data.factoryOrders, kits: data.kits,
      wideArticles: {}, selectedSupply, manualQty: {}, searchQuery: '', onlyWithRecommendations: false,
      factoryModalArticle: null, todayIso: TODAY_ISO
    });

    let captured: OzonStocksTabModel | null = null;
    function Probe() {
      captured = useOzonStocksTabModel({
        coverageSource: source,
        ozonSettings: settings,
        runCoverage: (s) => computeCoverage(source, s),
        skus: source.skus,
        clusterRefs: source.clusters,
        factoryOrders: data.factoryOrders,
        wideArticles: {},
        selectedSupply,
        manualQty: {},
        searchQuery: '',
        onlyWithRecommendations: false,
        factoryModalArticle: null,
        maxBoxesPerCluster: 30,
        todayIso: TODAY_ISO
      });
      return null;
    }
    renderToStaticMarkup(createElement(Probe));
    expect(captured).not.toBeNull();
    const hookModel = captured as unknown as OzonStocksTabModel;

    expect(hookModel.coverageRows).toEqual(model.coverageRows);
    expect(hookModel.recommendations).toEqual(model.recommendations);
    expect(hookModel.supplyPlan).toEqual(model.supplyPlan);
    expect(hookModel.factoryCellByArticle).toEqual(model.factoryCellByArticle);
    expect(hookModel.factoryCellByComponent).toEqual(model.factoryCellByComponent);
    expect(hookModel.visibleRows).toEqual(model.visibleRows);
    expect(hookModel.clusterShares).toEqual(model.clusterShares);
  });
});
