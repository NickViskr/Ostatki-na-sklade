import { describe, expect, it } from 'vitest';
import {
  applyDemandGrowth, buildOzonCoverage, buildRecentSpeed, DEMAND_GROWTH_MIN_QTY,
  OzonCoverageInput, OzonCoverageSettings, SalesSpeedResult
} from './ozonCoverage';
import type { OzonSalesRow, OzonStockRow, SKUItem } from '../types';

/**
 * Item 73. The last 7 days against the speed window.
 * NOW is Wednesday 16.09.2026 05:07 МСК: the current week 14.09 has 2.21 elapsed days, the
 * previous full week is 07.09, the speed window (4 weeks) is 17.08 … 07.09 plus the part-week.
 */
const NOW = new Date('2026-09-16T02:07:00Z');
const CUR = '2026-09-14';
const PREV = '2026-09-07';
const FULL = ['2026-08-17', '2026-08-24', '2026-08-31', '2026-09-07'];
const ART = 'ART';
const skus: SKUItem[] = [{ sku: ART, price: 0, minStock: 0, pcsPerBox: 10, boxesPerPallet: 0, volumeLiters: 0, leadTimeDays: 0 }];
const clusters = [{ clusterId: 'C1', clusterName: 'Москва' }, { clusterId: 'C2', clusterName: 'Казань' }];

const row = (week: string, qty: number, days: number, clusterName = 'Москва', offerId = ART): OzonSalesRow =>
  ({ week, cabinet: 'test', offerId, clusterName, qty, updatedAt: '', days });

function settings(over: Partial<OzonCoverageSettings> = {}): OzonCoverageSettings {
  return {
    speedWeeks: 4, minStockDays: 7, targetStockDays: 20, maxClusterDays: 0, factoryOrderDays: 14,
    returnsToSalePct: 0, excludedClusters: '', deficitDays: 0, demandGrowthPct: 30, ...over
  };
}

const stockRow = (clusterId: string, clusterName: string, available: number): OzonStockRow => ({
  cabinet: 'test', sku: '', offerId: ART, name: ART, warehouseName: 'W', clusterName, clusterId,
  available, preparing: 0, requested: 0, transit: 0, excess: 0, returns: 0, other: 0, updatedAt: ''
});

describe('buildRecentSpeed', () => {
  it('current part-week in full plus the pro-rata tail of the previous full week', () => {
    // 2.21 days of the current week: 20 pieces; the other 4.79 days from the previous week's 70.
    const recent = buildRecentSpeed([row(CUR, 20, 2.21), row(PREV, 70, 7)], skus, NOW);
    expect(recent.currentWeekDays).toBe(2.21);
    expect(recent.qtyByArticle[ART]).toBeCloseTo(20 + 70 * (7 - 2.21) / 7, 10);
  });

  it('without a part-week row the previous full week stands for the whole 7 days', () => {
    const recent = buildRecentSpeed([row(PREV, 70, 7), row('2026-08-31', 100, 7)], skus, NOW);
    expect(recent.currentWeekDays).toBe(0);
    expect(recent.qtyByArticle[ART]).toBe(70);
  });

  it('a current-week row still carrying 7 days (old poll) is not a part-week', () => {
    const recent = buildRecentSpeed([row(CUR, 20, 7), row(PREV, 70, 7)], skus, NOW);
    expect(recent.currentWeekDays).toBe(0);
    expect(recent.qtyByArticle[ART]).toBe(70);
  });

  it('a stale 7-day row of the current week next to a part-week row is left out', () => {
    const recent = buildRecentSpeed([row(CUR, 20, 2.21, 'Москва'), row(CUR, 50, 7, 'Казань')], skus, NOW);
    expect(recent.currentWeekDays).toBe(2.21);
    expect(recent.qtyByArticle[ART]).toBe(20);
  });

  it('sums clusters and reads the article by offer_id', () => {
    const recent = buildRecentSpeed([row(CUR, 5, 2.21, 'Москва'), row(CUR, 15, 2.21, 'Казань'), row(PREV, 14, 7, 'Казань', 'other')], skus, NOW);
    expect(recent.qtyByArticle[ART]).toBeCloseTo(20, 10);
    expect(recent.qtyByArticle['other']).toBeCloseTo(14 * (7 - 2.21) / 7, 10);
  });
});

function speedOf(perDay: number, byCluster: Record<string, number>): SalesSpeedResult {
  return {
    weeks: FULL, windowDays: 30.21, currentWeek: CUR, currentWeekDays: 2.21, totalQty: 0, totalPerDay: perDay,
    qtyByArticle: { [ART]: perDay * 30.21 }, perDayByArticle: { [ART]: perDay }, qtyByCluster: {},
    qtyByArticleCluster: { [ART]: {} }, perDayByArticleCluster: { [ART]: { ...byCluster } },
    clusterSharesPct: {}, clusterSharesPctByArticle: {}
  } as unknown as SalesSpeedResult;
}

describe('applyDemandGrowth', () => {
  it('above the threshold the article and every cluster take the recent speed', () => {
    // base 10/day; 98 pieces in 7 days = 14/day = +40 %.
    const speed = speedOf(10, { Москва: 6, Казань: 4 });
    const info = applyDemandGrowth(speed, { currentWeekDays: 2.21, qtyByArticle: { [ART]: 98 } }, settings());
    expect(info[ART].applied).toBe(true);
    expect(info[ART].growthPct).toBeCloseTo(40, 10);
    expect(info[ART].basePerDay).toBe(10);
    expect(info[ART].recentPerDay).toBe(14);
    expect(speed.perDayByArticle[ART]).toBe(14);
    expect(speed.perDayByArticleCluster[ART]).toEqual({ Москва: 6 * 1.4, Казань: 4 * 1.4 });
  });

  it('at or below the threshold nothing changes, the breakdown still says how much', () => {
    const speed = speedOf(10, { Москва: 10 });
    const info = applyDemandGrowth(speed, { currentWeekDays: 0, qtyByArticle: { [ART]: 91 } }, settings()); // +30 % exactly
    expect(info[ART].applied).toBe(false);
    expect(info[ART].growthPct).toBeCloseTo(30, 10);
    expect(speed.perDayByArticle[ART]).toBe(10);
    expect(speed.perDayByArticleCluster[ART]).toEqual({ Москва: 10 });
  });

  it('threshold 0 switches the signal off; a fall is reported but never applied', () => {
    const speed = speedOf(10, { Москва: 10 });
    expect(applyDemandGrowth(speed, { currentWeekDays: 0, qtyByArticle: { [ART]: 140 } }, settings({ demandGrowthPct: 0 }))[ART].applied).toBe(false);
    const fall = applyDemandGrowth(speedOf(10, {}), { currentWeekDays: 0, qtyByArticle: { [ART]: 35 } }, settings());
    expect(fall[ART].growthPct).toBeCloseTo(-50, 10);
    expect(fall[ART].applied).toBe(false);
  });

  it('too few pieces in 7 days is noise: below DEMAND_GROWTH_MIN_QTY the signal is not applied', () => {
    // base 1/day, 9 pieces in 7 days = +28.6 %... make it +100 % to isolate the quantity guard.
    const speed = speedOf(0.5, { Москва: 0.5 });
    const info = applyDemandGrowth(speed, { currentWeekDays: 0, qtyByArticle: { [ART]: DEMAND_GROWTH_MIN_QTY - 1 } }, settings());
    expect(info[ART].growthPct).toBeGreaterThan(100);
    expect(info[ART].applied).toBe(false);
    const ok = applyDemandGrowth(speedOf(0.5, {}), { currentWeekDays: 0, qtyByArticle: { [ART]: DEMAND_GROWTH_MIN_QTY } }, settings());
    expect(ok[ART].applied).toBe(true);
  });

  it('an article without a base speed gets no breakdown', () => {
    const info = applyDemandGrowth(speedOf(0, {}), { currentWeekDays: 0, qtyByArticle: { [ART]: 50 } }, settings());
    expect(info[ART]).toBeUndefined();
  });
});

describe('buildOzonCoverage with the demand growth', () => {
  it('the recommendation follows the recent speed and the breakdown reaches the article', () => {
    // Window: 4 full weeks × 35 + 2.21 days of 40 → (140 + 40) / 30.21 = 5.958/day.
    // Last 7 days: 40 + 35 × 4.79 / 7 = 63.95 → 9.136/day = +53 %.
    const sales = [...FULL.map((w) => row(w, 35, 7)), row(CUR, 40, 2.21)];
    const input: OzonCoverageInput = {
      stocks: [stockRow('C1', 'Москва', 0)], sales, skus, clusters, settings: settings(),
      myStockAvailability: { [ART]: 1000 }, now: NOW
    };
    const art = buildOzonCoverage(input).articles[0];
    expect(art.demandGrowth).not.toBeNull();
    expect(art.demandGrowth!.applied).toBe(true);
    expect(art.demandGrowth!.recentQty).toBeCloseTo(40 + 35 * (7 - 2.21) / 7, 10);
    expect(art.perDay).toBeCloseTo(art.demandGrowth!.recentPerDay, 10);
    const moscow = art.clusters.find((c) => c.clusterId === 'C1')!;
    expect(moscow.perDay).toBeCloseTo(art.demandGrowth!.recentPerDay, 10);
    // 20 target days × 9.136 = 182.7 → 19 boxes of 10; at the window speed it would be 12.
    expect(moscow.recommendation!.boxes).toBe(19);

    const off = buildOzonCoverage({ ...input, settings: settings({ demandGrowthPct: 0 }) }).articles[0];
    expect(off.demandGrowth!.applied).toBe(false);
    expect(off.clusters[0].recommendation!.boxes).toBe(12);
  });

  it('the growth is measured against the corrected speed of item 42, not lifted twice', () => {
    // Nine weeks of 100 then four weeks of 10 on an empty shelf: item 42 lifts the base to
    // 100/7; the last 7 days (10 + 2 in 2.21 days) are far below it → no growth.
    const weeks13 = ['2026-06-15', '2026-06-22', '2026-06-29', '2026-07-06', '2026-07-13', '2026-07-20', '2026-07-27', '2026-08-03', '2026-08-10', ...FULL];
    const sales = [...weeks13.map((w, i) => row(w, i < 9 ? 100 : 10, 7)), row(CUR, 2, 2.21)];
    const art = buildOzonCoverage({
      stocks: [stockRow('C1', 'Москва', 0)], sales, skus, clusters,
      settings: settings({ deficitDays: 30, trendWeeks: 13, bestWeeks: 4, minSalesForCorrection: 50, maxSpeedGrowth: 0 }),
      myStockAvailability: { [ART]: 1000 }, now: NOW
    }).articles[0];
    expect(art.speedCorrection).not.toBeNull();
    expect(art.demandGrowth!.basePerDay).toBeCloseTo(100 / 7, 10);
    expect(art.demandGrowth!.applied).toBe(false);
    expect(art.perDay).toBeCloseTo(100 / 7, 10);
  });
});
