// Plan item 101 ticket 01: safety and visibility around /api/ozon/supply/docs.
// server.ts is imported in-process (pattern of server.access.test.ts); global fetch is mocked
// (fake GAS + fake Ozon), real localhost requests pass through. No network.
// The fake Ozon never returns a full order, so every build ends early with an HTTP error;
// that is enough to exercise the in-flight guard and its release in `finally`.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const PORT = 43500 + Math.floor(Math.random() * 1500);
const logs: string[] = [];
const j = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status });

// Scripted behaviour of the fake POST /v3/supply-order/get: each call takes the next step
// (a plain Response, or a function returning a promise to hold the call); the default is 500.
const orderGetCalls: string[] = [];
let orderGetSteps: Array<() => Response | Promise<Response>> = [];
const fail500 = () => j({ message: 'boom' }, 500);

async function gas(body: any): Promise<Response> {
  switch (body.action) {
    case 'getOzonKeys': return j({ status: 'success', data: { ozonClientId: '1', ozonApiKey: 'k', cabinets: [{ name: 'MaxiStore', clientId: '1', apiKey: 'k' }] } });
    case 'getGeminiKey': return j({ status: 'error', message: 'none' });
    case 'verifySession': return j({ status: 'success', data: { user: { username: 'admin', role: 'admin' } } });
    default: return j({ status: 'success', data: {} });
  }
}

function ozon(p: string, text: string): Response | Promise<Response> {
  if (p === '/v3/supply-order/get') {
    orderGetCalls.push(text);
    return (orderGetSteps.shift() || fail500)();
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
const docs = (orderId: string) => post('/api/ozon/supply/docs', { sessionToken: 'admin-t', cabinet: 'MaxiStore', orderId });
const waitUntil = async (cond: () => boolean) => {
  for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 20));
  expect(cond()).toBe(true);
};
function deferred() {
  let release!: () => void;
  const p = new Promise<void>((r) => { release = r; });
  return { p, release };
}

describe('server.ts /api/ozon/supply/docs safety and Ozon 429 visibility', () => {
  beforeAll(async () => {
    process.env.NODE_ENV = 'production';
    process.env.PORT = String(PORT);
    process.env.GAS_URL = 'http://gas.invalid/exec';
    process.env.SERVER_SECRET = 'test-secret';

    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', async (input: any, init?: any) => {
      const url = String(typeof input === 'string' ? input : input.url);
      if (url.startsWith('http://gas.invalid')) return gas(JSON.parse(init.body));
      if (url.startsWith('https://api-seller.ozon.ru')) return ozon(url.replace('https://api-seller.ozon.ru', ''), String(init?.body || ''));
      return realFetch(input, init);
    });
    vi.spyOn(console, 'log').mockImplementation((...a: any[]) => { logs.push(a.map(String).join(' ')); });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await import('../server.ts');
    for (let i = 0; i < 50; i++) {
      try { await post('/api/gas', { action: 'getGeminiKey', sessionToken: 'warmup' }); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
    }
  }, 20000);

  afterAll(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('a 429 from Ozon is logged as OZON429 with endpoint and attempt, then the retry goes through', async () => {
    logs.length = 0;
    orderGetCalls.length = 0;
    orderGetSteps = [() => j({}, 429), fail500];
    const r = await docs('429-order');
    expect(orderGetCalls.length).toBe(2); // the 429 was retried
    expect(logs.filter((l) => l.startsWith('OZON429'))).toEqual(['OZON429 endpoint=/v3/supply-order/get attempt=1/5']);
    // the final answer comes from the retry (500 "boom"), not from the rate-limit error
    expect(r.status).toBe(500);
    expect(r.json.message).toBe('boom');
  }, 15000);

  it('a second docs call for the same order while the first runs gets 409 in_progress, and a new call is accepted after the first ends', async () => {
    orderGetCalls.length = 0;
    const hold = deferred();
    orderGetSteps = [async () => { await hold.p; return fail500(); }];
    const first = docs('held-order');
    await waitUntil(() => orderGetCalls.length === 1);

    const second = await docs('held-order');
    expect(second.status).toBe(409);
    expect(second.json.stage).toBe('in_progress');
    expect(orderGetCalls.length).toBe(1); // the rejected call never reached Ozon

    hold.release();
    expect((await first).status).toBe(500);

    const third = await docs('held-order');
    expect(third.status).not.toBe(409);
    expect(orderGetCalls.length).toBe(2);
  }, 15000);

  it('the guard is released after an error inside the build: the next call for the same order is not 409', async () => {
    orderGetSteps = [fail500, fail500];
    const a = await docs('err-order');
    expect(a.status).toBe(500);
    const b = await docs('err-order');
    expect(b.status).toBe(500);
    expect(b.json.stage).not.toBe('in_progress');
  }, 15000);

  it('a different order is not blocked while another order build is held', async () => {
    orderGetCalls.length = 0;
    const hold = deferred();
    orderGetSteps = [async () => { await hold.p; return fail500(); }, fail500];
    const first = docs('order-A');
    await waitUntil(() => orderGetCalls.length === 1);

    const other = await docs('order-B');
    expect(other.status).not.toBe(409);
    expect(orderGetCalls.length).toBe(2);

    hold.release();
    await first;
  }, 15000);

  it('browser timeouts for the docs build are 300 s in both components', () => {
    const read = (f: string) => fs.readFileSync(path.resolve(__dirname, 'components', f), 'utf8');
    expect(read('OzonSuppliesTab.tsx')).toMatch(/const DOCS_BUILD_TIMEOUT_SEC = 300;/);
    expect(read('OzonSupplyModal.tsx')).toMatch(/const FINALIZE_TIMEOUT_SEC = 300;/);
  });
});
