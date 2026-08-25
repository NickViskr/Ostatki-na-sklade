import { describe, expect, it } from 'vitest';
import {
  batchDestinationNote,
  BatchWriteOffGroup,
  buildBatchWriteOffPlan,
  countPieces,
  countShippablePieces,
  extrasPerUnit,
  mergeBatchItems,
  splitByQuantity,
} from './ozonBatchWriteOff';

const item = (article: string, quantity: number, price: number, status = 'ok') =>
  ({ article, quantity, price, status });

const group = (groupId: string, items: ReturnType<typeof item>[]): BatchWriteOffGroup => ({
  groupId,
  label: groupId,
  postingIds: [`${groupId}-p1`],
  items,
});

/** The server's own formula, so the test compares against what really lands in the books. */
const roundToTwo = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const serverCostForRow = (extrasOfCall: number, rowQty: number, callQty: number) =>
  (extrasOfCall > 0 && callQty > 0) ? roundToTwo((extrasOfCall * rowQty) / callQty) : 0;

describe('Merging the orders into one article list', () => {
  it('the same article in different orders becomes one row', () => {
    const merged = mergeBatchItems([
      group('A', [item('ART-1', 10, 100)]),
      group('B', [item('ART-1', 5, 100)]),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].quantity).toBe(15);
  });

  it('different articles stay apart and keep their order of appearance', () => {
    const merged = mergeBatchItems([
      group('A', [item('ART-1', 10, 100), item('ART-2', 3, 50)]),
      group('B', [item('ART-2', 7, 50), item('ART-3', 1, 20)]),
    ]);
    expect(merged.map((m) => [m.article, m.quantity])).toEqual([
      ['ART-1', 10],
      ['ART-2', 10],
      ['ART-3', 1],
    ]);
  });

  it('an unrecognised article never merges into a healthy one', () => {
    const merged = mergeBatchItems([
      group('A', [item('ART-1', 10, 100)]),
      group('B', [item('ART-1', 4, 0, 'unknown')]),
    ]);
    expect(merged).toHaveLength(2);
    expect(merged.find((m) => m.status === 'unknown')!.quantity).toBe(4);
  });

  it('merging does not mutate the incoming orders', () => {
    const source = group('A', [item('ART-1', 10, 100)]);
    mergeBatchItems([source, group('B', [item('ART-1', 5, 100)])]);
    expect(source.items[0].quantity).toBe(10);
  });

  it('counting pieces walks every row', () => {
    expect(countPieces([item('ART-1', 10, 100), item('ART-2', 5, 50)])).toBe(15);
  });
});

describe('Splitting the additional costs by piece count', () => {
  it('an even split gives even shares', () => {
    expect(splitByQuantity(600, [10, 10, 10])).toEqual([200, 200, 200]);
  });

  it('shares are proportional to pieces, not to the number of orders', () => {
    expect(splitByQuantity(1000, [40, 10])).toEqual([800, 200]);
  });

  it('an uneven split still adds up to the entered sum, to the kopeck', () => {
    const shares = splitByQuantity(100, [1, 1, 1]);
    expect(shares.reduce((s, v) => s + v, 0)).toBe(100);
    expect(shares).toEqual([33.34, 33.33, 33.33]);
  });

  it('nothing evaporates on a long list of awkward quantities', () => {
    const quantities = [7, 13, 5, 11, 3, 29, 17];
    const shares = splitByQuantity(1234.56, quantities);
    const sum = Math.round(shares.reduce((s, v) => s + v, 0) * 100) / 100;
    expect(sum).toBe(1234.56);
  });

  it('an order with no pieces carries nothing', () => {
    expect(splitByQuantity(500, [10, 0, 10])).toEqual([250, 0, 250]);
  });

  it('no pieces at all — no shares, and no division by zero', () => {
    expect(splitByQuantity(500, [0, 0])).toEqual([0, 0]);
  });

  it('no additional costs — no shares', () => {
    expect(splitByQuantity(0, [10, 20])).toEqual([0, 0]);
  });

  it('a single order carries the whole sum', () => {
    expect(splitByQuantity(777.77, [42])).toEqual([777.77]);
  });
});

describe('Splitting into several expenses matches one combined write-off', () => {
  const groups = [
    group('A', [item('ART-1', 10, 100), item('ART-2', 5, 300)]),
    group('B', [item('ART-1', 20, 100)]),
    group('C', [item('ART-3', 15, 20)]),
  ];

  it('the cost per piece is the same for every article, whatever it costs', () => {
    const plan = buildBatchWriteOffPlan(groups, 1000);
    expect(plan.totalQuantity).toBe(50);
    expect(plan.extrasPerUnit).toBe(20);
  });

  it('every order carries exactly its pieces worth of the costs', () => {
    const plan = buildBatchWriteOffPlan(groups, 1000);
    expect(plan.groups.map((g) => [g.quantity, g.extrasShare])).toEqual([
      [15, 300],
      [20, 400],
      [15, 300],
    ]);
  });

  it('the sum of the shares is the sum the user entered', () => {
    const plan = buildBatchWriteOffPlan(groups, 999.99);
    const sum = Math.round(plan.groups.reduce((s, g) => s + g.extrasShare, 0) * 100) / 100;
    expect(sum).toBe(999.99);
  });

  it('the books come out the same as if it were written as one expense', () => {
    const extras = 1000;
    const plan = buildBatchWriteOffPlan(groups, extras);

    // One expense over the combined list, the way the server would spread the costs.
    const combined = plan.mergedItems.map((row) =>
      serverCostForRow(extras, row.quantity, plan.totalQuantity)
    );
    const combinedTotal = combined.reduce((s, v) => s + v, 0);

    // Three expenses, each with its own share.
    const splitTotal = plan.groups.reduce((sum, g) => {
      const perRow = g.items.map((row) => serverCostForRow(g.extrasShare, row.quantity, g.quantity));
      return sum + perRow.reduce((s, v) => s + v, 0);
    }, 0);

    expect(Math.round(splitTotal * 100) / 100).toBe(Math.round(combinedTotal * 100) / 100);
    expect(Math.round(splitTotal * 100) / 100).toBe(extras);
  });

  it('an awkward sum lands within a kopeck of the combined write-off', () => {
    const extras = 1234.57;
    const plan = buildBatchWriteOffPlan(
      [
        group('A', [item('ART-1', 7, 100)]),
        group('B', [item('ART-2', 13, 250)]),
        group('C', [item('ART-3', 3, 40)]),
      ],
      extras
    );
    const splitTotal = plan.groups.reduce((sum, g) => {
      const perRow = g.items.map((row) => serverCostForRow(g.extrasShare, row.quantity, g.quantity));
      return sum + perRow.reduce((s, v) => s + v, 0);
    }, 0);
    expect(Math.abs(splitTotal - extras)).toBeLessThanOrEqual(0.01);
  });

  it('the postings of every order are carried through untouched', () => {
    const plan = buildBatchWriteOffPlan(groups, 100);
    expect(plan.groups.map((g) => g.postingIds)).toEqual([['A-p1'], ['B-p1'], ['C-p1']]);
  });

  it('an empty batch produces nothing instead of a division by zero', () => {
    const plan = buildBatchWriteOffPlan([], 500);
    expect(plan.mergedItems).toEqual([]);
    expect(plan.totalQuantity).toBe(0);
    expect(plan.extrasPerUnit).toBe(0);
    expect(plan.groups).toEqual([]);
  });
});

describe('Costs per piece, never per line value', () => {
  it('a cheap article carries the same costs as an expensive one', () => {
    const plan = buildBatchWriteOffPlan(
      [group('A', [item('CHEAP', 10, 1), item('PRICEY', 10, 10000)])],
      200
    );
    expect(plan.extrasPerUnit).toBe(10);
    // Under the old value-based split PRICEY would have carried almost the whole 200 roubles.
    expect(extrasPerUnit(200, plan.totalQuantity)).toBe(10);
  });

  it('items with no cost at all still carry their share', () => {
    const plan = buildBatchWriteOffPlan([group('A', [item('FREE', 4, 0)])], 40);
    expect(plan.extrasPerUnit).toBe(10);
  });
});

describe('The note left in the History for an order of a batch', () => {
  const note = () => batchDestinationNote(['A-1', 'B-2'], 10, 30, 200, 600);

  it('names every order of the batch and this order\'s share', () => {
    expect(note()).toBe(
      '[Общая поставка: заявки № A-1, № B-2; доля этой заявки 10 из 30 шт., 200.00 руб. из 600.00 руб.]'
    );
  });

  // The server still falls back to reading costs out of the destination text. These are its
  // own regexes: if the note ever matched one, the order would be charged twice.
  it('carries no rouble sign the server could mistake for a cost', () => {
    const text = `Ozon (Shop) [Упаковка: 30 шт. x 5₽ = 150₽ | Услуги: Паллета x2 (600₽)] ${note()}`;
    const services = text.match(/Услуги:([^\]]*)/);
    const found: number[] = [];
    if (services) {
      const re = /\(([\d.,]+)\s*₽\)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(services[1])) !== null) found.push(Number(m[1]));
    }
    expect(found).toEqual([600]);
    expect(note()).not.toContain('₽');
  });

  it('the note never matches the packaging or «other» patterns either', () => {
    expect(/Упаковка:[^|\]]*=\s*([\d.,]+)\s*₽/.test(note())).toBe(false);
    expect(/Прочее:\s*([\d.,]+)\s*₽/.test(note())).toBe(false);
  });
});

describe('Only the pieces that are really written off carry the costs', () => {
  it('an unrecognised article is not counted', () => {
    const items = [item('OK-1', 10, 100), item('MYSTERY', 5, 0, 'unknown')];
    expect(countPieces(items)).toBe(15);
    expect(countShippablePieces(items)).toBe(10);
  });

  it('the share of an order is not inflated by its unrecognised rows', () => {
    // The server skips the unknown row, so 600 roubles are spread over 20 pieces, not 25.
    const plan = buildBatchWriteOffPlan(
      [
        group('A', [item('OK-1', 10, 100), item('MYSTERY', 5, 0, 'unknown')]),
        group('B', [item('OK-2', 10, 100)]),
      ],
      600
    );
    expect(plan.totalQuantity).toBe(20);
    expect(plan.extrasPerUnit).toBe(30);
    expect(plan.groups.map((g) => g.extrasShare)).toEqual([300, 300]);
  });

  it('an order made only of unrecognised rows carries nothing', () => {
    const plan = buildBatchWriteOffPlan(
      [group('A', [item('OK-1', 10, 100)]), group('B', [item('MYSTERY', 5, 0, 'unknown')])],
      500
    );
    expect(plan.groups.map((g) => g.extrasShare)).toEqual([500, 0]);
  });
});
