/**
 * Item 97 ticket 01, part A (96.1, owner 2026-10-22): the tab «Отгрузка» is no second money path.
 * The services gear re-committed every row with a price spread by value and the server added the
 * services from the new text on top (100 + 900 + service 100 → 1300 instead of 1100); the trash of a
 * product re-spread the extras over the remaining rows the same way (A 100 + B 900 + C 100 with
 * service 90, delete C → 1069.84 instead of 1090). The owner chose: the gear goes, the trash deletes
 * the way «История» does — the row and its kit components, the other rows untouched.
 */
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useWarehouseStore } from '../store/useWarehouseStore';
import { ShipmentCostTab, shipmentRowDeleteIds } from '../components/ShipmentCostTab';
import type { Transaction } from '../types';

const SOURCE = fs.readFileSync(path.resolve(__dirname, '../components/ShipmentCostTab.tsx'), 'utf8');

const row = (over: Partial<Transaction>): Transaction => ({
  id: 'x', date: '2026-10-19T07:00:00.000Z', type: 'Расход', article: 'A', quantity: 1, price: 100,
  writeOffCost: 100, total: 100, destination: 'Ozon (MaxiStore) [Услуги: Packing x1 (100₽)]',
  deliveryDate: '2026-10-19', opId: 'op-1', additionalCosts: 100, ...over
});

const SHIPMENT: Transaction[] = [
  row({ id: 'a', article: 'A', price: 150, total: 150 }),
  row({ id: 'b', article: 'B', price: 950, writeOffCost: 900, total: 950 }),
  row({ id: 'k', article: 'KIT', price: 300, writeOffCost: 0, total: 300, groupId: 'g1' }),
  row({ id: 'k1', article: 'COMP1', price: 100, writeOffCost: 100, total: 100, groupId: 'g1', isComponent: true, additionalCosts: null }),
  row({ id: 'k2', article: 'COMP2', price: 150, writeOffCost: 150, total: 150, groupId: 'g1', isComponent: true, additionalCosts: null })
];

// zustand's server snapshot is the frozen initial state (see ozonSettingsWindow.test.ts).
const setTransactionsForRender = (transactions: Transaction[]) => {
  Object.assign(useWarehouseStore.getInitialState(), { transactions });
};

describe('«Отгрузка»: no second money path (96.1)', () => {
  afterEach(() => setTransactionsForRender([]));

  it('a shipment card has no services gear, its products keep the trash', () => {
    setTransactionsForRender(SHIPMENT);
    const html = renderToStaticMarkup(createElement(ShipmentCostTab));
    expect(html).toContain('Ozon (MaxiStore)');
    expect(html).not.toContain('Редактировать доп. услуги поставки');
    expect(html).toContain('title="Удалить"');
  });

  it('the tab never re-commits rows and has no extras arithmetic of its own', () => {
    for (const gone of ['handleUpdateTransaction', 'recalculateGroupWithNewServices',
      'resolveRedistributedTransactions', 'parseExtraCostsFromDestination']) {
      expect(SOURCE, gone).not.toContain(gone);
    }
  });

  it('deleting a plain product deletes that row alone', () => {
    expect(shipmentRowDeleteIds('a', SHIPMENT)).toEqual(['a']);
  });

  it('deleting a kit deletes its component rows with it, and nothing of other kits', () => {
    const other = row({ id: 'o1', article: 'COMP1', groupId: 'g2', isComponent: true });
    expect(shipmentRowDeleteIds('k', [...SHIPMENT, other])).toEqual(['k', 'k1', 'k2']);
  });

  it('the confirmation no longer promises a re-spread', () => {
    expect(SOURCE).not.toContain('будут автоматически перераспределены');
  });
});
