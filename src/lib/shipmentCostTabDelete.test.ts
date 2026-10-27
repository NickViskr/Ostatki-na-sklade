/**
 * Item 97 ticket 01, part A (96.1), independent re-check by the tester. The trash of a product on the
 * tab «Отгрузка» must reach the store exactly like «История» does: handleDeleteMultipleTransactions
 * with the row and its kit component rows, handleDeleteTransaction for a plain row, nothing else, and
 * no tab-owned money path (no re-commit, no update). The confirm dialog is driven for real: the tab is
 * rendered on the server, `ConfirmDialog` is replaced by a recorder and the state «what is being
 * deleted» is forced, so the dialog's own `onConfirm` runs the tab's real handler against store spies.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const harness = vi.hoisted(() => ({
  transToDelete: null as string | null,
  isLastItem: false,
  falseStates: 0,
  dialogs: [] as any[]
}));

vi.mock('react', async (importOriginal) => {
  const actual: any = await importOriginal();
  const real = actual.default ?? actual;
  // The tab's only `useState(null)` is the id being deleted; its first `useState(false)` is «the last item».
  const useState = (initial: any) => {
    if (initial === null) return [harness.transToDelete, () => {}];
    if (initial === false) {
      harness.falseStates += 1;
      if (harness.falseStates === 1) return [harness.isLastItem, () => {}];
    }
    return real.useState(initial);
  };
  return { ...actual, useState, default: { ...real, useState } };
});

vi.mock('../components/ConfirmDialog', () => ({
  ConfirmDialog: (props: any) => {
    harness.dialogs.push(props);
    return null;
  }
}));

import { useWarehouseStore } from '../store/useWarehouseStore';
import { ShipmentCostTab } from '../components/ShipmentCostTab';
import type { Transaction } from '../types';

const SOURCE = fs.readFileSync(path.resolve(__dirname, '../components/ShipmentCostTab.tsx'), 'utf8');

const row = (over: Partial<Transaction>): Transaction => ({
  id: 'x', date: '2026-10-19T07:00:00.000Z', type: 'Расход', article: 'A', quantity: 1, price: 100,
  writeOffCost: 100, total: 100, destination: 'Ozon (MaxiStore) [Услуги: Packing x1 (100₽)]',
  deliveryDate: '2026-10-19', opId: 'op-1', additionalCosts: 100, ...over
});
const PLAIN = row({ id: 'a', article: 'A', price: 150, total: 150 });
const OTHER = row({ id: 'b', article: 'B', price: 950, writeOffCost: 900, total: 950 });
const KIT = [
  row({ id: 'k', article: 'KIT', price: 300, writeOffCost: 0, total: 300, groupId: 'g1' }),
  row({ id: 'k1', article: 'COMP1', price: 100, writeOffCost: 100, total: 100, groupId: 'g1', isComponent: true, additionalCosts: null }),
  row({ id: 'k2', article: 'COMP2', price: 150, writeOffCost: 150, total: 150, groupId: 'g1', isComponent: true, additionalCosts: null })
];

const state: any = useWarehouseStore.getInitialState();
const original = {
  transactions: state.transactions,
  handleDeleteTransaction: state.handleDeleteTransaction,
  handleDeleteMultipleTransactions: state.handleDeleteMultipleTransactions,
  handleUpdateTransaction: state.handleUpdateTransaction
};
const spies = {
  handleDeleteTransaction: vi.fn(async () => true),
  handleDeleteMultipleTransactions: vi.fn(async () => true),
  handleUpdateTransaction: vi.fn(async () => true)
};

/** Renders the tab with `transactions` and the id being deleted; returns the open delete dialog. */
const openDeleteDialog = (transactions: Transaction[], idToDelete: string, isLastItem = false) => {
  Object.assign(state, { transactions, ...spies });
  harness.transToDelete = idToDelete;
  harness.isLastItem = isLastItem;
  harness.falseStates = 0;
  harness.dialogs.length = 0;
  renderToStaticMarkup(createElement(ShipmentCostTab));
  const open = harness.dialogs.filter((d) => d.show === true);
  expect(open).toHaveLength(1);
  return open[0];
};

describe('«Отгрузка»: the trash reaches the store like «История» does (96.1)', () => {
  beforeEach(() => {
    Object.values(spies).forEach((s) => s.mockClear());
  });
  afterEach(() => {
    Object.assign(state, original);
    harness.transToDelete = null;
    harness.isLastItem = false;
  });

  it('the confirm deletes a plain product alone and a kit with its component rows in one call, the other rows stay, nothing is updated', async () => {
    const plain = openDeleteDialog([PLAIN, OTHER, ...KIT], 'a');
    expect(plain.title).toBe('Удаление товара из отгрузки');
    expect(String(plain.message)).not.toMatch(/перераспредел/);
    await plain.onConfirm();
    expect(spies.handleDeleteTransaction.mock.calls).toEqual([['a']]);
    expect(spies.handleDeleteMultipleTransactions).not.toHaveBeenCalled();

    spies.handleDeleteTransaction.mockClear();
    const kit = openDeleteDialog([PLAIN, OTHER, ...KIT], 'k');
    await kit.onConfirm();
    expect(spies.handleDeleteMultipleTransactions.mock.calls).toEqual([[['k', 'k1', 'k2']]]);
    expect(spies.handleDeleteTransaction).not.toHaveBeenCalled();
    expect(spies.handleUpdateTransaction).not.toHaveBeenCalled();
  });

  it('the last product of a shipment (a kit): the dialog warns about the whole shipment and the confirm deletes the kit with its components', async () => {
    const dialog = openDeleteDialog(KIT, 'k', true);
    expect(dialog.title).toBe('Удаление всей поставки');
    expect(String(dialog.message)).toContain('ПОЛНОМУ удалению всей поставки');
    await dialog.onConfirm();
    expect(spies.handleDeleteMultipleTransactions.mock.calls).toEqual([[['k', 'k1', 'k2']]]);
    expect(spies.handleDeleteTransaction).not.toHaveBeenCalled();
    expect(spies.handleUpdateTransaction).not.toHaveBeenCalled();
  });

  it('the tab reads no store action but the two deletes and writes nothing of its own', () => {
    const actions = new Set([...SOURCE.matchAll(/useWarehouseStore\(\s*\(?\s*state\s*\)?\s*=>\s*state\.(\w+)/g)].map((m) => m[1]));
    expect([...actions].sort()).toEqual(['handleDeleteMultipleTransactions', 'handleDeleteTransaction', 'transactions']);
    // every use of the store is a plain hook selector call (plus the import line, two mentions): no side door to another action
    expect(SOURCE.match(/useWarehouseStore/g)).toHaveLength(2 + SOURCE.match(/useWarehouseStore\(/g)!.length);
    expect(SOURCE).not.toMatch(/getState|setState|fetch\(|callServer|google\.script|XLSX/);
    // the confirm of the single delete goes through the one handler, nothing else
    expect(SOURCE).toMatch(/await handleDeleteFromShipment\(transToDelete\)/);
  });
});
