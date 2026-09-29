import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { batchOrderOptions, commentMatches, commentPayload, hasComment, isCommentOnlyEdit } from './operationComment';
import { useWarehouseStore } from '../store/useWarehouseStore';

describe('operation comment (item 90, browser half)', () => {
  it('commit payload carries the trimmed comment only when one is given', () => {
    expect(commentPayload('  для себя ')).toEqual({ comment: 'для себя' });
    expect(commentPayload('   ')).toEqual({});
    expect(commentPayload(undefined)).toEqual({});
  });

  it('every order of a combined write-off gets the same comment', () => {
    const groups = [
      { postingIds: ['a'], extrasShare: 10 },
      { postingIds: ['b'], extrasShare: 20 },
    ];
    const options = groups.map((g) => batchOrderOptions(g, 'общая', 'OP-1'));
    expect(options.map((o) => o.comment)).toEqual(['общая', 'общая']);
    expect(options.map((o) => o.postingIds)).toEqual([['a'], ['b']]);
  });

  it('every order of a combined write-off gets the same shipment number', () => {
    const groups = [
      { postingIds: ['a'], extrasShare: 10 },
      { postingIds: ['b'], extrasShare: 20 },
      { postingIds: ['c'], extrasShare: 30 },
    ];
    const options = groups.map((g) => batchOrderOptions(g, '', 'OP-7'));
    expect(options.map((o) => o.shipmentId)).toEqual(['OP-7', 'OP-7', 'OP-7']);
  });

  it('commit sends shipmentId only when one is given', async () => {
    const fetchGas = vi.fn().mockResolvedValue({ status: 'error', message: 'stop' });
    useWarehouseStore.setState({ fetchGas, kits: [] } as never);
    const item = [{ article: 'A', quantity: 1, price: 1 }] as never;
    await useWarehouseStore.getState().commitTransaction(item, 'Приход', 'Склад', '', 'op-1', { shipmentId: 'OP-7' });
    await useWarehouseStore.getState().commitTransaction(item, 'Приход', 'Склад', '', 'op-2', { comment: 'x' });
    expect(fetchGas.mock.calls[0][1].shipmentId).toBe('OP-7');
    expect('shipmentId' in fetchGas.mock.calls[1][1]).toBe(false);
  });

  it('ConfirmModal: the combined path passes the window-wide id as shipment number; the single path passes none', () => {
    const src = readFileSync(new URL('../components/ConfirmModal.tsx', import.meta.url), 'utf8');
    expect(src).toMatch(/batchOrderOptions\(group, comment, opIdRef\.current\)/);
    expect(src).toMatch(/opIdRef\.current,\n\s*\{ comment \},\n\s*\);/);
  });

  it('updateTransaction sends data.comment, also an empty one to clear it', async () => {
    const fetchGas = vi.fn().mockResolvedValue({ status: 'error', message: 'stop' });
    useWarehouseStore.setState({ fetchGas } as never);
    await useWarehouseStore.getState().handleUpdateTransaction('r1', { comment: '' } as never);
    expect(fetchGas).toHaveBeenCalledWith('updateTransaction', { id: 'r1', data: { comment: '' } });
  });

  it('search finds a row by its comment, case-insensitively', () => {
    expect(commentMatches({ comment: 'Возврат от Ивана' }, 'иван')).toBe(true);
    expect(commentMatches({ comment: 'другое' }, 'иван')).toBe(false);
    expect(commentMatches({}, 'иван')).toBe(false);
  });

  it('the 💬 marker shows only for a non-empty comment', () => {
    expect(hasComment({ comment: 'x' })).toBe(true);
    expect(hasComment({ comment: '' })).toBe(false);
    expect(hasComment({})).toBe(false);
  });
});

describe('isCommentOnlyEdit', () => {
  const stored = { date: 'D', type: 'Приход', article: 'A', quantity: 5, price: 10, writeOffCost: 0, total: 50, destination: 'Склад', deliveryDate: '', comment: 'old' };
  it('is true when only the comment differs (or nothing does)', () => {
    expect(isCommentOnlyEdit(stored, { ...stored, comment: 'new' })).toBe(true);
    expect(isCommentOnlyEdit(stored, { ...stored })).toBe(true);
  });
  it('is false when any other field changed, or the stored row is unknown', () => {
    expect(isCommentOnlyEdit(stored, { ...stored, comment: 'new', quantity: 6 })).toBe(false);
    expect(isCommentOnlyEdit(stored, { ...stored, price: 11 })).toBe(false);
    expect(isCommentOnlyEdit(undefined, stored)).toBe(false);
  });
});
