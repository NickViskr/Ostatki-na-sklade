import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { articleLine, buildTurnoverSnapshot, portfolioBlock, TURNOVER_PRESETS, TURNOVER_SYSTEM_PROMPT } from './turnoverPrompt';
import { ArticleTurnover, TurnoverResult } from './turnover';

const art = (over: Partial<ArticleTurnover> = {}): ArticleTurnover => ({
  article: 'A', isKit: false, kitOf: [], kanArticles: ['A'], shelfQty: 20, shelfCapital: 2000, ozonQty: 30, ozonStockCost: 3000,
  deliveringCost: 200, returningCost: 100, avgWarehouseCapital: 1500, avgOzonCapital: 3300, avgCapital: 4800,
  costOfSales: 2400, grossProfit: 1200, boughtQty: 20, orderedQty: 30, turns: 0.5, daysPerTurn: 20, gmroiPct: 25,
  coverDays: 25, lastSaleDay: '2026-09-20', lastReceiptDay: '2026-09-16', ageDays: 1, status: 'normal', ...over,
});
const result: TurnoverResult = {
  articles: [art(), art({ article: 'KIT', isKit: true, turns: null, daysPerTurn: null, gmroiPct: null, coverDays: null, ageDays: null, lastSaleDay: null, lastReceiptDay: null, status: 'slow' }), art({ article: 'C1', kitOf: ['KIT'], status: 'component' })],
  portfolio: {
    periodDays: 10, fromDay: '2026-09-11', toDay: '2026-09-20', shelfCapital: 2000, ozonStockCost: 3000, deliveringCost: 200, returningCost: 100,
    capitalNow: 5300, avgCapital: 4800, avgWarehouseCapital: 1500, avgOzonCapital: 3300, costOfSales: 2400, grossProfit: 1200,
    turns: 0.5, daysPerTurn: 20, gmroiPct: 25, ozonOnlyTurns: 0.8, slowCapital: 5300, slowSharePct: 100, fastCapital: 0,
    counts: { fast: 0, normal: 1, slow: 1, component: 1 },
  },
};

describe('turnover snapshot for the model', () => {
  it('one line per article carries every figure, null stays literal, kits and components are marked', () => {
    const line = articleLine(result.articles[1]);
    expect(line).toContain('KIT [набор]');
    expect(line).toContain('status=slow');
    expect(line).toContain('turns=null; daysPerTurn=null');
    expect(line).toContain('lastSaleDay=null');
    expect(articleLine(result.articles[2])).toContain('[компонент: KIT]');
    expect(articleLine(result.articles[0])).toContain('avgCapital=4800; costOfSales=2400; grossProfit=1200; boughtQty=20; orderedQty=30; lastSaleDay=2026-09-20');
  });
  it('the portfolio block names the period, thresholds and the KAN-comparable figure', () => {
    const block = portfolioBlock(result.portfolio, 45, 20);
    expect(block).toContain('за 10 дн. (2026-09-11 … 2026-09-20); пороги: slow > 45 дн. на оборот, fast < 20 дн.');
    expect(block).toContain('ozonOnlyTurns=0.8 (сопоставимо с KAN inventory_turnover_ratio)');
    expect(block).toContain('slowCapital=5300 (100 % капитала)');
  });
  it('the snapshot = intro + definitions + portfolio + all article lines', () => {
    const s = buildTurnoverSnapshot(result, 45, 20);
    expect(s).toContain('Определения:');
    expect(s).toContain('Товары (3), по одному в строке:');
    expect(s.split('\n').filter((l) => l.startsWith('A;') || l.startsWith('KIT ') || l.startsWith('C1 ')).length).toBe(3);
  });
  it('three starting prompts with the owner\'s three analyses; the system prompt asks for Russian and no invented data', () => {
    expect(TURNOVER_PRESETS.map((p) => p.id)).toEqual(['slow', 'leaders', 'capital']);
    expect(TURNOVER_PRESETS.every((p) => p.prompt.length > 100 && p.label.length > 0)).toBe(true);
    expect(TURNOVER_SYSTEM_PROMPT).toContain('по-русски');
    expect(TURNOVER_SYSTEM_PROMPT).toContain('Не выдумывай');
  });
});

describe('proxy wiring of /api/turnover/ask', () => {
  const proxy = readFileSync(new URL('../../server.ts', import.meta.url), 'utf8');
  it('checks the session, takes system + snapshot + history + question and answers with plain text', () => {
    const start = proxy.indexOf('app.post("/api/turnover/ask"');
    expect(start).toBeGreaterThan(0);
    const body = proxy.slice(start, start + 4000);
    expect(body).toMatch(/verifyGasSession\(token\)/);
    expect(body).toMatch(/systemInstruction/);
    expect(body).toMatch(/snapshot/);
    expect(body).toMatch(/history/);
    expect(body).toMatch(/generateContent/);
  });
});
