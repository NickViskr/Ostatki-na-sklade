/** Item 97 ticket 06, part A: weekPackagingTargets (TS) and weekPackagingTargetsGs (Code.gs) agree. */
import { describe, expect, it } from 'vitest';
import { createRequire } from 'module';
import { weekPackagingTargets } from './weekPackaging';

const require = createRequire(import.meta.url);
const p = require.resolve('../../tests/apps-script/harness.cjs');
delete require.cache[p];
const pure = require('../../tests/apps-script/harness.cjs').context;
const plain = (v: unknown) => JSON.parse(JSON.stringify(v));

const row = (id: number, article: string, quantity: number, isComponent = false) => ({ id, article, quantity, isComponent });
const OPS = [
  { opId: 'op1', rows: [row(1, 'A-1', 30), row(2, 'KIT-1', 5), row(3, 'A-1', 5, true)] },
  { opId: 'op2', rows: [row(4, 'A-1', 7), row(5, 'B-2', 10), row(6, 'C-3', 1)] }
];
const PRICES = [{ article: 'A-1', unit: '5,50' }, { article: 'B-2', unit: '0' }, { article: 'KIT-1', unit: '5,555' }];
const OVERRIDES = [{ opId: 'op2', article: 'A-1', unit: '10' }];

describe('item 97 t06: week packaging twin', () => {
  it('Code.gs weekPackagingTargetsGs returns the same result as the TS function (valid, missing and invalid cases)', () => {
    for (const prices of [PRICES, PRICES.map((x) => (x.article === 'KIT-1' ? { ...x, unit: '2' } : x))]) {
      const ts = weekPackagingTargets(OPS, prices, OVERRIDES);
      expect(plain(pure.weekPackagingTargetsGs(OPS, prices, OVERRIDES))).toEqual(plain(ts));
    }
    const full = [...PRICES.slice(0, 2), { article: 'KIT-1', unit: '2' }, { article: 'C-3', unit: '1,25' }];
    const ts = weekPackagingTargets(OPS, full, OVERRIDES);
    expect(ts.ok).toBe(true);
    expect(plain(pure.weekPackagingTargetsGs(OPS, full, OVERRIDES))).toEqual(plain(ts));
  });
});
