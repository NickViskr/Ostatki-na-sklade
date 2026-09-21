import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { salesByArticle, turnoverDays, turnoverSortValue, windowStart } from './turnoverDays';
import { Transaction } from '../types';

const NOW = new Date('2026-09-21T15:00:00');
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const tx = (date: string, article: string, quantity: number, type: Transaction['type'] = 'Расход'): Transaction =>
  ({ id: `${article}-${date}`, date, type, article, quantity } as Transaction);

describe('salesByArticle: expenses inside the window, last expense at any time', () => {
  it('counts only «Расход» rows dated on or after midnight of the cutoff day', () => {
    const rows = [
      tx('2026-09-01', 'A', 3),
      tx('22.08.2026', 'A', 4),          // local midnight of the cutoff day for 30 days → counted
      tx('2026-08-21', 'A', 100),        // one day before → not counted, but is not the latest
      tx('2026-09-10', 'A', 5, 'Приход'),
      tx('2026-09-10', 'A', 6, 'Корректировка'),
    ];
    const m = salesByArticle(rows, 30, NOW);
    expect(m.get('A')!.qty).toBe(7);
    expect(ymd(m.get('A')!.lastDate!)).toBe('2026-09-01');
  });

  it('keeps the last expense date even when it is outside the window, and reads ДД.ММ.ГГГГ dates', () => {
    const rows = [tx('2026-01-05', 'B', 9), tx('15.03.2026, 10:20:00', 'B', 2)]; // older row first
    const m = salesByArticle(rows, 30, NOW);
    expect(m.get('B')!.qty).toBe(0);
    expect(ymd(m.get('B')!.lastDate!)).toBe('2026-03-15');
  });

  it('skips unreadable dates and tolerates an undefined list', () => {
    expect(salesByArticle([tx('когда-то', 'C', 5)], 30, NOW).has('C')).toBe(false);
    expect(salesByArticle(undefined as unknown as Transaction[], 30, NOW).size).toBe(0);
  });

  it('windowStart is midnight `days` days ago', () => {
    const w = windowStart(30, NOW);
    expect(ymd(w)).toBe('2026-08-22');
    expect(w.getHours() + w.getMinutes()).toBe(0);
  });
});

describe('turnoverDays: no sales is null, not zero', () => {
  it('scales the shelf by the window speed and rounds', () => {
    expect(turnoverDays(36, 18, 120)).toBe(240);
    expect(turnoverDays(10, 3, 30)).toBe(100);
  });
  it('is null without sales — the old server figure said 0 here', () => {
    expect(turnoverDays(500, 0, 120)).toBeNull();
  });
  it('is 0 for an empty shelf that still sold', () => {
    expect(turnoverDays(0, 7, 120)).toBe(0);
  });
  it('sorts null after every number in ascending order', () => {
    const sorted = [null, 12, 0, 300].sort((a, b) => turnoverSortValue(a) - turnoverSortValue(b));
    expect(sorted).toEqual([0, 12, 300, null]);
  });
});

describe('Dashboard wiring', () => {
  const src = readFileSync(new URL('../components/Dashboard.tsx', import.meta.url), 'utf8');
  it('the column and the summary card use the same window from the dashboard setting', () => {
    expect(src).toMatch(/salesByArticle\(transactions, turnoverWindowDays\)/);
    expect((src.match(/salesByArticle\(/g) || []).length).toBe(1);
  });
  it('an article without sales shows «нет продаж» and sorts as the slowest', () => {
    expect(src).toContain('нет продаж');
    expect(src).toMatch(/sortConfig\.key === 'turnover'[\s\S]*turnoverSortValue/);
  });
});
