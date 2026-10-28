// Plan item 100.2: access/session checks for the Cloud Run proxy (server.ts), ported from review probe
// b5-platform-server.ts (R-063, R-064, R-066). server.ts is imported in-process; global fetch is mocked
// (fake GAS + fake Ozon), real localhost requests pass through. No network.
// server.ts keeps no handle to app.listen(), so it cannot be closed: it lives until the vitest worker exits.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import http from 'node:http';

const PORT = 41000 + Math.floor(Math.random() * 2000);
const SECRET_TOKEN = 'SECRET-TOKEN-XYZ';

const logs: string[] = [];
const st = {
  loggedOut: new Set<string>(),
  getSkusCalls: 0,
  ozon: [] as { path: string; text: string }[],
};
const j = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status });

async function gas(body: any): Promise<Response> {
  const a = body.action;
  const t = String(body.sessionToken || '');
  if (a === 'login') return j({ status: 'success', data: { user: { username: 'Admin', role: 'admin' }, sessionToken: SECRET_TOKEN } });
  if (a === 'getOzonKeys') return j({ status: 'success', data: { ozonClientId: '1', ozonApiKey: 'k', cabinets: [{ name: 'MaxiStore', clientId: '1', apiKey: 'k' }] } });
  if (a === 'getGeminiKey') return j({ status: 'error', message: 'none' });
  if (st.loggedOut.has(t)) return j({ status: 'error', message: 'Invalid session' });
  const staff = t.startsWith('staff');
  switch (a) {
    case 'verifySession': return j({ status: 'success', data: { user: { username: staff ? 'staff' : 'admin', role: staff ? 'user' : 'admin' } } });
    case 'logout': st.loggedOut.add(t); return j({ status: 'success', data: {} });
    case 'resetUserPassword': return j({ status: 'error', message: 'x', tempPassword: 'P@ss-123' });
    case 'getSkus': st.getSkusCalls++; return j({ status: 'success', data: [{ sku: 'A', pcsPerBox: 10 }] });
    case 'getArchivedItems':
      return staff
        ? j({ status: 'error', message: 'Forbidden: admin rights required' })
        : j({ status: 'success', data: [{ archiveId: '1', passwordHash: 'H' }] });
    default: return j({ status: 'success', data: {} });
  }
}

function ozon(path: string, text: string): Response {
  st.ozon.push({ path, text });
  if (path === '/v2/draft/supply/create/status') return j({ status: 'SUCCESS', order_id: '900' });
  return j({});
}

function post(path: string, body: unknown): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      { host: '127.0.0.1', port: PORT, path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
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
const g = (token: string, action: string, extra: Record<string, unknown> = {}) => post('/api/gas', { action, sessionToken: token, ...extra });
const createSupply = (token: string) =>
  post('/api/ozon/supply/create', { sessionToken: token, cabinet: 'MaxiStore', draftId: 7, clusterIds: [1] });
const draftCreates = () => st.ozon.filter((o) => o.path === '/v2/draft/supply/create').length;

describe('server.ts access and session checks', () => {
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
    const capture = (...a: any[]) => { logs.push(a.map(String).join(' ')); };
    vi.spyOn(console, 'log').mockImplementation(capture);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await import('../server.ts');
    // wait until the server accepts connections
    for (let i = 0; i < 50; i++) {
      try { await post('/api/gas', { action: 'getGeminiKey', sessionToken: 'warmup' }); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
    }
  }, 20000);

  afterAll(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('R-066: login session token is not written to console logs, GASBODY diagnostics line is kept', async () => {
    logs.length = 0;
    const r = await post('/api/gas', { action: 'login', username: 'u', password: 'p' });
    expect(r.status).toBe(200);
    const leaking = logs.filter((l) => l.includes(SECRET_TOKEN));
    expect(leaking.map((l) => l.replace(SECRET_TOKEN, '<token>').slice(0, 160))).toEqual([]);
    expect(logs.some((l) => l.includes('GASBODY'))).toBe(true);
  });

  it('R-066: a response key containing "password" is logged as <скрыт> without its value', async () => {
    logs.length = 0;
    await g('admin-pw', 'resetUserPassword');
    const line = logs.find((l) => l.includes('GASBODY action=resetUserPassword'));
    expect(line).toBeDefined();
    expect(line).toContain('<скрыт>');
    expect(line).not.toContain('P@ss-123');
  });

  it('R-064: logged-out token is rejected with 401 by /api/ozon/supply/create and never reaches Ozon', async () => {
    expect((await g('admin-o', 'getSkus')).json.status).toBe('success');
    expect((await g('admin-o', 'logout')).json.status).toBe('success');
    const before = draftCreates();
    const r = await createSupply('admin-o');
    expect(r.status).toBe(401);
    expect(draftCreates() - before).toBe(0);
  });

  it('R-064: logged-out token does not get a cached getSkus answer', async () => {
    expect((await g('admin-c2', 'getSkus')).json.status).toBe('success');
    await g('admin-c2', 'logout');
    const after = await g('admin-c2', 'getSkus');
    expect(after.json.status).toBe('error');
  });

  it('R-063: cached admin getArchivedItems is not served to a plain staff token', async () => {
    await g('staff-a', 'getSkus');
    const adm = await g('admin-a', 'getArchivedItems');
    expect(adm.json.status).toBe('success');
    const usr = await g('staff-a', 'getArchivedItems');
    expect(usr.json.status).not.toBe('success');
  });

  it('control: same admin token reading getSkus twice within TTL hits fake GAS once (second from cache)', async () => {
    const before = st.getSkusCalls;
    const a = await g('admin-ctl', 'getSkus');
    const b = await g('admin-ctl', 'getSkus');
    expect(a.json.status).toBe('success');
    expect(b.json.status).toBe('success');
    expect(st.getSkusCalls - before).toBe(1);
  });
});
