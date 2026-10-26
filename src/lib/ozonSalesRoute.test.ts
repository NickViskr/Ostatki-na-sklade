import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../../server.ts', import.meta.url), 'utf8');
const routeSource = source.slice(source.indexOf('  function getMskWeekMonday('), source.indexOf('  // API Endpoint for Gemini Invoice Parsing'));
const javascript = ts.transpileModule(routeSource, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const NOW = '2026-10-26T17:35:06.274Z';
const posting = (id = 'p1', overrides: Record<string, unknown> = {}) => ({
  posting_number: id, created_at: '2026-10-25T21:00:00.000Z', status: 'delivered',
  products: [{ offer_id: 'article', quantity: 2, price: { amount: '100', currency: 'RUB' } }],
  analytics_data: { warehouse_id: 1 }, financial_data: { cluster_to: 'Buyer' }, ...overrides,
});
const page = (postings: unknown[] = [], cursor = '', has_next = false) => ({ postings, cursor, has_next });

async function run(replies: Record<string, unknown[]>, body: Record<string, unknown> = {}) {
  let handler: any;
  const requests: any[] = [];
  const saves: any[] = [];
  const response: any = { code: 200, status(code: number) { this.code = code; return this; }, json(value: unknown) { this.body = value; return this; } };
  class FixedDate extends Date { constructor(value?: any) { super(value === undefined ? NOW : value); } }
  vm.runInNewContext(javascript, {
    app: { post: (_path: string, fn: any) => { handler = fn; } }, Date: FixedDate,
    console: { error() {}, warn() {} }, process: { env: { GAS_URL: 'https://gas.invalid' } },
    verifyGasSession: async () => true,
    fetchOzonKeys: async () => ({ cabinets: Object.keys(replies).map(name => ({ name, clientId: name, apiKey: 'test' })) }),
    loadWarehouseClusterMap: async () => new Map([[1, 'Source'], [2, 'Buyer']]),
    fetchOzonApi: async (path: string, keys: any, payload: any) => {
      requests.push({ path, cabinet: keys.ozonClientId, payload });
      const result = replies[keys.ozonClientId].shift();
      if (result instanceof Error) throw result;
      if (result === undefined) throw new Error('Unexpected additional request');
      return result;
    },
    fetch: async (_url: string, init: any) => {
      saves.push(JSON.parse(init.body));
      return { text: async () => JSON.stringify({ status: 'success', data: { savedRows: saves.at(-1).data.rows.length } }) };
    },
  });
  await handler({ body: { sessionToken: 'test-session', devMode: true, ...body } }, response);
  return { requests, saves, response };
}

describe('Ozon sales route v3', () => {
  it('collects short intermediate pages and saves MSK weeks and buyer clusters', async () => {
    const result = await run({ A: [page([posting()], 'next', true), page([posting('p2')])] });
    expect(result.requests.map(r => r.path)).toEqual(['/v3/posting/fbo/list', '/v3/posting/fbo/list']);
    expect(result.requests.map(r => r.payload.cursor)).toEqual(['', 'next']);
    expect(result.requests[0].payload).toEqual({ cursor: '', sort_dir: 'ASC', filter: { since: '2026-10-11T21:00:00.000Z', to: NOW }, limit: 100, with: { analytics_data: true, financial_data: true } });
    expect(result.saves).toHaveLength(1);
    expect(result.saves[0]).toMatchObject({ action: 'saveOzonSales', devMode: true, data: { mode: 'recent', okCabinets: ['A'], replacedWeeks: ['2026-10-26', '2026-10-19', '2026-10-12'], rows: [{ cabinet: 'A', week: '2026-10-26', offerId: 'article', cluster: 'Buyer', qty: 4 }] } });
  });
});

describe('sales replacement safety', () => {
  it('excludes cancellations and keeps cabinet quantities separate', async () => {
    const r = await run({ A: [page([posting(), posting('cancel', { status: 'cancelled' })])], B: [page([posting()])] }, { devMode: false });
    expect(r.saves[0]).not.toHaveProperty('devMode');
    expect(r.saves[0].data.rows.map((row: any) => [row.cabinet, row.qty])).toEqual([['A', 2], ['B', 2]]);
  });
  it('accepts a genuinely empty final page and replaces the selected weeks', async () => {
    const r = await run({ A: [page()] });
    expect(r.saves[0].data).toMatchObject({ okCabinets: ['A'], rows: [], replacedWeeks: ['2026-10-26', '2026-10-19', '2026-10-12'] });
  });
  it.each([{ result: [] }, { postings: [], cursor: '' }, { postings: null, cursor: '', has_next: false }])('rejects malformed envelopes without saving: %j', async reply => {
    const r = await run({ A: [reply] });
    expect(r.response.code).toBe(502);
    expect(r.saves).toEqual([]);
  });
  it.each(['', 'loop'])('rejects missing or repeated continuation cursors: %s', async cursor => {
    const r = await run({ A: [page([posting()], cursor, true), page([posting('p2')], cursor, true)] });
    expect(r.response.code).toBe(502);
    expect(r.saves).toEqual([]);
  });
  it('keeps a failed cabinet out of replacement after a later page fails', async () => {
    const r = await run({ A: [page([posting()], 'next', true), new Error('Ozon unavailable')], B: [page([posting()])] });
    expect(r.saves[0].data.okCabinets).toEqual(['B']);
    expect(r.saves[0].data.rows.map((row: any) => row.cabinet)).toEqual(['B']);
    expect(r.response.body.data.cabinets[0].ok).toBe(false);
  });
  it.each([
    { created_at: 'invalid' }, { created_at: '2020-01-01T00:00:00Z' }, { created_at: '2027-01-01T00:00:00Z' }, { products: null }, { posting_number: '' }, { status: '' },
    { products: [{ offer_id: '', quantity: 2 }] }, { products: [{ offer_id: 'article', quantity: -1 }] },
  ])('refuses corrupt posting fields without replacing sales: %j', async fields => {
    const r = await run({ A: [page([posting('bad', fields)])] });
    expect(r.response.code).toBe(502);
    expect(r.saves).toEqual([]);
  });
  it('resets cursors per full-mode window and counts a shared boundary posting once', async () => {
    const boundary = posting('boundary', { created_at: '2025-12-06T17:35:06.274Z' });
    const r = await run({ A: [page([boundary]), page([boundary]), ...Array.from({ length: 5 }, () => page())] }, { mode: 'full' });
    expect(r.requests).toHaveLength(7);
    expect(r.requests.every(request => request.payload.cursor === '')).toBe(true);
    expect(r.requests[0].payload.filter.to).toBe(r.requests[1].payload.filter.since);
    expect(r.saves[0].data.rows).toHaveLength(1);
    expect(r.saves[0].data.rows[0].qty).toBe(2);
    expect(r.saves[0].data.replacedWeeks).toEqual([]);
  });
  it('rejects duplicate postings within a window instead of double counting', async () => {
    const r = await run({ A: [page([posting(), posting()])] });
    expect(r.response.code).toBe(502);
    expect(r.saves).toEqual([]);
  });
  it('does not save a cabinet when its later full-mode window fails', async () => {
    const r = await run({ A: [page([posting('early', { created_at: '2025-11-01T00:00:00Z' })]), new Error('later window failed')] }, { mode: 'full' });
    expect(r.saves).toEqual([]);
    expect(r.requests).toHaveLength(2);
  });
});

it('rejects a repeated boundary posting within the second window', async () => {
  const boundary = posting('boundary', { created_at: '2025-12-06T17:35:06.274Z' });
  const r = await run({ A: [page([boundary]), page([boundary, boundary]), ...Array.from({ length: 5 }, () => page())] }, { mode: 'full' });
  expect(r.response.code).toBe(502);
  expect(r.saves).toEqual([]);
});
