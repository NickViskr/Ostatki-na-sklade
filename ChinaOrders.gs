// ===== Module «Заказы в Китае» (plan item 81, stage 81a) =====
//
// A factory order lives in its OWN spreadsheet, opened by the script property
// `china_spreadsheetId`. The id never appears in this file: the repository is public.
//
// What the module computes. A batch costs the owner four different things, in three
// currencies, and they land on the goods by three different bases:
//
//   goods                      ¥   → straight to its own line
//   local delivery in China    ¥   → split by weight
//   the carrier (cargo)        $   → converted to ¥ by the directory rate, split by weight
//   unloading / delivery here  ₽   → split by the NUMBER OF BOXES (owner, 2026-09-22)
//
// The ruble amount of the first three is the ¥ total times the rate at which the owner
// bought those yuan for cash. The rate is stored on the batch, so a closed batch keeps the
// cost it was computed with.
//
// Weight is the hard part. The carrier's file states weight PER PALLET, never per article,
// and the lines that were packed into an already weighed pallet carry no weight at all. So
// the weight of an article is an ESTIMATE: kilograms per box are taken from the pallets
// where that marking was weighed, spread over all of its boxes, and the result is normalised
// so the batch sums to the weight of the waybill. The normalising factor is returned and
// shown — a factor far from 1 means the file's pallets and lines do not agree. Where the
// estimate is visibly wrong (one real batch gives 22 kg per box for goods that weigh 11),
// the owner types the weight of one box himself and that number wins.
//
// The marking (NV-99, NV-98) is the CARRIER'S and identifies goods inside ONE batch only,
// so there is no permanent dictionary of markings. Our own article is assigned to a line
// afterwards and does not take part in the costing.

const CHINA_PROPERTY = 'china_spreadsheetId';

const CHINA_BATCHES_SHEET = 'Партии';
const CHINA_LINES_SHEET = 'Строки партий';
const CHINA_COSTS_SHEET = 'Расходы партии';
const CHINA_PAYMENTS_SHEET = 'Платежи';
const CHINA_SETTINGS_SHEET = 'Справочник';

const CHINA_BATCH_HEADERS = [
  'ID', 'Номер заказа', 'Код партии', 'Дата отгрузки', 'Дата прибытия', 'Статус',
  'Товар ¥', 'Доставка по Китаю ¥', 'Вес накладной, кг', 'Объём, м³',
  'Ставка $/кг', 'Упаковка $', 'Прочее карго $', 'Перевозка $', 'Курс ¥/$', 'Перевозка ¥',
  'Расходы РФ ₽', 'Курс ₽/¥', 'Курс вручную', 'Источник курса', 'Себестоимость партии ₽', 'Коэффициент веса',
  'Оплачено по отчёту ¥', 'Долг по отчёту ¥',
  'Комментарий', 'Кто', 'Обновлено'
];

const CHINA_LINE_HEADERS = [
  'ID', 'ПартияID', 'Маркировка', 'Название', 'Коробок', 'Шт/коробку', 'Количество',
  'Цена ¥', 'Сумма ¥', 'Паллета', 'Вес паллеты, кг', 'Вес коробки, кг',
  'Вес расчётный, кг', 'Источник веса',
  'Доставка Китай ¥', 'Перевозка ¥', 'Расходы РФ ₽',
  'Себестоимость ₽', 'Себестоимость ₽/шт', 'Наш артикул', 'Один товар'
];

const CHINA_COST_HEADERS = ['ID', 'ПартияID', 'Дата', 'Тип', 'Сумма ₽', 'Комментарий', 'Кто'];

// Item 81d: what the owner paid, in rubles, and how many yuan it bought. The rate of a batch
// is worked out from the payments put against its ORDER — the owner states the rate in his
// message, or the report of the Chinese side confirms how many yuan arrived and the rate falls
// out of the pair.
const CHINA_PAYMENT_HEADERS = ['ID', 'Дата', 'Сумма ₽', 'Курс ₽/¥', 'Куплено ¥', 'Назначение',
  'Номер заказа', 'Подтверждено', 'Комментарий', 'Кто'];

const CHINA_PAYMENT_PURPOSES = ['Товар', 'Перевозка'];

const CHINA_SETTINGS_HEADERS = ['Ключ', 'Значение', 'Описание'];

const CHINA_SETTINGS_DEFAULTS = [
  { key: 'cargoRateCnyPerUsd', value: 7, desc: 'Курс карго: сколько юаней за 1 доллар перевозки' }
];

const CHINA_STATUSES = ['Черновик', 'В пути', 'Прибыла'];

// Kinds of a Russian-side cost. Free text is refused so the sheet stays sortable.
const CHINA_COST_TYPES = ['Разгрузка', 'Доставка до склада', 'Прочее'];

// ---------------------------------------------------------------- spreadsheet access

// The owner sets the property by hand, and what lands there is as often the whole link as
// the bare id — with a stray space or a newline from the clipboard. Both are accepted.
function chinaIdFromSetting(raw) {
  const value = String(raw === null || raw === undefined ? '' : raw).trim();
  if (!value) return '';
  const fromUrl = value.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (fromUrl) return fromUrl[1];
  return value;
}

// The time zone of the module's spreadsheet. A date typed into a sheet is midnight in THAT
// zone; read in the script's zone (Asia/Yekaterinburg) it would move a day back whenever the
// spreadsheet sits east of it. Set every time the spreadsheet is opened.
let _chinaTimeZone = '';

function chinaSpreadsheet() {
  const id = chinaIdFromSetting(PropertiesService.getScriptProperties().getProperty(CHINA_PROPERTY));
  if (!id) {
    throw new Error('Таблица «Заказы в Китае» не настроена: в свойствах скрипта нет ' + CHINA_PROPERTY);
  }
  let ss;
  try {
    ss = SpreadsheetApp.openById(id);
  } catch (e) {
    throw new Error('Таблица «Заказы в Китае» недоступна: ' + errorMessage(e));
  }
  _chinaTimeZone = typeof ss.getSpreadsheetTimeZone === 'function' ? String(ss.getSpreadsheetTimeZone() || '') : '';
  return ss;
}

function chinaSheet(ss, name, headers) {
  const sheet = getOrCreateSheet(ss, name, headers);
  ensureColumns(sheet, headers);
  return sheet;
}

// Creates every sheet of the module, seeds the directory and throws out the empty sheet
// Google puts into a brand new spreadsheet. Idempotent: running it twice changes nothing.
function setupChinaSpreadsheet() {
  const ss = chinaSpreadsheet();
  const plan = [
    { name: CHINA_BATCHES_SHEET, headers: CHINA_BATCH_HEADERS },
    { name: CHINA_LINES_SHEET, headers: CHINA_LINE_HEADERS },
    { name: CHINA_COSTS_SHEET, headers: CHINA_COST_HEADERS },
    { name: CHINA_PAYMENTS_SHEET, headers: CHINA_PAYMENT_HEADERS },
    { name: CHINA_SETTINGS_SHEET, headers: CHINA_SETTINGS_HEADERS }
  ];
  const created = [];
  plan.forEach(function (p) {
    if (!getSheetByNameRobust(ss, p.name)) created.push(p.name);
    chinaSheet(ss, p.name, p.headers);
  });

  seedChinaSettings(ss);
  dropEmptyDefaultSheet(ss, plan.map(function (p) { return p.name; }));
  nameChinaSpreadsheet(ss);

  // The owner runs this from the script editor, where the only thing he sees is the log.
  Logger.log('Заказы в Китае: таблица «' + (typeof ss.getName === 'function' ? ss.getName() : '') +
    '», листов создано: ' + created.length + ', всего листов модуля: ' + plan.length);
  return { spreadsheetId: ss.getId(), sheets: plan.map(function (p) { return p.name; }), created: created };
}

function seedChinaSettings(ss) {
  const sheet = chinaSheet(ss, CHINA_SETTINGS_SHEET, CHINA_SETTINGS_HEADERS);
  const lastRow = sheet.getLastRow();
  const known = {};
  if (lastRow > 1) {
    const values = sheet.getRange(1, 1, lastRow, CHINA_SETTINGS_HEADERS.length).getValues();
    for (let i = 1; i < values.length; i++) known[String(values[i][0]).trim()] = true;
  }
  CHINA_SETTINGS_DEFAULTS.forEach(function (d) {
    if (!known[d.key]) sheet.appendRow([d.key, d.value, d.desc]);
  });
}

// A new Google spreadsheet arrives with «Лист1»/«Sheet1». It is deleted only if it is not
// ours and holds nothing: a sheet with data is never touched, whatever it is called.
function dropEmptyDefaultSheet(ss, ourNames) {
  const sheets = ss.getSheets();
  if (sheets.length <= ourNames.length) return;
  for (let i = 0; i < sheets.length; i++) {
    const name = String(sheets[i].getName()).trim();
    if (ourNames.indexOf(name) !== -1) continue;
    if (!/^(Лист|Sheet)\s*\d*$/i.test(name)) continue;
    if (sheets[i].getLastRow() > 0) continue;
    try { ss.deleteSheet(sheets[i]); } catch (e) { /* a sheet that refuses to go is left alone */ }
    return;
  }
}

// A spreadsheet the owner made by hand arrives called «Новая таблица». Only that default name is
// replaced: a name the owner chose himself is his.
function nameChinaSpreadsheet(ss) {
  if (typeof ss.rename !== 'function' || typeof ss.getName !== 'function') return;
  const name = String(ss.getName() || '').trim();
  if (name !== 'Новая таблица' && name !== 'Untitled spreadsheet' && name !== '') return;
  try { ss.rename('Заказы в Китае'); } catch (e) { /* a rename we are not allowed to do is not a failure */ }
}

// ---------------------------------------------------------------- reading

// Reads a sheet into plain objects keyed by the header text, so a reordered or widened
// header row cannot shift a column.
// The header row is ALWAYS the sheet's own, even when there is no data under it. A sheet made
// by an earlier version of the module has its newer columns appended at the END by
// ensureColumns, so the order of the constants in this file is not the order of the sheet —
// and every write below goes by the sheet's own header row for exactly that reason.
// (Review of 2026-09-24: writing in the order of the constants shifted every value of a
// batch on the live spreadsheet, and its cost read back as 0.)
function chinaReadSheet(ss, name, headers) {
  const sheet = chinaSheet(ss, name, headers);
  const lastRow = sheet.getLastRow();
  const lastCol = Math.max(sheet.getLastColumn(), headers.length);
  const values = sheet.getRange(1, 1, Math.max(lastRow, 1), lastCol).getValues();
  const head = values[0].map(function (h) { return String(h).trim(); });
  if (lastRow <= 1) return { sheet: sheet, headers: head, rows: [] };
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (row.join('').trim() === '') continue;
    const obj = {};
    head.forEach(function (h, k) { if (h) obj[h] = row[k]; });
    obj.__row = i + 1;
    rows.push(obj);
  }
  return { sheet: sheet, headers: head, rows: rows };
}

function getChinaSettings() {
  const ss = chinaSpreadsheet();
  const ctx = chinaReadSheet(ss, CHINA_SETTINGS_SHEET, CHINA_SETTINGS_HEADERS);
  const out = {};
  CHINA_SETTINGS_DEFAULTS.forEach(function (d) { out[d.key] = d.value; });
  ctx.rows.forEach(function (r) {
    const key = String(r['Ключ'] || '').trim();
    if (!key) return;
    const raw = r['Значение'];
    const num = parseNumber(raw);
    out[key] = (raw === '' || raw === null || raw === undefined || isNaN(Number(String(raw).replace(',', '.')))) ? raw : num;
  });
  return out;
}

function chinaDateText(value, field) {
  if (value === null || value === undefined || value === '') return '';
  if (value instanceof Date) {
    return Utilities.formatDate(value, _chinaTimeZone || Session.getScriptTimeZone() || 'GMT', 'yyyy-MM-dd');
  }
  const str = String(value).trim();
  if (!str) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    throw new Error('Дата «' + field + '» должна быть в формате ГГГГ-ММ-ДД, получено "' + str + '"');
  }
  return str;
}

function chinaBatchFromRow(r) {
  return {
    id: String(r['ID'] || '').trim(),
    orderNo: String(r['Номер заказа'] || '').trim(),
    code: String(r['Код партии'] || '').trim(),
    shippedAt: chinaDateText(r['Дата отгрузки'], 'Дата отгрузки'),
    arrivedAt: chinaDateText(r['Дата прибытия'], 'Дата прибытия'),
    status: String(r['Статус'] || '').trim() || CHINA_STATUSES[0],
    goodsCny: parseNumber(r['Товар ¥']),
    chinaDeliveryCny: parseNumber(r['Доставка по Китаю ¥']),
    weightKg: parseNumber(r['Вес накладной, кг']),
    volumeM3: parseNumber(r['Объём, м³']),
    ratePerKgUsd: parseNumber(r['Ставка $/кг']),
    packingUsd: parseNumber(r['Упаковка $']),
    otherCargoUsd: parseNumber(r['Прочее карго $']),
    freightUsd: parseNumber(r['Перевозка $']),
    cargoRate: parseNumber(r['Курс ¥/$']),
    freightCny: parseNumber(r['Перевозка ¥']),
    rubCosts: parseNumber(r['Расходы РФ ₽']),
    rubRate: parseNumber(r['Курс ₽/¥']),
    manualRate: chinaManualRateOf(r),
    rubRateSource: String(r['Источник курса'] || '').trim(),
    paidCny: parseNumber(r['Оплачено по отчёту ¥']),
    unpaidCny: parseNumber(r['Долг по отчёту ¥']),
    totalRub: parseNumber(r['Себестоимость партии ₽']),
    weightFactor: r['Коэффициент веса'] === '' ? null : parseNumber(r['Коэффициент веса']),
    comment: String(r['Комментарий'] || '').trim(),
    user: String(r['Кто'] || '').trim(),
    updatedAt: String(r['Обновлено'] || '').trim()
  };
}

/**
 * The ₽/¥ rate the owner typed himself. It is kept apart from «Курс ₽/¥», the rate the batch
 * was actually costed at: once payments of the order set that one, the typed rate must still
 * be there to come back to when the payments go (review of 2026-09-24 — it used to be lost,
 * and the rate of a deleted payment stayed on the batch labelled «вручную»).
 * A row written before this column existed only ever held a typed rate, unless its rate came
 * from payments.
 */
function chinaManualRateOf(r) {
  const cell = r['Курс вручную'];
  if (cell !== undefined && cell !== null && String(cell).trim() !== '') return parseNumber(cell);
  if (String(r['Источник курса'] || '').trim() === 'оплаты') return 0;
  return parseNumber(r['Курс ₽/¥']);
}

function chinaLineFromRow(r) {
  return {
    id: String(r['ID'] || '').trim(),
    batchId: String(r['ПартияID'] || '').trim(),
    marking: String(r['Маркировка'] || '').trim(),
    name: String(r['Название'] || '').trim(),
    boxes: parseNumber(r['Коробок']),
    pcsPerBox: parseNumber(r['Шт/коробку']),
    qty: parseNumber(r['Количество']),
    priceCny: parseNumber(r['Цена ¥']),
    sumCny: parseNumber(r['Сумма ¥']),
    pallet: String(r['Паллета'] || '').trim(),
    palletWeightKg: parseNumber(r['Вес паллеты, кг']),
    boxWeightKg: parseNumber(r['Вес коробки, кг']),
    weightKg: parseNumber(r['Вес расчётный, кг']),
    weightSource: String(r['Источник веса'] || '').trim(),
    chinaShareCny: parseNumber(r['Доставка Китай ¥']),
    freightShareCny: parseNumber(r['Перевозка ¥']),
    rubShare: parseNumber(r['Расходы РФ ₽']),
    costRub: parseNumber(r['Себестоимость ₽']),
    unitRub: parseNumber(r['Себестоимость ₽/шт']),
    article: String(r['Наш артикул'] || '').trim(),
    group: String(r['Один товар'] || '').trim()
  };
}

function chinaCostFromRow(r) {
  return {
    id: String(r['ID'] || '').trim(),
    batchId: String(r['ПартияID'] || '').trim(),
    date: chinaDateText(r['Дата'], 'Дата'),
    kind: String(r['Тип'] || '').trim(),
    amountRub: parseNumber(r['Сумма ₽']),
    comment: String(r['Комментарий'] || '').trim(),
    user: String(r['Кто'] || '').trim()
  };
}

function chinaPaymentFromRow(r) {
  return {
    id: String(r['ID'] || '').trim(),
    date: chinaDateText(r['Дата'], 'Дата'),
    amountRub: parseNumber(r['Сумма ₽']),
    rate: parseNumber(r['Курс ₽/¥']),
    amountCny: parseNumber(r['Куплено ¥']),
    purpose: String(r['Назначение'] || '').trim(),
    orderNo: String(r['Номер заказа'] || '').trim(),
    confirmed: String(r['Подтверждено'] || '').trim() !== '',
    comment: String(r['Комментарий'] || '').trim(),
    user: String(r['Кто'] || '').trim()
  };
}

/**
 * The ₽/¥ rate of an order: all the rubles put against it, divided by all the yuan they
 * bought. Two tranches at two rates give the weighted average by construction, which is what
 * a 30 % deposit plus the balance actually costs.
 */
function chinaRateFromPayments(payments, orderNo) {
  const wanted = String(orderNo || '').trim();
  if (!wanted) return 0;
  let rub = 0, cny = 0;
  (payments || []).forEach(function (p) {
    if (String(p.orderNo || '').trim() !== wanted) return;
    rub += Number(p.amountRub) || 0;
    cny += Number(p.amountCny) || 0;
  });
  if (rub <= 0 || cny <= 0) return 0;
  return Math.round((rub / cny) * 10000) / 10000;
}

/**
 * Two of the three figures of a payment are enough: the owner either states the rate in his
 * message, or the report of the Chinese side confirms the yuan that arrived. Given both, they
 * have to agree — a half-percent apart is a typo, and a typo in a rate is a wrong cost on
 * every piece of the batch.
 */
function chinaPaymentMoney(amountRub, rate, amountCny) {
  const rub = roundToTwo(Number(amountRub) || 0);
  let rateValue = Number(rate) || 0;
  let cny = roundToTwo(Number(amountCny) || 0);
  if (rub <= 0) throw new Error('Сумма оплаты в рублях должна быть больше нуля');
  if (rateValue <= 0 && cny <= 0) {
    throw new Error('Укажите курс ₽/¥ или сумму в юанях, которую подтвердили китайцы');
  }
  if (rateValue > 0 && cny > 0) {
    const implied = rub / cny;
    if (Math.abs(implied - rateValue) / rateValue > 0.005) {
      throw new Error('Курс и сумма в юанях не сходятся: ' + rub + ' ₽ за ' + cny +
        ' ¥ — это ' + (Math.round(implied * 10000) / 10000) + ' ₽/¥, а указан ' + rateValue);
    }
  }
  if (rateValue > 0 && cny <= 0) cny = roundToTwo(rub / rateValue);
  if (cny > 0 && rateValue <= 0) rateValue = Math.round((rub / cny) * 10000) / 10000;
  return { amountRub: rub, rate: rateValue, amountCny: cny };
}

function getChinaBatches() {
  const ss = chinaSpreadsheet();
  const batches = chinaReadSheet(ss, CHINA_BATCHES_SHEET, CHINA_BATCH_HEADERS).rows.map(chinaBatchFromRow);
  const lines = chinaReadSheet(ss, CHINA_LINES_SHEET, CHINA_LINE_HEADERS).rows.map(chinaLineFromRow);
  const costs = chinaReadSheet(ss, CHINA_COSTS_SHEET, CHINA_COST_HEADERS).rows.map(chinaCostFromRow);
  const payments = chinaReadSheet(ss, CHINA_PAYMENTS_SHEET, CHINA_PAYMENT_HEADERS).rows.map(chinaPaymentFromRow);
  const byId = {};
  batches.forEach(function (b) {
    b.lines = [];
    b.costs = [];
    b.payments = payments.filter(function (p) { return p.orderNo && p.orderNo === b.orderNo; });
    byId[b.id] = b;
  });
  lines.forEach(function (l) { if (byId[l.batchId]) byId[l.batchId].lines.push(l); });
  costs.forEach(function (c) { if (byId[c.batchId]) byId[c.batchId].costs.push(c); });
  return { batches: batches, payments: payments, settings: getChinaSettings() };
}

// ---------------------------------------------------------------- costing (no sheets here)

// Splits an amount over bases so the shares add up to the amount EXACTLY. Every share is
// rounded to the kopeck and the remainder goes to the largest base — a line with a zero
// base gets nothing, whatever the rounding did.
function chinaAllocate(total, bases) {
  const amount = roundToTwo(Number(total) || 0);
  const out = [];
  let sum = 0, best = -1, bestBase = 0;
  for (let i = 0; i < bases.length; i++) {
    const b = Number(bases[i]) || 0;
    out.push(0);
    if (b > 0) sum += b;
    if (b > bestBase) { bestBase = b; best = i; }
  }
  if (amount === 0 || sum <= 0 || best === -1) return out;
  let given = 0;
  for (let i = 0; i < bases.length; i++) {
    const b = Number(bases[i]) || 0;
    if (b <= 0 || i === best) continue;
    out[i] = roundToTwo(amount * b / sum);
    given = roundToTwo(given + out[i]);
  }
  out[best] = roundToTwo(amount - given);
  return out;
}

// What makes two lines THE SAME GOODS (owner, 2026-09-22). Each of three things says so on
// its own, and they chain:
//
//   the marking    the carrier's, and within one batch it names one product (owner);
//   «Наш артикул» one article of ours is one product, whatever marking it came under;
//   «Один товар»  the owner's own marker, for the same box in two colours that carries two
//                  different articles of ours.
//
// Two lines sharing ANY of the three are one product, and so is everything they are tied to
// in turn. Review of 2026-09-24: the key used to be the first filled of the three, so an
// article written against one of two NV-99 lines split one product into two groups and gave
// it two costs, 489,19 and 565,78 ₽ a piece.
function chinaGroupIds(lines) {
  const parent = lines.map(function (_, i) { return i; });
  const find = function (i) {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
    return i;
  };
  const join = function (a, b) {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };
  const seen = {};
  lines.forEach(function (line, i) {
    const l = line || {};
    [['M', l.marking], ['A', l.article], ['G', l.group]].forEach(function (pair) {
      const value = String(pair[1] || '').trim().toLowerCase();
      if (!value) return;
      const key = pair[0] + ':' + value;
      if (seen[key] === undefined) seen[key] = i; else join(i, seen[key]);
    });
  });
  return lines.map(function (_, i) { return 'g' + find(i); });
}

// Weight of every line, in kilograms, and where each number came from. Kilograms per box are
// derived per GROUP, not per line: lines of one product weigh the same per box, whichever
// pallet they were packed into and whichever marking the carrier gave them.
function chinaLineWeights(lines, invoiceWeight) {
  const boxes = lines.map(function (l) { return Number(l.boxes) || 0; });
  const marks = chinaGroupIds(lines);

  // Kilograms per box, from the pallets where a marking was actually weighed.
  const byMark = {};
  let palletKg = 0, palletBoxes = 0;
  lines.forEach(function (l, i) {
    const w = Number(l.palletWeightKg) || 0;
    if (w <= 0 || boxes[i] <= 0) return;
    if (!byMark[marks[i]]) byMark[marks[i]] = { kg: 0, boxes: 0 };
    byMark[marks[i]].kg += w;
    byMark[marks[i]].boxes += boxes[i];
    palletKg += w;
    palletBoxes += boxes[i];
  });
  const avgPerBox = palletBoxes > 0 ? palletKg / palletBoxes : 0;

  const sources = [];
  const est = lines.map(function (l, i) {
    const manual = Number(l.boxWeightKg) || 0;
    if (manual > 0 && boxes[i] > 0) { sources.push('вручную'); return manual * boxes[i]; }
    const m = byMark[marks[i]];
    if (m && m.boxes > 0) { sources.push('паллета'); return (m.kg / m.boxes) * boxes[i]; }
    if (avgPerBox > 0) { sources.push('среднее по партии'); return avgPerBox * boxes[i]; }
    sources.push('нет веса');
    return 0;
  });

  let sum = 0;
  est.forEach(function (e) { sum += e; });

  // Not a single weight in the batch: boxes are the only base left, and pieces after them.
  // Without this the freight would be split over zeros and vanish from the cost.
  if (sum <= 0) {
    const anyBox = boxes.some(function (b) { return b > 0; });
    const fallback = anyBox ? boxes.slice() : lines.map(function (l) { return Number(l.qty) || 0; });
    return {
      weights: fallback,
      factor: null,
      sources: lines.map(function () { return anyBox ? 'коробки' : 'штуки'; })
    };
  }

  const invoice = Number(invoiceWeight) || 0;
  if (invoice <= 0) return { weights: est, factor: null, sources: sources };

  const factor = invoice / sum;
  return { weights: est.map(function (e) { return e * factor; }), factor: factor, sources: sources };
}

// Boxes are the base for the Russian-side costs; pieces stand in when a batch was entered
// without boxes at all.
function chinaBoxBases(lines) {
  const boxes = lines.map(function (l) { return Number(l.boxes) || 0; });
  if (boxes.some(function (b) { return b > 0; })) return boxes;
  return lines.map(function (l) { return Number(l.qty) || 0; });
}

// One product, one cost per piece (owner, 2026-09-22). The weights of a group are already
// equal per box, so the lines of a group usually come out equal on their own; they can still
// differ when the same goods were bought at two prices, or after a kopeck of rounding. The
// group's money is kept whole: the levelled cost is spread back by pieces and the remainder
// goes to the largest line, so the total of the batch does not move.
function chinaLevelGroups(lines, computed) {
  const groups = {};
  const ids = chinaGroupIds(lines);
  lines.forEach(function (l, i) {
    const key = ids[i];
    if (!groups[key]) groups[key] = [];
    groups[key].push(i);
  });

  Object.keys(groups).forEach(function (key) {
    const idx = groups[key];
    let total = 0, qty = 0, best = idx[0], bestQty = 0;
    idx.forEach(function (i) {
      total = roundToTwo(total + computed[i].costRub);
      const q = Number(lines[i].qty) || 0;
      qty += q;
      if (q > bestQty) { bestQty = q; best = i; }
    });
    if (qty <= 0) return;
    const unit = roundToTwo(total / qty);
    let given = 0;
    idx.forEach(function (i) {
      computed[i].unitRub = unit;
      if (i === best) return;
      computed[i].costRub = roundToTwo(unit * (Number(lines[i].qty) || 0));
      given = roundToTwo(given + computed[i].costRub);
    });
    computed[best].costRub = roundToTwo(total - given);
  });
}

// The whole calculation of a batch. Takes plain objects, touches no sheet, and is the only
// place where money is worked out.
function chinaBatchCost(batch, lines, rubCostsTotal, settings) {
  const b = batch || {};
  const list = lines || [];
  const cargoRate = Number(b.cargoRate) > 0
    ? Number(b.cargoRate)
    : Number((settings || {}).cargoRateCnyPerUsd) || 0;

  const goods = list.map(function (l) {
    return roundToTwo((Number(l.qty) || 0) * (Number(l.priceCny) || 0));
  });
  let goodsCny = 0;
  goods.forEach(function (g) { goodsCny = roundToTwo(goodsCny + g); });

  // The waybill's own total wins when it is there; otherwise it is rebuilt from the rate.
  const computedUsd = roundToTwo((Number(b.weightKg) || 0) * (Number(b.ratePerKgUsd) || 0)
    + (Number(b.packingUsd) || 0) + (Number(b.otherCargoUsd) || 0));
  const freightUsd = Number(b.freightUsd) > 0 ? roundToTwo(Number(b.freightUsd)) : computedUsd;
  const freightCny = roundToTwo(freightUsd * cargoRate);
  const chinaCny = roundToTwo(Number(b.chinaDeliveryCny) || 0);
  const rubCosts = roundToTwo(Number(rubCostsTotal) || 0);
  const rubRate = Number(b.rubRate) || 0;

  const w = chinaLineWeights(list, b.weightKg);
  const freightShares = chinaAllocate(freightCny, w.weights);
  const chinaShares = chinaAllocate(chinaCny, w.weights);
  const rubShares = chinaAllocate(rubCosts, chinaBoxBases(list));

  const out = list.map(function (l, i) {
    const cny = roundToTwo(goods[i] + freightShares[i] + chinaShares[i]);
    const costRub = roundToTwo(roundToTwo(cny * rubRate) + rubShares[i]);
    const qty = Number(l.qty) || 0;
    return {
      sumCny: goods[i],
      weightKg: roundToTwo(w.weights[i]),
      weightSource: w.sources[i],
      chinaShareCny: chinaShares[i],
      freightShareCny: freightShares[i],
      rubShare: rubShares[i],
      costCny: cny,
      costRub: costRub,
      unitRub: qty > 0 ? roundToTwo(costRub / qty) : 0
    };
  });

  chinaLevelGroups(list, out);

  let totalRub = 0;
  out.forEach(function (l) { totalRub = roundToTwo(totalRub + l.costRub); });

  return {
    lines: out,
    goodsCny: goodsCny,
    chinaDeliveryCny: chinaCny,
    freightUsd: freightUsd,
    cargoRate: cargoRate,
    freightCny: freightCny,
    rubCosts: rubCosts,
    rubRate: rubRate,
    totalRub: totalRub,
    weightFactor: w.factor === null ? null : Math.round(w.factor * 10000) / 10000
  };
}

// ---------------------------------------------------------------- writing

function chinaNextId(rows, prefix) {
  let max = 0;
  rows.forEach(function (r) {
    const id = String(r['ID'] || '').trim();
    if (id.indexOf(prefix) !== 0) return;
    const n = parseInt(id.slice(prefix.length), 10);
    if (!isNaN(n) && n > max) max = n;
  });
  return prefix + (max + 1);
}

function chinaStamp() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'GMT', 'yyyy-MM-dd HH:mm:ss');
}

// Rewrites a sheet from its header row down. Used for the lines of a batch: an edit changes
// how many lines there are, and rewriting is simpler than patching rows. The new table goes
// OVER the old one first and only the rows left below it are cleared after: cleared first, a
// failure between the two steps would have wiped the lines of every batch in the module.
function chinaWriteSheet(sheet, headers, rows) {
  const table = [headers.slice()].concat(rows);
  const before = sheet.getLastRow();
  sheet.getRange(1, 1, table.length, headers.length).setValues(table);
  if (before > table.length) {
    sheet.getRange(table.length + 1, 1, before - table.length, headers.length).clearContent();
  }
}

function chinaRowFrom(headers, values) {
  return headers.map(function (h) {
    return Object.prototype.hasOwnProperty.call(values, h) ? values[h] : '';
  });
}

function saveChinaBatch(data, username) {
  if (!data || typeof data !== 'object') throw new Error('Некорректные данные партии');
  const code = String(data.code || '').trim();
  if (!code) throw new Error('Не указан код партии');
  const status = String(data.status || '').trim() || CHINA_STATUSES[0];
  if (CHINA_STATUSES.indexOf(status) === -1) {
    throw new Error('Неизвестный статус партии: ' + status);
  }
  const incoming = Array.isArray(data.lines) ? data.lines : [];
  if (incoming.length === 0) throw new Error('В партии нет ни одной строки товара');
  incoming.forEach(function (l, i) {
    if (!String(l.marking || '').trim()) throw new Error('В строке ' + (i + 1) + ' не указана маркировка');
    if (!(Number(l.qty) > 0)) throw new Error('В строке ' + (i + 1) + ' количество должно быть больше нуля');
  });

  const ss = chinaSpreadsheet();
  const batchCtx = chinaReadSheet(ss, CHINA_BATCHES_SHEET, CHINA_BATCH_HEADERS);
  const requested = String(data.id || '').trim();
  let target = null;
  batchCtx.rows.forEach(function (r) { if (String(r['ID']).trim() === requested) target = r; });
  if (requested && !target) throw new Error('Партия ' + requested + ' не найдена');
  const batchId = target ? requested : chinaNextId(batchCtx.rows, 'CB');

  const batch = {
    id: batchId,
    orderNo: String(data.orderNo || '').trim(),
    code: code,
    shippedAt: chinaDateText(data.shippedAt, 'Дата отгрузки'),
    arrivedAt: chinaDateText(data.arrivedAt, 'Дата прибытия'),
    status: status,
    chinaDeliveryCny: parseNumber(data.chinaDeliveryCny),
    weightKg: parseNumber(data.weightKg),
    volumeM3: parseNumber(data.volumeM3),
    ratePerKgUsd: parseNumber(data.ratePerKgUsd),
    packingUsd: parseNumber(data.packingUsd),
    otherCargoUsd: parseNumber(data.otherCargoUsd),
    freightUsd: parseNumber(data.freightUsd),
    cargoRate: parseNumber(data.cargoRate),
    rubRate: parseNumber(data.rubRate),
    manualRate: parseNumber(data.rubRate),
    paidCny: parseNumber(data.paidCny),
    unpaidCny: parseNumber(data.unpaidCny),
    comment: String(data.comment || '').trim()
  };

  const lines = incoming.map(function (l) {
    return {
      marking: String(l.marking || '').trim(),
      name: String(l.name || '').trim(),
      boxes: parseNumber(l.boxes),
      pcsPerBox: parseNumber(l.pcsPerBox),
      qty: parseNumber(l.qty),
      priceCny: parseNumber(l.priceCny),
      pallet: String(l.pallet || '').trim(),
      palletWeightKg: parseNumber(l.palletWeightKg),
      boxWeightKg: parseNumber(l.boxWeightKg),
      article: String(l.article || '').trim(),
      group: String(l.group || '').trim()
    };
  });

  const costs = chinaReadSheet(ss, CHINA_COSTS_SHEET, CHINA_COST_HEADERS).rows
    .map(chinaCostFromRow).filter(function (c) { return c.batchId === batchId; });
  let rubTotal = 0;
  costs.forEach(function (c) { rubTotal = roundToTwo(rubTotal + c.amountRub); });

  const rated = chinaWithPaymentRate(ss, batch);
  const calc = chinaBatchCost(rated, lines, rubTotal, getChinaSettings());
  writeChinaBatch(ss, batchCtx, rated, lines, calc, username);
  return getChinaBatches();
}

/**
 * The rate a batch is costed at. Payments put against its order decide it; the rate typed by
 * hand is what is left when there are none, and the sheet says which of the two it was.
 */
function chinaWithPaymentRate(ss, batch) {
  const payments = chinaReadSheet(ss, CHINA_PAYMENTS_SHEET, CHINA_PAYMENT_HEADERS).rows.map(chinaPaymentFromRow);
  const fromPayments = chinaRateFromPayments(payments, batch.orderNo);
  const out = {};
  Object.keys(batch).forEach(function (k) { out[k] = batch[k]; });
  out.rubRate = fromPayments > 0 ? fromPayments : (Number(batch.manualRate) || 0);
  out.rubRateSource = fromPayments > 0 ? 'оплаты' : (out.rubRate > 0 ? 'вручную' : '');
  return out;
}

function writeChinaBatch(ss, batchCtx, batch, lines, calc, username) {
  const row = chinaRowFrom(batchCtx.headers, {
    'ID': batch.id,
    'Номер заказа': batch.orderNo,
    'Код партии': batch.code,
    'Дата отгрузки': batch.shippedAt,
    'Дата прибытия': batch.arrivedAt,
    'Статус': batch.status,
    'Товар ¥': calc.goodsCny,
    'Доставка по Китаю ¥': calc.chinaDeliveryCny,
    'Вес накладной, кг': batch.weightKg,
    'Объём, м³': batch.volumeM3,
    'Ставка $/кг': batch.ratePerKgUsd,
    'Упаковка $': batch.packingUsd,
    'Прочее карго $': batch.otherCargoUsd,
    'Перевозка $': calc.freightUsd,
    'Курс ¥/$': calc.cargoRate,
    'Перевозка ¥': calc.freightCny,
    'Расходы РФ ₽': calc.rubCosts,
    'Курс ₽/¥': calc.rubRate,
    'Курс вручную': batch.manualRate || '',
    'Источник курса': batch.rubRateSource || '',
    'Оплачено по отчёту ¥': batch.paidCny || '',
    'Долг по отчёту ¥': batch.unpaidCny || '',
    'Себестоимость партии ₽': calc.totalRub,
    'Коэффициент веса': calc.weightFactor === null ? '' : calc.weightFactor,
    'Комментарий': batch.comment,
    'Кто': username || '',
    'Обновлено': chinaStamp()
  });

  let targetRow = 0;
  batchCtx.rows.forEach(function (r) { if (String(r['ID']).trim() === batch.id) targetRow = r.__row; });
  if (targetRow > 0) {
    batchCtx.sheet.getRange(targetRow, 1, 1, batchCtx.headers.length).setValues([row]);
  } else {
    batchCtx.sheet.appendRow(row);
  }

  const lineCtx = chinaReadSheet(ss, CHINA_LINES_SHEET, CHINA_LINE_HEADERS);
  const kept = lineCtx.rows
    .filter(function (r) { return String(r['ПартияID']).trim() !== batch.id; })
    .map(function (r) { return chinaRowFrom(lineCtx.headers, r); });

  const fresh = lines.map(function (l, i) {
    const c = calc.lines[i];
    return chinaRowFrom(lineCtx.headers, {
      'ID': batch.id + '-' + (i + 1),
      'ПартияID': batch.id,
      'Маркировка': l.marking,
      'Название': l.name,
      'Коробок': l.boxes,
      'Шт/коробку': l.pcsPerBox,
      'Количество': l.qty,
      'Цена ¥': l.priceCny,
      'Сумма ¥': c.sumCny,
      'Паллета': l.pallet,
      'Вес паллеты, кг': l.palletWeightKg,
      'Вес коробки, кг': l.boxWeightKg,
      'Вес расчётный, кг': c.weightKg,
      'Источник веса': c.weightSource,
      'Доставка Китай ¥': c.chinaShareCny,
      'Перевозка ¥': c.freightShareCny,
      'Расходы РФ ₽': c.rubShare,
      'Себестоимость ₽': c.costRub,
      'Себестоимость ₽/шт': c.unitRub,
      'Наш артикул': l.article,
      'Один товар': l.group
    });
  });

  chinaWriteSheet(lineCtx.sheet, lineCtx.headers, kept.concat(fresh));
}

// Recomputes a batch that is already in the sheet. Called after a Russian-side cost is added
// or removed: the money of the batch must never be left stale.
function recalcChinaBatch(ss, batchId, username) {
  const batchCtx = chinaReadSheet(ss, CHINA_BATCHES_SHEET, CHINA_BATCH_HEADERS);
  let target = null;
  batchCtx.rows.forEach(function (r) { if (String(r['ID']).trim() === batchId) target = r; });
  if (!target) throw new Error('Партия ' + batchId + ' не найдена');

  const batch = chinaBatchFromRow(target);
  const lines = chinaReadSheet(ss, CHINA_LINES_SHEET, CHINA_LINE_HEADERS).rows
    .map(chinaLineFromRow).filter(function (l) { return l.batchId === batchId; });
  const costs = chinaReadSheet(ss, CHINA_COSTS_SHEET, CHINA_COST_HEADERS).rows
    .map(chinaCostFromRow).filter(function (c) { return c.batchId === batchId; });
  let rubTotal = 0;
  costs.forEach(function (c) { rubTotal = roundToTwo(rubTotal + c.amountRub); });

  const rated = chinaWithPaymentRate(ss, batch);
  const calc = chinaBatchCost(rated, lines, rubTotal, getChinaSettings());
  writeChinaBatch(ss, batchCtx, rated, lines, calc, username || batch.user);
  return calc;
}

function deleteChinaBatch(data, username) {
  const id = String((data || {}).id || '').trim();
  if (!id) throw new Error('Не указана партия для удаления');
  const ss = chinaSpreadsheet();

  const batchCtx = chinaReadSheet(ss, CHINA_BATCHES_SHEET, CHINA_BATCH_HEADERS);
  let targetRow = 0;
  batchCtx.rows.forEach(function (r) { if (String(r['ID']).trim() === id) targetRow = r.__row; });
  if (!targetRow) throw new Error('Партия ' + id + ' не найдена');
  batchCtx.sheet.deleteRow(targetRow);

  const lineCtx = chinaReadSheet(ss, CHINA_LINES_SHEET, CHINA_LINE_HEADERS);
  const keptLines = lineCtx.rows
    .filter(function (r) { return String(r['ПартияID']).trim() !== id; })
    .map(function (r) { return chinaRowFrom(lineCtx.headers, r); });
  chinaWriteSheet(lineCtx.sheet, lineCtx.headers, keptLines);

  const costCtx = chinaReadSheet(ss, CHINA_COSTS_SHEET, CHINA_COST_HEADERS);
  const keptCosts = costCtx.rows
    .filter(function (r) { return String(r['ПартияID']).trim() !== id; })
    .map(function (r) { return chinaRowFrom(costCtx.headers, r); });
  chinaWriteSheet(costCtx.sheet, costCtx.headers, keptCosts);

  Logger.log('Заказы в Китае: партия ' + id + ' удалена пользователем ' + (username || '—'));
  return getChinaBatches();
}

function saveChinaBatchCost(data, username) {
  if (!data || typeof data !== 'object') throw new Error('Некорректные данные расхода');
  const batchId = String(data.batchId || '').trim();
  if (!batchId) throw new Error('Не указана партия расхода');
  const kind = String(data.kind || '').trim();
  if (CHINA_COST_TYPES.indexOf(kind) === -1) {
    throw new Error('Неизвестный тип расхода: ' + kind);
  }
  const amount = roundToTwo(parseNumber(data.amountRub));
  if (!(amount > 0)) throw new Error('Сумма расхода должна быть больше нуля');

  const ss = chinaSpreadsheet();
  // The batch is checked BEFORE anything is written: a cost of a batch that is not there
  // used to be appended first and refused after, leaving an orphan row in the sheet.
  const known = chinaReadSheet(ss, CHINA_BATCHES_SHEET, CHINA_BATCH_HEADERS).rows
    .some(function (r) { return String(r['ID']).trim() === batchId; });
  if (!known) throw new Error('Партия ' + batchId + ' не найдена');

  const ctx = chinaReadSheet(ss, CHINA_COSTS_SHEET, CHINA_COST_HEADERS);
  const requested = String(data.id || '').trim();
  let targetRow = 0;
  ctx.rows.forEach(function (r) { if (String(r['ID']).trim() === requested) targetRow = r.__row; });
  if (requested && !targetRow) throw new Error('Расход ' + requested + ' не найден');

  const row = chinaRowFrom(ctx.headers, {
    'ID': requested || chinaNextId(ctx.rows, 'CC'),
    'ПартияID': batchId,
    'Дата': chinaDateText(data.date, 'Дата') || getTodayDateString(),
    'Тип': kind,
    'Сумма ₽': amount,
    'Комментарий': String(data.comment || '').trim(),
    'Кто': username || ''
  });
  if (targetRow > 0) {
    ctx.sheet.getRange(targetRow, 1, 1, ctx.headers.length).setValues([row]);
  } else {
    ctx.sheet.appendRow(row);
  }

  recalcChinaBatch(ss, batchId, username);
  return getChinaBatches();
}

function saveChinaPayment(data, username) {
  if (!data || typeof data !== 'object') throw new Error('Некорректные данные оплаты');
  const purpose = String(data.purpose || '').trim() || CHINA_PAYMENT_PURPOSES[0];
  if (CHINA_PAYMENT_PURPOSES.indexOf(purpose) === -1) {
    throw new Error('Неизвестное назначение оплаты: ' + purpose);
  }
  const money = chinaPaymentMoney(parseNumber(data.amountRub), parseNumber(data.rate), parseNumber(data.amountCny));
  const orderNo = String(data.orderNo || '').trim();

  const ss = chinaSpreadsheet();
  const ctx = chinaReadSheet(ss, CHINA_PAYMENTS_SHEET, CHINA_PAYMENT_HEADERS);
  const requested = String(data.id || '').trim();
  let targetRow = 0, previousOrder = '';
  ctx.rows.forEach(function (r) {
    if (String(r['ID']).trim() === requested) {
      targetRow = r.__row;
      previousOrder = String(r['Номер заказа'] || '').trim();
    }
  });
  if (requested && !targetRow) throw new Error('Оплата ' + requested + ' не найдена');

  const row = chinaRowFrom(ctx.headers, {
    'ID': requested || chinaNextId(ctx.rows, 'CP'),
    'Дата': chinaDateText(data.date, 'Дата') || getTodayDateString(),
    'Сумма ₽': money.amountRub,
    'Курс ₽/¥': money.rate,
    'Куплено ¥': money.amountCny,
    'Назначение': purpose,
    'Номер заказа': orderNo,
    'Подтверждено': data.confirmed ? 'да' : '',
    'Комментарий': String(data.comment || '').trim(),
    'Кто': username || ''
  });
  if (targetRow > 0) {
    ctx.sheet.getRange(targetRow, 1, 1, ctx.headers.length).setValues([row]);
  } else {
    ctx.sheet.appendRow(row);
  }

  // An edit can move a payment from one order to another, and BOTH change their rate.
  recalcChinaOrders(ss, [orderNo, previousOrder], username);
  return getChinaBatches();
}

function deleteChinaPayment(data, username) {
  const id = String((data || {}).id || '').trim();
  if (!id) throw new Error('Не указана оплата для удаления');
  const ss = chinaSpreadsheet();
  const ctx = chinaReadSheet(ss, CHINA_PAYMENTS_SHEET, CHINA_PAYMENT_HEADERS);
  let targetRow = 0, orderNo = '';
  ctx.rows.forEach(function (r) {
    if (String(r['ID']).trim() === id) { targetRow = r.__row; orderNo = String(r['Номер заказа'] || '').trim(); }
  });
  if (!targetRow) throw new Error('Оплата ' + id + ' не найдена');
  ctx.sheet.deleteRow(targetRow);
  recalcChinaOrders(ss, [orderNo], username);
  return getChinaBatches();
}

/** Every batch of the given orders is costed again: their rate has just moved. */
function recalcChinaOrders(ss, orderNumbers, username) {
  const wanted = {};
  (orderNumbers || []).forEach(function (n) {
    const key = String(n || '').trim();
    if (key) wanted[key] = true;
  });
  if (Object.keys(wanted).length === 0) return;
  const batches = chinaReadSheet(ss, CHINA_BATCHES_SHEET, CHINA_BATCH_HEADERS).rows.map(chinaBatchFromRow);
  batches.forEach(function (b) {
    if (wanted[String(b.orderNo || '').trim()]) recalcChinaBatch(ss, b.id, username);
  });
}

function deleteChinaBatchCost(data, username) {
  const id = String((data || {}).id || '').trim();
  if (!id) throw new Error('Не указан расход для удаления');
  const ss = chinaSpreadsheet();
  const ctx = chinaReadSheet(ss, CHINA_COSTS_SHEET, CHINA_COST_HEADERS);
  let targetRow = 0, batchId = '';
  ctx.rows.forEach(function (r) {
    if (String(r['ID']).trim() === id) { targetRow = r.__row; batchId = String(r['ПартияID']).trim(); }
  });
  if (!targetRow) throw new Error('Расход ' + id + ' не найден');
  ctx.sheet.deleteRow(targetRow);
  if (batchId) recalcChinaBatch(ss, batchId, username);
  return getChinaBatches();
}
