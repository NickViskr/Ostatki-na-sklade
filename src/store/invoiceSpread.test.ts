import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWarehouseStore } from './useWarehouseStore';

// Item 97 ticket 07 part C (written test-first). Client<->server contract: every field sits under `data`.
describe('invoice spread store actions', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  function respond(json: unknown) {
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify(json) });
  }
  function sent(i = 0) {
    return { url: fetchMock.mock.calls[i][0], body: JSON.parse(fetchMock.mock.calls[i][1].body) };
  }
  // the actions are new: reach them through an untyped view so the file compiles before they exist
  const store = () => useWarehouseStore.getState() as unknown as Record<string, (...a: unknown[]) => Promise<any>>;

  const oldTx = [{ id: 'old-1' }];
  const payload = {
    week: '2026-W44',
    invoiceId: 'INV-1',
    lines: [{ n: 1, qty: '10' }, { n: 3, qty: '2,5' }],
    opIds: ['op-1', 'op-2']
  };

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    useWarehouseStore.setState({ sessionToken: 'tok', devMode: false, transactions: oldTx } as never);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('getInvoiceSpread posts action getInvoiceSpread with data.week and returns data', async () => {
    const data = { operations: [], applied: [] };
    respond({ status: 'success', data });
    const result = await store().getInvoiceSpread('2026-W44');
    const { url, body } = sent();
    expect(url).toBe('/api/gas');
    expect(body.action).toBe('getInvoiceSpread');
    expect(body.sessionToken).toBe('tok');
    expect(body.data).toEqual({ week: '2026-W44' });
    expect('week' in body).toBe(false);
    expect(result).toEqual(data);
  });

  it('applyInvoiceSpread posts the whole payload under data with qty as text and opIds', async () => {
    respond({ status: 'success', data: { changedRows: 0, newTransactions: [] } });
    await store().applyInvoiceSpread(payload);
    const { body } = sent();
    expect(body.action).toBe('applyInvoiceSpread');
    expect(body.sessionToken).toBe('tok');
    expect(body.data).toEqual(payload);
    expect(body.data.lines.map((l: { qty: unknown }) => typeof l.qty)).toEqual(['string', 'string']);
    for (const k of ['week', 'invoiceId', 'lines', 'opIds']) expect(k in body).toBe(false);
  });

  it('applyInvoiceSpread on success replaces transactions with newTransactions and returns the response', async () => {
    const newTx = [{ id: 'new-1' }, { id: 'new-2' }];
    const response = { status: 'success', data: { changedRows: 2, journalAppended: 1, newTransactions: newTx } };
    respond(response);
    const result = await store().applyInvoiceSpread(payload);
    expect(result).toEqual(response);
    expect(useWarehouseStore.getState().transactions).toEqual(newTx);
  });

  it('applyInvoiceSpread error response is returned and transactions stay untouched', async () => {
    const response = { status: 'error', message: 'Счёт не найден', data: { newTransactions: [{ id: 'x' }] } };
    respond(response);
    const result = await store().applyInvoiceSpread(payload);
    expect(result.status).toBe('error');
    expect(result.message).toBe('Счёт не найден');
    expect(useWarehouseStore.getState().transactions).toEqual(oldTx);
  });
});
