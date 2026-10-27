import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  buildKanCostCsv,
  collapseKanCostRows,
  KAN_COST_CSV_HEADER,
  kanCostFileName,
} from './kanCostExport';
import {
  canSeeKanMarker,
  historyKanMarker,
  indexKanMarkers,
  isOzonShipmentRow,
  kanManualCsv,
  kanManualToast,
  kanMarkerView,
  kanSendToast,
} from './kanCostSend';
import type { KanExportRow, KanMarkerInfo, KanSendGroup } from './kanCostSend';
import { batchOrderOptions } from './operationComment';
import { formatCurrency } from './utils';
import { useWarehouseStore } from '../store/useWarehouseStore';
import { HistoryTab } from '../components/HistoryTab';

/**
 * Item 93 ticket 05, step A: the pure helpers behind the automatic KAN send in the browser —
 * the toast after the send, the toast and the file after «Отправлю сам», and the per-shipment
 * marker in the history (visible to the shipment's author and to the admin only).
 */

const group = (over: Partial<KanSendGroup> = {}): KanSendGroup => ({
  cabinet: 'MaxiStore',
  article: 'ART-C',
  date: '2026-10-13',
  action: 'upsert',
  cost: 233.67,
  opIds: ['op-1'],
  ...over,
});

const exportRow = (over: Partial<KanExportRow> = {}): KanExportRow => ({
  row: 3,
  date: '2026-10-13',
  cabinet: 'MaxiStore',
  article: 'ART-C',
  sku: '2889355693',
  cost: 233.67,
  opId: 'op-1',
  source: 'отгрузка',
  ...over,
});

const marker = (over: Partial<KanMarkerInfo> = {}): KanMarkerInfo => ({
  opId: 'op-1',
  article: 'ART-C',
  status: 'принято',
  answer: 'КАН принял 233,67',
  time: '2026-10-14 13:00:00',
  ...over,
});

describe('KAN toast after the automatic send', () => {
  it('says nothing when there is no answer or nothing was accepted or refused', () => {
    expect(kanSendToast(null)).toEqual({ kind: 'none' });
    expect(kanSendToast(undefined)).toEqual({ kind: 'none' });
    expect(kanSendToast({})).toEqual({ kind: 'none' });
    expect(kanSendToast({ accepted: [], failed: [] })).toEqual({ kind: 'none' });
    // Rows the owner switched to «Отправлю сам» are skipped silently.
    expect(kanSendToast({ accepted: [], failed: [], skippedManual: 2 })).toEqual({ kind: 'none' });
  });

  it('a busy answer is an info toast with the server message, or the default one, and wins over groups', () => {
    expect(kanSendToast({ busy: true, message: 'таблица занята, отправка позже' }))
      .toEqual({ kind: 'info', title: 'КАН: таблица занята, отправка позже' });
    expect(kanSendToast({ busy: true })).toEqual({ kind: 'info', title: 'КАН: уже отправляется' });
    expect(kanSendToast({ busy: true, message: '', accepted: [group()] }))
      .toEqual({ kind: 'info', title: 'КАН: уже отправляется' });
  });

  it('accepted groups only: one success toast with one line per group, in the answer order', () => {
    const toast = kanSendToast({
      accepted: [
        group(),
        group({ cabinet: 'Mercurius', article: 'ART-M', date: '2026-10-02', cost: 1234.5, opIds: ['op-2'] }),
        group({ article: 'ART-D', date: '2026-10-12', action: 'delete', cost: null, opIds: ['op-3'] }),
        // A date that is not YYYY-MM-DD is printed as it came.
        group({ article: 'ART-X', date: '13.10.2026', cost: 70, opIds: ['op-4'] }),
      ],
    });
    expect(toast).toEqual({
      kind: 'success',
      title: 'КАН принял себестоимость:',
      lines: [
        'ART-C (MaxiStore) — 233,67 ₽ с 13.10',
        `ART-M (Mercurius) — ${formatCurrency(1234.5)} ₽ с 02.10`,
        'ART-D (MaxiStore) — запись за 12.10 удалена',
        `ART-X (MaxiStore) — ${formatCurrency(70)} ₽ с 13.10.2026`,
      ],
    });
  });

  it('one refused group: the title carries the reason, the failed line comes first, then the accepted one', () => {
    const toast = kanSendToast({
      accepted: [group({ article: 'ART-A', cost: 100 })],
      failed: [group({ article: 'ART-B', date: '2026-10-12', reason: 'КАН недоступен' })],
    });
    expect(toast).toEqual({
      kind: 'error',
      title: 'КАН не принял: КАН недоступен',
      lines: [
        'ART-B (MaxiStore), 12.10: КАН недоступен',
        'Принято: ART-A (MaxiStore) — 100,00 ₽ с 13.10',
      ],
    });
    // Nothing accepted: no «Принято» line. A missing or blank reason is spelled out.
    expect(kanSendToast({ failed: [group({ article: 'ART-B', date: '2026-10-12' })] })).toEqual({
      kind: 'error',
      title: 'КАН не принял: причина не указана',
      lines: ['ART-B (MaxiStore), 12.10: причина не указана'],
    });
    expect(kanSendToast({ accepted: [], failed: [group({ reason: '   ' })] })).toEqual({
      kind: 'error',
      title: 'КАН не принял: причина не указана',
      lines: ['ART-C (MaxiStore), 13.10: причина не указана'],
    });
  });

  it('several refused groups make ONE toast with the count in the title and every failed line before the accepted one', () => {
    const toast = kanSendToast({
      accepted: [group({ article: 'ART-A', cost: 100 })],
      failed: [
        group({ article: 'ART-B', date: '2026-10-12', reason: 'КАН недоступен' }),
        group({ cabinet: 'Mercurius', article: 'ART-Z', date: '2026-10-11', action: 'delete', cost: null, reason: 'запись в КАН не удалена' }),
        group({ article: 'ART-Q', reason: 'товара нет в КАН' }),
      ],
    });
    expect(toast).toEqual({
      kind: 'error',
      title: 'КАН не принял себестоимость: 3',
      lines: [
        'ART-B (MaxiStore), 12.10: КАН недоступен',
        'ART-Z (Mercurius), 11.10: запись в КАН не удалена',
        'ART-Q (MaxiStore), 13.10: товара нет в КАН',
        'Принято: ART-A (MaxiStore) — 100,00 ₽ с 13.10',
      ],
    });
  });
});

describe('KAN toast and file after «Отправлю сам»', () => {
  it('no answer is nothing; busy is info; no rows says the file is not needed', () => {
    expect(kanManualToast(null)).toEqual({ kind: 'none' });
    expect(kanManualToast(undefined)).toEqual({ kind: 'none' });
    expect(kanManualToast({ busy: true, message: 'таблица занята, отправка позже' }))
      .toEqual({ kind: 'info', title: 'КАН: таблица занята, отправка позже' });
    expect(kanManualToast({ busy: true })).toEqual({ kind: 'info', title: 'КАН: уже отправляется' });
    expect(kanManualToast({ busy: true, rows: [exportRow()] })).toEqual({ kind: 'info', title: 'КАН: уже отправляется' });
    const noFile = { kind: 'info', title: 'Неотправленной себестоимости нет — файл не нужен' };
    expect(kanManualToast({ rows: [] })).toEqual(noFile);
    expect(kanManualToast({})).toEqual(noFile);
    expect(kanManualToast({ switched: 0, notWritten: 0 })).toEqual(noFile);
  });

  it('the success toast counts the rows of the file, i.e. AFTER the same-day rows are collapsed', () => {
    const lines = ['Загрузите его в КАН. Приложение проверит КАН в течение часа.'];
    expect(kanManualToast({
      rows: [
        exportRow({ row: 3, cost: 245.61 }),
        exportRow({ row: 4, cost: 233.67 }),
        exportRow({ row: 5, article: 'ART-D', cost: 70 }),
      ],
    })).toEqual({ kind: 'success', title: 'Файл для КАН скачан: строк 2', lines });
    expect(kanManualToast({ rows: [exportRow()] })).toEqual({ kind: 'success', title: 'Файл для КАН скачан: строк 1', lines });
  });
});

describe('the file for «Отправлю сам»', () => {
  // The oracle is the old «Себестоимость КАН» button: the mapping is inline in exportKanCost.
  const oldButtonCsv = (rows: KanExportRow[]) => buildKanCostCsv(collapseKanCostRows(rows.map((r) => ({
    date: String(r.date || ''),
    sku: String(r.sku || ''),
    article: String(r.article || ''),
    cost: Number(r.cost) || 0,
    cabinet: String(r.cabinet || ''),
  }))));
  const cellsOf = (csv: string): string[][] =>
    csv.replace(/^﻿/, '').split('\r\n').slice(1).map((line) => line.split(';'));

  it('is byte for byte the file the old button builds for the same rows', () => {
    const rows = [
      exportRow({ row: 2, date: '2026-10-11', article: 'BowlGrayMini_01', sku: '2889355808', cost: 245.61 }),
      exportRow({ row: 3, date: '2026-10-11', article: 'BowlGrayMini_01', sku: '2889355808', cost: 233.67 }),
      exportRow({ row: 4, date: '2026-10-13', article: 'Полка "Люкс"', sku: '2889355700', cost: 1075.75 }),
      exportRow({ row: 5, date: '13.10.2026', cabinet: 'Mercurius', article: 'ART-M', sku: '2889355701', cost: 85 }),
      exportRow({ row: 6, date: '2026-10-13', article: 'ART-N', sku: '', cost: '70.5' }),
    ];
    const csv = kanManualCsv(rows);
    expect(csv).toBe(oldButtonCsv(rows));
    // The oracle itself is anchored to a literal line of the live KAN format.
    expect(csv.split('\r\n')[1]).toBe('"2026-10-11";2889355808;"BowlGrayMini_01";233.6700;0.0000;"MaxiStore";"MAIN"');
    // The BOM, and an empty list gives the header only.
    expect(csv.startsWith('﻿')).toBe(true);
    expect(kanManualCsv([])).toBe('﻿' + KAN_COST_CSV_HEADER);
    expect(kanManualCsv([])).toBe(oldButtonCsv([]));
  });

  it('two rows of one day, cabinet and article leave only the last; one article in two cabinets stays two lines', () => {
    const csv = kanManualCsv([
      exportRow({ row: 2, cost: 245.61 }),
      exportRow({ row: 3, cost: 234.61 }),
      exportRow({ row: 4, cost: 233.67 }),
      exportRow({ row: 5, cabinet: 'Mercurius', cost: 90 }),
    ]);
    const cells = cellsOf(csv);
    expect(cells).toHaveLength(2);
    expect(cells[0][3]).toBe('233.6700');
    expect(cells[0][5]).toBe('"MaxiStore"');
    expect(cells[1][3]).toBe('90.0000');
    expect(cells[1][5]).toBe('"Mercurius"');
    expect(csv).not.toContain('245.6100');
    expect(csv).not.toContain('234.6100');
    expect(csv).toBe(oldButtonCsv([
      exportRow({ cost: 233.67 }),
      exportRow({ cabinet: 'Mercurius', cost: 90 }),
    ]));
  });

  it('an empty SKU keeps its line with an empty cell; a cost given as text is read as a number; junk is 0', () => {
    const cells = cellsOf(kanManualCsv([
      exportRow({ article: 'A-1', sku: '', cost: '233.67' }),
      exportRow({ article: 'A-2', cost: 'abc' }),
      exportRow({ article: 'A-3', cost: '' }),
    ]));
    expect(cells).toHaveLength(3);
    expect(cells[0][1]).toBe('');
    expect(cells[0][3]).toBe('233.6700');
    expect(cells[1][3]).toBe('0.0000');
    expect(cells[2][3]).toBe('0.0000');
  });
});

describe('a shipment row of the history', () => {
  it('is an expense to an Ozon cabinet that is not a kit component', () => {
    expect(isOzonShipmentRow({ type: 'Расход', destination: 'Ozon (MaxiStore)' })).toBe(true);
    expect(isOzonShipmentRow({ type: 'Расход', destination: 'Ozon (Mercurius) [Упаковка: 500₽]', isComponent: false })).toBe(true);
    expect(isOzonShipmentRow({ type: 'Расход', destination: 'Ozon(MaxiStore)' })).toBe(true);
  });

  it('is not a kit component, a receipt, another shop, a nameless cabinet or an empty row', () => {
    expect(isOzonShipmentRow({ type: 'Расход', destination: 'Ozon (MaxiStore)', isComponent: true })).toBe(false);
    expect(isOzonShipmentRow({ type: 'Приход', destination: 'Ozon (MaxiStore)' })).toBe(false);
    expect(isOzonShipmentRow({ type: 'Расход', destination: 'Wildberries FBS' })).toBe(false);
    expect(isOzonShipmentRow({ type: 'Расход', destination: 'Яндекс' })).toBe(false);
    expect(isOzonShipmentRow({ type: 'Расход', destination: 'Ozon ( )' })).toBe(false);
    expect(isOzonShipmentRow({ type: 'Расход', destination: 'Ozon ()' })).toBe(false);
    expect(isOzonShipmentRow({ type: 'Расход' })).toBe(false);
    expect(isOzonShipmentRow({})).toBe(false);
  });
});

describe('KAN markers', () => {
  it('are indexed by order id and article; a later entry of one key wins; nothing gives {}', () => {
    const first = marker({ opId: 'op-1', article: 'A', status: 'ошибка', answer: 'КАН недоступен' });
    const second = marker({ opId: 'op-1', article: 'A', status: 'принято' });
    const other = marker({ opId: 'op-1', article: 'Полка_27см', status: 'вручную' });
    const index = indexKanMarkers([first, other, second]);
    expect(Object.keys(index).sort()).toEqual(['op-1|A', 'op-1|Полка_27см']);
    expect(index['op-1|A']).toEqual(second);
    expect(index['op-1|Полка_27см']).toEqual(other);
    expect(indexKanMarkers(null)).toEqual({});
    expect(indexKanMarkers(undefined)).toEqual({});
    expect(indexKanMarkers([])).toEqual({});
  });

  it('accepted shows the answer (or a default); an error shows the reason and the two buttons', () => {
    expect(kanMarkerView(marker({ status: 'принято', answer: '  КАН принял 233,67 ' })))
      .toEqual({ glyph: '✓', tone: 'ok', text: 'КАН принял 233,67', buttons: false });
    expect(kanMarkerView(marker({ status: ' Принято ', answer: '' })))
      .toEqual({ glyph: '✓', tone: 'ok', text: 'КАН принял', buttons: false });
    expect(kanMarkerView(marker({ status: 'принято', answer: '   ' })))
      .toEqual({ glyph: '✓', tone: 'ok', text: 'КАН принял', buttons: false });
    expect(kanMarkerView(marker({ status: 'ошибка', answer: ' КАН недоступен ' })))
      .toEqual({ glyph: '✗', tone: 'error', text: 'КАН не принял: КАН недоступен', buttons: true });
    expect(kanMarkerView(marker({ status: 'ОШИБКА', answer: '' })))
      .toEqual({ glyph: '✗', tone: 'error', text: 'КАН не принял', buttons: true });
  });

  it('manual and sending wait; an empty or unknown status and a missing marker show nothing', () => {
    expect(kanMarkerView(marker({ status: 'вручную', answer: 'ждём файл в КАН' })))
      .toEqual({ glyph: '⏳', tone: 'wait', text: 'Загрузка вручную: ждём файл в КАН', buttons: false });
    expect(kanMarkerView(marker({ status: 'вручную', answer: '' })))
      .toEqual({ glyph: '⏳', tone: 'wait', text: 'Загрузка вручную: ждём файл в КАН', buttons: false });
    expect(kanMarkerView(marker({ status: 'вручную', answer: ' в КАН не найдено ' })))
      .toEqual({ glyph: '⏳', tone: 'wait', text: 'Загрузка вручную: в КАН не найдено', buttons: false });
    // The answer of a sending row is irrelevant: the text is fixed.
    expect(kanMarkerView(marker({ status: 'отправляется', answer: 'что угодно' })))
      .toEqual({ glyph: '⏳', tone: 'wait', text: 'Отправляется в КАН', buttons: false });
    expect(kanMarkerView(marker({ status: '' }))).toBeNull();
    expect(kanMarkerView(marker({ status: '   ' }))).toBeNull();
    expect(kanMarkerView(marker({ status: 'проверить' }))).toBeNull();
    expect(kanMarkerView(null)).toBeNull();
    expect(kanMarkerView(undefined)).toBeNull();
  });

  it('the admin (by role or by name) and nobody else sees every row; no user sees nothing', () => {
    const someoneElse = { user: 'Кладовщик' };
    expect(canSeeKanMarker(null, someoneElse)).toBe(false);
    expect(canSeeKanMarker(undefined, someoneElse)).toBe(false);
    expect(canSeeKanMarker(null, { user: 'boss' })).toBe(false);
    expect(canSeeKanMarker({ username: 'boss', role: 'admin' }, someoneElse)).toBe(true);
    expect(canSeeKanMarker({ username: 'boss', role: 'admin' }, {})).toBe(true);
    expect(canSeeKanMarker({ username: 'boss', role: 'Admin' }, someoneElse)).toBe(true);
    expect(canSeeKanMarker({ username: 'boss', role: 'АДМИНИСТРАТОР' }, someoneElse)).toBe(true);
    expect(canSeeKanMarker({ username: 'Админ', role: 'user' }, someoneElse)).toBe(true);
    expect(canSeeKanMarker({ username: 'ADMIN', role: 'user' }, someoneElse)).toBe(true);
    expect(canSeeKanMarker({ username: 'Администратор' }, someoneElse)).toBe(true);
    // A name that only resembles the admin's is not enough.
    expect(canSeeKanMarker({ username: 'adminov', role: 'user' }, someoneElse)).toBe(false);
  });

  it('a non-admin sees only the rows they made themselves, compared without case and spaces; an empty author is nobody', () => {
    const worker = { username: 'Кладовщик', role: 'user' };
    expect(canSeeKanMarker(worker, { user: 'Кладовщик' })).toBe(true);
    expect(canSeeKanMarker(worker, { user: ' кладовщик ' })).toBe(true);
    expect(canSeeKanMarker({ username: ' КЛАДОВЩИК ', role: 'user' }, { user: 'Кладовщик' })).toBe(true);
    expect(canSeeKanMarker(worker, { user: 'Другой' })).toBe(false);
    expect(canSeeKanMarker(worker, { user: '' })).toBe(false);
    expect(canSeeKanMarker(worker, { user: '   ' })).toBe(false);
    expect(canSeeKanMarker(worker, {})).toBe(false);
    // Two blanks are not a match.
    expect(canSeeKanMarker({ username: '', role: 'user' }, { user: '' })).toBe(false);
    expect(canSeeKanMarker({ role: 'user' }, { user: '' })).toBe(false);
  });
});

describe('the marker of a history row', () => {
  const worker = { username: 'Кладовщик', role: 'user' };
  const boss = { username: 'boss', role: 'admin' };

  it('is shown to the author and to the admin as the view of the marker found by order id and article', () => {
    const markers = indexKanMarkers([
      marker({ opId: 'op-1', article: 'ART-C', status: 'принято', answer: 'КАН принял 233,67' }),
      marker({ opId: 'op-2', article: 'ART-C', status: 'ошибка', answer: 'КАН недоступен' }),
    ]);
    expect(historyKanMarker({ opId: 'op-1', article: 'ART-C', user: 'Кладовщик' }, markers, worker))
      .toEqual({ glyph: '✓', tone: 'ok', text: 'КАН принял 233,67', buttons: false });
    expect(historyKanMarker({ opId: 'op-2', article: 'ART-C', user: 'Кладовщик' }, markers, boss))
      .toEqual({ glyph: '✗', tone: 'error', text: 'КАН не принял: КАН недоступен', buttons: true });
    expect(historyKanMarker({ opId: 'op-2', article: 'ART-C', user: 'Кладовщик' }, markers, worker))
      .toEqual({ glyph: '✗', tone: 'error', text: 'КАН не принял: КАН недоступен', buttons: true });
  });

  it('is empty without an order id, for a stranger, with no marker, for a kit component, or when the status shows nothing', () => {
    const markers = indexKanMarkers([
      marker({ opId: 'op-1', article: 'ART-C', status: 'принято' }),
      marker({ opId: '', article: 'ART-C', status: 'принято' }),
      marker({ opId: 'op-kit', article: 'KIT-1', status: 'принято' }),
      marker({ opId: 'op-3', article: 'ART-C', status: 'проверить' }),
    ]);
    // No order id: nothing to look up, even when a marker with an empty id exists.
    expect(historyKanMarker({ article: 'ART-C', user: 'Кладовщик' }, markers, worker)).toBeNull();
    expect(historyKanMarker({ opId: '', article: 'ART-C', user: 'Кладовщик' }, markers, worker)).toBeNull();
    // Another author, and nobody signed in.
    expect(historyKanMarker({ opId: 'op-1', article: 'ART-C', user: 'Другой' }, markers, worker)).toBeNull();
    expect(historyKanMarker({ opId: 'op-1', article: 'ART-C', user: 'Кладовщик' }, markers, null)).toBeNull();
    // The shipment has no marker at all.
    expect(historyKanMarker({ opId: 'op-9', article: 'ART-C', user: 'Кладовщик' }, markers, worker)).toBeNull();
    // A kit component row carries the kit's order id but its own article.
    expect(historyKanMarker({ opId: 'op-kit', article: 'KIT-1', user: 'Кладовщик' }, markers, worker))
      .toEqual({ glyph: '✓', tone: 'ok', text: 'КАН принял 233,67', buttons: false });
    expect(historyKanMarker({ opId: 'op-kit', article: 'COMPONENT-1', user: 'Кладовщик' }, markers, worker)).toBeNull();
    // A marker whose status shows nothing.
    expect(historyKanMarker({ opId: 'op-3', article: 'ART-C', user: 'Кладовщик' }, markers, worker)).toBeNull();
  });
});

/**
 * Item 93 ticket 05, step B: the helpers above wired into the store. Written TEST-FIRST, by the tester,
 * against the agreed interface — `kanCostMarkers`, `fetchKanCostMarkers`, `sendKanCost`, `sendKanCostManually`
 * and the KAN step inside the save paths do not exist yet, so these checks are red until the coder builds them.
 *
 * How the store is driven (vitest runs in `node`, no DOM): the real store with `fetchGas` replaced by a fake
 * that answers per action and logs every request; `sonner` replaced by a recorder; a minimal `document` and
 * `URL.createObjectURL` capture the downloaded file (its Blob is read back as UTF-8 bytes — `Blob.text()` would
 * strip the BOM). Every test drains what it left running, because the coalescing state of the send is
 * module-level.
 */
const sonner = vi.hoisted(() => ({ calls: [] as { kind: string; args: any[] }[] }));
vi.mock('sonner', () => ({
  toast: new Proxy({}, {
    get: (_target, kind) => (...args: any[]) => { sonner.calls.push({ kind: String(kind), args }); },
  }),
}));

describe('KAN send wired into the store (step B)', () => {
  const OZON = 'Ozon (MaxiStore)';
  const WILDBERRIES = 'Wildberries FBS';
  const ITEMS = [{ article: 'ART-C', quantity: 2, price: 0 }];
  const STOCK_ITEM = { article: 'ART-C', quantity: 100, avgCost: 50, capitalization: 5000, sales120: 0, turnover: 0 };
  const NOT_SENT = 'Режим разработки: себестоимость в КАН не отправляется';
  const NOT_MANUAL = 'Режим разработки: ручная загрузка в КАН недоступна';

  /** The members of the store this step adds are reached through `any` until the coder builds them. */
  const store = () => useWarehouseStore.getState() as any;
  const tx = (over: Record<string, unknown> = {}): any => ({
    id: 't-ozon', date: '2026-10-27', type: 'Расход', article: 'ART-C', quantity: 2, price: 0, writeOffCost: 50,
    total: 100, destination: OZON, opId: 'op-1', user: 'Кладовщик', ...over,
  });

  // ---- the fake GAS, the toast recorder, the download capture ----
  const events: string[] = [];
  const requestLog: { action: string; payload: any }[] = [];
  const handlers: Record<string, (payload: any) => unknown> = {};
  const held: { resolve: (value: unknown) => void }[] = [];
  const files: { href: string; download: string; blob: Blob | undefined }[] = [];
  const blobs = new Map<string, Blob>();

  const ok = (data: unknown = {}) => ({ status: 'success', data });
  const fail = (message: string) => ({ status: 'error', message });
  const onGas = (action: string, handler: (payload: any) => unknown) => { handlers[action] = handler; };
  const requests = (action: string) => requestLog.filter((r) => r.action === action);
  const toastArgs = (kind: string): any[][] => sonner.calls.filter((c) => c.kind === kind).map((c) => c.args);
  const allToastStrings = (): string[] =>
    sonner.calls.flatMap((c) => c.args).filter((a) => typeof a === 'string') as string[];

  const defaultAnswer = (action: string) => {
    if (action === 'getOzonCostKanMarkers') return ok({ markers: [] });
    if (action === 'getExternalShipments') return ok([]);
    return ok({});
  };
  const fakeFetchGas = async (action: string, payload?: any) => {
    events.push(`gas:${action}`);
    requestLog.push({ action, payload });
    const handler = handlers[action];
    return handler ? handler(payload) : defaultAnswer(action);
  };

  /** A request that stays pending until the test releases it (or the afterEach drain does). */
  const hold = () => {
    let resolve!: (value: unknown) => void;
    const promise = new Promise<unknown>((r) => { resolve = r; });
    const deferred = { promise, resolve };
    held.push(deferred);
    return deferred;
  };
  const flush = async () => { for (let i = 0; i < 5; i++) await new Promise<void>((r) => setTimeout(r, 0)); };
  const hungAfter = (ms: number) => new Promise<string>((r) => { setTimeout(() => r('hung'), ms); });
  const fileText = async (blob: Blob | undefined) => Buffer.from(await blob!.arrayBuffer()).toString('utf8');

  const seed = (over: Record<string, unknown> = {}) => {
    useWarehouseStore.setState({
      ...useWarehouseStore.getInitialState(),
      fetchGas: fakeFetchGas as any,
      stock: [STOCK_ITEM],
      ...over,
    } as any, true);
  };
  const markerAnswer = () => ok({ markers: [marker({ opId: 'op-1', article: 'ART-C', status: 'принято' })] });
  const exportRows = () => [
    exportRow({ row: 2, cost: 245.61 }),
    exportRow({ row: 3, cost: 233.67 }),
    exportRow({ row: 4, article: 'ART-D', sku: '2889355700', cost: 70 }),
  ];

  // The store is persisted, and node has no localStorage: zustand warns on every single set.
  const realWarn = console.warn.bind(console);

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      if (!String(args[0]).includes('zustand persist middleware')) realWarn(...args);
    });
    sonner.calls.length = 0;
    events.length = 0;
    requestLog.length = 0;
    files.length = 0;
    blobs.clear();
    held.length = 0;
    Object.keys(handlers).forEach((k) => delete handlers[k]);
    let n = 0;
    vi.spyOn(URL, 'createObjectURL').mockImplementation(((blob: Blob) => {
      const url = `blob:test-${++n}`;
      blobs.set(url, blob);
      return url;
    }) as any);
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.stubGlobal('document', {
      createElement: () => {
        const link: any = {
          href: '', download: '', style: {},
          click: () => { events.push('download'); files.push({ href: link.href, download: link.download, blob: blobs.get(link.href) }); },
        };
        return link;
      },
      body: { appendChild: () => undefined, removeChild: () => undefined },
    });
    seed();
  });

  afterEach(async () => {
    held.forEach((d) => d.resolve(ok({})));
    await flush();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** Runs sendKanCost and reports whether the global «processing» flag was ever raised meanwhile. */
  const sendWatched = async () => {
    let raised = false;
    const unsubscribe = useWarehouseStore.subscribe((s) => { if (s.isProcessing) raised = true; });
    try { await store().sendKanCost(); } finally { unsubscribe(); }
    return raised;
  };

  describe('the save never waits for KAN', () => {
    it('an Ozon expense resolves true while the KAN request is still pending; isProcessing is off and the request came after the commit', async () => {
      const kan = hold();
      onGas('commit', () => ok({ stock: [STOCK_ITEM], newTransactions: [tx()] }));
      onGas('sendOzonCostToKan', () => kan.promise);

      const outcome = await Promise.race([store().commitTransaction(ITEMS, 'Расход', OZON, '', 'op-1'), hungAfter(100)]);

      expect(outcome).toBe(true);
      await flush();
      expect(requests('sendOzonCostToKan')).toHaveLength(1);
      expect(events.indexOf('gas:commit')).toBeGreaterThan(-1);
      expect(events.indexOf('gas:commit')).toBeLessThan(events.indexOf('gas:sendOzonCostToKan'));
      expect(store().isProcessing).toBe(false);
      expect(store().transactions.map((t: any) => t.id)).toEqual(['t-ozon']);
    });

    it.each([
      ['an error answer (HTTP 504)', () => fail('Ошибка HTTP 504')],
      ['a request that rejects', () => { throw new Error('boom'); }],
    ])('%s from KAN leaves the commit true with the saved rows in the store, and the next send is not blocked', async (_name, answer) => {
      onGas('commit', () => ok({ stock: [STOCK_ITEM], newTransactions: [tx()] }));
      onGas('sendOzonCostToKan', answer);

      expect(await store().commitTransaction(ITEMS, 'Расход', OZON, '', 'op-1')).toBe(true);
      await flush();

      expect(store().transactions.map((t: any) => t.id)).toEqual(['t-ozon']);
      expect(requests('sendOzonCostToKan')).toHaveLength(1);
      // The failed run does not leave the sender stuck, and sendKanCost itself never throws.
      await expect(store().sendKanCost()).resolves.toBeUndefined();
      expect(requests('sendOzonCostToKan')).toHaveLength(2);
    });

    it.each([
      ['a receipt', 'Приход', '', undefined, ok({ stock: [STOCK_ITEM], newTransactions: [tx({ type: 'Приход', destination: '' })] })],
      ['an expense to another shop', 'Расход', WILDBERRIES, undefined, ok({ stock: [STOCK_ITEM], newTransactions: [tx({ destination: WILDBERRIES })] })],
      ['a silent member of a batch write-off', 'Расход', OZON, batchOrderOptions({ postingIds: [], extrasShare: 0 }, '', 'SH-1'), ok({ stock: [STOCK_ITEM], newTransactions: [tx()] })],
      ['an Ozon expense the server refused', 'Расход', OZON, undefined, fail('Ошибка сервера')],
    ])('%s starts no KAN request', async (_name, type, destination, options, answer) => {
      onGas('commit', () => answer);

      await store().commitTransaction(ITEMS, type, destination, '', 'op-1', options);
      await flush();

      expect(requests('commit')).toHaveLength(1);
      expect(requests('sendOzonCostToKan')).toHaveLength(0);
    });
  });

  describe('the automatic send: sendKanCost', () => {
    const refused = {
      failed: [group({ reason: 'КАН недоступен' })],
      accepted: [group({ article: 'ART-A', cost: 100 })],
    };

    it('a refused answer makes ONE red toast that stays on screen, with the lines and the two buttons', async () => {
      onGas('sendOzonCostToKan', () => ok(refused));
      const raised = await sendWatched();

      expect(raised).toBe(false);
      const errors = toastArgs('error');
      expect(errors).toHaveLength(1);
      const [title, options] = errors[0];
      const expected: any = kanSendToast(refused);
      expect(title).toBe('КАН не принял: КАН недоступен');
      expect(title).toBe(expected.title);
      expect(options.description).toBe(expected.lines.join('\n'));
      expect(options.description).toBe('ART-C (MaxiStore), 13.10: КАН недоступен\nПринято: ART-A (MaxiStore) — 100,00 ₽ с 13.10');
      expect(options.duration).toBe(Infinity);
      expect(options.action.label).toBe('Отправить снова');
      expect(options.cancel.label).toBe('Отправлю сам');
      expect(toastArgs('success')).toHaveLength(0);
    });

    it('the red toast buttons work: «Отправить снова» sends again, «Отправлю сам» switches to the manual upload', async () => {
      onGas('sendOzonCostToKan', () => ok(refused));
      onGas('switchOzonCostToManual', () => ok({ rows: [] }));
      await store().sendKanCost();
      const options = toastArgs('error')[0][1];
      expect(requests('sendOzonCostToKan')).toHaveLength(1);

      options.action.onClick({});
      await flush();
      expect(requests('sendOzonCostToKan')).toHaveLength(2);
      expect(requests('switchOzonCostToManual')).toHaveLength(0);

      options.cancel.onClick({});
      await flush();
      expect(requests('switchOzonCostToManual')).toHaveLength(1);
      expect(requests('sendOzonCostToKan')).toHaveLength(2);
    });

    it.each([
      ['accepted groups only: one green toast with a line per group', ok({ accepted: [group()] }), 'success'],
      ['a busy answer: an info toast with the server wording', ok({ busy: true }), 'info'],
      ['nothing accepted and nothing refused: no toast at all', ok({ accepted: [], failed: [], skippedManual: 1 }), 'none'],
    ])('%s; afterwards the statuses are re-read and indexed', async (_name, answer, kind) => {
      onGas('sendOzonCostToKan', () => answer);
      onGas('getOzonCostKanMarkers', () => markerAnswer());

      expect(await sendWatched()).toBe(false);

      if (kind === 'success') {
        const successes = toastArgs('success');
        expect(successes).toHaveLength(1);
        expect(successes[0][0]).toBe('КАН принял себестоимость:');
        expect(successes[0][1].description).toBe('ART-C (MaxiStore) — 233,67 ₽ с 13.10');
        expect(sonner.calls).toHaveLength(1);
      } else if (kind === 'info') {
        const infos = toastArgs('info');
        expect(infos).toHaveLength(1);
        expect(infos[0][0]).toBe('КАН: уже отправляется');
        expect(sonner.calls).toHaveLength(1);
      } else {
        expect(sonner.calls).toHaveLength(0);
      }
      expect(requests('getOzonCostKanMarkers')).toHaveLength(1);
      expect(events.indexOf('gas:getOzonCostKanMarkers')).toBeGreaterThan(events.indexOf('gas:sendOzonCostToKan'));
      expect(store().kanCostMarkers).toEqual(indexKanMarkers([marker()]));
    });

    it.each([
      ['an HTTP 504', fail('Ошибка HTTP 504'), 'Ошибка HTTP 504'],
      ['a network failure', fail('Ошибка сети'), 'Ошибка сети'],
      ['a thrown Apps Script error', fail('Exception: Service invoked too many times'), 'Exception: Service invoked too many times'],
    ])('%s is a neutral info toast, never a red failure, and the statuses are still re-read', async (_name, answer, message) => {
      onGas('sendOzonCostToKan', () => answer);
      onGas('getOzonCostKanMarkers', () => markerAnswer());

      expect(await sendWatched()).toBe(false);

      expect(toastArgs('info').map((a) => a[0])).toEqual([`КАН: ответ не получен (${message}). Статус появится в «Истории».`]);
      expect(toastArgs('error')).toHaveLength(0);
      expect(requests('getOzonCostKanMarkers')).toHaveLength(1);
      expect(store().kanCostMarkers).toEqual(indexKanMarkers([marker()]));
    });

    it.each([
      ['an HTTP 504', () => fail('Ошибка HTTP 504')],
      ['a network failure', () => fail('Ошибка сети')],
      ['a request that rejects', () => { throw new Error('boom'); }],
    ])('%s re-reads the statuses ONCE more 120 s later, not before; the send itself does not wait for it', async (_name, answer) => {
      vi.useFakeTimers();
      try {
        onGas('sendOzonCostToKan', answer);
        let reads = 0;
        onGas('getOzonCostKanMarkers', () => ok({ markers: reads++ === 0 ? [] : [marker()] }));

        let finished = false;
        const run = store().sendKanCost().then(() => { finished = true; });
        await vi.advanceTimersByTimeAsync(1_000);
        expect(finished).toBe(true);
        await run;
        // The immediate re-read only.
        expect(requests('getOzonCostKanMarkers')).toHaveLength(1);
        expect(store().kanCostMarkers).toEqual({});

        await vi.advanceTimersByTimeAsync(118_000);
        expect(requests('getOzonCostKanMarkers')).toHaveLength(1);

        await vi.advanceTimersByTimeAsync(1_000);
        expect(requests('getOzonCostKanMarkers')).toHaveLength(2);
        expect(store().kanCostMarkers).toEqual(indexKanMarkers([marker()]));

        // Once, not a loop.
        await vi.advanceTimersByTimeAsync(600_000);
        expect(requests('getOzonCostKanMarkers')).toHaveLength(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it.each([
      ['accepted groups', ok({ accepted: [group()] })],
      ['a busy answer', ok({ busy: true })],
      ['nothing to report', ok({})],
    ])('%s (a success answer) schedules no late re-read', async (_name, answer) => {
      vi.useFakeTimers();
      try {
        onGas('sendOzonCostToKan', () => answer);

        await store().sendKanCost();
        expect(requests('getOzonCostKanMarkers')).toHaveLength(1);

        await vi.advanceTimersByTimeAsync(600_000);
        expect(requests('getOzonCostKanMarkers')).toHaveLength(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('in dev mode an admin sends nothing and is told so; a non-admin, or an admin outside dev mode, still sends', async () => {
      seed({ devMode: true, currentUser: { username: 'boss', role: 'admin' } });
      await store().sendKanCost();
      expect(requests('sendOzonCostToKan')).toHaveLength(0);
      expect(toastArgs('info').map((a) => a[0])).toEqual([NOT_SENT]);

      seed({ devMode: true, currentUser: { username: 'Кладовщик', role: 'user' } });
      await store().sendKanCost();
      expect(requests('sendOzonCostToKan')).toHaveLength(1);

      seed({ devMode: false, currentUser: { username: 'boss', role: 'admin' } });
      await store().sendKanCost();
      expect(requests('sendOzonCostToKan')).toHaveLength(2);
    });

    it('three calls during one pending request make exactly two requests in total, never two at once', async () => {
      const waves: { resolve: (value: unknown) => void }[] = [];
      onGas('sendOzonCostToKan', () => { const d = hold(); waves.push(d); return d.promise; });

      store().sendKanCost();
      store().sendKanCost();
      store().sendKanCost();
      await flush();
      expect(waves).toHaveLength(1);

      waves[0].resolve(ok({}));
      await flush();
      expect(waves).toHaveLength(2);

      waves[1].resolve(ok({}));
      await flush();
      expect(requests('sendOzonCostToKan')).toHaveLength(2);

      // Finished runs leave nothing behind: the next call starts a fresh request.
      onGas('sendOzonCostToKan', () => ok({}));
      await store().sendKanCost();
      expect(requests('sendOzonCostToKan')).toHaveLength(3);
    });
  });

  describe('the statuses: fetchKanCostMarkers', () => {
    it('starts empty and a successful read indexes the markers by order id and article', async () => {
      expect((useWarehouseStore.getInitialState() as any).kanCostMarkers).toEqual({});
      const list = [marker({ opId: 'op-1', article: 'A' }), marker({ opId: 'op-2', article: 'B', status: 'ошибка', answer: 'КАН недоступен' })];
      onGas('getOzonCostKanMarkers', () => ok({ markers: list }));

      await store().fetchKanCostMarkers();

      expect(store().kanCostMarkers).toEqual(indexKanMarkers(list));
      expect(Object.keys(store().kanCostMarkers).sort()).toEqual(['op-1|A', 'op-2|B']);
      expect(requests('getOzonCostKanMarkers')).toHaveLength(1);
    });

    it.each([
      ['an error answer', () => fail('Ошибка HTTP 504')],
      ['a request that rejects', () => { throw new Error('boom'); }],
    ])('%s keeps the old markers, shows nothing and does not throw', async (_name, answer) => {
      const before = indexKanMarkers([marker()]);
      seed({ kanCostMarkers: before });
      onGas('getOzonCostKanMarkers', answer);

      await expect(store().fetchKanCostMarkers()).resolves.toBeUndefined();

      expect(store().kanCostMarkers).toEqual(before);
      expect(sonner.calls).toHaveLength(0);
    });
  });

  describe('«Отправлю сам»: sendKanCostManually', () => {
    it('switches first, then downloads ONE file equal to kanManualCsv of the rows, never marks them exported, and re-reads the statuses', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(2026, 9, 27, 12, 0, 0));
      const rows = exportRows();
      onGas('switchOzonCostToManual', () => ok({ rows, switched: 3, notWritten: 0 }));
      onGas('getOzonCostKanMarkers', () => markerAnswer());

      await store().sendKanCostManually();

      expect(events[0]).toBe('gas:switchOzonCostToManual');
      expect(files).toHaveLength(1);
      expect(events.indexOf('download')).toBeGreaterThan(events.indexOf('gas:switchOzonCostToManual'));
      expect(files[0].download).toBe(kanCostFileName(new Date()));
      expect(files[0].download).toBe('kan_cost_2026-10-27.csv');
      const text = await fileText(files[0].blob);
      expect(text).toBe(kanManualCsv(rows));
      expect(text.startsWith('\uFEFF')).toBe(true);
      expect(requests('markOzonCostExported')).toHaveLength(0);
      // After the file, the markers are re-read.
      expect(requests('getOzonCostKanMarkers')).toHaveLength(1);
      expect(events.indexOf('gas:getOzonCostKanMarkers')).toBeGreaterThan(events.indexOf('download'));
      expect(store().kanCostMarkers).toEqual(indexKanMarkers([marker()]));
      const expected: any = kanManualToast({ rows });
      expect(toastArgs('success')).toHaveLength(1);
      expect(toastArgs('success')[0][0]).toBe('Файл для КАН скачан: строк 2');
      expect(toastArgs('success')[0][0]).toBe(expected.title);
      expect(toastArgs('success')[0][1].description).toBe(expected.lines.join('\n'));
      expect(toastArgs('error')).toHaveLength(0);
    });

    it.each([
      ['busy, even with rows in the answer', { busy: true, rows: [exportRow()] }, 'КАН: уже отправляется'],
      ['no rows to upload', { rows: [], switched: 0 }, 'Неотправленной себестоимости нет — файл не нужен'],
      ['an answer without a rows list', {}, 'Неотправленной себестоимости нет — файл не нужен'],
    ])('%s downloads no file and says so in an info toast', async (_name, data, title) => {
      onGas('switchOzonCostToManual', () => ok(data));

      await store().sendKanCostManually();

      expect(files).toHaveLength(0);
      expect(requests('markOzonCostExported')).toHaveLength(0);
      expect(toastArgs('info').map((a) => a[0])).toEqual([title]);
      expect(toastArgs('error')).toHaveLength(0);
    });

    it('a failed switch is ONE red toast that stays, with the reason, «Повтор безопасен» and a «Отправлю сам» button that switches again; no file, never marked exported', async () => {
      onGas('switchOzonCostToManual', () => fail('Ошибка HTTP 504'));

      await store().sendKanCostManually();

      expect(files).toHaveLength(0);
      expect(requests('markOzonCostExported')).toHaveLength(0);
      const errors = toastArgs('error');
      expect(errors).toHaveLength(1);
      const [title, options] = errors[0];
      expect(title).toBe('Не удалось переключить на ручную загрузку: Ошибка HTTP 504. Повтор безопасен.');
      expect(options.id).toBe('kan-cost');
      expect(options.duration).toBe(Infinity);
      expect(options.action.label).toBe('Отправлю сам');
      expect(requests('switchOzonCostToManual')).toHaveLength(1);

      // The retry asks the server again (this time it answers) and then behaves like «Отправлю сам»: one file, nothing marked.
      onGas('switchOzonCostToManual', () => ok({ rows: exportRows(), switched: 3, notWritten: 0 }));
      options.action.onClick({});
      await flush();
      expect(requests('switchOzonCostToManual')).toHaveLength(2);
      expect(files).toHaveLength(1);
      expect(requests('markOzonCostExported')).toHaveLength(0);
    });

    it('in dev mode an admin switches nothing, downloads nothing and is told so', async () => {
      seed({ devMode: true, currentUser: { username: 'boss', role: 'admin' } });
      onGas('switchOzonCostToManual', () => ok({ rows: exportRows() }));

      await store().sendKanCostManually();

      expect(requests('switchOzonCostToManual')).toHaveLength(0);
      expect(files).toHaveLength(0);
      expect(toastArgs('info').map((a) => a[0])).toEqual([NOT_MANUAL]);
    });
  });

  describe('one KAN toast at a time', () => {
    const refusedAnswer = { failed: [group({ reason: 'КАН недоступен' })], accepted: [group({ article: 'ART-A', cost: 100 })] };
    const admin = { devMode: true, currentUser: { username: 'boss', role: 'admin' } };
    const SCENARIOS: [string, string, () => Promise<void>][] = [
      ['a refused send (red)', 'error', async () => { onGas('sendOzonCostToKan', () => ok(refusedAnswer)); await store().sendKanCost(); }],
      ['an accepted send (green)', 'success', async () => { onGas('sendOzonCostToKan', () => ok({ accepted: [group()] })); await store().sendKanCost(); }],
      ['a busy send (info)', 'info', async () => { onGas('sendOzonCostToKan', () => ok({ busy: true })); await store().sendKanCost(); }],
      ['a send with no answer (HTTP 504)', 'info', async () => { onGas('sendOzonCostToKan', () => fail('Ошибка HTTP 504')); await store().sendKanCost(); }],
      ['a send whose request rejects', 'info', async () => { onGas('sendOzonCostToKan', () => { throw new Error('boom'); }); await store().sendKanCost(); }],
      ['a send in dev mode', 'info', async () => { seed(admin); await store().sendKanCost(); }],
      ['«Отправлю сам» with a file', 'success', async () => { onGas('switchOzonCostToManual', () => ok({ rows: exportRows() })); await store().sendKanCostManually(); }],
      ['«Отправлю сам» with nothing to upload', 'info', async () => { onGas('switchOzonCostToManual', () => ok({ rows: [] })); await store().sendKanCostManually(); }],
      ['«Отправлю сам» while busy', 'info', async () => { onGas('switchOzonCostToManual', () => ok({ busy: true })); await store().sendKanCostManually(); }],
      ['«Отправлю сам» refused by the server', 'error', async () => { onGas('switchOzonCostToManual', () => fail('Ошибка HTTP 504')); await store().sendKanCostManually(); }],
      ['«Отправлю сам» whose request rejects', 'error', async () => { onGas('switchOzonCostToManual', () => { throw new Error('boom'); }); await store().sendKanCostManually(); }],
      ['«Отправлю сам» in dev mode', 'info', async () => { seed(admin); await store().sendKanCostManually(); }],
    ];

    it.each(SCENARIOS)('%s raises exactly one toast, with the shared id «kan-cost» so that it replaces the previous one instead of stacking', async (_name, kind, run) => {
      await run();

      expect(sonner.calls.map((c) => [c.kind, c.args[1]?.id])).toEqual([[kind, 'kan-cost']]);
    });
  });

  describe('the other save paths start the KAN step', () => {
    interface SavePath {
      name: string;
      action: string;
      seed?: () => Record<string, unknown>;
      data: () => Record<string, unknown>;
      run: () => Promise<unknown>;
    }
    /** A row of «Удаленное» as the store holds it: the deleted row itself is a JSON text. */
    const archivedRow = (archiveId: string, data: unknown, type = 'Transaction'): any => ({
      archiveId, type, deletedAt: 1782000000000, deletedBy: 'Кладовщик',
      dataJSON: typeof data === 'string' ? data : JSON.stringify(data),
    });
    const ozonArchived = (archiveId: string) =>
      archivedRow(archiveId, { type: 'Расход', destination: OZON, isComponent: false, opId: 'op-1', article: 'ART-C' });
    const receiptArchived = (archiveId: string) =>
      archivedRow(archiveId, { type: 'Приход', destination: '', isComponent: false, opId: 'op-9', article: 'ART-C' });

    const SAVE_PATHS: SavePath[] = [
      {
        name: 'commitTransaction (Ozon expense)', action: 'commit',
        data: () => ({ stock: [STOCK_ITEM], newTransactions: [tx()] }),
        run: () => store().commitTransaction(ITEMS, 'Расход', OZON, '', 'op-1'),
      },
      {
        name: 'handleUpdateTransaction (Ozon row)', action: 'updateTransaction',
        seed: () => ({ transactions: [tx()] }),
        data: () => ({ stock: [STOCK_ITEM], newTransactions: [tx()] }),
        run: () => store().handleUpdateTransaction('t-ozon', tx()),
      },
      {
        name: 'handleDeleteTransaction (Ozon row)', action: 'deleteTransaction',
        seed: () => ({ transactions: [tx()] }),
        data: () => ({ stock: [], transactions: [] }),
        run: () => store().handleDeleteTransaction('t-ozon'),
      },
      {
        name: 'handleDeleteMultipleTransactions (Ozon rows)', action: 'deleteMultipleTransactions',
        seed: () => ({ transactions: [tx(), tx({ id: 't-ozon-2' })] }),
        data: () => ({ stock: [], transactions: [] }),
        run: () => store().handleDeleteMultipleTransactions(['t-ozon', 't-ozon-2']),
      },
      {
        name: 'handleRestoreArchivedItem (an Ozon shipment)', action: 'restoreArchivedItem',
        seed: () => ({ archivedItems: [ozonArchived('a-1')] }),
        data: () => ({ stock: [], transactions: [] }),
        run: () => store().handleRestoreArchivedItem('a-1'),
      },
      {
        // One Ozon shipment among the restored rows is enough.
        name: 'handleRestoreMultipleArchivedItems (an Ozon shipment and a receipt)', action: 'restoreMultipleArchivedItems',
        seed: () => ({ archivedItems: [receiptArchived('a-1'), ozonArchived('a-2')] }),
        data: () => ({ stock: [], transactions: [] }),
        run: () => store().handleRestoreMultipleArchivedItems(['a-1', 'a-2']),
      },
      {
        name: 'commitShipmentPeresort', action: 'commitShipmentPeresort',
        data: () => ({ stock: [], transactions: [] }),
        run: () => store().commitShipmentPeresort('p-1'),
      },
    ];

    it.each(SAVE_PATHS)('$name: one KAN request after the save, and the save does not wait for it', async (p) => {
      seed(p.seed?.() ?? {});
      const kan = hold();
      onGas(p.action, () => ok(p.data()));
      onGas('sendOzonCostToKan', () => kan.promise);

      const outcome = await Promise.race([p.run(), hungAfter(100)]);

      expect(outcome).toBe(true);
      await flush();
      expect(requests('sendOzonCostToKan')).toHaveLength(1);
      expect(events.indexOf(`gas:${p.action}`)).toBeLessThan(events.indexOf('gas:sendOzonCostToKan'));
    });

    it.each(SAVE_PATHS)('$name: a refused save returns false and starts no KAN request', async (p) => {
      seed(p.seed?.() ?? {});
      onGas(p.action, () => fail('Ошибка сервера'));

      expect(await p.run()).toBe(false);
      await flush();

      expect(requests('sendOzonCostToKan')).toHaveLength(0);
    });

    it.each(SAVE_PATHS)('$name: costJournalError of the answer is shown as a red toast', async (p) => {
      seed(p.seed?.() ?? {});
      const text = 'Журнал «Себестоимость Озон» для КАН НЕ обновлён: тест';
      onGas(p.action, () => ok({ ...p.data(), costJournalError: text }));

      expect(await p.run()).toBe(true);
      await flush();

      expect(toastArgs('error').map((a) => a[0])).toContain(text);
    });

    it.each([
      ['a receipt', [receiptArchived('a-1')]],
      ['an expense to another shop', [archivedRow('a-1', { type: 'Расход', destination: WILDBERRIES, opId: 'op-2' })]],
      ['a kit component of an Ozon shipment', [archivedRow('a-1', { type: 'Расход', destination: OZON, isComponent: true, opId: 'op-1' })]],
      ['a SKU', [archivedRow('a-1', { sku: 'ART-C', pcsPerBox: 10 }, 'SKU')]],
      ['an item of another kind, even if its JSON looks like an Ozon expense', [archivedRow('a-1', { type: 'Расход', destination: OZON }, 'SKU')]],
      ['a row whose archived JSON cannot be parsed', [archivedRow('a-1', '{not json')]],
      ['a receipt while ANOTHER Ozon shipment stays in the archive', [receiptArchived('a-1'), ozonArchived('a-9')]],
    ])('restoring %s starts no KAN request, one row or many', async (_name, items) => {
      onGas('restoreArchivedItem', () => ok({ stock: [], transactions: [] }));
      onGas('restoreMultipleArchivedItems', () => ok({ stock: [], transactions: [] }));

      seed({ archivedItems: items });
      expect(await store().handleRestoreArchivedItem('a-1')).toBe(true);
      seed({ archivedItems: items });
      expect(await store().handleRestoreMultipleArchivedItems(['a-1'])).toBe(true);
      await flush();

      expect(requests('restoreArchivedItem')).toHaveLength(1);
      expect(requests('restoreMultipleArchivedItems')).toHaveLength(1);
      expect(requests('sendOzonCostToKan')).toHaveLength(0);
    });

    it('restoring several rows starts ONE step when an Ozon shipment is among them, wherever it stands in the list', async () => {
      onGas('restoreMultipleArchivedItems', () => ok({ stock: [], transactions: [] }));
      seed({ archivedItems: [receiptArchived('a-1'), archivedRow('a-2', '{not json'), ozonArchived('a-3')] });

      expect(await store().handleRestoreMultipleArchivedItems(['a-1', 'a-2', 'a-3'])).toBe(true);
      await flush();

      expect(requests('sendOzonCostToKan')).toHaveLength(1);
    });

    it('a restored receipt that the server could not follow in the journal still shows the red toast, with no KAN step', async () => {
      const text = 'Журнал «Себестоимость Озон» для КАН НЕ обновлён: тест';
      seed({ archivedItems: [receiptArchived('a-1')] });
      onGas('restoreArchivedItem', () => ok({ stock: [], transactions: [], costJournalError: text }));

      expect(await store().handleRestoreArchivedItem('a-1')).toBe(true);
      await flush();

      expect(toastArgs('error').map((a) => a[0])).toContain(text);
      expect(requests('sendOzonCostToKan')).toHaveLength(0);
    });

    it('an edit starts the step when the row WAS an Ozon shipment, even if the edit moves it to another shop', async () => {
      seed({ transactions: [tx()] });
      onGas('updateTransaction', () => ok({ stock: [STOCK_ITEM], newTransactions: [tx({ destination: WILDBERRIES })] }));

      expect(await store().handleUpdateTransaction('t-ozon', tx({ destination: WILDBERRIES }))).toBe(true);
      await flush();

      expect(requests('sendOzonCostToKan')).toHaveLength(1);
    });

    it('an edit of a non-Ozon row, or of a receipt that recalculated nothing, starts no step', async () => {
      seed({ transactions: [tx({ id: 't-wb', destination: WILDBERRIES }), tx({ id: 't-rcp', type: 'Приход', destination: '' })] });
      onGas('updateTransaction', () => ok({ stock: [STOCK_ITEM], newTransactions: [] }));
      await store().handleUpdateTransaction('t-wb', tx({ id: 't-wb', destination: WILDBERRIES }));

      onGas('updateTransaction', () => ok({ stock: [STOCK_ITEM], newTransactions: [], recalculated: { changed: [], appended: 0 } }));
      await store().handleUpdateTransaction('t-rcp', tx({ id: 't-rcp', type: 'Приход', destination: '' }));
      await flush();

      expect(requests('updateTransaction')).toHaveLength(2);
      expect(requests('sendOzonCostToKan')).toHaveLength(0);
    });

    it('a receipt edit that recalculated shipments starts the step and reports only the counts, with no button instruction', async () => {
      seed({ transactions: [tx({ id: 't-rcp', type: 'Приход', destination: '' })] });
      onGas('updateTransaction', () => ok({
        stock: [STOCK_ITEM],
        newTransactions: [tx({ id: 't-rcp', type: 'Приход', destination: '' })],
        recalculated: { changed: [{ id: 'a' }, { id: 'b' }], appended: 3 },
      }));

      expect(await store().handleUpdateTransaction('t-rcp', tx({ id: 't-rcp', type: 'Приход', destination: '' }))).toBe(true);
      await flush();

      expect(requests('sendOzonCostToKan')).toHaveLength(1);
      expect(toastArgs('info').map((a) => a[0])).toContain('Пересчитано отгрузок: 2. Для КАН готово строк: 3.');
      const everything = allToastStrings().join('\n');
      expect(everything).not.toContain('нажмите');
      expect(everything).not.toContain('Себестоимость КАН');
    });

    it.each([
      ['recalculated shipments but appended no cost rows («На Озон этот товар не уезжал»)', { changed: [{ id: 'a' }, { id: 'b' }], appended: 0 }, 0],
      ['recalculated shipments and appended cost rows', { changed: [{ id: 'a' }], appended: 2 }, 1],
      ['appended cost rows', { changed: [], appended: 2 }, 1],
    ])('a receipt edit that %s: the KAN step follows the rows appended to the journal, not the shipments recalculated', async (_name, recalculated, steps) => {
      seed({ transactions: [tx({ id: 't-rcp', type: 'Приход', destination: '' })] });
      onGas('updateTransaction', () => ok({
        stock: [STOCK_ITEM],
        newTransactions: [tx({ id: 't-rcp', type: 'Приход', destination: '' })],
        recalculated,
      }));

      expect(await store().handleUpdateTransaction('t-rcp', tx({ id: 't-rcp', type: 'Приход', destination: '' }))).toBe(true);
      await flush();

      expect(requests('sendOzonCostToKan')).toHaveLength(steps);
    });

    it('a receipt edit with nothing appended still says what was recalculated, and says no cost goes to KAN', async () => {
      seed({ transactions: [tx({ id: 't-rcp', type: 'Приход', destination: '' })] });
      onGas('updateTransaction', () => ok({
        stock: [STOCK_ITEM],
        newTransactions: [tx({ id: 't-rcp', type: 'Приход', destination: '' })],
        recalculated: { changed: [{ id: 'a' }, { id: 'b' }], appended: 0 },
      }));

      await store().handleUpdateTransaction('t-rcp', tx({ id: 't-rcp', type: 'Приход', destination: '' }));
      await flush();

      expect(toastArgs('info').map((a) => a[0])).toContain('Пересчитано отгрузок: 2. На Озон этот товар не уезжал, в КАН ничего не уходит.');
    });

    it('an edit of an Ozon shipment starts the step even when the answer recalculated shipments and appended nothing', async () => {
      seed({ transactions: [tx()] });
      onGas('updateTransaction', () => ok({
        stock: [STOCK_ITEM], newTransactions: [tx()], recalculated: { changed: [{ id: 'a' }], appended: 0 },
      }));

      expect(await store().handleUpdateTransaction('t-ozon', tx())).toBe(true);
      await flush();

      expect(requests('sendOzonCostToKan')).toHaveLength(1);
    });

    it('a delete starts the step for an Ozon row anywhere among the deleted ones; a non-Ozon row or a kit component alone starts none', async () => {
      const wbRow = () => tx({ id: 't-wb', destination: WILDBERRIES });
      const kit = () => [
        tx({ id: 'k1', groupId: 'g1', article: 'KIT-1' }),
        tx({ id: 'c1', groupId: 'g1', article: 'C-1', isComponent: true }),
        tx({ id: 'c2', groupId: 'g1', article: 'C-2', isComponent: true }),
      ];
      onGas('deleteTransaction', () => ok({ stock: [], transactions: [] }));
      onGas('deleteMultipleTransactions', () => ok({ stock: [], transactions: [] }));

      // A row of another shop, and a kit component on its own: no step.
      seed({ transactions: [wbRow(), ...kit()] });
      await store().handleDeleteTransaction('t-wb');
      await store().handleDeleteMultipleTransactions(['c1']);
      await flush();
      expect(requests('deleteTransaction')).toHaveLength(1);
      expect(requests('deleteMultipleTransactions')).toHaveLength(1);
      expect(requests('sendOzonCostToKan')).toHaveLength(0);

      // One Ozon row among others: one step.
      seed({ transactions: [wbRow(), tx()] });
      await store().handleDeleteMultipleTransactions(['t-wb', 't-ozon']);
      await flush();
      expect(requests('deleteMultipleTransactions')).toHaveLength(2);
      expect(requests('sendOzonCostToKan')).toHaveLength(1);

      // The kit's own row cascades to its components: still ONE step, not one per layer.
      seed({ transactions: kit() });
      await store().handleDeleteTransaction('k1');
      await flush();
      expect(requests('deleteMultipleTransactions')).toHaveLength(3);
      expect(requests('deleteMultipleTransactions')[2].payload.ids.sort()).toEqual(['c1', 'c2', 'k1']);
      expect(requests('sendOzonCostToKan')).toHaveLength(2);
    });
  });

  describe('«Вся отгрузка»: updateShipmentExtras', () => {
    const payload = { id: 't-ozon', packagingMode: 'batch', packagingValue: 100, otherMode: 'batch', otherValue: 0, services: [] };
    const answer = (over: Record<string, unknown> = {}) => ok({
      newTransactions: [tx()], stock: [STOCK_ITEM], oldTotal: 0, newTotal: 100, orders: [], changedRows: 1, ...over,
    });

    it('starts the step, without the save waiting for it, only when cost rows were appended', async () => {
      const kan = hold();
      onGas('updateShipmentExtras', () => answer({ costRowsAppended: 2 }));
      onGas('sendOzonCostToKan', () => kan.promise);

      expect(await Promise.race([store().updateShipmentExtras(payload), hungAfter(100)])).toBe(true);
      await flush();
      expect(requests('sendOzonCostToKan')).toHaveLength(1);

      onGas('updateShipmentExtras', () => answer({ costRowsAppended: 0 }));
      expect(await store().updateShipmentExtras(payload)).toBe(true);
      await flush();
      expect(requests('sendOzonCostToKan')).toHaveLength(1);
    });

    it('keeps its journal error as a yellow warning, not a red toast', async () => {
      const text = 'Журнал не обновлён: тест';
      onGas('updateShipmentExtras', () => answer({ costJournalError: text }));

      expect(await store().updateShipmentExtras(payload)).toBe(true);
      await flush();

      expect(toastArgs('warning').map((a) => a[0])).toEqual([text]);
      expect(toastArgs('error')).toHaveLength(0);
    });
  });

  describe('the multi-order batch write-off in ConfirmModal starts ONE KAN step (source guard)', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src/components/ConfirmModal.tsx'), 'utf8');
    const closingBrace = (text: string, open: number): number => {
      let depth = 0;
      for (let i = open; i < text.length; i++) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}') { depth--; if (depth === 0) return i; }
      }
      return -1;
    };
    const CALL = /sendKanCost\s*\(/;

    /** The batch block, its loop over the orders and the loop's «interrupted» branch, found by structure. */
    const parts = () => {
      const blockOpen = src.indexOf('{', src.indexOf('if (isMultiOrderBatch && pendingOzonBatch)'));
      const blockClose = closingBrace(src, blockOpen);
      const forHead = 'for (let i = 0; i < plan.groups.length; i++)';
      const forAt = src.indexOf(forHead, blockOpen);
      const loopOpen = src.indexOf('{', forAt + forHead.length);
      const loopClose = closingBrace(src, loopOpen);
      const brokenAt = src.indexOf('if (!ok)', loopOpen);
      const brokenOpen = src.indexOf('{', brokenAt);
      const brokenClose = closingBrace(src, brokenOpen);
      expect(blockOpen).toBeGreaterThan(-1);
      expect(forAt).toBeGreaterThan(blockOpen);
      expect(loopClose).toBeGreaterThan(loopOpen);
      expect(brokenAt).toBeGreaterThan(loopOpen);
      expect(brokenClose).toBeLessThan(loopClose);
      expect(blockClose).toBeGreaterThan(loopClose);
      return {
        block: src.slice(blockOpen, blockClose + 1),
        afterLoop: src.slice(loopClose + 1, blockClose),
        // The loop body without its «interrupted» branch: the part that runs once per order.
        perOrder: src.slice(loopOpen, brokenAt) + src.slice(brokenClose + 1, loopClose + 1),
        broken: src.slice(brokenOpen, brokenClose + 1),
        outside: src.slice(0, blockOpen) + src.slice(blockClose + 1),
      };
    };

    it('the call stands after the loop over the orders, once, and never per order', () => {
      const { afterLoop, perOrder } = parts();
      expect(afterLoop.match(/sendKanCost\s*\(/g) ?? []).toHaveLength(1);
      expect(perOrder).not.toMatch(CALL);
    });

    it('it is decided by isOzonShipmentRow on the operation type and the final destination', () => {
      const { block } = parts();
      const guard = block.search(/isOzonShipmentRow\(\s*\{\s*type:\s*opType,\s*destination:\s*finalDestination\s*\}\s*\)/);
      expect(guard).toBeGreaterThan(-1);
      expect(guard).toBeLessThan(block.search(CALL));
    });

    it('an interrupted batch starts the step too, but only when at least one order was written', () => {
      const { broken } = parts();
      const at = broken.search(CALL);
      expect(at).toBeGreaterThan(-1);
      expect(broken.slice(0, at)).toMatch(/written\.length\s*(>|!==|!=|>=)\s*[01]|if\s*\(\s*written\.length\s*(\)|&&)|written\.length\s*&&/);
    });

    it('the single-order path and the rest of the modal do not call it: commitTransaction starts the step itself', () => {
      expect(parts().outside).not.toMatch(CALL);
    });
  });
});

/**
 * Item 93 ticket 05, step C: the KAN marker in «История». Written TEST-FIRST, by the tester, against the agreed
 * interface — HistoryTab does not read `kanCostMarkers` yet, so the checks that need a marker are red until the
 * coder wires it.
 *
 * How it is driven (no DOM in this repo): `HistoryTab` is rendered with `renderToStaticMarkup`, which never runs
 * effects or click handlers, so those two are source guards. zustand v5 feeds the server render the FROZEN initial
 * state, not the live one (see ozonSettingsWindow.test.ts), so the test mutates the initial-state object in place
 * and puts it back after every test. Every render test holds a positive control (a row that must carry a marker)
 * next to the rows that must not, so none of them can pass vacuously before the wiring exists.
 */
describe('KAN marker in «История» (step C)', () => {
  const HISTORY_SRC = fs.readFileSync(path.join(process.cwd(), 'src/components/HistoryTab.tsx'), 'utf8');
  const worker = { username: 'Кладовщик', role: 'user' };
  const boss = { username: 'boss', role: 'admin' };

  const historyRow = (over: Record<string, unknown> = {}): any => ({
    id: 'h-1', date: '27.10.2026', type: 'Расход', article: 'ART-MINE', quantity: 2, price: 0, writeOffCost: 50,
    total: 100, destination: 'Ozon (MaxiStore)', opId: 'op-1', user: 'Кладовщик', ...over,
  });

  // ---- render the tab against a chosen store state ----
  const initial = useWarehouseStore.getInitialState() as any;
  const saved: Record<string, unknown> = {};
  afterEach(() => {
    Object.assign(initial, saved);
    Object.keys(saved).forEach((k) => delete saved[k]);
  });
  const renderHistory = (rows: any[], markers: KanMarkerInfo[], user: { username: string; role: string } | null): string => {
    const patch = { transactions: rows, kanCostMarkers: indexKanMarkers(markers), currentUser: user };
    (Object.keys(patch) as (keyof typeof patch)[]).forEach((k) => { if (!(k in saved)) saved[k] = initial[k]; });
    Object.assign(initial, patch);
    return renderToStaticMarkup(createElement(HistoryTab));
  };

  // ---- reading the markup ----
  /** The <tr> of the row with this article (the article is the text of its own element). */
  const rowOf = (html: string, article: string): string => {
    const found = (html.match(/<tr\b[\s\S]*?<\/tr>/g) ?? []).filter((tr) => tr.includes(`>${article}<`));
    expect(found, `exactly one row for ${article}`).toHaveLength(1);
    return found[0];
  };
  const markerCount = (html: string): number => (html.match(/data-testid="history-kan-marker"/g) ?? []).length;
  /** The marker span: its opening tag and everything inside it (the glyph and the tooltip). */
  const markerOf = (html: string): { open: string; inner: string } | null => {
    const m = /<span\b[^>]*data-testid="history-kan-marker"[^>]*>/.exec(html);
    if (!m) return null;
    const tag = /<(\/?)span\b[^>]*>/g;
    tag.lastIndex = m.index;
    let depth = 0;
    for (let t = tag.exec(html); t; t = tag.exec(html)) {
      depth += t[1] ? -1 : 1;
      if (depth === 0) return { open: m[0], inner: html.slice(m.index + m[0].length, t.index) };
    }
    return null;
  };
  const cellWith = (rowHtml: string, needle: string): string => {
    const cells = rowHtml.split('<td').filter((c) => c.includes(needle));
    expect(cells, `exactly one cell holds ${needle}`).toHaveLength(1);
    return cells[0];
  };
  const buttonText = (html: string, testid: string): string | null => {
    const m = new RegExp(`<button\\b[^>]*data-testid="${testid}"[^>]*>([\\s\\S]*?)</button>`).exec(html);
    return m ? m[1].replace(/<[^>]*>/g, '').trim() : null;
  };
  const count = (html: string, needle: string): number => html.split(needle).length - 1;

  const closingBrace = (text: string, open: number): number => {
    let depth = 0;
    for (let i = open; i < text.length; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') { depth--; if (depth === 0) return i; }
    }
    return -1;
  };

  it('a non-admin sees the ✓ with the answer text beside the 💬 in the destination cell of their own shipment, and nothing on a colleague\'s', () => {
    const html = renderHistory(
      [
        historyRow({ id: 'h-1', article: 'ART-MINE', opId: 'op-1', user: 'Кладовщик', comment: 'Первый заказ' }),
        historyRow({ id: 'h-2', article: 'ART-THEIRS', opId: 'op-2', user: 'Другой' }),
      ],
      [
        marker({ opId: 'op-1', article: 'ART-MINE', status: 'принято', answer: 'КАН принял 233,67' }),
        marker({ opId: 'op-2', article: 'ART-THEIRS', status: 'принято', answer: 'КАН принял 999,99' }),
      ],
      worker,
    );

    expect(markerCount(html)).toBe(1);
    const mine = rowOf(html, 'ART-MINE');
    const m = markerOf(mine);
    expect(m).not.toBeNull();
    expect(m!.open).toContain('aria-label="КАН принял 233,67"');
    expect(m!.open).toContain('emerald');
    // An app tooltip like the one of the 💬, not the browser's slow `title`.
    expect(m!.open).not.toMatch(/\stitle=/);
    expect(m!.inner).toContain('✓');
    expect(m!.inner).toContain('КАН принял 233,67');
    // The destination cell holds the destination, the 💬 and the KAN marker.
    const cell = cellWith(mine, 'data-testid="history-kan-marker"');
    expect(cell).toContain('MaxiStore');
    expect(cell).toContain('data-testid="history-comment-marker"');
    // The colleague's shipment shows neither the marker nor its answer.
    expect(markerCount(rowOf(html, 'ART-THEIRS'))).toBe(0);
    expect(html).not.toContain('999,99');
  });

  it('the admin sees the marker of every shipment, whoever made it', () => {
    const html = renderHistory(
      [
        historyRow({ id: 'h-1', article: 'ART-MINE', opId: 'op-1', user: 'Кладовщик' }),
        historyRow({ id: 'h-2', article: 'ART-THEIRS', opId: 'op-2', user: 'Другой' }),
      ],
      [
        marker({ opId: 'op-1', article: 'ART-MINE', status: 'принято', answer: 'КАН принял 233,67' }),
        marker({ opId: 'op-2', article: 'ART-THEIRS', status: 'принято', answer: 'КАН принял 999,99' }),
      ],
      boss,
    );

    expect(markerCount(html)).toBe(2);
    expect(markerOf(rowOf(html, 'ART-MINE'))!.inner).toContain('КАН принял 233,67');
    expect(markerOf(rowOf(html, 'ART-THEIRS'))!.inner).toContain('КАН принял 999,99');
  });

  it('each status gets its glyph, tone and text; only an error shows the two buttons «Отправить снова» and «Отправлю сам», right under its marker', () => {
    const html = renderHistory(
      [
        historyRow({ id: 'h-1', article: 'ART-ERR', opId: 'op-e' }),
        historyRow({ id: 'h-2', article: 'ART-OK', opId: 'op-a' }),
        historyRow({ id: 'h-3', article: 'ART-HAND', opId: 'op-m' }),
        historyRow({ id: 'h-4', article: 'ART-SEND', opId: 'op-s' }),
      ],
      [
        marker({ opId: 'op-e', article: 'ART-ERR', status: 'ошибка', answer: 'КАН недоступен' }),
        marker({ opId: 'op-a', article: 'ART-OK', status: 'принято', answer: 'КАН принял 233,67' }),
        marker({ opId: 'op-m', article: 'ART-HAND', status: 'вручную', answer: 'ждём файл в КАН' }),
        marker({ opId: 'op-s', article: 'ART-SEND', status: 'отправляется', answer: '' }),
      ],
      boss,
    );

    expect(markerCount(html)).toBe(4);
    const view = (article: string) => markerOf(rowOf(html, article))!;
    expect(view('ART-ERR').open).toContain('red');
    expect(view('ART-ERR').open).toContain('aria-label="КАН не принял: КАН недоступен"');
    expect(view('ART-ERR').inner).toContain('✗');
    expect(view('ART-OK').open).toContain('emerald');
    expect(view('ART-HAND').open).toContain('amber');
    expect(view('ART-HAND').inner).toContain('⏳');
    expect(view('ART-HAND').inner).toContain('Загрузка вручную: ждём файл в КАН');
    expect(view('ART-SEND').open).toContain('amber');
    expect(view('ART-SEND').open).toContain('aria-label="Отправляется в КАН"');

    // Exactly one pair of buttons on the screen, texts as agreed, both in the error row's marker cell.
    expect(count(html, 'data-testid="history-kan-retry"')).toBe(1);
    expect(count(html, 'data-testid="history-kan-manual"')).toBe(1);
    expect(buttonText(html, 'history-kan-retry')).toBe('Отправить снова');
    expect(buttonText(html, 'history-kan-manual')).toBe('Отправлю сам');
    const errorCell = cellWith(rowOf(html, 'ART-ERR'), 'data-testid="history-kan-marker"');
    expect(errorCell).toContain('data-testid="history-kan-retry"');
    expect(errorCell).toContain('data-testid="history-kan-manual"');
    expect(errorCell.indexOf('data-testid="history-kan-marker"')).toBeLessThan(errorCell.indexOf('data-testid="history-kan-retry"'));
    for (const article of ['ART-OK', 'ART-HAND', 'ART-SEND']) {
      expect(rowOf(html, article), article).not.toContain('history-kan-retry');
      expect(rowOf(html, article), article).not.toContain('history-kan-manual');
    }
  });

  it('a row with no marker entry, no order id or a status that shows nothing gets no marker; a kit\'s own row does, its collapsed components do not', () => {
    const html = renderHistory(
      [
        historyRow({ id: 'h-1', article: 'ART-MINE', opId: 'op-1' }),
        historyRow({ id: 'h-2', article: 'ART-NOENTRY', opId: 'op-9' }),
        historyRow({ id: 'h-3', article: 'ART-NOOP', opId: '' }),
        historyRow({ id: 'h-4', article: 'ART-UNKNOWN', opId: 'op-u' }),
        historyRow({ id: 'h-5', article: 'KIT-1', opId: 'op-kit', groupId: 'g1' }),
        historyRow({ id: 'h-6', article: 'C-1', opId: 'op-kit', groupId: 'g1', isComponent: true }),
      ],
      [
        marker({ opId: 'op-1', article: 'ART-MINE', status: 'принято' }),
        marker({ opId: '', article: 'ART-NOOP', status: 'принято' }),
        marker({ opId: 'op-u', article: 'ART-UNKNOWN', status: 'проверить' }),
        marker({ opId: 'op-kit', article: 'KIT-1', status: 'принято' }),
        marker({ opId: 'op-kit', article: 'C-1', status: 'принято' }),
      ],
      worker,
    );

    expect(markerCount(html)).toBe(2);
    expect(markerCount(rowOf(html, 'ART-MINE'))).toBe(1);
    expect(markerCount(rowOf(html, 'KIT-1'))).toBe(1);
    for (const article of ['ART-NOENTRY', 'ART-NOOP', 'ART-UNKNOWN']) {
      expect(markerCount(rowOf(html, article)), article).toBe(0);
    }
    // The component is not a row of the table at all until the kit is opened.
    expect(html).not.toContain('>C-1<');
  });

  it('the marker is drawn for the main row only: the kit components block of the table never renders it (source guard)', () => {
    const at = HISTORY_SRC.indexOf('data-testid="history-kan-marker"');
    const componentRows = HISTORY_SRC.indexOf('components.map(c => (');
    expect(count(HISTORY_SRC, 'data-testid="history-kan-marker"')).toBe(1);
    expect(componentRows).toBeGreaterThan(-1);
    expect(at).toBeLessThan(componentRows);
  });

  it('the statuses are read once when the tab opens: an effect with no dependencies besides the action calls fetchKanCostMarkers (source guard)', () => {
    const effects: string[] = [];
    for (const m of HISTORY_SRC.matchAll(/useEffect\s*\(/g)) {
      let depth = 0;
      for (let i = m.index! + m[0].length - 1; i < HISTORY_SRC.length; i++) {
        if (HISTORY_SRC[i] === '(') depth++;
        else if (HISTORY_SRC[i] === ')') {
          depth--;
          if (depth === 0) { effects.push(HISTORY_SRC.slice(m.index!, i + 1)); break; }
        }
      }
    }
    const reading = effects.filter((e) => /\bfetchKanCostMarkers\b/.test(e));
    expect(reading).toHaveLength(1);
    expect(reading[0]).toMatch(/\bfetchKanCostMarkers\s*\(\s*\)/);
    expect(reading[0]).toMatch(/,\s*\[\s*(fetchKanCostMarkers\s*)?\]\s*\)$/);
  });

  it('«Отправить снова» calls sendKanCost and «Отправлю сам» calls sendKanCostManually, not each other (source guard)', () => {
    const handlerOf = (testid: string): string => {
      const at = HISTORY_SRC.indexOf(`data-testid="${testid}"`);
      expect(at, testid).toBeGreaterThan(-1);
      const button = HISTORY_SRC.slice(HISTORY_SRC.lastIndexOf('<button', at), HISTORY_SRC.indexOf('</button>', at));
      const onClick = button.indexOf('onClick={');
      expect(onClick, `${testid} has an onClick`).toBeGreaterThan(-1);
      const open = onClick + 'onClick='.length;
      return button.slice(open, closingBrace(button, open) + 1);
    };

    const retry = handlerOf('history-kan-retry');
    expect(retry).toMatch(/\bsendKanCost\b/);
    expect(retry).not.toMatch(/\bsendKanCostManually\b/);
    const manual = handlerOf('history-kan-manual');
    expect(manual).toMatch(/\bsendKanCostManually\b/);
    expect(manual).not.toMatch(/\bsendKanCost\b/);
  });
});
