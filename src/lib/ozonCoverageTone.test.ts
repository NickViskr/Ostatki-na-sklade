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

  it('the old colour was wrong between the thresholds: 25 pcs = 2.5 days above the minimum, need 15 → amber (old: amber too); 35 pcs → amber (old: amber); 45 → green', () => {
    // old rule: amber when (estimated − perDay × min) ÷ perDay < target, i.e. estimated < 60 at 2/day
    expect(coverageTone(45, 2, S)).toBe('green'); // old: amber, yet no supply was recommended
  });

  it('a priority cluster multiplies both thresholds', () => {
    expect(coverageTone(25, 2, S, 1.4)).toBe('red');     // minimum 28
    expect(coverageTone(50, 2, S, 1.4)).toBe('amber');   // target 56
    expect(coverageTone(56, 2, S, 1.4)).toBe('green');
  });

  it('an excluded cluster has no minimum and ignores the priority coefficient', () => {
    expect(coverageTone(0, 2, S, 1.4, true)).toBe('amber');
    expect(coverageTone(39, 2, S, 1.4, true)).toBe('amber');
    expect(coverageTone(40, 2, S, 1.4, true)).toBe('green');
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
      const sales: OzonSalesRow[] = WEEKS.map((week) => ({ week, cabinet: 'M', offerId: 'A', clusterName: 'Москва', qty: perWeek, updatedAt: '', days: 7 }));
      const stock: OzonStockRow = { cabinet: 'M', sku: '', offerId: 'A', name: 'A', warehouseName: 'W', clusterName: 'Москва', clusterId: 'C1', available, preparing: 0, requested, transit, excess: 0, returns: 0, other: 0, updatedAt: '' };
      const settings = { speedWeeks: 4, minStockDays: 10, targetStockDays: 20, maxClusterDays: 0, factoryOrderDays: 14, returnsToSalePct: 0, excludedClusters: '', priorityClusters: priority ? 'C1:1.4' : '', deficitDays: 0, demandGrowthPct: 0 };
      const res = buildOzonCoverage({ stocks: [stock], sales, skus, clusters: [{ clusterId: 'C1', clusterName: 'Москва' }], settings, myStockAvailability: { A: 1000 }, now: NOW });
      const art = res.articles.find((a) => a.article === 'A');
      if (!art) continue;
      const c = art.clusters.find((x) => x.clusterId === 'C1')!;
      const tone = coverageTone(c.estimated, c.perDay, settings, c.priorityK, c.excluded);
      expect(c.estimated, `set ${n}`).toBe(available + Math.max(transit + requested, 0));
      if (c.perDay > 0) {
        expect(tone === 'amber' || tone === 'red', `set ${n}`).toBe(c.recommendation !== null);
        expect(tone === 'red', `set ${n}`).toBe(c.coverageDays !== null && c.coverageDays < 0);
      } else {
        expect(tone).toBe('none');
      }
    }
  });

  it('the tab colours both levels by coverageTone and has no other colour rule left', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src/components/OzonStocksTab.tsx'), 'utf8');
    expect(src).toContain('TONE_CLASS[coverageTone(art.totalEstimated, art.perDay, ozonSettings)]');
    expect(src).toContain('TONE_CLASS[coverageTone(cls.estimated, cls.perDay, ozonSettings, cls.priorityK, cls.excluded)]');
    expect(src).not.toContain('coverageColor');
  });
});
