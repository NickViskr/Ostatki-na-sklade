import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { buildOzonCoverage, type OzonCoverageInput, type OzonPendingLike } from './ozonCoverage';
import type { KitItem, OzonSalesRow, OzonStockRow, SKUItem } from '../types';

/**
 * Item 85, step 1.6 (audit 2026-09-26). BowlGrayMini_01 and BowlBlueMini_01 share «Бутылки» and
 * «Пакеты». Each kit used to count ALL the bottles as its own, so the recommendations of the two
 * kits together could exceed the bottles on the shelf, and a supply of one kit did not lower
 * the other. Now the reserve is taken per physical piece and a short shared component is split
 * between the kits in proportion to their need.
 */
const NOW = new Date('2026-09-16T09:00:00Z');
const WEEKS = ['2026-08-17', '2026-08-24', '2026-08-31', '2026-09-07'];
const GRAY = 'GRAY';
const BLUE = 'BLUE';
const KITS: KitItem[] = [
  { kitSku: GRAY, type: 'virtual', components: [{ componentSku: 'BowlGray', quantity: 1 }, { componentSku: 'Бутылки', quantity: 1 }] },
  { kitSku: BLUE, type: 'virtual', components: [{ componentSku: 'BowlBlue', quantity: 1 }, { componentSku: 'Бутылки', quantity: 2 }] }
];
const sku = (s: string): SKUItem => ({ sku: s, price: 0, minStock: 0, pcsPerBox: 1, boxesPerPallet: 0, volumeLiters: 0, leadTimeDays: 0 });
const SKUS = [GRAY, BLUE, 'BowlGray', 'BowlBlue', 'Бутылки'].map(sku);

/** perDay × 20 days of target on an empty cluster = the need. */
function sales(article: string, perDay: number): OzonSalesRow[] {
  return WEEKS.map((week) => ({ week, cabinet: 'M', offerId: article, clusterName: 'Москва', qty: perDay * 7, updatedAt: '', days: 7 }));
}
const emptyStock = (article: string): OzonStockRow => ({
  cabinet: 'M', sku: '', offerId: article, name: article, warehouseName: 'W', clusterName: 'Москва', clusterId: 'C1',
  available: 0, preparing: 0, requested: 0, transit: 0, excess: 0, returns: 0, other: 0, updatedAt: ''
});

function input(stock: Record<string, number>, over: Partial<OzonCoverageInput> = {}, speeds: Record<string, number> = { [GRAY]: 1.5, [BLUE]: 0.75 }): OzonCoverageInput {
  return {
    stocks: Object.keys(speeds).map(emptyStock),
    sales: Object.keys(speeds).flatMap((a) => sales(a, speeds[a])),
    skus: SKUS, clusters: [{ clusterId: 'C1', clusterName: 'Москва' }],
    settings: { speedWeeks: 4, minStockDays: 7, targetStockDays: 20, maxClusterDays: 0, factoryOrderDays: 14, returnsToSalePct: 0, excludedClusters: '', deficitDays: 0, demandGrowthPct: 0 },
    myStockAvailability: stock, kits: KITS, now: NOW, ...over
  };
}
const recOf = (res: ReturnType<typeof buildOzonCoverage>, article: string) => {
  const a = res.articles.find((x) => x.article === article)!;
  return a.clusters.reduce((s, c) => s + (c.recommendation ? c.recommendation.qty : 0), 0);
};

describe('item 85, step 1.6: shared components are split between the kits', () => {
  it('нехватки нет — каждый комплект получает всю свою потребность (GRAY 30, BLUE 15)', () => {
    const res = buildOzonCoverage(input({ BowlGray: 100, BowlBlue: 100, 'Бутылки': 100 }));
    expect(recOf(res, GRAY)).toBe(30);
    expect(recOf(res, BLUE)).toBe(15);
    expect(res.articles.find((a) => a.article === GRAY)!.sharedLimitedBy).toEqual([]);
  });

  it('бутылок 30 на потребность 60: делятся пропорционально — GRAY 16, BLUE 7 (16 + 14 = 30 бутылок)', () => {
    const res = buildOzonCoverage(input({ BowlGray: 100, BowlBlue: 100, 'Бутылки': 30 }));
    expect(recOf(res, GRAY)).toBe(16);
    expect(recOf(res, BLUE)).toBe(7);
    expect(recOf(res, GRAY) * 1 + recOf(res, BLUE) * 2).toBeLessThanOrEqual(30);
    const gray = res.articles.find((a) => a.article === GRAY)!;
    expect(gray.freeMyStock).toBe(30);          // on its own GRAY could take all 30
    expect(gray.shippableMyStock).toBe(16);     // its share of the bottles
    expect(gray.sharedLimitedBy).toEqual(['Бутылки']);
  });

  it('до правки каждый комплект видел все 30 бутылок: вместе 30 + 15 × 2 = 60 — вдвое больше полки', () => {
    // The same numbers without kits: each «kit» is its own article with 30 free — the old view.
    const res = buildOzonCoverage(input({ [GRAY]: 30, [BLUE]: 15 }, { kits: [] }));
    expect(recOf(res, GRAY) * 1 + recOf(res, BLUE) * 2).toBe(60);
  });

  it('у BLUE своих мисок всего 5: он просит 5, остальное уходит GRAY — GRAY 24, BLUE 3', () => {
    const res = buildOzonCoverage(input({ BowlGray: 100, BowlBlue: 5, 'Бутылки': 30 }));
    expect(recOf(res, BLUE)).toBeLessThanOrEqual(5);
    expect(recOf(res, GRAY)).toBe(24);
    expect(recOf(res, BLUE)).toBe(3);
    expect(recOf(res, GRAY) + recOf(res, BLUE) * 2).toBe(30);
  });

  it('резерв одного комплекта уменьшает другой: GRAY занял 8 бутылок из 10 — BLUE (норма 2) свободно 1', () => {
    const pending: OzonPendingLike = { byArticle: { [GRAY]: 8 }, byArticleCluster: {} };
    const res = buildOzonCoverage(input({ BowlGray: 100, BowlBlue: 100, 'Бутылки': 10 }, { pending }));
    const blue = res.articles.find((a) => a.article === BLUE)!;
    expect(blue.freeMyStock).toBe(1);
    expect(recOf(res, BLUE)).toBeLessThanOrEqual(1);
    expect(res.articles.find((a) => a.article === GRAY)!.freeMyStock).toBe(2);
  });

  it('компонент продаётся и сам — он третий претендент на бутылки', () => {
    const res = buildOzonCoverage(input({ BowlGray: 100, BowlBlue: 100, 'Бутылки': 20 }, {}, { [GRAY]: 1, [BLUE]: 0.5, 'Бутылки': 0.5 }));
    const used = recOf(res, GRAY) + recOf(res, BLUE) * 2 + recOf(res, 'Бутылки');
    expect(used).toBeLessThanOrEqual(20);
    expect(recOf(res, 'Бутылки')).toBeGreaterThan(0);
  });

  it('резерв комплекта уменьшает свободный остаток самого компонента, если он продаётся отдельно', () => {
    const pending: OzonPendingLike = { byArticle: { [BLUE]: 4 }, byArticleCluster: {} };
    const res = buildOzonCoverage(input({ BowlGray: 100, BowlBlue: 100, 'Бутылки': 20 }, { pending }, { 'Бутылки': 0.5 }));
    expect(res.articles.find((a) => a.article === 'Бутылки')!.freeMyStock).toBe(12);
  });

  it('без остатка компонентов в данных — прежнее правило: доступность комплекта минус его резерв', () => {
    const pending: OzonPendingLike = { byArticle: { [GRAY]: 2 }, byArticleCluster: {} };
    const res = buildOzonCoverage(input({ [GRAY]: 12, [BLUE]: 9 }, { pending }));
    expect(res.articles.find((a) => a.article === GRAY)!.freeMyStock).toBe(10);
    expect(res.articles.find((a) => a.article === BLUE)!.freeMyStock).toBe(9);
  });

  it('legacy-комплект считается по своему остатку и в раздел бутылок не входит', () => {
    const kits: KitItem[] = [...KITS, { kitSku: 'LEG', type: 'legacy', components: [{ componentSku: 'Бутылки', quantity: 1 }] }];
    const res = buildOzonCoverage(input({ BowlGray: 100, BowlBlue: 100, 'Бутылки': 100, LEG: 7 }, { kits }, { [GRAY]: 1.5, LEG: 1 }));
    expect(res.articles.find((a) => a.article === 'LEG')!.freeMyStock).toBe(7);
    expect(recOf(res, 'LEG')).toBe(7);
    expect(recOf(res, GRAY)).toBe(30);
  });

  it('400 случайных наборов: бутылок и пакетов никогда не раздаётся больше, чем свободно', () => {
    let seed = 85016;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const int = (n: number) => Math.floor(rnd() * n);
    for (let n = 0; n < 400; n++) {
      const kits: KitItem[] = [
        { kitSku: 'K1', type: 'virtual', components: [{ componentSku: 'A', quantity: 1 + int(2) }, { componentSku: 'S1', quantity: 1 + int(3) }] },
        { kitSku: 'K2', type: 'virtual', components: [{ componentSku: 'B', quantity: 1 }, { componentSku: 'S1', quantity: 1 + int(3) }, { componentSku: 'S2', quantity: 1 + int(2) }] },
        { kitSku: 'K3', type: 'virtual', components: [{ componentSku: 'S2', quantity: 1 + int(2) }, { componentSku: 'S1', quantity: 1 }] }
      ];
      const stock: Record<string, number> = { A: int(80), B: int(80), S1: int(120), S2: int(90) };
      const speeds: Record<string, number> = { K1: int(4) / 2, K2: int(4) / 2, K3: int(4) / 2 };
      const reserve: Record<string, number> = { K1: int(10), K2: int(10), K3: int(3) };
      const res = buildOzonCoverage({
        ...input(stock, { kits, skus: ['K1', 'K2', 'K3', 'A', 'B', 'S1', 'S2'].map(sku), pending: { byArticle: reserve, byArticleCluster: {} } }, speeds)
      });
      const rec: Record<string, number> = { K1: recOf(res, 'K1'), K2: recOf(res, 'K2'), K3: recOf(res, 'K3') };
      for (const comp of ['A', 'B', 'S1', 'S2']) {
        let used = 0;
        let held = 0;
        for (const k of kits) for (const c of k.components) if (c.componentSku === comp) {
          used += rec[k.kitSku] * c.quantity;
          held += reserve[k.kitSku] * c.quantity;
        }
        expect(used, `set ${n}, ${comp}`).toBeLessThanOrEqual(Math.max(0, stock[comp] - held));
      }
      for (const k of ['K1', 'K2', 'K3']) {
        const art = res.articles.find((a) => a.article === k)!;
        const want = art.clusters.reduce((s, c) => s + (c.recommendation ? c.recommendation.wantQty : 0), 0);
        expect(rec[k], `set ${n}, ${k} want`).toBeLessThanOrEqual(want);
        expect(rec[k], `set ${n}, ${k} free`).toBeLessThanOrEqual(art.freeMyStock);
        expect(art.shippableMyStock).toBeLessThanOrEqual(art.freeMyStock);
      }
    }
  });

  it('400 случайных наборов без нехватки: никто ничего не теряет', () => {
    let seed = 7;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    for (let n = 0; n < 400; n++) {
      const speeds: Record<string, number> = { [GRAY]: Math.floor(rnd() * 4) / 2, [BLUE]: Math.floor(rnd() * 4) / 2 };
      const res = buildOzonCoverage(input({ BowlGray: 1000, BowlBlue: 1000, 'Бутылки': 1000 }, {}, speeds));
      for (const k of [GRAY, BLUE]) {
        const art = res.articles.find((a) => a.article === k);
        if (!art) continue;
        const want = art.clusters.reduce((s, c) => s + (c.recommendation ? c.recommendation.wantQty : 0), 0);
        expect(recOf(res, k)).toBe(want);
        expect(art.sharedLimitedBy).toEqual([]);
      }
    }
  });
});

describe('item 85, step 1.6: the screens hand every kit component its stock', () => {
  const loop = /for \(const k of kits\) for \(const c of k\.components \|\| \[\]\) \{\s*if \(!\(c\.componentSku in myStockAvailability\)\) myStockAvailability\[c\.componentSku\] = getEffectiveAvailability\(c\.componentSku\);/g;
  it('the tab does it in both calculations (the usual window and the trend window)', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src/components/OzonStocksTab.tsx'), 'utf8');
    expect((src.match(loop) || []).length).toBe(2);
  });
  it('the dashboard does it before its coverage', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src/components/Dashboard.tsx'), 'utf8');
    expect((src.match(loop) || []).length).toBe(1);
  });
  it('the recommendation card says when a kit got only its share of a shared component', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src/components/OzonStocksTab.tsx'), 'utf8');
    expect(src).toContain('доля общих компонентов: {fmtInt(s.shippableMyStock)} шт');
    expect(src).toContain('shippableMyStock: row.shippableMyStock,');
  });
});
