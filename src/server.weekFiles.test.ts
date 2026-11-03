// Item 97 ticket 04 part B: POST /api/week-files/upload on the Cloud Run proxy (server.ts).
// server.ts is imported in-process; global fetch is mocked (fake GAS); real localhost requests pass through.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import crypto from 'node:crypto';

const PORT = 45000 + Math.floor(Math.random() * 1500);
const j = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status });
const TOO_BIG = 'Файл больше 10 МБ';
const MAX = 10 * 1024 * 1024;

let gasCalls: any[] = [];

async function gas(body: any): Promise<Response> {
  switch (body.action) {
    case 'getOzonKeys': return j({ status: 'success', data: { ozonClientId: '1', ozonApiKey: 'k', cabinets: [] } });
    case 'getGeminiKey': return j({ status: 'error', message: 'none' });
    case 'verifySession': return j({ status: 'success', data: { user: { username: 'admin', role: 'admin' } } });
    case 'uploadWeekFile':
      gasCalls.push(body);
      return j({ status: 'success', data: { fileId: 'F1', name: body.data?.name } });
    default:
      gasCalls.push(body);
      return j({ status: 'success', data: {} });
  }
}

function raw(p: string, data: string): Promise<{ status: number; type: string; text: string; json: any }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: PORT, path: p, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      (res) => {
        let s = '';
        res.on('data', (c) => (s += c));
        res.on('end', () => {
          let json: any = null;
          try { json = JSON.parse(s); } catch { /* not JSON */ }
          resolve({ status: res.statusCode || 0, type: String(res.headers['content-type'] || ''), text: s, json });
        });
      },
    );
    req.on('error', (e) => {
      // the server may answer 413 and close before the whole body is sent
      reject(e);
    });
    req.write(data);
    req.end();
  });
}

const b64OfBytes = (n: number) => Buffer.alloc(n, 7).toString('base64');
const upload = (extra: Record<string, unknown>, base64: string) =>
  raw('/api/week-files/upload', JSON.stringify({ data: { week: '2026-W44', name: 'inv.pdf', mimeType: 'application/pdf', base64 }, ...extra }));
const gasUploads = () => gasCalls.filter((c) => c.action === 'uploadWeekFile');

describe('server.ts POST /api/week-files/upload', () => {
  beforeAll(async () => {
    process.env.NODE_ENV = 'production';
    process.env.PORT = String(PORT);
    process.env.GAS_URL = 'http://gas.invalid/exec';
    process.env.SERVER_SECRET = 'test-secret';
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', async (input: any, init?: any) => {
      const url = String(typeof input === 'string' ? input : input.url);
      if (url.startsWith('http://gas.invalid')) return gas(JSON.parse(init.body));
      return realFetch(input, init);
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await import('../server.ts');
    for (let i = 0; i < 50; i++) {
      try { await raw('/api/gas', JSON.stringify({ action: 'getGeminiKey', sessionToken: 'warmup' })); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
    }
  }, 20000);

  afterAll(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  beforeEach(() => { gasCalls = []; });

  it('a ~3 MB file (base64 over the global 1 MB limit) is forwarded to GAS as uploadWeekFile, byte-identical, with token and devMode', async () => {
    const base64 = Buffer.from(crypto.randomBytes(3 * 1024 * 1024)).toString('base64');
    const r = await upload({ sessionToken: 'tok-1', devMode: true }, base64);
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ status: 'success', data: { fileId: 'F1', name: 'inv.pdf' } });
    const sent = gasUploads();
    expect(sent).toHaveLength(1);
    expect(sent[0].sessionToken).toBe('tok-1');
    expect(sent[0].devMode).toBe(true);
    expect(sent[0].data).toMatchObject({ week: '2026-W44', name: 'inv.pdf', mimeType: 'application/pdf' });
    const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
    expect(sha(sent[0].data.base64)).toBe(sha(base64));
  });

  it('no sessionToken gives 401 and GAS is not called', async () => {
    const r = await upload({}, b64OfBytes(1000));
    expect(r.status).toBe(401);
    expect(gasCalls).toHaveLength(0);
  });

  it('a decoded size of 10 485 761 bytes gives JSON 413 and GAS is not called', async () => {
    const r = await upload({ sessionToken: 'tok-1' }, b64OfBytes(MAX + 1));
    expect(r.status).toBe(413);
    expect(r.json).toEqual({ status: 'error', message: TOO_BIG });
    expect(gasUploads()).toHaveLength(0);
  });

  it('exactly 10 485 760 bytes is forwarded to GAS', async () => {
    const r = await upload({ sessionToken: 'tok-1' }, b64OfBytes(MAX));
    expect(r.status).toBe(200);
    expect(gasUploads()).toHaveLength(1);
  });

  it('a body over the route parser limit (16 MB of base64) gives JSON 413 with the same message, not HTML', async () => {
    const r = await upload({ sessionToken: 'tok-1' }, 'A'.repeat(16 * 1024 * 1024));
    expect(r.status).toBe(413);
    expect(r.type).toContain('application/json');
    expect(r.json).toEqual({ status: 'error', message: TOO_BIG });
    expect(gasUploads()).toHaveLength(0);
  });

  it('the global 1 MB limit still applies to POST /api/gas (2 MB body gives 413)', async () => {
    const r = await raw('/api/gas', JSON.stringify({ action: 'getSkus', sessionToken: 'tok-1', pad: 'x'.repeat(2 * 1024 * 1024) }));
    expect(r.status).toBe(413);
    expect(gasCalls).toHaveLength(0);
  });
});
