import { describe, expect, it } from 'vitest';
import { createRequire } from 'module';
import { buildOzonCoverage, type OzonCoverageInput, type OzonCoverageSettings } from './ozonCoverage';
import { buildPendingSupplies, type OzonSupplyRequestRow } from './ozonPending';
import type { ExternalShipment, KitItem, OzonSalesRow, OzonStockRow, SKUItem } from '../types';

/**
 * Independent adversarial review of item 85, stage 1 (audit request 2026-09-26). Every check
 * here targets a state combination or interaction NOT already exercised by ozonInFlight,
 * ozonPendingInFlight, ozonSharedComponents, ozonCoverageTone, ozonFactoryForecast,
 * ozonStockRow and supplyReserveParity.
 */

const NOW = new Date('2026-09-16T09:00:00Z');
const WEEKS = ['2026-08-17', '2026-08-24', '2026-08-31', '2026-09-07'];
const sku = (over: Partial<SKUItem> & { sku: string }): SKUItem => ({
  price: 0, minStock: 0, pcsPerBox: 1, boxesPerPallet: 0, volumeLiters: 0, leadTimeDays: 0, ...over
});
const emptyStock = (article: string, clusterId = 'C1'): OzonStockRow => ({
  cabinet: 'M', sku: '', offerId: article, name: article, warehouseName: 'W', clusterName: 'Москва', clusterId,
  available: 0, preparing: 0, requested: 0, transit: 0, excess: 0, returns: 0, other: 0, updatedAt: ''
});
const sales = (article: string, perDay: number, clusterId = 'C1'): OzonSalesRow[] =>
  WEEKS.map((week) => ({ week, cabinet: 'M', offerId: article, clusterName: 'Москва', qty: perDay * 7, updatedAt: '', days: 7 }));

const BASE_SETTINGS: OzonCoverageSettings = {
  speedWeeks: 4, minStockDays: 7, targetStockDays: 20, maxClusterDays: 0, factoryOrderDays: 14,
  returnsToSalePct: 0, excludedClusters: '', deficitDays: 0, demandGrowthPct: 0
};

// ===== 1. A component sold directly on Ozon AND used in a kit: the same physical stock is =====
// ===== handed out as a full buffer to TWO independent factory pipelines at once. =====
describe('Item 85 audit: a shared component sold on its own hides a real combined shortfall', () => {
  it.fails('«Бутылки» is sold by itself (1 pc/day) AND used in kit GRAY (1 kit/day, norm 1) off the same 10 pcs on the shelf: real combined demand is 2/day, 5 days of cover, below the 7-day minimum — some pipeline should recommend an order', () => {
    const KITS: KitItem[] = [{ kitSku: 'GRAY', type: 'virtual', components: [{ componentSku: 'Бутылки', quantity: 1 }] }];
    const SKUS = ['GRAY', 'Бутылки'].map((s) => sku({ sku: s }));
    const res = buildOzonCoverage({
      stocks: [emptyStock('GRAY'), emptyStock('Бутылки')],
      sales: [...sales('GRAY', 1), ...sales('Бутылки', 1)],
      skus: SKUS,
      clusters: [{ clusterId: 'C1', clusterName: 'Москва' }],
      settings: BASE_SETTINGS,
      myStockAvailability: { 'Бутылки': 10 },
      kits: KITS,
      now: NOW
    });

    const bottlesDirect = res.articles.find((a) => a.article === 'Бутылки')!;
    const bottlesAsComponent = res.components.find((c) => c.component === 'Бутылки')!;

    // Each pipeline sees the FULL 10 pcs as its own free buffer and reports 10 days of cover —
    // the true combined cover (10 pcs / 2 pcs per day) is only 5 days, under the 7-day minimum.
    // Neither pipeline knows about the other's draw on the same physical stock.
    const totalOrderQty = (bottlesDirect.factory ? bottlesDirect.factory.orderQty : 0) + (bottlesAsComponent.factory ? bottlesAsComponent.factory.orderQty : 0);
    expect(totalOrderQty).toBeGreaterThan(0);
  });

  it('documents the mechanism: both pipelines report the SAME 10-day cover from the same 10 pcs, each ignorant of the other\'s 1 pc/day draw', () => {
    const KITS: KitItem[] = [{ kitSku: 'GRAY', type: 'virtual', components: [{ componentSku: 'Бутылки', quantity: 1 }] }];
    const SKUS = ['GRAY', 'Бутылки'].map((s) => sku({ sku: s }));
    const res = buildOzonCoverage({
      stocks: [emptyStock('GRAY'), emptyStock('Бутылки')],
      sales: [...sales('GRAY', 1), ...sales('Бутылки', 1)],
      skus: SKUS,
      clusters: [{ clusterId: 'C1', clusterName: 'Москва' }],
      settings: BASE_SETTINGS,
      myStockAvailability: { 'Бутылки': 10 },
      kits: KITS,
      now: NOW
    });
    const bottlesDirect = res.articles.find((a) => a.article === 'Бутылки')!;
    const bottlesAsComponent = res.components.find((c) => c.component === 'Бутылки')!;
    expect(bottlesDirect.factory!.daysLeft).toBe(10);
    expect(bottlesAsComponent.factory!.daysLeft).toBe(10);
    // the true combined cover, computed by hand: 10 pcs / (1 + 1) pcs per day
    expect(10 / (1 + 1)).toBe(5);
  });
});

// ===== 2. Allocation loop (item 85, step 1.6): fairness and the never-exceed-budget bound =====
// ===== under a harder shape than the existing suite (many claimants on one scarce component). =====
describe('Item 85 audit: the shared-component allocation loop under many claimants', () => {
  it('6 kits share one scarce component (30 pcs, combined need 120): never hands out more than the shelf, and every kit with equal need gets an equal share', () => {
    const kits: KitItem[] = Array.from({ length: 6 }, (_, i) => ({
      kitSku: `K${i}`, type: 'virtual' as const, components: [{ componentSku: 'Shared', quantity: 1 }]
    }));
    const SKUS = [...kits.map((k) => sku({ sku: k.kitSku })), sku({ sku: 'Shared' })];
    const res = buildOzonCoverage({
      stocks: kits.map((k) => emptyStock(k.kitSku)),
      sales: kits.flatMap((k) => sales(k.kitSku, 1)),
      skus: SKUS,
      clusters: [{ clusterId: 'C1', clusterName: 'Москва' }],
      settings: BASE_SETTINGS,
      myStockAvailability: { Shared: 30 },
      kits,
      now: NOW
    });
    let used = 0;
    const qtyByKit: number[] = [];
    for (const k of kits) {
      const art = res.articles.find((a) => a.article === k.kitSku)!;
      const qty = art.clusters.reduce((s, c) => s + (c.recommendation ? c.recommendation.qty : 0), 0);
      qtyByKit.push(qty);
      used += qty;
    }
    expect(used).toBeLessThanOrEqual(30);
    // identical need (same speed, same norm) → an even split, never off by more than 1 pc
    expect(Math.max(...qtyByKit) - Math.min(...qtyByKit)).toBeLessThanOrEqual(1);
  });

  it('a tie at the bottleneck: two components equally limiting a kit both carry the unmet deficit (documented «ничья» rule)', () => {
    const KITS: KitItem[] = [{ kitSku: 'TIE', type: 'virtual', components: [{ componentSku: 'X', quantity: 1 }, { componentSku: 'Y', quantity: 1 }] }];
    const SKUS = ['TIE', 'X', 'Y'].map((s) => sku({ sku: s }));
    const res = buildOzonCoverage({
      stocks: [emptyStock('TIE')],
      sales: sales('TIE', 5),
      skus: SKUS,
      clusters: [{ clusterId: 'C1', clusterName: 'Москва' }],
      settings: BASE_SETTINGS,
      myStockAvailability: { X: 3, Y: 3 }, // both cap assembly at exactly 3, a genuine tie
      kits: KITS,
      now: NOW
    });
    const bottleneck = res.bottlenecks.find((b) => b.kitSku === 'TIE')!;
    expect(bottleneck.canAssembleQty).toBe(3);
    // TIE's cluster wants 5×20=100 pcs, so both X and Y are held short of it — the unmet
    // deficit must reach BOTH tied components, not an arbitrarily chosen single one.
    const x = res.components.find((c) => c.component === 'X')!;
    const y = res.components.find((c) => c.component === 'Y')!;
    expect(x.factory && x.factory.unmetDeficitQty).toBeGreaterThan(0);
    expect(y.factory && y.factory.unmetDeficitQty).toBeGreaterThan(0);
  });

  it('an excluded cluster never adds its want to a shared component\'s claim (recommendation is null there)', () => {
    const KITS: KitItem[] = [
      { kitSku: 'GRAY', type: 'virtual', components: [{ componentSku: 'Бутылки', quantity: 1 }] },
      { kitSku: 'BLUE', type: 'virtual', components: [{ componentSku: 'Бутылки', quantity: 1 }] }
    ];
    const SKUS = ['GRAY', 'BLUE', 'Бутылки'].map((s) => sku({ sku: s }));
    const stockIn = (article: string, clusterId: string, clusterName: string): OzonStockRow => ({
      ...emptyStock(article, clusterId), clusterName
    });
    const salesIn = (article: string, perDay: number, clusterName: string): OzonSalesRow[] =>
      WEEKS.map((week) => ({ week, cabinet: 'M', offerId: article, clusterName, qty: perDay * 7, updatedAt: '', days: 7 }));
    const res = buildOzonCoverage({
      stocks: [stockIn('GRAY', 'EXCL', 'Беларусь'), stockIn('BLUE', 'C1', 'Москва')],
      sales: [...salesIn('GRAY', 5, 'Беларусь'), ...salesIn('BLUE', 1, 'Москва')],
      skus: SKUS,
      clusters: [{ clusterId: 'C1', clusterName: 'Москва' }, { clusterId: 'EXCL', clusterName: 'Беларусь' }],
      settings: { ...BASE_SETTINGS, excludedClusters: 'EXCL' },
      myStockAvailability: { 'Бутылки': 20 },
      kits: KITS,
      now: NOW
    });
    const gray = res.articles.find((a) => a.article === 'GRAY')!;
    const blue = res.articles.find((a) => a.article === 'BLUE')!;
    // GRAY's only cluster is excluded → no recommendation → no claim on the shared 20 pcs.
    expect(gray.clusters.every((c) => c.recommendation === null)).toBe(true);
    expect(blue.sharedLimitedBy).toEqual([]);
    expect(blue.clusters[0].recommendation?.qty).toBe(20); // 20 days × 1 pc/day, none held back by GRAY
  });
});

// ===== 3. Server parity (item 85, step 1.5) on edge inputs not in supplyReserveParity.test.ts =====
describe('Item 85 audit: TS/GS reserve parity on malformed and mixed-case inputs', () => {
  const require = createRequire(import.meta.url);
  const freshStand = () => {
    const p = require.resolve('../../tests/apps-script/harness.cjs');
    delete require.cache[p];
    return require('../../tests/apps-script/harness.cjs');
  };
  const SKUS: SKUItem[] = [sku({ sku: 'A', pcsPerBox: 1 })];
  const sh = (over: Partial<ExternalShipment> & { items?: unknown[] }): ExternalShipment => {
    const { items, ...rest } = over;
    return {
      postingId: 'P', detectedAt: '', shipmentDate: '', status: 'new', itemsJSON: JSON.stringify(items || []),
      transGroupInfo: '', orderId: '', orderNumber: '', ozonStatus: 'READY_TO_SUPPLY', cabinet: 'M', clusterId: '1', isVirtual: false,
      ...rest
    };
  };
  function both(shipments: ExternalShipment[], requests: OzonSupplyRequestRow[]) {
    const stand = freshStand();
    const ts = buildPendingSupplies({ shipments, requests, skus: SKUS, now: NOW }).byArticle;
    const gs = stand.context.supplyReservesByArticle(shipments, requests, SKUS, NOW.getTime());
    return { ts, gs: JSON.parse(JSON.stringify(gs)) };
  }

  it('a garbage detectedAt string ("not-a-date") with an unknown Ozon status: neither side reserves', () => {
    const { ts, gs } = both([sh({ ozonStatus: 'weird', detectedAt: 'not-a-date', items: [{ offerId: 'A', quantity: 5 }] })], []);
    expect(ts).toEqual({});
    expect(gs).toEqual({});
  });

  it('a lower-case Ozon status ("in_transit") is normalised the same way on both sides — the supply still reserves and still counts as active (no safety window applied)', () => {
    const { ts, gs } = both([sh({ ozonStatus: 'in_transit', detectedAt: '', items: [{ offerId: 'A', quantity: 9 }] })], []);
    expect(ts).toEqual({ A: 9 });
    expect(gs).toEqual({ A: 9 });
  });

  it('a request-journal row with an empty article and a zero quantity contributes nothing on either side', () => {
    const req: OzonSupplyRequestRow = {
      id: 'R', date: NOW.toISOString(), cabinet: 'M', draftId: '', orderId: '1', dropOffName: '', clusters: '',
      itemsJSON: JSON.stringify([{ article: '', qty: 5 }, { article: 'A', qty: 0 }]), who: '', status: 'Создана'
    };
    const { ts, gs } = both([], [req]);
    expect(ts).toEqual({});
    expect(gs).toEqual({});
  });
});
