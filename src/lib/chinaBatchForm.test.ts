import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  chinaNumber, emptyChinaBatchForm, emptyChinaLine, chinaBatchToForm, chinaFormToPayload,
  chinaFormCounts, chinaGroupIds, chinaLevelledIndexes, chinaArticleConflicts, validateChinaBatchForm, chinaFilledLines,
  chinaFormFromFiles, chinaFormFromArrival, ChinaBatchForm, chinaMatchFinalBatch, chinaMatchArrivalBatch,
  chinaMarkingMatches, chinaRateSourceLabel, chinaRateStatusText, chinaShowWeightFactor, chinaFreightPerKgLabel,
  chinaCheckMark,
  chinaTariffRateUnit,
  chinaGroupThousands, chinaRemainingText, chinaEtaText, chinaCmToM, chinaMToCm,
  chinaDefaultCostRows, chinaCostRowsOf, chinaCostRowsPayload, chinaRubText, chinaNumText,
  chinaPostQtyError, chinaPostPricePerUnit, chinaPostingBadge
} from './chinaBatchForm';
import { parseChinaArrivalFile, parseChinaBatchFile, parseChinaReportFile } from './chinaFileParse';
import { ARRIVAL_FILE_NV0923, ARRIVAL_FILE_NV0916, BATCH_FILE_28, BATCH_FILE_27, BATCH_FILE_30, REPORT_FILE } from './chinaFiles.fixture';
import { ChinaBatch, ChinaBatchLine } from '../types';

/** A saved batch, filled in only where the test needs it — item 81e added 12 fields to the shape. */
const makeBatch = (overrides: Partial<ChinaBatch>): ChinaBatch => ({
  id: '', orderNo: '', code: '', shippedAt: '', arrivedAt: '', receivedAt: '', status: 'Прибыла',
  goodsCny: 0, chinaDeliveryCny: 0, weightKg: 0, volumeM3: 0, ratePerKgUsd: 0, packingUsd: 0,
  otherCargoUsd: 0, freightUsd: 0, cargoRate: 0, freightCny: 0, rubCosts: 0, rubRate: 0,
  manualRate: 0, rubRateSource: '', paidCny: 0, unpaidCny: 0, totalRub: 0, weightFactor: null,
  comment: '', user: '', updatedAt: '', lines: [], costs: [], payments: [],
  goodsKg: 0, goodsVolumeM3: 0, packagingKg: 0, packagingM3: 0, goodsDensity: 0, packedDensity: 0,
  tariffBasis: '', packagingUsd: 0, goodsFreightUsd: 0, packagingRub: 0, goodsFreightRub: 0,
  packagingShareFreight: 0, packagingShareCost: 0, goodsFreightShareCost: 0,
  ...overrides
});

/** A saved line, filled in only where the test needs it. */
const makeLine = (overrides: Partial<ChinaBatchLine>): ChinaBatchLine => ({
  id: '', batchId: '', marking: '', name: '', boxes: 0, pcsPerBox: 0, qty: 0, priceCny: 0,
  sumCny: 0, pallet: '', palletWeightKg: 0, boxWeightKg: 0, boxLengthM: 0, boxWidthM: 0,
  boxHeightM: 0, factoryBoxKg: 0, weightKg: 0, weightSource: '', chinaShareCny: 0,
  freightShareCny: 0, rubShare: 0, costRub: 0, unitRub: 0, article: '', group: '',
  boxVolumeM3: 0, goodsKg: 0, densityKgM3: 0, kgPerPiece: 0,
  ...overrides
});

const filledForm = (): ChinaBatchForm => ({
  ...emptyChinaBatchForm(),
  code: 'NV-0825-2',
  orderNo: '28',
  shippedAt: '2026-08-27',
  arrivedAt: '2026-09-17',
  status: 'Прибыла',
  chinaDeliveryCny: '700',
  weightKg: '672,5',
  ratePerKgUsd: '2.3',
  packingUsd: '90',
  freightUsd: '1636.75',
  rubRate: '12,4',
  lines: [
    { ...emptyChinaLine(), marking: 'NV-99', boxes: '30', pcsPerBox: '8', qty: '240', priceCny: '20.3', palletWeightKg: '339' },
    { ...emptyChinaLine(), marking: 'NV-99', boxes: '15', pcsPerBox: '8', qty: '120', priceCny: '20.3' },
    { ...emptyChinaLine(), marking: 'NV-98', boxes: '15', pcsPerBox: '8', qty: '120', priceCny: '20.3', palletWeightKg: '333.5' }
  ]
});

describe('chinaNumber', () => {
  it('takes a comma as the decimal point', () => {
    expect(chinaNumber('672,5')).toBe(672.5);
  });

  it('ignores the spaces of a pasted number', () => {
    expect(chinaNumber('11 457,25')).toBe(11457.25);
  });

  it('reads a number pasted from an English sheet, where the comma separates thousands', () => {
    expect(chinaNumber('1,636.75')).toBe(1636.75);
    expect(chinaNumber('11,457.25')).toBe(11457.25);
  });

  it('turns an empty field and nonsense into zero', () => {
    expect(chinaNumber('')).toBe(0);
    expect(chinaNumber('около трёх')).toBe(0);
  });
});

// Item 81i: the box dims travel through the form in metres but the modal shows them in
// centimetres — round-tripping must not leave float noise like "0.5499999999999999" behind.
describe('centimetres <-> metres of a box, round-tripped through the modal', () => {
  it('55 cm <-> 0.55 m', () => {
    expect(chinaCmToM('55')).toBe('0.55');
    expect(chinaMToCm('0.55')).toBe('55');
  });

  it('45.5 cm <-> 0.455 m', () => {
    expect(chinaCmToM('45.5')).toBe('0.455');
    expect(chinaMToCm('0.455')).toBe('45.5');
  });

  it('an empty field stays empty in either direction', () => {
    expect(chinaCmToM('')).toBe('');
    expect(chinaMToCm('')).toBe('');
  });
});

describe('the payload of a batch', () => {
  it('sends numbers as numbers, so the script parses nothing', () => {
    const payload = chinaFormToPayload(filledForm()) as Record<string, unknown>;
    expect(payload.weightKg).toBe(672.5);
    expect(payload.rubRate).toBe(12.4);
    const lines = payload.lines as Record<string, unknown>[];
    expect(lines[0].qty).toBe(240);
    expect(lines[0].palletWeightKg).toBe(339);
  });

  // Item 81i: the box's own dims and the factory's own box weight — read from the arrival file,
  // shown and editable in the modal — must reach `saveChinaBatch` alongside everything else.
  it('carries the box dims and the factory box weight of a line', () => {
    const form = filledForm();
    form.lines = [{
      ...emptyChinaLine(), marking: 'NV-101', qty: '10',
      boxLengthM: '0.32', boxWidthM: '0.59', boxHeightM: '0.43', factoryBoxKg: '8.4'
    }];
    const payload = chinaFormToPayload(form) as Record<string, unknown>;
    const line = (payload.lines as Record<string, unknown>[])[0];
    expect(line).toMatchObject({ boxLengthM: 0.32, boxWidthM: 0.59, boxHeightM: 0.43, factoryBoxKg: 8.4 });
  });

  it('leaves out the id of a batch that does not exist yet', () => {
    expect(chinaFormToPayload(filledForm())).not.toHaveProperty('id');
    expect(chinaFormToPayload({ ...filledForm(), id: 'CB1' })).toHaveProperty('id', 'CB1');
  });

  it('trims what the owner typed', () => {
    const form = { ...filledForm(), code: '  NV-0825-2  ' };
    form.lines = [{ ...emptyChinaLine(), marking: ' NV-99 ', qty: '10', article: ' BOX ' }];
    const payload = chinaFormToPayload(form) as Record<string, unknown>;
    expect(payload.code).toBe('NV-0825-2');
    expect((payload.lines as Record<string, unknown>[])[0].article).toBe('BOX');
  });
});

describe('a batch opened for editing', () => {
  it('comes back with the same numbers it was saved with', () => {
    const batch = {
      id: 'CB1', orderNo: '28', code: 'NV-0825-2', shippedAt: '2026-08-27', arrivedAt: '2026-09-17',
      receivedAt: '', status: 'Прибыла', goodsCny: 9744, chinaDeliveryCny: 700, weightKg: 672.5, volumeM3: 4.92,
      ratePerKgUsd: 2.3, packingUsd: 90, otherCargoUsd: 0, freightUsd: 1636.75, cargoRate: 7,
      freightCny: 11457.25, rubCosts: 0, rubRate: 12.4, totalRub: 271575.49, weightFactor: 0.7987,
      comment: '', user: 'Николай', updatedAt: '2026-09-22 20:00:00',
      lines: [{
        id: 'CB1-1', batchId: 'CB1', marking: 'NV-99', name: '收纳盒', boxes: 30, pcsPerBox: 8,
        qty: 240, priceCny: 20.3, sumCny: 4872, pallet: '1', palletWeightKg: 339, boxWeightKg: 0,
        boxLengthM: 0, boxWidthM: 0, boxHeightM: 0, factoryBoxKg: 0,
        weightKg: 270.76, weightSource: 'паллета', chinaShareCny: 281.83, freightShareCny: 4612.83,
        rubShare: 0, costRub: 121106.58, unitRub: 504.61, article: 'BOX', group: '',
        boxVolumeM3: 0, goodsKg: 0, densityKgM3: 0, kgPerPiece: 0
      }],
      costs: [], payments: [], rubRateSource: 'вручную', manualRate: 12.4, paidCny: 0, unpaidCny: 0,
      goodsKg: 0, goodsVolumeM3: 0, packagingKg: 0, packagingM3: 0, goodsDensity: 0, packedDensity: 0,
      tariffBasis: '', packagingUsd: 0, goodsFreightUsd: 0, packagingRub: 0, goodsFreightRub: 0,
      packagingShareFreight: 0, packagingShareCost: 0, goodsFreightShareCost: 0
    } as ChinaBatch;
    const form = chinaBatchToForm(batch);
    expect(form.weightKg).toBe('672.5');
    // The window offers the rate the owner TYPED, never the one payments gave the batch:
    // saving the window untouched would otherwise make the payments' rate the typed one.
    const paidFor = chinaBatchToForm({ ...batch, rubRate: 11, manualRate: 12.4, rubRateSource: 'оплаты' });
    expect(paidFor.rubRate).toBe('12.4');
    expect(form.lines[0].qty).toBe('240');
    expect(form.lines[0].article).toBe('BOX');
    // A zero is an empty field, not the digit 0: the owner sees a blank to fill in.
    expect(form.lines[0].boxWeightKg).toBe('');
  });
});

describe('what the form counts', () => {
  it('counts rows, boxes and pieces of the filled lines only', () => {
    const form = filledForm();
    form.lines.push(emptyChinaLine());
    expect(chinaFormCounts(form.lines)).toEqual({ rows: 3, boxes: 60, qty: 480 });
  });

  it('drops the empty tail rows before sending', () => {
    const form = filledForm();
    form.lines.push(emptyChinaLine(), emptyChinaLine());
    expect(chinaFilledLines(form.lines)).toHaveLength(3);
  });
});

describe('which lines are one product', () => {
  it('two lines of one marking are one product', () => {
    const lines = [{ marking: 'NV-99' }, { marking: 'NV-99' }, { marking: 'NV-98' }];
    expect(Array.from(chinaLevelledIndexes(lines))).toEqual([0, 1]);
  });

  it('an article on ONE of two lines of a marking does not split them (review 2026-09-24)', () => {
    const lines = [{ marking: 'NV-99', article: 'BOX-WHITE' }, { marking: 'NV-99' }, { marking: 'NV-98' }];
    const ids = chinaGroupIds(lines);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[2]).not.toBe(ids[0]);
  });

  it('ties two colours together by the marker, across their own articles', () => {
    const lines = [
      { marking: 'NV-99', article: 'BOX-WHITE', group: 'короб 8 шт' },
      { marking: 'NV-98', article: 'BOX-GREY', group: 'короб 8 шт' }
    ];
    expect(Array.from(chinaLevelledIndexes(lines))).toEqual([0, 1]);
  });

  it('sameness chains from marking to article to marker', () => {
    const ids = chinaGroupIds([
      { marking: 'NV-1' },
      { marking: 'NV-1', article: 'P' },
      { marking: 'NV-2', article: 'P', group: 'G' },
      { marking: 'NV-3', group: 'G' },
      { marking: 'NV-4' }
    ]);
    expect(new Set(ids.slice(0, 4)).size).toBe(1);
    expect(ids[4]).not.toBe(ids[0]);
  });

  it('a marker equal to someone else\u2019s article is still a different kind of thing', () => {
    // The marker «BOX» and the article «BOX» are not the same identifier.
    const ids = chinaGroupIds([{ marking: 'NV-1', group: 'BOX' }, { marking: 'NV-2', article: 'BOX' }]);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('says so when one marking was given two different articles', () => {
    const lines = [{ marking: 'NV-99', article: 'BOX-WHITE' }, { marking: 'NV-99', article: 'BOX-GREY' }, { marking: 'NV-98', article: 'BOX-GREY' }];
    const conflicts = chinaArticleConflicts(lines);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toContain('NV-99');
    expect(conflicts[0]).toContain('BOX-WHITE, BOX-GREY');
    expect(chinaArticleConflicts([{ marking: 'NV-99', article: 'A' }, { marking: 'NV-99', article: 'A' }])).toEqual([]);
  });
});

describe('what the form refuses before the round trip', () => {
  it('accepts the batch of the real file', () => {
    expect(validateChinaBatchForm(filledForm())).toEqual([]);
  });

  it('refuses a batch with no code and no lines', () => {
    const errors = validateChinaBatchForm(emptyChinaBatchForm());
    expect(errors).toContain('Не указан код партии');
    expect(errors).toContain('В партии нет ни одной строки товара');
  });

  it('refuses a line without a marking and a line without pieces', () => {
    const form = filledForm();
    form.lines[0].marking = '';
    form.lines[1].qty = '0';
    const errors = validateChinaBatchForm(form);
    expect(errors).toContain('В строке 1 не указана маркировка');
    expect(errors).toContain('В строке 2 количество должно быть больше нуля');
  });

  it('refuses a date in another format, the way the script does', () => {
    const form = filledForm();
    form.shippedAt = '27.08.2026';
    expect(validateChinaBatchForm(form)).toContain('Дата отгрузки должна быть в формате ГГГГ-ММ-ДД');
  });

  it('lets an empty date through: not every batch has arrived', () => {
    const form = filledForm();
    form.arrivedAt = '';
    expect(validateChinaBatchForm(form)).toEqual([]);
  });

  it('refuses a status the script does not know', () => {
    expect(validateChinaBatchForm({ ...filledForm(), status: 'Прилетела' }))
      .toContain('Неизвестный статус партии');
  });
});

describe('партия, собранная из файлов китайцев', () => {
  const parsed = parseChinaBatchFile(BATCH_FILE_28)!;
  const report = parseChinaReportFile(REPORT_FILE)!;

  it('fills the batch from the waybill and the three missing fields from the report', () => {
    const { form, notes } = chinaFormFromFiles(parsed, report, null);
    expect(form.code).toBe('NV-0825-2');
    expect(form.shippedAt).toBe('2026-08-27');
    expect(form.weightKg).toBe('672.5');
    expect(form.volumeM3).toBe('4.92');
    expect(form.ratePerKgUsd).toBe('2.3');
    expect(form.packingUsd).toBe('90');
    expect(form.freightUsd).toBe('1636.75');
    expect(form.chinaDeliveryCny).toBe('700');
    // From the running account, nowhere else:
    expect(form.orderNo).toBe('28');
    expect(form.arrivedAt).toBe('2026-09-17');
    expect(form.cargoRate).toBe('7');
    expect(form.status).toBe('Прибыла');
    expect(notes.join(' ')).toContain('Из отчёта: заказ №28, прибытие 2026-09-17, курс 7 ¥/$');
  });

  it('fills the three lines of the file and leaves our articles to the owner', () => {
    const { form } = chinaFormFromFiles(parsed, report, null);
    expect(form.lines.map((l) => [l.marking, l.boxes, l.qty, l.priceCny, l.palletWeightKg])).toEqual([
      ['NV-99', '30', '240', '20.3', '339'],
      ['NV-99', '15', '120', '20.3', ''],
      ['NV-98', '15', '120', '20.3', '333.5']
    ]);
    expect(form.lines.every((l) => l.article === '' && l.group === '')).toBe(true);
  });

  it('asks for the ruble rate, which no file of theirs can know', () => {
    const { form, notes } = chinaFormFromFiles(parsed, report, null);
    expect(form.rubRate).toBe('');
    expect(notes.join(' ')).toContain('Курс ₽/¥ не заполнен');
  });

  it('is a batch in transit while the report has no arrival date', () => {
    const fresh = parseChinaBatchFile(BATCH_FILE_27)!;
    const noArrival = { ...report, freights: report.freights.map((f) => ({ ...f, arrivedAt: '' })) };
    const { form } = chinaFormFromFiles(fresh, noArrival, null);
    expect(form.arrivedAt).toBe('');
    expect(form.status).toBe('В пути');
  });

  it('says what it could not fill without the report', () => {
    const { form, notes } = chinaFormFromFiles(parsed, null, null);
    expect(form.orderNo).toBe('');
    expect(form.cargoRate).toBe('');
    expect(notes.join(' ')).toContain('Финансовый отчёт не загружен');
  });

  it('says so when the report knows nothing about this batch', () => {
    const { notes } = chinaFormFromFiles({ ...parsed, code: 'NV-9999-9' }, report, null);
    expect(notes.join(' ')).toContain('В отчёте нет партии NV-9999-9');
  });

  // The whole point of a re-import: the file is the same, the owner's work on it is not.
  it('updates the batch already saved instead of creating a second one', () => {
    const saved = {
      id: 'CB7', orderNo: '28', code: 'NV-0825-2', shippedAt: '2026-08-27', arrivedAt: '2026-09-17',
      receivedAt: '', status: 'Прибыла', goodsCny: 9744, chinaDeliveryCny: 700, weightKg: 672.5, volumeM3: 4.92,
      ratePerKgUsd: 2.3, packingUsd: 90, otherCargoUsd: 0, freightUsd: 1636.75, cargoRate: 7,
      freightCny: 11457.25, rubCosts: 0, rubRate: 12.4, totalRub: 271575.49, weightFactor: 0.7987,
      comment: 'первая партия коробов', user: 'Николай', updatedAt: '2026-09-24 10:00:00',
      lines: [
        {
          id: 'CB7-1', batchId: 'CB7', marking: 'NV-99', name: '', boxes: 30, pcsPerBox: 8, qty: 240, priceCny: 20.3, sumCny: 4872, pallet: '', palletWeightKg: 339, boxWeightKg: 11.2,
          boxLengthM: 0.4, boxWidthM: 0.3, boxHeightM: 0.2, factoryBoxKg: 11.2,
          weightKg: 336, weightSource: 'вручную', chinaShareCny: 0, freightShareCny: 0, rubShare: 0, costRub: 0, unitRub: 0, article: 'BOX-WHITE', group: 'короб 8 шт',
          boxVolumeM3: 0, goodsKg: 0, densityKgM3: 0, kgPerPiece: 0
        },
        {
          id: 'CB7-2', batchId: 'CB7', marking: 'NV-99', name: '', boxes: 15, pcsPerBox: 8, qty: 120, priceCny: 20.3, sumCny: 2436, pallet: '', palletWeightKg: 0, boxWeightKg: 0,
          boxLengthM: 0, boxWidthM: 0, boxHeightM: 0, factoryBoxKg: 0,
          weightKg: 168, weightSource: 'вручную', chinaShareCny: 0, freightShareCny: 0, rubShare: 0, costRub: 0, unitRub: 0, article: 'BOX-WHITE', group: 'короб 8 шт',
          boxVolumeM3: 0, goodsKg: 0, densityKgM3: 0, kgPerPiece: 0
        },
        {
          id: 'CB7-3', batchId: 'CB7', marking: 'NV-98', name: '', boxes: 15, pcsPerBox: 8, qty: 120, priceCny: 20.3, sumCny: 2436, pallet: '', palletWeightKg: 333.5, boxWeightKg: 10.93,
          boxLengthM: 0, boxWidthM: 0, boxHeightM: 0, factoryBoxKg: 0,
          weightKg: 164, weightSource: 'вручную', chinaShareCny: 0, freightShareCny: 0, rubShare: 0, costRub: 0, unitRub: 0, article: 'BOX-GREY', group: 'короб 8 шт',
          boxVolumeM3: 0, goodsKg: 0, densityKgM3: 0, kgPerPiece: 0
        }
      ],
      costs: [], payments: [], rubRateSource: 'вручную', manualRate: 12.4, paidCny: 0, unpaidCny: 0,
      goodsKg: 0, goodsVolumeM3: 0, packagingKg: 0, packagingM3: 0, goodsDensity: 0, packedDensity: 0,
      tariffBasis: '', packagingUsd: 0, goodsFreightUsd: 0, packagingRub: 0, goodsFreightRub: 0,
      packagingShareFreight: 0, packagingShareCost: 0, goodsFreightShareCost: 0
    } as ChinaBatch;
    const { form, notes } = chinaFormFromFiles(parsed, report, saved);
    expect(form.id).toBe('CB7');
    expect(form.rubRate).toBe('12.4');
    expect(form.comment).toBe('первая партия коробов');
    expect(form.lines.map((l) => l.article)).toEqual(['BOX-WHITE', 'BOX-WHITE', 'BOX-GREY']);
    expect(form.lines.map((l) => l.group)).toEqual(['короб 8 шт', 'короб 8 шт', 'короб 8 шт']);
    // The box weight the owner measured himself survives too.
    expect(form.lines[2].boxWeightKg).toBe('10.93');
    // Item 81e / item d fix: the box measurements of ONE saved line reach BOTH parsed lines of
    // the same marking, not only the first — `carry` used to splice its match away.
    expect(form.lines[0].boxLengthM).toBe('0.4');
    expect(form.lines[1].boxLengthM).toBe('0.4');
    expect(form.lines[1].factoryBoxKg).toBe('11.2');
    expect(notes.join(' ')).toContain('будет обновлена');
  });

  it('passes on what does not add up in the file', () => {
    const broken = { ...parsed, warnings: ['Вес: паллеты в сумме 500 кг, в накладной 672,5 кг'] };
    const { warnings } = chinaFormFromFiles(broken, report, null);
    expect(warnings).toEqual(['Вес: паллеты в сумме 500 кг, в накладной 672,5 кг']);
  });
});

// Item 81b. Wiring guards: the screen, the store, the proxy and the script speak about the
// same module, and the browser never works out money of its own.
describe('подключение модуля «Заказы в Китае»', () => {
  const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
  const tab = read('src/components/ChinaOrdersTab.tsx');
  const modal = read('src/components/ChinaBatchModal.tsx');
  const store = read('src/store/useChinaStore.ts');
  const app = read('src/App.tsx');
  const sidebar = read('src/components/Sidebar.tsx');
  const server = read('server.ts');
  const script = read('ChinaOrders.gs');

  it('the tab is reachable, and only by an administrator', () => {
    expect(sidebar).toContain("id: 'china', label: 'Заказы в Китае'");
    expect(sidebar.indexOf("id: 'china'")).toBeGreaterThan(sidebar.indexOf('isCurrentUserAdmin ? ['));
    expect(app).toContain("activeTab === 'china' && isAdmin && <ChinaOrdersTab");
  });

  it('the store calls exactly the actions the script routes', () => {
    ['getChinaBatches', 'setupChinaSpreadsheet', 'saveChinaBatch', 'deleteChinaBatch',
      'saveChinaBatchCost', 'deleteChinaBatchCost'].forEach((action) => {
      expect(store).toContain(`'${action}'`);
      expect(script).toContain(`function ${action}(`);
    });
  });

  it('the proxy treats the read as a read and drops it after every write', () => {
    expect(server).toContain("'getChinaBatches'");
    ['setupChinaSpreadsheet', 'saveChinaBatch', 'deleteChinaBatch', 'saveChinaBatchCost', 'deleteChinaBatchCost']
      .forEach((action) => expect(server).toContain(`${action}: ['getChinaBatches'`));
    // Item 81g: a write can change the money of every order, so the batch writes drop the
    // money read as well. Item 82: tariffs/boxes/vs-fact derive from the same data, so every
    // batch write drops the forecast read too.
    ['saveChinaBatchCost', 'deleteChinaBatchCost']
      .forEach((action) => expect(server).toContain(`${action}: ['getChinaBatches', 'getChinaMoney', 'getChinaForecastData']`));
    // Item 83c: saveChinaBatch/deleteChinaBatch ALSO sync «Заказы на фабрике», so both drop
    // getFactoryOrders and the getOzonInitialData composite too.
    ['saveChinaBatch', 'deleteChinaBatch']
      .forEach((action) => expect(server).toContain(`${action}: ['getChinaBatches', 'getChinaMoney', 'getChinaForecastData', 'getFactoryOrders', 'getOzonInitialData'`));
    // Item 84 (stage 1): saveChinaBatch can also run the automatic cost correction, which
    // writes the MAIN spreadsheet's stock/transactions — its own cache entries must drop too.
    expect(server).toContain("saveChinaBatch: ['getChinaBatches', 'getChinaMoney', 'getChinaForecastData', 'getFactoryOrders', 'getOzonInitialData', 'getInitialData', 'getStock', 'getTransactions']");
  });

  it('every write replaces the whole state with what the script answered', () => {
    const writes = store.split('saveChinaBatch:')[1] || '';
    expect(writes).toContain('result.data.batches');
    expect(store).not.toContain('batches: [...get().batches');
  });

  it('the browser никогда не считает себестоимость сама', () => {
    // No rates, no shares, no multiplication of money anywhere on the screen.
    [tab, modal, store].forEach((source) => {
      expect(source).not.toMatch(/rubRate\s*\*/);
      expect(source).not.toMatch(/cargoRate\s*\*/);
      expect(source).not.toContain('freightCny =');
    });
    expect(tab).toContain('line.unitRub');
    expect(tab).toContain('line.costRub');
  });

  it('saving the articles saves the batch, so the script levels the goods again', () => {
    expect(tab).toContain('btn-save-china-labels');
    expect(tab).toContain('chinaFormToPayload(form)');
    expect(tab).toContain('chinaLevelledIndexes(batch.lines)');
    expect(tab).toContain('chinaArticleConflicts(batch.lines)');
  });

  it('the batch window can be scrolled to its buttons, as item 80 taught', () => {
    expect(modal).toContain('max-h-[90vh]');
    expect(modal).toContain('overflow-y-auto grow');
    expect(modal).toContain('shrink-0');
  });

  it('the window refuses a batch before sending it', () => {
    expect(modal).toContain('validateChinaBatchForm(form)');
    expect(modal).toContain('btn-save-china-batch');
  });

  it('the tab reads the files of the Chinese side and fills the form from them', () => {
    expect(tab).toContain('btn-import-china-files');
    expect(tab).toContain('chinaSheetsFromFile(file)');
    expect(tab).toContain('detectChinaFile(sheets)');
    expect(tab).toContain('parseChinaBatchFile(sheets)');
    expect(tab).toContain('parseChinaReportFile(sheets)');
    expect(tab).toContain('chinaFormFromFiles(parsed, report');
    expect(tab).toContain("accept=\".xlsx,.xls\"");
  });

  it('a file picked twice in a row is read twice', () => {
    // A file input keeps its value, and picking the same file again fires no change event
    // unless the value is cleared — the owner would think the import broke.
    expect(tab).toContain("fileInput.current.value = ''");
  });

  it('the import opens the same window the owner edits by hand, with its sources named', () => {
    expect(tab).toContain('initialForm={importForm}');
    expect(tab).toContain('notes={importNotes}');
    expect(tab).toContain('warnings={importWarnings}');
    expect(modal).toContain('Что заполнено из файлов');
    expect(modal).toContain('В файле не сходятся суммы');
    expect(modal).toContain('if (initialForm) return initialForm;');
  });

  it('the tab warns when the estimate of the weights and the waybill disagree', () => {
    expect(tab).toContain('weightFactor');
    expect(tab).toContain('Если знаете вес коробки');
  });

  it('item 81e: the weight-factor warning is silenced when every line was weighed at arrival or by hand', () => {
    // .every, not .some: ONE line weighed on the pallet estimate is enough to keep the warning.
    expect(tab).toContain("!batch.lines.every((l) => l.weightSource === 'приёмка' || l.weightSource === 'вручную')");
  });

  it('item 81e: the tab also reads the arrival file, and the modal asks for its date', () => {
    expect(tab).toContain('parseChinaArrivalFile(sheets)');
    expect(tab).toContain('chinaFormFromArrival(parsed,');
    expect(modal).toContain('Дата приёмки в Китае');
    expect(modal).toContain('form.receivedAt');
  });

  it('item 81e: the batch card shows packaging and freight only from figures the script sent', () => {
    expect(tab).toContain('Упаковка и перевозка');
    expect(tab).toContain('batch.goodsKg > 0');
    expect(tab).toContain('batch.packagingShareFreight');
    expect(tab).toContain('batch.goodsFreightShareCost');
  });

  it('item 81f: a picked file is matched to a saved batch by the pure, tested rule, not guessed inline', () => {
    expect(tab).toContain('chinaMatchFinalBatch(parsed.code, parsed.lines, batches)');
    expect(tab).toContain('chinaMatchArrivalBatch(parsed.draftCode, parsed.lines, batches)');
  });

  it('item 81f: an article chosen for one line is set on every line of its marking, in the window and the card', () => {
    expect(tab).toContain('chinaMarkingMatches(batch.lines, line.marking)');
    expect(modal).toContain('chinaMarkingMatches(f.lines, f.lines[index].marking)');
    // The select of the card and the window actually CALL the marking-wide setter, not a
    // one-line one — the helper alone proves nothing if nobody wires it to the control.
    expect(tab).toContain('onChange={(e) => setArticleByMarking(batch, line, e.target.value)}');
    expect(modal).toContain('onChange={(e) => setLineArticle(i, e.target.value)}');
  });

  it('item 81f: the article control is wide enough for a long article to be read whole', () => {
    expect(tab).toContain('min-w-[220px]');
    expect(modal).toContain('min-w-[220px]');
  });

  it('item 81f: every ¥ or $ figure the card shows is followed by its ₽, never computed here', () => {
    expect(tab).not.toMatch(/goodsCny\s*\*/);
    expect(tab).not.toMatch(/freightUsd\s*\*/);
    expect(tab).toContain("moneyWithRub(batch.goodsCny, '¥', batch.goodsRub)");
    expect(tab).toContain("moneyWithRub(batch.chinaDeliveryCny, '¥', batch.chinaDeliveryRub)");
    expect(tab).toContain("moneyWithRub(batch.freightUsd, '$', batch.freightRub)");
    // The ¥ conversion of the dollar freight no longer appears on the screen.
    expect(tab).not.toContain("money(batch.freightCny, '¥')");
    expect(tab).toContain('chinaRateSourceLabel(batch.rubRateSource');
    // moneyWithRub itself shows the currency amount ALONE when the ruble figure is 0/absent —
    // never a «(0,00 ₽)» tacked on to old data that has none of these fields yet.
    expect(tab).toContain("rub ? `${money(value, currency)} (${money(rub, '₽')})` : money(value, currency);");
  });

  it('item 82: the payments sentence is worked out by the pure helper, not by payments.length alone', () => {
    expect(tab).toContain("chinaRateStatusText(batch.rubRateSource, batch.rubRateFrom || '', batch.payments.length, batch.rateFromPayment || '')");
    expect(tab).not.toContain('оплаты не внесены, курс взят вручную');
  });

  it('item 82: the weight-factor figure is hidden by the same rule the packaging warning uses', () => {
    expect(tab).toContain('chinaShowWeightFactor(batch.weightFactor, batch.lines)');
  });

  it('item 82: freight per kilogram is shown against the base the script names, in rubles too', () => {
    expect(tab).toContain('chinaFreightPerKgLabel(batch.freightPerKgBase');
    expect(tab).toContain("moneyWithRub(batch.freightPerKgUsd, '$', batch.freightPerKgRub)");
  });

  it('item 82, owner\'s follow-up: the carrier\'s own tariff is shown too, in its own unit', () => {
    expect(tab).toContain('chinaTariffRateUnit(batch.tariffBasis)');
    expect(tab).toContain("moneyWithRub(batch.ratePerKgUsd, `$/${chinaTariffRateUnit(batch.tariffBasis)}`, batch.tariffRub)");
    expect(tab).toContain('тариф карго:');
    expect(tab).toContain('реально {chinaFreightPerKgLabel');
  });

  it('item 82: the packaging-density cell keeps the box-to-pallet order and the arrow style', () => {
    expect(tab).toContain('Плотность, кг/м³: в коробках фабрики → на паллетах');
    expect(tab).toContain('{money(batch.goodsDensity, \'\')} → {money(batch.packedDensity, \'\')}');
  });

  it('item 82: deleting a batch tells the owner it goes to the trash, not that it is gone for good', () => {
    expect(tab).not.toContain('Отменить это нельзя');
    expect(tab).toContain('перемещена в корзину');
    expect(tab).toContain('восстановить в разделе «Удалённое»');
  });
});

// Item 82: the trash shows a China batch by its code alone, and restoring one refreshes the
// China store — which the generic warehouse restore actions know nothing about.
describe('item 82: a China batch in the trash', () => {
  const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
  const deleted = read('src/components/DeletedItemsTab.tsx');

  it('has its own type name, icon and a code-only preview', () => {
    expect(deleted).toContain("case 'ChinaBatch': return 'Партия из Китая';");
    expect(deleted).toContain("case 'ChinaBatch': return <Container");
    expect(deleted).toMatch(/if \(type === 'ChinaBatch'\) \{\s*return <span[^>]*>\{parsed\.code\}<\/span>;/);
  });

  it('never shows the lines of the archived batch, only the code', () => {
    expect(deleted).not.toContain('parsed.lines');
    expect(deleted).not.toContain('parsed.batch');
  });

  it('restoring one calls fetchChinaBatches, so the China tab needs no reload', () => {
    expect(deleted).toContain('useChinaStore((state) => state.fetchChinaBatches)');
    expect(deleted).toContain("i.type === 'ChinaBatch'");
    expect(deleted).toContain('if (restoresChinaBatch) { fetchChinaBatches(); fetchFactoryOrders(); }');
  });
});

// Item 81e: the arrival file at the carrier's Yiwu warehouse, before a batch has shipped or
// got a code of its own.
describe('партия, собранная из файла приёмки в Китае', () => {
  const arrival = parseChinaArrivalFile(ARRIVAL_FILE_NV0923)!;

  it('flow a: opens a new draft when nothing matches the draft code yet', () => {
    const { form, notes } = chinaFormFromArrival(arrival, null);
    expect(form.status).toBe('Черновик');
    expect(form.code).toBe('NV-0923');
    expect(form.receivedAt).toBe('2026-09-23');
    expect(form.lines).toHaveLength(4);
    expect(form.lines.every((l) => l.priceCny === '' && l.article === '')).toBe(true);
    expect(form.lines[0]).toMatchObject({ marking: 'NV-101', boxes: '30', boxLengthM: '0.32', factoryBoxKg: '8.4' });
    expect(notes.join(' ')).toContain('Черновик NV-0923 создан');
  });

  // Item 81i: a shipment in boxes has no pallets — a fresh draft's own weight/volume are the
  // arrival file's 合计 row totals, so the batch window is never left with them blank.
  it('flow a: fills the batch weight/volume from the arrival totals, and says so', () => {
    const { form, boxesOnly } = chinaFormFromArrival(arrival, null);
    expect(form.weightKg).toBe('847');
    expect(form.volumeM3).toBe('7.56112');
    expect(boxesOnly).toBe(true);
  });

  it('flow b: fills the lines of an already-existing batch by marking, keeping what the owner set', () => {
    const existing = makeBatch({
      id: 'CB9', code: 'NV-0923-4', status: 'В пути',
      lines: [
        makeLine({ id: 'L1', marking: 'NV-101', boxes: 7, article: 'A1' }),
        makeLine({ id: 'L2', marking: 'NV-101', boxes: 23, article: 'A1' }),
        makeLine({ id: 'L3', marking: 'NV-102', boxes: 25, article: 'A2' })
      ]
    });
    const { form, notes } = chinaFormFromArrival(arrival, existing);
    expect(form.id).toBe('CB9');
    expect(form.code).toBe('NV-0923-4');
    expect(form.lines.filter((l) => l.marking === 'NV-101').every((l) => l.boxLengthM === '0.32')).toBe(true);
    expect(form.lines.find((l) => l.marking === 'NV-102')!.article).toBe('A2');
    expect(notes.join(' ')).not.toContain('коробок в приёмке');
    expect(notes.join(' ')).toContain('дополнена данными приёмки');
  });

  it('flow b: notes a marking whose boxes do not match between the arrival file and the batch', () => {
    const existing = makeBatch({
      id: 'CB9', code: 'NV-0923-4',
      lines: [makeLine({ id: 'L1', marking: 'NV-101', boxes: 29 })] // the arrival file says 30
    });
    const { notes } = chinaFormFromArrival(arrival, existing);
    expect(notes.join(' ')).toContain('NV-101: коробок в приёмке 30, в партии 29');
  });

  // Item 81i, owner: «эта поставка отправлена не на паллете а коробками» — a final batch file's
  // own waybill figures always win once the batch has them; the arrival totals must never
  // silently overwrite a weight the batch already carries.
  it('flow b: a batch that already has its own waybill weight keeps it', () => {
    const existing = makeBatch({
      id: 'CB9', code: 'NV-0923-4', weightKg: 967, volumeM3: 9.14,
      lines: [makeLine({ id: 'L1', marking: 'NV-101', boxes: 30 })]
    });
    const { form, boxesOnly } = chinaFormFromArrival(arrival, existing);
    expect(form.weightKg).toBe('967');
    expect(form.volumeM3).toBe('9.14');
    expect(boxesOnly).toBe(false);
  });

  it('flow b: a batch with no weight/volume of its own yet gets them from the arrival totals', () => {
    const existing = makeBatch({
      id: 'CB9', code: 'NV-0923-4', weightKg: 0, volumeM3: 0,
      lines: [makeLine({ id: 'L1', marking: 'NV-101', boxes: 30 })]
    });
    const { form, boxesOnly } = chinaFormFromArrival(arrival, existing);
    expect(form.weightKg).toBe('847');
    expect(form.volumeM3).toBe('7.56112');
    expect(boxesOnly).toBe(true);
  });
});

// Item 81h: the carrier can leave 货号 (marking) empty on a real product line — matching it to
// an existing batch line by POSITION is only safe when there is exactly one such line on each
// side; otherwise the owner sorts it out by hand.
describe('приёмка приносит одну строку без маркировки', () => {
  const singleLineArrival = parseChinaArrivalFile(ARRIVAL_FILE_NV0916)!;

  it('flow a: opens a new draft carrying the empty marking through, box data intact', () => {
    const { form, notes, warnings } = chinaFormFromArrival(singleLineArrival, null);
    expect(form.code).toBe('NV-0916');
    expect(form.lines).toHaveLength(1);
    expect(form.lines[0].marking).toBe('');
    expect(form.lines[0].boxLengthM).toBe('0.55');
    expect(form.lines[0].factoryBoxKg).toBe('17');
    expect(warnings).toEqual([]);
    expect(notes.join(' ')).toContain('Черновик NV-0916 создан');
  });

  it('flow b: 1↔1 — the single unmarked arrival line matches the single unmarked batch line', () => {
    const existing = makeBatch({
      id: 'CB16', code: 'NV-0916',
      lines: [makeLine({ id: 'L1', marking: '', boxes: 24 })]
    });
    const { form, warnings } = chinaFormFromArrival(singleLineArrival, existing);
    expect(form.lines[0].boxLengthM).toBe('0.55');
    expect(form.lines[0].factoryBoxKg).toBe('17');
    expect(warnings).toEqual([]);
  });

  it('flow b: two unmarked batch lines — no position match, a warning instead of a guess', () => {
    const existing = makeBatch({
      id: 'CB16', code: 'NV-0916',
      lines: [
        makeLine({ id: 'L1', marking: '', boxes: 12 }),
        makeLine({ id: 'L2', marking: '', boxes: 12 })
      ]
    });
    const { form, warnings } = chinaFormFromArrival(singleLineArrival, existing);
    expect(form.lines.every((l) => l.boxLengthM === '')).toBe(true);
    expect(warnings).toContain('строка без маркировки — сопоставьте вручную');
  });

  it('flow b: the batch has no unmarked line at all — nothing to attach the arrival data to, still a warning', () => {
    const existing = makeBatch({
      id: 'CB16', code: 'NV-0916',
      lines: [makeLine({ id: 'L1', marking: 'NV-1', boxes: 24 })]
    });
    const { form, warnings } = chinaFormFromArrival(singleLineArrival, existing);
    expect(form.lines[0].boxLengthM).toBe('');
    expect(warnings).toContain('строка без маркировки — сопоставьте вручную');
  });

  it('flow b: TWO unmarked arrival lines against one unmarked batch line — still ambiguous', () => {
    // A second unmarked product line added to the same arrival file.
    const twoLineSheet = singleLineArrival.lines.concat(singleLineArrival.lines[0]);
    const arrivalWithTwo = { ...singleLineArrival, lines: twoLineSheet };
    const existing = makeBatch({
      id: 'CB16', code: 'NV-0916',
      lines: [makeLine({ id: 'L1', marking: '', boxes: 24 })]
    });
    const { form, warnings } = chinaFormFromArrival(arrivalWithTwo, existing);
    expect(form.lines[0].boxLengthM).toBe('');
    expect(warnings).toContain('строка без маркировки — сопоставьте вручную');
  });
});

describe('item 81e: две последовательности импорта дают одно и то же', () => {
  const arrival = parseChinaArrivalFile(ARRIVAL_FILE_NV0923)!;
  const finalParsed = parseChinaBatchFile(BATCH_FILE_30)!;
  const report = parseChinaReportFile(REPORT_FILE)!;

  it('приёмка, потом партия: артикул черновика доходит до ОБЕИХ строк NV-101 после разбивки по паллетам', () => {
    const { form: draftForm } = chinaFormFromArrival(arrival, null);
    const draftBatch = makeBatch({
      id: 'CB30', code: 'NV-0923', status: 'Черновик', receivedAt: arrival.receivedAt,
      lines: draftForm.lines.map((l, i) => makeLine({
        id: `CB30-${i}`, marking: l.marking, boxes: Number(l.boxes),
        boxLengthM: Number(l.boxLengthM), boxWidthM: Number(l.boxWidthM),
        boxHeightM: Number(l.boxHeightM), factoryBoxKg: Number(l.factoryBoxKg),
        article: l.marking === 'NV-101' ? 'BOX-101' : ''
      }))
    });

    const { form, notes } = chinaFormFromFiles(finalParsed, report, draftBatch);
    expect(form.id).toBe('CB30');
    expect(form.code).toBe('NV-0923-4');
    const nv101 = form.lines.filter((l) => l.marking === 'NV-101');
    expect(nv101).toHaveLength(2);
    expect(nv101.every((l) => l.article === 'BOX-101')).toBe(true);
    expect(nv101.every((l) => l.boxLengthM === '0.32')).toBe(true);
    expect(notes.join(' ')).toContain('Дополнен черновик NV-0923 из данных о приёмке');
  });

  it('партия, потом приёмка: размеры коробки доходят до ОБЕИХ строк NV-101, артикулы не трогаются', () => {
    const { form: finalForm } = chinaFormFromFiles(finalParsed, report, null);
    const savedBatch = makeBatch({
      id: 'CB30', code: 'NV-0923-4', status: 'В пути',
      lines: finalForm.lines.map((l, i) => makeLine({
        id: `CB30-${i}`, marking: l.marking, boxes: Number(l.boxes),
        article: l.marking === 'NV-101' ? 'BOX-101' : ''
      }))
    });

    const { form, notes } = chinaFormFromArrival(arrival, savedBatch);
    const nv101 = form.lines.filter((l) => l.marking === 'NV-101');
    expect(nv101).toHaveLength(2);
    expect(nv101.every((l) => l.article === 'BOX-101')).toBe(true);
    expect(nv101.every((l) => l.boxLengthM === '0.32')).toBe(true);
    expect(notes.join(' ')).toContain('дополнена данными приёмки');
  });
});

describe('item 81e: box measurements and the arrival date survive a save', () => {
  it('round trip through chinaBatchToForm and chinaFormToPayload', () => {
    const batch = makeBatch({
      id: 'CB1', code: 'NV-0923-4', receivedAt: '2026-09-23',
      lines: [makeLine({
        id: 'L1', marking: 'NV-101', boxLengthM: 0.32, boxWidthM: 0.59, boxHeightM: 0.43, factoryBoxKg: 8.4
      })]
    });
    const form = chinaBatchToForm(batch);
    expect(form.receivedAt).toBe('2026-09-23');
    expect(form.lines[0]).toMatchObject({ boxLengthM: '0.32', boxWidthM: '0.59', boxHeightM: '0.43', factoryBoxKg: '8.4' });

    const payload = chinaFormToPayload(form) as Record<string, unknown>;
    expect(payload.receivedAt).toBe('2026-09-23');
    const lines = payload.lines as Record<string, unknown>[];
    expect(lines[0]).toMatchObject({ boxLengthM: 0.32, boxWidthM: 0.59, boxHeightM: 0.43, factoryBoxKg: 8.4 });
  });

  it('does not break on an old batch saved before item 81e, which has none of the new fields', () => {
    const old = makeBatch({ id: 'CB2', code: 'NV-OLD', lines: [makeLine({ id: 'L1', marking: 'NV-1' })] });
    const asRecord = old as unknown as Record<string, unknown>;
    delete asRecord.receivedAt;
    delete asRecord.goodsKg;
    const lineAsRecord = old.lines[0] as unknown as Record<string, unknown>;
    delete lineAsRecord.boxLengthM;
    delete lineAsRecord.factoryBoxKg;

    const form = chinaBatchToForm(old);
    expect(form.receivedAt).toBe('');
    expect(form.goodsKg).toBe('');
    expect(form.lines[0].boxLengthM).toBe('');
    expect(form.lines[0].factoryBoxKg).toBe('');
  });
});

/**
 * Item 81f, root cause of the owner's check on 2026-09-24: with the time-zone bug of `chinaXlsx`
 * still live, the final file's own code (and the draft code an arrival file computes) could be
 * one day off, so `readFiles`' old, single-pass matching missed the draft it should have
 * updated and created a second batch instead — losing everything already typed against the
 * first. These two functions are the whole matching rule now, tried in order, never guessing
 * past a single candidate.
 */
describe('item 81f: which saved batch a final batch file belongs to', () => {
  it('an exact code wins even over a draft whose markings also match', () => {
    const exact = makeBatch({ id: 'CB1', code: 'NV-0825-2', status: 'В пути', lines: [makeLine({ marking: 'NV-99' })] });
    const draft = makeBatch({ id: 'CB2', code: 'NV-0825', status: 'Черновик', lines: [makeLine({ marking: 'NV-99' })] });
    expect(chinaMatchFinalBatch('NV-0825-2', [{ marking: 'NV-99' }], [exact, draft])).toBe(exact);
  });

  it('a draft named by the code without its trailing -N', () => {
    const draft = makeBatch({ id: 'CB2', code: 'NV-0923', status: 'Черновик', lines: [] });
    const other = makeBatch({ id: 'CB3', code: 'NV-0401', status: 'Черновик', lines: [] });
    expect(chinaMatchFinalBatch('NV-0923-4', [], [other, draft])).toBe(draft);
  });

  it('falls back to the set of markings when the code the file states does not point anywhere — the day-early bug', () => {
    // The arrival file named its draft NV-0922 because of the time-zone bug; the final file's
    // own code is NV-0923-4, so neither an exact match nor the code-stripped one finds it.
    const draft = makeBatch({
      id: 'CB2', code: 'NV-0922', status: 'Черновик',
      lines: [makeLine({ marking: 'NV-101' }), makeLine({ marking: 'NV-102' })]
    });
    const unrelated = makeBatch({ id: 'CB3', code: 'NV-0401', status: 'Черновик', lines: [makeLine({ marking: 'NV-1' })] });
    const finalLines = [{ marking: 'nv-102' }, { marking: ' NV-101 ' }];
    expect(chinaMatchFinalBatch('NV-0923-4', finalLines, [unrelated, draft])).toBe(draft);
  });

  it('two equally matching drafts are ambiguous — no batch id is guessed', () => {
    const a = makeBatch({ id: 'CB1', code: 'NV-A', status: 'Черновик', lines: [makeLine({ marking: 'NV-1' })] });
    const b = makeBatch({ id: 'CB2', code: 'NV-B', status: 'Черновик', lines: [makeLine({ marking: 'NV-1' })] });
    expect(chinaMatchFinalBatch('NV-0923-4', [{ marking: 'NV-1' }], [a, b])).toBeNull();
  });

  it('a batch already shipped (not a draft) never matches by its markings alone', () => {
    const shipped = makeBatch({ id: 'CB1', code: 'NV-A', status: 'В пути', lines: [makeLine({ marking: 'NV-1' })] });
    expect(chinaMatchFinalBatch('NV-0923-4', [{ marking: 'NV-1' }], [shipped])).toBeNull();
  });

  it('nothing at all matches on a first import', () => {
    expect(chinaMatchFinalBatch('NV-0923-4', [{ marking: 'NV-1' }], [])).toBeNull();
  });
});

describe('item 81f: which saved batch an arrival file belongs to', () => {
  it('exactly the draft code', () => {
    const draft = makeBatch({ id: 'CB1', code: 'NV-0923', status: 'Черновик', lines: [] });
    expect(chinaMatchArrivalBatch('NV-0923', [], [draft])).toBe(draft);
  });

  it('the one batch shipped under draftCode-N', () => {
    const shipped = makeBatch({ id: 'CB1', code: 'NV-0923-4', status: 'В пути', lines: [] });
    const other = makeBatch({ id: 'CB2', code: 'NV-0401-1', status: 'В пути', lines: [] });
    expect(chinaMatchArrivalBatch('NV-0923', [], [other, shipped])).toBe(shipped);
  });

  it('two batches shipped under the same prefix are ambiguous', () => {
    const a = makeBatch({ id: 'CB1', code: 'NV-0923-4', status: 'В пути', lines: [] });
    const b = makeBatch({ id: 'CB2', code: 'NV-0923-5', status: 'В пути', lines: [] });
    expect(chinaMatchArrivalBatch('NV-0923', [], [a, b])).toBeNull();
  });

  it('falls back to the one batch with no box data whose markings are the arrival’s', () => {
    const noBoxData = makeBatch({ id: 'CB1', code: 'NV-0401-1', status: 'В пути', lines: [makeLine({ marking: 'NV-101' })] });
    const withBoxData = makeBatch({
      id: 'CB2', code: 'NV-0917-1', status: 'В пути', lines: [makeLine({ marking: 'NV-999', boxLengthM: 0.3 })]
    });
    const arrivalLines = [{ marking: 'NV-101' }];
    expect(chinaMatchArrivalBatch('NV-0922', arrivalLines, [noBoxData, withBoxData])).toBe(noBoxData);
  });

  it('a batch that already has box data of its own is never matched by markings alone', () => {
    const withBoxData = makeBatch({
      id: 'CB2', code: 'NV-0401-1', status: 'В пути', lines: [makeLine({ marking: 'NV-101', factoryBoxKg: 8.4 })]
    });
    expect(chinaMatchArrivalBatch('NV-0922', [{ marking: 'NV-101' }], [withBoxData])).toBeNull();
  });

  it('two batches with no box data and the same markings are ambiguous', () => {
    const a = makeBatch({ id: 'CB1', code: 'NV-A', status: 'В пути', lines: [makeLine({ marking: 'NV-101' })] });
    const b = makeBatch({ id: 'CB2', code: 'NV-B', status: 'В пути', lines: [makeLine({ marking: 'NV-101' })] });
    expect(chinaMatchArrivalBatch('NV-0922', [{ marking: 'NV-101' }], [a, b])).toBeNull();
  });

  it('nothing at all matches on a first import', () => {
    expect(chinaMatchArrivalBatch('NV-0923', [{ marking: 'NV-101' }], [])).toBeNull();
  });
});

/**
 * Item 81f, owner check: «если я присваиваю артикул для маркировки короба, то короба с такой же
 * маркировкой должны автоматически проставляться указанным артикулом товара».
 */
describe('item 81f: an article follows its marking to every line', () => {
  it('finds every line of the same marking, case-insensitive and trimmed', () => {
    const lines = [{ marking: 'NV-99' }, { marking: ' nv-99 ' }, { marking: 'NV-98' }];
    expect(chinaMarkingMatches(lines, 'NV-99')).toEqual([0, 1]);
  });

  it('an empty marking matches nothing — nobody’s article should spread to a blank row', () => {
    expect(chinaMarkingMatches([{ marking: '' }, { marking: 'NV-1' }], '')).toEqual([]);
  });

  it('a marking with no other line of its own matches only itself', () => {
    expect(chinaMarkingMatches([{ marking: 'NV-1' }, { marking: 'NV-2' }], 'NV-2')).toEqual([1]);
  });
});

describe('item 81f: the source of the ₽/¥ rate, in words', () => {
  it('names the batch a borrowed rate came from', () => {
    expect(chinaRateSourceLabel('предыдущая партия', 'NV-0825-2')).toBe('курс из партии NV-0825-2');
  });

  it('leaves every other source as the script wrote it', () => {
    expect(chinaRateSourceLabel('оплаты', '')).toBe('оплаты');
    expect(chinaRateSourceLabel('вручную', '')).toBe('вручную');
  });

  it('with no source batch named, the label is left untranslated rather than saying "из партии "', () => {
    expect(chinaRateSourceLabel('предыдущая партия', '')).toBe('предыдущая партия');
  });

  it("item 81g: 'история' reads as its own sentence, not a bare word", () => {
    expect(chinaRateSourceLabel('история', '')).toBe('история без курса');
  });

  it("item 81g owner's live check of 2026-09-25: 'последняя оплата' names the payment's own date", () => {
    expect(chinaRateSourceLabel('последняя оплата', '', '2026-08-20 CP3'))
      .toBe('предварительный курс по последней оплате от 20.08');
  });

  it("'последняя оплата' with no payment named still reads as a whole sentence", () => {
    expect(chinaRateSourceLabel('последняя оплата', '')).toBe('предварительный курс по последней оплате');
  });
});

describe('item 81g: the tick beside a batch\'s code', () => {
  it('one green check for the script alone', () => {
    expect(chinaCheckMark('скрипт', '')).toEqual({
      glyph: '✓', className: 'text-emerald-600', title: 'прочитано скриптом, все проверки сошлись'
    });
  });

  it('two green checks once AI agreed on a re-check', () => {
    expect(chinaCheckMark('скрипт+ИИ', 'сверил суммы отчёта')).toEqual({
      glyph: '✓✓', className: 'text-emerald-600', title: 'сверил суммы отчёта'
    });
  });

  it('a yellow warning when the script itself called AI', () => {
    expect(chinaCheckMark('ИИ', 'не разобрал шапку листа')).toEqual({
      glyph: '⚠', className: 'text-amber-600', title: 'не разобрал шапку листа'
    });
  });

  it('a red cross when AI saw a discrepancy the script did not', () => {
    expect(chinaCheckMark('расхождение ИИ', 'суммы расходятся на 400 ¥')).toEqual({
      glyph: '✗', className: 'text-red-600', title: 'суммы расходятся на 400 ¥'
    });
  });

  it('no note at all still gives a title, never a blank one', () => {
    expect(chinaCheckMark('ИИ', '')!.title).toBe('часть партии дочитал ИИ');
  });

  it('a batch that predates the check gets no badge', () => {
    expect(chinaCheckMark('', '')).toBeNull();
  });
});

// Item 82: the sentence under the totals goes by rubRateSource, not by whether payments happen
// to exist — the owner's 2026-09-24 check found a batch with NO rate at all reading «оплаты не
// внесены, курс взят вручную», which is a lie: nothing was typed in either.
describe('item 82: the ₽/¥-rate sentence under the totals', () => {
  it('no rate at all: warns that nothing is figured in rubles yet', () => {
    expect(chinaRateStatusText('', '', 0)).toBe(
      'курс не задан — внесите оплату или впишите курс ₽/¥ в партии, до тех пор суммы в рублях не считаются'
    );
  });

  it('an unrecognised source falls back to the same warning, not to a blank string', () => {
    expect(chinaRateStatusText('чушь', '', 0)).toBe(
      'курс не задан — внесите оплату или впишите курс ₽/¥ в партии, до тех пор суммы в рублях не считаются'
    );
  });

  it('typed by hand', () => {
    expect(chinaRateStatusText('вручную', '', 5)).toBe('курс вписан вручную');
  });

  it('borrowed from another batch: names it', () => {
    expect(chinaRateStatusText('предыдущая партия', 'NV-0825-2', 0)).toBe('предварительный курс из партии NV-0825-2');
  });

  it('borrowed with no source named: the sentence still holds together', () => {
    expect(chinaRateStatusText('предыдущая партия', '', 0)).toBe('предварительный курс из партии ');
  });

  it('from payments: states how many, whatever the count', () => {
    expect(chinaRateStatusText('оплаты', '', 3)).toBe('в базе оплат по этому заказу: 3');
  });

  it('from payments, count of zero: still says so rather than warning about no rate', () => {
    expect(chinaRateStatusText('оплаты', '', 0)).toBe('в базе оплат по этому заказу: 0');
  });

  it('rubRateFrom is ignored for every source but the borrowed one', () => {
    expect(chinaRateStatusText('оплаты', 'NV-9', 1)).toBe('в базе оплат по этому заказу: 1');
    expect(chinaRateStatusText('вручную', 'NV-9', 1)).toBe('курс вписан вручную');
  });

  it("item 81g owner's live check of 2026-09-25: the latest payment's own rate, dated", () => {
    expect(chinaRateStatusText('последняя оплата', '', 0, '2026-08-20 CP3'))
      .toBe('предварительный курс по последней оплате от 20.08');
  });

  it("'последняя оплата' with no payment named still holds together", () => {
    expect(chinaRateStatusText('последняя оплата', '', 0)).toBe('предварительный курс по последней оплате');
  });
});

// Item 82: «Коэффициент веса» restates the packaging block when every line was weighed at
// arrival or by hand — hide the figure then.
describe('item 82: when the weight-factor figure earns its place on the card', () => {
  it('null factor: never shown', () => {
    expect(chinaShowWeightFactor(null, [{ weightSource: 'паллеты' }])).toBe(false);
  });

  it('a factor of exactly 0 is not the same as null — still shown if the lines say so', () => {
    expect(chinaShowWeightFactor(0, [{ weightSource: 'паллеты' }])).toBe(true);
  });

  it('every line weighed at arrival: hidden, it only restates the packaging block', () => {
    expect(chinaShowWeightFactor(1.1, [{ weightSource: 'приёмка' }, { weightSource: 'приёмка' }])).toBe(false);
  });

  it('every line weighed by hand: hidden too', () => {
    expect(chinaShowWeightFactor(1.1, [{ weightSource: 'вручную' }, { weightSource: 'вручную' }])).toBe(false);
  });

  it('a mix of приёмка and вручную: still hidden — both count as "known"', () => {
    expect(chinaShowWeightFactor(1.1, [{ weightSource: 'приёмка' }, { weightSource: 'вручную' }])).toBe(false);
  });

  it('one line estimated from pallets among known ones: shown — that one line still guesses', () => {
    expect(chinaShowWeightFactor(1.1, [{ weightSource: 'приёмка' }, { weightSource: 'паллеты' }])).toBe(true);
  });

  it('no lines at all: vacuously "every line known", so hidden — there is nothing to disagree', () => {
    expect(chinaShowWeightFactor(1.1, [])).toBe(false);
  });

  it('every line estimated from pallets: shown', () => {
    expect(chinaShowWeightFactor(1.1, [{ weightSource: 'паллеты' }, { weightSource: 'паллеты' }])).toBe(true);
  });
});

// Item 82: freight per kilogram is billed either on the goods' own weight or on the waybill's —
// the label must name which, or the figure reads as if it always meant the same kilogram.
describe('item 82: the label of the per-kilogram freight figure', () => {
  it('billed on the goods', () => {
    expect(chinaFreightPerKgLabel('товара')).toBe('за 1 кг товара');
  });

  it('billed on the waybill', () => {
    expect(chinaFreightPerKgLabel('накладной')).toBe('за 1 кг по накладной');
  });

  it('unknown base: no label rather than a wrong guess', () => {
    expect(chinaFreightPerKgLabel('')).toBe('');
  });

  it('a value the script never sends is treated the same as unknown', () => {
    expect(chinaFreightPerKgLabel('чушь')).toBe('');
  });
});

// Item 82, owner's follow-up: the waybill's own carro tariff is a different figure from what
// the batch actually paid per kilogram — «$/кг» normally, «$/м³» on a м³ tariff.
describe('item 82: the unit of the carrier\'s own tariff', () => {
  it('billed by weight: кг', () => {
    expect(chinaTariffRateUnit('кг')).toBe('кг');
  });

  it('billed by volume: м³', () => {
    expect(chinaTariffRateUnit('м³')).toBe('м³');
  });

  it('unknown or empty basis: defaults to кг, the usual case', () => {
    expect(chinaTariffRateUnit('')).toBe('кг');
    expect(chinaTariffRateUnit('чушь')).toBe('кг');
  });
});

// Item 89: «100000 должны выглядеть как 100 000» in the payments card's ruble field.
describe('item 89: grouping thousands as the owner types a ruble amount', () => {
  it('groups a plain integer by threes', () => {
    expect(chinaGroupThousands('100000')).toBe('100 000');
  });

  it('groups a bigger number into more than one gap', () => {
    expect(chinaGroupThousands('1234567')).toBe('1 234 567');
  });

  it('keeps a decimal comma and groups only the integer part', () => {
    expect(chinaGroupThousands('12345,6')).toBe('12 345,6');
  });

  it('drops spaces already in the text before regrouping, so retyping stays stable', () => {
    expect(chinaGroupThousands('100 000')).toBe('100 000');
  });

  it('a short number gets no gap at all', () => {
    expect(chinaGroupThousands('999')).toBe('999');
    expect(chinaGroupThousands('')).toBe('');
  });

  it('a dot is read the same as a comma, but the comma is what comes back', () => {
    expect(chinaGroupThousands('12345.6')).toBe('12 345,6');
  });

  it('a stray letter is dropped rather than breaking the grouping', () => {
    expect(chinaGroupThousands('100000 руб')).toBe('100 000');
  });
});

describe('item 89: what is still owed on a batch, shown beside its cost', () => {
  it('a batch predating the item has nothing to show', () => {
    expect(chinaRemainingText({})).toBeNull();
  });

  it('nothing left at all: paid in full', () => {
    const result = chinaRemainingText({ remainingRub: 0, remainingGoodsCny: 0, remainingFreightUsd: 0 });
    expect(result).toEqual({ text: 'оплачено полностью', className: 'text-emerald-600', title: '' });
  });

  it('a ruble debt, with the ¥/$ breakdown in the tooltip', () => {
    const result = chinaRemainingText({ remainingRub: 123456.78, remainingGoodsCny: 8000, remainingFreightUsd: 500 });
    // Owner, 2026-09-25: rubles show no kopecks — 123456.78 reads as the whole ruble it rounds to.
    expect(result!.text).toBe('осталось доплатить 123 457 ₽');
    expect(result!.title).toBe('товар 8000 ¥, перевозка 500 $');
    expect(result!.className).toBe('');
  });

  it('no rate yet: 0 ₽ owed does not mean paid — the ¥/$ figures show instead', () => {
    const result = chinaRemainingText({ remainingRub: 0, remainingGoodsCny: 8000, remainingFreightUsd: 0 });
    expect(result!.text).toBe('осталось доплатить 8000 ¥');
    expect(result!.className).toBe('text-amber-600');
  });

  it('no rate yet, only the freight left unpaid', () => {
    const result = chinaRemainingText({ remainingRub: 0, remainingFreightUsd: 500 });
    expect(result!.text).toBe('осталось доплатить 500 $');
  });

  // Owner, 2026-09-25 (live check): NV-0916 has no order number at all — remainingRub reads 0
  // the same as a genuinely settled batch, so «оплачено полностью» must never show up for it.
  it('no order number at all — nothing to compare, not «оплачено полностью»', () => {
    const result = chinaRemainingText({
      remainingRub: 0, remainingGoodsCny: 0, remainingFreightUsd: 0, remainingGoodsKnown: false
    });
    expect(result).toEqual({ text: 'нет номера заказа — не с чем сверить оплату', className: 'text-amber-600', title: '' });
  });

  it('order known, but the code has no bill in the report — freight side unknown', () => {
    const result = chinaRemainingText({
      remainingRub: 0, remainingGoodsCny: 0, remainingFreightUsd: 0,
      remainingGoodsKnown: true, remainingFreightKnown: false
    });
    expect(result).toEqual({ text: 'накладной нет в отчёте', className: 'text-amber-600', title: '' });
  });

  it('both sides known and genuinely settled — still «оплачено полностью»', () => {
    const result = chinaRemainingText({
      remainingRub: 0, remainingGoodsCny: 0, remainingFreightUsd: 0,
      remainingGoodsKnown: true, remainingFreightKnown: true
    });
    expect(result).toEqual({ text: 'оплачено полностью', className: 'text-emerald-600', title: '' });
  });
});

// Item 1 (owner, 2026-09-25): the Russian-side cost block's local editable list.
describe('item 1: the Russian-side cost list, as editable rows', () => {
  it('a batch with no costs yet starts with the two default rows', () => {
    expect(chinaDefaultCostRows()).toEqual([
      { id: '', type: 'Разгрузка', amountRub: '', comment: '' },
      { id: '', type: 'Доставка до склада', amountRub: '', comment: '' }
    ]);
  });

  it('chinaCostRowsOf falls back to the defaults when the batch has no saved costs', () => {
    expect(chinaCostRowsOf([])).toEqual(chinaDefaultCostRows());
  });

  it('chinaCostRowsOf shows the batch\'s own saved costs as rows, not the defaults', () => {
    const rows = chinaCostRowsOf([
      { id: 'CC1', batchId: 'CB1', date: '2026-09-01', kind: 'Прочее', amountRub: 500, comment: 'такси', user: 'Николай' }
    ]);
    expect(rows).toEqual([{ id: 'CC1', type: 'Прочее', amountRub: '500', comment: 'такси' }]);
  });

  it('chinaCostRowsPayload turns typed text into numbers, keeping an existing id', () => {
    const payload = chinaCostRowsPayload([
      { id: 'CC1', type: 'Разгрузка', amountRub: '1 000,50', comment: ' выгрузка ' },
      { id: '', type: 'Прочее', amountRub: '', comment: '' }
    ]);
    expect(payload).toEqual([
      { id: 'CC1', type: 'Разгрузка', amountRub: 1000.5, comment: 'выгрузка' },
      { type: 'Прочее', amountRub: 0, comment: '' }
    ]);
  });
});

// Item 89: «номер NV-0923-4 говорит о том, что поставка отправлена 23 сентября» — the estimated
// arrival shown on the collapsed row. Run once under TZ=Asia/Yekaterinburg too (docs/OZON_PLAN.md
// item 89), to prove the date arithmetic below does not shift by a day.
describe('item 89: the estimated arrival date of a batch', () => {
  const TODAY = new Date(2026, 8, 25); // 25.09.2026

  it('already arrived: the arrival date itself, not an estimate', () => {
    const batch = { code: 'NV-0923-4', shippedAt: '', arrivedAt: '2026-09-30', receivedAt: '' };
    expect(chinaEtaText(batch, 30, TODAY)).toEqual({ text: 'прибыла 30.09.2026', className: '' });
  });

  it('shippedAt beats the code — the waybill is the truth, the code is only a fallback', () => {
    const batch = { code: 'NV-0923-4', shippedAt: '2026-09-24', arrivedAt: '', receivedAt: '' };
    // 24.09.2026 + 30 days = 24.10.2026, not overdue on 25.09.2026
    expect(chinaEtaText(batch, 30, TODAY)).toEqual({ text: 'прибытие ≈ 24.10.2026', className: '' });
  });

  it('no shippedAt: the MMDD the code itself carries, in the year of receivedAt', () => {
    const batch = { code: 'NV-0923-4', shippedAt: '', arrivedAt: '', receivedAt: '2026-11-01' };
    expect(chinaEtaText(batch, 30, TODAY)).toEqual({ text: 'прибытие ≈ 23.10.2026', className: '' });
  });

  it('no shippedAt and no receivedAt: the code’s MMDD in the year of today', () => {
    const batch = { code: 'NV-0923-4', shippedAt: '', arrivedAt: '', receivedAt: '' };
    expect(chinaEtaText(batch, 30, TODAY)).toEqual({ text: 'прибытие ≈ 23.10.2026', className: '' });
  });

  it('overdue: the estimate is in the past and the batch has not arrived', () => {
    const batch = { code: 'NV-0601-1', shippedAt: '2026-06-01', arrivedAt: '', receivedAt: '' };
    // 01.06.2026 + 30 days = 01.07.2026, well before 25.09.2026
    expect(chinaEtaText(batch, 30, TODAY)).toEqual({ text: 'ожидалась 01.07', className: 'text-amber-600' });
  });

  it('the estimate landing exactly today is not yet overdue', () => {
    const batch = { code: 'NV-0826-1', shippedAt: '2026-08-26', arrivedAt: '', receivedAt: '' };
    // 26.08.2026 + 30 days = 25.09.2026, the same day as TODAY
    expect(chinaEtaText(batch, 30, TODAY)).toEqual({ text: 'прибытие ≈ 25.09.2026', className: '' });
  });

  it('a code with no MMDD suffix and no shippedAt: nothing to estimate from', () => {
    const batch = { code: 'ЧЕРНОВИК', shippedAt: '', arrivedAt: '', receivedAt: '' };
    expect(chinaEtaText(batch, 30, TODAY)).toEqual({ text: '', className: '' });
  });

  it('a month the code carries that is not a real calendar month is refused, not guessed at', () => {
    const batch = { code: 'NV-1332-1', shippedAt: '', arrivedAt: '', receivedAt: '' };
    expect(chinaEtaText(batch, 30, TODAY)).toEqual({ text: '', className: '' });
  });

  it('a valid month but a day no month has is refused too', () => {
    const batch = { code: 'NV-0140-1', shippedAt: '', arrivedAt: '', receivedAt: '' };
    expect(chinaEtaText(batch, 30, TODAY)).toEqual({ text: '', className: '' });
  });
});

// Owner, 2026-09-25 (live check): rubles with no kopecks, every other number to hundredths with
// a trailing «,00» dropped — the two display-only formatters `money`/`moneyWithRub` of
// `ChinaOrdersTab.tsx` build on.
describe('chinaRubText: rubles, no kopecks', () => {
  it('rounds to a whole ruble and groups thousands with a non-breaking space', () => {
    expect(chinaRubText(129999.85)).toBe('130\u00a0000');
  });

  it('rounds a small remainder up rather than truncating it away', () => {
    expect(chinaRubText(104027.58)).toBe('104\u00a0028');
  });

  it('a missing value reads as zero, not NaN', () => {
    expect(chinaRubText(undefined as unknown as number)).toBe('0');
  });
});

describe('chinaNumText: ¥/$/kg/m/density/%, hundredths with the trailing zero dropped', () => {
  it('rounds a long division to hundredths', () => {
    expect(chinaNumText(9.600198412698413)).toBe('9,6');
  });

  it('drops a trailing ",00" a whole number would otherwise carry', () => {
    expect(chinaNumText(17)).toBe('17');
  });

  it('groups thousands the same way rubles do', () => {
    expect(chinaNumText(9677)).toBe('9\u00a0677');
  });
});

// Item 84 (stage 2): the posting confirmation window's quantity validation \u2014 money-adjacent,
// since the entered quantity decides the price per unit the server posts.
describe('chinaPostQtyError: the posting window\'s quantity validation', () => {
  it('refuses empty, zero, negative, fractional and non-numeric input', () => {
    expect(chinaPostQtyError('')).toBe('\u0423\u043a\u0430\u0436\u0438\u0442\u0435 \u043a\u043e\u043b\u0438\u0447\u0435\u0441\u0442\u0432\u043e');
    expect(chinaPostQtyError('  ')).toBe('\u0423\u043a\u0430\u0436\u0438\u0442\u0435 \u043a\u043e\u043b\u0438\u0447\u0435\u0441\u0442\u0432\u043e');
    expect(chinaPostQtyError('0')).toBe('\u041a\u043e\u043b\u0438\u0447\u0435\u0441\u0442\u0432\u043e \u0434\u043e\u043b\u0436\u043d\u043e \u0431\u044b\u0442\u044c \u043d\u0435 \u043c\u0435\u043d\u044c\u0448\u0435 1');
    expect(chinaPostQtyError('-3')).toBe('\u041a\u043e\u043b\u0438\u0447\u0435\u0441\u0442\u0432\u043e \u0434\u043e\u043b\u0436\u043d\u043e \u0431\u044b\u0442\u044c \u043d\u0435 \u043c\u0435\u043d\u044c\u0448\u0435 1');
    expect(chinaPostQtyError('2.5')).toBe('\u041a\u043e\u043b\u0438\u0447\u0435\u0441\u0442\u0432\u043e \u0434\u043e\u043b\u0436\u043d\u043e \u0431\u044b\u0442\u044c \u0446\u0435\u043b\u044b\u043c \u0447\u0438\u0441\u043b\u043e\u043c');
    expect(chinaPostQtyError('abc')).toBe('\u041a\u043e\u043b\u0438\u0447\u0435\u0441\u0442\u0432\u043e \u0434\u043e\u043b\u0436\u043d\u043e \u0431\u044b\u0442\u044c \u0446\u0435\u043b\u044b\u043c \u0447\u0438\u0441\u043b\u043e\u043c');
  });

  it('accepts a whole number of at least 1, trimmed', () => {
    expect(chinaPostQtyError(' 12 ')).toBeNull();
    expect(chinaPostQtyError('1')).toBeNull();
  });
});

describe('chinaPostPricePerUnit: the posting window\'s display-only provisional price', () => {
  it('divides the cost by the entered quantity, rounded to whole kopecks', () => {
    expect(chinaPostPricePerUnit(1000, 3)).toBe(333.33);
  });

  it('is 0 for a zero or missing quantity, never a division error', () => {
    expect(chinaPostPricePerUnit(1000, 0)).toBe(0);
    expect(chinaPostPricePerUnit(1000, undefined as unknown as number)).toBe(0);
  });
});

describe('chinaPostingBadge: the compact mark of a posted batch', () => {
  it('is null for an unposted batch', () => {
    expect(chinaPostingBadge(makeBatch({ postingState: '' }))).toBeNull();
  });

  it('reads \u00ab\u0423\u0436\u0435 \u043d\u0430 \u043e\u0441\u0442\u0430\u0442\u043a\u0435\u00bb with no date/author for the migration mark', () => {
    expect(chinaPostingBadge(makeBatch({ postingState: '\u0443\u0436\u0435 \u043d\u0430 \u043e\u0441\u0442\u0430\u0442\u043a\u0435' }))).toEqual({
      text: '\u0423\u0436\u0435 \u043d\u0430 \u043e\u0441\u0442\u0430\u0442\u043a\u0435', className: 'bg-slate-100 text-slate-500'
    });
  });

  it('shows the date, the author and \u00ab\u043f\u0440\u0435\u0434\u0432\u0430\u0440\u0438\u0442\u0435\u043b\u044c\u043d\u0430\u044f\u00bb/\u00ab\u043e\u043a\u043e\u043d\u0447\u0430\u0442\u0435\u043b\u044c\u043d\u0430\u044f\u00bb for a real posting', () => {
    const provisional = chinaPostingBadge(makeBatch({
      postingState: '\u043f\u0440\u0435\u0434\u0432\u0430\u0440\u0438\u0442\u0435\u043b\u044c\u043d\u043e', postedAt: '2026-09-25 14:30:00', postedBy: '\u041d\u0438\u043a\u043e\u043b\u0430\u0439'
    }));
    expect(provisional?.text).toBe('\u041d\u0430 \u0441\u043a\u043b\u0430\u0434\u0435 \u0441 25.09.2026 \u00b7 \u041d\u0438\u043a\u043e\u043b\u0430\u0439 \u00b7 \u0446\u0435\u043d\u0430 \u043f\u0440\u0435\u0434\u0432\u0430\u0440\u0438\u0442\u0435\u043b\u044c\u043d\u0430\u044f');
    const final = chinaPostingBadge(makeBatch({
      postingState: '\u043e\u043a\u043e\u043d\u0447\u0430\u0442\u0435\u043b\u044c\u043d\u043e', postedAt: '2026-09-25 14:30:00', postedBy: '\u041d\u0438\u043a\u043e\u043b\u0430\u0439'
    }));
    expect(final?.text).toBe('\u041d\u0430 \u0441\u043a\u043b\u0430\u0434\u0435 \u0441 25.09.2026 \u00b7 \u041d\u0438\u043a\u043e\u043b\u0430\u0439 \u00b7 \u0446\u0435\u043d\u0430 \u043e\u043a\u043e\u043d\u0447\u0430\u0442\u0435\u043b\u044c\u043d\u0430\u044f');
  });
});
