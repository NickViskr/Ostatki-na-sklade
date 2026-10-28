// Plan item 101 ticket 01: safety and visibility around /api/ozon/supply/docs.
// server.ts is imported in-process (pattern of server.access.test.ts); global fetch is mocked
// (fake GAS + fake Ozon), real localhost requests pass through. No network.
// The fake Ozon never returns a full order, so every build ends early with an HTTP error;
// that is enough to exercise the in-flight guard and its release in `finally`.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

// Item 101 ticket 03: the 20 s pause before the label retry is shortened to 5 ms by wrapping setTimeout
// (no production change); retryPauses counts how many times the pause was requested.
const realSetTimeout = globalThis.setTimeout;
let retryPauses = 0;
beforeAll(() => {
  (globalThis as any).setTimeout = ((fn: any, ms?: number, ...a: any[]) => {
    if (ms === 20000) { retryPauses++; return realSetTimeout(fn, 5, ...a); }
    return realSetTimeout(fn, ms, ...a);
  }) as any;
});
afterAll(() => { (globalThis as any).setTimeout = realSetTimeout; });

const PORT = 43500 + Math.floor(Math.random() * 1500);
const logs: string[] = [];
const j = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status });

// Scripted behaviour of the fake POST /v3/supply-order/get: each call takes the next step
// (a plain Response, or a function returning a promise to hold the call); the default is 500.
const orderGetCalls: string[] = [];
let orderGetSteps: Array<() => Response | Promise<Response>> = [];
const fail500 = () => j({ message: 'boom' }, 500);

// Item 101 ticket 02: what the last saveSupplyDocsToDrive call received, and what the fake GAS answers to it.
let driveCalls: any[] = [];
let driveRemoved: string[] = [];
const FAKE_SKUS = [{ sku: 'ART-A', pcsPerBox: 10, price: 1, minStock: 0, boxesPerPallet: 1, volumeLiters: 1, leadTimeDays: 1 }];

// Item 101 ticket 03: the journal record + folder the fake GAS keeps between docs builds, and what the fake Ozon holds.
let storedByOrder: Record<string, string> = {};
let folderByName: Record<string, string[]> = {};
let stateMode: 'chain' | 'none' | 'error' = 'chain';
let stateCalls = 0;
let driveLabelSaveFail: string[] = [];
let ozonHeld: Record<string, string[]> = {};
let ozonCalls: string[] = [];

async function gas(body: any): Promise<Response> {
  switch (body.action) {
    case 'getSkus': return j({ status: 'success', data: FAKE_SKUS });
    case 'saveSupplyDocsToDrive': {
      driveCalls.push(body.data);
      // Item 101 ticket 03: a folder that remembers saved files, and savedBySupply like Code.gs reports it.
      const savedBySupply: Record<string, { composition: boolean; label: boolean }> = {};
      const folderKey = String(body.data.folderName);
      let fakeFolder = (folderByName[folderKey] ||= []);
      for (const id of body.data.staleLabelSupplyIds || []) {
        fakeFolder = folderByName[folderKey] = fakeFolder.filter((n) => !(n.startsWith(id + '.') || n.startsWith('tags-cargoes-by-supply-' + id + '.')));
      }
      for (const f of body.data.files || []) {
        const sid = String(f.supplyId || '');
        savedBySupply[sid] ||= { composition: false, label: false };
        if (f.kind === 'base64') { fakeFolder.push(f.name); savedBySupply[sid].composition = true; }
        else if (f.kind === 'url' && !driveLabelSaveFail.includes(sid)) { fakeFolder.push(f.fallbackName + '.pdf'); savedBySupply[sid].label = true; }
      }
      return j({ status: 'success', data: { folderUrl: 'https://drive.fake/f', saved: [], problems: [], missingLabels: [], removedStaleLabels: driveRemoved, savedBySupply } });
    }
    case 'getSupplyDocsState':
      stateCalls++;
      if (stateMode === 'error') return j({ status: 'error', message: 'gas state down' });
      if (stateMode === 'none') return j({ status: 'success', data: { docsJSON: '', folderFiles: [] } });
      return j({ status: 'success', data: { docsJSON: storedByOrder[String(body.data.orderId)] || '', folderFiles: (folderByName[String(body.data.folderName)] || []).slice() } });
    case 'saveOzonSupplyDocs':
      storedByOrder[String(body.data.orderId)] = body.data.docsJSON;
      return j({ status: 'success', data: { updated: 1 } });
    case 'getOzonKeys': return j({ status: 'success', data: { ozonClientId: '1', ozonApiKey: 'k', cabinets: [{ name: 'MaxiStore', clientId: '1', apiKey: 'k' }] } });
    case 'getGeminiKey': return j({ status: 'error', message: 'none' });
    case 'verifySession': return j({ status: 'success', data: { user: { username: 'admin', role: 'admin' } } });
    default: return j({ status: 'success', data: {} });
  }
}

// Item 101 ticket 02: a scripted order for the stale-label scenarios; null = the old behaviour above.
type FakeSupply = { id: string; cluster: string; offer: string };
let scenario: { orderId: string; supplies: FakeSupply[]; failCreate: string[]; failLabel: string[] } | null = null;
const supplyOfOp = (op: string) => op.split(':')[1];
const boxKeyOfSupply: Record<string, string> = {};

function ozonScenario(p: string, text: string): Response | null {
  const sc = scenario!;
  const body = text ? JSON.parse(text) : {};
  ozonCalls.push(p + (body.supply_id ? ' ' + body.supply_id : '') + (body.supply_ids ? ' ' + body.supply_ids.join(',') : ''));
  switch (p) {
    case '/v1/cargoes/get':
      return j({ supply: body.supply_ids.map((id: string) => ({ supply_id: id, cargoes: (ozonHeld[id] || ['9' + id]).map((c) => ({ cargo_id: c })) })) });
    case '/v1/cargoes/rules/get': {
      const ok = { satisfied: true, is_applicable: true, is_required: true };
      return j({ supply_check_lists: body.supply_ids.map((id: string) => ({ supply_id: id, cargoes_presents_rule: ok, package_units_with_distribution_rule: ok, is_valid_distribution_rule: ok })) });
    }
    case '/v3/supply-order/get':
      return j({ orders: [{ order_id: sc.orderId, order_number: 'N-' + sc.orderId, supplies: sc.supplies.map((s) => ({ supply_id: s.id, bundle_id: 'bundle:' + s.id, storage_warehouse: { name: s.cluster } })) }] });
    case '/v1/supply-order/bundle': {
      const sup = sc.supplies.find((s) => 'bundle:' + s.id === body.bundle_ids[0])!;
      return j({ items: [{ sku: 1, offer_id: sup.offer, barcode: 'BC-' + sup.offer, quantity: 10 }], has_next: false });
    }
    case '/v1/cargoes/create':
      if (sc.failCreate.includes(String(body.supply_id))) return j({ message: 'create boom' }, 500);
      boxKeyOfSupply[String(body.supply_id)] = body.cargoes[0].key;
      delete ozonHeld[String(body.supply_id)]; // recreated: Ozon holds the new cargoes now
      return j({ operation_id: 'create:' + body.supply_id });
    case '/v2/cargoes/create/info':
      return j({ status: 'SUCCESS', result: { cargoes: [{ key: boxKeyOfSupply[supplyOfOp(body.operation_id)], value: { cargo_id: '9' + supplyOfOp(body.operation_id) } }] } });
    case '/v1/cargoes-label/create':
      if (sc.failLabel.includes(String(body.supply_id))) return j({ message: 'label boom' }, 500);
      return j({ operation_id: 'label:' + body.supply_id });
    case '/v1/cargoes-label/get':
      return j({ status: 'SUCCESS', result: { file_url: 'https://ozon.fake/label-' + supplyOfOp(body.operation_id) + '.pdf' } });
    default:
      return j({});
  }
}

function ozon(p: string, text: string): Response | Promise<Response> {
  if (scenario) return ozonScenario(p, text)!;
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

  // ---- Item 101 ticket 02: stale cargo-label cleanup, whole path through the in-process server ----
  // Each scenario is one real docs build (about 12 throttled Ozon calls), shared by the checks that read it.
  const SUP_A: FakeSupply = { id: '2000000000001', cluster: 'Новосибирск', offer: 'ART-A' };
  const SUP_B: FakeSupply = { id: '2000000000002', cluster: 'Казань', offer: 'ART-A' };
  const SUP_NONORM: FakeSupply = { id: '2000000000003', cluster: 'Самара', offer: 'ART-NONORM' };
  const NOTE = 'прежний файл этикеток грузомест убран из папки — он недействителен';
  async function runScenario(orderId: string, supplies: FakeSupply[], failCreate: string[], failLabel: string[], removed: string[]) {
    driveCalls = [];
    driveRemoved = removed;
    scenario = { orderId, supplies, failCreate, failLabel };
    try {
      const r = await docs(orderId);
      return { r, drive: driveCalls[0] };
    } finally {
      scenario = null;
    }
  }
  const labelFailRun = { p: null as null | ReturnType<typeof runScenario> };
  const labelFail = () => (labelFailRun.p ||= runScenario('stale-label-fail', [SUP_A, SUP_B], [], [SUP_B.id], [SUP_B.id]));

  it('stale labels: only the supply whose label failed is sent to Drive cleanup (the supply with a fresh label is not)', async () => {
    const { r, drive } = await labelFail();
    expect(r.status).toBe(200);
    expect(drive.staleLabelSupplyIds).toEqual([SUP_B.id]);
    // the fresh label of A did go to Drive as a file; B's did not
    const urls = drive.files.filter((f: any) => f.kind === 'url').map((f: any) => f.fallbackName);
    expect(urls).toEqual(['tags-cargoes-by-supply-' + SUP_A.id]);
  }, 30000);

  it('stale labels: when Drive reports the old file removed, that cluster warning carries the note and the response lists the id', async () => {
    const { r } = await labelFail();
    const warnings: string[] = r.json.data.warnings;
    const b = warnings.filter((w) => w.startsWith('Кластер Казань:'));
    expect(b.length).toBe(1);
    expect(b[0]).toContain('этикетки грузомест не получены');
    expect(b[0]).toContain(NOTE);
    expect(warnings.filter((w) => w.startsWith('Кластер Новосибирск:')).join('')).not.toContain(NOTE);
    expect(r.json.data.removedStaleLabels).toEqual([SUP_B.id]);
  }, 30000);

  it('stale labels: a supply whose cargo creation failed is included in the cleanup list', async () => {
    const { r, drive } = await runScenario('stale-create-fail', [SUP_A, SUP_B], [SUP_A.id], [], []);
    expect(r.status).toBe(200);
    expect(drive.staleLabelSupplyIds).toEqual([SUP_A.id]);
    expect(r.json.data.removedStaleLabels).toEqual([]);
    expect(r.json.data.warnings.join('\n')).not.toContain(NOTE); // Drive removed nothing: no note
  }, 30000);

  it('stale labels: a supply with an empty layout (cargoes never called) is excluded from the cleanup list', async () => {
    const { r, drive } = await runScenario('stale-empty-layout', [SUP_NONORM, SUP_B], [], [], []);
    expect(r.status).toBe(200);
    expect(r.json.data.warnings.join('\n')).toContain('Кластер Самара');
    expect(drive.staleLabelSupplyIds).toEqual([]);
  }, 30000);

  it('stale labels: a removed id with no warning on its cluster adds a warning of its own', async () => {
    // A succeeded in full (label fresh) but GAS still reports an old file removed: the user must still be told
    const { r } = await runScenario('stale-extra-note', [SUP_A], [], [], [SUP_A.id]);
    const own = (r.json.data.warnings as string[]).filter((w) => w.startsWith('Кластер Новосибирск:'));
    expect(own).toEqual(['Кластер Новосибирск: ' + NOTE]);
  }, 30000);

// ---- Item 101 ticket 03: resume of a docs build (nested: the outer afterAll unstubs fetch, so it must run inside), whole path (fake GAS keeps record + folder between runs) ----
describe('server.ts /api/ozon/supply/docs resume: only the missing pieces are redone', () => {
  const A: FakeSupply = { id: '2000000000011', cluster: 'Новосибирск', offer: 'ART-A' };
  const B: FakeSupply = { id: '2000000000012', cluster: 'Казань', offer: 'ART-A' };
  const C: FakeSupply = { id: '2000000000013', cluster: 'Самара', offer: 'ART-A' };

  const count = (prefix: string) => ozonCalls.filter((c) => c.startsWith(prefix)).length;
  const callsOf = (prefix: string) => ozonCalls.filter((c) => c.startsWith(prefix + ' ')).map((c) => c.split(' ')[1]);
  const record = () => JSON.parse(storedByOrder[order]);
  const entryOf = (id: string) => record().supplies.find((e: any) => e.supplyId === id);
  async function run(orderId: string, supplies: FakeSupply[], failLabel: string[] = [], failCreate: string[] = []) {
    ozonCalls = [];
    driveCalls = [];
    driveRemoved = [];
    scenario = { orderId, supplies, failCreate, failLabel };
    try {
      const r = await docs(orderId);
      return { r, drive: driveCalls[0] };
    } finally {
      scenario = null;
    }
  }

  beforeAll(() => {
    storedByOrder = {}; folderByName = {}; stateMode = 'chain'; driveLabelSaveFail = []; ozonHeld = {};
    retryPauses = 0;
  });

  const order = 'resume-order';
  void order;

  it('run 1 (3 supplies, label of C fails twice): record has supplies[] with sorted ids and file flags; the retry pass ran', async () => {
    const { r, drive } = await run(order, [A, B, C], [C.id]);
    expect(r.status).toBe(200);
    expect(count('/v1/cargoes/create')).toBe(3);
    expect(retryPauses).toBe(1);
    expect(callsOf('/v1/cargoes-label/create').filter((x) => x === C.id).length).toBe(2); // first try + retry
    expect(drive.staleLabelSupplyIds).toEqual([C.id]);
    expect(record().supplies).toEqual([
      { supplyId: A.id, clusterName: 'Новосибирск', cargoIds: ['9' + A.id], composition: true, label: true },
      { supplyId: B.id, clusterName: 'Казань', cargoIds: ['9' + B.id], composition: true, label: true },
      { supplyId: C.id, clusterName: 'Самара', cargoIds: ['9' + C.id], composition: true, label: false }
    ]);
  }, 40000);

  it('run 2 (same record + folder, C fails again): zero cargo creates, only C gets label calls, A and B entries kept, stale = [C]', async () => {
    const before = record();
    const { r, drive } = await run(order, [A, B, C], [C.id]);
    expect(r.status).toBe(200);
    expect(count('/v1/cargoes/create')).toBe(0);
    expect(count('/v1/cargoes-label/create')).toBe(2); // C only: first try + retry
    expect(new Set(callsOf('/v1/cargoes-label/create'))).toEqual(new Set([C.id]));
    expect(drive.staleLabelSupplyIds).toEqual([C.id]);
    const after = record();
    expect(after.supplies.find((e: any) => e.supplyId === A.id)).toEqual(before.supplies[0]);
    expect(after.supplies.find((e: any) => e.supplyId === B.id)).toEqual(before.supplies[1]);
    expect(entryOf(C.id)).toMatchObject({ composition: true, label: false, cargoIds: ['9' + C.id] });
    expect(after.supplies.length).toBe(3);
  }, 40000);

  it('run 3 (C label works now): exactly one label create, zero cargo creates, stale = [], C entry gets label true', async () => {
    const { r, drive } = await run(order, [A, B, C]);
    expect(r.status).toBe(200);
    expect(count('/v1/cargoes/create')).toBe(0);
    expect(callsOf('/v1/cargoes-label/create')).toEqual([C.id]);
    expect(drive.staleLabelSupplyIds).toEqual([]);
    expect(entryOf(C.id)).toMatchObject({ composition: true, label: true });
    expect(record().supplies.every((e: any) => e.composition && e.label)).toBe(true);
  }, 40000);

  it('run 4 (everything done, nothing changed): no cargo or label creates at all, every entry kept', async () => {
    const before = record().supplies;
    await run(order, [A, B, C]);
    expect(count('/v1/cargoes/create')).toBe(0);
    expect(count('/v1/cargoes-label/create')).toBe(0);
    expect(record().supplies).toEqual(before);
  }, 40000);

  it('ids changed in Ozon for B: B is recreated (create + label), A and C are skipped', async () => {
    ozonHeld[B.id] = ['777'];
    await run(order, [A, B, C]);
    expect(callsOf('/v1/cargoes/create')).toEqual([B.id]);
    expect(callsOf('/v1/cargoes-label/create')).toEqual([B.id]);
    expect(entryOf(B.id)).toMatchObject({ cargoIds: ['9' + B.id], composition: true, label: true });
  }, 40000);

  it('a label file that was not saved on Drive (savedBySupply label false) is redone on the next run even though Ozon gave a URL', async () => {
    driveLabelSaveFail = [A.id];
    await run(order, [A, B, C]); // nothing to redo: A skipped, nothing is saved
    expect(count('/v1/cargoes-label/create')).toBe(0);
    // lose A's label from the folder and the flag by recreating A
    ozonHeld[A.id] = ['555'];
    await run(order, [A, B, C]);
    expect(callsOf('/v1/cargoes/create')).toEqual([A.id]);
    expect(entryOf(A.id)).toMatchObject({ composition: true, label: false });
    driveLabelSaveFail = [];
    await run(order, [A, B, C]);
    expect(count('/v1/cargoes/create')).toBe(0);
    expect(callsOf('/v1/cargoes-label/create')).toEqual([A.id]);
    expect(entryOf(A.id)).toMatchObject({ label: true });
  }, 60000);

  it('no record in the journal: every supply is recreated and Ozon is not asked what it holds', async () => {
    stateMode = 'none';
    try {
      await run('resume-none', [A, B]);
    } finally { stateMode = 'chain'; }
    expect(callsOf('/v1/cargoes/create').sort()).toEqual([A.id, B.id]);
    expect(count('/v1/cargoes/get')).toBe(0);
  }, 40000);

  it('GAS getSupplyDocsState fails: every supply is recreated and the build still succeeds', async () => {
    stateMode = 'error';
    let res;
    try {
      res = await run('resume-gas-error', [A, B]);
    } finally { stateMode = 'chain'; }
    expect(res.r.status).toBe(200);
    expect(callsOf('/v1/cargoes/create').sort()).toEqual([A.id, B.id]);
  }, 40000);
});
});
