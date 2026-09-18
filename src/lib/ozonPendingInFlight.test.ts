import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { buildPendingSupplies, type OzonSupplyRequestRow } from './ozonPending';
import { buildOzonCoverage, type OzonCoverageSettings } from './ozonCoverage';
import type { ExternalShipment, OzonSalesRow, OzonStockRow, SKUItem } from '../types';

/**
 * Item 70. The owner's case of 14.09.2026, replayed from the sheets.
 *
 * Order 127380557-1 (BowlGrayMini_01) was written off on 13.09 and shipped only on 16.09, so
 * on 14.09 its supplies were `processed` locally and READY_TO_SUPPLY at Ozon: 36 pieces on
 * their way to Moscow, held by Ozon in «В заявках». At 16:12 the owner created request
 * 128602014-1 from the recommendations — 72 more pieces to Moscow — and a second later
 * Moscow was recommended again. The cluster count was max(local, Ozon) = max(72, 36) = 72,
 * because the local list dropped the written-off supply; the truth was 108.
 *
 * Numbers below are the live ones: Moscow sells 3.86/day, priority 1.4 over a target of 20
 * days → 108 pieces wanted; the shelf held about 7.
 */
const NOW = new Date('2026-09-14T11:12:40Z');
const MOSCOW = '4039';
const ARTICLE = 'BowlGrayMini_01';
const DAY_MS = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY_MS).toISOString();

const skus: SKUItem[] = [
  { sku: ARTICLE, price: 0, minStock: 0, pcsPerBox: 18, ozonBarcode: 'OZN1368918716', wbBarcode: '', boxesPerPallet: 0, volumeLiters: 0, leadTimeDays: 0 }
];

const settings: OzonCoverageSettings = {
  speedWeeks: 3, minStockDays: 10, targetStockDays: 20, maxClusterDays: 100, factoryOrderDays: 50,
  returnsToSalePct: 95, excludedClusters: '', priorityClusters: `${MOSCOW}:1.4`, deficitDays: 0
};

// Three full weeks before 14.09: 24.08, 31.08, 07.09 — 27 pieces a week in Moscow = 3.857/day.
const sales: OzonSalesRow[] = ['2026-08-24', '2026-08-31', '2026-09-07'].map((week) => ({
  week, cabinet: 'MaxiStore', offerId: ARTICLE, clusterName: 'Москва, МО и Дальние регионы', qty: 27, updatedAt: '', days: 7
}));

/** Ozon's stock row of Moscow on 14.09: 7 on the shelf, the old supply in «В заявках». */
function moscowStock(requested: number): OzonStockRow {
  return {
    cabinet: 'MaxiStore', sku: '1368918716', offerId: ARTICLE, name: 'Миска', warehouseName: 'ПУШКИНО_2_РФЦ',
    clusterName: 'Москва, МО и Дальние регионы', clusterId: MOSCOW,
    available: 7, preparing: 0, requested, transit: 0, excess: 0, returns: 0, other: 0, updatedAt: ''
  };
}

/** The old supply as a row of «Внешние отгрузки». */
function oldSupply(over: Partial<ExternalShipment> = {}): ExternalShipment {
  return {
    postingId: '2000065651019', detectedAt: ago(8), shipmentDate: '2026-09-16', status: 'processed',
    itemsJSON: JSON.stringify([{ offerId: ARTICLE, barcode: 'OZN1368918716', quantity: 36 }]),
    transGroupInfo: '["a595b3f5"]', orderId: '127070110', orderNumber: '127380557-1',
    ozonStatus: 'READY_TO_SUPPLY', cabinet: 'MaxiStore', clusterId: MOSCOW, isVirtual: false,
    ...over
  };
}

/** The new request, as the journal «Заявки Ozon» records it a second after creation. */
const newRequest: OzonSupplyRequestRow = {
  id: 'SUP-1789384350577', date: ago(0), cabinet: 'MaxiStore', draftId: '128602014', orderId: '128603187',
  dropOffName: 'ЕКАТЕРИНБУРГ_ХАБ_ПЫШМА', clusters: MOSCOW,
  itemsJSON: JSON.stringify([{ article: ARTICLE, clusterId: MOSCOW, qty: 72 }]), who: 'администратор', status: 'Создана'
};

function moscowRow(shipments: ExternalShipment[], requests: OzonSupplyRequestRow[], requested: number) {
  const pending = buildPendingSupplies({ shipments, requests, skus, now: NOW });
  const res = buildOzonCoverage({
    stocks: [moscowStock(requested)], sales, skus, clusters: [{ clusterId: MOSCOW, clusterName: 'Москва, МО и Дальние регионы' }],
    settings, myStockAvailability: { [ARTICLE]: 349 }, pending, factoryOnOrder: {}, kits: [], now: NOW
  });
  const article = res.articles.find((a) => a.article === ARTICLE)!;
  return { pending, article, cluster: article.clusters.find((c) => c.clusterId === MOSCOW)! };
}

describe('Item 70. Списанная, но не принятая Ozon поставка едет в кластер', () => {
  it('до новой заявки: старая поставка зачтена через «В заявках» Ozon, рекомендация 72 (4 коробки)', () => {
    const { cluster } = moscowRow([oldSupply()], [], 36);
    expect(cluster.pendingEffective).toBe(36);
    expect(cluster.recommendation?.qty).toBe(72);
  });

  it('через секунду после заявки на 72: зачтено 108, рекомендации нет (было: зачтено 72, рекомендация 36)', () => {
    const { pending, cluster, article } = moscowRow([oldSupply()], [newRequest], 36);
    expect(pending.byArticleCluster[ARTICLE][MOSCOW]).toBe(108);
    expect(cluster.pendingEffective).toBe(108);
    expect(cluster.recommendation).toBeNull();
    // the written-off 36 do not sit on «Мой склад» any more — only the new 72 are reserved
    expect(article.pendingTotal).toBe(72);
    expect(article.freeMyStock).toBe(349 - 72);
  });

  it('расшифровка: списанная строка помечена «едет, не резервирует», журнальная — и то и другое', () => {
    const { pending } = moscowRow([oldSupply()], [newRequest], 36);
    const old = pending.details.find((d) => d.postingId === '2000065651019')!;
    expect(old.reservesMyStock).toBe(false);
    expect(old.countsForCluster).toBe(true);
    const fresh = pending.details.find((d) => d.source === 'request')!;
    expect(fresh.reservesMyStock).toBe(true);
    expect(fresh.countsForCluster).toBe(true);
  });

  it('Ozon принял поставку на хабе — она уже в колонках Ozon и из зачёта по кластеру уходит, резерв до списания остаётся', () => {
    // not yet written off (status new), accepted by Ozon: the 36 sit in Ozon's «В пути» now
    const accepted = oldSupply({ status: 'new', ozonStatus: 'ACCEPTED_AT_SUPPLY_WAREHOUSE' });
    const pending = buildPendingSupplies({ shipments: [accepted], requests: [], skus, now: NOW });
    expect(pending.byArticle[ARTICLE]).toBe(36);
    expect(pending.byArticleCluster[ARTICLE]).toBeUndefined();
    const d = pending.details[0];
    expect(d.reservesMyStock).toBe(true);
    expect(d.countsForCluster).toBe(false);
  });

  it('списана И принята Ozon — строки в зачёте нет вовсе', () => {
    const done = oldSupply({ status: 'processed', ozonStatus: 'ACCEPTED_AT_SUPPLY_WAREHOUSE' });
    const pending = buildPendingSupplies({ shipments: [done], requests: [], skus, now: NOW });
    expect(pending.details).toHaveLength(0);
  });

  it('проигнорированная поставка никуда не едет: ни резерва, ни зачёта по кластеру', () => {
    const ignored = oldSupply({ status: 'ignored' });
    const pending = buildPendingSupplies({ shipments: [ignored], requests: [], skus, now: NOW });
    expect(pending.details).toHaveLength(0);
  });

  it('списанная поставка с отказом в приёмке или просроченная в кластер не едет', () => {
    for (const st of ['REJECTED_AT_SUPPLY_WAREHOUSE', 'OVERDUE', 'CANCELLED']) {
      const pending = buildPendingSupplies({ shipments: [oldSupply({ ozonStatus: st })], requests: [], skus, now: NOW });
      expect(pending.byArticleCluster[ARTICLE]).toBeUndefined();
    }
  });

  it('списанная поставка без статуса Ozon едет в кластер только внутри предохранителя', () => {
    const fresh = buildPendingSupplies({ shipments: [oldSupply({ ozonStatus: '', detectedAt: ago(6) })], requests: [], skus, now: NOW });
    expect(fresh.byArticleCluster[ARTICLE][MOSCOW]).toBe(36);
    const stale = buildPendingSupplies({ shipments: [oldSupply({ ozonStatus: '', detectedAt: ago(8) })], requests: [], skus, now: NOW });
    expect(stale.byArticleCluster[ARTICLE]).toBeUndefined();
  });

  it('списанная строка без кластера не даёт ни резерва, ни кластерного зачёта', () => {
    const pending = buildPendingSupplies({ shipments: [oldSupply({ clusterId: '' })], requests: [], skus, now: NOW });
    expect(pending.byArticle[ARTICLE]).toBeUndefined();
    expect(pending.unboundByArticle[ARTICLE]).toBeUndefined();
    expect(pending.byArticleCluster[ARTICLE]).toBeUndefined();
  });

  it('окно «В заявках» помечает обе разновидности строк и итожит только резерв склада', () => {
    const tab = fs.readFileSync(path.join(process.cwd(), 'src/components/OzonStocksTab.tsx'), 'utf8');
    expect(tab).toContain("{!d.reservesMyStock && <span className=\"ml-1 text-amber-600 font-semibold\">списана, едет</span>}");
    expect(tab).toContain("{!d.countsForCluster && <span className=\"ml-1 text-sky-600 font-semibold\">принята Ozon</span>}");
    expect(tab).toContain('pendingModalRows.reduce((s, d) => s + (d.reservesMyStock ? d.qty : 0), 0)');
    expect(tab).toContain('Итого резерв склада');
  });
});
