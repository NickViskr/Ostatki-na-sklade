// Item 90, ticket 03: what the «Вся отгрузка» window shows, derived by the pure `wholeShipmentView`.
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  wholeShipmentView, wholeShipmentOrders, orderSharesPreview, OLD_COMBINED_SHIPMENT_REASON, type WholeShipmentRow
} from './wholeShipment';

const NOTE = '[Общая поставка: заявки № 111, № 222; доля этой заявки 10 из 30 шт., 0.00 руб. из 0.00 руб.]';
const row = (o: Partial<WholeShipmentRow> & { id: string }): WholeShipmentRow => ({
  date: '2026-09-01 10:00:00', type: 'Расход', article: 'A', quantity: 10, destination: `Ozon ${NOTE}`,
  shipmentId: 'S1', opId: 'S1-1', additionalCosts: 0, ...o
});

describe('wholeShipmentView', () => {
  const rows = [
    row({ id: '1', article: 'A', quantity: 10, opId: 'S1-1', additionalCosts: 100 }),
    row({ id: '2', article: 'B', quantity: 20, opId: 'S1-2', additionalCosts: 200 })
  ];

  it('lists orders with note labels, pieces and old → new shares that sum to the new total', () => {
    const v = wholeShipmentView(rows, rows[0], 301);
    if (v.kind !== 'ok') throw new Error('expected ok');
    expect(v.orders.map((o) => [o.label, o.pieces, o.oldShare])).toEqual([['111', 10, 100], ['222', 20, 200]]);
    expect(v.orders.map((o) => o.newShare)).toEqual([100.33, 200.67]);
    expect(v.totalPieces).toBe(30);
    expect([v.oldTotal, v.newTotal]).toEqual([300, 301]);
  });

  it('a shipment number without a note falls back to «Заявка N»; a deleted order drops out', () => {
    const plain = rows.map((r) => ({ ...r, destination: 'Ozon' }));
    const v = wholeShipmentView([plain[1]], plain[1], 50);
    if (v.kind !== 'ok') throw new Error('expected ok');
    expect(v.orders.map((o) => o.label)).toEqual(['Заявка 1']);
    expect(v.orders[0].newShare).toBe(50);
  });

  it('refuses an old combined shipment without a shipment number, with the clear reason', () => {
    const old = row({ id: '9', shipmentId: undefined, opId: undefined });
    expect(wholeShipmentView([old], old, 10)).toEqual({ kind: 'refused', reason: OLD_COMBINED_SHIPMENT_REASON });
  });

  it('refuses a row without OpID inside a numbered shipment and names the article', () => {
    const broken = [rows[0], row({ id: '3', article: 'ZZ', opId: undefined })];
    const v = wholeShipmentView(broken, broken[0], 10);
    expect(v.kind).toBe('refused');
    expect(v.kind === 'refused' && v.reason).toContain('«ZZ»');
  });

  it('a single operation without a note: one order labelled by its object, kit components not listed', () => {
    const single = [
      row({ id: 's1', destination: 'Склад Х', shipmentId: undefined, opId: undefined, quantity: 5 }),
      row({ id: 's2', destination: 'Склад Х', shipmentId: undefined, opId: undefined, quantity: 5, isComponent: true, article: 'C' })
    ];
    const v = wholeShipmentView(single, single[0], 12.5);
    if (v.kind !== 'ok') throw new Error('expected ok');
    expect(v.orders).toHaveLength(1);
    expect(v.orders[0]).toMatchObject({ label: 'Склад Х', pieces: 5, newShare: 12.5, articles: [{ article: 'A', quantity: 5 }] });
  });
});

describe('screen wiring of «Вся отгрузка»', () => {
  const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

  it('«История» puts the button next to the pencil of Расход rows only, with title and aria-label', () => {
    const src = read('src/components/HistoryTab.tsx');
    expect(src).toMatch(/t\.type === 'Расход' && \(\s*<button[\s\S]{0,400}title="Вся отгрузка"\s*aria-label="Вся отгрузка"/);
  });

  it('the store sends the comment and the window mounts in App', () => {
    expect(read('src/store/useWarehouseStore.ts')).toContain('comment?: string');
    expect(read('src/App.tsx')).toContain('<WholeShipmentModal');
    expect(read('src/components/WholeShipmentModal.tsx'))
      .toContain('Количество товара, себестоимость списания и остатки склада не меняются.');
  });
});

describe('orderSharesPreview (mutation-testing additions)', () => {
  it('reads the old share of an order off its main row, not off a kit component row listed first', () => {
    const rows = [
      row({ id: 'c', article: 'C', quantity: 6, opId: 'S1-1', isComponent: true, additionalCosts: null as unknown as number }),
      row({ id: 'k', article: 'K', quantity: 3, opId: 'S1-1', additionalCosts: 90 })
    ];
    const shares = orderSharesPreview(wholeShipmentOrders(rows), 30);
    expect(shares).toEqual([{ opId: 'S1-1', pieces: 3, oldShare: 90, newShare: 30 }]);
  });

  it('a single operation (no shipment number) carries the total whole, rounded to kopecks', () => {
    const single = [row({ id: 's', shipmentId: undefined, opId: undefined, destination: 'Ozon' })];
    const shares = orderSharesPreview(wholeShipmentOrders(single), 0.1 + 0.2);
    expect(shares[0].newShare).toBe(0.3);
  });
});
