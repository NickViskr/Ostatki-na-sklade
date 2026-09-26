import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildClusterShareWindow, rebuildClusterSpeedByShare, buildOzonCoverage,
  coverageTone, getLastFullWeeks, NO_CLUSTER_NAME,
  type SalesSpeedResult, type OzonCoverageInput, type OzonCoverageSettings
} from './ozonCoverage';
import type { OzonSalesRow, OzonStockRow, SKUItem } from '../types';

/**
 * Item 86, step B (owner, 26.09.2026): «Остатки Озон» rework. Replaces item 72's per-cluster
 * deficit lift: a cluster empty in the SHORT speed window still gets a SHARE of the article
 * speed equal to its share of the article's sales over the LONGER share window
 * (max(trendWeeks, speedWeeks) full weeks present in data, plus the current part-week).
 */

const NOW = new Date('2026-09-16T09:00:00Z'); // Wed; current MSK Monday 2026-09-14
const CUR = '2026-09-14';
const skus: SKUItem[] = [{ sku: 'A', price: 0, minStock: 0, pcsPerBox: 1, boxesPerPallet: 0, volumeLiters: 0, leadTimeDays: 0 }];
const row = (week: string, qty: number, days: number, clusterName = 'Москва', offerId = 'A'): OzonSalesRow =>
  ({ week, cabinet: 't', offerId, clusterName, qty, updatedAt: '', days });

// ===== Unit: buildClusterShareWindow =====

describe('buildClusterShareWindow', () => {
  const WEEKS2 = getLastFullWeeks(NOW, 2);

  it('only weekly rows («Дней» = 7) count for full weeks; 28-day archive rows landing on the same Monday are ignored', () => {
    const sales = [row(WEEKS2[0], 10, 7), row(WEEKS2[1], 10, 7), row(WEEKS2[0], 1000, 28)];
    const w = buildClusterShareWindow(sales, skus, 2, NOW);
    expect(w.weeks).toEqual(WEEKS2);
    expect(w.qtyByArticle['A']).toBe(20);
  });

  it('a week absent from the data (no row at all) is dropped, not counted as zero', () => {
    const w = buildClusterShareWindow([row(WEEKS2[1], 5, 7)], skus, 2, NOW);
    expect(w.weeks).toEqual([WEEKS2[1]]);
    expect(w.qtyByArticle['A']).toBe(5);
  });

  it('item 71: the current part-week enters the window by its elapsed days, never as a whole week', () => {
    const w = buildClusterShareWindow([row(WEEKS2[1], 7, 7), row(CUR, 3, 2)], skus, 2, NOW);
    expect(w.currentWeek).toBe(CUR);
    expect(w.currentWeekDays).toBe(2);
    expect(w.qtyByArticle['A']).toBe(10);
    expect(w.windowWeeksLabel).toBe(w.weeks.length + 1);
  });

  it('without a part-week row the window is full weeks only, and the label carries no +1', () => {
    const w = buildClusterShareWindow([row(WEEKS2[1], 7, 7)], skus, 2, NOW);
    expect(w.currentWeek).toBeNull();
    expect(w.currentWeekDays).toBe(0);
    expect(w.windowWeeksLabel).toBe(w.weeks.length);
  });

  it('a stale current-week row still carrying «Дней» = 7 (old poll) is not a part-week and is outside the requested weeks', () => {
    const w = buildClusterShareWindow([row(WEEKS2[1], 7, 7), row(CUR, 50, 7)], skus, 2, NOW);
    expect(w.currentWeekDays).toBe(0);
    expect(w.qtyByArticle['A']).toBe(7);
  });

  it('qty 0 is skipped, negative qty counts — same convention as buildSalesSpeed', () => {
    const w = buildClusterShareWindow([row(WEEKS2[1], 0, 7), row(WEEKS2[0], -3, 7)], skus, 2, NOW);
    expect(w.qtyByArticle['A']).toBe(-3);
  });

  it('rows without a cluster fall under NO_CLUSTER_NAME and count in the denominator — its share stays unbound', () => {
    const sales = [row(WEEKS2[1], 6, 7, ''), row(WEEKS2[1], 4, 7, 'Москва')];
    const w = buildClusterShareWindow(sales, skus, 2, NOW);
    expect(w.qtyByArticleCluster['A'][NO_CLUSTER_NAME]).toBe(6);
    expect(w.qtyByArticleCluster['A']['Москва']).toBe(4);
    expect(w.qtyByArticle['A']).toBe(10);
  });

  it('offer_id is resolved to the internal article through the SAME map as buildSalesSpeed', () => {
    const forcedMap = { off1: 'REAL' };
    const w = buildClusterShareWindow([row(WEEKS2[1], 9, 7, 'Москва', 'off1')], skus, 2, NOW, forcedMap);
    expect(w.qtyByArticle['REAL']).toBe(9);
    expect(w.qtyByArticle['off1']).toBeUndefined();
  });

  it('speedWeeks > trendWeeks: passing the LARGER count still only widens the window, never shrinks it below the requested weeks', () => {
    const WEEKS8 = getLastFullWeeks(NOW, 8);
    const sales = WEEKS8.map((week) => row(week, 1, 7));
    const w = buildClusterShareWindow(sales, skus, 8, NOW); // caller already took max(trendWeeks, speedWeeks)
    expect(w.weeks).toEqual(WEEKS8);
    expect(w.qtyByArticle['A']).toBe(8);
  });
});

// ===== Unit: rebuildClusterSpeedByShare =====

function stubSpeed(perDayByArticle: Record<string, number>, shortSharesPct: Record<string, Record<string, number>> = {}): SalesSpeedResult {
  return {
    weeks: [], windowDays: 0, currentWeek: null, currentWeekDays: 0, totalQty: 0, totalPerDay: 0,
    qtyByArticle: {}, perDayByArticle: { ...perDayByArticle }, qtyByCluster: {}, qtyByArticleCluster: {},
    perDayByArticleCluster: {}, clusterSharesPct: {}, clusterSharesPctByArticle: shortSharesPct
  };
}

describe('rebuildClusterSpeedByShare', () => {
  it('splits the article speed by share, incl. NO_CLUSTER_NAME, and the clusters sum back to the article speed exactly', () => {
    const speed = stubSpeed({ A: 10 });
    const pct = rebuildClusterSpeedByShare(speed, {
      weeks: [], currentWeek: null, currentWeekDays: 0, windowWeeksLabel: 4,
      qtyByArticle: { A: 100 }, qtyByArticleCluster: { A: { Москва: 60, [NO_CLUSTER_NAME]: 40 } }
    });
    expect(speed.perDayByArticleCluster['A']['Москва']).toBeCloseTo(6, 10);
    expect(speed.perDayByArticleCluster['A'][NO_CLUSTER_NAME]).toBeCloseTo(4, 10);
    expect(speed.perDayByArticleCluster['A']['Москва'] + speed.perDayByArticleCluster['A'][NO_CLUSTER_NAME]).toBeCloseTo(10, 10);
    expect(pct['A']['Москва']).toBeCloseTo(60, 10);
  });

  it('an article with speed but ZERO sales anywhere in the share window falls back to the short-window split', () => {
    const speed = stubSpeed({ A: 10 }, { A: { Москва: 70, Казань: 30 } });
    rebuildClusterSpeedByShare(speed, { weeks: [], currentWeek: null, currentWeekDays: 0, windowWeeksLabel: 4, qtyByArticle: {}, qtyByArticleCluster: {} });
    expect(speed.perDayByArticleCluster['A']).toEqual({ Москва: 7, Казань: 3 });
  });

  it('an article with speed 0 and no window sales gets no clusters at all', () => {
    const speed = stubSpeed({ A: 0 });
    rebuildClusterSpeedByShare(speed, { weeks: [], currentWeek: null, currentWeekDays: 0, windowWeeksLabel: 4, qtyByArticle: {}, qtyByArticleCluster: {} });
    expect(speed.perDayByArticleCluster['A']).toEqual({});
  });
});

// ===== Whole path through buildOzonCoverage =====

const NOW2 = new Date('2024-01-10T10:00:00Z');
const WEEKS13 = getLastFullWeeks(NOW2, 13); // oldest first
const ART = 'BOWL';
const skusBowl: SKUItem[] = [{ sku: ART, price: 0, minStock: 0, pcsPerBox: 10, boxesPerPallet: 0, volumeLiters: 0, leadTimeDays: 0 }];
const clustersBowl = [{ clusterId: 'C1', clusterName: 'Москва' }, { clusterId: 'C2', clusterName: 'Казань' }];
// Moscow sold out for the last 4 weeks (speedWeeks), Kazan still sells steadily throughout.
const MOSCOW13 = [20, 20, 20, 20, 20, 20, 20, 20, 20, 2, 2, 2, 2];
const KAZAN13 = Array(13).fill(10);
const MOSCOW_WINDOW_QTY = MOSCOW13.reduce((s, v) => s + v, 0); // 188
const KAZAN_WINDOW_QTY = KAZAN13.reduce((s, v) => s + v, 0); // 130
const TOTAL_WINDOW_QTY = MOSCOW_WINDOW_QTY + KAZAN_WINDOW_QTY; // 318

function seriesBowl(clusterName: string, qtyByWeek: number[]): OzonSalesRow[] {
  return WEEKS13.map((week, i) => ({ week, cabinet: 'test', offerId: ART, clusterName, qty: qtyByWeek[i], updatedAt: '', days: 7 }));
}
function stockRowBowl(clusterId: string, clusterName: string, available: number): OzonStockRow {
  return {
    cabinet: 'test', sku: '', offerId: ART, name: ART, warehouseName: 'W', clusterName, clusterId,
    available, preparing: 0, requested: 0, transit: 0, excess: 0, returns: 0, other: 0, updatedAt: ''
  };
}
function settingsBowl(over: Partial<OzonCoverageSettings> = {}): OzonCoverageSettings {
  return {
    speedWeeks: 4, minStockDays: 7, targetStockDays: 20, maxClusterDays: 0, factoryOrderDays: 14,
    returnsToSalePct: 0, excludedClusters: '', trendWeeks: 13, deficitDays: 0, bestWeeks: 4,
    minSalesForCorrection: 50, maxSpeedGrowth: 0, ...over
  };
}
function runBowl(over: Partial<OzonCoverageInput> = {}) {
  const input: OzonCoverageInput = {
    stocks: [stockRowBowl('C1', 'Москва', 0), stockRowBowl('C2', 'Казань', 300)],
    sales: [...seriesBowl('Москва', MOSCOW13), ...seriesBowl('Казань', KAZAN13)],
    skus: skusBowl, clusters: clustersBowl, settings: settingsBowl(), myStockAvailability: { [ART]: 1000 }, now: NOW2,
    ...over
  };
  const art = buildOzonCoverage(input).articles.find((a) => a.article === ART)!;
  const moscow = art.clusters.find((c) => c.clusterId === 'C1')!;
  const kazan = art.clusters.find((c) => c.clusterId === 'C2')!;
  return { art, moscow, kazan };
}

describe('buildOzonCoverage: item 86 step B, whole path', () => {
  it('a cluster empty in the short 4-week speed window but selling across the 13-week share window gets its share and a correctly sized recommendation', () => {
    const { art, moscow, kazan } = runBowl();
    const moscowShare = MOSCOW_WINDOW_QTY / TOTAL_WINDOW_QTY;
    const kazanShare = KAZAN_WINDOW_QTY / TOTAL_WINDOW_QTY;
    expect(moscow.perDay).toBeCloseTo(art.perDay * moscowShare, 10);
    expect(kazan.perDay).toBeCloseTo(art.perDay * kazanShare, 10);
    expect(moscow.perDay + kazan.perDay).toBeCloseTo(art.perDay, 10);

    // Moscow itself sold nothing in the short window (qtySold reflects the SHORT window).
    expect(moscow.qtySold).toBe(8); // last 4 weeks: 2+2+2+2
    expect(moscow.recommendation).not.toBeNull();
    const need = moscow.perDay * settingsBowl().targetStockDays; // estimated 0
    const expectedQty = Math.ceil(need / 10) * 10; // box of 10
    expect(moscow.recommendation!.qty).toBe(expectedQty);
    expect(moscow.speedSharePct).toBeCloseTo(moscowShare * 100, 6);
  });

  it('an excluded cluster gets no recommendation, and its share is NOT redistributed to the others', () => {
    const withoutExclusion = runBowl();
    const withExclusion = runBowl({ settings: settingsBowl({ excludedClusters: 'C1' }) });
    expect(withExclusion.moscow.recommendation).toBeNull();
    expect(withExclusion.moscow.excluded).toBe(true);
    // Kazan's own speed/share is untouched by Moscow's exclusion.
    expect(withExclusion.kazan.perDay).toBeCloseTo(withoutExclusion.kazan.perDay, 10);
  });

  it('a cluster with genuinely no sales anywhere (and no stock row) gets no forced row', () => {
    const { art, kazan } = runBowl({ sales: seriesBowl('Москва', MOSCOW13), stocks: [stockRowBowl('C1', 'Москва', 0)] });
    expect(kazan).toBeUndefined();
    expect(art.perDay).toBeGreaterThan(0);
  });

  it('item 42 (deficit correction) lifting the article speed scales every cluster by its SHARE once, not lifted twice', () => {
    const { art, moscow, kazan } = runBowl({
      stocks: [stockRowBowl('C1', 'Москва', 0), stockRowBowl('C2', 'Казань', 0)],
      settings: settingsBowl({ deficitDays: 30 })
    });
    expect(art.speedCorrection).not.toBeNull(); // item 42 fired on the whole article
    expect(moscow.perDay).toBeCloseTo(art.perDay * (MOSCOW_WINDOW_QTY / TOTAL_WINDOW_QTY), 10);
    expect(kazan.perDay).toBeCloseTo(art.perDay * (KAZAN_WINDOW_QTY / TOTAL_WINDOW_QTY), 10);
    expect(moscow.perDay + kazan.perDay).toBeCloseTo(art.perDay, 10);
  });
});

// ===== Generated invariants (500 sets, multi-cluster) =====

describe('item 86 step B: generated invariants (500 sets, 1–3 clusters)', () => {
  it('shares sum to the article speed; no recommendation breaches maxClusterDays; recommendation qty never exceeds free stock; coverageTone parity holds', () => {
    let seed = 4269;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const WEEKS_G = getLastFullWeeks(NOW2, 13);
    for (let n = 0; n < 500; n++) {
      const clusterCount = 1 + Math.floor(rnd() * 3); // 1..3
      const clustersG = Array.from({ length: clusterCount }, (_, i) => ({ clusterId: `G${i}`, clusterName: `Cluster${i}` }));
      const perWeekByCluster = clustersG.map(() => Math.floor(rnd() * 20));
      const salesG: OzonSalesRow[] = clustersG.flatMap((c, i) =>
        WEEKS_G.map((week) => ({ week, cabinet: 'g', offerId: 'G', clusterName: c.clusterName, qty: perWeekByCluster[i], updatedAt: '', days: 7 }))
      );
      const stocksG: OzonStockRow[] = clustersG.map((c) => ({
        cabinet: 'g', sku: '', offerId: 'G', name: 'G', warehouseName: 'W', clusterName: c.clusterName, clusterId: c.clusterId,
        available: Math.floor(rnd() * 50), preparing: 0, requested: 0, transit: Math.floor(rnd() * 10), excess: 0, returns: 0, other: 0, updatedAt: ''
      }));
      // targetStockDays is 15 below; keep maxClusterDays either off or comfortably above it —
      // a ceiling BELOW the target is a documented settings mismatch (calcSupplyRecommendation's
      // own "insurance" clause), where coverageTone and the recommendation legitimately disagree,
      // and that exception is not what this invariant is about.
      const maxClusterDays = rnd() < 0.5 ? 0 : Math.floor(rnd() * 60) + 20;
      const myStock = Math.floor(rnd() * 200);
      const settingsG: OzonCoverageSettings = {
        speedWeeks: 4, minStockDays: 5, targetStockDays: 15, maxClusterDays, factoryOrderDays: 14,
        returnsToSalePct: 0, excludedClusters: '', trendWeeks: 13, deficitDays: 0, demandGrowthPct: 0
      };
      const skusG: SKUItem[] = [{ sku: 'G', price: 0, minStock: 0, pcsPerBox: 3, boxesPerPallet: 0, volumeLiters: 0, leadTimeDays: 0 }];
      const res = buildOzonCoverage({
        stocks: stocksG, sales: salesG, skus: skusG, clusters: clustersG, settings: settingsG,
        myStockAvailability: { G: myStock }, now: NOW2
      });
      const art = res.articles.find((a) => a.article === 'G');
      if (!art) continue;

      if (art.perDay > 0) {
        const sumPerDay = art.clusters.reduce((s, c) => s + c.perDay, 0);
        expect(sumPerDay, `set ${n}`).toBeCloseTo(art.perDay, 6);
      }

      for (const c of art.clusters) {
        if (maxClusterDays > 0 && c.recommendation && c.perDay > 0) {
          const daysAfter = (c.estimated + c.recommendation.qty) / c.perDay;
          expect(daysAfter, `set ${n} cluster ${c.clusterId}`).toBeLessThanOrEqual(maxClusterDays + 1e-6);
        }
        const tone = coverageTone(c.estimated, c.perDay, settingsG, c.priorityK, c.excluded);
        if (c.perDay > 0) {
          expect(tone === 'amber' || tone === 'red', `set ${n} cluster ${c.clusterId}`).toBe(c.recommendation !== null);
        } else {
          expect(tone, `set ${n} cluster ${c.clusterId}`).toBe('none');
        }
      }

      const totalRecommendedQty = art.clusters.reduce((s, c) => s + (c.recommendation ? c.recommendation.qty : 0), 0);
      expect(totalRecommendedQty, `set ${n}`).toBeLessThanOrEqual(art.shippableMyStock + 1e-6);
    }
  });
});

// ===== Display: the tooltip shows the share formula =====

describe('item 86 step B: display', () => {
  it('the cluster speed tooltip shows the share formula and its fields; the item-72 correction badge is gone', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src/components/OzonStocksTab.tsx'), 'utf8');
    expect(src).toContain('Скорость кластера = скорость товара × доля кластера в продажах за');
    expect(src).toContain('cls.shareWindowWeeks');
    expect(src).toContain('cls.speedSharePct.toFixed(1)');
    expect(src).not.toContain('cls.speedCorrection');
    expect(src).not.toContain('ClusterSpeedCorrectionInfo');
  });

  it('the «Доля» column shows the share the speed is computed from, not a second short-window share', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src/components/OzonStocksTab.tsx'), 'utf8');
    expect(src).toContain("{isColVisible('share') && <td className=\"p-2.5 text-right text-slate-600\">{cls.speedSharePct > 0 ? `${cls.speedSharePct.toFixed(1)}%` : '—'}</td>}");
    expect(src).toContain('Скорость кластера = скорость товара × эта доля');
    expect(src).not.toMatch(/cls\.sharePct\b/);
  });

  it('the library exports no trace of item 72 (removed together with its badge and tests)', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src/lib/ozonCoverage.ts'), 'utf8');
    expect(src).not.toContain('applyClusterDeficitSpeedCorrection');
    expect(src).not.toContain('ClusterSpeedCorrectionInfo');
  });
});
