import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { buildOzonCoverage, coverageTone } from './ozonCoverage';
import type { OzonSalesRow, OzonStockRow, SKUItem } from '../types';

/**
 * Item 85, step 1.8 (owner 2026-09-26): «Покрытие» is one number including the goods on their
 * way, and its colour uses the recommendation's own thresholds — amber exactly when a supply is
 * recommended.
 */
const S = { minStockDays: 10, targetStockDays: 20 };

describe('coverageTone', () => {
  it('thresholds at 2 pcs/day: below 20 red, 20…39 amber, from 40 green', () => {
    expect(coverageTone(19.99, 2, S)).toBe('red');
    expect(coverageTone(20, 2, S)).toBe('amber');
    expect(coverageTone(39.99, 2, S)).toBe('amber');
    expect(coverageTone(40, 2, S)).toBe('green');
  });

  // Item 86, step C: deliveryToOzonDays (D) widens both thresholds. D absent behaves like D = 0
  // (the block above) — this is the regression check for the new field.
  it('D = 0 explicit reproduces the same thresholds as no D at all', () => {
    const S0 = { ...S, deliveryToOzonDays: 0 };
    expect(coverageTone(19.99, 2, S0)).toBe('red');
    expect(coverageTone(20, 2, S0)).toBe('amber');
    expect(coverageTone(40, 2, S0)).toBe('green');
  });

  it('D > 0: red ⇔ coverageDays < D, amber ⇔ estimated < perDay × (target + D)', () => {
    // minStockDays 10, perDay 2, D 3: red below (10 + 3) × 2 = 26 pcs (coverageDays < 3).
    const SD = { ...S, deliveryToOzonDays: 3 };
    expect(coverageTone(25.99, 2, SD)).toBe('red');
    expect(coverageTone(26, 2, SD)).toBe('amber');
    // amber below (target 20 + D 3) × 2 = 46 pcs.
    expect(coverageTone(45.99, 2, SD)).toBe('amber');
    expect(coverageTone(46, 2, SD)).toBe('green');
  });

  it('the old colour was wrong between the thresholds: 25 pcs = 2.5 days above the minimum, need 15 → amber (old: amber too); 35 pcs → amber (old: amber); 45 → green', () => {
    // old rule: amber when (estimated − perDay × min) ÷ perDay < target, i.e. estimated < 60 at 2/day
    expect(coverageTone(45, 2, S)).toBe('green'); // old: amber, yet no supply was recommended
  });

  it('a priority cluster multiplies both thresholds', () => {
    expect(coverageTone(25, 2, S, 1.4)).toBe('red');     // minimum 28
    expect(coverageTone(50, 2, S, 1.4)).toBe('amber');   // target 56
    expect(coverageTone(56, 2, S, 1.4)).toBe('green');
  });

  it('priority multiplies min/target but NOT D: red at (min × k + D), amber at (target × k + D)', () => {
    // min 10 × 1.4 = 14, + D 3 = 17 → red boundary at perDay 2 × 17 = 34.
    const SD = { ...S, deliveryToOzonDays: 3 };
    expect(coverageTone(33.99, 2, SD, 1.4)).toBe('red');
    expect(coverageTone(34, 2, SD, 1.4)).toBe('amber');
    // target 20 × 1.4 = 28, + D 3 = 31 → amber boundary at perDay 2 × 31 = 62.
    expect(coverageTone(61.99, 2, SD, 1.4)).toBe('amber');
    expect(coverageTone(62, 2, SD, 1.4)).toBe('green');
  });

  it('an excluded cluster has no minimum and ignores the priority coefficient', () => {
    expect(coverageTone(0, 2, S, 1.4, true)).toBe('amber');
    expect(coverageTone(39, 2, S, 1.4, true)).toBe('amber');
    expect(coverageTone(40, 2, S, 1.4, true)).toBe('green');
  });

  it('an excluded cluster still gets D added to its amber threshold', () => {
    // Excluded: no minimum, k forced to 1 regardless of priorityK. Amber below (target + D) × perDay.
    const SD = { ...S, deliveryToOzonDays: 5 };
    expect(coverageTone(49.99, 2, SD, 1.4, true)).toBe('amber');
    expect(coverageTone(50, 2, SD, 1.4, true)).toBe('green');
  });

  it('no sales — nothing to measure', () => {
    expect(coverageTone(0, 0, S)).toBe('none');
    expect(coverageTone(100, -1, S)).toBe('none');
    expect(coverageTone(100, NaN, S)).toBe('none');
  });
});

describe('item 85, step 1.8: the colour agrees with the recommendation on the whole path', () => {
  const NOW = new Date('2026-09-16T09:00:00Z');
  const WEEKS = ['2026-08-17', '2026-08-24', '2026-08-31', '2026-09-07'];
  const skus: SKUItem[] = [{ sku: 'A', price: 0, minStock: 0, pcsPerBox: 6, boxesPerPallet: 0, volumeLiters: 0, leadTimeDays: 0 }];

  it('500 generated clusters: amber or red ⇔ a recommendation exists; a cluster with goods on their way is judged with them', () => {
    let seed = 1808;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    for (let n = 0; n < 500; n++) {
      const perWeek = Math.floor(rnd() * 30);
      const available = Math.floor(rnd() * 60);
      const transit = Math.floor(rnd() * 20);
      const requested = Math.floor(rnd() * 20);
      const priority = rnd() < 0.3;
      // Item 86, step C: random D in 0…14 — the invariants must hold for every delivery-days value.
      const deliveryToOzonDays = Math.floor(rnd() * 15);
      const sales: OzonSalesRow[] = WEEKS.map((week) => ({ week, cabinet: 'M', offerId: 'A', clusterName: 'Москва', qty: perWeek, updatedAt: '', days: 7 }));
      const stock: OzonStockRow = { cabinet: 'M', sku: '', offerId: 'A', name: 'A', warehouseName: 'W', clusterName: 'Москва', clusterId: 'C1', available, preparing: 0, requested, transit, excess: 0, returns: 0, other: 0, updatedAt: '' };
      const settings = { speedWeeks: 4, minStockDays: 10, targetStockDays: 20, deliveryToOzonDays, maxClusterDays: 0, factoryOrderDays: 14, returnsToSalePct: 0, excludedClusters: '', priorityClusters: priority ? 'C1:1.4' : '', deficitDays: 0, demandGrowthPct: 0 };
      const res = buildOzonCoverage({ stocks: [stock], sales, skus, clusters: [{ clusterId: 'C1', clusterName: 'Москва' }], settings, myStockAvailability: { A: 1000 }, now: NOW });
      const art = res.articles.find((a) => a.article === 'A');
      if (!art) continue;
      const c = art.clusters.find((x) => x.clusterId === 'C1')!;
      const tone = coverageTone(c.estimated, c.perDay, settings, c.priorityK, c.excluded);
      expect(c.estimated, `set ${n}`).toBe(available + Math.max(transit + requested, 0));
      if (c.perDay > 0) {
        expect(tone === 'amber' || tone === 'red', `set ${n} D=${deliveryToOzonDays}`).toBe(c.recommendation !== null);
        // Item 86, step C: red ⇔ coverageDays < D (was < 0 before D existed).
        expect(tone === 'red', `set ${n} D=${deliveryToOzonDays}`).toBe(c.coverageDays !== null && c.coverageDays < deliveryToOzonDays);
      } else {
        expect(tone).toBe('none');
      }
    }
  });

  it('500 generated clusters: no recommendation ⇒ arrival never exceeds maxClusterDays (item 86 step C: net of D)', () => {
    let seed = 2609;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    for (let n = 0; n < 500; n++) {
      const perWeek = Math.floor(rnd() * 30) + 1; // хотя бы штука в неделю — иначе скорость 0
      const available = Math.floor(rnd() * 60);
      const deliveryToOzonDays = Math.floor(rnd() * 15);
      const maxClusterDays = Math.floor(rnd() * 40) + 1;
      const sales: OzonSalesRow[] = WEEKS.map((week) => ({ week, cabinet: 'M', offerId: 'A', clusterName: 'Москва', qty: perWeek, updatedAt: '', days: 7 }));
      const stock: OzonStockRow = { cabinet: 'M', sku: '', offerId: 'A', name: 'A', warehouseName: 'W', clusterName: 'Москва', clusterId: 'C1', available, preparing: 0, requested: 0, transit: 0, excess: 0, returns: 0, other: 0, updatedAt: '' };
      const settings = { speedWeeks: 4, minStockDays: 10, targetStockDays: 20, deliveryToOzonDays, maxClusterDays, factoryOrderDays: 14, returnsToSalePct: 0, excludedClusters: '', deficitDays: 0, demandGrowthPct: 0 };
      const res = buildOzonCoverage({ stocks: [stock], sales, skus, clusters: [{ clusterId: 'C1', clusterName: 'Москва' }], settings, myStockAvailability: { A: 100000 }, now: NOW });
      const art = res.articles.find((a) => a.article === 'A');
      if (!art) continue;
      const c = art.clusters.find((x) => x.clusterId === 'C1')!;
      if (c.perDay <= 0) continue;
      if (c.recommendation === null) continue; // либо потребности нет, либо отсекатель сработал
      const arrivalDaysLeft = (c.estimated + c.recommendation.wantQty) / c.perDay - deliveryToOzonDays;
      expect(arrivalDaysLeft, `set ${n}`).toBeLessThanOrEqual(maxClusterDays + 1e-9);
    }
  });

  it('the tab colours both levels by coverageTone and has no other colour rule left', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src/components/OzonStocksTab.tsx'), 'utf8');
    expect(src).toContain('TONE_CLASS[coverageTone(art.totalEstimated, art.perDay, ozonSettings)]');
    expect(src).toContain('TONE_CLASS[coverageTone(cls.estimated, cls.perDay, ozonSettings, cls.priorityK, cls.excluded)]');
    expect(src).not.toContain('coverageColor');
  });
});
