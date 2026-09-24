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
import { parseChinaArrivalFile, parseChinaBatchFile, parseChinaReportFile } from './chinaFileParse';
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
