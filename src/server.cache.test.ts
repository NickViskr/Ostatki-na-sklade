// Plan item 100.3 part 2: proxy cache consistency tests (server.ts), test-first, ported from review probes
// R-056 and R-058 (b5-platform-server.ts). server.ts is imported in-process; global fetch is mocked
// (fake GAS + fake Ozon), real localhost requests pass through. No network.
// server.ts keeps no handle to app.listen(), so it cannot be closed: it lives until the vitest worker exits.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import http from 'node:http';

const PORT = 43000 + Math.floor(Math.random() * 2000);

const st = {
  stock: 10,
  getStockCalls: 0,
  readGate: null as null | Promise<void>,
  commitGate: null as null | Promise<void>,
  saveExtGate: null as null | Promise<void>,
  extShipments: [] as any[],
  getExtCalls: 0,
  clusters: [] as any[],
  getClustersCalls: 0,
};
const j = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status });

async function gas(body: any): Promise<Response> {
  const a = body.action;
  if (a === 'getOzonKeys') return j({ status: 'success', data: { ozonClientId: '1', ozonApiKey: 'k', cabinets: [{ name: 'MaxiStore', clientId: '1', apiKey: 'k' }] } });
  if (a === 'getGeminiKey') return j({ status: 'error', message: 'none' });
  switch (a) {
    case 'verifySession': return j({ status: 'success', data: { user: { username: 'admin', role: 'admin' } } });
    case 'getStock': {
      st.getStockCalls++;
      const snap = st.stock; // the value is read BEFORE any waiting, like a lock-free read
      if (st.readGate) await st.readGate;
      return j({ status: 'success', data: [{ article: 'A', quantity: snap }] });
    }
    case 'commit':
      if (st.commitGate) await st.commitGate;
      st.stock = 15;
      return j({ status: 'success', data: {} });
    case 'getExternalShipments': st.getExtCalls++; return j({ status: 'success', data: st.extShipments.slice() });
    case 'saveExternalShipments':
      if (st.saveExtGate) await st.saveExtGate;
      st.extShipments.push({ postingId: '1', orderId: '1' });
      return j({ status: 'success', data: { addedCount: 1, updatedCount: 0 } });
    case 'getOzonClusters': st.getClustersCalls++; return j({ status: 'success', data: st.clusters.slice() });
    case 'saveOzonClusters':
      st.clusters = body.data.clusters;
      return j({ status: 'success', data: { savedRows: st.clusters.length } });
    default: return j({ status: 'success', data: {} });
  }
}

function ozon(path: string): Response {
  if (path === '/v1/cluster/list') return j({ clusters: [{ macrolocal_cluster_id: 1, name: 'Moscow' }] });
  if (path === '/v3/supply-order/list') return j({ order_ids: [], last_id: '' });
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
const sleepMs = (ms: number) => new Promise((r) => setTimeout(r, ms));
const gate = () => {
  let release: () => void = () => {};
  const p = new Promise<void>((r) => (release = r));
  return { p, release };
};
const qty = (r: { json: any }) => r.json?.data?.[0]?.quantity;

describe('server.ts GAS response cache consistency', () => {
  beforeAll(async () => {
    process.env.NODE_ENV = 'production';
    process.env.PORT = String(PORT);
    process.env.GAS_URL = 'http://gas.invalid/exec';
    process.env.SERVER_SECRET = 'test-secret';

    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', async (input: any, init?: any) => {
      const url = String(typeof input === 'string' ? input : input.url);
      if (url.startsWith('http://gas.invalid')) return gas(JSON.parse(init.body));
      if (url.startsWith('https://api-seller.ozon.ru')) return ozon(url.replace('https://api-seller.ozon.ru', ''));
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

  it('control: the same read twice within TTL reaches GAS once (second answer from the cache)', async () => {
    st.readGate = null;
    st.commitGate = null;
    const before = st.getStockCalls;
    const a = await g('admin-ctl', 'getStock', { probe: 'ctl' });
    const b = await g('admin-ctl', 'getStock', { probe: 'ctl' });
    expect(a.json.status).toBe('success');
    expect(b.json.status).toBe('success');
    expect(st.getStockCalls - before).toBe(1);
  });

  it('R-056: a read that started before a write and answers after it must not refill the cache with the old value', async () => {
    st.commitGate = null;
    st.stock = 10;
    await g('admin-r1', 'getSkus'); // registers the session token in the proxy cache
    const readGate = gate();
    st.readGate = readGate.p;
    const oldRead = g('admin-r1', 'getStock', { probe: 'r056a' }); // snapshot 10, held at GAS
    await sleepMs(300);
    st.readGate = null;
    const w = await g('admin-r1', 'commit', { opId: 'op-56a', data: [] }); // write completes: backend 15
    expect(w.json.status).toBe('success');
    readGate.release();
    expect(qty(await oldRead)).toBe(10); // the in-flight read legitimately answers with its own snapshot
    const fresh = await g('admin-r1', 'getStock', { probe: 'r056a' });
    expect(st.stock).toBe(15);
    expect(qty(fresh)).toBe(15);
  });

  it('R-056 variant: a read that started after the write was sent but answered before the write finished must not leave the old value cached', async () => {
    st.readGate = null;
    st.stock = 10;
    await g('admin-r2', 'getSkus');
    const commitGate = gate();
    st.commitGate = commitGate.p;
    const write = g('admin-r2', 'commit', { opId: 'op-56b', data: [] }); // sent, held inside GAS
    await sleepMs(300);
    const lockFreeRead = await g('admin-r2', 'getStock', { probe: 'r056b' }); // old state 10, answered at once
    expect(qty(lockFreeRead)).toBe(10);
    commitGate.release();
    expect((await write).json.status).toBe('success');
    st.commitGate = null;
    const fresh = await g('admin-r2', 'getStock', { probe: 'r056b' });
    expect(st.stock).toBe(15);
    expect(qty(fresh)).toBe(15);
  });

  it('R-058: /api/ozon/check saving external shipments must invalidate the cached getExternalShipments read', async () => {
    st.readGate = null;
    st.commitGate = null;
    st.extShipments = [];
    const warm = await g('admin-k', 'getExternalShipments');
    expect(warm.json.data).toHaveLength(0);
    const chk = await post('/api/ozon/check', { sessionToken: 'admin-k' });
    expect(chk.json.status).toBe('success');
    expect(st.extShipments).toHaveLength(1); // the backend really got the row
    const callsBefore = st.getExtCalls;
    const after = await g('admin-k', 'getExternalShipments');
    expect(st.getExtCalls - callsBefore).toBe(1); // reached GAS, not served from the cache
    expect(after.json.data).toHaveLength(1);
  });

  it('R-058: /api/ozon/clusters saving clusters must invalidate the cached getOzonClusters read', async () => {
    st.clusters = [];
    const warm = await g('admin-cl', 'getOzonClusters');
    expect(warm.json.data).toHaveLength(0);
    const r = await post('/api/ozon/clusters', { sessionToken: 'admin-cl' });
    expect(r.json.status).toBe('success');
    expect(st.clusters.length).toBeGreaterThan(0); // the backend really got the clusters
    const callsBefore = st.getClustersCalls;
    const after = await g('admin-cl', 'getOzonClusters');
    expect(st.getClustersCalls - callsBefore).toBe(1);
    expect(after.json.data.length).toBeGreaterThan(0);
  });

  // Kills the mutation that drops the post-write invalidation of the direct ozon route: /api/ozon/check also
  // sends another write (applyCancelledOzonOrders) that wipes the cache BEFORE the save, so only a read cached
  // while the save is still in flight can show whether the save invalidates after it finishes.
  it('R-058: a getExternalShipments read cached while /api/ozon/check is still saving must not outlive the save', async () => {
    st.extShipments = [];
    st.saveExtGate = null;
    await g('admin-k2', 'getSkus');
    const saveGate = gate();
    st.saveExtGate = saveGate.p;
    const chk = post('/api/ozon/check', { sessionToken: 'admin-k2' });
    await sleepMs(500);
    const during = await g('admin-k2', 'getExternalShipments'); // old rows, cached while the save is held
    expect(during.json.data).toHaveLength(0);
    saveGate.release();
    expect((await chk).json.status).toBe('success');
    st.saveExtGate = null;
    expect(st.extShipments).toHaveLength(1);
    const callsBefore = st.getExtCalls;
    const after = await g('admin-k2', 'getExternalShipments');
    expect(st.getExtCalls - callsBefore).toBe(1);
    expect(after.json.data).toHaveLength(1);
  });
});
