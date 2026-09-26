import { describe, expect, it } from 'vitest';
import { buildOzonCoverage, type OzonCoverageInput, type OzonCoverageSettings } from './ozonCoverage';
import type { KitItem, OzonSalesRow, OzonStockRow, SKUItem } from '../types';

/**
 * Item 85, step 1.4 (owner 2026-09-26: «брать большее из двух»). The factory forecast is the
 * LARGER of «window speed × trend» and «the 7-day speed» (when «Спрос вырос» fired), never the
 * product of the two lifts. Supplies to the clusters keep the 7-day speed, as before.
 *
 * NOW is Wednesday 16.09.2026 05:07 МСК: the current week 14.09 has 2.21 elapsed days; the
 * trend window is the 8 full weeks 20.07 … 07.09 and rises by 5 a week (trend 1.3219); the
 * speed window is the 4 full weeks 17.08 … 07.09 plus the part-week. Expected numbers were
 * computed independently (python) from the formulas of items 38, 71 and 73.
 */
const NOW = new Date('2026-09-16T02:07:00Z');
const ART = 'ART';
const WEEKS = ['2026-07-20', '2026-07-27', '2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24', '2026-08-31', '2026-09-07'];
const RISING = [50, 55, 60, 65, 70, 75, 80, 85];
const TREND = 1.3218518518518518;

const sku = (over: Partial<SKUItem> & { sku: string }): SKUItem => ({
  price: 0, minStock: 0, pcsPerBox: 1, boxesPerPallet: 0, volumeLiters: 0, leadTimeDays: 400, ...over
});

function sales(currentWeekQty: number, article = ART): OzonSalesRow[] {
  return [
    ...WEEKS.map((week, i) => ({ week, cabinet: 't', offerId: article, clusterName: 'Москва', qty: RISING[i], updatedAt: '', days: 7 })),
    { week: '2026-09-14', cabinet: 't', offerId: article, clusterName: 'Москва', qty: currentWeekQty, updatedAt: '', days: 2.21 }
  ];
}

function settings(over: Partial<OzonCoverageSettings> = {}): OzonCoverageSettings {
  return {
    speedWeeks: 4, minStockDays: 7, targetStockDays: 20, maxClusterDays: 0, factoryOrderDays: 14,
    returnsToSalePct: 0, excludedClusters: '', deficitDays: 0, trendWeeks: 8, demandGrowthPct: 30, salesGrowthPct: 0, ...over
  };
}

const stock = (article = ART): OzonStockRow => ({
  cabinet: 't', sku: '', offerId: article, name: article, warehouseName: 'W', clusterName: 'Москва', clusterId: 'C1',
  available: 100, preparing: 0, requested: 0, transit: 0, excess: 0, returns: 0, other: 0, updatedAt: ''
});

function input(currentWeekQty: number, over: Partial<OzonCoverageInput> = {}): OzonCoverageInput {
  return {
    stocks: [stock()], sales: sales(currentWeekQty), skus: [sku({ sku: ART })],
    clusters: [{ clusterId: 'C1', clusterName: 'Москва' }], settings: settings(),
    myStockAvailability: { [ART]: 0 }, now: NOW, ...over
  };
}

const article = (inp: OzonCoverageInput, name = ART) => buildOzonCoverage(inp).articles.find((a) => a.article === name)!;

describe('item 85, step 1.4: factory forecast = the larger of the two, never the product', () => {
  it('the trend of the rising series is 1.3219, applied (no filter fires)', () => {
    const a = article(input(80));
    expect(a.trend!.applied).toBeCloseTo(TREND, 12);
    expect(a.trend!.reason).toBeNull();
  });

  it('the 7 days win: forecast = 7-day speed 19.74 (was 26.09 = 19.74 × 1.32)', () => {
    const a = article(input(80));
    expect(a.demandGrowth!.applied).toBe(true);
    expect(a.demandGrowth!.basePerDay).toBeCloseTo(12.909632571996028, 10);
    expect(a.demandGrowth!.recentPerDay).toBeCloseTo(19.737755102040815, 10);
    expect(a.forecastPerDay).toBeCloseTo(19.737755102040815, 10);
    expect(a.forecastPerDay).not.toBeCloseTo(26.090388133030988, 2);
  });

  it('the trend wins: forecast = window speed × trend 15.53 (was 19.48)', () => {
    const a = article(input(45, { settings: settings({ demandGrowthPct: 10 }) }));
    expect(a.demandGrowth!.applied).toBe(true);
    expect(a.forecastPerDay).toBeCloseTo(15.533181311069427, 10);
    expect(a.forecastPerDay).not.toBeCloseTo(19.48112887377173, 2);
  });

  it('«Спрос вырос» did not fire: forecast = window speed × trend, as before', () => {
    const a = article(input(45)); // growth 25.42 % under the threshold of 30
    expect(a.demandGrowth!.applied).toBe(false);
    expect(a.perDay).toBeCloseTo(11.751075802714332, 10);
    expect(a.forecastPerDay).toBeCloseTo(11.751075802714332 * TREND, 10);
  });

  it('«Спрос вырос» switched off (0): forecast = window speed × trend', () => {
    const a = article(input(80, { settings: settings({ demandGrowthPct: 0 }) }));
    expect(a.demandGrowth!.applied).toBe(false);
    expect(a.forecastPerDay).toBeCloseTo(12.909632571996028 * TREND, 10);
  });

  it('the manual «Прирост объёма продаж, %» multiplies the chosen speed once', () => {
    const a = article(input(80, { settings: settings({ salesGrowthPct: 10 }) }));
    expect(a.forecastPerDay).toBeCloseTo(19.737755102040815 * 1.1, 10);
    const b = article(input(45, { settings: settings({ demandGrowthPct: 10, salesGrowthPct: 10 }) }));
    expect(b.forecastPerDay).toBeCloseTo(15.533181311069427 * 1.1, 10);
  });

  it('supplies to the clusters keep the 7-day speed (owner: works as before)', () => {
    const a = article(input(80));
    expect(a.perDay).toBeCloseTo(19.737755102040815, 10);
    expect(a.clusters.find((c) => c.clusterId === 'C1')!.perDay).toBeCloseTo(19.737755102040815, 10);
  });

  it('the factory order follows the forecast: 19.74 × (400 + 7 + 14) − 100 → 8210 pcs (was 10885)', () => {
    const a = article(input(80));
    expect(a.factory!.orderQty).toBe(Math.ceil(19.737755102040815 * 421 - 100));
    expect(a.factory!.orderQty).toBe(8210);
  });

  it('a virtual kit passes the same forecast to its components', () => {
    const KIT = 'KIT';
    const kits: KitItem[] = [{ kitSku: KIT, type: 'virtual', components: [{ componentSku: 'BOWL', quantity: 2 }] }];
    const res = buildOzonCoverage({
      stocks: [stock(KIT)], sales: sales(80, KIT), skus: [sku({ sku: KIT }), sku({ sku: 'BOWL' })],
      clusters: [{ clusterId: 'C1', clusterName: 'Москва' }], settings: settings(),
      myStockAvailability: { [KIT]: 0, BOWL: 0 }, kits, now: NOW
    });
    const bowl = res.components.find((c) => c.component === 'BOWL')!;
    expect(bowl.forecastPerDay).toBeCloseTo(19.737755102040815 * 2, 10);
  });
});
