// Plan item 100.5 part 2, finding R-049: /api/ozon/supply/create must be serialized in the proxy and the PROXY
// (not the browser) writes the journal row «Заявки Ozon» before the next create starts its availability check.
// Contract under test:
//   request : existing fields + dropOffName (string) + itemsJSON (string); clusters = clusterIds.join(','), status 'Создана'
//   journal : GAS action saveOzonSupplyRequest, data { cabinet, draftId, orderId, dropOffName, clusters, itemsJSON, status }
//   success : 200 { status:'success', data:{ orderId, draftId } }; journal failure after Ozon success -> still 200 success
//             with data.journalError (non-empty string)
//   shortage: 409 stage 'not_enough_stock' (no Ozon create, no journal row)
// In-process server.ts, global fetch mocked (fake GAS + fake Ozon). No network.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const PORT = 45000 + Math.floor(Math.random() * 2000);
const FREE = 10;

const st = {
  journal: [] as any[],
  journalFail: false,
  getRequestsCalls: 0,
  ozonCreates: [] as any[],
  ozonCreateHttpError: false,
  ozonStatus: 'SUCCESS' as string,
  events: [] as string[],
};
const j = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status });
const sleepMs = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function gas(body: any): Promise<Response> {
  const a = body.action;
  if (a === 'getOzonKeys') return j({ status: 'success', data: { ozonClientId: '1', ozonApiKey: 'k', cabinets: [{ name: 'MaxiStore', clientId: '1', apiKey: 'k' }] } });
  if (a === 'getGeminiKey') return j({ status: 'error', message: 'none' });
  switch (a) {
    case 'verifySession': return j({ status: 'success', data: { user: { username: 'admin', role: 'admin' } } });
    case 'checkSupplyAvailability': {
      // free stock = FREE minus what the journal already holds; the read happens BEFORE a delay (like a real GAS read)
      const reserved = st.journal.reduce((s, r) => s + 10, 0);
      const free = FREE - reserved;
      st.events.push('check');
      await sleepMs(60);
      const items = (body.data?.items || []).map((i: any) => ({ article: i.article, requested: i.quantity, available: free, enough: free >= i.quantity }));
      return j({ status: 'success', data: { items } });
    }
    case 'saveOzonSupplyRequest':
      await sleepMs(60);
      if (st.journalFail) return j({ status: 'error', message: 'journal write failed' });
      st.journal.push(body.data);
      st.events.push('journal');
      return j({ status: 'success', data: {} });
    case 'getOzonSupplyRequests': st.getRequestsCalls++; return j({ status: 'success', data: st.journal.slice() });
    default: return j({ status: 'success', data: {} });
  }
}

function ozon(p: string, body: any): Response {
  if (p === '/v2/draft/supply/create') {
    st.ozonCreates.push(body);
    st.events.push('ozon-create');
    if (st.ozonCreateHttpError) return j({ code: 3, message: 'bad draft' }, 400);
    return j({});
  }
  if (p === '/v2/draft/supply/create/status') {
    return j(st.ozonStatus === 'SUCCESS' ? { status: 'SUCCESS', order_id: 7000 + Number(body.draft_id) } : { status: st.ozonStatus, error_reasons: ['x'] });
  }
  return j({});
}

function post(p: string, body: unknown): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      { host: '127.0.0.1', port: PORT, path: p, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      (res) => {
        let s = '';
        res.on('data', (c) => (s += c));
        res.on('end', () => {
          try { resolve({ status: res.statusCode || 0, json: JSON.parse(s) }); } catch { resolve({ status: res.statusCode || 0, json: s }); }
        });
      },
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}
const ITEMS = [{ article: 'A', clusterId: 1, qty: 10 }];
const create = (draftId: number, extra: Record<string, unknown> = {}) =>
  post('/api/ozon/supply/create', {
    sessionToken: 'admin-c', cabinet: 'MaxiStore', draftId, clusterIds: [1, 2],
    availabilityCheck: [{ article: 'A', quantity: 10 }],
    dropOffName: 'Склад Тест', itemsJSON: JSON.stringify(ITEMS), ...extra,
  });
const reset = () => {
  st.journal = []; st.journalFail = false; st.ozonCreates = []; st.ozonCreateHttpError = false; st.ozonStatus = 'SUCCESS'; st.events = [];
};

describe('server.ts /api/ozon/supply/create serialization and server-side journal (R-049)', () => {
  beforeAll(async () => {
    process.env.NODE_ENV = 'production';
    process.env.PORT = String(PORT);
    process.env.GAS_URL = 'http://gas.invalid/exec';
    process.env.SERVER_SECRET = 'test-secret';
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', async (input: any, init?: any) => {
      const url = String(typeof input === 'string' ? input : input.url);
      if (url.startsWith('http://gas.invalid')) return gas(JSON.parse(init.body));
      if (url.startsWith('https://api-seller.ozon.ru')) return ozon(url.replace('https://api-seller.ozon.ru', ''), JSON.parse(init.body || '{}'));
      return realFetch(input, init);
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await import('../server.ts');
    for (let i = 0; i < 50; i++) {
      try { await post('/api/gas', { action: 'getGeminiKey', sessionToken: 'warmup' }); break; } catch { await sleepMs(100); }
    }
  }, 20000);

  afterAll(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('two parallel creates of 10 pcs over 10 free: one Ozon create, the other 409 not_enough_stock, one journal row', async () => {
    reset();
    const [a, b] = await Promise.all([create(101), create(102)]);
    const statuses = [a.status, b.status].sort();
    expect(st.ozonCreates.length).toBe(1);
    expect(statuses).toEqual([200, 409]);
    const loser = a.status === 409 ? a : b;
    expect(loser.json.stage).toBe('not_enough_stock');
    expect(st.journal.length).toBe(1);
  }, 20000);

  it('a successful create writes the journal row from the proxy before responding, with all fields', async () => {
    reset();
    const r = await create(201);
    expect(r.status).toBe(200);
    expect(r.json.status).toBe('success');
    expect(r.json.data.orderId).toBe('7201');
    expect(st.journal.length).toBe(1);
    expect(st.journal[0]).toMatchObject({
      cabinet: 'MaxiStore', orderId: '7201', dropOffName: 'Склад Тест',
      clusters: '1,2', itemsJSON: JSON.stringify(ITEMS), status: 'Создана',
    });
    expect(String(st.journal[0].draftId)).toBe('201');
    expect(st.events.indexOf('journal')).toBeGreaterThan(st.events.indexOf('ozon-create'));
  }, 20000);

  it('Ozon create failing (HTTP error or FAILED status) writes no journal row and does not block the next create', async () => {
    reset();
    st.ozonCreateHttpError = true;
    const e1 = await create(301);
    expect(e1.status).toBeGreaterThanOrEqual(400);
    st.ozonCreateHttpError = false;
    st.ozonStatus = 'FAILED';
    const e2 = await create(302);
    expect(e2.status).toBe(502);
    expect(st.journal.length).toBe(0);
    st.ozonStatus = 'SUCCESS';
    const ok = await Promise.race([create(303), sleepMs(8000).then(() => 'blocked' as const)]);
    expect(ok).not.toBe('blocked');
    expect((ok as any).status).toBe(200);
    expect(st.journal.length).toBe(1);
    expect(st.journal[0].draftId).toBe(303);
  }, 30000);

  it('a 409 not_enough_stock create releases the lock: the next create is answered, not blocked', async () => {
    reset();
    const first = await create(601);
    expect(first.status).toBe(200);
    const short = await create(602);
    expect(short.status).toBe(409);
    expect(short.json.stage).toBe('not_enough_stock');
    const next = await Promise.race([create(603), sleepMs(8000).then(() => 'blocked' as const)]);
    expect(next).not.toBe('blocked');
    expect((next as any).status).toBe(409);
    expect(st.ozonCreates.length).toBe(1);
  }, 30000);

  it('journal write failing after Ozon success still answers success with orderId and data.journalError', async () => {
    reset();
    st.journalFail = true;
    const r = await create(401);
    expect(r.status).toBe(200);
    expect(r.json.status).toBe('success');
    expect(r.json.data.orderId).toBe('7401');
    expect(typeof r.json.data.journalError).toBe('string');
    expect(r.json.data.journalError.length).toBeGreaterThan(0);
  }, 20000);

  it('OzonSupplyModal.tsx no longer calls saveOzonSupplyRequest and sends dropOffName and itemsJSON in the create body', () => {
    const src = fs.readFileSync(path.resolve(__dirname, 'components', 'OzonSupplyModal.tsx'), 'utf8');
    expect(src).not.toMatch(/saveOzonSupplyRequest/);
    const at = src.indexOf('/api/ozon/supply/create');
    expect(at).toBeGreaterThan(-1);
    const around = src.slice(at, at + 2500);
    expect(around).toMatch(/dropOffName/);
    expect(around).toMatch(/itemsJSON/);
    expect(src).toMatch(/journalError/);
  });

  it('getOzonSupplyRequests via /api/gas after the proxy journal write is not served from the response cache', async () => {
    reset();
    const g = () => post('/api/gas', { action: 'getOzonSupplyRequests', sessionToken: 'admin-c' });
    const w1 = await g();
    const w2 = await g();
    const cached = st.getRequestsCalls; // control: if reads are never cached this check proves nothing
    const callsBeforeCtl = cached;
    expect(w1.json.data.length).toBe(0);
    expect(w2.json.data.length).toBe(0);
    expect(callsBeforeCtl).toBeGreaterThan(0);
    const r = await create(501);
    expect(r.status).toBe(200);
    const after = await g();
    expect(after.json.data.length).toBe(1);
  }, 20000);
});
