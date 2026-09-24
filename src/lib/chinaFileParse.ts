/**
 * Item 81c: reading the files the Chinese side sends.
 *
 * Two kinds of file, both with a stable shape, so they are read by their own parser and not
 * guessed at by a language model:
 *
 *   the batch file      — sheet 运单表 (the carrier's waybill: code, dates, weight, volume,
 *                         the rate per kilogram, packing, the total in dollars) and sheet
 *                         详单 or 箱单 (the goods: marking, boxes, pieces per box, quantity,
 *                         the price in yuan, the weight of a pallet, and one row at the
 *                         bottom for the delivery inside China);
 *   the running account — sheet 货款结算 (per order: the total, what the factory has received,
 *                         the deposit, what is still owed, and a separate log of transfers)
 *                         and sheet 运费结算 (per batch: dates, rate, weight, the freight in
 *                         dollars; and the payment rows, whose own text is the only place the
 *                         carrier's yuan-per-dollar rate is ever written down).
 *
 * The parser states what it read AND what does not add up, so the screen can refuse to save a
 * batch whose lines do not sum to the total the file itself declares. It works out no cost:
 * that is the script's job, on the server.
 */

export type ChinaSheetGrid = (string | number)[][];
export type ChinaSheets = Record<string, ChinaSheetGrid>;

export interface ChinaParsedLine {
  marking: string;
  name: string;
  boxes: number;
  pcsPerBox: number;
  qty: number;
  priceCny: number;
  /** The sum the file states for the line; the parser never overwrites it with its own. */
  sumCny: number;
  /** Weight of the pallet this line starts; 0 when the line was packed into an earlier one. */
  palletWeightKg: number;
}

export interface ChinaParsedBatch {
  kind: 'batch';
  code: string;
  shippedAt: string;
  weightKg: number;
  volumeM3: number;
  places: number;
  ratePerKgUsd: number;
  packingUsd: number;
  /** Insurance and commission of the carrier, which it bills together with the freight. */
  otherCargoUsd: number;
  freightUsd: number;
  chinaDeliveryCny: number;
  /** 货值 from the waybill — the goods AND the delivery inside China in one figure. */
  declaredValueCny: number;
  lines: ChinaParsedLine[];
  warnings: string[];
}

export interface ChinaReportOrder {
  orderNo: string;
  date: string;
  summary: string;
  totalCny: number;
  receivedCny: number;
  depositCny: number;
  unpaidCny: number;
}

export interface ChinaReportTransfer {
  date: string;
  amountCny: number;
}

export interface ChinaReportFreight {
  code: string;
  orderNo: string;
  shippedAt: string;
  arrivedAt: string;
  ratePerKgUsd: number;
  volumeM3: number;
  weightKg: number;
  amountUsd: number;
  /** Yuan per dollar, taken from the payment that settles this batch. 0 when not stated. */
  cargoRate: number;
}

export interface ChinaReportPayment {
  date: string;
  note: string;
  amountUsd: number;
  cargoRate: number;
}

/** Item 81e: one marking of the arrival file, before the goods are put on a pallet. */
export interface ChinaArrivalLine {
  marking: string;
  name: string;
  boxes: number;
  pcsPerBox: number;
  qty: number;
  /** Of ONE factory box, in metres. */
  boxLengthM: number;
  boxWidthM: number;
  boxHeightM: number;
  /** Gross weight of ONE factory box, in kilograms. */
  factoryBoxKg: number;
}

/**
 * Item 81e: what the carrier's Yiwu warehouse reports on arrival, before the batch is
 * palletised and shipped — no prices, no batch code, only the goods and the box they came in.
 */
export interface ChinaParsedArrival {
  kind: 'arrival';
  receivedAt: string;
  customer: string;
  /** A batch not yet shipped has no code of its own: `${customer}-${MM}${DD}` of receivedAt. */
  draftCode: string;
  lines: ChinaArrivalLine[];
  warnings: string[];
}

export interface ChinaParsedReport {
  kind: 'report';
  orders: ChinaReportOrder[];
  transfers: ChinaReportTransfer[];
  freights: ChinaReportFreight[];
  payments: ChinaReportPayment[];
  /** Item 81g: the freight sheet's own opening row, with no date and no ticket of its own — a
   * balance carried in from before this report, in dollars, negative when the carrier owes it. */
  openingFreightUsd: number;
  warnings: string[];
}

const str = (cell: string | number | undefined): string =>
  cell === undefined || cell === null ? '' : String(cell).trim();

const num = (cell: string | number | undefined): number => {
  if (typeof cell === 'number') return isFinite(cell) ? cell : 0;
  const text = str(cell).replace(/[￥¥$＄\s]/g, '').replace(',', '.');
  if (text === '') return 0;
  const parsed = Number(text);
  return isFinite(parsed) ? parsed : 0;
};

const round2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

const has = (cell: string | number | undefined, needle: string): boolean => str(cell).indexOf(needle) !== -1;

/** The first cell with something in it to the right of a label. */
const rightOf = (row: (string | number)[], from: number): string => {
  for (let i = from + 1; i < row.length; i++) {
    if (str(row[i]) !== '') return str(row[i]);
  }
  return '';
};

const findCell = (grid: ChinaSheetGrid, needle: string): { row: number; col: number } | null => {
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      if (has(grid[r][c], needle)) return { row: r, col: c };
    }
  }
  return null;
};

/**
 * A header row has its labels in SEPARATE cells. The carrier's contract text mentions
 * «票号、重量、体积» inside one paragraph, and a row must never be taken for a header because
 * of it.
 */
const findHeaderRow = (grid: ChinaSheetGrid, needles: string[]): number => {
  for (let r = 0; r < grid.length; r++) {
    const used: number[] = [];
    const ok = needles.every((needle) => {
      for (let c = 0; c < grid[r].length; c++) {
        if (used.indexOf(c) === -1 && has(grid[r][c], needle)) { used.push(c); return true; }
      }
      return false;
    });
    if (ok) return r;
  }
  return -1;
};

const columnOf = (row: (string | number)[], needle: string): number => {
  for (let c = 0; c < row.length; c++) {
    if (has(row[c], needle)) return c;
  }
  return -1;
};

const sheetWith = (sheets: ChinaSheets, needles: string[]): ChinaSheetGrid | null => {
  const names = Object.keys(sheets);
  for (let i = 0; i < names.length; i++) {
    if (findHeaderRow(sheets[names[i]], needles) !== -1) return sheets[names[i]];
  }
  return null;
};

export function detectChinaFile(sheets: ChinaSheets): 'batch' | 'report' | 'arrival' | 'unknown' {
  if (sheetWith(sheets, ['订单号', '汇款金额'])) return 'report';
  if (!sheetWith(sheets, ['货号', '装箱数'])) return 'unknown';
  // The batch file always sits beside a waybill sheet (体积/重量/单价); the arrival file, sent
  // BEFORE the goods are palletised and shipped, never does.
  if (sheetWith(sheets, ['体积', '重量', '单价'])) return 'batch';
  if (sheetWith(sheets, ['货号', '装箱数', '单毛重'])) return 'arrival';
  return 'unknown';
}

/**
 * Yuan per dollar, out of the text the carrier writes against a payment: «9328/7=1332»,
 * «832*7.25=6032», «（17621-6300）/7.25». Anything outside a plausible range is ignored —
 * the same text also holds sums of tens of thousands.
 */
export function cargoRateFromNote(note: string): number {
  const matches = String(note || '').match(/[/*×]\s*(\d+(?:[.,]\d+)?)/g);
  if (!matches) return 0;
  for (let i = 0; i < matches.length; i++) {
    const value = num(matches[i].replace(/[/*×]/g, ''));
    if (value >= 5 && value <= 10) return value;
  }
  return 0;
}

/** «NV-0825-2（28）» and «NV-0310-10(22)» both name order 28 and 22. */
export function orderNoFromTicket(ticket: string): string {
  const match = String(ticket || '').match(/[（(]\s*(\d+)\s*[）)]/);
  return match ? match[1] : '';
}

/** «NV-0825-2/东线» is batch NV-0825-2. */
const codeFromTransport = (value: string): string => String(value || '').split('/')[0].trim();

export function parseChinaBatchFile(sheets: ChinaSheets): ChinaParsedBatch | null {
  const detail = sheetWith(sheets, ['货号', '装箱数']);
  const waybill = sheetWith(sheets, ['体积', '重量', '单价']);
  if (!detail || !waybill) return null;

  const warnings: string[] = [];

  // ---- the waybill: what the carrier bills for the whole batch ----
  const codeCell = findCell(waybill, '柜号');
  const code = codeCell ? codeFromTransport(rightOf(waybill[codeCell.row], codeCell.col)) : '';
  const shippedCell = findCell(waybill, '发货日期');
  const shippedAt = shippedCell ? rightOf(waybill[shippedCell.row], shippedCell.col) : '';
  const valueCell = findCell(waybill, '货值');
  const declaredValueCny = valueCell ? num(rightOf(waybill[valueCell.row], valueCell.col)) : 0;

  const headRow = findHeaderRow(waybill, ['体积', '重量', '单价']);
  const head = waybill[headRow] || [];
  const data = waybill[headRow + 1] || [];
  const pick = (needle: string): number => {
    const col = columnOf(head, needle);
    return col === -1 ? 0 : num(data[col]);
  };
  const places = pick('总件数');
  const volumeM3 = pick('体积');
  const weightKg = pick('重量');
  const ratePerKgUsd = pick('单价');
  const packingUsd = pick('包装费');
  const insuranceUsd = pick('保险费');
  const commissionUsd = pick('佣金');
  const freightBaseUsd = pick('运费');
  const freightUsd = round2(freightBaseUsd + packingUsd + insuranceUsd + commissionUsd);

  // The carrier also writes the total on its own «Итого» row. If the two disagree, the file
  // was edited by hand and nothing should be saved silently.
  const totalRow = waybill[headRow + 2] || [];
  let statedTotal = 0;
  for (let c = 0; c < totalRow.length; c++) {
    const value = num(totalRow[c]);
    if (value > 0) { statedTotal = value; break; }
  }
  if (statedTotal > 0 && Math.abs(statedTotal - freightUsd) > 0.01) {
    warnings.push(`Перевозка: по строкам ${freightUsd} $, в итоге накладной ${statedTotal} $`);
  }
  if (weightKg > 0 && ratePerKgUsd > 0) {
    const expected = round2(weightKg * ratePerKgUsd);
    if (Math.abs(expected - freightBaseUsd) > 0.5) {
      warnings.push(`Ставка: ${weightKg} кг x ${ratePerKgUsd} $ = ${expected} $, в файле ${freightBaseUsd} $`);
    }
  }

  // ---- the detail: the goods themselves ----
  const dHead = findHeaderRow(detail, ['货号', '装箱数']);
  const dRow = detail[dHead] || [];
  const col = {
    marking: columnOf(dRow, '货号'),
    name: columnOf(dRow, '品名'),
    boxes: columnOf(dRow, '件数'),
    pcsPerBox: columnOf(dRow, '装箱数'),
    qty: columnOf(dRow, '总数量'),
    price: columnOf(dRow, '单价'),
    sum: columnOf(dRow, '总额'),
    weight: columnOf(dRow, '总毛重')
  };

  const lines: ChinaParsedLine[] = [];
  let chinaDeliveryCny = 0;
  for (let r = dHead + 1; r < detail.length; r++) {
    const row = detail[r];
    const joined = row.map((c) => str(c)).join(' ');
    if (joined.indexOf('Стоимость доставки в Китае') !== -1) {
      chinaDeliveryCny = col.sum === -1 ? 0 : num(row[col.sum]);
      continue;
    }
    // The Russian caption row repeats the header in another language.
    if (joined.indexOf('маркировка') !== -1) continue;
    const marking = col.marking === -1 ? '' : str(row[col.marking]);
    if (!marking) continue;
    const qty = col.qty === -1 ? 0 : num(row[col.qty]);
    if (qty <= 0) continue;
    lines.push({
      marking,
      name: col.name === -1 ? '' : str(row[col.name]),
      boxes: col.boxes === -1 ? 0 : num(row[col.boxes]),
      pcsPerBox: col.pcsPerBox === -1 ? 0 : num(row[col.pcsPerBox]),
      qty,
      priceCny: col.price === -1 ? 0 : num(row[col.price]),
      sumCny: col.sum === -1 ? 0 : num(row[col.sum]),
      palletWeightKg: col.weight === -1 ? 0 : num(row[col.weight])
    });
  }

  if (lines.length === 0) warnings.push('В файле не нашлось ни одной строки товара');

  let goodsFromLines = 0;
  let sumFromFile = 0;
  let palletWeight = 0;
  lines.forEach((l) => {
    goodsFromLines = round2(goodsFromLines + round2(l.qty * l.priceCny));
    sumFromFile = round2(sumFromFile + l.sumCny);
    palletWeight = round2(palletWeight + l.palletWeightKg);
  });
  if (Math.abs(goodsFromLines - sumFromFile) > 0.01) {
    warnings.push(`Товар: количество на цену даёт ${goodsFromLines} ¥, а суммы строк ${sumFromFile} ¥`);
  }
  if (declaredValueCny > 0) {
    const expected = round2(sumFromFile + chinaDeliveryCny);
    if (Math.abs(expected - declaredValueCny) > 0.01) {
      warnings.push(`Стоимость товара: строки и доставка по Китаю дают ${expected} ¥, в накладной ${declaredValueCny} ¥`);
    }
  }
  if (weightKg > 0 && palletWeight > 0 && Math.abs(palletWeight - weightKg) > 0.5) {
    warnings.push(`Вес: паллеты в сумме ${palletWeight} кг, в накладной ${weightKg} кг`);
  }

  return {
    kind: 'batch',
    code,
    shippedAt,
    weightKg,
    volumeM3,
    places,
    ratePerKgUsd,
    packingUsd,
    otherCargoUsd: round2(insuranceUsd + commissionUsd),
    freightUsd,
    chinaDeliveryCny,
    declaredValueCny,
    lines,
    warnings
  };
}

const MONTH_DAY = /^\d{4}-(\d{2})-(\d{2})$/;

/**
 * Item 81e: the arrival file — one sheet, a 合计 totals row above the header, the Russian
 * caption row below it (skipped the same way the batch file's own caption row is), then one
 * row per marking. No waybill sheet exists beside it: `detectChinaFile` tells the two kinds
 * of file apart by that, not by a flag inside the file.
 */
export function parseChinaArrivalFile(sheets: ChinaSheets): ChinaParsedArrival | null {
  const detail = sheetWith(sheets, ['货号', '装箱数', '单毛重']);
  if (!detail) return null;

  const warnings: string[] = [];
  const head = findHeaderRow(detail, ['货号', '装箱数', '单毛重']);
  const dRow = detail[head] || [];
  const col = {
    date: columnOf(dRow, '入库日期'),
    customer: columnOf(dRow, '客户'),
    marking: columnOf(dRow, '货号'),
    name: columnOf(dRow, '品名'),
    boxes: columnOf(dRow, '件数'),
    pcsPerBox: columnOf(dRow, '装箱数'),
    qty: columnOf(dRow, '总数量'),
    length: columnOf(dRow, '长'),
    width: columnOf(dRow, '宽'),
    height: columnOf(dRow, '高'),
    volume: columnOf(dRow, '立方'),
    boxWeight: columnOf(dRow, '单毛重'),
    totalWeight: columnOf(dRow, '总毛重')
  };

  const get = (row: (string | number)[], c: number): number => (c === -1 ? 0 : num(row[c]));

  const lines: ChinaArrivalLine[] = [];
  let customer = '';
  let receivedAt = '';
  let sumBoxes = 0;
  let sumVolume = 0;
  let sumWeight = 0;
  for (let r = head + 1; r < detail.length; r++) {
    const row = detail[r];
    const joined = row.map((c) => str(c)).join(' ');
    // The Russian caption row repeats the header in another language.
    if (joined.indexOf('маркировка') !== -1) continue;
    const marking = col.marking === -1 ? '' : str(row[col.marking]);
    if (!marking) continue;
    const qty = get(row, col.qty);
    if (qty <= 0) continue;

    const dateText = col.date === -1 ? '' : str(row[col.date]);
    if (dateText && dateText > receivedAt) receivedAt = dateText;
    if (!customer && col.customer !== -1) customer = str(row[col.customer]);

    const boxes = get(row, col.boxes);
    const pcsPerBox = get(row, col.pcsPerBox);
    const boxLengthM = get(row, col.length);
    const boxWidthM = get(row, col.width);
    const boxHeightM = get(row, col.height);
    const factoryBoxKg = get(row, col.boxWeight);
    const lineVolume = get(row, col.volume);
    const lineWeight = get(row, col.totalWeight);

    if (boxes > 0 && pcsPerBox > 0 && boxes * pcsPerBox !== qty) {
      warnings.push(`${marking}: коробки на штуки в коробке дают ${boxes * pcsPerBox} шт, в файле ${qty} шт`);
    }
    if (boxes > 0 && boxLengthM > 0 && boxWidthM > 0 && boxHeightM > 0 && lineVolume > 0) {
      const expected = boxes * boxLengthM * boxWidthM * boxHeightM;
      if (Math.abs(expected - lineVolume) > 0.001) {
        warnings.push(`${marking}: объём по размерам ${round2(expected)} м³, в файле ${lineVolume} м³`);
      }
    }
    if (boxes > 0 && factoryBoxKg > 0 && lineWeight > 0) {
      const expected = round2(boxes * factoryBoxKg);
      if (Math.abs(expected - lineWeight) > 0.01) {
        warnings.push(`${marking}: вес коробок ${expected} кг, в файле ${lineWeight} кг`);
      }
    }

    lines.push({ marking, name: col.name === -1 ? '' : str(row[col.name]), boxes, pcsPerBox, qty, boxLengthM, boxWidthM, boxHeightM, factoryBoxKg });
    sumBoxes += boxes;
    sumVolume += lineVolume;
    sumWeight += lineWeight;
  }

  if (lines.length === 0) warnings.push('В файле не нашлось ни одной строки товара');

  // The 合计 row sits above the header, in the SAME columns as the data rows.
  const totalRow = detail.slice(0, head).find((row) => row.some((c) => has(c, '合计')));
  if (totalRow) {
    const totalBoxes = get(totalRow, col.boxes);
    const totalVolume = get(totalRow, col.volume);
    const totalWeight = get(totalRow, col.totalWeight);
    if (totalBoxes > 0 && Math.abs(totalBoxes - sumBoxes) > 0.01) {
      warnings.push(`Коробки: по строкам ${sumBoxes}, в строке "合计" ${totalBoxes}`);
    }
    if (totalVolume > 0 && Math.abs(totalVolume - sumVolume) > 0.001) {
      warnings.push(`Объём: по строкам ${round2(sumVolume)} м³, в строке "合计" ${totalVolume} м³`);
    }
    if (totalWeight > 0 && Math.abs(totalWeight - sumWeight) > 0.01) {
      warnings.push(`Вес: по строкам ${sumWeight} кг, в строке "合计" ${totalWeight} кг`);
    }
  }

  let draftCode = '';
  const match = receivedAt.match(MONTH_DAY);
  if (match) draftCode = customer ? `${customer}-${match[1]}${match[2]}` : `${match[1]}${match[2]}`;

  return { kind: 'arrival', receivedAt, customer, draftCode, lines, warnings };
}

export function parseChinaReportFile(sheets: ChinaSheets): ChinaParsedReport | null {
  const goods = sheetWith(sheets, ['订单号', '汇款金额']);
  if (!goods) return null;
  const warnings: string[] = [];

  const gHead = findHeaderRow(goods, ['订单号', '汇款金额']);
  const gRow = goods[gHead] || [];
  const gCol = {
    date: columnOf(gRow, '日期'),
    orderNo: columnOf(gRow, '订单号'),
    summary: columnOf(gRow, '摘要'),
    total: columnOf(gRow, '货款总额'),
    received: columnOf(gRow, '已收合计'),
    deposit: columnOf(gRow, '定金'),
    unpaid: columnOf(gRow, '未收总额'),
    transferDate: columnOf(gRow, '汇款日期'),
    transferAmount: columnOf(gRow, '汇款金额')
  };

  const orders: ChinaReportOrder[] = [];
  const transfers: ChinaReportTransfer[] = [];
  for (let r = gHead + 1; r < goods.length; r++) {
    const row = goods[r];
    const orderNo = gCol.orderNo === -1 ? '' : str(row[gCol.orderNo]);
    if (orderNo && /^\d+$/.test(orderNo)) {
      orders.push({
        orderNo,
        date: gCol.date === -1 ? '' : str(row[gCol.date]),
        summary: gCol.summary === -1 ? '' : str(row[gCol.summary]),
        totalCny: gCol.total === -1 ? 0 : num(row[gCol.total]),
        receivedCny: gCol.received === -1 ? 0 : num(row[gCol.received]),
        depositCny: gCol.deposit === -1 ? 0 : num(row[gCol.deposit]),
        unpaidCny: gCol.unpaid === -1 ? 0 : num(row[gCol.unpaid])
      });
    }
    // The transfers are a log of their own, beside the orders and never in step with them.
    const tDate = gCol.transferDate === -1 ? '' : str(row[gCol.transferDate]);
    const tAmount = gCol.transferAmount === -1 ? 0 : num(row[gCol.transferAmount]);
    if (tDate && tAmount > 0) transfers.push({ date: tDate, amountCny: tAmount });
  }

  const freightSheet = sheetWith(sheets, ['票号', '总金额']);
  const freights: ChinaReportFreight[] = [];
  const payments: ChinaReportPayment[] = [];
  let openingFreightUsd = 0;
  if (freightSheet) {
    const fHead = findHeaderRow(freightSheet, ['票号', '总金额']);
    const fRow = freightSheet[fHead] || [];
    const fCol = {
      shipped: columnOf(fRow, '发货日期'),
      arrived: columnOf(fRow, '到货日期'),
      ticket: columnOf(fRow, '票号'),
      summary: columnOf(fRow, '摘要'),
      rate: columnOf(fRow, '单价'),
      volume: columnOf(fRow, '体积'),
      weight: columnOf(fRow, '重量'),
      amount: columnOf(fRow, '总金额')
    };
    // Which row each batch sat on, so the rate of the payment that follows it can be found.
    const order: { batch: number; payment: number }[] = [];
    for (let r = fHead + 1; r < freightSheet.length; r++) {
      const row = freightSheet[r];
      const ticket = fCol.ticket === -1 ? '' : str(row[fCol.ticket]);
      const summary = fCol.summary === -1 ? '' : str(row[fCol.summary]);
      const amount = fCol.amount === -1 ? 0 : num(row[fCol.amount]);
      // The very first data row can be a balance carried in from before this report — no date,
      // no ticket, no 国外收 summary, just a dollar figure.
      if (r === fHead + 1 && !ticket && !summary && amount !== 0) {
        openingFreightUsd = amount;
        continue;
      }
      if (summary.indexOf('国外收') !== -1) {
        payments.push({
          date: fCol.shipped === -1 ? '' : str(row[fCol.shipped]),
          note: ticket,
          amountUsd: Math.abs(amount),
          cargoRate: cargoRateFromNote(ticket)
        });
        order.push({ batch: -1, payment: payments.length - 1 });
        continue;
      }
      if (!/^NV-/i.test(ticket)) continue;
      freights.push({
        code: ticket.split(/[（(]/)[0].trim(),
        orderNo: orderNoFromTicket(ticket) || orderNoFromTicket(fCol.summary === -1 ? '' : str(row[fCol.summary])),
        shippedAt: fCol.shipped === -1 ? '' : str(row[fCol.shipped]),
        arrivedAt: fCol.arrived === -1 ? '' : str(row[fCol.arrived]),
        ratePerKgUsd: fCol.rate === -1 ? 0 : num(row[fCol.rate]),
        volumeM3: fCol.volume === -1 ? 0 : num(row[fCol.volume]),
        weightKg: fCol.weight === -1 ? 0 : num(row[fCol.weight]),
        amountUsd: amount,
        cargoRate: 0
      });
      order.push({ batch: freights.length - 1, payment: -1 });
    }

    // The rate of a batch is the one written against the payment that settles it: the first
    // payment below it, and failing that the last one above it.
    freights.forEach((freight, index) => {
      const at = order.findIndex((o) => o.batch === index);
      let rate = 0;
      for (let i = at + 1; i < order.length && rate === 0; i++) {
        const p = order[i].payment;
        if (p !== -1 && payments[p].cargoRate > 0) rate = payments[p].cargoRate;
      }
      for (let i = at - 1; i >= 0 && rate === 0; i--) {
        const p = order[i].payment;
        if (p !== -1 && payments[p].cargoRate > 0) rate = payments[p].cargoRate;
      }
      freight.cargoRate = rate;
    });
  } else {
    warnings.push('В отчёте не нашёлся лист расчётов по перевозке');
  }

  if (orders.length === 0) warnings.push('В отчёте не нашлось ни одного заказа');
  return { kind: 'report', orders, transfers, freights, payments, openingFreightUsd, warnings };
}

/** What the report knows about a batch of the given code. */
export function chinaFreightOf(report: ChinaParsedReport | null, code: string): ChinaReportFreight | null {
  if (!report || !code) return null;
  const wanted = code.trim().toLowerCase();
  const found = report.freights.filter((f) => f.code.trim().toLowerCase() === wanted);
  return found.length > 0 ? found[found.length - 1] : null;
}

/** What the report says about an order: paid, owed, and the goods total the factory counts. */
export function chinaOrderOf(report: ChinaParsedReport | null, orderNo: string): ChinaReportOrder | null {
  if (!report || !orderNo) return null;
  const found = report.orders.filter((o) => o.orderNo === String(orderNo).trim());
  return found.length > 0 ? found[found.length - 1] : null;
}

/**
 * Item 81g: `saveChinaReport`'s payload, built from what the parser read — no money computed
 * here, only grouped and converted, exactly the way the owner reads the report by hand.
 */
export interface ChinaReportReceiptPayload {
  date: string;
  goodsCny: number;
  freightCny: number;
  freightUsd: number;
  cargoRate: number;
  note: string;
}

export interface ChinaReportOrderPayload {
  orderNo: string;
  date: string;
  totalCny: number;
  receivedCny: number;
  depositCny: number;
  unpaidCny: number;
}

export interface ChinaReportPayload {
  reportDate: string;
  source: 'скрипт';
  aiReason: string;
  carriedOverCny: number;
  openingFreightUsd: number;
  orders: ChinaReportOrderPayload[];
  receipts: ChinaReportReceiptPayload[];
  freights: ChinaReportFreight[];
  warnings: string[];
}

const DOT_DATE = /^(\d{1,2})\.(\d{1,2})\.(\d{1,2})$/;

/** The carrier's own date, «26.9.16» — a two-digit year, then month, then day; a date already
 * given as 'yyyy-mm-dd' (the freight sheet's own payment rows) passes straight through. */
function reportDateToIso(text: string): string {
  if (MONTH_DAY.test(text)) return text;
  const match = text.match(DOT_DATE);
  if (!match) return '';
  const year = 2000 + Number(match[1]);
  const month = match[2].padStart(2, '0');
  const day = match[3].padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * The freight yuan of one «国外收» row, out of the carrier's own arithmetic in its note text —
 * three shapes seen in the real report: «(A-B)/rate» when one payment settles two batches at
 * once (the yuan is A-B), «A/rate[=usd]» the usual shape (the yuan is A, before the slash), and
 * «usd*rate=A» when the yuan is written last, after the dollar side is multiplied by the rate.
 * A note the parser cannot read at all falls back to the dollar amount at the batch's own rate,
 * and says so, rather than silently making a number up.
 */
export function chinaReceiptFreightCny(note: string, amountUsd: number, cargoRate: number): { cny: number; estimated: boolean } {
  const text = String(note || '');
  const minus = text.match(/[（(]?\s*(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*[）)]?\s*\//);
  if (minus) return { cny: round2(Number(minus[1]) - Number(minus[2])), estimated: false };
  const times = text.match(/^(\d+(?:\.\d+)?)\s*\*\s*\d+(?:\.\d+)?\s*=\s*(\d+(?:\.\d+)?)/);
  if (times) return { cny: Number(times[2]), estimated: false };
  const divide = text.match(/^(\d+(?:\.\d+)?)\s*\//);
  if (divide) return { cny: Number(divide[1]), estimated: false };
  return { cny: round2(amountUsd * cargoRate), estimated: true };
}

/**
 * Item 81g: receipts grouped by date exactly the way the owner reads the report — the goods log
 * (transfers, keyed on its own dates) and the freight settlement's «国外收» payments have no
 * other link between them, ONE payment is ONE date, and «结转» is history carried over, not a
 * receipt of its own.
 */
export function chinaReportPayload(parsed: ChinaParsedReport): ChinaReportPayload {
  const warnings = parsed.warnings.slice();
  let carriedOverCny = 0;
  const goodsByDate: Record<string, number> = {};
  const allDates: string[] = [];

  parsed.transfers.forEach((t) => {
    if (t.date === '结转') { carriedOverCny = t.amountCny; return; }
    const date = reportDateToIso(t.date);
    if (!date) { warnings.push(`Не разобрана дата перевода «${t.date}»`); return; }
    goodsByDate[date] = round2((goodsByDate[date] || 0) + t.amountCny);
    allDates.push(date);
  });

  const freightByDate: Record<string, { cny: number; usd: number; rate: number; note: string }> = {};
  parsed.payments.forEach((p) => {
    const result = chinaReceiptFreightCny(p.note, p.amountUsd, p.cargoRate);
    if (result.estimated) {
      warnings.push(`Оплата от ${p.date}: сумма в юанях не разобрана в тексте «${p.note}», взята по курсу`);
    }
    const bucket = freightByDate[p.date] || { cny: 0, usd: 0, rate: 0, note: '' };
    bucket.cny = round2(bucket.cny + result.cny);
    bucket.usd = round2(bucket.usd + p.amountUsd);
    if (p.cargoRate > 0) bucket.rate = p.cargoRate;
    bucket.note = bucket.note ? `${bucket.note}; ${p.note}` : p.note;
    freightByDate[p.date] = bucket;
    allDates.push(p.date);
  });

  const dates = Array.from(new Set(Object.keys(goodsByDate).concat(Object.keys(freightByDate)))).sort();
  const receipts: ChinaReportReceiptPayload[] = dates.map((date) => ({
    date,
    goodsCny: goodsByDate[date] || 0,
    freightCny: freightByDate[date] ? freightByDate[date].cny : 0,
    freightUsd: freightByDate[date] ? freightByDate[date].usd : 0,
    cargoRate: freightByDate[date] ? freightByDate[date].rate : 0,
    note: freightByDate[date] ? freightByDate[date].note : ''
  }));

  // The report's own date is the latest date it names anywhere — an order just opened, a batch
  // just shipped or a payment just made, whichever is newest.
  parsed.orders.forEach((o) => { if (o.date) allDates.push(o.date); });
  parsed.freights.forEach((f) => {
    if (f.shippedAt) allDates.push(f.shippedAt);
    if (f.arrivedAt) allDates.push(f.arrivedAt);
  });
  const reportDate = allDates.length > 0 ? allDates.reduce((a, b) => (b > a ? b : a)) : '';

  return {
    reportDate,
    source: 'скрипт',
    aiReason: '',
    carriedOverCny,
    openingFreightUsd: parsed.openingFreightUsd,
    orders: parsed.orders.map((o) => ({
      orderNo: o.orderNo, date: o.date, totalCny: o.totalCny, receivedCny: o.receivedCny,
      depositCny: o.depositCny, unpaidCny: o.unpaidCny
    })),
    receipts,
    freights: parsed.freights,
    warnings
  };
}
