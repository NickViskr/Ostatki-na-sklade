/** Item 97 ticket 06, part A: week packaging (step 1) pure rules. */
import { describe, expect, it } from 'vitest';
import {
  invoicePackagingTotalKop, invoiceLineIsPackaging, isPackagingLineName, step1TotalKop,
  weekArticleSummary, weekPackagingTargets
} from './weekPackaging';

const row = (id: number, article: string, quantity: number, isComponent = false) => ({ id, article, quantity, isComponent });
const OPS = [
  { opId: 'op1', rows: [row(1, 'A-1', 30), row(2, 'KIT-1', 5), row(3, 'A-1', 5, true)] },
  { opId: 'op2', rows: [row(4, 'A-1', 7), row(5, 'B-2', 10)] }
];
const line = (name: string, sum: string, packaging?: boolean) => ({ name, qty: '1', unit: 'шт', price: sum, sum, packaging });

describe('isPackagingLineName / invoiceLineIsPackaging', () => {
  it('recognises names starting with «стикеровк» or «упаковк», any case, leading spaces ignored', () => {
    expect(isPackagingLineName('Стикеровка')).toBe(true);
    expect(isPackagingLineName('  упаковка товара')).toBe(true);
  });
  it('does not treat a long service name that only contains «упаковка» as packaging', () => {
    expect(isPackagingLineName('Комплекс услуг фулфилмента (забор, упаковка, отгрузка)')).toBe(false);
  });
  it('a stored mark wins over the name in both directions', () => {
    expect(invoiceLineIsPackaging(line('Комплекс услуг', '1,00', true))).toBe(true);
    expect(invoiceLineIsPackaging(line('Стикеровка', '1,00', false))).toBe(false);
    expect(invoiceLineIsPackaging(line('Стикеровка', '1,00'))).toBe(true);
  });
});

describe('weekArticleSummary', () => {
  it('sums quantity per article across operations, skips components, sorts by article', () => {
    expect(weekArticleSummary(OPS)).toEqual([
      { article: 'A-1', qty: 37 }, { article: 'B-2', qty: 10 }, { article: 'KIT-1', qty: 5 }
    ]);
  });
});

describe('weekPackagingTargets', () => {
  const prices = [{ article: 'A-1', unit: '5,50' }, { article: 'B-2', unit: '0' }, { article: 'KIT-1', unit: '2' }];

  it('target = week price × quantity in exact kopecks; a zero price is valid; components get no row', () => {
    const t = weekPackagingTargets(OPS, prices, []);
    expect(t.ok).toBe(true);
    expect(t.missing).toEqual([]);
    expect(t.invalid).toEqual([]);
    expect(t.rows.map((r) => r.id)).toEqual([1, 2, 4, 5]);
    expect(t.rows.find((r) => r.id === 1)).toEqual({ id: 1, opId: 'op1', article: 'A-1', quantity: 30, unitKop: 550, targetKop: 16500 });
    expect(t.rows.find((r) => r.id === 4)!.targetKop).toBe(3850);
    expect(t.rows.find((r) => r.id === 5)!.targetKop).toBe(0);
    expect(t.rows.reduce((s, r) => s + (r.article === 'A-1' ? r.targetKop : 0), 0)).toBe(20350);
  });

  it('an override applies only to its operation and article', () => {
    const t = weekPackagingTargets(OPS, prices, [{ opId: 'op2', article: 'A-1', unit: '10' }]);
    expect(t.rows.find((r) => r.id === 4)!.unitKop).toBe(1000);
    expect(t.rows.find((r) => r.id === 4)!.targetKop).toBe(7000);
    expect(t.rows.find((r) => r.id === 1)!.unitKop).toBe(550);
  });

  it('an article without a price is reported in missing and ok is false', () => {
    const t = weekPackagingTargets(OPS, prices.filter((p) => p.article !== 'B-2'), []);
    expect(t.ok).toBe(false);
    expect(t.missing).toEqual(['B-2']);
  });

  it('an unparsable unit price is reported in invalid, naming the article', () => {
    for (const bad of ['5,555', '-1', 'abc']) {
      const t = weekPackagingTargets(OPS, prices.map((p) => (p.article === 'KIT-1' ? { ...p, unit: bad } : p)), []);
      expect(t.ok, bad).toBe(false);
      expect(t.invalid, bad).toEqual(['KIT-1']);
    }
  });
});

describe('totals in kopecks', () => {
  it('step1TotalKop sums targetKop of the rows', () => {
    expect(step1TotalKop([{ targetKop: 16500 }, { targetKop: 3850 }, { targetKop: 0 }] as any)).toBe(20350);
    expect(step1TotalKop([])).toBe(0);
  });
  it('invoicePackagingTotalKop counts only packaging lines, over every invoice of the week', () => {
    const invoices = [
      { lines: [line('Стикеровка', '1 299,00'), line('Комплекс услуг фулфилмента', '9 000,00')] },
      { lines: [line('упаковка товара', '5,00'), line('Хранение', '7,00', true)] }
    ];
    expect(invoicePackagingTotalKop(invoices)).toBe(129900 + 500 + 700);
  });
});
