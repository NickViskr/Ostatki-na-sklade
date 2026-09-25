import { describe, it, expect } from 'vitest';
import { ARRIVAL_FILE_NV0923, ARRIVAL_FILE_NV0916, BATCH_FILE_28, BATCH_FILE_27, BATCH_FILE_30, REPORT_FILE, ChinaSheetGrid } from './chinaFiles.fixture';
import {
  detectChinaFile, parseChinaBatchFile, parseChinaArrivalFile, parseChinaReportFile, cargoRateFromNote,
  orderNoFromTicket, chinaFreightOf, chinaOrderOf, chinaReportPayload, chinaReceiptFreightCny, ChinaSheets
} from './chinaFileParse';

const copy = (sheets: ChinaSheets): ChinaSheets => {
  const out: ChinaSheets = {};
  Object.keys(sheets).forEach((name) => { out[name] = sheets[name].map((row) => row.slice()) as ChinaSheetGrid; });
  return out;
};

describe('какой файл прислали', () => {
  it('recognises the batch file and the running account', () => {
    expect(detectChinaFile(BATCH_FILE_28)).toBe('batch');
    expect(detectChinaFile(BATCH_FILE_27)).toBe('batch');
    expect(detectChinaFile(REPORT_FILE)).toBe('report');
  });

  it('says so plainly about a file it does not know', () => {
    expect(detectChinaFile({ 'Лист1': [['Остатки', 'Артикул'], ['', 'A-1']] })).toBe('unknown');
    expect(parseChinaBatchFile({ 'Лист1': [['ничего']] })).toBeNull();
    expect(parseChinaReportFile({ 'Лист1': [['ничего']] })).toBeNull();
  });

  it('item 81e: tells the arrival file from the batch file, though both name 货号/装箱数/单毛重', () => {
    // The 箱单 sheet of a shipped batch has the SAME headers as the arrival file — what tells
    // them apart is the waybill sheet (体积/重量/单价) that sits beside a batch file only.
    expect(detectChinaFile(ARRIVAL_FILE_NV0923)).toBe('arrival');
    expect(detectChinaFile(BATCH_FILE_30)).toBe('batch');
    expect(parseChinaArrivalFile({ 'Лист1': [['ничего']] })).toBeNull();
  });
});

describe('файл партии NV-0825-2 (заказ 28)', () => {
  const parsed = parseChinaBatchFile(BATCH_FILE_28)!;

  it('reads the waybill of the carrier', () => {
    expect(parsed.code).toBe('NV-0825-2');
    expect(parsed.shippedAt).toBe('2026-08-27');
    expect(parsed.places).toBe(2);
    expect(parsed.weightKg).toBe(672.5);
    expect(parsed.volumeM3).toBe(4.92);
    expect(parsed.ratePerKgUsd).toBe(2.3);
    expect(parsed.packingUsd).toBe(90);
    expect(parsed.otherCargoUsd).toBe(0);
  });

  it('adds the freight up to the 1 636,75 $ the carrier itself states', () => {
    expect(parsed.freightUsd).toBe(1636.75);
  });

  it('keeps the delivery inside China apart from the goods', () => {
    // The 货值 of the waybill is 10 444 ¥ — the goods AND the 700 ¥ of local delivery.
    expect(parsed.chinaDeliveryCny).toBe(700);
    expect(parsed.declaredValueCny).toBe(10444);
    const goods = parsed.lines.reduce((sum, l) => sum + l.sumCny, 0);
    expect(goods).toBe(9744);
  });

  it('reads the three lines with the weight of the pallets they start', () => {
    expect(parsed.lines).toEqual([
      { marking: 'NV-99', name: '收纳盒', boxes: 30, pcsPerBox: 8, qty: 240, priceCny: 20.3, sumCny: 4872, palletWeightKg: 339 },
      { marking: 'NV-99', name: '收纳盒', boxes: 15, pcsPerBox: 8, qty: 120, priceCny: 20.3, sumCny: 2436, palletWeightKg: 0 },
      { marking: 'NV-98', name: '收纳盒', boxes: 15, pcsPerBox: 8, qty: 120, priceCny: 20.3, sumCny: 2436, palletWeightKg: 333.5 }
    ]);
  });

  it('is not fooled by the carrier contract, which names 票号, 重量 and 体积 in its own text', () => {
    // A row of the agreement mentions all three words in one paragraph; the weight must still
    // come from the goods row of the waybill.
    const legal = BATCH_FILE_28['运单表'].some((row) => row.some((c) => String(c).indexOf('票号、重量、体积') !== -1));
    expect(legal).toBe(true);
    expect(parsed.weightKg).toBe(672.5);
  });

  it('has nothing to complain about in a file nobody edited', () => {
    expect(parsed.warnings).toEqual([]);
  });
});

describe('файл партии NV-0716-3 (заказ 27)', () => {
  const parsed = parseChinaBatchFile(BATCH_FILE_27)!;

  it('reads five lines over three pallets, two of them packed into an earlier pallet', () => {
    expect(parsed.lines.map((l) => [l.marking, l.boxes, l.qty, l.priceCny, l.palletWeightKg])).toEqual([
      ['NV-96', 16, 160, 25, 288.5],
      ['NV-97', 24, 96, 52, 456],
      ['NV-96', 4, 40, 25, 0],
      ['NV-95', 25, 150, 19, 257],
      ['NV-97', 1, 4, 52, 0]
    ]);
  });

  it('reads its money: 13 050 ¥ of goods, 900 ¥ inside China, 2 438,45 $ of freight', () => {
    expect(parsed.lines.reduce((sum, l) => sum + l.sumCny, 0)).toBe(13050);
    expect(parsed.chinaDeliveryCny).toBe(900);
    expect(parsed.declaredValueCny).toBe(13950);
    expect(parsed.freightUsd).toBe(2438.45);
    expect(parsed.warnings).toEqual([]);
  });
});

describe('файл партии NV-0923-4 (заказ 30)', () => {
  const parsed = parseChinaBatchFile(BATCH_FILE_30)!;

  it('reads a marking split over two pallets: NV-101 7 boxes then 23 more', () => {
    expect(parsed.lines.filter((l) => l.marking === 'NV-101').map((l) => l.boxes)).toEqual([7, 23]);
    expect(parsed.weightKg).toBe(967);
    expect(parsed.freightUsd).toBe(2645.85);
    expect(parsed.chinaDeliveryCny).toBe(1000);
  });

  it('has nothing to complain about in a file nobody edited', () => {
    expect(parsed.warnings).toEqual([]);
  });
});

describe('файл приёмки на складе в Иу (партия NV-0923-4 до отгрузки)', () => {
  const parsed = parseChinaArrivalFile(ARRIVAL_FILE_NV0923)!;

  it('reads the four markings, before they are packed onto pallets', () => {
    expect(parsed.lines).toHaveLength(4);
    expect(parsed.lines[0]).toEqual({
      marking: 'NV-101', name: '收纳盒', boxes: 30, pcsPerBox: 6, qty: 180,
      boxLengthM: 0.32, boxWidthM: 0.59, boxHeightM: 0.43, factoryBoxKg: 8.4
    });
  });

  it('sums to the 合计 row: 80 boxes, 847 kg, 7,56112 m³', () => {
    const boxes = parsed.lines.reduce((sum, l) => sum + l.boxes, 0);
    const kg = parsed.lines.reduce((sum, l) => sum + l.boxes * l.factoryBoxKg, 0);
    expect(boxes).toBe(80);
    expect(Math.round(kg * 100) / 100).toBe(847);
  });

  it('names the draft after the customer and the day it reached the warehouse', () => {
    expect(parsed.receivedAt).toBe('2026-09-23');
    expect(parsed.customer).toBe('NV');
    expect(parsed.draftCode).toBe('NV-0923');
  });

  it('has nothing to complain about in a file nobody edited', () => {
    expect(parsed.warnings).toEqual([]);
  });

  it('is empty without a customer marker, keeping the day alone', () => {
    const noCustomer: ChinaSheets = { 'Sheet2': ARRIVAL_FILE_NV0923['Sheet2'].map((row) => row.slice()) as ChinaSheetGrid };
    const header = noCustomer['Sheet2'].findIndex((row) => row.some((c) => String(c).indexOf('货号') !== -1));
    const custCol = noCustomer['Sheet2'][header].findIndex((c) => String(c).indexOf('客户') !== -1);
    for (let r = header + 1; r < noCustomer['Sheet2'].length; r++) noCustomer['Sheet2'][r][custCol] = '';
    const withoutCustomer = parseChinaArrivalFile(noCustomer)!;
    expect(withoutCustomer.draftCode).toBe('0923');
  });

  it('says when boxes times pieces-per-box does not match the stated quantity', () => {
    const sheets: ChinaSheets = { 'Sheet2': ARRIVAL_FILE_NV0923['Sheet2'].map((row) => row.slice()) as ChinaSheetGrid };
    const header = sheets['Sheet2'].findIndex((row) => row.some((c) => String(c).indexOf('货号') !== -1));
    const qtyCol = sheets['Sheet2'][header].findIndex((c) => String(c).indexOf('总数量') !== -1);
    sheets['Sheet2'][header + 2][qtyCol] = 999; // was 180 = 30 * 6
    const broken = parseChinaArrivalFile(sheets)!;
    expect(broken.warnings.join(' ')).toContain('коробки на штуки в коробке дают 180 шт, в файле 999 шт');
  });

  it('says when boxes times the box weight does not match the total weight of the line', () => {
    const sheets: ChinaSheets = { 'Sheet2': ARRIVAL_FILE_NV0923['Sheet2'].map((row) => row.slice()) as ChinaSheetGrid };
    const header = sheets['Sheet2'].findIndex((row) => row.some((c) => String(c).indexOf('货号') !== -1));
    const weightCol = sheets['Sheet2'][header].findIndex((c) => String(c).indexOf('总毛重') !== -1);
    sheets['Sheet2'][header + 2][weightCol] = 100; // was 252 = 30 * 8.4
    const broken = parseChinaArrivalFile(sheets)!;
    expect(broken.warnings.join(' ')).toContain('вес коробок 252 кг, в файле 100 кг');
  });

  it('says when the lines do not sum to the 合计 row', () => {
    const sheets: ChinaSheets = { 'Sheet2': ARRIVAL_FILE_NV0923['Sheet2'].map((row) => row.slice()) as ChinaSheetGrid };
    const totalsRow = sheets['Sheet2'].findIndex((row) => row.some((c) => String(c) === '合计'));
    const header = sheets['Sheet2'].findIndex((row) => row.some((c) => String(c).indexOf('货号') !== -1));
    const boxCol = sheets['Sheet2'][header].findIndex((c) => String(c).indexOf('件数') !== -1);
    sheets['Sheet2'][totalsRow][boxCol] = 999; // was 80
    const broken = parseChinaArrivalFile(sheets)!;
    expect(broken.warnings.join(' ')).toContain('Коробки: по строкам 80, в строке "合计" 999');
  });

  it('says when there is no goods row at all', () => {
    // Item 81h: an empty marking no longer means an empty row (see below) — zero every
    // quantity and box count instead, the way a truly empty sheet looks.
    const sheets: ChinaSheets = { 'Sheet2': ARRIVAL_FILE_NV0923['Sheet2'].map((row) => row.slice()) as ChinaSheetGrid };
    const header = sheets['Sheet2'].findIndex((row) => row.some((c) => String(c).indexOf('货号') !== -1));
    const qtyCol = sheets['Sheet2'][header].findIndex((c) => String(c).indexOf('总数量') !== -1);
    const boxCol = sheets['Sheet2'][header].findIndex((c) => String(c).indexOf('件数') !== -1);
    for (let r = header + 1; r < sheets['Sheet2'].length; r++) {
      sheets['Sheet2'][r][qtyCol] = 0;
      sheets['Sheet2'][r][boxCol] = 0;
    }
    const empty = parseChinaArrivalFile(sheets)!;
    expect(empty.lines).toHaveLength(0);
    expect(empty.warnings.join(' ')).toContain('ни одной строки товара');
  });

  it('keeps a product row whose marking (货号) is empty, per item 81h', () => {
    const sheets: ChinaSheets = { 'Sheet2': ARRIVAL_FILE_NV0923['Sheet2'].map((row) => row.slice()) as ChinaSheetGrid };
    const header = sheets['Sheet2'].findIndex((row) => row.some((c) => String(c).indexOf('货号') !== -1));
    const markCol = sheets['Sheet2'][header].findIndex((c) => String(c).indexOf('货号') !== -1);
    sheets['Sheet2'][header + 2][markCol] = ''; // only the FIRST product line loses its marking
    const withEmptyMarking = parseChinaArrivalFile(sheets)!;
    expect(withEmptyMarking.lines).toHaveLength(4);
    expect(withEmptyMarking.lines[0].marking).toBe('');
    expect(withEmptyMarking.lines[0].boxes).toBe(30);
    expect(withEmptyMarking.lines[0].factoryBoxKg).toBe(8.4);
  });

  it('keeps a line with boxes but zero 总数量, and one with 总数量 but zero boxes — either alone is enough', () => {
    const sheets: ChinaSheets = { 'Sheet2': ARRIVAL_FILE_NV0923['Sheet2'].map((row) => row.slice()) as ChinaSheetGrid };
    const header = sheets['Sheet2'].findIndex((row) => row.some((c) => String(c).indexOf('货号') !== -1));
    const qtyCol = sheets['Sheet2'][header].findIndex((c) => String(c).indexOf('总数量') !== -1);
    const boxCol = sheets['Sheet2'][header].findIndex((c) => String(c).indexOf('件数') !== -1);
    sheets['Sheet2'][header + 2][qtyCol] = 0; // NV-101: boxes 30, no total quantity
    sheets['Sheet2'][header + 3][boxCol] = 0; // NV-102: no boxes, total quantity 150
    const parsed = parseChinaArrivalFile(sheets)!;
    expect(parsed.lines.map((l) => l.marking)).toEqual(['NV-101', 'NV-102', 'NV-103', 'NV-104']);
  });
});

describe('item 81h: arrival file of a single product the carrier gave no marking (货号) at all', () => {
  const parsed = parseChinaArrivalFile(ARRIVAL_FILE_NV0916)!;

  it('keeps the line instead of dropping it, box data intact', () => {
    expect(parsed.lines).toHaveLength(1);
    expect(parsed.lines[0]).toEqual({
      marking: '', name: '宠物碗', boxes: 24, pcsPerBox: 42, qty: 1008,
      boxLengthM: 0.55, boxWidthM: 0.68, boxHeightM: 0.45, factoryBoxKg: 17
    });
  });

  it('agrees with the 合计 row and needs no warning', () => {
    expect(parsed.warnings).toEqual([]);
  });

  it('names the draft after the customer and the day it reached the warehouse', () => {
    expect(parsed.receivedAt).toBe('2026-09-16');
    expect(parsed.customer).toBe('NV');
    expect(parsed.draftCode).toBe('NV-0916');
  });
});

describe('что парсер отказывается принять молча', () => {
  const detailName = '详单';

  it('says when a line sum does not match its own quantity and price', () => {
    const sheets = copy(BATCH_FILE_28);
    const grid = sheets[detailName];
    const header = grid.findIndex((row) => row.some((c) => String(c).indexOf('货号') !== -1));
    const sumCol = grid[header].findIndex((c) => String(c).indexOf('总额') !== -1);
    grid[header + 2][sumCol] = 5000; // was 4872
    const parsed = parseChinaBatchFile(sheets)!;
    expect(parsed.warnings.join(' ')).toContain('количество на цену');
  });

  it('says when the pallets do not weigh what the waybill says', () => {
    const sheets = copy(BATCH_FILE_28);
    const grid = sheets[detailName];
    const header = grid.findIndex((row) => row.some((c) => String(c).indexOf('货号') !== -1));
    const weightCol = grid[header].findIndex((c) => String(c).indexOf('总毛重') !== -1);
    grid[header + 2][weightCol] = 200; // was 339
    const parsed = parseChinaBatchFile(sheets)!;
    expect(parsed.warnings.join(' ')).toContain('Вес: паллеты в сумме');
  });

  it('says when the goods and the local delivery do not add up to the declared value', () => {
    const sheets = copy(BATCH_FILE_28);
    const waybill = sheets['运单表'];
    const cell = waybill.findIndex((row) => row.some((c) => String(c).indexOf('货值') !== -1));
    const col = waybill[cell].findIndex((c) => String(c).indexOf('货值') !== -1);
    waybill[cell][col + 2] = 11000; // was 10444
    const parsed = parseChinaBatchFile(sheets)!;
    expect(parsed.warnings.join(' ')).toContain('Стоимость товара');
  });

  it('says when the rate and the freight of the waybill disagree', () => {
    const sheets = copy(BATCH_FILE_28);
    const waybill = sheets['运单表'];
    const header = waybill.findIndex((row) => row.filter((c) => String(c).indexOf('重量') !== -1).length > 0
      && row.some((c) => String(c).indexOf('体积') !== -1));
    const rateCol = waybill[header].findIndex((c) => String(c).indexOf('单价') !== -1);
    waybill[header + 1][rateCol] = 3; // was 2,3 $/kg
    const parsed = parseChinaBatchFile(sheets)!;
    expect(parsed.warnings.join(' ')).toContain('Ставка:');
  });

  it('says when there is no goods row at all', () => {
    const sheets = copy(BATCH_FILE_28);
    const grid = sheets[detailName];
    const header = grid.findIndex((row) => row.some((c) => String(c).indexOf('货号') !== -1));
    const markCol = grid[header].findIndex((c) => String(c).indexOf('货号') !== -1);
    for (let r = header + 1; r < grid.length; r++) grid[r][markCol] = '';
    const parsed = parseChinaBatchFile(sheets)!;
    expect(parsed.lines).toHaveLength(0);
    expect(parsed.warnings.join(' ')).toContain('ни одной строки товара');
  });
});

describe('финансовый отчёт 24.09.2026', () => {
  const report = parseChinaReportFile(REPORT_FILE)!;

  it('reads every order from 19 to 31', () => {
    expect(report.orders.map((o) => o.orderNo)).toEqual(
      ['19', '20', '21', '22', '23', '24', '25', '26', '27', '28', '29', '30', '31']);
  });

  it('reads what is paid and what is still owed', () => {
    expect(chinaOrderOf(report, '28')).toMatchObject({ totalCny: 10444, receivedCny: 10444, unpaidCny: 0 });
    expect(chinaOrderOf(report, '30')).toMatchObject({ totalCny: 13520, receivedCny: 4056, unpaidCny: 9464 });
    expect(chinaOrderOf(report, '31')).toMatchObject({ totalCny: 6000, receivedCny: 0, depositCny: 1800, unpaidCny: 6000 });
  });

  it('reads the log of transfers, which keeps its own dates beside the orders', () => {
    expect(report.transfers).toHaveLength(17);
    expect(report.transfers[0]).toEqual({ date: '结转', amountCny: 17402 });
    expect(report.transfers[report.transfers.length - 1]).toEqual({ date: '26.9.16', amountCny: 5001 });
  });

  it('reads the freight of every batch, with the arrival date the batch file never has', () => {
    const freight = chinaFreightOf(report, 'NV-0825-2')!;
    expect(freight).toMatchObject({
      orderNo: '28', shippedAt: '2026-08-27', arrivedAt: '2026-09-17',
      ratePerKgUsd: 2.3, weightKg: 672.5, amountUsd: 1637
    });
  });

  it('takes the yuan-per-dollar rate of a batch from the payment that settles it', () => {
    // The report writes the rate nowhere but inside the text of a payment row: 7,25 at the
    // beginning of the year, 7 since May.
    expect(chinaFreightOf(report, 'NV-0825-2')!.cargoRate).toBe(7);
    expect(chinaFreightOf(report, 'NV-0716-3')!.cargoRate).toBe(7);
    expect(chinaFreightOf(report, 'NV-1209-7')!.cargoRate).toBe(7.25);
    expect(chinaFreightOf(report, 'NV-0310-10')!.cargoRate).toBe(7.25);
    expect(chinaFreightOf(report, 'NV-0424-12')!.cargoRate).toBe(7);
  });

  it('gives the newest batch, which nobody has paid for yet, the last rate known', () => {
    // NV-0916-24 and NV-0923-4 sit BELOW the last payment row of the report: there is no
    // payment after them to read a rate from, so the rate has to come from the one before.
    expect(chinaFreightOf(report, 'NV-0916-24')!.cargoRate).toBe(7);
    expect(chinaFreightOf(report, 'NV-0923-4')!.cargoRate).toBe(7);
    expect(chinaFreightOf(report, 'NV-0923-4')!.arrivedAt).toBe('');
  });

  it('takes the LAST row when the carrier billed one batch twice', () => {
    const sheets = copy(REPORT_FILE);
    const grid = sheets['运费结算'];
    const row = grid.find((r) => r.some((c) => String(c).indexOf('NV-0825-2') !== -1))!.slice();
    const weightCol = grid.findIndex(() => false) === -1 ? row.findIndex((c) => c === 672.5) : -1;
    row[weightCol] = 700;
    grid.push(row);
    const again = parseChinaReportFile(sheets)!;
    expect(chinaFreightOf(again, 'NV-0825-2')!.weightKg).toBe(700);
  });

  it('a row that is not a batch number is not a batch', () => {
    const sheets = copy(REPORT_FILE);
    const grid = sheets['运费结算'];
    const header = grid.findIndex((r) => r.some((c) => String(c).indexOf('票号') !== -1));
    const ticketCol = grid[header].findIndex((c) => String(c).indexOf('票号') !== -1);
    const junk = new Array(grid[header].length).fill('');
    junk[ticketCol] = 'ИТОГО по перевозкам';
    grid.push(junk);
    const again = parseChinaReportFile(sheets)!;
    expect(again.freights.every((f) => /^NV-/i.test(f.code))).toBe(true);
    expect(again.freights).toHaveLength(report.freights.length);
  });

  it('knows nothing about a batch that is not in the report', () => {
    expect(chinaFreightOf(report, 'NV-9999-9')).toBeNull();
    expect(chinaOrderOf(report, '404')).toBeNull();
    expect(chinaFreightOf(null, 'NV-0825-2')).toBeNull();
  });

  it('reads the payments of the carrier with their rates', () => {
    expect(report.payments).toHaveLength(15);
    expect(report.payments[0]).toEqual({ date: '2026-01-15', note: '37491/7.25=5171＄', amountUsd: 5171, cargoRate: 7.25 });
    expect(report.payments[report.payments.length - 1]).toEqual({ date: '2026-09-18', note: '9328/7=1332', amountUsd: 1332, cargoRate: 7 });
  });

  it('has nothing to complain about in the owner’s own report', () => {
    expect(report.warnings).toEqual([]);
  });
});

describe('что не должно сойти за шапку таблицы', () => {
  it('a paragraph naming every heading at once is not a header row', () => {
    // The parser needs its labels in SEPARATE cells. One cell that happens to mention all of
    // them — a line of the carrier's agreement, say — must not win over the real header.
    const sheets: ChinaSheets = {
      '运单表': [
        ['货值：', '', 1000],
        ['请核对：票号、重量、体积、单价、运费'],
        ['货物品名', '总件数', '体积', '重量', '单价', '保险费', '包装费', '佣金', '运费'],
        ['收纳盒', 2, 4.92, 672.5, 2.3, 0, 90, 0, 1546.75],
        ['合计', '', '', '', '', 1636.75]
      ],
      '详单': [
        ['货号', '品名', '件数', '装箱数', '总数量', '单价¥', '总额¥', '总毛重'],
        ['NV-99', '收纳盒', 30, 8, 240, 20.3, 4872, 339]
      ]
    };
    const parsed = parseChinaBatchFile(sheets)!;
    expect(parsed.weightKg).toBe(672.5);
    expect(parsed.freightUsd).toBe(1636.75);
    expect(parsed.lines).toHaveLength(1);
  });
});

describe('курс юаней за доллар из текста оплаты', () => {
  it('reads both shapes the carrier writes', () => {
    expect(cargoRateFromNote('9328/7=1332')).toBe(7);
    expect(cargoRateFromNote('2462/7=351')).toBe(7);
    expect(cargoRateFromNote('8606/7=1229.')).toBe(7);
    expect(cargoRateFromNote('35273/7')).toBe(7);
    expect(cargoRateFromNote('832*7.25=6032')).toBe(7.25);
    expect(cargoRateFromNote('2466*7=17262')).toBe(7);
    expect(cargoRateFromNote('（17621-6300）/7.25')).toBe(7.25);
    expect(cargoRateFromNote('37491/7.25=5171＄')).toBe(7.25);
  });

  it('ignores a number that could not be a rate', () => {
    expect(cargoRateFromNote('17621-6300')).toBe(0);
    expect(cargoRateFromNote('оплата по договору')).toBe(0);
    expect(cargoRateFromNote('12345/1000')).toBe(0);
    expect(cargoRateFromNote('')).toBe(0);
  });
});

describe('юани перевозки из текста оплаты (81g)', () => {
  it('takes the difference when the carrier settles two batches at once', () => {
    expect(chinaReceiptFreightCny('（17621-6300）/7.25', 1562, 7.25)).toEqual({ cny: 11321, estimated: false });
    expect(chinaReceiptFreightCny('（53571-37468）/7', 2300, 7)).toEqual({ cny: 16103, estimated: false });
  });

  it('takes the number before the slash of a plain division', () => {
    expect(chinaReceiptFreightCny('37491/7.25=5171＄', 5171, 7.25)).toEqual({ cny: 37491, estimated: false });
    expect(chinaReceiptFreightCny('9328/7=1332', 1332, 7)).toEqual({ cny: 9328, estimated: false });
    expect(chinaReceiptFreightCny('8606/7=1229.', 1229, 7)).toEqual({ cny: 8606, estimated: false });
    expect(chinaReceiptFreightCny('35273/7', 5039, 7)).toEqual({ cny: 35273, estimated: false });
  });

  it('takes the number after "=" when the dollars come first, multiplied by the rate', () => {
    expect(chinaReceiptFreightCny('832*7.25=6032', 832, 7.25)).toEqual({ cny: 6032, estimated: false });
    expect(chinaReceiptFreightCny('2466*7=17262', 2466, 7)).toEqual({ cny: 17262, estimated: false });
  });

  it('falls back to the dollar amount at the batch rate, and says so, on a note it cannot read', () => {
    expect(chinaReceiptFreightCny('оплата без цифр', 100, 7)).toEqual({ cny: 700, estimated: true });
  });
});

describe('платёж китайской стороне, распределённый по отчёту (81g)', () => {
  const report = parseChinaReportFile(REPORT_FILE)!;
  const payload = chinaReportPayload(report);

  it('carries the 结转 line over rather than treating it as a receipt', () => {
    expect(payload.carriedOverCny).toBe(17402);
  });

  it('reads the freight sheet\'s own opening balance, which the freight/order parsing never sees', () => {
    expect(payload.openingFreightUsd).toBe(-85);
  });

  it('takes the report date as the latest date named anywhere in the report', () => {
    expect(payload.reportDate).toBe('2026-09-24');
  });

  it('groups goods and freight by date exactly as the owner reads the report by hand', () => {
    expect(payload.receipts.map((r) => [r.date, r.goodsCny, r.freightCny])).toEqual([
      ['2026-01-15', 34304, 37491],
      ['2026-01-22', 17241, 0],
      ['2026-01-29', 6300, 11321],
      ['2026-02-03', 0, 8718],
      ['2026-02-26', 0, 13100],
      ['2026-03-05', 6955, 6032],
      ['2026-03-26', 24732, 0],
      ['2026-04-02', 24336, 20601],
      ['2026-04-09', 0, 21739],
      ['2026-05-22', 37468, 16103],
      ['2026-05-27', 0, 35273],
      ['2026-06-08', 11559, 17262],
      ['2026-06-19', 7359, 0],
      ['2026-07-21', 5668, 0],
      ['2026-07-24', 352, 8606],
      ['2026-08-04', 4819, 0],
      ['2026-08-20', 10415, 16303],
      ['2026-08-27', 12226, 10416],
      ['2026-09-03', 2974, 0],
      ['2026-09-16', 5001, 2462],
      ['2026-09-18', 0, 9328]
    ]);
  });

  it('the goods receipts plus the carried-over balance equal every order\'s "получено" total', () => {
    const sumGoods = payload.receipts.reduce((sum, r) => sum + r.goodsCny, 0);
    expect(sumGoods + payload.carriedOverCny).toBe(229111);
    expect(report.orders.reduce((sum, o) => sum + o.receivedCny, 0)).toBe(229111);
  });

  it('passes the orders and freights of the report straight through, only the money grouped', () => {
    expect(payload.orders).toHaveLength(13);
    expect(payload.orders[payload.orders.length - 1]).toEqual({
      orderNo: '31', date: '2026-09-24', totalCny: 6000, receivedCny: 0, depositCny: 1800, unpaidCny: 6000
    });
    expect(payload.freights).toBe(report.freights);
  });

  it('has nothing to complain about in the owner\'s own report', () => {
    expect(payload.warnings).toEqual([]);
  });

  it('reports an unreadable transfer date rather than silently dropping the money', () => {
    const broken = chinaReportPayload({
      kind: 'report', orders: [], freights: [], payments: [], openingFreightUsd: 0,
      transfers: [{ date: 'непонятная дата', amountCny: 100 }],
      warnings: []
    });
    expect(broken.warnings.join(' ')).toContain('Не разобрана дата перевода');
  });

  it('keeps a known rate rather than losing it to a later payment of the same date with none', () => {
    const grouped = chinaReportPayload({
      kind: 'report', orders: [], freights: [], openingFreightUsd: 0, transfers: [],
      payments: [
        { date: '2026-01-01', note: '700/7=100', amountUsd: 100, cargoRate: 7 },
        { date: '2026-01-01', note: 'без цифр', amountUsd: 50, cargoRate: 0 }
      ],
      warnings: []
    });
    expect(grouped.receipts[0].cargoRate).toBe(7);
    // 700 ¥ read from the first note («700/7=100» — the yuan is the number before the slash),
    // plus the second payment's own fallback of 50 $ x 0 (it states no rate of its own) — the
    // two payments of one date must ADD, not replace one other.
    expect(grouped.receipts[0].freightCny).toBe(700);
  });

  it('reports a payment note it could not read, once, at the fallback estimate', () => {
    const broken = chinaReportPayload({
      kind: 'report', orders: [], freights: [], openingFreightUsd: 0, transfers: [],
      payments: [{ date: '2026-01-01', note: 'без цифр', amountUsd: 100, cargoRate: 7 }],
      warnings: []
    });
    expect(broken.receipts).toEqual([{ date: '2026-01-01', goodsCny: 0, freightCny: 700, freightUsd: 100, cargoRate: 7, note: 'без цифр' }]);
    expect(broken.warnings.join(' ')).toContain('сумма в юанях не разобрана');
  });
});

describe('номер заказа из номера билета', () => {
  it('reads it out of brackets of either alphabet', () => {
    expect(orderNoFromTicket('NV-0825-2（28）')).toBe('28');
    expect(orderNoFromTicket('NV-0310-10(22)')).toBe('22');
  });

  it('is empty when the ticket does not name an order', () => {
    expect(orderNoFromTicket('NV-1209-7')).toBe('');
    expect(orderNoFromTicket('')).toBe('');
  });
});
