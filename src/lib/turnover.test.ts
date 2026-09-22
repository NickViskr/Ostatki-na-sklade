import { describe, it, expect } from 'vitest';
import { buildTurnover, gmroiTone, periodDays, shelfFromStock, shelfHistory, shiftDay, KanDayRow, SnapshotRow, TurnoverInput } from './turnover';
import { readFileSync } from 'fs';
import { KitItem, SKUItem, Transaction } from '../types';

const NOW = new Date('2026-09-21T12:00:00');
const settings = { periodDays: 10, slowDays: 45, fastDays: 20 };
const skus = [
  { sku: 'A', ozonBarcode: '111' },
  { sku: 'B' },
  { sku: 'KIT' },
  { sku: 'C1' },
  { sku: 'C2' },
] as SKUItem[];

const kan = (date: string, article: string, o: Partial<KanDayRow> = {}): KanDayRow => ({
  date, article, productId: 1, stockCost: 0, stockQty: 0, deliveringCost: 0, returningCost: 0,
  costOfSales: 0, grossProfit: 0, boughtQty: 0, orderedQty: 0, ...o,
});
const snap = (date: string, article: string, qty: number, avgCost: number): SnapshotRow => ({ date, article, qty, avgCost, capital: qty * avgCost });
const tx = (date: string, article: string, quantity: number, type: Transaction['type'] = 'Приход'): Transaction =>
  ({ id: `${article}-${date}-${type}`, date, type, article, quantity } as Transaction);

function base(over: Partial<TurnoverInput> = {}): TurnoverInput {
  return { kanRows: [], snapshots: [], shelf: [], transactions: [], skus, kits: [], settings, latestKanDay: '2026-09-20', now: NOW, ...over };
}

describe('period helpers', () => {
  it('periodDays ends on the given day and counts back, shiftDay crosses months', () => {
    expect(periodDays('2026-09-20', 3)).toEqual(['2026-09-18', '2026-09-19', '2026-09-20']);
    expect(shiftDay('2026-09-01', -1)).toBe('2026-08-31');
  });
});

describe('shelfHistory: snapshots first, the journal walked back otherwise', () => {
  const days = periodDays('2026-09-20', 4); // 17..20
  it('walks back from today: receipts after a day are subtracted, expenses added, the day itself counts', () => {
    const t = [tx('2026-09-21', 'A', 50), tx('2026-09-19', 'A', 30), tx('2026-09-18', 'A', 10, 'Расход'), tx('2026-09-19', 'A', 0, 'Корректировка')];
    // now 100; 20: 100-50=50; 19: 50; 18: 50-30=20; 17: 20+10=30
    expect(shelfHistory('A', 100, days, [], t)).toEqual([30, 20, 50, 50]);
  });
  it('a snapshot wins over the reconstruction for its day', () => {
    const t = [tx('2026-09-21', 'A', 50)];
    expect(shelfHistory('A', 100, days, [snap('2026-09-18', 'A', 7, 1)], t)).toEqual([50, 7, 50, 50]);
  });
  it('never goes below zero and ignores other articles and unreadable dates', () => {
    const t = [tx('2026-09-19', 'A', 500), tx('2026-09-19', 'B', 1, 'Расход'), tx('вчера', 'A', 5, 'Расход')];
    expect(shelfHistory('A', 100, days, [], t)).toEqual([0, 0, 100, 100]);
  });
});

describe('buildTurnover: one article, hand-checked arithmetic', () => {
  // Period 11..20 September (10 days). Shelf now 20 pcs at 100 ₽; a receipt of 10 on the 16th,
  // so days 11..15 hold 10 pcs and 16..20 hold 20: warehouse capital 5×1000 + 5×2000 = 15000 → avg 1500.
  // Ozon: every day stock 3000 ₽ (30 pcs), delivering 200, returning 100 → 3300/day → avg 3300.
  // Cost of sales 240/day → 2400; gross profit 120/day → 1200; bought 2/day → 20; ordered 3/day → 30.
  const rows: KanDayRow[] = periodDays('2026-09-20', 10).map((d) =>
    kan(d, 'A', { stockCost: 3000, stockQty: 30, deliveringCost: 200, returningCost: 100, costOfSales: 240, grossProfit: 120, boughtQty: 2, orderedQty: 3 }));
  const input = base({
    kanRows: [...rows, kan('2026-09-10', 'A', { costOfSales: 99999 })], // outside the period → ignored
    shelf: [{ article: 'A', quantity: 20, avgCost: 100 }],
    transactions: [tx('2026-09-16', 'A', 10), tx('2026-06-01', 'A', 10)],
  });
  const r = buildTurnover(input);
  const a = r.articles.find((x) => x.article === 'A')!;

  it('maps the KAN article through the SKU base (offer_id → internal article, case-insensitive)', () => {
    expect(r.articles.map((x) => x.article)).toEqual(['A']);
    expect(a.kanArticles).toEqual(['A']);
    const lower = buildTurnover(base({ kanRows: [kan('2026-09-20', 'a', { stockCost: 1 })] }));
    expect(lower.articles.map((x) => x.article)).toEqual(['A']);
  });
  it('average capital = warehouse 1500 + Ozon 3300', () => {
    expect(a.avgWarehouseCapital).toBe(1500);
    expect(a.avgOzonCapital).toBe(3300);
    expect(a.avgCapital).toBe(4800);
  });
  it('turns = 2400 / 4800 = 0.5, days per turn = 10 / 0.5 = 20, GMROI = 1200 / 4800 = 25 %', () => {
    expect(a.costOfSales).toBe(2400);
    expect(a.turns).toBe(0.5);
    expect(a.daysPerTurn).toBe(20);
    expect(a.gmroiPct).toBe(25);
  });
  it('days of cover = (20 + 30) / (20 / 10) = 25; the now-parts come from the last KAN day', () => {
    expect(a.coverDays).toBe(25);
    expect(a.shelfQty).toBe(20);
    expect(a.ozonQty).toBe(30);
    expect(a.shelfCapital).toBe(2000);
    expect(a.ozonStockCost).toBe(3000);
    expect(a.deliveringCost).toBe(200);
    expect(a.returningCost).toBe(100);
  });
  it('age = days since the last sale (20.09 → 21.09 = 1), last receipt kept for the screen', () => {
    expect(a.lastSaleDay).toBe('2026-09-20');
    expect(a.ageDays).toBe(1);
    expect(a.lastReceiptDay).toBe('2026-09-16');
  });
  it('20 days per turn is «normal» with fast < 20 and slow > 45; the boundaries are strict', () => {
    expect(a.status).toBe('normal');
    expect(buildTurnover({ ...input, settings: { periodDays: 10, slowDays: 19, fastDays: 5 } }).articles[0].status).toBe('slow');
    expect(buildTurnover({ ...input, settings: { periodDays: 10, slowDays: 45, fastDays: 21 } }).articles[0].status).toBe('fast');
    expect(buildTurnover({ ...input, settings: { periodDays: 10, slowDays: 20, fastDays: 5 } }).articles[0].status).toBe('normal');
    expect(buildTurnover({ ...input, settings: { periodDays: 10, slowDays: 45, fastDays: 20 } }).articles[0].status).toBe('normal');
  });
  it('the portfolio of one article equals the article; ozon-only turns use the stock cost alone (2400 / 3000)', () => {
    const p = r.portfolio;
    expect(p.fromDay).toBe('2026-09-11');
    expect(p.toDay).toBe('2026-09-20');
    expect(p.avgCapital).toBe(4800);
    expect(p.turns).toBe(0.5);
    expect(p.daysPerTurn).toBe(20);
    expect(p.gmroiPct).toBe(25);
    expect(p.ozonOnlyTurns).toBe(0.8);
    expect(p.capitalNow).toBe(5300);
    expect(p.counts).toEqual({ fast: 0, normal: 1, slow: 0, component: 0 });
    expect(p.slowSharePct).toBe(0);
  });
});

describe('buildTurnover: no sales, snapshots with their own cost, two cabinets', () => {
  it('an article that never sold is slow with null turns, its age from the last receipt', () => {
    const r = buildTurnover(base({ shelf: [{ article: 'B', quantity: 5, avgCost: 10 }], transactions: [tx('2026-09-01', 'B', 5)] }));
    const b = r.articles[0];
    expect(b.turns).toBe(0);
    expect(b.daysPerTurn).toBeNull();
    expect(b.coverDays).toBeNull();
    expect(b.gmroiPct).toBe(0);
    expect(b.status).toBe('slow');
    expect(b.lastSaleDay).toBeNull();
    expect(b.ageDays).toBe(20);
    expect(r.portfolio.slowCapital).toBe(50);
    expect(r.portfolio.slowSharePct).toBe(100);
  });
  it('an article with no capital anywhere and no sales is left out, not called slow', () => {
    const rows = periodDays('2026-09-20', 10).map((d) => kan(d, 'B'));
    const r = buildTurnover(base({ kanRows: rows, shelf: [{ article: 'B', quantity: 0, avgCost: 10 }] }));
    expect(r.articles).toEqual([]);
    expect(r.portfolio.counts.slow).toBe(0);
    // one piece on the shelf is enough to keep it, even with no cost recorded yet
    expect(buildTurnover(base({ kanRows: rows, shelf: [{ article: 'B', quantity: 1, avgCost: 0 }] })).articles.length).toBe(1);
  });
  it('an article with capital but no receipt and no sale has no age', () => {
    const r = buildTurnover(base({ shelf: [{ article: 'B', quantity: 5, avgCost: 10 }] }));
    expect(r.articles[0].ageDays).toBeNull();
  });
  it('a snapshot day is valued at the snapshot cost, a reconstructed day at today\'s', () => {
    // 10-day period, shelf now 10 at 100; snapshot on the 20th says 10 pcs at 50 → that day 500, the other nine 1000 → 9500 / 10 = 950
    const r = buildTurnover(base({ shelf: [{ article: 'B', quantity: 10, avgCost: 100 }], snapshots: [snap('2026-09-20', 'B', 10, 50)] }));
    expect(r.articles[0].avgWarehouseCapital).toBe(950);
  });
  it('two KAN products of one article (two cabinets) are summed per day', () => {
    const rows = [
      kan('2026-09-20', 'A', { productId: 1, stockCost: 100, stockQty: 1, costOfSales: 10, boughtQty: 1 }),
      kan('2026-09-20', 'A', { productId: 2, stockCost: 300, stockQty: 3, costOfSales: 30, boughtQty: 2 }),
    ];
    const r = buildTurnover(base({ kanRows: rows }));
    const a = r.articles[0];
    expect(a.article).toBe('A');
    expect(a.kanArticles).toEqual(['A']);
    expect(a.ozonQty).toBe(4);
    expect(a.ozonStockCost).toBe(400);
    expect(a.avgOzonCapital).toBe(40);
    expect(a.costOfSales).toBe(40);
    expect(a.turns).toBe(1);
    expect(a.coverDays).toBe(Math.round(4 / (3 / 10)));
  });
  it('KAN\'s cost of sales comes with a minus sign (an expense) and is taken by modulus; gross profit keeps its sign', () => {
    const rows = periodDays('2026-09-20', 10).map((d) => kan(d, 'A', { stockCost: 1000, costOfSales: -50, grossProfit: -10, boughtQty: 1 }));
    const a = buildTurnover(base({ kanRows: rows })).articles[0];
    expect(a.costOfSales).toBe(500);
    expect(a.turns).toBe(0.5);
    expect(a.daysPerTurn).toBe(20);
    expect(a.grossProfit).toBe(-100);
    expect(a.gmroiPct).toBe(-10);
  });
  it('the last sale day looks at ordered pieces too, not only bought', () => {
    const rows = [kan('2026-09-15', 'A', { boughtQty: 1 }), kan('2026-09-18', 'A', { orderedQty: 1 }), kan('2026-09-20', 'A', { stockCost: 1 })];
    expect(buildTurnover(base({ kanRows: rows })).articles[0].lastSaleDay).toBe('2026-09-18');
  });
  it('without a KAN day the period ends yesterday', () => {
    const r = buildTurnover(base({ latestKanDay: '' }));
    expect(r.portfolio.toDay).toBe('2026-09-20');
  });
});

describe('buildTurnover: kits and components', () => {
  const kits: KitItem[] = [{ kitSku: 'KIT', type: 'virtual', components: [{ componentSku: 'C1', quantity: 2 }, { componentSku: 'C2', quantity: 1 }] }];
  const shelf = [
    { article: 'C1', quantity: 10, avgCost: 30 },
    { article: 'C2', quantity: 4, avgCost: 50 },
    { article: 'KIT', quantity: 4, avgCost: 0, isVirtual: true },
  ];
  const rows = periodDays('2026-09-20', 10).map((d) => kan(d, 'KIT', { stockCost: 1100, stockQty: 10, costOfSales: 110, grossProfit: 55, boughtQty: 1 }));
  const r = buildTurnover(base({ kits, shelf, kanRows: rows }));
  const kit = r.articles.find((a) => a.article === 'KIT')!;
  const c1 = r.articles.find((a) => a.article === 'C1')!;

  it('the kit is its own product at the components\' cost: 4 × (2×30 + 50) = 440', () => {
    expect(kit.isKit).toBe(true);
    expect(kit.shelfCapital).toBe(440);
    expect(kit.avgWarehouseCapital).toBe(440);
    expect(kit.avgCapital).toBe(1540);
    expect(kit.turns).toBe(round(1100 / 1540));
  });
  it('components with no Ozon sales of their own are «component», not slow, and name their kit', () => {
    expect(c1.status).toBe('component');
    expect(c1.kitOf).toEqual(['KIT']);
    expect(r.articles.find((a) => a.article === 'C2')!.status).toBe('component');
  });
  it('a component that also sells on Ozon on its own is judged by its own turns', () => {
    const own = periodDays('2026-09-20', 10).map((d) => kan(d, 'C1', { stockCost: 100, costOfSales: 1 }));
    const r3 = buildTurnover(base({ kits, shelf, kanRows: [...rows, ...own] }));
    expect(r3.articles.find((a) => a.article === 'C1')!.status).toBe('slow');
  });
  it('a kit\'s own journal rows do not move its shelf history — the kit quantity comes from the components', () => {
    const r3 = buildTurnover(base({ kits, shelf, kanRows: rows, transactions: [tx('2026-09-18', 'KIT', 3, 'Расход')] }));
    expect(r3.articles.find((a) => a.article === 'KIT')!.avgWarehouseCapital).toBe(440);
  });
  it('a slow kit freezes its shelf capital: slowCapital includes the kit\'s 440', () => {
    const r3 = buildTurnover(base({ kits, shelf, kanRows: rows, settings: { periodDays: 10, slowDays: 1, fastDays: 0 } }));
    expect(r3.articles.find((a) => a.article === 'KIT')!.status).toBe('slow');
    expect(r3.portfolio.slowCapital).toBe(440 + 1100);
  });
  it('the portfolio counts the physical shelf once: 300 + 200, never the kit\'s 440 on top', () => {
    expect(r.portfolio.shelfCapital).toBe(500);
    expect(r.portfolio.avgWarehouseCapital).toBe(500);
    expect(r.portfolio.counts.component).toBe(2);
    expect(r.portfolio.capitalNow).toBe(500 + 1100);
  });
  it('ranking: leaders first, no-sales after them, components last', () => {
    const r2 = buildTurnover(base({
      kits, shelf: [...shelf, { article: 'B', quantity: 1, avgCost: 1 }, { article: 'A', quantity: 1, avgCost: 1 }],
      kanRows: [...rows, ...periodDays('2026-09-20', 10).map((d) => kan(d, 'A', { stockCost: 10, costOfSales: 5 }))],
    }));
    expect(r2.articles.map((a) => a.article)).toEqual(['A', 'KIT', 'B', 'C1', 'C2']);
  });
});

describe('gmroiTone (item 78e)', () => {
  it('green at or above the green threshold, red below the red one, yellow between, none for null', () => {
    expect(gmroiTone(100, 100, 30)).toBe('green');
    expect(gmroiTone(99.9, 100, 30)).toBe('yellow');
    expect(gmroiTone(30, 100, 30)).toBe('yellow');
    expect(gmroiTone(29.9, 100, 30)).toBe('red');
    expect(gmroiTone(-5, 100, 30)).toBe('red');
    expect(gmroiTone(null, 100, 30)).toBe('none');
  });
});

describe('shelfFromStock', () => {
  it('keeps physical articles, computes a virtual kit from its components at their summed cost', () => {
    const stock = [{ article: 'C1', quantity: 10, avgCost: 30 }, { article: 'C2', quantity: 4, avgCost: 50 }, { article: 'KIT', quantity: 99, avgCost: 1 }];
    const kits: KitItem[] = [{ kitSku: 'KIT', type: 'virtual', components: [{ componentSku: 'C1', quantity: 2 }, { componentSku: 'C2', quantity: 1 }] }];
    const shelf = shelfFromStock(stock, kits);
    expect(shelf).toEqual([
      { article: 'C1', quantity: 10, avgCost: 30 },
      { article: 'C2', quantity: 4, avgCost: 50 },
      { article: 'KIT', quantity: 4, avgCost: 110, isVirtual: true },
    ]);
  });
  it('a kit with a missing component has 0 pieces; a legacy kit stays a physical row', () => {
    const kits: KitItem[] = [{ kitSku: 'KIT', type: 'virtual', components: [{ componentSku: 'NOPE', quantity: 1 }] }, { kitSku: 'OLD', type: 'legacy', components: [] }];
    const shelf = shelfFromStock([{ article: 'OLD', quantity: 2, avgCost: 5 }], kits);
    expect(shelf).toEqual([{ article: 'OLD', quantity: 2, avgCost: 5 }, { article: 'KIT', quantity: 0, avgCost: 0, isVirtual: true }]);
  });
});

function round(v: number): number { return Math.round(v * 100) / 100; }

describe('screen wiring (item 78c)', () => {
  const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
  it('the tab builds the result from the store data with the Ozon settings thresholds and shows the KAN button to admins only', () => {
    const tab = read('../components/TurnoverTab.tsx');
    expect(tab).toMatch(/buildTurnover\(\{[\s\S]*shelf: shelfFromStock\(stock, kits\)[\s\S]*settings: \{ periodDays, slowDays, fastDays \}/);
    expect(tab).toMatch(/\{isAdmin && \([\s\S]*btn-turnover-kan-refresh/);
    expect(tab).toMatch(/TURNOVER_PRESETS\.map/);
    expect(tab).toMatch(/fetch\('\/api\/turnover\/ask'/);
    expect(tab).toMatch(/snapshot: buildTurnoverSnapshot\(result, slowDays, fastDays\)/);
  });
  it('the dashboard column uses the same builder and the same thresholds', () => {
    const dash = read('../components/Dashboard.tsx');
    expect(dash).toMatch(/\{ key: 'capitalTurn', label: 'Оборот капитала, дн\.' \}/);
    expect(dash).toMatch(/buildTurnover\(\{[\s\S]*shelf: shelfFromStock\(stock, kits\)[\s\S]*turnoverSlowDays\) \|\| 45, fastDays: Number\(ozonSettings\.turnoverFastDays\) \|\| 20/);
    expect(dash).toMatch(/sortConfig\.key === 'capitalTurn'[\s\S]*turnoverSortValue\(capitalTurn\[a\.article\]\?\.daysPerTurn/);
  });
  it('the tab is reachable by every user: sidebar entry, route without an admin gate, tab type', () => {
    expect(read('../components/Sidebar.tsx')).toMatch(/\{ id: 'turnover', label: 'Оборачиваемость', icon: RefreshCw \},\n\s*\.\.\.\(isCurrentUserAdmin/);
    expect(read('../App.tsx')).toMatch(/\{activeTab === 'turnover' && <TurnoverTab key="turnover" \/>\}/);
    expect(read('../store/useUIStore.ts')).toMatch(/\| 'turnover'/);
  });
  it('the tab has its own «Колонки» picker under its own storage key, every cell behind isColVisible', () => {
    const tab = read('../components/TurnoverTab.tsx');
    expect(tab).toMatch(/turnoverCols_\$\{user\}/);
    expect(tab).toMatch(/btn-turnover-cols/);
    for (const key of ['turns', 'daysPerTurn', 'gmroi', 'cover', 'age', 'shelf', 'ozon', 'avgCapital', 'sold']) {
      expect(tab).toContain(`isColVisible('${key}') &&`);
    }
    expect(read('../components/Dashboard.tsx')).toMatch(/dashCols_\$\{currentUser\.username\}/);
  });
  it('GMROI colours: the tab colours the cell and the card by gmroiTone with the two settings', () => {
    const tab = read('../components/TurnoverTab.tsx');
    expect(tab).toMatch(/GMROI_CLASS\[gmroiTone\(a\.gmroiPct, gmroiGreen, gmroiRed\)\]/);
    expect(tab).toMatch(/gmroi=\{gmroiTone\(p\.gmroiPct, gmroiGreen, gmroiRed\)\}/);
    expect(read('../../Code.gs')).toMatch(/gmroiGreenPct',\s*value: 100/);
    expect(read('../../Code.gs')).toMatch(/gmroiRedPct',\s*value: 30/);
    expect(read('../store/useWarehouseStore.ts')).toMatch(/gmroiRedPct: num\(s\.gmroiRedPct, 30\)/);
    expect(read('../components/OzonSettingsModal.tsx')).toMatch(/value=\{form\.gmroiGreenPct\}/);
  });
  it('the three settings travel end to end: Code.gs defaults, store parse, modal form', () => {
    expect(read('../../Code.gs')).toMatch(/turnoverPeriodDays',\s*value: 90/);
    expect(read('../store/useWarehouseStore.ts')).toMatch(/turnoverPeriodDays: Math\.max\(1, num\(s\.turnoverPeriodDays, 90\)\)/);
    const modal = read('../components/OzonSettingsModal.tsx');
    expect(modal).toMatch(/turnoverSlowDays: numSetting\(res\.data\.turnoverSlowDays, 45\)/);
    expect(modal).toMatch(/value=\{form\.turnoverFastDays\}/);
  });
});
