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
import { BATCH_FILE_27, BATCH_FILE_28, REPORT_FILE } from './chinaFiles.fixture';
import { parseChinaBatchFile, parseChinaReportFile } from './chinaFileParse';
import { chinaFormFromFiles, chinaFormToPayload, chinaGroupIds } from './chinaBatchForm';
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
