import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { BATCH_FILE_28, ARRIVAL_FILE_NV0923 } from './chinaFiles.fixture';
import { parseChinaBatchFile, parseChinaArrivalFile, ChinaParsedBatch, ChinaParsedArrival } from './chinaFileParse';
import {
  CHINA_AI_ENDPOINT, chinaAiFallbackMark, chinaAiFallbackNeeded, chinaAiFallbackReason, chinaAiNotice,
  chinaAiNormaliseArrival, chinaAiNormaliseBatch, chinaAiNormaliseReport, chinaAiParse, chinaAiPassed,
  chinaAiRead, chinaAiVerifyMark, chinaCompareParsed
} from './chinaAiRead';

const scriptBatch = parseChinaBatchFile(BATCH_FILE_28)!;
const scriptArrival = parseChinaArrivalFile(ARRIVAL_FILE_NV0923)!;

describe('нормализация JSON, который вернул ИИ', () => {
  it('turns the model’s numbers-as-strings and missing fields into the parser’s own shape', () => {
    const raw = {
      code: ' NV-0825-2 ', shippedAt: '2026-08-27', weightKg: '672.5', volumeM3: 4.92, places: '2',
      ratePerKgUsd: 2.3, packingUsd: 90, otherCargoUsd: 0, freightUsd: 1636.75,
      chinaDeliveryCny: 700, declaredValueCny: 10444,
      lines: [{ marking: 'NV-99', name: '收纳盒', boxes: '30', pcsPerBox: 8, qty: 240, priceCny: 20.3, sumCny: 4872, palletWeightKg: 339 }]
    };
    const parsed = chinaAiNormaliseBatch(raw)!;
    expect(parsed.code).toBe('NV-0825-2');
    expect(parsed.weightKg).toBe(672.5);
    expect(parsed.places).toBe(2);
    expect(parsed.lines[0].boxes).toBe(30);
    expect(parsed.lines[0]).toEqual({ marking: 'NV-99', name: '收纳盒', boxes: 30, pcsPerBox: 8, qty: 240, priceCny: 20.3, sumCny: 4872, palletWeightKg: 339 });
  });

  it('drops a date the model did not give as yyyy-mm-dd, rather than guess', () => {
    const parsed = chinaAiNormaliseBatch({ code: 'X', shippedAt: '27.08.2026', lines: [] })!;
    expect(parsed.shippedAt).toBe('');
  });

  it('missing arrays become empty arrays, not a crash', () => {
    const parsed = chinaAiNormaliseBatch({ code: 'X' })!;
    expect(parsed.lines).toEqual([]);
    expect(parsed.warnings).toContain('В файле не нашлось ни одной строки товара');
  });

  it('is null for anything that is not an object at all', () => {
    expect(chinaAiNormaliseBatch(null)).toBeNull();
    expect(chinaAiNormaliseBatch('nope')).toBeNull();
    expect(chinaAiNormaliseArrival(undefined)).toBeNull();
    expect(chinaAiNormaliseReport(3)).toBeNull();
  });

  it('normalises an arrival reading and runs the box-count check on it, same as the parser', () => {
    const parsed = chinaAiNormaliseArrival({
      receivedAt: '2026-09-23', customer: 'NV', draftCode: 'NV-0923',
      lines: [{ marking: 'NV-101', name: '收纳盒', boxes: 30, pcsPerBox: 6, qty: 999, boxLengthM: 0.32, boxWidthM: 0.59, boxHeightM: 0.43, factoryBoxKg: 8.4 }]
    })!;
    expect(parsed.warnings.join(' ')).toContain('коробки на штуки в коробке дают 180 шт, в файле 999 шт');
  });

  it('normalises a report reading and complains about no orders, same wording as the parser', () => {
    const parsed = chinaAiNormaliseReport({ orders: [] })!;
    expect(parsed.warnings).toContain('В отчёте не нашлось ни одного заказа');
  });

  it('a clean batch reading passes the same declared-value and weight checks the parser runs', () => {
    const raw = {
      code: 'NV-1', shippedAt: '2026-08-27', weightKg: 100, chinaDeliveryCny: 10, declaredValueCny: 210,
      lines: [{ marking: 'A', name: '', boxes: 1, pcsPerBox: 1, qty: 10, priceCny: 20, sumCny: 200, palletWeightKg: 100 }]
    };
    expect(chinaAiPassed(chinaAiNormaliseBatch(raw))).toBe(true);
  });

  it('a batch reading whose own sums do not add up fails, exactly the check the parser shares', () => {
    const raw = {
      code: 'NV-1', chinaDeliveryCny: 0, declaredValueCny: 0,
      lines: [{ marking: 'A', boxes: 1, pcsPerBox: 1, qty: 10, priceCny: 20, sumCny: 999, palletWeightKg: 0 }]
    };
    const parsed = chinaAiNormaliseBatch(raw);
    expect(parsed!.warnings.join(' ')).toContain('количество на цену');
    expect(chinaAiPassed(parsed)).toBe(false);
  });

  it('chinaAiParse dispatches on the file kind', () => {
    expect(chinaAiParse('batch', { code: 'X', lines: [] })!.kind).toBe('batch');
    expect(chinaAiParse('arrival', { lines: [] })!.kind).toBe('arrival');
    expect(chinaAiParse('report', { orders: [] })!.kind).toBe('report');
  });
});

describe('когда скрипту нужна подстраховка ИИ', () => {
  it('needs AI when the parser found nothing at all', () => {
    expect(chinaAiFallbackNeeded(null)).toBe(true);
  });

  it('needs AI when the parser read something whose sums do not add up', () => {
    expect(chinaAiFallbackNeeded({ warnings: ['Товар: количество на цену даёт 100 ¥, а суммы строк 90 ¥'] })).toBe(true);
  });

  it('does NOT need AI on a clean reading', () => {
    expect(chinaAiFallbackNeeded({ warnings: [] })).toBe(false);
  });

  it('states the concrete reason the owner is told, worded around the actual failure', () => {
    expect(chinaAiFallbackReason(null)).toContain('не нашёл');
    expect(chinaAiFallbackReason({ warnings: ['Вес: паллеты в сумме 100 кг, в накладной 200 кг'] }))
      .toBe('суммы не сошлись: Вес: паллеты в сумме 100 кг, в накладной 200 кг');
  });

  it('the notice shown in the window and as a toast names the reason', () => {
    expect(chinaAiNotice('суммы не сошлись: Вес...')).toBe('Часть данных заполнена ИИ, потому что суммы не сошлись: Вес...');
  });

  it('a fallback that passed earns the ИИ mark; one that also failed earns none', () => {
    expect(chinaAiFallbackMark(true)).toBe('ИИ');
    expect(chinaAiFallbackMark(false)).toBe('');
  });
});

describe('«Проверить ИИ»: сравнение с тем, что прочитал скрипт', () => {
  it('an AI reading identical to the script’s own gives no differences and two ticks', () => {
    const ai: ChinaParsedBatch = JSON.parse(JSON.stringify(scriptBatch));
    const diffs = chinaCompareParsed('batch', scriptBatch, ai);
    expect(diffs).toEqual([]);
    expect(chinaAiVerifyMark(diffs)).toBe('скрипт+ИИ');
  });

  it('a changed price on one line is named, with both figures, and earns the cross', () => {
    const ai: ChinaParsedBatch = JSON.parse(JSON.stringify(scriptBatch));
    ai.lines[0].priceCny = 99;
    const diffs = chinaCompareParsed('batch', scriptBatch, ai);
    expect(diffs.join(' ')).toContain('цена ¥: скрипт 20.3, ИИ 99');
    expect(chinaAiVerifyMark(diffs)).toBe('расхождение ИИ');
  });

  it('a changed batch code is named as a top-level difference', () => {
    const ai: ChinaParsedBatch = { ...scriptBatch, code: 'NV-0000' };
    const diffs = chinaCompareParsed('batch', scriptBatch, ai);
    expect(diffs.join(' ')).toContain('код партии: скрипт NV-0825-2, ИИ NV-0000');
  });

  it('a changed marking on one arrival line is named as a missing/extra line, not silently matched', () => {
    const ai: ChinaParsedArrival = JSON.parse(JSON.stringify(scriptArrival));
    ai.lines[0].marking = 'NV-999';
    const diffs = chinaCompareParsed('arrival', scriptArrival, ai);
    expect(diffs.some((d) => d.includes('только у скрипта') || d.includes('только у ИИ'))).toBe(true);
  });

  it('a changed received date is named, exact comparison, no tolerance', () => {
    const ai: ChinaParsedArrival = { ...scriptArrival, receivedAt: '2026-09-24' };
    const diffs = chinaCompareParsed('arrival', scriptArrival, ai);
    expect(diffs.join(' ')).toContain('дата приёмки: скрипт 2026-09-23, ИИ 2026-09-24');
  });

  it('a money field within 0.01 is NOT a difference — the tolerance the owner allowed', () => {
    const ai: ChinaParsedBatch = JSON.parse(JSON.stringify(scriptBatch));
    ai.freightUsd = scriptBatch.freightUsd + 0.005;
    expect(chinaCompareParsed('batch', scriptBatch, ai)).toEqual([]);
  });

  it('report orders are matched by order number, not by position', () => {
    const script = { kind: 'report' as const, orders: [{ orderNo: '28', date: '', summary: '', totalCny: 100, receivedCny: 50, depositCny: 0, unpaidCny: 50 }], transfers: [], freights: [], payments: [], openingFreightUsd: 0, warnings: [] };
    const ai = { ...script, orders: [{ ...script.orders[0], receivedCny: 999 }] };
    const diffs = chinaCompareParsed('report', script, ai);
    expect(diffs.join(' ')).toContain('заказ №28 оплачено ¥: скрипт 50, ИИ 999');
  });
});

describe('вызов прокси', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('posts the session, kind, sheets and reason to the endpoint and returns its data', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ json: async () => ({ status: 'success', data: { code: 'X' } }) });
    vi.stubGlobal('fetch', fetchMock);
    const data = await chinaAiRead('tok', 'batch', { Лист1: [['a']] }, 'потому что скрипт не справился');
    expect(data).toEqual({ code: 'X' });
    expect(fetchMock).toHaveBeenCalledWith(CHINA_AI_ENDPOINT, expect.objectContaining({ method: 'POST' }));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({ sessionToken: 'tok', kind: 'batch', sheets: { Лист1: [['a']] }, reason: 'потому что скрипт не справился' });
  });

  it('throws the server’s own message on an error response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ json: async () => ({ status: 'error', message: 'файл слишком велик' }) }));
    await expect(chinaAiRead('tok', 'batch', {})).rejects.toThrow('файл слишком велик');
  });
});

describe('подключение к экрану: кнопка, уведомление, эндпоинт', () => {
  const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
  const tab = read('src/components/ChinaOrdersTab.tsx');
  const modal = read('src/components/ChinaBatchModal.tsx');
  const server = read('server.ts');

  it('the import flow calls the AI fallback when the script needs it, and shows the notice', () => {
    expect(tab).toContain('chinaAiFallbackNeeded(parsed)');
    expect(tab).toContain('runAiFallback(');
    expect(tab).toContain('chinaAiNotice(');
  });

  it('the import window has a «Проверить ИИ» button, shown only alongside a clean script reading', () => {
    expect(modal).toContain('btn-check-china-ai');
    expect(modal).toContain('Проверить ИИ');
    expect(modal).toContain('chinaCompareParsed(');
    expect(modal).toContain('chinaAiVerifyMark(');
  });

  it('the server exposes the endpoint, checks the session and caps the payload size', () => {
    expect(server).toContain('/api/china/ai-read');
    expect(server).toContain('verifyGasSession(token)');
    expect(server).toContain('CHINA_AI_MAX_BYTES');
    expect(server).toContain('rateLimitMiddleware');
  });
});
