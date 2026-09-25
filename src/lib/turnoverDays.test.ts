import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { coverageDays, daysLying, lastReceiptByArticle, turnoverSortValue } from './turnoverDays';
import { Transaction } from '../types';

const NOW = new Date('2026-09-21T15:00:00');
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const tx = (date: string, article: string, quantity: number, type: Transaction['type'] = 'Приход'): Transaction =>
  ({ id: `${article}-${date}`, date, type, article, quantity } as Transaction);

describe('coverageDays: shelf plus Ozon stock at the Ozon sales speed', () => {
  it('owner case: a fresh shelf with no shipments yet still has a turnover because Ozon sells it', () => {
    // 200 pcs just arrived, 91 pcs on Ozon, 4.2 pcs/day on Ozon → 69 days, not «нет продаж»
    expect(coverageDays({ shelf: 200, ozon: 91 }, 4.2)).toBe(69);
  });
  it('rounds and counts both parts', () => {
    expect(coverageDays({ shelf: 10, ozon: 0 }, 3)).toBe(3);
    expect(coverageDays({ shelf: 0, ozon: 10 }, 3)).toBe(3);
  });
  it('is null without an Ozon speed — zero, negative or NaN', () => {
    expect(coverageDays({ shelf: 500, ozon: 20 }, 0)).toBeNull();
    expect(coverageDays({ shelf: 500, ozon: 20 }, -1)).toBeNull();
    expect(coverageDays({ shelf: 500, ozon: 20 }, NaN)).toBeNull();
  });
  it('is 0 when nothing lies anywhere but the product sold', () => {
    expect(coverageDays({ shelf: 0, ozon: 0 }, 2)).toBe(0);
  });
  it('treats a missing part as 0 rather than NaN', () => {
    expect(coverageDays({ shelf: 6, ozon: undefined as unknown as number }, 2)).toBe(3);
  });
});

describe('lastReceiptByArticle / daysLying: how long a product lies', () => {
  it('keeps the latest «Приход» even when an older row comes later, in both date formats', () => {
    const rows = [tx('01.06.2026, 09:00:00', 'A', 7), tx('2026-09-18', 'A', 5), tx('2026-06-10', 'A', 2), tx('2026-09-19', 'A', 1, 'Расход')]; // latest in the middle
    const m = lastReceiptByArticle(rows);
    expect(ymd(m.get('A')!)).toBe('2026-09-18');
    expect(daysLying(m.get('A')!, NOW)).toBe(3);
  });
  it('ignores expenses, corrections and unreadable dates; tolerates an undefined list', () => {
    const rows = [tx('2026-09-01', 'B', 2, 'Расход'), tx('2026-09-02', 'B', 2, 'Корректировка'), tx('вчера', 'B', 2)];
    expect(lastReceiptByArticle(rows).has('B')).toBe(false);
    expect(lastReceiptByArticle(undefined as unknown as Transaction[]).size).toBe(0);
  });
  it('item 84: a China cost-correction receipt (qty 0) does not reset «лежит N дней»', () => {
    const rows = [tx('2026-06-10', 'C', 5), tx('2026-09-19', 'C', 0)]; // later correction, 0 pcs
    const m = lastReceiptByArticle(rows);
    expect(ymd(m.get('C')!)).toBe('2026-06-10');
  });
  it('daysLying floors to whole days and never goes negative', () => {
    expect(daysLying(new Date('2026-09-20T16:00:00'), NOW)).toBe(0);
    expect(daysLying(new Date('2026-09-25T00:00:00'), NOW)).toBe(0);
  });
});

describe('turnoverSortValue', () => {
  it('sorts null after every number in ascending order', () => {
    const sorted = [null, 12, 0, 300].sort((a, b) => turnoverSortValue(a) - turnoverSortValue(b));
    expect(sorted).toEqual([0, 12, 300, null]);
  });
});

describe('Dashboard wiring', () => {
  const src = readFileSync(new URL('../components/Dashboard.tsx', import.meta.url), 'utf8');
  it('the column takes the shelf plus the Ozon estimate at the planner speed', () => {
    expect(src).toMatch(/coverageDays\(\{ shelf: item\.quantity, ozon: cov\?\.totalEstimated \|\| 0 \}, cov\?\.perDay \|\| 0\)/);
  });
  it('the summary card divides the same totals by the same speeds', () => {
    expect(src).toMatch(/calculatedTurnover[\s\S]*totalStock \+= item\.quantity \+ \(cov\?\.totalEstimated \|\| 0\);[\s\S]*totalPerDay \+= cov\?\.perDay \|\| 0;/);
  });
  it('an article without Ozon sales shows «нет продаж на Ozon» with its age and sorts as the slowest', () => {
    expect(src).toContain('нет продаж на Ozon');
    expect(src).toMatch(/daysLying\(/);
    expect(src).toMatch(/sortConfig\.key === 'turnover'[\s\S]*turnoverSortValue/);
  });
  it('Ozon data and coverage load for every user, not only admins', () => {
    expect(src).toMatch(/useEffect\(\(\) => \{\n\s*\/\/ Item 77[\s\S]*?fetchOzonInitialData\(\);/);
    expect(src).not.toMatch(/const ozonCoverage = useMemo<OzonCoverageResult \| null>\(\(\) => \{\n\s*if \(!isAdmin\) return null;/);
  });
});
