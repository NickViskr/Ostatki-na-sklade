/**
 * Review of item 81, 2026-09-24: the whole path of a batch, end to end.
 *
 * Every link was tested on its own — the parser, the form, the script — and nothing tested
 * that they speak about the same numbers. Here the owner's real files go through the parser of
 * the browser, the form, the payload the store sends, and into the Apps Script of
 * `ChinaOrders.gs` run on the stand; the numbers that come out of the sheet are the ones
 * derived independently in Python when the costing was first pinned.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { ARRIVAL_FILE_NV0923, BATCH_FILE_27, BATCH_FILE_28, BATCH_FILE_30, REPORT_FILE } from './chinaFiles.fixture';
import { chinaReportPayload, parseChinaArrivalFile, parseChinaBatchFile, parseChinaReportFile } from './chinaFileParse';
import { chinaBatchToForm, chinaFormFromArrival, chinaFormFromFiles, chinaFormToPayload, chinaGroupIds } from './chinaBatchForm';
import { ChinaBatch } from '../types';

const require = createRequire(import.meta.url);

// A fresh stand for every test: the stand keeps its sheets in module state.
const freshStand = () => {
  const path = require.resolve('../../tests/apps-script/harness.cjs');
  delete require.cache[path];
  const stand = require('../../tests/apps-script/harness.cjs');
  stand.setChinaSpreadsheet();
  stand.setupChinaSpreadsheet();
  return stand;
};

const report = parseChinaReportFile(REPORT_FILE)!;

const importBatch = (stand: any, file: typeof BATCH_FILE_28, rubRate: string, existing: ChinaBatch | null) => {
  const parsed = parseChinaBatchFile(file)!;
  const { form } = chinaFormFromFiles(parsed, report, existing);
  form.rubRate = rubRate;
  return stand.saveChinaBatch(chinaFormToPayload(form), 'Николай');
};

describe('партия из файлов китайцев — от файла до листа', () => {
  it('NV-0825-2 lands in the sheet at 271 575,49 ₽, with the fields only the report knows', () => {
    const stand = freshStand();
    const state = importBatch(stand, BATCH_FILE_28, '12,4', null);
    const batch = state.batches[0];
    expect(batch.code).toBe('NV-0825-2');
    expect(batch.orderNo).toBe('28');
    expect(batch.arrivedAt).toBe('2026-09-17');
    expect(batch.cargoRate).toBe(7);
    expect(batch.freightUsd).toBe(1636.75);
    expect(batch.freightCny).toBe(11457.25);
    expect(batch.goodsCny).toBe(9744);
    expect(batch.paidCny).toBe(10444);
    expect(batch.totalRub).toBe(271575.49);
    expect(batch.lines.map((l: any) => l.unitRub)).toEqual([504.61, 504.61, 749.3]);
  });

  it('NV-0716-3 with its 9 000 ₽ of unloading lands at 393 637,45 ₽', () => {
    const stand = freshStand();
    importBatch(stand, BATCH_FILE_27, '12,4', null);
    const state = stand.saveChinaBatchCost({ batchId: 'CB1', kind: 'Разгрузка', amountRub: 9000 }, 'Николай');
    const batch = state.batches[0];
    expect(batch.orderNo).toBe('27');
    expect(batch.weightFactor).toBe(0.9166);
    expect(batch.totalRub).toBe(393637.45);
    expect(batch.lines.map((l: any) => l.rubShare)).toEqual([2057.14, 3085.71, 514.29, 3214.29, 128.57]);
  });

  it('a re-import keeps the articles the owner chose and the cost they gave', () => {
    const stand = freshStand();
    importBatch(stand, BATCH_FILE_28, '12,4', null);
    const saved = stand.getChinaBatches().batches[0];
    const labelled = { ...saved, lines: saved.lines.map((l: any) => ({ ...l, article: 'BOX', group: '' })) };
    stand.saveChinaBatch(chinaFormToPayload(chinaFormFromFiles(parseChinaBatchFile(BATCH_FILE_28)!, report, labelled).form), 'Николай');
    const once = stand.getChinaBatches().batches[0];
    expect(once.lines.map((l: any) => l.unitRub)).toEqual([565.78, 565.78, 565.78]);

    // The same file again, a week later: nothing the owner did may be undone.
    const again = importBatch(stand, BATCH_FILE_28, '12,4', once).batches;
    expect(again).toHaveLength(1);
    expect(again[0].lines.map((l: any) => l.article)).toEqual(['BOX', 'BOX', 'BOX']);
    expect(again[0].lines.map((l: any) => l.unitRub)).toEqual([565.78, 565.78, 565.78]);
    expect(again[0].totalRub).toBe(271575.49);
  });

  it('a payment of the order and the typed rate trade places without losing either', () => {
    const stand = freshStand();
    importBatch(stand, BATCH_FILE_28, '12,4', null);
    stand.saveChinaPayment({ amountRub: 100000, rate: 11, orderNo: '28' }, 'Николай');
    const paid = stand.getChinaBatches().batches[0];
    expect([paid.rubRate, paid.manualRate, paid.rubRateSource]).toEqual([11, 12.4, 'оплаты']);

    // The owner opens the batch in the window and saves it untouched, then the payment goes.
    const form = chinaFormFromFiles(parseChinaBatchFile(BATCH_FILE_28)!, report, paid).form;
    expect(form.rubRate).toBe('12.4');
    stand.saveChinaBatch(chinaFormToPayload(form), 'Николай');
    stand.deleteChinaPayment({ id: 'CP1' }, 'Николай');
    const back = stand.getChinaBatches().batches[0];
    expect([back.rubRate, back.rubRateSource, back.totalRub]).toEqual([12.4, 'вручную', 271575.49]);
  });
});

describe('экран и скрипт считают одинаковые товары одинаково', () => {
  const cases: { marking?: string; article?: string; group?: string }[][] = [
    [{ marking: 'NV-99' }, { marking: 'NV-99' }, { marking: 'NV-98' }],
    [{ marking: 'NV-99', article: 'BOX-WHITE' }, { marking: 'NV-99' }, { marking: 'NV-98' }],
    [{ marking: 'NV-99', article: 'BOX' }, { marking: 'NV-99' }, { marking: 'NV-98', article: 'BOX' }],
    [{ marking: 'NV-99', article: 'W', group: 'короб' }, { marking: 'NV-98', article: 'G', group: 'КОРОБ' }, { marking: 'NV-97' }],
    [{ marking: 'NV-1' }, { marking: 'NV-1', article: 'P' }, { marking: 'NV-2', article: 'P', group: 'G' }, { marking: 'NV-3', group: 'G' }, { marking: 'NV-4' }],
    [{ marking: 'NV-1', group: 'BOX' }, { marking: 'NV-2', article: 'BOX' }],
    [{ marking: 'nv-99' }, { marking: ' NV-99 ' }]
  ];

  it('the badge on the screen and the cost of the script group the same lines', () => {
    const stand = freshStand();
    cases.forEach((lines) => {
      expect(chinaGroupIds(lines)).toEqual(stand.chinaGroupIds(lines));
    });
  });
});

/**
 * Item 81e: the arrival file — one marking of the arrival split into two lines of the final
 * batch (NV-101: 7 and 23 boxes), each factory-weighed on its own. The numbers below were
 * worked out independently in Python from the same fixtures before this test was written.
 */
describe('партия из файлов китайцев — приёмка на складе перед отправкой', () => {
  const importArrival = (stand: any, existing: ChinaBatch | null) => {
    const parsed = parseChinaArrivalFile(ARRIVAL_FILE_NV0923)!;
    const { form } = chinaFormFromArrival(parsed, existing);
    return stand.saveChinaBatch(chinaFormToPayload(form), 'Николай');
  };

  const finalLineOrder = ['NV-101', 'NV-104', 'NV-103', 'NV-104', 'NV-101', 'NV-102', 'NV-102'];
  const finalBoxesOrder = [7, 9, 15, 1, 23, 1, 24];
  const factoryBoxKgOf: Record<string, number> = { 'NV-101': 8.4, 'NV-102': 8.2, 'NV-103': 15.6, 'NV-104': 15.6 };

  const assertFinalBatch = (batch: any) => {
    expect(batch.code).toBe('NV-0923-4');
    expect(batch.lines).toHaveLength(7);
    expect(batch.lines.map((l: any) => l.marking)).toEqual(finalLineOrder);
    expect(batch.lines.map((l: any) => l.boxes)).toEqual(finalBoxesOrder);
    expect(batch.lines.every((l: any, i: number) => l.factoryBoxKg === factoryBoxKgOf[finalLineOrder[i]])).toBe(true);
    expect(batch.lines.every((l: any) => l.weightSource === 'приёмка')).toBe(true);

    expect(batch.goodsKg).toBe(847);
    expect(batch.packagingKg).toBe(120);
    expect(batch.goodsVolumeM3).toBe(7.5611);
    expect(batch.packagingM3).toBe(1.5789);
    expect(batch.goodsDensity).toBe(112.02);
    expect(batch.packedDensity).toBe(105.8);
    expect(batch.tariffBasis).toBe('кг');
    expect(batch.packagingUsd).toBe(486);
    expect(batch.goodsFreightUsd).toBe(2159.85);
    expect(batch.packagingShareFreight).toBe(18.37);
    expect(batch.packagingRub).toBe(42184.8);
    expect(batch.goodsFreightRub).toBe(187474.98);
    expect(batch.totalRub).toBe(397307.79);
    expect(batch.packagingShareCost).toBe(10.62);
    expect(batch.goodsFreightShareCost).toBe(47.19);

    expect(batch.lines.map((l: any) => l.freightShareCny)).toEqual([1285.75, 3070.06, 5116.77, 341.12, 4224.61, 179.31, 4303.33]);
    const sumOfLineCosts = batch.lines.reduce((s: number, l: any) => Math.round((s + l.costRub) * 100) / 100, 0);
    expect(sumOfLineCosts).toBe(batch.totalRub);
    // Both NV-101 lines (idx 0 and 4) are one product: the cost per piece is levelled equal.
    expect(batch.lines[0].unitRub).toBe(batch.lines[4].unitRub);
  };

  it('order A: an arrival draft, the owner\'s articles, then the final file over the same batch', () => {
    const stand = freshStand();

    // 1. Arrival file lands as a fresh 'Черновик', named after the customer and the date.
    const draftState = importArrival(stand, null);
    let draft = draftState.batches[0];
    expect(draft.code).toBe('NV-0923');
    expect(draft.status).toBe('Черновик');
    expect(draft.receivedAt).toBe('2026-09-23');
    expect(draft.lines).toHaveLength(4);

    // 2. The owner opens the draft, types the articles by marking, and saves through the
    // same path the modal form uses.
    const articleByMarking: Record<string, string> = { 'NV-101': 'ART-101', 'NV-102': 'ART-102', 'NV-103': 'ART-103', 'NV-104': 'ART-104' };
    const editForm = chinaBatchToForm(draft);
    editForm.lines = editForm.lines.map((l) => ({ ...l, article: articleByMarking[l.marking] || l.article }));
    const labelledState = stand.saveChinaBatch(chinaFormToPayload(editForm), 'Николай');
    draft = labelledState.batches[0];
    expect(draft.lines.every((l: any) => l.article === articleByMarking[l.marking])).toBe(true);
    expect(draft.lines.every((l: any) => l.factoryBoxKg === factoryBoxKgOf[l.marking])).toBe(true);

    // 3. The final file + report is matched to the draft by 'NV-0923-4'.replace(/-\d+$/, '') === 'NV-0923'.
    const parsedFinal = parseChinaBatchFile(BATCH_FILE_30)!;
    const { form: finalForm } = chinaFormFromFiles(parsedFinal, report, draft);
    finalForm.rubRate = '12,4';
    const finalState = stand.saveChinaBatch(chinaFormToPayload(finalForm), 'Николай');
    const batch = finalState.batches[0];

    expect(batch.id).toBe(draft.id);
    expect(batch.orderNo).toBe('30');
    expect(batch.lines.every((l: any) => l.article === articleByMarking[l.marking])).toBe(true);
    assertFinalBatch(batch);
  });

  it('order B: the final file first, then the arrival file fills the box data by marking', () => {
    const stand = freshStand();

    // 1. The final file + report, with no draft to match — a batch of its own.
    const parsedFinal = parseChinaBatchFile(BATCH_FILE_30)!;
    const { form: finalForm } = chinaFormFromFiles(parsedFinal, report, null);
    finalForm.rubRate = '12,4';
    const firstState = stand.saveChinaBatch(chinaFormToPayload(finalForm), 'Николай');
    const saved = firstState.batches[0];
    expect(saved.code).toBe('NV-0923-4');
    expect(saved.lines.every((l: any) => l.factoryBoxKg === 0)).toBe(true);

    // 2. The arrival file, matched by 'NV-0923-4'.startsWith('NV-0923-').
    const arrivedState = importArrival(stand, saved);
    const batch = arrivedState.batches[0];

    expect(batch.id).toBe(saved.id);
    expect(batch.orderNo).toBe('30');
    // Nothing the final file gave the lines is disturbed by the merge.
    expect(batch.lines.map((l: any) => l.priceCny)).toEqual([19, 25, 25, 25, 19, 19, 19]);
    assertFinalBatch(batch);
  });

  it('a re-save through the edit modal keeps the box data and the receiving date', () => {
    const stand = freshStand();
    importArrival(stand, null);
    const draft = stand.getChinaBatches().batches[0];
    const parsedFinal = parseChinaBatchFile(BATCH_FILE_30)!;
    const { form: finalForm } = chinaFormFromFiles(parsedFinal, report, draft);
    finalForm.rubRate = '12,4';
    stand.saveChinaBatch(chinaFormToPayload(finalForm), 'Николай');
    const before = stand.getChinaBatches().batches[0];

    // The owner opens the saved batch in the modal and saves it back untouched.
    const roundTripForm = chinaBatchToForm(before);
    const after = stand.saveChinaBatch(chinaFormToPayload(roundTripForm), 'Николай').batches[0];

    expect(after.receivedAt).toBe(before.receivedAt);
    expect(after.receivedAt).toBe('2026-09-23');
    expect(after.lines.map((l: any) => l.factoryBoxKg)).toEqual(before.lines.map((l: any) => l.factoryBoxKg));
    expect(after.lines.map((l: any) => l.boxLengthM)).toEqual(before.lines.map((l: any) => l.boxLengthM));
    assertFinalBatch(after);
  });
});

/**
 * Item 81g: payments distributed by the Chinese financial report, end to end — the owner's real
 * report through `chinaReportPayload` into `saveChinaReport`, a real batch (NV-0923-4, order 30)
 * costed against it, two of the owner's own payments matched automatically, the freight FIFO in
 * dollars, the missing-list and the closing tick, and a second report that moves money between
 * orders without a new transfer. Every number below was independently derived in Python first —
 * see the coordinator's report for the script and its output.
 */
describe('item 81g: payments distributed by the financial report', () => {
  it('the report lands in the sheet with the receipts the payload grouped, conserving the money', () => {
    const stand = freshStand();
    const payload = chinaReportPayload(report);

    // Σ receivedCny over the orders = Σ goodsCny of the receipts (the carried-over 结转 line
    // included as its own receipt) — 229 111 ¥, independently derived in Python.
    const sumOfOrders = payload.orders.reduce((s, o) => s + o.receivedCny, 0);
    expect(Math.round(sumOfOrders * 100) / 100).toBe(229111);

    const state = stand.saveChinaReport(payload, 'Николай');
    expect(state.warnings).toEqual([]);

    const money = stand.getChinaMoney();
    // One receipt per date the payload grouped, PLUS the carried-over line — nothing split,
    // nothing merged.
    expect(money.receipts).toHaveLength(payload.receipts.length + 1);
    const sumOfReceiptGoods = money.receipts.reduce((s: number, r: any) => s + r.goodsCny, 0);
    expect(Math.round(sumOfReceiptGoods * 100) / 100).toBe(229111);
    payload.receipts.forEach((r) => {
      const stored = money.receipts.find((x: any) => x.date === r.date);
      expect(stored).toBeTruthy();
      expect([stored.goodsCny, stored.freightCny, stored.freightUsd, stored.cargoRate])
        .toEqual([r.goodsCny, r.freightCny, r.freightUsd, r.cargoRate]);
    });
    const carriedOver = money.receipts.find((x: any) => x.goodsCny === 17402);
    expect(carriedOver).toBeTruthy();
    expect(carriedOver.status).toBe('история'); // before CHINA_TRACKING_START_DATE
  });

  it('the final batch, two owner payments matched automatically, the freight FIFO, missing and closing', () => {
    const stand = freshStand();
    const payload = chinaReportPayload(report);
    stand.saveChinaReport(payload, 'Николай');

    const parsedFinal = parseChinaBatchFile(BATCH_FILE_30)!;
    const { form } = chinaFormFromFiles(parsedFinal, report, null);
    form.status = 'Прибыла'; // the owner confirms the goods physically arrived
    const afterImport = stand.saveChinaBatch(chinaFormToPayload(form), 'Николай');
    const imported = afterImport.batches[0];
    expect(imported.code).toBe('NV-0923-4');
    expect(imported.orderNo).toBe('30');

    // The store's own payload shape — date, rubles, rate, comment; nothing else.
    stand.saveChinaPayment({ date: '2026-09-16', amountRub: 92541.2, rate: 12.4, comment: 'оплатил 92541.20 по курсу 12,4' }, 'Николай');
    stand.saveChinaPayment({ date: '2026-09-18', amountRub: 116600, rate: 12.5, comment: 'оплатил 116600 по курсу 12,5' }, 'Николай');

    const moneyAfterPayments = stand.getChinaMoney();
    const matched1 = moneyAfterPayments.payments.find((p: any) => p.date === '2026-09-16');
    const matched2 = moneyAfterPayments.payments.find((p: any) => p.date === '2026-09-18');
    expect(matched1.status).toBe('распределена'); // one candidate each, both auto-matched
    expect(matched2.status).toBe('распределена');
    expect(matched1.actualRate).toBe(12.4);
    expect(matched2.actualRate).toBe(12.5);

    // The whole ChinaMoney shape ChinaPaymentsCard reads, with real values in it — every field
    // it reads exists and has the type the component expects.
    const p = matched1;
    ['id', 'date', 'comment', 'user', 'status', 'receiptId'].forEach((k) => expect(typeof p[k]).toBe('string'));
    ['amountRub', 'rate', 'amountCny', 'reportCny', 'actualRate'].forEach((k) => expect(typeof p[k]).toBe('number'));
    expect(Array.isArray(p.candidates)).toBe(true);
    const r = moneyAfterPayments.receipts.find((x: any) => x.id === p.receiptId);
    expect(r).toBeTruthy();
    ['id', 'date', 'goodsCny', 'freightCny', 'freightUsd', 'cargoRate', 'totalCny', 'status', 'paymentId', 'rubGoods', 'rubFreight']
      .forEach((k) => expect(r).toHaveProperty(k));
    const o30 = moneyAfterPayments.orders.find((x: any) => x.orderNo === '30');
    ['orderNo', 'date', 'totalCny', 'receivedCny', 'unpaidCny', 'knownCny', 'knownRub', 'rate', 'pendingCny', 'historyCny', 'advanceWarning']
      .forEach((k) => expect(o30).toHaveProperty(k));
    ['cny', 'knownCny', 'knownRub', 'pendingCny', 'historyCny'].forEach((k) => expect(moneyAfterPayments.pool).toHaveProperty(k));
    ['id', 'loadedAt', 'reportDate', 'source', 'aiReason'].forEach((k) => expect(moneyAfterPayments.reports[0]).toHaveProperty(k));

    // Order 30's known rate — 92541.20 ₽ of the 5001+2462=7463 ¥ receipt of 2026-09-16 bought
    // its own 4056 ¥ lot at the SAME rate the receipt as a whole was matched at: 12.4.
    expect([o30.knownCny, o30.knownRub, o30.rate]).toEqual([4056, 50294.4, 12.4]);

    const batch = stand.getChinaBatches().batches[0];
    expect([batch.rubRate, batch.rubRateSource, batch.goodsRate, batch.goodsRateSource]).toEqual([12.4, 'оплаты', 12.4, 'оплаты']);

    // Freight FIFO in dollars, independently derived in Python: NV-0923-4 is unpaid in full
    // (the $ queue ran dry before reaching it), NV-0825-2 is paid by 351+1286 across two
    // receipts, NV-0916-24 gets only 46 of its 1109 — total unpaid 2646+1063 = 3709 $, the
    // report's own footer figure.
    expect(batch.missing).toEqual(expect.arrayContaining(['перевозка не оплачена полностью (2646 $)', 'расходы РФ не подтверждены']));
    expect(batch.missing).not.toEqual(expect.arrayContaining(['статус не «Прибыла»']));
    expect(batch.missing).not.toEqual(expect.arrayContaining(['не загружен файл партии (нет веса или перевозки)']));
    expect(batch.missing).not.toEqual(expect.arrayContaining(['в отчёте нет накладной карго на эту партию']));
    expect(batch.closed).toBe(false);

    // setChinaRubCostsDone round trip: marks the Russian costs confirmed, then back.
    const done = stand.setChinaRubCostsDone({ batchId: batch.id, done: true }, 'Николай');
    const doneBatch = done.batches[0];
    expect(doneBatch.rubCostsDone).toBe(true);
    expect(doneBatch.missing).not.toEqual(expect.arrayContaining(['расходы РФ не подтверждены']));
    expect(doneBatch.missing).toEqual(expect.arrayContaining(['перевозка не оплачена полностью (2646 $)']));
    expect(doneBatch.closed).toBe(false); // the freight is still unpaid

    const undone = stand.setChinaRubCostsDone({ batchId: batch.id, done: false }, 'Николай');
    expect(undone.batches[0].rubCostsDone).toBe(false);
    expect(undone.batches[0].missing).toEqual(expect.arrayContaining(['расходы РФ не подтверждены']));
  });

  it('a second report of the same latest date moving 1 000 ¥ from order 29 to 30 is APPLIED, not a no-op', () => {
    const stand = freshStand();
    const payload = chinaReportPayload(report);
    stand.saveChinaReport(payload, 'Николай');

    const parsedFinal = parseChinaBatchFile(BATCH_FILE_30)!;
    const { form } = chinaFormFromFiles(parsedFinal, report, null);
    form.status = 'Прибыла';
    stand.saveChinaBatch(chinaFormToPayload(form), 'Николай');
    stand.saveChinaPayment({ date: '2026-09-16', amountRub: 92541.2, rate: 12.4, comment: '' }, 'Николай');
    stand.saveChinaPayment({ date: '2026-09-18', amountRub: 116600, rate: 12.5, comment: '' }, 'Николай');

    const before = stand.getChinaMoney().orders.find((o: any) => o.orderNo === '30');
    expect([before.knownCny, before.pendingCny, before.knownRub]).toEqual([4056, 0, 50294.4]);

    const moved: typeof payload = JSON.parse(JSON.stringify(payload));
    moved.orders = moved.orders.map((o) => {
      if (o.orderNo === '29') return { ...o, receivedCny: o.receivedCny - 1000 };
      if (o.orderNo === '30') return { ...o, receivedCny: o.receivedCny + 1000 };
      return o;
    });
    const applied = stand.saveChinaReport(moved, 'Николай');
    expect(applied).toBeTruthy(); // not the identical-report no-op shape

    const after = stand.getChinaMoney().orders.find((o: any) => o.orderNo === '30');
    // Independently derived in Python (a same-date revision REPLACES the stored report row, so
    // `chinaAllocateGoodsLedger` sees only ONE report and re-runs the whole FIFO baseline fresh
    // against the new receivedCny totals, not an incremental release/take): order 29 keeps only
    // its 1 974 ¥ from 2026-09-03, and order 30 now takes the REST of that day (55 ¥, still
    // unpaid) plus the WHOLE 2026-09-16 receipt (5 001 ¥, matched at 12.4) — so its known ¥ grows
    // from 4 056 to the full 5 001 of that receipt, not just the 1 000 ¥ that moved.
    expect([after.knownCny, after.pendingCny, after.knownRub, after.rate]).toEqual([5001, 55, 62012.4, 12.4]);
    expect(Math.round((after.knownRub - before.knownRub) * 100) / 100).toBe(11718);
  });

  /**
   * Found by this end-to-end test on 2026-09-25: the script wrote a matched payment's status as
   * 'сопоставлено' (the RECEIPT's word), while `ChinaMoneyPayment.status` and the payments card
   * filter on 'распределена', so a matched payment dropped out of both tables of the card. The
   * script now writes 'распределена' for the payment; this test keeps the two sides in step.
   */
  it('a matched payment\'s status is the string ChinaPaymentsCard\'s "allocated" filter expects', () => {
    const stand = freshStand();
    const payload = {
      reportDate: '2026-09-11', source: 'скрипт' as const, aiReason: '', carriedOverCny: 0, openingFreightUsd: 0,
      orders: [], freights: [], warnings: [],
      receipts: [{ date: '2026-09-10', goodsCny: 1000, freightCny: 0, freightUsd: 0, cargoRate: 0, note: '' }]
    };
    stand.saveChinaReport(payload, 'Николай');
    stand.saveChinaPayment({ date: '2026-09-10', amountRub: 12400, rate: 12.4, comment: '' }, 'Николай');
    const matched = stand.getChinaMoney().payments[0];
    // ChinaPaymentsCard.tsx: `payments.filter((p) => p.status === 'распределена')`.
    expect(matched.status).toBe('распределена');
  });

  it('an older report is refused in Russian; the identical report is a no-op', () => {
    const stand = freshStand();
    const payload = chinaReportPayload(report);
    stand.saveChinaReport(payload, 'Николай');

    const older: typeof payload = { ...payload, reportDate: '2026-01-01' };
    expect(() => stand.saveChinaReport(older, 'Николай')).toThrow(/старше/);

    const before = stand.getChinaMoney();
    const again = stand.saveChinaReport(payload, 'Николай');
    expect(again.warnings).toEqual([]);
    const after = stand.getChinaMoney();
    expect(after.reports).toHaveLength(before.reports.length);
    expect(after.orders.find((o: any) => o.orderNo === '30')).toEqual(before.orders.find((o: any) => o.orderNo === '30'));
  });

  it('a pending payment with two fitting receipts lists both as candidates, and matches the one the owner picks', () => {
    const stand = freshStand();
    const payload = {
      reportDate: '2026-09-11', source: 'скрипт' as const, aiReason: '', carriedOverCny: 0, openingFreightUsd: 0,
      orders: [], freights: [], warnings: [],
      receipts: [
        { date: '2026-09-10', goodsCny: 1000, freightCny: 0, freightUsd: 0, cargoRate: 0, note: '' },
        { date: '2026-09-11', goodsCny: 1000, freightCny: 0, freightUsd: 0, cargoRate: 0, note: '' }
      ]
    };
    stand.saveChinaReport(payload, 'Николай');

    const state = stand.saveChinaPayment({ date: '2026-09-10', amountRub: 12400, rate: 12.4, comment: '' }, 'Николай');
    const paymentId = stand.getChinaMoney().payments[0].id;
    const money = stand.getChinaMoney();
    const pending = money.payments.find((p: any) => p.id === paymentId);
    expect(pending.status).toBe('не распределена'); // ambiguous — never auto-matched
    expect(pending.candidates.sort()).toEqual(money.receipts.map((r: any) => r.id).sort());
    expect(pending.candidates).toHaveLength(2);
    money.receipts.forEach((r: any) => expect(pending.candidates).toContain(r.id));

    const chosen = money.receipts[0].id;
    const matched = stand.matchChinaPayment({ paymentId, receiptId: chosen }, 'Николай');
    const matchedPayment = stand.getChinaMoney().payments.find((p: any) => p.id === paymentId);
    expect(matchedPayment.status).toBe('распределена');
    expect(matchedPayment.receiptId).toBe(chosen);
    const other = stand.getChinaMoney().receipts.find((r: any) => r.id !== chosen);
    expect(other.status).toBe('ждёт оплату'); // the one NOT picked stays free
    expect(matched).toBeTruthy();
  });
});
