// Item 97 ticket 05 part C: POST /api/contractor-invoice/read on the Cloud Run proxy (server.ts).
// server.ts is imported in-process; global fetch is mocked (fake GAS); @google/genai is mocked so
// `new GoogleGenAI(...).models.generateContent` is a spy. Real localhost requests pass through.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import { contractorInvoicePrompt } from './lib/contractorInvoice';

const { generateContent } = vi.hoisted(() => ({ generateContent: vi.fn() }));
vi.mock('@google/genai', () => ({
  GoogleGenAI: class { models = { generateContent }; },
  Type: new Proxy({}, { get: (_t, k) => String(k) }),
}));

const PORT = 46600 + Math.floor(Math.random() * 1000);
const j = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status });
const PDF_B64 = Buffer.from('%PDF-1.4 fake invoice').toString('base64');

let gasCalls: any[] = [];
let weekFileAnswer: () => any;

async function gas(body: any): Promise<Response> {
  switch (body.action) {
    case 'getOzonKeys': return j({ status: 'success', data: { ozonClientId: '1', ozonApiKey: 'k', cabinets: [] } });
    case 'getGeminiKey': return j({ status: 'success', data: { geminiKey: 'test-gemini-key' } });
    case 'verifySession':
      return body.sessionToken === 'tok-good'
        ? j({ status: 'success', data: { user: { username: 'admin', role: 'admin' } } })
        : j({ status: 'error', message: 'bad session' });
    case 'getWeekFile':
      gasCalls.push(body);
      return j(weekFileAnswer());
    default:
      gasCalls.push(body);
      return j({ status: 'success', data: {} });
  }
}

function post(p: string, data: unknown): Promise<{ status: number; json: any }> {
  const s = JSON.stringify(data);
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: PORT, path: p, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(s) } },
      (res) => {
        let t = '';
        res.on('data', (c) => (t += c));
        res.on('end', () => {
          let json: any = null;
          try { json = JSON.parse(t); } catch { /* not JSON */ }
          resolve({ status: res.statusCode || 0, json });
        });
      },
    );
    req.on('error', reject);
    req.write(s);
    req.end();
  });
}

const read = (extra: Record<string, unknown> = {}) =>
  post('/api/contractor-invoice/read', { week: '2026-W44', fileId: 'F1', ...extra });
const weekFileCalls = () => gasCalls.filter((c) => c.action === 'getWeekFile');

describe('server.ts POST /api/contractor-invoice/read', () => {
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
      try { await post('/api/gas', { action: 'getGeminiKey', sessionToken: 'warmup' }); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
    }
  }, 20000);

  afterAll(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  beforeEach(() => {
    gasCalls = [];
    generateContent.mockReset();
    generateContent.mockResolvedValue({ text: '{}' });
    weekFileAnswer = () => ({ status: 'success', data: { name: 'inv.pdf', mimeType: 'application/pdf', base64: PDF_B64 } });
  });

  it('missing or invalid sessionToken gives 401; neither GAS getWeekFile nor Gemini is called', async () => {
    const none = await read();
    const bad = await read({ sessionToken: 'tok-bad' });
    expect(none.status).toBe(401);
    expect(bad.status).toBe(401);
    expect(weekFileCalls()).toHaveLength(0);
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('a valid session forwards getWeekFile to GAS with the caller token, devMode and { week, fileId }', async () => {
    await read({ sessionToken: 'tok-good', devMode: true });
    const sent = weekFileCalls();
    expect(sent).toHaveLength(1);
    expect(sent[0].sessionToken).toBe('tok-good');
    expect(sent[0].devMode).toBe(true);
    expect(sent[0].data).toEqual({ week: '2026-W44', fileId: 'F1' });
  });

  it('a non-PDF file (image/png) gives 400 "Распознать можно только PDF" and Gemini is not called', async () => {
    weekFileAnswer = () => ({ status: 'success', data: { name: 'inv.png', mimeType: 'image/png', base64: PDF_B64 } });
    const r = await read({ sessionToken: 'tok-good' });
    expect(r.status).toBe(400);
    expect(r.json).toEqual({ status: 'error', message: 'Распознать можно только PDF' });
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('a PDF goes to Gemini once as inlineData with contractorInvoicePrompt(), JSON config; the parsed answer passes through unchanged', async () => {
    const ai = { number: 'A-1', lines: [{ name: 'Работа', sum: '100,00' }] };
    generateContent.mockResolvedValue({ text: JSON.stringify(ai) });
    const r = await read({ sessionToken: 'tok-good' });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ status: 'success', data: ai });
    expect(typeof r.json.data.lines[0].sum).toBe('string');
    expect(generateContent).toHaveBeenCalledTimes(1);
    const arg = generateContent.mock.calls[0][0];
    const parts = JSON.stringify(arg.contents);
    expect(arg.contents).toBeDefined();
    expect(parts).toContain(PDF_B64);
    expect(parts).toContain('application/pdf');
    expect(parts).toContain(JSON.stringify(contractorInvoicePrompt()).slice(1, -1));
    expect(arg.config.responseMimeType).toBe('application/json');
  });

  it('a GAS error on getWeekFile is returned with its message and a non-200 status; Gemini is not called', async () => {
    weekFileAnswer = () => ({ status: 'error', message: 'Файл не найден в этой неделе' });
    const r = await read({ sessionToken: 'tok-good' });
    expect(r.status).not.toBe(200);
    expect(r.json.status).toBe('error');
    expect(r.json.message).toContain('Файл не найден в этой неделе');
    expect(generateContent).not.toHaveBeenCalled();
  });

  it('Gemini returning non-JSON text gives 500 with a Russian error message', async () => {
    generateContent.mockResolvedValue({ text: 'sorry, not json' });
    const r = await read({ sessionToken: 'tok-good' });
    expect(r.status).toBe(500);
    expect(r.json.status).toBe('error');
    expect(r.json.message).toMatch(/[А-Яа-я]/);
  });
});
