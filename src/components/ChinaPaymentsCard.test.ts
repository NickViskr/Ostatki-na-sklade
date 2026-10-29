/**
 * Plan item 100.6 / R-046: when the pasted bank message gives the yuan amount the Chinese side
 * confirmed, the card must keep it and send it with the save request (`amountCny`).
 * The component function is called directly with a tiny hook runtime (state slots by call order),
 * stores are replaced by plain fakes, and the returned element tree is walked for the buttons.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  slots: [] as any[],
  idx: 0,
  savePayment: undefined as any
}));

vi.mock('react', async (importOriginal) => {
  const actual: any = await importOriginal();
  const real = actual.default ?? actual;
  const useState = (initial: any) => {
    const i = h.idx++;
    if (!(i in h.slots)) h.slots[i] = typeof initial === 'function' ? initial() : initial;
    const set = (v: any) => { h.slots[i] = typeof v === 'function' ? v(h.slots[i]) : v; };
    return [h.slots[i], set];
  };
  const hooks = { useState, useEffect: () => {}, useRef: (v: any) => ({ current: v }) };
  return { ...actual, ...hooks, default: { ...real, ...hooks } };
});
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }));
vi.mock('../store/useChinaStore', () => ({
  useChinaStore: (sel: any) => sel({
    money: { pool: { cny: 0, knownCny: 0, knownRub: 0, pendingCny: 0, historyCny: 0 }, orders: [], payments: [], receipts: [], reports: [] }, isSaving: false,
    saveChinaPayment: (p: any) => h.savePayment(p),
    deleteChinaPayment: async () => true, matchChinaPayment: async () => true,
    unmatchChinaPayment: async () => true, setChinaReceiptHistory: async () => true,
    fetchChinaMoney: async () => {}
  })
}));
vi.mock('../store/useWarehouseStore', () => ({ useWarehouseStore: (sel: any) => sel({ currentUser: { username: 'u' } }) }));
vi.mock('../store/useUIStore', () => ({ useUIStore: (sel: any) => sel({ setConfirmDialog: () => {} }) }));

import { ChinaPaymentsCard } from './ChinaPaymentsCard';

const render = (): any => { h.idx = 0; return (ChinaPaymentsCard as any)(); };

const findByTestId = (node: any, id: string): any => {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) { for (const c of node) { const f = findByTestId(c, id); if (f) return f; } return null; }
  if (node.props && node.props['data-testid'] === id) return node;
  return node.props ? findByTestId(node.props.children, id) : null;
};

/** The text input is the first `useState('')` slot of the card. */
const pasteAndSave = async (message: string) => {
  h.slots = [];
  render();
  const textSlot = h.slots.findIndex((v) => v === '');
  h.slots[textSlot] = message;
  findByTestId(render(), 'btn-china-payment-parse').props.onClick();
  await findByTestId(render(), 'btn-china-payment-add').props.onClick();
};

describe('ChinaPaymentsCard keeps the yuan amount of a parsed bank message (R-046)', () => {
  beforeEach(() => { h.savePayment = vi.fn(async () => true); });

  it('sends amountCny 100 when the message says the Chinese confirmed 100 yuan', async () => {
    await pasteAndSave('1000 руб, китайцы подтвердили 100 юаней');
    expect(h.savePayment).toHaveBeenCalledTimes(1);
    expect(h.savePayment.mock.calls[0][0]).toMatchObject({ amountRub: 1000, amountCny: 100 });
  });

  it('sends amountCny 50 for a rate-based message with 50 confirmed yuan', async () => {
    await pasteAndSave('1000 руб по курсу 10, китайцы подтвердили 50 юаней');
    expect(h.savePayment.mock.calls[0][0]).toMatchObject({ amountRub: 1000, rate: 10, amountCny: 50 });
  });
});

describe('R-046: a hand edit after parsing drops the stale yuan amount', () => {
  beforeEach(() => { h.savePayment = vi.fn(async () => true); });

  const parseThenEdit = async (testId: string, edit: (el: any) => void) => {
    h.slots = [];
    render();
    h.slots[h.slots.findIndex((v) => v === '')] = '1000 руб, китайцы подтвердили 100 юаней';
    findByTestId(render(), 'btn-china-payment-parse').props.onClick();
    const input = findByTestId(render(), testId);
    edit(input);
    await findByTestId(render(), 'btn-china-payment-add').props.onClick();
  };

  it('manual edit of the ruble amount: amountCny is not sent', async () => {
    await parseThenEdit('input-china-payment-rub', (el) => el.props.onChange({ target: { value: '2000', selectionStart: 4, setSelectionRange: () => {} } }));
    expect(h.savePayment).toHaveBeenCalledTimes(1);
    expect(h.savePayment.mock.calls[0][0].amountRub).toBe(2000);
    expect(h.savePayment.mock.calls[0][0]).not.toHaveProperty('amountCny');
  });

  it('control: without a manual edit the same message does send amountCny 100', async () => {
    await parseThenEdit('input-china-payment-rub', () => {});
    expect(h.savePayment.mock.calls[0][0]).toMatchObject({ amountCny: 100 });
  });
});
