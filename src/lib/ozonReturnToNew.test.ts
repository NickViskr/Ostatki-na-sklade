// Item 69. «Вернуть в новые» per supply row; the group button lists its rows and skips a row
// whose unshipped return is already posted.

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { canReturnToNew, returnGroupToNewMessage, returnRowToNewMessage, returnToNewPlan } from './ozonUnshipped';
import type { ExternalShipment } from '../types';

function row(over: Partial<ExternalShipment>): ExternalShipment {
  return {
    postingId: 'P', detectedAt: '2026-09-06 19:13:32', shipmentDate: '2026-09-16', status: 'processed',
    itemsJSON: '[]', transGroupInfo: '', cabinet: 'MaxiStore', storageWarehouse: 'ХОРУГВИНО_РФЦ', ...over
  } as ExternalShipment;
}

const returned = JSON.stringify({
  returnedAt: '2026-09-15T18:00:00.000Z', by: 'Николай', opId: 'x',
  lines: [{ offerId: 'A', article: 'A', declared: 36, shipped: 18 }]
});

const written = row({ postingId: '1', status: 'processed' });
const ignored = row({ postingId: '2', status: 'ignored', storageWarehouse: 'КАЗАНЬ_РФЦ' });
const fresh = row({ postingId: '3', status: 'new' });
const withReturn = row({ postingId: '4', status: 'processed', shippedJSON: returned });

describe('canReturnToNew', () => {
  it('a written-off or ignored row can go back; a new row and a row with a posted return cannot', () => {
    expect(canReturnToNew(written)).toBe(true);
    expect(canReturnToNew(ignored)).toBe(true);
    expect(canReturnToNew(fresh)).toBe(false);
    expect(canReturnToNew(withReturn)).toBe(false);
  });
});

describe('returnToNewPlan', () => {
  it('splits the order into rows to return and rows blocked by a posted return; new rows are neither', () => {
    const plan = returnToNewPlan([written, ignored, fresh, withReturn]);
    expect(plan.rows.map((r) => r.postingId)).toEqual(['1', '2']);
    expect(plan.blocked.map((r) => r.postingId)).toEqual(['4']);
  });

  it('an empty or all-new order gives an empty plan', () => {
    expect(returnToNewPlan([])).toEqual({ rows: [], blocked: [] });
    expect(returnToNewPlan([fresh])).toEqual({ rows: [], blocked: [] });
  });
});

describe('confirmation texts', () => {
  it('a written-off row is named and told to delete its write-off from «История» first', () => {
    const text = returnRowToNewMessage(written, '127380557-1');
    expect(text).toContain('ХОРУГВИНО_РФЦ (№ 1)');
    expect(text).toContain('127380557-1');
    expect(text).toContain('удалите её отгрузку из Истории');
  });

  it('an ignored row carries no write-off warning, only that the rest stays put', () => {
    const text = returnRowToNewMessage(ignored, '127380557-1');
    expect(text).toContain('КАЗАНЬ_РФЦ (№ 2)');
    expect(text).not.toContain('Истории');
    expect(text).toContain('Остальные поставки заявки не изменятся');
  });

  it('the group text lists every row, counts the written-off ones and names the blocked ones', () => {
    const text = returnGroupToNewMessage(returnToNewPlan([written, ignored, withReturn]), '127380557-1');
    expect(text).toContain('ХОРУГВИНО_РФЦ (№ 1), КАЗАНЬ_РФЦ (№ 2)');
    expect(text).toContain('Из них списано: 1');
    expect(text).toContain('Не вернутся (возврат неотгруженного уже проведён): ХОРУГВИНО_РФЦ (№ 4)');
  });

  it('with only ignored rows and nothing blocked the group text has neither tail', () => {
    const text = returnGroupToNewMessage(returnToNewPlan([ignored]), 'X');
    expect(text).not.toContain('Из них списано');
    expect(text).not.toContain('Не вернутся');
  });
});

describe('wiring in OzonSuppliesTab', () => {
  const tab = fs.readFileSync(path.join(process.cwd(), 'src/components/OzonSuppliesTab.tsx'), 'utf8');

  it('the row button exists only for canReturnToNew rows of a real order and calls the row handler', () => {
    expect(tab).toMatch(/\{!group\.isVirtual && canReturnToNew\(s\) && \(\s*<button\s*id=\{`btn-return-new-\$\{s\.postingId\}`\}\s*onClick=\{\(e\) => \{ e\.stopPropagation\(\); handleReturnRowToNew\(s, group\.label\); \}\}/);
  });

  it('the row handler marks exactly one posting and the group handler marks the plan rows', () => {
    expect(tab).toMatch(/handleReturnRowToNew = useCallback\(\(s: ExternalShipment, orderLabel: string\) => \{[\s\S]{0,400}markExternalShipmentsBatch\(\[s\.postingId\], 'new'\)/);
    expect(tab).toMatch(/const plan = returnToNewPlan\(group\.items as ExternalShipment\[\]\);[\s\S]{0,600}markExternalShipmentsBatch\(plan\.rows\.map\(p => p\.postingId\), 'new'\)/);
    expect(tab).toContain('returnGroupToNewMessage(plan, group.label)');
    expect(tab).toContain('returnRowToNewMessage(s, orderLabel)');
  });

  it('the group button is shown only when some row can be returned', () => {
    expect(tab).toContain('(group.items as ExternalShipment[]).some(canReturnToNew) && (');
    expect(tab).not.toMatch(/group\.items\.some\(\(i\) => i\.status === 'processed' \|\| i\.status === 'ignored'\)/);
  });
});
