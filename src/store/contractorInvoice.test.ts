import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWarehouseStore } from './useWarehouseStore';

// Item 97 ticket 05 part D (written test-first). Client<->server contract: every field sits under `data`,
// never at the top level (the d269c2b lesson); the read route is a separate proxy endpoint with a flat body.
const PAYLOAD = {
  week: '2026-W44', fileWeek: '2026-W45', fileId: 'f1',
  header: { number: '0045', date: '02.11.2026', supplier: 'ООО Ромашка', buyer: '', total: '9 022,74', vat: '', itemCount: '1' },
  lines: [{ name: 'Услуга', qty: '1', unit: 'шт', price: '9 022,74', sum: '9 022,74' }],
  replace: true, addAnother: false
};

describe('contractor invoice store actions', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  function respond(json: unknown, ok = true, status = 200) {
    fetchMock.mockResolvedValue({ ok, status, text: async () => JSON.stringify(json) });
  }
  function sent(i = 0) {
    return { url: fetchMock.mock.calls[i][0], body: JSON.parse(fetchMock.mock.calls[i][1].body) };
  }

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    useWarehouseStore.setState({ sessionToken: 'tok', devMode: false } as never);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('saveContractorInvoice posts action saveContractorInvoice with the whole payload under data and returns the server answer', async () => {
    respond({ status: 'success', data: { saved: true, id: 'INV-1' } });
    const result = await useWarehouseStore.getState().saveContractorInvoice(PAYLOAD);
    const { url, body } = sent();
    expect(url).toBe('/api/gas');
    expect(body.action).toBe('saveContractorInvoice');
    expect(body.sessionToken).toBe('tok');
    expect(body.data).toEqual(PAYLOAD);
    for (const k of ['week', 'fileId', 'header', 'lines', 'replace']) expect(k in body).toBe(false);
    expect(result.status).toBe('success');
    expect(result.data).toEqual({ saved: true, id: 'INV-1' });
  });

  it('saveContractorInvoice sends every line toSupply flag unchanged under data.lines (false, true and absent)', async () => {
    respond({ status: 'success', data: { saved: true, id: 'INV-2' } });
    const lines = [
      { name: 'Поставка', qty: '1', unit: 'шт', price: '100,00', sum: '100,00', toSupply: true },
      { name: 'Хранение', qty: '1', unit: 'шт', price: '50,00', sum: '50,00', toSupply: false },
      { name: 'Возврат', qty: '1', unit: 'шт', price: '25,00', sum: '25,00' }
    ];
    await useWarehouseStore.getState().saveContractorInvoice({ ...PAYLOAD, lines } as never);
    const { body } = sent();
    expect(body.data.lines.map((l: { toSupply?: boolean }) => l.toSupply)).toEqual([true, false, undefined]);
    expect('toSupply' in body.data.lines[2]).toBe(false);
    expect(body.data.lines[1]).toEqual(lines[1]);
  });

  it('listContractorInvoices posts data.week and returns the array from data', async () => {
    const rows = [{ id: 'INV-1', number: '0045', lines: [] }];
    respond({ status: 'success', data: rows });
    const result = await useWarehouseStore.getState().listContractorInvoices('2026-W44');
    const { url, body } = sent();
    expect(url).toBe('/api/gas');
    expect(body.action).toBe('listContractorInvoices');
    expect(body.data).toEqual({ week: '2026-W44' });
    expect('week' in body).toBe(false);
    expect(result).toEqual(rows);
  });

  it('deleteContractorInvoice posts data.id', async () => {
    respond({ status: 'success', data: {} });
    await useWarehouseStore.getState().deleteContractorInvoice('INV-1');
    const { url, body } = sent();
    expect(url).toBe('/api/gas');
    expect(body.action).toBe('deleteContractorInvoice');
    expect(body.sessionToken).toBe('tok');
    expect(body.data).toEqual({ id: 'INV-1' });
    expect('id' in body).toBe(false);
  });

  it('readContractorInvoice posts to /api/contractor-invoice/read with a flat body and returns data', async () => {
    const raw = { header: { number: '0045' }, lines: [] };
    respond({ status: 'success', data: raw });
    const result = await useWarehouseStore.getState().readContractorInvoice('2026-W44', 'f1');
    const { url, body } = sent();
    expect(url).toBe('/api/contractor-invoice/read');
    expect(body).toEqual({ sessionToken: 'tok', devMode: false, week: '2026-W44', fileId: 'f1' });
    expect(result).toEqual(raw);
  });
});
