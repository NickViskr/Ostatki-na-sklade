/** Item 97 ticket 07, part A: week spread TS functions and their Code.gs twins agree. */
import { describe, expect, it } from 'vitest';
import { createRequire } from 'module';
import { invoiceSelectionKop, splitKopByWeights, weekSpreadTargets } from './weekSpread';

const require = createRequire(import.meta.url);
const p = require.resolve('../../tests/apps-script/harness.cjs');
delete require.cache[p];
const pure = require('../../tests/apps-script/harness.cjs').context;
const plain = (v: unknown) => JSON.parse(JSON.stringify(v));

const L = (n: number, qty: string, price: number, sum: number, toSupply = true, packaging = false) =>
  ({ n, name: `Товар ${n} (ООО Ромашка)`, qty, price, sum, toSupply, packaging });
const LINES = [L(1, '10', 12.35, 123.5), L(2, '3', 33.33, 100), L(3, '4', 5, 20, false), L(4, '1', 250, 250, true, true)];
const row = (id: number, article: string, quantity: number, isComponent = false) => ({ id, article, quantity, isComponent });
const OPS = [
  { opId: 'op1', cabinet: 'Кабинет 1', rows: [row(1, 'A-1', 120), row(2, 'KIT-1', 5), row(3, 'A-1', 10, true)] },
  { opId: 'op2', cabinet: 'Кабинет 2', rows: [row(4, 'B-2', 45), row(5, 'Z-0', 0)] },
  { opId: 'op3', cabinet: 'Кабинет 1', rows: [row(6, 'C-3', 75)] }
];
const NORMS = { 'A-1': 20, 'B-2': 10, 'C-3': 25, 'KIT-1': 2 };

describe('item 97 t07: week spread twins', () => {
  it('invoiceSelectionKopGs matches TS for valid selections, including messages of every invalid case', () => {
    const cases = [
      [{ n: 1, qty: '10' }], [{ n: 1, qty: '2.5' }, { n: 4, qty: '1' }], [{ n: 2, qty: '3' }],
      [{ n: 9, qty: '1' }], [{ n: 3, qty: '4' }], [{ n: 1, qty: '' }], [{ n: 1, qty: '0' }], [{ n: 1, qty: '-1' }],
      [{ n: 1, qty: '1.2345' }], [{ n: 1, qty: '10.001' }], [{ n: 1, qty: '1' }, { n: 1, qty: '2' }], []
    ];
    for (const sel of cases) {
      expect(plain(pure.invoiceSelectionKopGs(LINES, sel))).toEqual(plain(invoiceSelectionKop(LINES, sel)));
    }
  });
  it('splitKopByWeightsGs matches TS (remainders, ties, zeros)', () => {
    for (const [t, w] of [[100, [1, 1, 1]], [1, [1, 1, 1]], [129900, [6, 5, 3]], [5, [0, 0]], [10, [1, 0, 1]]] as const) {
      expect(plain(pure.splitKopByWeightsGs(t, [...w]))).toEqual(plain(splitKopByWeights(t, [...w])));
    }
  });
  it('weekSpreadTargetsGs matches TS for a valid spread and for missing norms', () => {
    const ok = weekSpreadTargets(129900, OPS, NORMS);
    expect(ok.ok).toBe(true);
    expect(plain(pure.weekSpreadTargetsGs(129900, OPS, NORMS))).toEqual(plain(ok));
    for (const norms of [{}, { ...NORMS, 'B-2': null }, { ...NORMS, 'C-3': 0 }, { ...NORMS, 'A-1': -1 }]) {
      const ts = weekSpreadTargets(129900, OPS, norms as Record<string, number | null>);
      expect(ts.ok).toBe(false);
      expect(plain(pure.weekSpreadTargetsGs(129900, OPS, norms))).toEqual(plain(ts));
    }
  });
  it('weekSpreadTargetsGs rounds boxes up like TS (13 and 25 pcs at 12 per box)', () => {
    const ops = [{ opId: 'op1', cabinet: 'K', rows: [row(1, 'A-1', 13), row(2, 'B-2', 25)] }];
    const norms = { 'A-1': 12, 'B-2': 12 };
    const ts = weekSpreadTargets(500, ops, norms);
    expect(ts.operations[0].rows.map((x) => x.boxes)).toEqual([2, 3]);
    expect(plain(pure.weekSpreadTargetsGs(500, ops, norms))).toEqual(plain(ts));
  });
});
