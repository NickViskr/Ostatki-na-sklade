import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWarehouseStore } from './useWarehouseStore';

// Item 97 ticket 06 parts C and E (written test-first). Client<->server contract: every field sits under `data`.
describe('week packaging and invoice correction store actions', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  function respond(json: unknown) {
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify(json) });
  }
  function sent(i = 0) {
    return { url: fetchMock.mock.calls[i][0], body: JSON.parse(fetchMock.mock.calls[i][1].body) };
  }
  // the actions are new: reach them through an untyped view so the file compiles before they exist
  const store = () => useWarehouseStore.getState() as unknown as Record<string, (...a: unknown[]) => Promise<any>>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    useWarehouseStore.setState({ sessionToken: 'tok', devMode: false } as never);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('getWeekPackaging posts action getWeekPackaging with data.week and returns data', async () => {
    const data = { week: '2026-W44', operations: [], lastPrices: {} };
    respond({ status: 'success', data });
    const result = await store().getWeekPackaging('2026-W44');
    const { url, body } = sent();
    expect(url).toBe('/api/gas');
    expect(body.action).toBe('getWeekPackaging');
    expect(body.sessionToken).toBe('tok');
    expect(body.data).toEqual({ week: '2026-W44' });
    expect('week' in body).toBe(false);
    expect(result).toEqual(data);
  });

  it('saveWeekPackaging posts the whole payload under data unchanged and returns the server answer', async () => {
    const payload = {
      week: '2026-W44',
      prices: [{ article: 'A', unit: '6,50' }, { article: 'B', unit: '12' }],
      overrides: [{ opId: 'man-1', article: 'A', unit: '7' }]
    };
    respond({ status: 'success', data: { saved: true } });
    const result = await store().saveWeekPackaging(payload);
    const { body } = sent();
    expect(body.action).toBe('saveWeekPackaging');
    expect(body.sessionToken).toBe('tok');
    expect(body.data).toEqual(payload);
    for (const k of ['week', 'prices', 'overrides']) expect(k in body).toBe(false);
    expect(result.status).toBe('success');
    expect(result.data).toEqual({ saved: true });
  });

  it('setInvoiceLinePackaging posts invoiceId, lineNo and packaging under data', async () => {
    const payload = { invoiceId: 'INV-1', lineNo: 2, packaging: true };
    respond({ status: 'success', data: {} });
    await store().setInvoiceLinePackaging(payload);
    const { body } = sent();
    expect(body.action).toBe('setInvoiceLinePackaging');
    expect(body.sessionToken).toBe('tok');
    expect(body.data).toEqual(payload);
    for (const k of ['invoiceId', 'lineNo', 'packaging']) expect(k in body).toBe(false);
  });

  it('saveContractorInvoice passes editId and per-line packaging through unchanged under data', async () => {
    const payload = {
      week: '2026-W44', fileWeek: '2026-W44', fileId: '',
      header: { number: '0046', date: '02.11.2026', supplier: 'ООО Ромашка', buyer: '', total: '150,00', vat: '', itemCount: '2' },
      lines: [
        { name: 'Услуга', qty: '1', unit: 'шт', price: '100,00', sum: '100,00', packaging: true },
        { name: 'Хранение', qty: '1', unit: 'шт', price: '50,00', sum: '50,00', packaging: false }
      ],
      editId: 'INV-1'
    };
    respond({ status: 'success', data: { saved: true, id: 'INV-1' } });
    await useWarehouseStore.getState().saveContractorInvoice(payload as never);
    const { body } = sent();
    expect(body.action).toBe('saveContractorInvoice');
    expect(body.data.editId).toBe('INV-1');
    expect(body.data.lines.map((l: { packaging?: boolean }) => l.packaging)).toEqual([true, false]);
    expect(body.data).toEqual(payload);
    expect('editId' in body).toBe(false);
  });
});
