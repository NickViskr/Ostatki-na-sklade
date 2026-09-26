import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { analyticsItemToStockRow, type OzonAnalyticsStockItem } from './ozonStockRow';
import { buildOzonCoverage } from './ozonCoverage';

/** Item 85, step 1.3: the «Остатки Ozon» row built from one `/v1/analytics/stocks` item. */

// Every count distinct, so a field read into the wrong column cannot pass by coincidence.
const FULL: OzonAnalyticsStockItem = {
  sku: 1368918716, offer_id: 'BowlGrayMini_01', name: 'Миска', warehouse_id: 20000000000001, warehouse_name: 'ПУШКИНО_2_РФЦ',
  // Ozon sends two cluster ids; the planner keys on the macrolocal one (the live answer has 150 vs 4042).
  cluster_name: 'Москва, МО и Дальние регионы', macrolocal_cluster_id: 4039, cluster_id: 150,
  available_stock_count: 11, valid_stock_count: 2, requested_stock_count: 13, transit_stock_count: 17,
  excess_stock_count: 19, return_from_customer_stock_count: 23, return_to_seller_stock_count: 29,
  waiting_docs_stock_count: 31, expiring_stock_count: 37, transit_defect_stock_count: 41,
  stock_defect_stock_count: 43, other_stock_count: 47
};

describe('analyticsItemToStockRow', () => {
  it('every column comes from its own field', () => {
    const row = analyticsItemToStockRow(FULL, 'MaxiStore')!;
    expect(row).toEqual({
      cabinet: 'MaxiStore', sku: '1368918716', offerId: 'BowlGrayMini_01', name: 'Миска',
      warehouseName: 'ПУШКИНО_2_РФЦ', clusterName: 'Москва, МО и Дальние регионы', clusterId: '4039',
      available: 11, preparing: 2, requested: 13, transit: 17, excess: 19,
      returns: 23,
      other: 29 + 31 + 37 + 41 + 43 + 47
    });
  });

  it('goods Ozon sends back to the seller are NOT returns: they go to «Прочее»', () => {
    const row = analyticsItemToStockRow({ offer_id: 'X', return_to_seller_stock_count: 50 }, 'M')!;
    expect(row.returns).toBe(0);
    expect(row.other).toBe(50);
  });

  it('customer returns stay in «Возвраты»', () => {
    const row = analyticsItemToStockRow({ offer_id: 'X', return_from_customer_stock_count: 7 }, 'M')!;
    expect(row.returns).toBe(7);
    expect(row.other).toBe(0);
  });

  it('an all-zero item is not written', () => {
    expect(analyticsItemToStockRow({ offer_id: 'X', warehouse_id: 1, warehouse_name: 'W' }, 'M')).toBeNull();
  });

  it('an item with only goods going back to the seller is still written (in «Прочее»)', () => {
    expect(analyticsItemToStockRow({ offer_id: 'X', return_to_seller_stock_count: 1 }, 'M')).not.toBeNull();
  });

  it('warehouse 0 or without a name is the cluster aggregate', () => {
    expect(analyticsItemToStockRow({ offer_id: 'X', warehouse_id: 0, warehouse_name: 'W', available_stock_count: 1 }, 'M')!.warehouseName)
      .toBe('Без склада (агрегат кластера)');
    expect(analyticsItemToStockRow({ offer_id: 'X', warehouse_id: 5, available_stock_count: 1 }, 'M')!.warehouseName)
      .toBe('Без склада (агрегат кластера)');
  });

  it('missing, null and non-numeric counts read as 0, a missing cluster id as empty', () => {
    const row = analyticsItemToStockRow({ offer_id: 'X', available_stock_count: 3, transit_stock_count: null as any, excess_stock_count: 'abc' as any }, 'M')!;
    expect(row.transit).toBe(0);
    expect(row.excess).toBe(0);
    expect(row.clusterId).toBe('');
  });

  it('whole path: 50 pieces going back to the seller do not reach the planner stock (was 47.5 at 95 %)', () => {
    const row = analyticsItemToStockRow({ offer_id: 'X', warehouse_id: 1, warehouse_name: 'W', cluster_name: 'Москва', macrolocal_cluster_id: 4039, available_stock_count: 4, return_from_customer_stock_count: 10, return_to_seller_stock_count: 50 }, 'M')!;
    const res = buildOzonCoverage({
      stocks: [{ ...row, updatedAt: '' }], sales: [], skus: [], clusters: [{ clusterId: '4039', clusterName: 'Москва' }],
      settings: { speedWeeks: 4, minStockDays: 7, targetStockDays: 20, factoryOrderDays: 14, returnsToSalePct: 95, excludedClusters: '' },
      myStockAvailability: {}, now: new Date('2026-09-16T09:00:00Z')
    });
    expect(res.articles[0].totalEstimated).toBeCloseTo(4 + 10 * 0.95, 10);
  });

  it('server.ts builds every stock row through this function and keeps no copy of the old sum', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'server.ts'), 'utf8');
    expect(src).toContain('import { analyticsItemToStockRow } from "./src/lib/ozonStockRow";');
    expect(src).toMatch(/const row = analyticsItemToStockRow\(item, name\);\s*if \(row\) cabRows\.push\(row\);/);
    expect(src).not.toMatch(/return_from_customer_stock_count/);
    expect(src).not.toMatch(/return_to_seller_stock_count/);
  });
});
