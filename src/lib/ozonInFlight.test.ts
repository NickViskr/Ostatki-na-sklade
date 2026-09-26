import { describe, expect, it } from 'vitest';
import { buildPendingSupplies, type OzonSupplyRequestRow } from './ozonPending';
import { buildOzonCoverage, type OzonCoverageSettings } from './ozonCoverage';
import type { ExternalShipment, KitItem, OzonSalesRow, OzonStockRow, SKUItem } from '../types';

/**
 * Item 85, steps 1.1 and 1.2 (audit 2026-09-26). Goods on their way to a cluster are counted
 * ONCE through the whole life of a supply, and the factory pipeline never jumps when a supply
 * is created, written off, accepted at the hub, driven or accepted at the storage warehouse.
 *
 * The owner's symptom: «создал заявку по рекомендации — и тут же новая рекомендация по этому же
 * товару и этим же кластерам». Live cause: Ozon keeps a supply that is already on the road in
 * «В заявках» (129768876-1, St. Petersburg 24 pcs, IN_TRANSIT), our credit dropped it at the
 * hub, and max(credit, «В заявках») let the new request replace the old one instead of adding.
 *
 * Every case runs the whole path: sheet rows («Внешние отгрузки», «Заявки Ozon», «Остатки
 * Ozon», «Продажи Ozon») → buildPendingSupplies → buildOzonCoverage.
 */

const NOW = new Date('2026-09-16T09:00:00Z'); // Wednesday; full weeks 17.08, 24.08, 31.08, 07.09
const A = 'ORG-A';
const MSK = '4039';
const SPB = '4007';
const EXCL = '4001';
const CLUSTERS = [
  { clusterId: MSK, clusterName: 'Москва' },
  { clusterId: SPB, clusterName: 'Санкт-Петербург' },
  { clusterId: EXCL, clusterName: 'Беларусь' }
];
const nameOf = (id: string) => CLUSTERS.find((c) => c.clusterId === id)!.clusterName;

const settings: OzonCoverageSettings = {
  speedWeeks: 4, minStockDays: 7, targetStockDays: 20, maxClusterDays: 0, factoryOrderDays: 14,
  returnsToSalePct: 95, excludedClusters: EXCL, priorityClusters: '', deficitDays: 0, demandGrowthPct: 0
};

const sku = (over: Partial<SKUItem> & { sku: string }): SKUItem => ({
  price: 0, minStock: 0, pcsPerBox: 10, boxesPerPallet: 0, volumeLiters: 0, leadTimeDays: 120, ...over
});
const SKUS: SKUItem[] = [sku({ sku: A })];

/** 7 pieces a week in the cluster over the 4 full weeks = 1 piece a day. */
function sales(article: string, clusterId: string, perWeek = 7): OzonSalesRow[] {
  return ['2026-08-17', '2026-08-24', '2026-08-31', '2026-09-07'].map((week) => ({
    week, cabinet: 'M', offerId: article, clusterName: nameOf(clusterId), qty: perWeek, updatedAt: '', days: 7
  }));
}

function stock(article: string, clusterId: string, over: Partial<OzonStockRow> = {}): OzonStockRow {
  return {
    cabinet: 'M', sku: '', offerId: article, name: article, warehouseName: 'W', clusterName: clusterId ? nameOf(clusterId) : '',
    clusterId, available: 0, preparing: 0, requested: 0, transit: 0, excess: 0, returns: 0, other: 0, updatedAt: '', ...over
  };
}

function shipment(over: Partial<ExternalShipment> & { qty: number; article?: string }): ExternalShipment {
  const { qty, article, ...rest } = over;
  return {
    postingId: '9001', detectedAt: '2026-09-15 10:00:00', shipmentDate: '2026-09-17', status: 'new',
    itemsJSON: JSON.stringify([{ offerId: article || A, barcode: '', quantity: qty }]),
    transGroupInfo: '', orderId: '777', orderNumber: '777-1', ozonStatus: 'READY_TO_SUPPLY', cabinet: 'M',
    clusterId: MSK, isVirtual: false, ...rest
  };
}

function journal(qty: number, clusterId = MSK, orderId = '777', article = A): OzonSupplyRequestRow {
  return {
    id: 'SUP-1', date: '2026-09-16T08:59:00Z', cabinet: 'M', draftId: '1', orderId, dropOffName: '', clusters: clusterId,
    itemsJSON: JSON.stringify([{ article, clusterId, qty }]), who: 'admin', status: 'Создана'
  };
}

interface Case {
  stocks: OzonStockRow[];
  shipments?: ExternalShipment[];
  requests?: OzonSupplyRequestRow[];
  myStock: number;
  salesRows?: OzonSalesRow[];
  skus?: SKUItem[];
  kits?: KitItem[];
  myStockAvailability?: Record<string, number>;
  factoryOnOrder?: Record<string, number>;
}

function run(c: Case) {
  const pending = buildPendingSupplies({ shipments: c.shipments || [], requests: c.requests || [], skus: c.skus || SKUS, now: NOW });
  const res = buildOzonCoverage({
    stocks: c.stocks, sales: c.salesRows || sales(A, MSK), skus: c.skus || SKUS, clusters: CLUSTERS, settings,
    myStockAvailability: c.myStockAvailability || { [A]: c.myStock }, pending, factoryOnOrder: c.factoryOnOrder || {},
    kits: c.kits || [], now: NOW
  });
  const art = res.articles.find((x) => x.article === A)!;
  return { pending, res, art, msk: art ? art.clusters.find((x) => x.clusterId === MSK)! : undefined! };
}

describe('item 85: one supply of 20 pcs to Moscow, followed through its whole life', () => {
  // Moscow sells 1/day and holds 5 on the shelf; target 20 days → need 15 → two boxes (20).
  // The owner ships exactly the recommendation. From the moment the supply exists until it is
  // on Ozon's shelf, Moscow must count on 25 pieces, recommend nothing, and the factory
  // pipeline must stay 105 (5 at Ozon + 100 on «Мой склад»).
  const states: { name: string; c: Case }[] = [
    { name: '1. в журнале, Ozon ещё не знает', c: { stocks: [stock(A, MSK, { available: 5 })], requests: [journal(20)], myStock: 100 } },
    { name: '2. опрос: READY_TO_SUPPLY, остатки Ozon ещё старые', c: { stocks: [stock(A, MSK, { available: 5 })], shipments: [shipment({ qty: 20 })], requests: [journal(20)], myStock: 100 } },
    { name: '3. Ozon показал «В заявках» 20', c: { stocks: [stock(A, MSK, { available: 5, requested: 20 })], shipments: [shipment({ qty: 20 })], myStock: 100 } },
    { name: '4. списана со склада, ещё READY_TO_SUPPLY', c: { stocks: [stock(A, MSK, { available: 5, requested: 20 })], shipments: [shipment({ qty: 20, status: 'processed' })], myStock: 80 } },
    { name: '5. принята на хабе, Ozon держит «В заявках»', c: { stocks: [stock(A, MSK, { available: 5, requested: 20 })], shipments: [shipment({ qty: 20, status: 'processed', ozonStatus: 'ACCEPTED_AT_SUPPLY_WAREHOUSE' })], myStock: 80 } },
    { name: '6. IN_TRANSIT, Ozon ещё в «В заявках» (живой случай 26.09)', c: { stocks: [stock(A, MSK, { available: 5, requested: 20 })], shipments: [shipment({ qty: 20, status: 'processed', ozonStatus: 'IN_TRANSIT' })], myStock: 80 } },
    { name: '7. IN_TRANSIT, Ozon перенёс в «В пути»', c: { stocks: [stock(A, MSK, { available: 5, transit: 20 })], shipments: [shipment({ qty: 20, status: 'processed', ozonStatus: 'IN_TRANSIT' })], myStock: 80 } },
    { name: '8. приёмка складом, Ozon «В пути»', c: { stocks: [stock(A, MSK, { available: 5, transit: 20 })], shipments: [shipment({ qty: 20, status: 'processed', ozonStatus: 'ACCEPTANCE_AT_STORAGE_WAREHOUSE' })], myStock: 80 } },
    { name: '9. приёмка складом, снимок Ozon ещё «В заявках»', c: { stocks: [stock(A, MSK, { available: 5, requested: 20 })], shipments: [shipment({ qty: 20, status: 'processed', ozonStatus: 'ACCEPTANCE_AT_STORAGE_WAREHOUSE' })], myStock: 80 } },
    { name: '10. принята, лежит на полке Ozon', c: { stocks: [stock(A, MSK, { available: 25 })], shipments: [shipment({ qty: 20, status: 'processed', ozonStatus: 'REPORTS_CONFIRMATION_AWAITING' })], myStock: 80 } },
    { name: '11. завершена', c: { stocks: [stock(A, MSK, { available: 25 })], shipments: [shipment({ qty: 20, status: 'processed', ozonStatus: 'COMPLETED' })], myStock: 80 } },
    { name: '12. завершена, а списать забыли', c: { stocks: [stock(A, MSK, { available: 25 })], shipments: [shipment({ qty: 20, status: 'new', ozonStatus: 'COMPLETED' })], myStock: 100 } }
  ];

  it('до заявки: нужно 15 шт → рекомендация 2 коробки (20 шт), труба 105', () => {
    const { msk, art } = run({ stocks: [stock(A, MSK, { available: 5 })], myStock: 100 });
    expect(msk.estimated).toBe(5);
    expect(msk.recommendation!.qty).toBe(20);
    expect(art.factory!.pipelineQty).toBe(105);
  });

  for (const st of states) {
    it(`${st.name}: Москва рассчитывает на 25 шт, рекомендации нет, труба 105`, () => {
      const { msk, art } = run(st.c);
      expect(msk.estimated).toBe(25);
      expect(msk.recommendation).toBeNull();
      expect(art.totalEstimated).toBe(25);
      expect(art.factory!.pipelineQty).toBe(105);
      expect(art.factory!.orderQty).toBe(40);
    });
  }

  it('свободный остаток склада: 80 от создания до списания, после списания — весь остаток 80', () => {
    expect(run(states[0].c).art.freeMyStock).toBe(80);
    expect(run(states[2].c).art.freeMyStock).toBe(80);
    expect(run(states[3].c).art.freeMyStock).toBe(80);
    expect(run(states[11].c).art.freeMyStock).toBe(80);
  });
});

describe('item 85: the owner\'s repeat recommendation', () => {
  // St. Petersburg sells 1/day, has nothing on the shelf; an older written-off supply of 24 is
  // on the road and Ozon shows it in «В заявках». Target 20 → nothing needed. A NEW request of
  // 10 to the same cluster must ADD to the 24, not replace it.
  const old = shipment({ postingId: '8001', orderId: '555', orderNumber: '555-1', qty: 24, status: 'processed', ozonStatus: 'IN_TRANSIT', clusterId: SPB });
  const spbSales = sales(A, SPB);

  it('до новой заявки: едет 24 — рекомендации нет', () => {
    const { art } = run({ stocks: [stock(A, SPB, { requested: 24 })], shipments: [old], myStock: 50, salesRows: spbSales });
    const spb = art.clusters.find((c) => c.clusterId === SPB)!;
    expect(spb.inFlightQty).toBe(24);
    expect(spb.recommendation).toBeNull();
  });

  it('новая заявка на 10 в тот же кластер: едет 34 (было бы 24 по старому правилу)', () => {
    const { art } = run({
      stocks: [stock(A, SPB, { requested: 24 })], shipments: [old], requests: [journal(10, SPB, '556')], myStock: 50, salesRows: spbSales
    });
    const spb = art.clusters.find((c) => c.clusterId === SPB)!;
    expect(spb.pendingQty).toBe(34);
    expect(spb.ozonInFlightQty).toBe(24);
    expect(spb.inFlightQty).toBe(34);
    expect(spb.estimated).toBe(34);
  });

  it('кластер с потребностью 20: после заявки на 20 поверх едущих 24 рекомендация НЕ возвращается', () => {
    // need at 2/day: 40 − 24 = 16 → two boxes (20). After the request of 20: 44 ≥ 40.
    const fast = sales(A, SPB, 14);
    const before = run({ stocks: [stock(A, SPB, { requested: 24 })], shipments: [old], myStock: 50, salesRows: fast });
    const spbBefore = before.art.clusters.find((c) => c.clusterId === SPB)!;
    expect(spbBefore.recommendation!.qty).toBe(20);
    const after = run({ stocks: [stock(A, SPB, { requested: 24 })], shipments: [old], requests: [journal(20, SPB, '556')], myStock: 50, salesRows: fast });
    const spbAfter = after.art.clusters.find((c) => c.clusterId === SPB)!;
    expect(spbAfter.inFlightQty).toBe(44);
    expect(spbAfter.recommendation).toBeNull();
  });

  it('новая заявка уже видна Ozon в «В заявках» (24 + 10): считается один раз — 34, не 68', () => {
    const fresh = shipment({ postingId: '8002', orderId: '556', orderNumber: '556-1', qty: 10, clusterId: SPB });
    const { art } = run({ stocks: [stock(A, SPB, { requested: 34 })], shipments: [old, fresh], myStock: 50, salesRows: spbSales });
    expect(art.clusters.find((c) => c.clusterId === SPB)!.inFlightQty).toBe(34);
  });
});

describe('item 85: our supplies against Ozon\'s columns', () => {
  it('две поставки в разных стадиях складываются: 10 READY + 15 IN_TRANSIT = 25', () => {
    const a = shipment({ postingId: '1', qty: 10 });
    const b = shipment({ postingId: '2', orderId: '778', qty: 15, status: 'processed', ozonStatus: 'IN_TRANSIT' });
    const { msk } = run({ stocks: [stock(A, MSK, { transit: 15 })], shipments: [a, b], myStock: 100 });
    expect(msk.pendingQty).toBe(25);
    expect(msk.inFlightQty).toBe(25);
  });

  it('Ozon знает о поставке, которой у нас ещё нет: берётся его цифра', () => {
    const { msk } = run({ stocks: [stock(A, MSK, { transit: 12, requested: 6 })], myStock: 100 });
    expect(msk.pendingQty).toBe(0);
    expect(msk.ozonInFlightQty).toBe(18);
    expect(msk.inFlightQty).toBe(18);
    expect(msk.estimated).toBe(18);
  });

  it('отменённая, отклонённая, просроченная и проигнорированная поставки никуда не едут', () => {
    for (const over of [{ ozonStatus: 'CANCELLED' }, { ozonStatus: 'REJECTED_AT_SUPPLY_WAREHOUSE' }, { ozonStatus: 'OVERDUE' }, { status: 'ignored' }]) {
      const { msk } = run({ stocks: [stock(A, MSK, { available: 5 })], shipments: [shipment({ qty: 20, ...over })], myStock: 100 });
      expect(msk.inFlightQty).toBe(0);
      expect(msk.estimated).toBe(5);
    }
  });

  it('виртуальная заявка Ozon не едет и склад не резервирует', () => {
    const { msk, art } = run({ stocks: [stock(A, MSK, { available: 5 })], shipments: [shipment({ qty: 20, isVirtual: true })], myStock: 100 });
    expect(msk.inFlightQty).toBe(0);
    expect(art.pendingTotal).toBe(0);
  });

  it('возвраты входят долей, «Готовим к продаже» не входит, «В пути» и «В заявках» — в «едет»', () => {
    const { msk } = run({ stocks: [stock(A, MSK, { available: 10, returns: 20, preparing: 50, transit: 3, requested: 4 })], myStock: 100 });
    expect(msk.estimated).toBeCloseTo(10 + 20 * 0.95 + 7, 10);
    expect(msk.inFlightQty).toBe(7);
  });

  it('исключённый кластер: что едет — в итоге товара, рекомендации нет', () => {
    const { art } = run({
      stocks: [stock(A, MSK, { available: 30 }), stock(A, EXCL, { requested: 9 })],
      salesRows: [...sales(A, MSK), ...sales(A, EXCL)],
      myStock: 100
    });
    const ex = art.clusters.find((c) => c.clusterId === EXCL)!;
    expect(ex.inFlightQty).toBe(9);
    expect(ex.recommendation).toBeNull();
    expect(art.totalEstimated).toBe(39);
  });

  it('поставка без кластера: в итог товара и в трубу, но не в кластеры', () => {
    const noCluster = shipment({ qty: 12, status: 'processed', clusterId: '' });
    const { art, pending } = run({ stocks: [stock(A, MSK, { available: 5 })], shipments: [noCluster], myStock: 88 });
    expect(pending.unboundInFlightByArticle[A]).toBe(12);
    expect(art.clusters.find((c) => c.clusterId === MSK)!.inFlightQty).toBe(0);
    expect(art.unboundEstimated).toBe(12);
    expect(art.totalEstimated).toBe(17);
    expect(art.factory!.pipelineQty).toBe(17 + 88);
  });

  it('строки Ozon без кластера: едущее по ним и наше без кластера — большее из двух', () => {
    const noCluster = shipment({ qty: 12, status: 'processed', clusterId: '' });
    const { art } = run({ stocks: [stock(A, MSK, { available: 5 }), stock(A, '', { transit: 30 })], shipments: [noCluster], myStock: 88 });
    expect(art.unboundEstimated).toBe(30);
    expect(art.totalEstimated).toBe(35);
  });

  it('покрытие считается вместе с тем, что едет', () => {
    const { msk } = run({ stocks: [stock(A, MSK, { available: 5 })], shipments: [shipment({ qty: 20 })], myStock: 100 });
    // (25 − 1 × 7) ÷ 1 = 18 дней, а не (5 − 7) = −2
    expect(msk.coverageDays).toBe(18);
  });
});

describe('item 85, step 1.2: the factory pipeline', () => {
  it('живой случай 26.09: списанная поставка, которую Ozon держит в «В заявках», входит в трубу', () => {
    // Органайзер_2_пол_прозр: St. Petersburg 24 and Krasnoyarsk 8 IN_TRANSIT, written off.
    const spb = shipment({ postingId: '1', qty: 24, status: 'processed', ozonStatus: 'IN_TRANSIT', clusterId: SPB });
    const msk = shipment({ postingId: '2', qty: 8, status: 'processed', ozonStatus: 'IN_TRANSIT', clusterId: MSK });
    const { art } = run({
      stocks: [stock(A, SPB, { requested: 24 }), stock(A, MSK, { requested: 8, available: 3 })],
      shipments: [spb, msk], salesRows: [...sales(A, MSK), ...sales(A, SPB)], myStock: 136
    });
    expect(art.totalEstimated).toBe(35);
    expect(art.factory!.pipelineQty).toBe(35 + 136);
  });

  it('резерв больше остатка склада: свободно 0, труба не уходит в минус', () => {
    const { art } = run({ stocks: [stock(A, MSK, { available: 5 })], shipments: [shipment({ qty: 40 })], myStock: 30 });
    expect(art.freeMyStock).toBe(0);
    expect(art.factory!.pipelineQty).toBe(5 + 40 + 0);
  });

  it('заказанное на фабрике прибавляется к трубе как раньше', () => {
    // lead time 200 days keeps the signal on (threshold 207 pcs), so its pipeline is visible
    const { art } = run({ stocks: [stock(A, MSK, { available: 5 })], shipments: [shipment({ qty: 20 })], myStock: 100, factoryOnOrder: { [A]: 50 }, skus: [sku({ sku: A, leadTimeDays: 200 })] });
    expect(art.factory!.pipelineQty).toBe(25 + 80 + 50);
    expect(art.factory!.onOrderQty).toBe(50);
  });
});

describe('item 85, step 1.2: kits — the pieces leave the components the moment a kit supply is created', () => {
  const KIT = 'KIT-X';
  const kits: KitItem[] = [{ kitSku: KIT, type: 'virtual', components: [{ componentSku: 'BOWL', quantity: 1 }, { componentSku: 'BOTTLE', quantity: 2 }] }];
  // Long lead times keep both components' factory signals on, so the signal's own pipeline is visible.
  const skus: SKUItem[] = [sku({ sku: KIT, pcsPerBox: 10 }), sku({ sku: 'BOWL', leadTimeDays: 200 }), sku({ sku: 'BOTTLE', leadTimeDays: 400 })];
  const kitSales = sales(KIT, MSK);
  const base = (over: Partial<Case>): Case => ({
    stocks: [stock(KIT, MSK, { available: 5 })], salesRows: kitSales, skus, kits, myStock: 0, ...over
  });
  const comps = (c: Case) => {
    const r = run(c);
    const by: Record<string, { pipe: number; free: number; fromKits: number; signalPipe: number; order: number }> = {};
    for (const x of r.res.components) {
      by[x.component] = { pipe: x.pipelineQty, free: x.freeMyStockQty, fromKits: x.fromKitsQty, signalPipe: x.factory!.pipelineQty, order: x.factory!.orderQty };
    }
    return by;
  };

  it('до заявки, после создания, после списания и в пути — труба компонентов одна и та же', () => {
    const before = comps(base({ myStockAvailability: { [KIT]: 100, BOWL: 100, BOTTLE: 300 } }));
    const created = comps(base({
      shipments: [shipment({ qty: 20, article: KIT })],
      myStockAvailability: { [KIT]: 100, BOWL: 100, BOTTLE: 300 }
    }));
    const writtenOff = comps(base({
      shipments: [shipment({ qty: 20, article: KIT, status: 'processed', ozonStatus: 'IN_TRANSIT' })],
      stocks: [stock(KIT, MSK, { available: 5, requested: 20 })],
      myStockAvailability: { [KIT]: 80, BOWL: 80, BOTTLE: 260 }
    }));
    for (const c of ['BOWL', 'BOTTLE']) {
      expect(created[c].pipe).toBe(before[c].pipe);
      expect(writtenOff[c].pipe).toBe(before[c].pipe);
      // the factory signal reads the same pipeline as the screen, and the order does not move
      expect(before[c].signalPipe).toBe(before[c].pipe);
      expect(created[c].signalPipe).toBe(before[c].pipe);
      expect(writtenOff[c].signalPipe).toBe(before[c].pipe);
      expect(created[c].order).toBe(before[c].order);
      expect(writtenOff[c].order).toBe(before[c].order);
    }
    expect(before.BOWL.pipe).toBe(5 + 100);
    expect(before.BOTTLE.pipe).toBe(5 * 2 + 300);
    expect(created.BOTTLE.free).toBe(300 - 40);
    expect(created.BOTTLE.fromKits).toBe((5 + 20) * 2);
  });
});
