import { describe, it, expect } from 'vitest';
import { buildTurnover, gmroiTone, periodDays, shelfFromStock, shelfHistory, shiftDay, transitLots, KanDayRow, SnapshotRow, TransitLot, TurnoverInput } from './turnover';
import { readFileSync } from 'fs';
import { ExternalShipment, KitItem, SKUItem, Transaction } from '../types';

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
  it('item 84: a China cost-correction receipt (qty 0) after the real one leaves lastReceiptDay untouched', () => {
    const withCorrection = buildTurnover({
      ...input,
      transactions: [...input.transactions, tx('2026-09-19', 'A', 0)]
    });
    expect(withCorrection.articles.find((x) => x.article === 'A')!.lastReceiptDay).toBe('2026-09-16');
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
  it('100.8 R-052 a slow kit slows its components\' shelf once: slowCapital = C1 300 + C2 200 + kit Ozon 1100 = 1600, never the kit\'s 440 on top', () => {
    const r3 = buildTurnover(base({ kits, shelf, kanRows: rows, settings: { periodDays: 10, slowDays: 1, fastDays: 0 } }));
    expect(r3.articles.find((a) => a.article === 'KIT')!.status).toBe('slow');
    // shelf: C1 10×30 = 300, C2 4×50 = 200 (both only on the kit's slow path); Ozon: KIT 1100 stock cost; capitalNow = 500 + 1100
    expect(r3.portfolio.slowCapital).toBe(300 + 200 + 1100);
    expect(r3.portfolio.capitalNow).toBe(1600);
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

// ===== Item 100.8 part 1 (R-051, R-052, R-053) =====
// Fixtures below avoid snapshots where possible (R-054 will read a snapshot dated D as the close of D-1).
const NOW2 = new Date('2026-10-20T12:00:00');
const skus2 = ['A', 'B', 'K', 'K1', 'K2', 'KB', 'KIT', 'C1', 'C2'].map((s) => ({ sku: s })) as SKUItem[];
const settings2 = { periodDays: 2, slowDays: 45, fastDays: 20 };
function base2(over: Partial<TurnoverInput> = {}): TurnoverInput {
  return { kanRows: [], snapshots: [], shelf: [], transactions: [], skus: skus2, kits: [], settings: settings2, latestKanDay: '2026-10-19', now: NOW2, ...over };
}
const virtualKit = (kitSku: string, components: Array<[string, number]>): KitItem =>
  ({ kitSku, type: 'virtual', components: components.map(([componentSku, quantity]) => ({ componentSku, quantity })) });

describe('100.8 R-053 virtual kit warehouse history follows its components', () => {
  it('100.8 R-053 probe: kit {A×1}, A received 10 on the last day → kit capital (0 + 1000) / 2 = 500, daysPerTurn 10', () => {
    const kits = [virtualKit('K', [['A', 1]])];
    const r = buildTurnover(base2({
      kits, shelf: shelfFromStock([{ article: 'A', quantity: 10, avgCost: 100 }], kits),
      transactions: [tx('2026-10-19 12:00:00', 'A', 10)],
      kanRows: [kan('2026-10-18', 'K', { costOfSales: -50 }), kan('2026-10-19', 'K', { costOfSales: -50 })],
    }));
    const k = r.articles.find((a) => a.article === 'K')!;
    // A: day 18 = 10 − 10 (receipt on 19) = 0, day 19 = 10 → kit 0 and 10 pcs × 100 → (0 + 1000) / 2 = 500
    expect(k.avgWarehouseCapital).toBe(500);
    // cost of sales 2×50 = 100; turns = 100 / 500 = 0.2; days per turn = 2 / 0.2 = 10
    expect(k.daysPerTurn).toBe(10);
    expect(r.portfolio.avgWarehouseCapital).toBe(500);
  });
  it('100.8 R-053 kit quantity per day is floored: C1 7 (2 per kit) and C2 10 → 3 kits × 110 = 330; with C1 received +2 mid-period → (5×220 + 5×330) / 10 = 275', () => {
    const kits = [virtualKit('KIT', [['C1', 2], ['C2', 1]])];
    const stock = [{ article: 'C1', quantity: 7, avgCost: 30 }, { article: 'C2', quantity: 10, avgCost: 50 }];
    const none = buildTurnover(base({ kits, shelf: shelfFromStock(stock, kits) }));
    // floor(7 / 2) = 3, min(3, 10) = 3; kit cost 2×30 + 1×50 = 110 → 330 every day
    expect(none.articles.find((a) => a.article === 'KIT')!.avgWarehouseCapital).toBe(330);
    const moved = buildTurnover(base({ kits, shelf: shelfFromStock(stock, kits), transactions: [tx('2026-09-16 12:00:00', 'C1', 2)] }));
    // days 11..15: C1 = 7 − 2 = 5 → floor(5/2) = 2 kits × 110 = 220; days 16..20: 3 × 110 = 330; (5×220 + 5×330) / 10 = 275 (not 330 from 2.5 / 3.5 kits)
    expect(moved.articles.find((a) => a.article === 'KIT')!.avgWarehouseCapital).toBe(275);
  });
  it('100.8 R-053 the scarcest component sets the day: C2 (4 pcs) arrives on the last day → only that day has 4 kits × 80 → 320 / 10 = 32', () => {
    const kits = [virtualKit('KIT', [['C1', 1], ['C2', 1]])];
    const r = buildTurnover(base({
      kits, shelf: shelfFromStock([{ article: 'C1', quantity: 10, avgCost: 30 }, { article: 'C2', quantity: 4, avgCost: 50 }], kits),
      transactions: [tx('2026-09-20 12:00:00', 'C2', 4)],
    }));
    // C2 history: days 11..19 = 4 − 4 = 0 → min(10, 0) = 0 kits; day 20 = 4 → 4 kits × (30 + 50) = 320; 320 / 10 = 32
    expect(r.articles.find((a) => a.article === 'KIT')!.avgWarehouseCapital).toBe(32);
  });
  it('100.8 R-053 a day is valued at the component\'s snapshot cost: B at 50 on two days (today 100) → (8×1000 + 2×500) / 10 = 900 for B and its kit', () => {
    // two consecutive snapshot days with the same cost: the count of days at 50 is 2 whether a snapshot dated D
    // is read as the close of D or of D−1 (R-054), and qty 10 equals today's shelf, so the figure holds under both readings
    const kits = [virtualKit('KB', [['B', 1]])];
    const r = buildTurnover(base({
      kits, shelf: shelfFromStock([{ article: 'B', quantity: 10, avgCost: 100 }], kits),
      snapshots: [snap('2026-09-15', 'B', 10, 50), snap('2026-09-16', 'B', 10, 50)],
    }));
    expect(r.articles.find((a) => a.article === 'B')!.avgWarehouseCapital).toBe(900);
    expect(r.articles.find((a) => a.article === 'KB')!.avgWarehouseCapital).toBe(900);
  });
  it('100.8 R-053 a snapshot row of the kit itself is ignored: kit {A×1}, A 10@100, kit snapshots 99 pcs at 1 → still 10 × 100 = 1000', () => {
    const kits = [virtualKit('K', [['A', 1]])];
    const r = buildTurnover(base({
      kits, shelf: shelfFromStock([{ article: 'A', quantity: 10, avgCost: 100 }], kits),
      snapshots: [snap('2026-09-15', 'K', 99, 1), snap('2026-09-16', 'K', 99, 1)],
    }));
    expect(r.articles.find((a) => a.article === 'K')!.avgWarehouseCapital).toBe(1000);
  });
});

describe('100.8 R-052 slow/fast capital counts each rouble once', () => {
  const kits2 = [virtualKit('K1', [['A', 1]]), virtualKit('K2', [['A', 1]])];
  const stockA = [{ article: 'A', quantity: 10, avgCost: 100 }];
  const days10 = periodDays('2026-09-20', 10);
  it('100.8 R-052 probe: two slow kits share component A → slowCapital 1000 = capitalNow, slowSharePct 100', () => {
    const p = buildTurnover(base({ kits: kits2, shelf: shelfFromStock(stockA, kits2) })).portfolio;
    // A shelf 10 × 100 = 1000 counted once (kit shelves never enter); no Ozon data
    expect(p.capitalNow).toBe(1000);
    expect(p.slowCapital).toBe(1000);
    expect(p.slowSharePct).toBe(100);
  });
  it('100.8 R-052 one fast path wins: K1 fast, K2 slow → A\'s shelf 1000 and K1\'s Ozon 100 are fast, K2\'s Ozon 200 is slow', () => {
    const rows = [
      ...days10.map((d) => kan(d, 'K1', { stockCost: 100, stockQty: 1, costOfSales: 500, boughtQty: 1 })),
      ...days10.map((d) => kan(d, 'K2', { stockCost: 200, stockQty: 2 })),
    ];
    const r = buildTurnover(base({ kits: kits2, shelf: shelfFromStock(stockA, kits2), kanRows: rows }));
    expect(r.articles.find((a) => a.article === 'K1')!.status).toBe('fast');
    expect(r.articles.find((a) => a.article === 'K2')!.status).toBe('slow');
    const p = r.portfolio;
    // K1: avg capital 1000 (A) + 100 = 1100, cost of sales 5000 → turns 4.55 → 2 days per turn < 20 = fast; K2: no sales = slow
    // capitalNow = A shelf 1000 + Ozon 100 + 200 = 1300; fast = 1000 + 100 = 1100; slow = 200; 200 / 1300 = 15.38 %
    expect(p.capitalNow).toBe(1300);
    expect(p.fastCapital).toBe(1100);
    expect(p.slowCapital).toBe(200);
    expect(p.slowSharePct).toBe(15.38);
  });
  it('100.8 R-052 one normal and one slow kit → A\'s shelf is neither slow nor fast; only the slow kit\'s Ozon 500 is slow', () => {
    const rows = [
      // K1: avg capital 1000 (A) + 1000 = 2000; cost of sales 10 × 80 = 800 → turns 0.4 → 25 days per turn → normal (20..45)
      ...days10.map((d) => kan(d, 'K1', { stockCost: 1000, stockQty: 10, costOfSales: 80, boughtQty: 1 })),
      ...days10.map((d) => kan(d, 'K2', { stockCost: 500, stockQty: 5 })),
    ];
    const r = buildTurnover(base({ kits: kits2, shelf: shelfFromStock(stockA, kits2), kanRows: rows }));
    expect(r.articles.find((a) => a.article === 'K1')!.status).toBe('normal');
    expect(r.articles.find((a) => a.article === 'K2')!.status).toBe('slow');
    const p = r.portfolio;
    // capitalNow = 1000 + 1000 + 500 = 2500; slow = 500 (K2 Ozon); fast = 0; 500 / 2500 = 20 %
    expect(p.capitalNow).toBe(2500);
    expect(p.slowCapital).toBe(500);
    expect(p.fastCapital).toBe(0);
    expect(p.slowSharePct).toBe(20);
  });
  it('100.8 R-052 A sells slowly on Ozon itself but its kit is fast → A\'s shelf is fast, A\'s own Ozon 100 stays slow', () => {
    const kits = [virtualKit('K', [['A', 1]])];
    const rows = [
      ...days10.map((d) => kan(d, 'A', { stockCost: 100, stockQty: 1 })),
      ...days10.map((d) => kan(d, 'K', { stockCost: 100, stockQty: 1, costOfSales: 500, boughtQty: 1 })),
    ];
    const r = buildTurnover(base({ kits, shelf: shelfFromStock(stockA, kits), kanRows: rows }));
    expect(r.articles.find((a) => a.article === 'A')!.status).toBe('slow');
    expect(r.articles.find((a) => a.article === 'K')!.status).toBe('fast');
    const p = r.portfolio;
    // K: 1100 avg capital, cost of sales 5000 → 2 days per turn = fast. Paths of A: kit fast + own slow → fast.
    // capitalNow = 1000 + 100 + 100 = 1200; fast = 1000 (shelf) + 100 (K's Ozon); slow = 100 (A's Ozon); 100 / 1200 = 8.33 %
    expect(p.capitalNow).toBe(1200);
    expect(p.fastCapital).toBe(1100);
    expect(p.slowCapital).toBe(100);
    expect(p.slowSharePct).toBe(8.33);
  });
  it('100.8 R-052 invariant on a mixed fixture: slowCapital + fastCapital ≤ capitalNow and slowSharePct ≤ 100', () => {
    const kits = [virtualKit('KIT', [['C1', 2], ['C2', 1]]), virtualKit('KIT2', [['C1', 1]])];
    const stock = [
      { article: 'C1', quantity: 10, avgCost: 30 }, { article: 'C2', quantity: 4, avgCost: 50 },
      { article: 'B', quantity: 5, avgCost: 10 }, { article: 'A', quantity: 3, avgCost: 20 },
    ];
    const rows = [
      ...days10.map((d) => kan(d, 'KIT', { stockCost: 1100, stockQty: 10, costOfSales: 110, boughtQty: 1 })),
      ...days10.map((d) => kan(d, 'KIT2', { stockCost: 100, stockQty: 1 })),
      ...days10.map((d) => kan(d, 'B', { stockCost: 50, stockQty: 5 })),
      ...days10.map((d) => kan(d, 'A', { stockCost: 30, stockQty: 1, costOfSales: 500, boughtQty: 2 })),
    ];
    const p = buildTurnover(base({ kits, shelf: shelfFromStock(stock, kits), kanRows: rows })).portfolio;
    expect(p.slowCapital).toBeGreaterThan(0);
    expect(p.fastCapital).toBeGreaterThan(0);
    expect(p.slowCapital + p.fastCapital).toBeLessThanOrEqual(p.capitalNow);
    expect(p.slowSharePct).toBeLessThanOrEqual(100);
  });
});

describe('100.8 R-051 goods in transit to an Ozon FBO supply', () => {
  const ship = (over: Partial<ExternalShipment> = {}): ExternalShipment => ({
    postingId: 'p1', detectedAt: '2026-10-18 10:00:00', shipmentDate: '2026-10-18', status: 'processed',
    itemsJSON: JSON.stringify([{ offerId: 'A', quantity: 10 }]), transGroupInfo: JSON.stringify(['t1']),
    orderId: 'O1', ozonStatus: 'IN_TRANSIT', ozonStatusDate: '', ...over,
  });
  const out = (id: string, date: string, article: string, quantity: number, writeOffCost: number, total: number, over: Partial<Transaction> = {}): Transaction =>
    ({ id, date, type: 'Расход', article, quantity, writeOffCost, total, price: 0, destination: 'Ozon', ...over } as Transaction);
  const lotsOf = (shipments: ExternalShipment[], transactions: Transaction[]): TransitLot[] => transitLots({ shipments, transactions, skus: skus2 });
  const tx1 = out('t1', '2026-10-18 14:00:00', 'A', 10, 1000, 1240);

  it('100.8 R-051 an IN_TRANSIT supply gives an open lot at the write-off cost: 1000 / 10 = 100 per piece (not the total 1240)', () => {
    expect(lotsOf([ship()], [tx1])).toEqual([{ article: 'A', qty: 10, unitCost: 100, fromDay: '2026-10-18', toDay: null }]);
  });
  it('100.8 R-051 an acceptance stage or a cleared status closes the lot on the status day', () => {
    const accepted = lotsOf([ship({ ozonStatus: 'ACCEPTANCE_AT_STORAGE_WAREHOUSE', ozonStatusDate: '2026-10-19 09:00:00' })], [tx1]);
    expect(accepted).toEqual([{ article: 'A', qty: 10, unitCost: 100, fromDay: '2026-10-18', toDay: '2026-10-19' }]);
    const completed = lotsOf([ship({ ozonStatus: 'COMPLETED', ozonStatusDate: '2026-10-19 09:00:00' })], [tx1]);
    expect(completed[0].toDay).toBe('2026-10-19');
    const cancelled = lotsOf([ship({ ozonStatus: 'CANCELLED', ozonStatusDate: '2026-10-19 09:00:00' })], [tx1]);
    expect(cancelled[0].toDay).toBe('2026-10-19');
  });
  it('100.8 R-051 no lot for an unprocessed, ignored or virtual row, nor for an empty or unknown Ozon status', () => {
    expect(lotsOf([ship({ status: 'new' })], [tx1])).toEqual([]);
    expect(lotsOf([ship({ status: 'ignored' })], [tx1])).toEqual([]);
    expect(lotsOf([ship({ isVirtual: true })], [tx1])).toEqual([]);
    expect(lotsOf([ship({ ozonStatus: '' })], [tx1])).toEqual([]);
    expect(lotsOf([ship({ ozonStatus: 'SOMETHING_NEW' })], [tx1])).toEqual([]);
  });
  it('100.8 R-051 a virtual kit row costs its component rows: (120 + 100) / 2 = 110 per kit, one lot for K and none for components', () => {
    const txs = [
      out('k1', '2026-10-18 14:00:00', 'K', 2, 0, 300, { groupId: 'g1' }),
      out('c1', '2026-10-18 14:00:00', 'A', 2, 0, 120, { groupId: 'g1', isComponent: true }),
      out('c2', '2026-10-18 14:00:00', 'B', 2, 0, 100, { groupId: 'g1', isComponent: true }),
    ];
    const lots = lotsOf([ship({ itemsJSON: JSON.stringify([{ offerId: 'K', quantity: 2 }]), transGroupInfo: JSON.stringify(['k1', 'c1', 'c2']) })], txs);
    expect(lots).toEqual([{ article: 'K', qty: 2, unitCost: 110, fromDay: '2026-10-18', toDay: null }]);
  });
  it('100.8 R-051 after a partial return only the shipped quantity is in transit: shipped 6 of 10 → qty 6 at 100', () => {
    const shippedJSON = JSON.stringify({ lines: [{ offerId: 'A', article: 'A', declared: 10, shipped: 6 }], returnTxIds: [], returnedAt: '', by: '' });
    expect(lotsOf([ship({ shippedJSON })], [tx1])).toEqual([{ article: 'A', qty: 6, unitCost: 100, fromDay: '2026-10-18', toDay: null }]);
  });
  it('100.8 R-051 two rows of one order share the write-off: lot 6 stays open, lot 4 closed on 19.10, both at 100', () => {
    const txs = [out('t5a', '2026-10-18 10:00:00', 'A', 6, 600, 700), out('t5b', '2026-10-18 16:00:00', 'A', 4, 400, 480)];
    const shared = JSON.stringify(['t5a', 't5b']);
    const lots = lotsOf([
      ship({ postingId: 'p1', orderId: 'O5', transGroupInfo: shared, itemsJSON: JSON.stringify([{ offerId: 'A', quantity: 6 }]) }),
      ship({ postingId: 'p2', orderId: 'O5', transGroupInfo: shared, itemsJSON: JSON.stringify([{ offerId: 'A', quantity: 4 }]),
        ozonStatus: 'ACCEPTANCE_AT_STORAGE_WAREHOUSE', ozonStatusDate: '2026-10-19 09:00:00' }),
    ], txs);
    // unit cost = (600 + 400) / (6 + 4) = 100
    expect(lots).toHaveLength(2);
    expect(lots).toContainEqual({ article: 'A', qty: 6, unitCost: 100, fromDay: '2026-10-18', toDay: null });
    expect(lots).toContainEqual({ article: 'A', qty: 4, unitCost: 100, fromDay: '2026-10-18', toDay: '2026-10-19' });
  });
  it('100.8 R-051 probe: shelf A 0, open lot 10 × 100 from 18.10 → capitalNow 1000 and A stays in the list with average capital 1000', () => {
    const transit: TransitLot[] = [{ article: 'A', qty: 10, unitCost: 100, fromDay: '2026-10-18', toDay: null }];
    const r = buildTurnover(base2({ shelf: [{ article: 'A', quantity: 0, avgCost: 100 }], transit }));
    const a = r.articles.find((x) => x.article === 'A')!;
    expect(a).toBeDefined();
    // open lot counts on both period days 18 and 19: (1000 + 1000) / 2 = 1000
    expect(a.transitCost).toBe(1000);
    expect(a.avgTransitCapital).toBe(1000);
    expect(a.avgCapital).toBe(1000);
    expect(r.portfolio.transitCost).toBe(1000);
    expect(r.portfolio.avgTransitCapital).toBe(1000);
    expect(r.portfolio.capitalNow).toBe(1000);
    expect(r.portfolio.avgCapital).toBe(1000);
  });
  it('100.8 R-051 a lot closed on 19.10 counts only the days before it: period 17..20, lot 17 → 19 → (1000 + 1000) / 4 = 500, not in capitalNow', () => {
    const transit: TransitLot[] = [{ article: 'A', qty: 10, unitCost: 100, fromDay: '2026-10-17', toDay: '2026-10-19' }];
    const r = buildTurnover(base2({
      shelf: [{ article: 'A', quantity: 5, avgCost: 100 }], transit,
      settings: { ...settings2, periodDays: 4 }, latestKanDay: '2026-10-20', now: new Date('2026-10-21T12:00:00'),
    }));
    const a = r.articles.find((x) => x.article === 'A')!;
    // days 17 and 18 satisfy d < toDay (19), days 19 and 20 do not; 2 × 1000 / 4 = 500
    expect(a.avgTransitCapital).toBe(500);
    expect(r.portfolio.avgTransitCapital).toBe(500);
    expect(a.transitCost).toBe(0);
    expect(r.portfolio.capitalNow).toBe(500);
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
    // Item 87 step 2: the settings window renders every numeric field generically from
    // src/lib/ozonSettingsFields.ts, so the field is checked there instead of a literal
    // `form.gmroiGreenPct` string in the modal.
    expect(read('../lib/ozonSettingsFields.ts')).toMatch(/key: 'gmroiGreenPct'/);
  });
  it('the three settings travel end to end: Code.gs defaults, store parse, settings field table', () => {
    expect(read('../../Code.gs')).toMatch(/turnoverPeriodDays',\s*value: 90/);
    expect(read('../store/useWarehouseStore.ts')).toMatch(/turnoverPeriodDays: Math\.max\(1, num\(s\.turnoverPeriodDays, 90\)\)/);
    const modal = read('../components/OzonSettingsModal.tsx');
    expect(modal).toMatch(/turnoverSlowDays: numSetting\(res\.data\.turnoverSlowDays, 45\)/);
    expect(read('../lib/ozonSettingsFields.ts')).toMatch(/key: 'turnoverFastDays'/);
  });
});
