/** Item 97 ticket 07, part A: week spread (step 2) pure rules. Written test-first. */
import { describe, expect, it } from 'vitest';
import { invoiceSelectionKop, splitKopByWeights, weekSpreadTargets } from './weekSpread';

const L = (n: number, qty: string, price: number, sum: number, toSupply = true, packaging = false) =>
  ({ n, name: `Товар ${n} (ООО Ромашка)`, qty, price, sum, toSupply, packaging });
const LINES = [
  L(1, '10', 12.35, 123.5),
  L(2, '3', 33.33, 100),
  L(3, '4', 5, 20, false),
  L(4, '1', 250, 250, true, true)
];

describe('invoiceSelectionKop', () => {
  it('full quantity takes the line sum exactly, even when qty x price differs', () => {
    const r = invoiceSelectionKop(LINES, [{ n: 2, qty: '3' }]);
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.selectedKop).toBe(10000);
  });
  it('total is the sum of ALL lines and unallocated is total minus selected', () => {
    const r = invoiceSelectionKop(LINES, [{ n: 1, qty: '10' }]);
    expect(r.totalKop).toBe(12350 + 10000 + 2000 + 25000);
    expect(r.selectedKop).toBe(12350);
    expect(r.unallocatedKop).toBe(r.totalKop - 12350);
  });
  it('partial quantity is qtyMilli x priceKop / 1000 rounded half-up (2.5 x 12.35 = 30.875 -> 30.88)', () => {
    const r = invoiceSelectionKop(LINES, [{ n: 1, qty: '2.5' }]);
    expect(r.ok).toBe(true);
    expect(r.selectedKop).toBe(3088);
  });
  it('partial quantity with 3 decimals is accepted (0.001 x 12.35 = 0.01235 -> 0.01)', () => {
    const r = invoiceSelectionKop(LINES, [{ n: 1, qty: '0.001' }]);
    expect(r.ok).toBe(true);
    expect(r.selectedKop).toBe(1);
  });
  it('several selected lines add up; a packaging line may be selected', () => {
    const r = invoiceSelectionKop(LINES, [{ n: 1, qty: '10' }, { n: 4, qty: '1' }]);
    expect(r.ok).toBe(true);
    expect(r.selectedKop).toBe(12350 + 25000);
  });
  it('unknown line is refused and the message names the line number', () => {
    const r = invoiceSelectionKop(LINES, [{ n: 9, qty: '1' }]);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toContain('9');
  });
  it('a line with toSupply=false is refused and named', () => {
    const r = invoiceSelectionKop(LINES, [{ n: 3, qty: '4' }]);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toContain('3');
  });
  it.each(['', '0', '-1', '1.2345', '10.001', 'abc'])('quantity "%s" is refused and the line is named', (q) => {
    const r = invoiceSelectionKop(LINES, [{ n: 1, qty: q }]);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toContain('1');
  });
  it('duplicate line is refused', () => {
    const r = invoiceSelectionKop(LINES, [{ n: 1, qty: '1' }, { n: 1, qty: '2' }]);
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
  });
  it('no selection at all is refused', () => {
    const r = invoiceSelectionKop(LINES, []);
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
  });
});

describe('splitKopByWeights', () => {
  it('sums to the total exactly with largest remainder (100 / 1,1,1 -> 34,33,33)', () => {
    expect(splitKopByWeights(100, [1, 1, 1])).toEqual([34, 33, 33]);
  });
  it('ties go to the earlier index (1 kopeck over 1,1,1 -> first)', () => {
    expect(splitKopByWeights(1, [1, 1, 1])).toEqual([1, 0, 0]);
  });
  it('the biggest remainder wins over the index (129900 / 6,5,3)', () => {
    expect(splitKopByWeights(129900, [6, 5, 3])).toEqual([55671, 46393, 27836]);
  });
  it('all-zero weights give all zeros', () => {
    expect(splitKopByWeights(5, [0, 0])).toEqual([0, 0]);
  });
  it('a zero weight gets nothing', () => {
    expect(splitKopByWeights(10, [1, 0, 1])).toEqual([5, 0, 5]);
  });
});

const row = (id: number, article: string, quantity: number, isComponent = false) => ({ id, article, quantity, isComponent });
// 120 pcs / 20 = 6 boxes, 45 / 10 = ceil(4.5) = 5, 75 / 25 = 3
const OPS3 = [
  { opId: 'op1', cabinet: 'Кабинет 1', rows: [row(1, 'A-1', 120)] },
  { opId: 'op2', cabinet: 'Кабинет 2', rows: [row(2, 'B-2', 45)] },
  { opId: 'op3', cabinet: 'Кабинет 1', rows: [row(3, 'C-3', 75)] }
];
const NORMS3 = { 'A-1': 20, 'B-2': 10, 'C-3': 25 };

describe('weekSpreadTargets', () => {
  it('129900 kop over 120/45/75 pcs (6/5/3 boxes) gives 55671 / 46393 / 27836 and sums exactly', () => {
    const r = weekSpreadTargets(129900, OPS3, NORMS3);
    expect(r.ok).toBe(true);
    expect(r.missing).toEqual([]);
    expect(r.operations.map((o) => o.boxes)).toEqual([6, 5, 3]);
    expect(r.operations.map((o) => o.shareKop)).toEqual([55671, 46393, 27836]);
    const rowSum = r.operations.flatMap((o) => o.rows).reduce((s, x) => s + x.shareKop, 0);
    expect(rowSum).toBe(129900);
  });
  it('byCabinet sums operation shares per cabinet', () => {
    const r = weekSpreadTargets(129900, OPS3, NORMS3);
    expect(r.byCabinet).toEqual({ 'Кабинет 1': 55671 + 27836, 'Кабинет 2': 46393 });
  });
  it('a kit row uses the kit own norm and its component rows carry 0; row sums equal the op share', () => {
    const ops = [
      { opId: 'op1', cabinet: 'Кабинет 1', rows: [row(1, 'A-1', 120), row(2, 'KIT-1', 5), row(3, 'A-1', 10, true)] },
      { opId: 'op2', cabinet: 'Кабинет 2', rows: [row(4, 'B-2', 45)] }
    ];
    const r = weekSpreadTargets(129900, ops, { 'A-1': 20, 'B-2': 10, 'KIT-1': 2 });
    expect(r.ok).toBe(true);
    expect(r.operations.map((o) => o.boxes)).toEqual([9, 5]);
    expect(r.operations.map((o) => o.shareKop)).toEqual([83507, 46393]);
    const op1 = r.operations[0];
    expect(op1.rows.map((x) => [x.id, x.boxes, x.shareKop])).toEqual([[1, 6, 55671], [2, 3, 27836], [3, 0, 0]]);
    expect(op1.rows.reduce((s, x) => s + x.shareKop, 0)).toBe(op1.shareKop);
    expect(r.operations[1].rows.map((x) => x.shareKop)).toEqual([46393]);
  });
  it('a component row needs no norm', () => {
    const ops = [{ opId: 'op1', cabinet: 'K', rows: [row(1, 'A-1', 20), row(2, 'NO-NORM', 5, true)] }];
    const r = weekSpreadTargets(1000, ops, { 'A-1': 20 });
    expect(r.ok).toBe(true);
    expect(r.operations[0].rows.map((x) => x.shareKop)).toEqual([1000, 0]);
  });
  it('a row with qty <= 0 carries nothing and needs no norm', () => {
    const ops = [{ opId: 'op1', cabinet: 'K', rows: [row(1, 'A-1', 20), row(2, 'ZERO', 0)] }];
    const r = weekSpreadTargets(1000, ops, { 'A-1': 20 });
    expect(r.ok).toBe(true);
    expect(r.operations[0].rows.map((x) => [x.boxes, x.shareKop])).toEqual([[1, 1000], [0, 0]]);
  });
  it.each([
    ['absent key', {}],
    ['null', { 'A-1': null }],
    ['zero', { 'A-1': 0 }],
    ['negative', { 'A-1': -5 }],
    ['NaN', { 'A-1': NaN }]
  ])('missing norm (%s) blocks, names the article and returns no operations', (_n, norms) => {
    const ops = [{ opId: 'op1', cabinet: 'K', rows: [row(1, 'A-1', 20)] }];
    const r = weekSpreadTargets(1000, ops, norms as Record<string, number | null>);
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(['A-1']);
    expect(r.operations).toEqual([]);
  });
  it('missing list is unique and sorted', () => {
    const ops = [
      { opId: 'op1', cabinet: 'K', rows: [row(1, 'Z-9', 5), row(2, 'B-2', 5)] },
      { opId: 'op2', cabinet: 'K', rows: [row(3, 'Z-9', 5), row(4, 'A-1', 5)] }
    ];
    const r = weekSpreadTargets(1000, ops, {});
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(['A-1', 'B-2', 'Z-9']);
  });
  it('remainder tie: 1 kopeck over two equal ops goes to the earlier op', () => {
    const ops = [
      { opId: 'op1', cabinet: 'K', rows: [row(1, 'A-1', 20)] },
      { opId: 'op2', cabinet: 'K', rows: [row(2, 'A-1', 20)] }
    ];
    const r = weekSpreadTargets(1, ops, { 'A-1': 20 });
    expect(r.operations.map((o) => o.shareKop)).toEqual([1, 0]);
    expect(r.byCabinet).toEqual({ K: 1 });
  });
  it('boxes round up: 13 pcs at 12 per box is 2 boxes, 25 at 12 is 3 (not nearest)', () => {
    const ops = [{ opId: 'op1', cabinet: 'K', rows: [row(1, 'A-1', 13), row(2, 'B-2', 25)] }];
    const r = weekSpreadTargets(500, ops, { 'A-1': 12, 'B-2': 12 });
    expect(r.operations[0].rows.map((x) => x.boxes)).toEqual([2, 3]);
    expect(r.operations[0].boxes).toBe(5);
    expect(r.operations[0].rows.map((x) => x.shareKop)).toEqual([200, 300]);
  });
});
