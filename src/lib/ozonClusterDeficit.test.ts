import { describe, expect, it } from 'vitest';
import { buildOzonCoverage, getLastFullWeeks, OzonCoverageInput, OzonCoverageSettings } from './ozonCoverage';
import type { OzonSalesRow, OzonStockRow, SKUItem } from '../types';

/**
 * Item 72. The deficit speed correction per cluster.
 * NOW is Wednesday 10.01.2024; the speed window is the four full weeks 11.12–01.01, the trend
 * window the 13 full weeks 09.10–01.01. One article «BOWL», two clusters: Moscow has sold out
 * (20 pieces a week for nine weeks, then 2 a week on an empty shelf, stock 0), Kazan sells
 * 10 a week with 300 pieces on the shelf — so the article as a whole is NOT in deficit.
 */
const NOW = new Date('2024-01-10T10:00:00Z');
const WEEKS = getLastFullWeeks(NOW, 13); // oldest first
const ART = 'BOWL';
const skus: SKUItem[] = [{ sku: ART, price: 0, minStock: 0, pcsPerBox: 10, boxesPerPallet: 0, volumeLiters: 0, leadTimeDays: 0 }];
const clusters = [{ clusterId: 'C1', clusterName: 'Москва' }, { clusterId: 'C2', clusterName: 'Казань' }];

const MOSCOW = [20, 20, 20, 20, 20, 20, 20, 20, 20, 2, 2, 2, 2];
const KAZAN = [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10];

function series(clusterName: string, qtyByWeek: number[], offerId = ART): OzonSalesRow[] {
  return WEEKS.map((week, i) => ({ week, cabinet: 'test', offerId, clusterName, qty: qtyByWeek[i], updatedAt: '', days: 7 }));
}

function stockRow(clusterId: string, clusterName: string, available: number, transit = 0): OzonStockRow {
  return {
    cabinet: 'test', sku: '', offerId: ART, name: ART, warehouseName: 'W', clusterName, clusterId,
    available, preparing: 0, requested: 0, transit, excess: 0, returns: 0, other: 0, updatedAt: ''
  };
}

function settings(over: Partial<OzonCoverageSettings> = {}): OzonCoverageSettings {
  return {
    speedWeeks: 4, minStockDays: 7, targetStockDays: 20, maxClusterDays: 0, factoryOrderDays: 14,
    returnsToSalePct: 0, excludedClusters: '', trendWeeks: 13, deficitDays: 30, bestWeeks: 4,
    minSalesForCorrection: 50, maxSpeedGrowth: 0, ...over
  };
}

function run(over: Partial<OzonCoverageInput> = {}) {
  const input: OzonCoverageInput = {
    stocks: [stockRow('C1', 'Москва', 0), stockRow('C2', 'Казань', 300)],
    sales: [...series('Москва', MOSCOW), ...series('Казань', KAZAN)],
    skus, clusters, settings: settings(), myStockAvailability: { [ART]: 1000 }, now: NOW, ...over
  };
  const art = buildOzonCoverage(input).articles.find((a) => a.article === ART)!;
  const moscow = art.clusters.find((c) => c.clusterId === 'C1')!;
  const kazan = art.clusters.find((c) => c.clusterId === 'C2')!;
  return { art, moscow, kazan };
}

describe('item 72: deficit speed correction per cluster', () => {
  it('an empty cluster of a stocked article takes the speed of its own best weeks', () => {
    const { art, moscow, kazan } = run();
    // Speed window: Moscow 4 × 2 = 8 pieces → 8/28; best four weeks 20 each → 20/7.
    expect(moscow.speedCorrection).not.toBeNull();
    expect(moscow.speedCorrection!.base).toBeCloseTo(8 / 28, 10);
    expect(moscow.speedCorrection!.corrected).toBeCloseTo(20 / 7, 10);
    expect(moscow.speedCorrection!.daysLeft).toBe(0);
    expect(moscow.speedCorrection!.windowQty).toBe(188);
    expect(moscow.speedCorrection!.weeksWithSales).toBe(13);
    expect(moscow.speedCorrection!.bestWeeks.map((b) => b.qty)).toEqual([20, 20, 20, 20]);
    expect(moscow.perDay).toBeCloseTo(20 / 7, 10);
    // Kazan: 300 pieces at 10/7 a day is 210 days — untouched.
    expect(kazan.speedCorrection).toBeNull();
    expect(kazan.perDay).toBeCloseTo(10 / 7, 10);
    // Article speed = sum of the cluster speeds after the correction; no article-level correction.
    expect(art.perDay).toBeCloseTo(30 / 7, 10);
    expect(art.speedCorrection).toBeNull();
  });

  it('the recommendation of the empty cluster follows the corrected speed', () => {
    const { moscow } = run();
    // 20 target days × 20/7 = 57.14 pieces → 6 boxes of 10.
    expect(moscow.recommendation).not.toBeNull();
    expect(moscow.recommendation!.boxes).toBe(6);
  });

  it('the deficit is judged by the CLUSTER stock, not by the article stock', () => {
    // Moscow has 100 pieces, Kazan 0 and a fall to 5 a week: now Kazan is the empty one.
    const kazanFall = [10, 10, 10, 10, 10, 10, 10, 10, 10, 5, 5, 5, 5];
    const { moscow, kazan } = run({
      stocks: [stockRow('C1', 'Москва', 100), stockRow('C2', 'Казань', 0)],
      sales: [...series('Москва', MOSCOW), ...series('Казань', kazanFall)]
    });
    expect(moscow.speedCorrection).toBeNull();
    expect(kazan.speedCorrection).not.toBeNull();
    expect(kazan.speedCorrection!.corrected).toBeCloseTo(10 / 7, 10);
    expect(kazan.speedCorrection!.base).toBeCloseTo(20 / 28, 10);
  });

  it('goods in transit count as cluster stock', () => {
    // 0 available, 100 in transit at 8/28 a day = 350 days — not a deficit.
    const { moscow } = run({ stocks: [stockRow('C1', 'Москва', 0, 100), stockRow('C2', 'Казань', 300)] });
    expect(moscow.speedCorrection).toBeNull();
  });

  it('when the whole article is empty, the article-level correction (item 42) applies alone', () => {
    const { art, moscow, kazan } = run({ stocks: [stockRow('C1', 'Москва', 0), stockRow('C2', 'Казань', 0)] });
    expect(art.speedCorrection).not.toBeNull();
    expect(moscow.speedCorrection).toBeNull();
    expect(kazan.speedCorrection).toBeNull();
    // Article: base (8 + 40) / 28; best four weeks of the article 30 each → 30/7.
    expect(art.perDay).toBeCloseTo(30 / 7, 10);
  });

  it('the growth cap limits the cluster correction', () => {
    const { moscow, art } = run({ settings: settings({ maxSpeedGrowth: 2 }) });
    expect(moscow.speedCorrection!.capped).toBe(true);
    expect(moscow.speedCorrection!.corrected).toBeCloseTo((8 / 28) * 2, 10);
    expect(moscow.speedCorrection!.raw).toBeCloseTo(20 / 7, 10);
    expect(art.perDay).toBeCloseTo(10 / 7 + (8 / 28) * 2, 10);
  });

  it('the minimum-sales guard applies to the cluster window', () => {
    const { moscow } = run({ settings: settings({ minSalesForCorrection: 189 }) });
    expect(moscow.speedCorrection).toBeNull();
    expect(run({ settings: settings({ minSalesForCorrection: 188 }) }).moscow.speedCorrection).not.toBeNull();
  });

  it('a cluster with fewer than six weeks of sales is left alone (a newcomer)', () => {
    // Five weeks with sales, 110 pieces; the best four (30, 30, 30, 10) would lift the speed
    // from 80/28 to 100/28 — only the weeks guard keeps the newcomer out.
    const young = [0, 0, 0, 0, 0, 0, 0, 0, 30, 30, 30, 10, 10];
    const { moscow } = run({ sales: [...series('Москва', young), ...series('Казань', KAZAN)] });
    expect(moscow.speedCorrection).toBeNull();
  });

  it('no speed but stock on the shelf is no demand, not a deficit', () => {
    const gone = [20, 20, 20, 20, 20, 20, 20, 20, 20, 0, 0, 0, 0];
    const { moscow } = run({
      stocks: [stockRow('C1', 'Москва', 50), stockRow('C2', 'Казань', 300)],
      sales: [...series('Москва', gone), ...series('Казань', KAZAN)]
    });
    expect(moscow.speedCorrection).toBeNull();
    expect(moscow.perDay).toBe(0);
  });

  it('a cluster without any sales in the speed window still gets its trend speed and a row', () => {
    const gone = [20, 20, 20, 20, 20, 20, 20, 20, 20, 0, 0, 0, 0];
    const { moscow, art } = run({ sales: [...series('Москва', gone), ...series('Казань', KAZAN)] });
    expect(moscow.qtySold).toBe(0);
    expect(moscow.speedCorrection!.base).toBe(0);
    expect(moscow.perDay).toBeCloseTo(20 / 7, 10);
    expect(moscow.recommendation!.boxes).toBe(6);
    expect(art.perDay).toBeCloseTo(30 / 7, 10);
  });

  it('never corrects downwards and does nothing with deficitDays = 0', () => {
    // Moscow's best weeks equal its current speed: nothing to lift.
    const flat = [2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2];
    expect(run({ sales: [...series('Москва', flat), ...series('Казань', KAZAN)] }).moscow.speedCorrection).toBeNull();
    expect(run({ settings: settings({ deficitDays: 0 }) }).moscow.speedCorrection).toBeNull();
  });
});
