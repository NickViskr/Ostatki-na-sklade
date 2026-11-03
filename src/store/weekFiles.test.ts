import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWarehouseStore } from './useWarehouseStore';

// Item 97 ticket 04 part C. Client<->server contract: every field sits under `data`, never at the
// top level (the d269c2b lesson). Error shape chosen for these actions (same as fetchGas results):
// they resolve to `{ status: 'success' | 'error', data?, message? }` and never throw.
const BYTES = new Uint8Array([0x00, 0xff, 0x10, 0x80, 0x00, 0xfe, 0x7f, 0xff]);

function b64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

describe('week files store actions', () => {
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

  it('listWeekFiles posts action listWeekFiles with data.week and returns the array from data', async () => {
    const files = [{ id: 'f1', name: 'a.xlsx', size: 5 }];
    respond({ status: 'success', data: files });
    const result = await useWarehouseStore.getState().listWeekFiles('2026-W43');
    const { url, body } = sent();
    expect(url).toBe('/api/gas');
    expect(body.action).toBe('listWeekFiles');
    expect(body.sessionToken).toBe('tok');
    expect(body.data).toEqual({ week: '2026-W43' });
    expect('week' in body).toBe(false);
    expect(result).toEqual(files);
  });

  it('uploadWeekFile posts to /api/week-files/upload with name, mimeType and base64 that decode to the exact bytes, all under data', async () => {
    respond({ status: 'success', data: { id: 'f1' } });
    const file = new File([BYTES], 'invoice.xlsx', { type: 'application/vnd.ms-excel' });
    await useWarehouseStore.getState().uploadWeekFile('2026-W43', file);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const { url, body } = sent();
    expect(url).toBe('/api/week-files/upload');
    expect(body.sessionToken).toBe('tok');
    expect(body.data.week).toBe('2026-W43');
    expect(body.data.name).toBe('invoice.xlsx');
    expect(body.data.mimeType).toBe('application/vnd.ms-excel');
    expect(Array.from(fromB64(body.data.base64))).toEqual(Array.from(BYTES));
    for (const k of ['week', 'name', 'mimeType', 'base64']) expect(k in body).toBe(false);
  });

  it('uploadWeekFile rejects a file over 10 MB before any request and says «Файл больше 10 МБ»', async () => {
    const big = new File([new Uint8Array(10_485_760 + 1)], 'big.pdf', { type: 'application/pdf' });
    const result = await useWarehouseStore.getState().uploadWeekFile('2026-W43', big);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.status).toBe('error');
    expect(result.message).toContain('Файл больше 10 МБ');
  });

  it('uploadWeekFile accepts a file of exactly 10 MB (boundary)', async () => {
    respond({ status: 'success', data: { id: 'f1' } });
    const edge = new File([new Uint8Array(10_485_760)], 'edge.pdf', { type: 'application/pdf' });
    const result = await useWarehouseStore.getState().uploadWeekFile('2026-W43', edge);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('success');
  });

  it.each([413, 502])('uploadWeekFile returns {status:error, message} carrying the server message on HTTP %i', async (status) => {
    respond({ status: 'error', message: 'X' }, false, status);
    const file = new File([BYTES], 'a.bin');
    const result = await useWarehouseStore.getState().uploadWeekFile('2026-W43', file);
    expect(result.status).toBe('error');
    expect(result.message).toContain('X');
  });

  it('downloadWeekFile posts getWeekFile with data.week and data.fileId, saves a Blob with the decoded bytes under the returned name', async () => {
    respond({ status: 'success', data: { name: 'счёт.xlsx', mimeType: 'application/vnd.ms-excel', base64: b64(BYTES) } });
    const blobs = new Map<string, Blob>();
    const saved: { download: string; href: string }[] = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation(((blob: Blob) => {
      const u = `blob:t-${blobs.size + 1}`;
      blobs.set(u, blob);
      return u;
    }) as any);
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.stubGlobal('document', {
      createElement: () => {
        const link: any = { href: '', download: '', style: {}, click: () => saved.push({ download: link.download, href: link.href }) };
        return link;
      },
      body: { appendChild: () => undefined, removeChild: () => undefined },
    });

    await useWarehouseStore.getState().downloadWeekFile('2026-W43', 'f1');

    const { url, body } = sent();
    expect(url).toBe('/api/gas');
    expect(body.action).toBe('getWeekFile');
    expect(body.data).toEqual({ week: '2026-W43', fileId: 'f1' });
    expect('fileId' in body).toBe(false);
    expect(saved).toHaveLength(1);
    expect(saved[0].download).toBe('счёт.xlsx');
    const blob = blobs.get(saved[0].href)!;
    expect(blob.type).toBe('application/vnd.ms-excel');
    expect(Array.from(new Uint8Array(await blob.arrayBuffer()))).toEqual(Array.from(BYTES));
  });

  it('deleteWeekFile posts deleteWeekFile with data.week and data.fileId', async () => {
    respond({ status: 'success', data: {} });
    await useWarehouseStore.getState().deleteWeekFile('2026-W43', 'f1');
    const { url, body } = sent();
    expect(url).toBe('/api/gas');
    expect(body.action).toBe('deleteWeekFile');
    expect(body.sessionToken).toBe('tok');
    expect(body.data).toEqual({ week: '2026-W43', fileId: 'f1' });
    expect('fileId' in body).toBe(false);
  });
});
