import { describe, expect, it } from 'vitest';
import {
  buildOzonCoverage,
  getLastFullWeeks,
  OzonClusterRef,
  OzonCoverageInput,
  OzonCoverageSettings
} from './ozonCoverage';
import { OzonSalesRow, OzonStockHistoryRow, OzonStockRow, SKUItem } from '../types';

/**
 * Independent tester's own invariant suite for item 86 (stages A–D), covering the whole
 * `buildOzonCoverage` path across randomised combinations of every stage-2 setting at once
 * (deliveryToOzonDays, priorityClusters, excludedClusters, maxClusterDays, deficitDays,
 * demandGrowthPct, with and without `stockHistory`) — the coders' own generated-invariant tests
 * (`ozonClusterShare.test.ts`, `ozonCoverageTone.test.ts`, `ozonCoverageHistory.test.ts`) each vary
 * a narrower slice; this file exercises them together and adds determinism / no-mutation checks
 * that were not covered anywhere.
 */

const NOW = new Date('2024-01-10T10:00:00Z'); // Wednesday; current Monday МСК = 2024-01-08

function makeSku(overrides: Partial<SKUItem> & { sku: string }): SKUItem {
  return { price: 0, minStock: 0, pcsPerBox: 1, boxesPerPallet: 1, volumeLiters: 0, leadTimeDays: 0, ...overrides };
}

function hist(week: string, offerId: string, overrides: Partial<OzonStockHistoryRow> = {}): OzonStockHistoryRow {
  return {
    week, cabinet: 'M', offerId, clusterId: '', clusterName: '', daysInStock: 7, daysObserved: 7,
    lastDay: '', updatedAt: '', ...overrides
  };
}

function deepFreeze<T>(obj: T): T {
  if (obj && typeof obj === 'object') {
    Object.values(obj as Record<string, unknown>).forEach((v) => deepFreeze(v));
    return Object.freeze(obj);
  }
  return obj;
}

/** Asserts a value is a finite, non-negative number (Infinity/NaN/negative are all defects). */
function expectFiniteNonNegative(value: unknown, label: string) {
  expect(typeof value === 'number' && Number.isFinite(value), `${label} must be a finite number, got ${value}`).toBe(true);
  expect(value as number, `${label} must not be negative`).toBeGreaterThanOrEqual(-1e-9);
}

describe('item 86 (stages A-D): combined money invariants over 1000 randomised configurations', () => {
  let seed = 987654321;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };

  const clustersG: OzonClusterRef[] = [
    { clusterId: 'C1', clusterName: 'Москва' },
    { clusterId: 'C2', clusterName: 'Юг' },
    { clusterId: 'C3', clusterName: 'Урал' }
  ];
  const speedWeeks = getLastFullWeeks(NOW, 4);
  const trendWeeks26 = getLastFullWeeks(NOW, 26);

  for (let n = 0; n < 1000; n++) {
    it(`set ${n}: all invariants hold`, () => {
      const pcsPerBox = 1 + Math.floor(rnd() * 8);
      const leadTimeDays = Math.floor(rnd() * 10);
      const skusG: SKUItem[] = [makeSku({ sku: 'A', pcsPerBox, leadTimeDays })];

      const useHistory = rnd() < 0.5;
      const clusterCount = 1 + Math.floor(rnd() * clustersG.length);
      const chosenClusters = clustersG.slice(0, clusterCount);

      const perWeekByCluster = chosenClusters.map(() => Math.floor(rnd() * 25));
      const daysInStockByCluster = chosenClusters.map(() => Math.floor(rnd() * 8));

      const salesG: OzonSalesRow[] = chosenClusters.flatMap((c, i) =>
        trendWeeks26.map((week) => ({
          week, cabinet: 'g', offerId: 'A', clusterName: c.clusterName,
          qty: perWeekByCluster[i], updatedAt: '', days: 7
        }))
      );
      const stocksG: OzonStockRow[] = chosenClusters.map((c) => ({
        cabinet: 'g', sku: '', offerId: 'A', name: 'A', warehouseName: 'W',
        clusterName: c.clusterName, clusterId: c.clusterId,
        available: Math.floor(rnd() * 60), preparing: 0, requested: Math.floor(rnd() * 10),
        transit: Math.floor(rnd() * 10), excess: 0, returns: 0, other: 0, updatedAt: ''
      }));
      const historyG: OzonStockHistoryRow[] = useHistory
        ? chosenClusters.flatMap((c, i) =>
            trendWeeks26.map((week) => hist(week, 'A', { clusterId: c.clusterId, clusterName: c.clusterName, daysInStock: daysInStockByCluster[i], daysObserved: 7 }))
          )
        : [];

      const deliveryToOzonDays = Math.floor(rnd() * 12);
      const maxClusterDays = rnd() < 0.4 ? 0 : Math.floor(rnd() * 60) + 25;
      const deficitDays = rnd() < 0.5 ? 0 : Math.floor(rnd() * 10) + 1;
      const demandGrowthPct = rnd() < 0.5 ? 0 : Math.floor(rnd() * 40) + 10;
      const excluded = rnd() < 0.2 ? chosenClusters[0].clusterId : '';
      const priority = rnd() < 0.3 && chosenClusters.length > 1 ? `${chosenClusters[1].clusterId}:1.5` : '';

      const settingsG: OzonCoverageSettings = {
        speedWeeks: 4, minStockDays: 5, targetStockDays: 15, maxClusterDays, factoryOrderDays: 20,
        returnsToSalePct: Math.floor(rnd() * 60), excludedClusters: excluded, priorityClusters: priority,
        deficitDays, trendWeeks: 13, bestWeeks: 4, minSalesForCorrection: 0, maxSpeedGrowth: 5,
        demandGrowthPct, deliveryToOzonDays
      };
      const myStock = Math.floor(rnd() * 500);

      const input: OzonCoverageInput = {
        stocks: stocksG, sales: salesG, skus: skusG, clusters: chosenClusters, settings: settingsG,
        myStockAvailability: { A: myStock }, now: NOW, stockHistory: historyG
      };

      // Snapshot the input arrays deep-frozen: buildOzonCoverage must not mutate them at all.
      const inputSnapshot = JSON.parse(JSON.stringify({ stocksG, salesG, skusG, chosenClusters, historyG }));
      deepFreeze(stocksG);
      deepFreeze(salesG);
      deepFreeze(skusG);
      deepFreeze(chosenClusters);
      deepFreeze(historyG);

      const result = buildOzonCoverage(input);
      const art = result.articles.find((a) => a.article === 'A');
      if (!art) return;

      // Input arrays are byte-for-byte the same after the call (deep-freeze would have thrown
      // synchronously on any attempted mutation, but a structural check is a second guard).
      expect({ stocksG, salesG, skusG, chosenClusters, historyG }).toEqual(inputSnapshot);

      // ---- No NaN/Infinity/negative anywhere in the numeric fields of the result. ----
      expectFiniteNonNegative(art.perDay, `set ${n} art.perDay`);
      expectFiniteNonNegative(art.forecastPerDay, `set ${n} art.forecastPerDay`);
      expectFiniteNonNegative(art.totalEstimated, `set ${n} art.totalEstimated`);
      expectFiniteNonNegative(art.freeMyStock, `set ${n} art.freeMyStock`);
      expectFiniteNonNegative(art.shippableMyStock, `set ${n} art.shippableMyStock`);
      expectFiniteNonNegative(art.speedDaysInStock, `set ${n} art.speedDaysInStock`);
      expectFiniteNonNegative(art.speedWindowDays, `set ${n} art.speedWindowDays`);
      expectFiniteNonNegative(art.speedSoldQty, `set ${n} art.speedSoldQty`);
      for (const c of art.clusters) {
        expectFiniteNonNegative(c.perDay, `set ${n} cluster ${c.clusterId} perDay`);
        expectFiniteNonNegative(c.estimated, `set ${n} cluster ${c.clusterId} estimated`);
        expectFiniteNonNegative(c.speedSharePct, `set ${n} cluster ${c.clusterId} speedSharePct`);
        if (c.recommendation) {
          expectFiniteNonNegative(c.recommendation.qty, `set ${n} cluster ${c.clusterId} recommendation.qty`);
          expectFiniteNonNegative(c.recommendation.wantQty, `set ${n} cluster ${c.clusterId} recommendation.wantQty`);
        }
      }
      if (art.factory) {
        expectFiniteNonNegative(art.factory.orderQty, `set ${n} factory.orderQty`);
        expectFiniteNonNegative(art.factory.daysLeft, `set ${n} factory.daysLeft`);
        expectFiniteNonNegative(art.factory.pipelineQty, `set ${n} factory.pipelineQty`);
      }

      // ---- Σ cluster speeds = article speed (pure redistribution, item 86 step B/D). ----
      const sumPerDay = art.clusters.reduce((s, c) => s + c.perDay, 0);
      if (art.perDay > 0) expect(sumPerDay, `set ${n}`).toBeCloseTo(art.perDay, 6);

      // ---- recommendation <= shippable stock (item 51 / item 85 step 1.6). ----
      const totalRecommendedQty = art.clusters.reduce((s, c) => s + (c.recommendation ? c.recommendation.qty : 0), 0);
      expect(totalRecommendedQty, `set ${n}`).toBeLessThanOrEqual(art.shippableMyStock + 1e-6);

      // ---- No cluster's arrival breaches maxClusterDays, net of D (item 86 step C). ----
      if (maxClusterDays > 0) {
        for (const c of art.clusters) {
          if (!c.recommendation || !(c.perDay > 0)) continue;
          const arrivalDaysLeft = (c.estimated + c.recommendation.wantQty) / c.perDay - deliveryToOzonDays;
          expect(arrivalDaysLeft, `set ${n} cluster ${c.clusterId}`).toBeLessThanOrEqual(maxClusterDays + 1e-6);
        }
      }

      // ---- Factory orderQty is a whole number of boxes, and 0 exactly when pipeline >= threshold. ----
      if (art.factory) {
        const boxesFloat = art.factory.orderQty / pcsPerBox;
        expect(Math.round(boxesFloat), `set ${n} orderQty must be a multiple of the box`).toBeCloseTo(boxesFloat, 6);
        if (art.factory.pipelineQty >= art.factory.thresholdQty - 1e-9 && art.factory.reason === 'total') {
          expect(art.factory.orderQty, `set ${n} pipeline >= threshold => no order`).toBe(0);
        }
      }

      // ---- Determinism: the exact same input, called again, gives a deep-equal result. ----
      const result2 = buildOzonCoverage(input);
      const art2 = result2.articles.find((a) => a.article === 'A');
      expect(art2, `set ${n} determinism`).toEqual(art);
    });
  }
});
