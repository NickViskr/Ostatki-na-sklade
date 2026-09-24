/**
 * Item 81g, step 7: the AI safety net for the module «Заказы в Китае».
 *
 * The owner's words: the script reads the files by a fixed shape, and when the shape does not
 * match, or its own sum checks fail, an AI should read the SAME grid of cells and fill the gap —
 * never work out money of its own, only cells, exactly the parser's own output types. This file
 * has three jobs, all pure, so a test never needs a real AI call:
 *   - normalise whatever JSON the model returns into the parser's own typed shape;
 *   - run the SAME sum checks the parser runs (`chinaBatchLineChecks`, `chinaArrivalLineChecks`
 *     from `chinaFileParse.ts` — no second copy of the arithmetic);
 *   - decide when AI is needed at all, and what mark a batch or report earns once it has run.
 *
 * The one function that is NOT pure, `chinaAiRead`, only calls the proxy and hands back its JSON
 * — the same shape `parseInvoiceWithGemini` uses for the existing Gemini endpoint.
 */

import {
  ChinaSheets, ChinaParsedBatch, ChinaParsedArrival, ChinaParsedReport, ChinaParsedLine,
  ChinaArrivalLine, ChinaReportOrder, ChinaReportTransfer, ChinaReportFreight, ChinaReportPayment,
  chinaBatchLineChecks, chinaArrivalLineChecks
} from './chinaFileParse';

export type ChinaAiKind = 'batch' | 'arrival' | 'report';
export type ChinaCheckMarkValue = '' | 'скрипт' | 'скрипт+ИИ' | 'ИИ' | 'расхождение ИИ';

export const CHINA_AI_ENDPOINT = '/api/china/ai-read';

const toNum = (v: unknown): number => {
  const n = Number(v);
  return isFinite(n) ? n : 0;
};

const toStr = (v: unknown): string => (v === undefined || v === null ? '' : String(v).trim());

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A date the AI must give as 'yyyy-mm-dd' — anything else is dropped, not guessed at. */
const toDate = (v: unknown): string => {
  const s = toStr(v);
  return ISO_DATE.test(s) ? s : '';
};

const toArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

// ── normalising the model's JSON into the parser's own output types ───────────────────────────

function normaliseBatchLine(raw: unknown): ChinaParsedLine {
  const l = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    marking: toStr(l.marking),
    name: toStr(l.name),
    boxes: toNum(l.boxes),
    pcsPerBox: toNum(l.pcsPerBox),
    qty: toNum(l.qty),
    priceCny: toNum(l.priceCny),
    sumCny: toNum(l.sumCny),
    palletWeightKg: toNum(l.palletWeightKg)
  };
}

export function chinaAiNormaliseBatch(raw: unknown): ChinaParsedBatch | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const lines = toArray(r.lines).map(normaliseBatchLine);
  const warnings: string[] = [];
  if (lines.length === 0) warnings.push('В файле не нашлось ни одной строки товара');
  const batch: ChinaParsedBatch = {
    kind: 'batch',
    code: toStr(r.code),
    shippedAt: toDate(r.shippedAt),
    weightKg: toNum(r.weightKg),
    volumeM3: toNum(r.volumeM3),
    places: toNum(r.places),
    ratePerKgUsd: toNum(r.ratePerKgUsd),
    packingUsd: toNum(r.packingUsd),
    otherCargoUsd: toNum(r.otherCargoUsd),
    freightUsd: toNum(r.freightUsd),
    chinaDeliveryCny: toNum(r.chinaDeliveryCny),
    declaredValueCny: toNum(r.declaredValueCny),
    lines,
    warnings
  };
  batch.warnings = warnings.concat(chinaBatchLineChecks(batch));
  return batch;
}

function normaliseArrivalLine(raw: unknown): ChinaArrivalLine {
  const l = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    marking: toStr(l.marking),
    name: toStr(l.name),
    boxes: toNum(l.boxes),
    pcsPerBox: toNum(l.pcsPerBox),
    qty: toNum(l.qty),
    boxLengthM: toNum(l.boxLengthM),
    boxWidthM: toNum(l.boxWidthM),
    boxHeightM: toNum(l.boxHeightM),
    factoryBoxKg: toNum(l.factoryBoxKg)
  };
}

export function chinaAiNormaliseArrival(raw: unknown): ChinaParsedArrival | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const lines = toArray(r.lines).map(normaliseArrivalLine);
  const warnings: string[] = [];
  if (lines.length === 0) warnings.push('В файле не нашлось ни одной строки товара');
  warnings.push(...chinaArrivalLineChecks(lines));
  return {
    kind: 'arrival',
    receivedAt: toDate(r.receivedAt),
    customer: toStr(r.customer),
    draftCode: toStr(r.draftCode),
    lines,
    warnings
  };
}

function normaliseReportOrder(raw: unknown): ChinaReportOrder {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    orderNo: toStr(o.orderNo),
    date: toDate(o.date),
    summary: toStr(o.summary),
    totalCny: toNum(o.totalCny),
    receivedCny: toNum(o.receivedCny),
    depositCny: toNum(o.depositCny),
    unpaidCny: toNum(o.unpaidCny)
  };
}

function normaliseReportTransfer(raw: unknown): ChinaReportTransfer {
  const t = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return { date: toStr(t.date), amountCny: toNum(t.amountCny) };
}

function normaliseReportFreight(raw: unknown): ChinaReportFreight {
  const f = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    code: toStr(f.code),
    orderNo: toStr(f.orderNo),
    shippedAt: toDate(f.shippedAt),
    arrivedAt: toDate(f.arrivedAt),
    ratePerKgUsd: toNum(f.ratePerKgUsd),
    volumeM3: toNum(f.volumeM3),
    weightKg: toNum(f.weightKg),
    amountUsd: toNum(f.amountUsd),
    cargoRate: toNum(f.cargoRate)
  };
}

function normaliseReportPayment(raw: unknown): ChinaReportPayment {
  const p = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return { date: toStr(p.date), note: toStr(p.note), amountUsd: toNum(p.amountUsd), cargoRate: toNum(p.cargoRate) };
}

export function chinaAiNormaliseReport(raw: unknown): ChinaParsedReport | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const orders = toArray(r.orders).map(normaliseReportOrder);
  const warnings: string[] = [];
  if (orders.length === 0) warnings.push('В отчёте не нашлось ни одного заказа');
  return {
    kind: 'report',
    orders,
    transfers: toArray(r.transfers).map(normaliseReportTransfer),
    freights: toArray(r.freights).map(normaliseReportFreight),
    payments: toArray(r.payments).map(normaliseReportPayment),
    openingFreightUsd: toNum(r.openingFreightUsd),
    warnings
  };
}

export type ChinaAiParsed = ChinaParsedBatch | ChinaParsedArrival | ChinaParsedReport;

/** Normalise the model's JSON of the kind the file was detected as, running the same checks the
 * matching parser runs on its own reading. */
export function chinaAiParse(kind: ChinaAiKind, raw: unknown): ChinaAiParsed | null {
  if (kind === 'batch') return chinaAiNormaliseBatch(raw);
  if (kind === 'arrival') return chinaAiNormaliseArrival(raw);
  return chinaAiNormaliseReport(raw);
}

/** A parsed result — script's or AI's — that has no warnings of its own is trustworthy. */
export function chinaAiPassed(parsed: { warnings: string[] } | null): boolean {
  return !!parsed && parsed.warnings.length === 0;
}

// ── deciding when the script needs AI's help at all ────────────────────────────────────────────

/** Item 81g, step 7 owner's rule: AI is called when the script found nothing to read, OR read
 * something whose own sums do not add up — never when the file came out clean. */
export function chinaAiFallbackNeeded(parsed: { warnings: string[] } | null): boolean {
  return !parsed || parsed.warnings.length > 0;
}

/** The concrete reason shown to the owner for why AI was called at all — «...потому что...». */
export function chinaAiFallbackReason(parsed: { warnings: string[] } | null): string {
  if (!parsed) return 'скрипт не нашёл на листе ожидаемые колонки';
  return `суммы не сошлись: ${parsed.warnings.join('; ')}`;
}

export function chinaAiNotice(reason: string): string {
  return `Часть данных заполнена ИИ, потому что ${reason}`;
}

/** The mark a fallback earns: 'ИИ' once AI's own reading passes every check, '' (no automatic
 * mark, same as before this feature) when AI could not do any better than the script. */
export function chinaAiFallbackMark(aiPassed: boolean): ChinaCheckMarkValue {
  return aiPassed ? 'ИИ' : '';
}

/** The mark the «Проверить ИИ» button earns: two ticks when AI agrees with the script down to
 * the last field, a cross with the differences written out when it does not. */
export function chinaAiVerifyMark(differences: string[]): ChinaCheckMarkValue {
  return differences.length === 0 ? 'скрипт+ИИ' : 'расхождение ИИ';
}

// ── comparing what the script read against what AI read ────────────────────────────────────────

const eqExact = (a: unknown, b: unknown): boolean => String(a ?? '') === String(b ?? '');
const eqMoney = (a: unknown, b: unknown): boolean => Math.abs(Number(a) - Number(b)) <= 0.01;

function diffField(label: string, a: unknown, b: unknown, eq: (a: unknown, b: unknown) => boolean, diffs: string[]): void {
  if (!eq(a, b)) diffs.push(`${label}: скрипт ${a}, ИИ ${b}`);
}

/** Lines of both readings, grouped by their own marking (trimmed, case-insensitive) so a marking
 * split over several pallets is matched occurrence by occurrence rather than by array index. */
function groupByMarking<T extends { marking: string }>(lines: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  lines.forEach((l) => {
    const key = String(l.marking || '').trim().toLowerCase();
    const arr = map.get(key) || [];
    arr.push(l);
    map.set(key, arr);
  });
  return map;
}

function compareLineGroups<T>(
  scriptLines: (T & { marking: string })[],
  aiLines: (T & { marking: string })[],
  fields: { label: string; get: (l: T) => unknown; eq: (a: unknown, b: unknown) => boolean }[]
): string[] {
  const diffs: string[] = [];
  const scriptGroups = groupByMarking(scriptLines);
  const aiGroups = groupByMarking(aiLines);
  const markings = new Set<string>([...scriptGroups.keys(), ...aiGroups.keys()]);
  markings.forEach((key) => {
    const sArr = scriptGroups.get(key) || [];
    const aArr = aiGroups.get(key) || [];
    const name = key || '(без маркировки)';
    const len = Math.max(sArr.length, aArr.length);
    for (let i = 0; i < len; i++) {
      const label = sArr.length > 1 || aArr.length > 1 ? `${name} #${i + 1}` : name;
      const s = sArr[i];
      const a = aArr[i];
      if (!s) { diffs.push(`${label}: строка есть только у ИИ`); continue; }
      if (!a) { diffs.push(`${label}: строка есть только у скрипта`); continue; }
      fields.forEach((f) => diffField(`${label} ${f.label}`, f.get(s), f.get(a), f.eq, diffs));
    }
  });
  return diffs;
}

function compareBatch(script: ChinaParsedBatch, ai: ChinaParsedBatch): string[] {
  const diffs: string[] = [];
  diffField('код партии', script.code, ai.code, eqExact, diffs);
  diffField('дата отгрузки', script.shippedAt, ai.shippedAt, eqExact, diffs);
  diffField('вес по накладной', script.weightKg, ai.weightKg, eqMoney, diffs);
  diffField('объём', script.volumeM3, ai.volumeM3, eqMoney, diffs);
  diffField('мест', script.places, ai.places, eqExact, diffs);
  diffField('ставка $/кг', script.ratePerKgUsd, ai.ratePerKgUsd, eqMoney, diffs);
  diffField('упаковка $', script.packingUsd, ai.packingUsd, eqMoney, diffs);
  diffField('прочее карго $', script.otherCargoUsd, ai.otherCargoUsd, eqMoney, diffs);
  diffField('перевозка $', script.freightUsd, ai.freightUsd, eqMoney, diffs);
  diffField('доставка по Китаю ¥', script.chinaDeliveryCny, ai.chinaDeliveryCny, eqMoney, diffs);
  diffField('货值', script.declaredValueCny, ai.declaredValueCny, eqMoney, diffs);
  diffs.push(...compareLineGroups(script.lines, ai.lines, [
    { label: 'коробок', get: (l) => l.boxes, eq: eqExact },
    { label: 'шт/кор', get: (l) => l.pcsPerBox, eq: eqExact },
    { label: 'кол-во', get: (l) => l.qty, eq: eqExact },
    { label: 'цена ¥', get: (l) => l.priceCny, eq: eqMoney },
    { label: 'сумма ¥', get: (l) => l.sumCny, eq: eqMoney },
    { label: 'вес паллеты', get: (l) => l.palletWeightKg, eq: eqMoney }
  ]));
  return diffs;
}

function compareArrival(script: ChinaParsedArrival, ai: ChinaParsedArrival): string[] {
  const diffs: string[] = [];
  diffField('дата приёмки', script.receivedAt, ai.receivedAt, eqExact, diffs);
  diffField('заказчик', script.customer, ai.customer, eqExact, diffs);
  diffField('черновик', script.draftCode, ai.draftCode, eqExact, diffs);
  diffs.push(...compareLineGroups(script.lines, ai.lines, [
    { label: 'коробок', get: (l) => l.boxes, eq: eqExact },
    { label: 'шт/кор', get: (l) => l.pcsPerBox, eq: eqExact },
    { label: 'кол-во', get: (l) => l.qty, eq: eqExact },
    { label: 'вес коробки фабрики', get: (l) => l.factoryBoxKg, eq: eqMoney }
  ]));
  return diffs;
}

/** Item 81g, step 7: orders and freights of a report have their own key (order number, batch
 * code) — everything else the report holds (transfers, the payments log) has none, so it is
 * left to the owner's own eye rather than guessed at by position. */
function compareReport(script: ChinaParsedReport, ai: ChinaParsedReport): string[] {
  const diffs: string[] = [];
  const scriptOrders = new Map(script.orders.map((o) => [o.orderNo, o]));
  const aiOrders = new Map(ai.orders.map((o) => [o.orderNo, o]));
  new Set([...scriptOrders.keys(), ...aiOrders.keys()]).forEach((orderNo) => {
    const s = scriptOrders.get(orderNo);
    const a = aiOrders.get(orderNo);
    if (!s) { diffs.push(`заказ №${orderNo}: строка есть только у ИИ`); return; }
    if (!a) { diffs.push(`заказ №${orderNo}: строка есть только у скрипта`); return; }
    diffField(`заказ №${orderNo} товар ¥`, s.totalCny, a.totalCny, eqMoney, diffs);
    diffField(`заказ №${orderNo} оплачено ¥`, s.receivedCny, a.receivedCny, eqMoney, diffs);
    diffField(`заказ №${orderNo} долг ¥`, s.unpaidCny, a.unpaidCny, eqMoney, diffs);
  });
  const scriptFreights = new Map(script.freights.map((f) => [f.code.trim().toLowerCase(), f]));
  const aiFreights = new Map(ai.freights.map((f) => [f.code.trim().toLowerCase(), f]));
  new Set([...scriptFreights.keys(), ...aiFreights.keys()]).forEach((code) => {
    const s = scriptFreights.get(code);
    const a = aiFreights.get(code);
    if (!s) { diffs.push(`партия ${code}: строка перевозки есть только у ИИ`); return; }
    if (!a) { diffs.push(`партия ${code}: строка перевозки есть только у скрипта`); return; }
    diffField(`партия ${code} перевозка $`, s.amountUsd, a.amountUsd, eqMoney, diffs);
  });
  diffField('остаток перевозки на начало $', script.openingFreightUsd, ai.openingFreightUsd, eqMoney, diffs);
  return diffs;
}

/** The differences between what the script read and what AI read, in the owner's own words —
 * empty when they agree. */
export function chinaCompareParsed(kind: ChinaAiKind, script: ChinaAiParsed, ai: ChinaAiParsed): string[] {
  if (kind === 'batch') return compareBatch(script as ChinaParsedBatch, ai as ChinaParsedBatch);
  if (kind === 'arrival') return compareArrival(script as ChinaParsedArrival, ai as ChinaParsedArrival);
  return compareReport(script as ChinaParsedReport, ai as ChinaParsedReport);
}

// ── calling the proxy ───────────────────────────────────────────────────────────────────────────

/** Same shape as `parseInvoiceWithGemini` — the proxy adds the Gemini key, the browser never
 * holds one. Throws on error, exactly like the existing invoice call. */
export async function chinaAiRead(sessionToken: string, kind: ChinaAiKind, sheets: ChinaSheets, reason?: string): Promise<unknown> {
  const response = await fetch(CHINA_AI_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionToken, kind, sheets, reason })
  });
  const result = await response.json();
  if (result.status === 'error') throw new Error(result.message);
  return result.data;
}
