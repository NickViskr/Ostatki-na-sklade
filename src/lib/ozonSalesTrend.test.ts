import { describe, expect, it } from 'vitest';
import { buildOzonCoverage, buildSalesTrend, OzonCoverageSettings } from './ozonCoverage';
import { OzonSalesRow, OzonStockHistoryRow, OzonStockRow, SKUItem } from '../types';

// Item 100.7 part 3, R-030: the history-based trend regression must use the REAL calendar
// distance between weeks (x = week position in the trend window), not the index among kept weeks.

const NOW = new Date('2026-10-21T09:00:00Z'); // Wednesday; current Monday 2026-10-19
const WEEKS: string[] = [];
for (let i = 0; i < 13; i++) {
  WEEKS.push(new Date(Date.parse('2026-07-20T00:00:00Z') + i * 7 * 86400000).toISOString().slice(0, 10));
}
const WEEKS_PER_MONTH = 4.345; // mirrors the private constant in ozonSalesTrend.ts

const sku: SKUItem = { sku: 'A', price: 0, minStock: 0, pcsPerBox: 1, boxesPerPallet: 1, volumeLiters: 0, leadTimeDays: 0 };
const settings: OzonCoverageSettings = {
  speedWeeks: 3, trendWeeks: 13, minStockDays: 10, targetStockDays: 30, maxClusterDays: 60, factoryOrderDays: 14,
  returnsToSalePct: 0, excludedClusters: '', deficitDays: 0, demandGrowthPct: 0, salesGrowthPct: 0
} as OzonCoverageSettings;
const clusters = [{ clusterId: 'C1', clusterName: 'Москва' }];
const emptyStock = {
  cabinet: 'M', sku: '', offerId: 'A', name: 'A', warehouseName: 'W', clusterName: 'Москва', clusterId: 'C1',
  available: 0, preparing: 0, requested: 0, transit: 0, excess: 0, returns: 0, other: 0, updatedAt: ''
} as unknown as OzonStockRow;

function trendFor(inStockIdx: number[], qtyOf: (i: number) => number, withHistory = true) {
  const sales = inStockIdx.map(i => ({ week: WEEKS[i], cabinet: 'M', offerId: 'A', clusterName: 'Москва', qty: qtyOf(i), updatedAt: '', days: 7 })) as unknown as OzonSalesRow[];
  const hist = WEEKS.map((w, i) => ({
    week: w, cabinet: 'M', offerId: 'A', clusterId: 'C1', clusterName: 'Москва',
    daysInStock: inStockIdx.includes(i) ? 7 : 0, daysObserved: 7, lastDay: w, updatedAt: ''
  })) as unknown as OzonStockHistoryRow[];
  const res = buildOzonCoverage({
    stocks: [emptyStock], sales, skus: [sku], clusters, settings,
    myStockAvailability: { A: 0 }, stockHistory: withHistory ? hist : undefined, now: NOW
  } as any);
  return res.articles.find(a => a.article === 'A')!.trend!;
}

describe('R-030 history trend regression x-axis', () => {
  it('stock-out gap weeks keep their calendar distance: slope is 7 per calendar week (probe case)', () => {
    const q: Record<number, number> = { 0: 70, 1: 77, 2: 84, 10: 140, 11: 147, 12: 154 };
    const t = trendFor([0, 1, 2, 10, 11, 12], i => q[i]);
    expect(t.weeks.length).toBe(6);
    expect(t.slope).toBeCloseTo(7, 9);
  });

  it('with the real slope the applied trend is the unclamped (mean + slope * weeksPerMonth) / mean, not 1.5', () => {
    const q: Record<number, number> = { 0: 70, 1: 77, 2: 84, 10: 140, 11: 147, 12: 154 };
    const t = trendFor([0, 1, 2, 10, 11, 12], i => q[i]);
    const expected = (112 + 7 * WEEKS_PER_MONTH) / 112;
    expect(t.mean).toBeCloseTo(112, 9);
    expect(t.raw).toBeCloseTo(expected, 6);
    expect(t.applied).toBeCloseTo(expected, 6);
    expect(t.applied).toBeLessThan(1.5);
    expect(t.reason).toBeNull();
  });

  it('control: gap-free 13-week history series keeps today values (slope 7, mean 112)', () => {
    const t = trendFor(WEEKS.map((_, i) => i), i => 70 + 7 * i);
    expect(t.weeks.length).toBe(13);
    expect(t.slope).toBeCloseTo(7, 9);
    expect(t.mean).toBeCloseTo(112, 9);
    expect(t.raw).toBeCloseTo((112 + 7 * WEEKS_PER_MONTH) / 112, 6);
    expect(t.applied).toBeCloseTo(t.raw, 9);
  });

  it('control: only the trailing weeks missing from the end/start (no inner gap) keeps consecutive x', () => {
    // weeks 3..12 in stock, contiguous: slope must equal the plain index slope
    const idx = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    const t = trendFor(idx, i => 100 + 5 * i);
    expect(t.slope).toBeCloseTo(5, 9);
  });

  it('fallback path without history (buildSalesTrend), gap-free: slope and mean unchanged', () => {
    const sales = WEEKS.map((w, i) => ({ week: w, cabinet: 'M', offerId: 'A', clusterName: 'Москва', qty: 70 + 7 * i, updatedAt: '', days: 7 })) as unknown as OzonSalesRow[];
    const t = buildSalesTrend(sales, [sku], settings, NOW, { perDayByArticle: { A: 10 } } as any, [emptyStock], {})['A'];
    expect(t.weeks.length).toBe(13);
    expect(t.slope).toBeCloseTo(7, 9);
    expect(t.mean).toBeCloseTo(112, 9);
    expect(t.raw).toBeCloseTo((112 + 7 * WEEKS_PER_MONTH) / 112, 6);
  });
});
