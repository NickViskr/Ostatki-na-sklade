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
// Item 81e: the carrier's "arrival" file goes further and states, per marking, the dimensions
// and gross weight of ONE factory box — not an estimate but the box actually weighed. That
// weight outranks the pallet estimate (it stays below only the owner's own typed weight) and
// its volume and density are kept on the line. From the same box data the module also works
// out, per batch, how much of the carrier's weight/volume/money is the GOODS and how much is
// the carrier's own packaging (pallets, dunnage) — pure analytics that never move a line's cost.


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
// Item 81g-1: the Chinese financial report — a ledger of reports, the receipts it groups by
// date, and the per-report movement of every order's «получено», which is the only place the
// report ever states which order a transfer went to (it never says so directly — see the
// dossier). None of these three feed the batch cost yet: that is chinaAllocateGoodsLedger's
// job, wired into costing in 81g-3.
const CHINA_REPORTS_SHEET = 'Отчёты';
const CHINA_RECEIPTS_SHEET = 'Поступления';
const CHINA_MOVEMENTS_SHEET = 'Движения заказов';

const CHINA_BATCH_HEADERS = [
  'ID', 'Номер заказа', 'Код партии', 'Дата отгрузки', 'Дата прибытия', 'Статус',
  'Товар ¥', 'Доставка по Китаю ¥', 'Вес накладной, кг', 'Объём, м³',
  'Ставка $/кг', 'Упаковка $', 'Прочее карго $', 'Перевозка $', 'Курс ¥/$', 'Перевозка ¥',
  'Расходы РФ ₽', 'Курс ₽/¥', 'Курс вручную', 'Источник курса', 'Себестоимость партии ₽', 'Коэффициент веса',
  'Оплачено по отчёту ¥', 'Долг по отчёту ¥',
  'Комментарий', 'Кто', 'Обновлено',
  // Item 81e: the carrier's box data and the packaging analytics it gives.
  'Дата приёмки', 'Вес товара, кг', 'Объём товара, м³', 'Вес упаковки, кг', 'Объём упаковки, м³',
  'Плотность товара, кг/м³', 'Плотность в упаковке, кг/м³', 'Тариф за',
  'Упаковка всего $', 'Перевозка товара $', 'Упаковка ₽', 'Перевозка товара ₽',
  'Доля упаковки в перевозке, %', 'Доля упаковки в себестоимости, %', 'Доля перевозки товара в себестоимости, %',
  // Owner, 2026-09-24: ruble equivalents of the three currency figures, and where a borrowed
  // rate came from — see chinaWithPaymentRate / chinaBorrowedRate.
  'Товар ₽', 'Доставка по Китаю ₽', 'Перевозка ₽', 'Курс взят из партии',
  // Owner, 2026-09-25 (live check): which payment a «последняя оплата» rate came from — its
  // date and ID, e.g. «2026-08-20 CP3» — see chinaLatestPaymentRate / chinaWithPaymentRate.
  'Курс взят из оплаты',
  // Owner, 2026-09-24: what one kilogram of freight cost — see the tail of chinaBatchCost.
  'Перевозка за 1 кг $', 'Перевозка за 1 кг ₽', 'Перевозка за 1 кг считается от',
  // Owner, 2026-09-24: the carrier's OWN tariff (Ставка $/кг, from the waybill) converted to
  // rubles, next to the real per-kilogram cost above — the two are meant to be read side by
  // side, one is what the carrier bills, the other what the goods actually cost.
  'Тариф карго ₽',
  // Item 81g-1: schema for the two rates the report will split apart (goods vs freight) and
  // for what will close a batch. NOT wired into chinaBatchCost yet (81g-3) — read back plainly
  // by chinaBatchFromRow and otherwise left untouched by every save/recalc path in this file
  // (writeChinaBatch merges a save's fresh values over the batch's PREVIOUS row precisely so an
  // unrelated save — a Russian-side cost, a recost after a payment — cannot blank these out
  // before the stage that actually computes them exists).
  'Курс товара ₽/¥', 'Источник курса товара', 'Курс перевозки ₽/¥', 'Источник курса перевозки',
  'Расходы РФ внесены', 'Чего не хватает', 'Расчёт закрыт', 'История', 'Проверка', 'Проверка: детали'
];

const CHINA_LINE_HEADERS = [
  'ID', 'ПартияID', 'Маркировка', 'Название', 'Коробок', 'Шт/коробку', 'Количество',
  'Цена ¥', 'Сумма ¥', 'Паллета', 'Вес паллеты, кг', 'Вес коробки, кг',
  'Вес расчётный, кг', 'Источник веса',
  'Доставка Китай ¥', 'Перевозка ¥', 'Расходы РФ ₽',
  'Себестоимость ₽', 'Себестоимость ₽/шт', 'Наш артикул', 'Один товар',
  // Item 81e: one factory box from the carrier's arrival file, and what it works out to.
  'Длина коробки, м', 'Ширина коробки, м', 'Высота коробки, м', 'Вес коробки фабрики, кг',
  'Объём коробки, м³', 'Вес товара, кг', 'Плотность, кг/м³', 'Вес 1 шт, кг',
  // Owner, 2026-09-24: the ruble equivalent of each line's three currency components, worked
  // out BEFORE group levelling — see chinaBatchCost.
  'Товар ₽', 'Доставка Китай ₽', 'Перевозка ₽'
];

const CHINA_COST_HEADERS = ['ID', 'ПартияID', 'Дата', 'Тип', 'Сумма ₽', 'Комментарий', 'Кто'];

// Item 81d: what the owner paid, in rubles, and how many yuan it bought. The rate of a batch
// is worked out from the payments put against its ORDER — the owner states the rate in his
// message, or the report of the Chinese side confirms how many yuan arrived and the rate falls
// out of the pair.
const CHINA_PAYMENT_HEADERS = ['ID', 'Дата', 'Сумма ₽', 'Курс ₽/¥', 'Куплено ¥', 'Назначение',
  'Номер заказа', 'Подтверждено', 'Комментарий', 'Кто',
  // Item 81g-1: schema for the report-driven matching of 81g-2. orderNo/purpose above stop
  // being used for money once matching lands — kept only as the owner's own note of what he
  // meant the payment for. NOT written by saveChinaPayment yet; a save of an EXISTING payment
  // preserves whatever these hold via the same previous-row merge as the batch columns above.
  'Статус', 'ПоступлениеID', 'Юани по отчёту', 'Курс фактический'];

const CHINA_PAYMENT_PURPOSES = ['Товар', 'Перевозка'];

const CHINA_SETTINGS_HEADERS = ['Ключ', 'Значение', 'Описание'];

// Item 81g-1. One row per uploaded report; «Данные (JSON)» carries the WHOLE payload
// (orders/freights/carriedOverCny/openingFreightUsd) so a later report can diff against it and
// 81g-2/3 can walk the freight bills without a second sheet. Only the 3 newest rows are kept
// (chinaPruneReports) — receipts and movements, the actual ledger, are never pruned.
const CHINA_REPORT_HEADERS = ['ID', 'Загружен', 'Дата отчёта', 'Источник', 'Причина ИИ', 'Данные (JSON)', 'Кто'];

// One row per DATE the report groups goods/freight transfers by (already grouped by the
// browser — one payment is one date, owner's own rule). «Статус» starts 'история' (before
// tracking, 2026-08-01) or 'ждёт оплату'; 81g-2 turns the latter into 'сопоставлено' once a
// payment is matched, filling ОплатаID/₽ товар/₽ доставка. «Отчёт» is the id of the report that
// first introduced this date's receipt — chinaAllocateGoodsLedger uses exactly that to know
// when a receipt joins the pool, even after its report has since been pruned away.
const CHINA_RECEIPT_HEADERS = ['ID', 'Дата', 'Товар ¥', 'Доставка ¥', 'Доставка $', 'Курс ¥/$', 'Всего ¥',
  'Статус', 'ОплатаID', '₽ товар', '₽ доставка', 'Отчёт',
  // Owner, 2026-09-25: the owner's own «история» mark (setChinaReceiptHistory) — kept apart from
  // «Статус» so a later saveChinaReport upsert of the SAME date (which only ever touches the ¥
  // totals of an EXISTING row, never «Статус») cannot flip a manually marked receipt back, and so
  // unmarking it can refuse to touch a receipt whose «история» is the DATE's own, not the owner's.
  'История вручную'];

// Append-only: one row per order whose «получено» moved between two consecutive reports (the
// very first report's own movements are its orders' baseline, from 0). This sheet is what the
// OWNER reads to see an order's history; chinaAllocateGoodsLedger recomputes the same deltas
// itself from the reports it is given, so it never depends on this sheet either.
const CHINA_MOVEMENT_HEADERS = ['Отчёт', 'Дата отчёта', 'Номер заказа', 'Изменение ¥'];

// Everything before this date is «история без курса» (owner, 2026-09-24) — the 结转
// carry-over line included. Kept apart from CHINA_RECEIPT_HEADERS so 81g-2/3 share one
// definition of "before tracking" instead of repeating the literal.
const CHINA_TRACKING_START_DATE = '2026-08-01';

// The carry-over line (结转) is a receipt like any other — dated before every real receipt so
// it is always the first thing the FIFO baseline consumes — but it has no date of its own in
// the report, only a lump sum. This sentinel sorts before any date the module will ever see a
// real transfer on.
const CHINA_CARRYOVER_RECEIPT_DATE = '2020-01-01';

const CHINA_SETTINGS_DEFAULTS = [
  { key: 'cargoRateCnyPerUsd', value: 7, desc: 'Курс карго: сколько юаней за 1 доллар перевозки' },
  // Owner, 2026-09-25: how many days a batch is typically in transit, shipment to arrival — the
  // browser shows the estimated arrival date from it, the server does no date arithmetic at all.
  { key: 'transitDays', value: 30, desc: 'Дней в пути от отгрузки до прибытия, ориентировочно' }
];

const CHINA_STATUSES = ['Черновик', 'В пути', 'Прибыла'];

// Item 81g: a payment tied to a receipt of the report. The RECEIPT is then 'сопоставлено'; the
// payment says 'распределена', the word the screen filters on (the two used to share one word,
// and a matched payment dropped out of both lists of the payments card).
const CHINA_PAYMENT_ALLOCATED = 'распределена';

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
    { name: CHINA_SETTINGS_SHEET, headers: CHINA_SETTINGS_HEADERS },
    // Item 81g-1.
    { name: CHINA_REPORTS_SHEET, headers: CHINA_REPORT_HEADERS },
    { name: CHINA_RECEIPTS_SHEET, headers: CHINA_RECEIPT_HEADERS },
    { name: CHINA_MOVEMENTS_SHEET, headers: CHINA_MOVEMENT_HEADERS }
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
    updatedAt: String(r['Обновлено'] || '').trim(),
    // Item 81e: «Дата приёмки» is the only INPUT among the new batch columns; the rest is
    // chinaPackagingStats, rewritten on every save/recalc — read back here so a plain
    // getChinaBatches() (no recalc) still answers with the packaging analytics.
    receivedAt: chinaDateText(r['Дата приёмки'], 'Дата приёмки'),
    goodsKg: parseNumber(r['Вес товара, кг']),
    goodsVolumeM3: parseNumber(r['Объём товара, м³']),
    packagingKg: parseNumber(r['Вес упаковки, кг']),
    packagingM3: parseNumber(r['Объём упаковки, м³']),
    goodsDensity: parseNumber(r['Плотность товара, кг/м³']),
    packedDensity: parseNumber(r['Плотность в упаковке, кг/м³']),
    tariffBasis: String(r['Тариф за'] || '').trim(),
    packagingUsd: parseNumber(r['Упаковка всего $']),
    goodsFreightUsd: parseNumber(r['Перевозка товара $']),
    packagingRub: parseNumber(r['Упаковка ₽']),
    goodsFreightRub: parseNumber(r['Перевозка товара ₽']),
    packagingShareFreight: parseNumber(r['Доля упаковки в перевозке, %']),
    packagingShareCost: parseNumber(r['Доля упаковки в себестоимости, %']),
    goodsFreightShareCost: parseNumber(r['Доля перевозки товара в себестоимости, %']),
    // Owner, 2026-09-24: ruble equivalents of the batch's currency figures, and the code of the
    // batch a borrowed rate came from (chinaWithPaymentRate) — both read back plainly here.
    goodsRub: parseNumber(r['Товар ₽']),
    chinaDeliveryRub: parseNumber(r['Доставка по Китаю ₽']),
    freightRub: parseNumber(r['Перевозка ₽']),
    rubRateFrom: String(r['Курс взят из партии'] || '').trim(),
    // Owner, 2026-09-25: which payment a «последняя оплата» rate came from — see
    // chinaLatestPaymentRate.
    rateFromPayment: String(r['Курс взят из оплаты'] || '').trim(),
    // Owner, 2026-09-24: what one kilogram of freight cost — chinaBatchCost's own figure,
    // read back plainly here same as the rest of the derived batch columns.
    freightPerKgUsd: parseNumber(r['Перевозка за 1 кг $']),
    freightPerKgRub: parseNumber(r['Перевозка за 1 кг ₽']),
    freightPerKgBase: String(r['Перевозка за 1 кг считается от'] || '').trim(),
    // Owner, 2026-09-24: the carrier's own tariff (Ставка $/кг) in rubles — same read-back
    // pattern as everything else chinaBatchCost derives.
    tariffRub: parseNumber(r['Тариф карго ₽']),
    // Item 81g-1: schema only — passive read-back, nothing in this file computes these yet
    // (81g-3 wires them into chinaBatchCost). rubRate/rubRateSource above stay the goods
    // rate/source for backward compatibility, per the owner's decision.
    goodsRate: parseNumber(r['Курс товара ₽/¥']),
    goodsRateSource: String(r['Источник курса товара'] || '').trim(),
    freightRate: parseNumber(r['Курс перевозки ₽/¥']),
    freightRateSource: String(r['Источник курса перевозки'] || '').trim(),
    rubCostsDone: String(r['Расходы РФ внесены'] || '').trim() === 'да',
    missing: String(r['Чего не хватает'] || '').trim()
      ? String(r['Чего не хватает']).split(';').map(function (s) { return s.trim(); }).filter(Boolean)
      : [],
    closed: String(r['Расчёт закрыт'] || '').trim() === 'да',
    history: String(r['История'] || '').trim() === 'да',
    checkMark: String(r['Проверка'] || '').trim(),
    checkNote: String(r['Проверка: детали'] || '').trim()
  };
}

/**
 * The ₽/¥ rate the owner typed himself. It is kept apart from «Курс ₽/¥», the rate the batch
 * was actually costed at: once payments of the order set that one, the typed rate must still
 * be there to come back to when the payments go (review of 2026-09-24 — it used to be lost,
 * and the rate of a deleted payment stayed on the batch labelled «вручную»).
 * A row written before this column existed only ever held a typed rate, unless its rate came
 * from payments.
 * Owner, 2026-09-24: the same is true of a BORROWED rate ('предыдущая партия') — without this
 * a batch that lost its typed rate but still borrows one would read back as if it had been
 * typed by hand, at whatever it was borrowing at the time it was last saved.
 * Owner, 2026-09-25: and of the last-payment fallback ('последняя оплата') — same reasoning,
 * same bug otherwise: the rate written to «Курс ₽/¥» would read back as manually typed the
 * moment nothing else recomputed it.
 */
function chinaManualRateOf(r) {
  const cell = r['Курс вручную'];
  if (cell !== undefined && cell !== null && String(cell).trim() !== '') return parseNumber(cell);
  const source = String(r['Источник курса'] || '').trim();
  if (source === 'оплаты' || source === 'предыдущая партия' || source === 'последняя оплата') return 0;
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
    group: String(r['Один товар'] || '').trim(),
    // Item 81e: one factory box, from the arrival file — INPUT, saved as given.
    boxLengthM: parseNumber(r['Длина коробки, м']),
    boxWidthM: parseNumber(r['Ширина коробки, м']),
    boxHeightM: parseNumber(r['Высота коробки, м']),
    factoryBoxKg: parseNumber(r['Вес коробки фабрики, кг']),
    // The rest is chinaLineBoxStats, rewritten on every save/recalc — read back here so a
    // plain getChinaBatches() (no recalc) still answers with the box's own numbers.
    boxVolumeM3: parseNumber(r['Объём коробки, м³']),
    goodsKg: parseNumber(r['Вес товара, кг']),
    densityKgM3: parseNumber(r['Плотность, кг/м³']),
    kgPerPiece: parseNumber(r['Вес 1 шт, кг']),
    // Owner, 2026-09-24: ruble equivalents of this line's three currency components — see
    // chinaBatchCost. Read back plainly, same as the packaging analytics above.
    goodsRub: parseNumber(r['Товар ₽']),
    chinaShareRub: parseNumber(r['Доставка Китай ₽']),
    freightShareRub: parseNumber(r['Перевозка ₽'])
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
    user: String(r['Кто'] || '').trim(),
    // Item 81g-1: schema only — passive read-back, nothing in this file sets these yet
    // (81g-2 is the matching engine). saveChinaPayment preserves whatever they already hold.
    status: String(r['Статус'] || '').trim(),
    receiptId: String(r['ПоступлениеID'] || '').trim(),
    reportCny: parseNumber(r['Юани по отчёту']),
    actualRate: parseNumber(r['Курс фактический'])
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

/**
 * Owner, 2026-09-25: what is still owed on a batch's OWN supply, in a collapsed row — the goods
 * ¥ from the order's own line in the NEWEST report (a batch whose order the report does not even
 * mention has nothing outstanding there, by construction), the freight $ from the batch's OWN
 * bill (chinaAllocateFreightLedger's own `unpaidUsd`, the whole bill when no payment has touched
 * it at all), and their ₽ equivalents at the batch's OWN rates — a rate of 0 (no rate resolved
 * yet) drops that part of the ₽ figure to 0 rather than costing at a bogus rate.
 */
function chinaRemainingOf(ledger, batch) {
  const newestOrders = (ledger.newest && Array.isArray(ledger.newest.orders)) ? ledger.newest.orders : [];
  const orderNo = String(batch.orderNo || '').trim();
  let remainingGoodsCny = 0;
  newestOrders.forEach(function (o) {
    if (String((o || {}).orderNo || '').trim() === orderNo) remainingGoodsCny = roundToTwo(Number(o.unpaidCny) || 0);
  });

  const bill = chinaBillKnown(ledger, batch.code);
  const remainingFreightUsd = bill ? roundToTwo(Number(bill.unpaidUsd) || 0) : 0;

  const goodsRate = Number(batch.goodsRate) || 0;
  const freightRate = Number(batch.freightRate) || 0;
  const cargoRate = Number(batch.cargoRate) || 0;
  const remainingGoodsRub = goodsRate > 0 ? roundToTwo(remainingGoodsCny * goodsRate) : 0;
  const remainingFreightRub = (freightRate > 0 && cargoRate > 0)
    ? roundToTwo(remainingFreightUsd * cargoRate * freightRate) : 0;

  return {
    remainingGoodsCny: remainingGoodsCny,
    remainingFreightUsd: remainingFreightUsd,
    remainingRub: roundToTwo(remainingGoodsRub + remainingFreightRub)
  };
}

function getChinaBatches() {
  const ss = chinaSpreadsheet();
  const batches = chinaReadSheet(ss, CHINA_BATCHES_SHEET, CHINA_BATCH_HEADERS).rows.map(chinaBatchFromRow);
  const lines = chinaReadSheet(ss, CHINA_LINES_SHEET, CHINA_LINE_HEADERS).rows.map(chinaLineFromRow);
  const costs = chinaReadSheet(ss, CHINA_COSTS_SHEET, CHINA_COST_HEADERS).rows.map(chinaCostFromRow);
  const payments = chinaReadSheet(ss, CHINA_PAYMENTS_SHEET, CHINA_PAYMENT_HEADERS).rows.map(chinaPaymentFromRow);
  const ledger = chinaLedgerContext(ss);
  const byId = {};
  batches.forEach(function (b) {
    b.lines = [];
    b.costs = [];
    Object.assign(b, chinaRemainingOf(ledger, b));
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
    // Item 81e: the carrier's own arrival file weighed one factory box of this marking —
    // a real weight, so it outranks the pallet estimate below it.
    const factory = Number(l.factoryBoxKg) || 0;
    if (factory > 0 && boxes[i] > 0) { sources.push('приёмка'); return factory * boxes[i]; }
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

// One factory box of a line, from the carrier's arrival file: its volume, the weight of the
// goods it holds, its density and the weight of a single piece. Pure — no sheet, no other
// line, no freight — so it is the same whether the batch is being saved, recalculated or just
// displayed.
function chinaLineBoxStats(l) {
  const line = l || {};
  const length = Number(line.boxLengthM) || 0;
  const width = Number(line.boxWidthM) || 0;
  const height = Number(line.boxHeightM) || 0;
  const boxVolumeM3 = (length > 0 && width > 0 && height > 0)
    ? Math.round(length * width * height * 1e6) / 1e6 : 0;

  // Same priority as the freight weight: a weight the owner typed himself beats the one the
  // carrier's file states for the box.
  const typed = Number(line.boxWeightKg) || 0;
  const factory = Number(line.factoryBoxKg) || 0;
  const boxWeightUsed = typed > 0 ? typed : factory;

  const boxes = Number(line.boxes) || 0;
  const pcsPerBox = Number(line.pcsPerBox) || 0;
  const goodsKg = (boxWeightUsed > 0 && boxes > 0) ? roundToTwo(boxWeightUsed * boxes) : 0;
  const densityKgM3 = (boxWeightUsed > 0 && boxVolumeM3 > 0) ? roundToTwo(boxWeightUsed / boxVolumeM3) : 0;
  const kgPerPiece = (boxWeightUsed > 0 && pcsPerBox > 0) ? Math.round((boxWeightUsed / pcsPerBox) * 1000) / 1000 : 0;

  return { boxVolumeM3: boxVolumeM3, goodsKg: goodsKg, densityKgM3: densityKgM3, kgPerPiece: kgPerPiece };
}

/**
 * Item 81e: what the carrier's own packaging (pallets, dunnage) costs the batch — in weight,
 * volume, dollars, rubles and share of the total — worked out from the boxes weighed on
 * arrival against the waybill's own totals. NEVER changes a line's cost: it only explains a
 * cost that chinaBatchCost already put on the lines through the freight split (a).
 *
 * `lineStats` is the array chinaLineBoxStats returned for the same lines, in the same order.
 * `calc` carries the money chinaBatchCost has already worked out for the batch: freightUsd,
 * freightCny, cargoRate, rubRate and, once known, totalRub.
 */
function chinaPackagingStats(batch, lines, lineStats, calc) {
  const b = batch || {};
  const list = lines || [];
  const stats = lineStats || [];
  const weightKg = Number(b.weightKg) || 0;
  const volumeM3 = Number(b.volumeM3) || 0;

  let goodsKgSum = 0, everyKg = list.length > 0;
  let goodsVolSum = 0, everyVol = list.length > 0;
  list.forEach(function (l, i) {
    const s = stats[i] || {};
    const g = Number(s.goodsKg) || 0;
    if (g > 0) goodsKgSum += g; else everyKg = false;
    const boxes = Number(l.boxes) || 0;
    const bv = Number(s.boxVolumeM3) || 0;
    if (bv > 0) goodsVolSum += boxes * bv; else everyVol = false;
  });
  const goodsKg = everyKg ? roundToTwo(goodsKgSum) : 0;
  const goodsVolumeM3 = everyVol ? Math.round(goodsVolSum * 10000) / 10000 : 0;

  const packagingKg = (weightKg > 0 && goodsKg > 0) ? roundToTwo(weightKg - goodsKg) : 0;
  const packagingM3 = (volumeM3 > 0 && goodsVolumeM3 > 0) ? Math.round((volumeM3 - goodsVolumeM3) * 10000) / 10000 : 0;
  const goodsDensity = (goodsKg > 0 && goodsVolumeM3 > 0) ? roundToTwo(goodsKg / goodsVolumeM3) : 0;
  const packedDensity = (weightKg > 0 && volumeM3 > 0) ? roundToTwo(weightKg / volumeM3) : 0;

  // What the batch was actually billed for: weight or volume. Real case NV-0617-3 was billed
  // 310 $ per m³, not per kilogram at all.
  const ratePerKgUsd = Number(b.ratePerKgUsd) || 0;
  const packingUsd = Number(b.packingUsd) || 0;
  const otherCargoUsd = Number(b.otherCargoUsd) || 0;
  const freightUsd = Number((calc || {}).freightUsd) || 0;
  const base = roundToTwo(freightUsd - packingUsd - otherCargoUsd);
  const byKg = roundToTwo(weightKg * ratePerKgUsd);
  const byM3 = roundToTwo(volumeM3 * ratePerKgUsd);
  let tariffBasis = '';
  if (Math.abs(byKg - base) <= 1) tariffBasis = 'кг';
  else if (Math.abs(byM3 - base) <= 1) tariffBasis = 'м³';

  let packagingUsd = 0;
  if (tariffBasis === 'кг' && packagingKg > 0) packagingUsd = roundToTwo(packagingKg * ratePerKgUsd + packingUsd);
  else if (tariffBasis === 'м³' && packagingM3 > 0) packagingUsd = roundToTwo(packagingM3 * ratePerKgUsd + packingUsd);

  const cargoRate = Number((calc || {}).cargoRate) || 0;
  // Item 81g-3: freight is costed at its OWN rate (chinaAllocateFreightLedger's), not the
  // goods rate — kept as `rubRate` here (parameter name unchanged) purely to avoid touching
  // every line below; the CALLER is what changed, passing freightRate under this key now.
  const rubRate = Number((calc || {}).rubRate) || 0;
  const freightCny = Number((calc || {}).freightCny) || 0;
  const freightRub = rubRate > 0 ? roundToTwo(freightCny * rubRate) : 0;

  // Everything below only exists once packagingUsd is actually known — otherwise a batch
  // whose packaging cannot be told apart from its goods would silently show its WHOLE
  // freight as "goods freight", which is worse than showing nothing.
  const goodsFreightUsd = packagingUsd > 0 ? roundToTwo(freightUsd - packagingUsd) : 0;
  const packagingRub = (packagingUsd > 0 && rubRate > 0) ? roundToTwo(packagingUsd * cargoRate * rubRate) : 0;
  const goodsFreightRub = (packagingUsd > 0 && freightRub > 0) ? roundToTwo(freightRub - packagingRub) : 0;

  const totalRub = Number((calc || {}).totalRub) || 0;
  const packagingShareFreight = (packagingUsd > 0 && freightUsd > 0) ? roundToTwo(packagingUsd / freightUsd * 100) : 0;
  const packagingShareCost = (packagingRub > 0 && totalRub > 0) ? roundToTwo(packagingRub / totalRub * 100) : 0;
  const goodsFreightShareCost = (goodsFreightRub > 0 && totalRub > 0) ? roundToTwo(goodsFreightRub / totalRub * 100) : 0;

  return {
    goodsKg: goodsKg, goodsVolumeM3: goodsVolumeM3, packagingKg: packagingKg, packagingM3: packagingM3,
    goodsDensity: goodsDensity, packedDensity: packedDensity, tariffBasis: tariffBasis,
    packagingUsd: packagingUsd, goodsFreightUsd: goodsFreightUsd,
    packagingRub: packagingRub, goodsFreightRub: goodsFreightRub,
    packagingShareFreight: packagingShareFreight, packagingShareCost: packagingShareCost,
    goodsFreightShareCost: goodsFreightShareCost,
    // Owner, 2026-09-24: the whole freight in rubles — the batch's own «Перевозка ₽» column
    // reuses this exact figure, so there is only ever one formula for it.
    freightRub: freightRub
  };
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
  // Item 81g-3: goods and the China-side delivery are costed at the ORDER's known rate; freight
  // is costed at the BILL's own known rate — the two need not be the same rate at all, since
  // they come from different receipts (a receipt's ¥ splits into a goods part and a freight
  // part, matched to money at whatever actual rate that payment turned out to be).
  // `rubRate`/`rubRateSource` stay the goods rate/source, kept for backward compatibility.
  const rubRate = Number(b.goodsRate !== undefined ? b.goodsRate : b.rubRate) || 0;
  // A caller that only ever knew ONE rate (chinaBatchCost's own pre-81g-3 tests, called
  // directly rather than through chinaWithPaymentRate) sets `rubRate` alone — freight falls
  // back to that same rate rather than silently costing at 0. chinaWithPaymentRate itself
  // ALWAYS sets `freightRate` explicitly (even to 0), so real production batches never hit
  // this fallback; it exists purely for backward compatibility with the single-rate calling
  // convention.
  const freightRate = Number(b.freightRate !== undefined ? b.freightRate : rubRate) || 0;

  const w = chinaLineWeights(list, b.weightKg);
  const freightShares = chinaAllocate(freightCny, w.weights);
  const chinaShares = chinaAllocate(chinaCny, w.weights);
  const rubShares = chinaAllocate(rubCosts, chinaBoxBases(list));

  const boxStats = list.map(chinaLineBoxStats);

  const out = list.map(function (l, i) {
    const cny = roundToTwo(goods[i] + freightShares[i] + chinaShares[i]);
    const qty = Number(l.qty) || 0;
    const s = boxStats[i];
    // Item 81g-3: goods and the China-side delivery at the GOODS rate, freight at its OWN
    // rate. When the two rates happen to be the SAME (every batch before 81g-3, and any batch
    // whose freight simply borrows the goods rate) the line is still costed the OLD way — one
    // whole-line rounding with freight as the remainder — so nothing already in production
    // drifts by a kopeck; only a batch whose two rates GENUINELY differ pays each ¥ component
    // at its own rate directly (there is nothing to reconstruct from a whole-line total then).
    const goodsRub = rubRate > 0 ? roundToTwo(goods[i] * rubRate) : 0;
    const chinaShareRub = rubRate > 0 ? roundToTwo(chinaShares[i] * rubRate) : 0;
    let freightShareRub;
    if (freightRate === rubRate) {
      const cnyRub = rubRate > 0 ? roundToTwo((goods[i] + freightShares[i] + chinaShares[i]) * rubRate) : 0;
      freightShareRub = rubRate > 0 ? roundToTwo(cnyRub - goodsRub - chinaShareRub) : 0;
    } else {
      freightShareRub = freightRate > 0 ? roundToTwo(freightShares[i] * freightRate) : 0;
    }
    const costRub = roundToTwo(goodsRub + chinaShareRub + freightShareRub + rubShares[i]);
    return {
      sumCny: goods[i],
      weightKg: roundToTwo(w.weights[i]),
      weightSource: w.sources[i],
      chinaShareCny: chinaShares[i],
      freightShareCny: freightShares[i],
      rubShare: rubShares[i],
      costCny: cny,
      costRub: costRub,
      unitRub: qty > 0 ? roundToTwo(costRub / qty) : 0,
      goodsRub: goodsRub,
      chinaShareRub: chinaShareRub,
      freightShareRub: freightShareRub,
      // Item 81e: the factory box, independent of freight — see chinaLineBoxStats.
      boxVolumeM3: s.boxVolumeM3,
      goodsKg: s.goodsKg,
      densityKgM3: s.densityKgM3,
      kgPerPiece: s.kgPerPiece
    };
  });

  chinaLevelGroups(list, out);

  let totalRub = 0;
  out.forEach(function (l) { totalRub = roundToTwo(totalRub + l.costRub); });

  // Item 81g-3: chinaPackagingStats is entirely about the FREIGHT side, so it is handed the
  // freight rate under the key it has always read (`rubRate`) — see the comment on that
  // function's own body for why the parameter name itself did not need to change.
  const packaging = chinaPackagingStats(b, list, boxStats,
    { freightUsd: freightUsd, freightCny: freightCny, cargoRate: cargoRate, rubRate: freightRate, totalRub: totalRub });

  // Owner, 2026-09-24: freight per kilogram. The base is the weight of the GOODS when the
  // carrier's arrival file made that number known (chinaPackagingStats.goodsKg); otherwise it
  // falls back to the waybill's own total weight. No base at all (neither known) leaves both
  // money figures at 0 and the label empty — there is nothing to divide by.
  const freightBase = packaging.goodsKg > 0 ? packaging.goodsKg : (Number(b.weightKg) || 0);
  const freightPerKgUsd = freightBase > 0 ? roundToTwo(freightUsd / freightBase) : 0;
  const freightPerKgRub = freightBase > 0 ? roundToTwo(packaging.freightRub / freightBase) : 0;
  const freightPerKgBase = freightBase <= 0 ? '' : (packaging.goodsKg > 0 ? 'товара' : 'накладной');

  // Owner, 2026-09-24: the carrier's OWN tariff (Ставка $/кг, straight off the waybill) in
  // rubles — meant to sit next to freightPerKgRub above so the owner can read the carrier's
  // bill and the goods' real per-kilogram cost side by side. Item 81g-3: at the FREIGHT rate.
  const tariffRub = freightRate > 0 ? roundToTwo((Number(b.ratePerKgUsd) || 0) * cargoRate * freightRate) : 0;

  return {
    lines: out,
    goodsCny: goodsCny,
    chinaDeliveryCny: chinaCny,
    freightUsd: freightUsd,
    cargoRate: cargoRate,
    freightCny: freightCny,
    rubCosts: rubCosts,
    rubRate: rubRate,
    freightRate: freightRate,
    totalRub: totalRub,
    weightFactor: w.factor === null ? null : Math.round(w.factor * 10000) / 10000,
    // Item 81e: the batch's packaging analytics — see chinaPackagingStats.
    goodsKg: packaging.goodsKg,
    goodsVolumeM3: packaging.goodsVolumeM3,
    packagingKg: packaging.packagingKg,
    packagingM3: packaging.packagingM3,
    goodsDensity: packaging.goodsDensity,
    packedDensity: packaging.packedDensity,
    tariffBasis: packaging.tariffBasis,
    packagingUsd: packaging.packagingUsd,
    goodsFreightUsd: packaging.goodsFreightUsd,
    packagingRub: packaging.packagingRub,
    goodsFreightRub: packaging.goodsFreightRub,
    packagingShareFreight: packaging.packagingShareFreight,
    packagingShareCost: packaging.packagingShareCost,
    goodsFreightShareCost: packaging.goodsFreightShareCost,
    // Owner, 2026-09-24: ruble equivalents of the batch's three currency totals. freightRub
    // comes straight from chinaPackagingStats — one source, no second formula.
    goodsRub: rubRate > 0 ? roundToTwo(goodsCny * rubRate) : 0,
    chinaDeliveryRub: rubRate > 0 ? roundToTwo(chinaCny * rubRate) : 0,
    freightRub: packaging.freightRub,
    // Owner, 2026-09-24: freight per kilogram of the batch — see the comment above.
    freightPerKgUsd: freightPerKgUsd,
    freightPerKgRub: freightPerKgRub,
    freightPerKgBase: freightPerKgBase,
    tariffRub: tariffRub
  };
}

// ---------------------------------------------------------------- writing

function chinaNextId(rows, prefix) {
  return chinaNextIds(rows, prefix, 1)[0];
}

// A batch of fresh ids at once — restoring a batch's Russian-side costs (restoreChinaBatch)
// needs several new 'CC' ids in one go, and asking chinaNextId one at a time would hand out
// the SAME id repeatedly since the rows it scans have not actually changed yet.
function chinaNextIds(rows, prefix, count) {
  let max = 0;
  rows.forEach(function (r) {
    const id = String(r['ID'] || '').trim();
    if (id.indexOf(prefix) !== 0) return;
    const n = parseInt(id.slice(prefix.length), 10);
    if (!isNaN(n) && n > max) max = n;
  });
  const out = [];
  for (let i = 1; i <= count; i++) out.push(prefix + (max + i));
  return out;
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
    comment: String(data.comment || '').trim(),
    receivedAt: chinaDateText(data.receivedAt, 'Дата приёмки'),
    // Item 81g-3: the owner's own check mark and its note — included only when the caller
    // actually sends them, so an ordinary save that never mentions them leaves whatever is
    // already stored alone (writeChinaBatch's merge relies on this being `undefined`, not '').
    checkMark: data.checkMark === undefined ? undefined : chinaCheckMarkOf(data.checkMark),
    checkNote: data.checkNote === undefined ? undefined : String(data.checkNote || '').trim()
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
      group: String(l.group || '').trim(),
      // Item 81e: one factory box, from the carrier's arrival file — saved as given.
      boxLengthM: parseNumber(l.boxLengthM),
      boxWidthM: parseNumber(l.boxWidthM),
      boxHeightM: parseNumber(l.boxHeightM),
      factoryBoxKg: parseNumber(l.factoryBoxKg)
    };
  });

  const costs = chinaReadSheet(ss, CHINA_COSTS_SHEET, CHINA_COST_HEADERS).rows
    .map(chinaCostFromRow).filter(function (c) { return c.batchId === batchId; });
  let rubTotal = 0;
  costs.forEach(function (c) { rubTotal = roundToTwo(rubTotal + c.amountRub); });

  const rated = chinaWithPaymentRate(ss, batch);
  const calc = chinaFullyCost(rated, lines, rubTotal, getChinaSettings());
  writeChinaBatch(ss, batchCtx, rated, lines, calc, username);
  chinaRecostBorrowers(ss, username, [batchId]);
  return getChinaBatches();
}

/**
 * The date a batch's rate is dated by: shipping first, then acceptance, then arrival —
 * whichever of the three it actually has. Used only to pick which OTHER batch's rate a batch
 * without one of its own should borrow (chinaBorrowedRate).
 */
function chinaRateDateOf(b) {
  const batch = b || {};
  return String(batch.shippedAt || batch.receivedAt || batch.arrivedAt || '').trim();
}

/**
 * Owner, 2026-09-24: when a batch has no rate of its own — no payment of its order, no rate
 * typed by hand — it is costed at the rate of the PREVIOUS batch, so a partially settled
 * supply is not simply zero. Only a batch's OWN rate ('оплаты' or 'вручную') can be lent: a
 * borrowed rate is never lent again, so there is no chain to walk and no risk of a batch
 * borrowing from itself through a loop of others.
 *
 * The one closest before this batch's own date wins; a batch with no date of its own just
 * takes the latest dated source there is. Ties go to the later `updatedAt`, then to whichever
 * batch sits later among the candidates (the array order IS the sheet's row order).
 */
/**
 * Item 81g-3: generalized so goods and freight can each borrow their OWN rate independently —
 * `sourceField`/`rateField` name which pair of batch columns to look at (e.g. 'rubRateSource'/
 * 'rubRate' for goods, 'freightRateSource'/'freightRate' for freight). The search itself is
 * unchanged from the original (single-rate) version.
 */
function chinaBorrowedRateOf(batch, others, sourceField, rateField) {
  const own = (others || []).filter(function (b) {
    return (b[sourceField] === 'оплаты' || b[sourceField] === 'вручную') && Number(b[rateField]) > 0;
  });
  if (own.length === 0) return null;

  const targetDate = chinaRateDateOf(batch);
  const pool = targetDate
    ? own.filter(function (b) { const d = chinaRateDateOf(b); return d !== '' && d <= targetDate; })
    : own.filter(function (b) { return chinaRateDateOf(b) !== ''; });
  if (pool.length === 0) return null;

  let best = pool[0];
  for (let i = 1; i < pool.length; i++) {
    const b = pool[i];
    const d = chinaRateDateOf(b), bd = chinaRateDateOf(best);
    if (d > bd || (d === bd && String(b.updatedAt || '') >= String(best.updatedAt || ''))) best = b;
  }
  return best;
}

// Kept for backward compatibility — this IS the goods rate/source, per the owner's decision.
function chinaBorrowedRate(batch, others) {
  return chinaBorrowedRateOf(batch, others, 'rubRateSource', 'rubRate');
}

/**
 * The rate a batch is costed at. Payments put against its order decide it first; the rate
 * typed by hand is what is left when there are none; a batch that has neither of its own
 * borrows the rate of a previous batch (chinaBorrowedRate). The sheet says which of the three
 * it was, and — only for a borrowed rate — which batch it came from.
 */
/**
 * Item 81g-3: the whole ledger a batch's rates are resolved against, read ONCE per call site
 * (chinaWithPaymentRate is called once per batch, so this is one read of «Отчёты»/
 * «Поступления», not one per batch — chinaRecostAll below relies on that).
 */
function chinaLedgerContext(ss) {
  const reports = chinaReadSheet(ss, CHINA_REPORTS_SHEET, CHINA_REPORT_HEADERS).rows.map(chinaReportFromRow);
  const receipts = chinaReadSheet(ss, CHINA_RECEIPTS_SHEET, CHINA_RECEIPT_HEADERS).rows.map(chinaReceiptFromRow);
  const receiptsById = {};
  receipts.forEach(function (r) { receiptsById[r.id] = r; });
  const goodsAlloc = chinaAllocateGoodsLedger(reports, receipts);
  let newest = null;
  reports.forEach(function (r) { if (!newest || r.reportDate > newest.reportDate) newest = r; });
  const freightAlloc = chinaAllocateFreightLedger(
    newest ? newest.freights : [], receipts, newest ? newest.openingFreightUsd : 0);
  return { receiptsById: receiptsById, goodsAlloc: goodsAlloc, freightAlloc: freightAlloc, newest: newest };
}

// The known ¥/₽ of an ORDER, straight off the goods pool allocation — chinaLotsKnownRub reused
// exactly as getChinaMoney uses it, so a batch's rate and getChinaMoney's own figures for the
// same order are always the same number, computed the same way.
function chinaOrderKnown(ledger, orderNo) {
  const o = ledger.goodsAlloc.orders[String(orderNo || '').trim()];
  if (!o) return { knownCny: 0, knownRub: 0, pendingCny: 0, historyCny: 0, unknownCny: 0, totalCny: 0, lots: [] };
  return {
    knownCny: o.knownCny,
    knownRub: chinaLotsKnownRub(o.lots, ledger.receiptsById, 'rubGoods', 'goodsCny'),
    pendingCny: o.pendingCny, historyCny: o.historyCny, unknownCny: o.unknownCny, totalCny: o.totalCny,
    // Coordinator, 2026-09-25: the ORDER's own lots — so a «pending» message can name the actual
    // receipts (chinaLotsMissingMessages), not just a bare ¥ total.
    lots: o.lots
  };
}

// The known ¥/₽/unpaid $ of a freight BILL — straight off chinaAllocateFreightLedger.
function chinaBillKnown(ledger, code) {
  return ledger.freightAlloc.bills[String(code || '').trim()] || null;
}

/**
 * Owner, 2026-09-25 (live check): a payment that has not been matched to any receipt yet still
 * says something real about the world — it is money the owner actually spent, at a rate he
 * either typed or the report later confirmed. A batch with nothing else to go on (no known
 * order/bill money, no typed rate of its own) is far better costed at the LATEST such rate than
 * left at zero, which is what happened before this fix: an unallocated payment contributed
 * nothing anywhere, so a batch with no earlier batch to borrow from stayed at 0 ₽ outright.
 *
 * The most recent payment BY DATE wins; a tie goes to the LATER row (the array order is the
 * sheet's own row order, so this is just "iterate and keep replacing on >="). Its ACTUAL rate
 * («Курс фактический», set once a receipt matches it) beats the rate it was typed at — the
 * actual rate is the one that really happened. Pure — no sheet access, `payments` is whatever
 * the caller already read.
 */
function chinaLatestPaymentRate(payments) {
  let best = null;
  (payments || []).forEach(function (p) {
    const date = String(p.date || '').trim();
    const rate = Number(p.actualRate) > 0 ? Number(p.actualRate) : Number(p.rate) || 0;
    if (!date || !(rate > 0)) return;
    if (!best || date >= best.date) best = { date: date, id: p.id, rate: rate };
  });
  return best;
}

// 'yyyy-MM-dd' -> 'DD.MM', for the short date label in a «missing» message. Every date reaching
// here already went through chinaDateText, so the fallback (the raw text) should never actually
// show — it is here purely so a malformed value cannot throw instead of just looking odd.
function chinaShortDate(dateText) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateText || ''));
  return m ? m[3] + '.' + m[2] : String(dateText || '');
}

/**
 * The rate a batch is costed at — now TWO rates, resolved independently:
 *
 *   goods (and the China-side delivery, same ¥):
 *     1. the order's KNOWN rate from the goods pool allocation (chinaOrderKnown);
 *     2. the OLD orderNo-payments rate (chinaRateFromPayments) — kept as a fallback for a batch
 *        whose order has no report/ledger data at all (every batch tested before 81g-1 relies
 *        on exactly this, and the contract itself says old payment rows must still load);
 *     3. the rate typed by hand;
 *     4. Owner, 2026-09-25: the rate of the LATEST payment known to the system at all
 *        (chinaLatestPaymentRate), whether or not it has been matched to anything — but NEVER
 *        for a batch that would otherwise be «история» (shipped before tracking, no money of
 *        its own anywhere): a provisional rate on a batch nobody expects money on yet is noise;
 *     5. borrowed from a previous batch's own goods rate (chinaBorrowedRate).
 *
 *   freight: the bill's KNOWN rate from the freight FIFO (chinaBillKnown), else the SAME typed
 *   rate (one field, one thing the owner types), else the SAME latest-payment fallback as goods
 *   (step 4 above, same rule about «история»), else borrowed from a previous batch's own freight
 *   rate (chinaBorrowedRateOf with the freight columns), else 0.
 *
 * `rubRate`/`rubRateSource` stay the GOODS rate/source, for backward compatibility. `history` is
 * true only when NEITHER rate has anything at all AND the batch shipped before tracking started
 * — a batch costed at 0 for a reason the owner can still see is not the same as one nobody has
 * looked at yet.
 */
function chinaWithPaymentRate(ss, batch) {
  const ledger = chinaLedgerContext(ss);
  const others = chinaReadSheet(ss, CHINA_BATCHES_SHEET, CHINA_BATCH_HEADERS).rows
    .map(chinaBatchFromRow).filter(function (b) { return b.id !== batch.id; });

  const out = {};
  Object.keys(batch).forEach(function (k) { out[k] = batch[k]; });

  const manual = Number(batch.manualRate) || 0;
  const orderInfo = chinaOrderKnown(ledger, batch.orderNo);
  const payments = chinaReadSheet(ss, CHINA_PAYMENTS_SHEET, CHINA_PAYMENT_HEADERS).rows.map(chinaPaymentFromRow);
  const fromOldPayments = chinaRateFromPayments(payments, batch.orderNo);
  // Owner, 2026-09-25: a batch shipped before tracking, with no money of its own anywhere, stays
  // «история» — the last-payment fallback below is for a CURRENT supply and must never turn a
  // batch nobody expects money on yet into one that looks provisionally costed.
  const historyEligible = !!(String(batch.shippedAt || '') && String(batch.shippedAt) < CHINA_TRACKING_START_DATE);
  const lastPayment = chinaLatestPaymentRate(payments);

  if (orderInfo.knownCny > 0.004) {
    out.goodsRate = Math.round((orderInfo.knownRub / orderInfo.knownCny) * 10000) / 10000;
    out.goodsRateSource = 'оплаты';
  } else if (fromOldPayments > 0) {
    out.goodsRate = fromOldPayments;
    out.goodsRateSource = 'оплаты';
  } else if (manual > 0) {
    out.goodsRate = manual;
    out.goodsRateSource = 'вручную';
  } else if (!historyEligible && lastPayment) {
    out.goodsRate = lastPayment.rate;
    out.goodsRateSource = 'последняя оплата';
  } else {
    const source = chinaBorrowedRate(batch, others);
    out.goodsRate = source ? source.rubRate : 0;
    out.goodsRateSource = source ? 'предыдущая партия' : '';
  }

  const bill = chinaBillKnown(ledger, batch.code);
  if (bill && bill.knownCny > 0.004) {
    out.freightRate = bill.knownRate;
    out.freightRateSource = 'оплаты';
  } else if (fromOldPayments > 0) {
    // Backward compatibility: the OLD orderNo-payments rate costed the WHOLE batch (goods AND
    // freight) at one rate — freight falls back to the same figure goods just used, so a batch
    // that never adopted the new report/bill model still costs uniformly, as it always did.
    out.freightRate = fromOldPayments;
    out.freightRateSource = 'оплаты';
  } else if (manual > 0) {
    out.freightRate = manual;
    out.freightRateSource = 'вручную';
  } else if (!historyEligible && lastPayment) {
    out.freightRate = lastPayment.rate;
    out.freightRateSource = 'последняя оплата';
  } else {
    const source = chinaBorrowedRateOf(batch, others, 'freightRateSource', 'freightRate');
    out.freightRate = source ? source.freightRate : 0;
    out.freightRateSource = source ? 'предыдущая партия' : '';
  }

  // Backward compatibility, per the owner's decision: rubRate/rubRateSource ARE the goods
  // rate/source. `rubRateFrom` records the borrowed batch's code — either rate can borrow, so
  // whichever one did wins (goods checked first; a batch is very unlikely to borrow only one).
  out.rubRate = out.goodsRate;
  out.rubRateSource = out.goodsRateSource;
  const goodsSource = out.goodsRateSource === 'предыдущая партия' ? chinaBorrowedRate(batch, others) : null;
  const freightSource = out.freightRateSource === 'предыдущая партия'
    ? chinaBorrowedRateOf(batch, others, 'freightRateSource', 'freightRate') : null;
  out.rubRateFrom = (goodsSource && goodsSource.code) || (freightSource && freightSource.code) || '';
  // Owner, 2026-09-25: same idea, for the «последняя оплата» source — which payment (date + ID)
  // it came from, so the sheet and the missing-list message can both point at it.
  out.rateFromPayment = (out.goodsRateSource === 'последняя оплата' || out.freightRateSource === 'последняя оплата') && lastPayment
    ? lastPayment.date + ' ' + lastPayment.id : '';

  out.history = !!(String(batch.shippedAt || '') && String(batch.shippedAt) < CHINA_TRACKING_START_DATE &&
    out.goodsRateSource === '' && out.freightRateSource === '');

  out.orderInfo = orderInfo;
  out.billInfo = bill;
  // Coordinator, 2026-09-25: kept alongside orderInfo/billInfo so chinaMissingListOf can name
  // the actual receipts a pending amount is waiting on (chinaLotsMissingMessages).
  out.receiptsById = ledger.receiptsById;
  return out;
}

/**
 * Owner, 2026-09-24: whenever a batch's OWN rate can have moved, every OTHER batch that
 * borrowed a rate ('предыдущая партия') is costed again — a batch whose source disappeared or
 * moved must never keep a stale borrowed rate. Called once, at the end of every path that can
 * change a rate: saving or deleting a batch, a payment or a Russian-side cost.
 * `skipIds` leaves out the batch(es) that path just recalculated on its own.
 */
function chinaRecostBorrowers(ss, username, skipIds) {
  const skip = {};
  (skipIds || []).forEach(function (id) { if (id) skip[id] = true; });
  const batches = chinaReadSheet(ss, CHINA_BATCHES_SHEET, CHINA_BATCH_HEADERS).rows.map(chinaBatchFromRow);
  batches.forEach(function (b) {
    if (skip[b.id]) return;
    // Coordinator review, 2026-09-24: a batch with NO source at all ('') is just as much a
    // potential borrower as one that already reads 'предыдущая партия' — it simply had
    // nothing to borrow last time it was costed. Only an own rate ('оплаты'/'вручную') is
    // excluded: THAT batch is a possible SOURCE, never itself a borrower to re-cost here.
    // Item 81g-3: goods and freight each have their OWN source now — either one being a
    // possible borrower is enough to re-cost the batch.
    const goodsMayBorrow = b.rubRateSource === 'предыдущая партия' || b.rubRateSource === '';
    const freightMayBorrow = b.freightRateSource === 'предыдущая партия' || b.freightRateSource === '';
    if (goodsMayBorrow || freightMayBorrow) recalcChinaBatch(ss, b.id, username);
  });
}

/**
 * Item 81g-3: re-costs EVERY batch, unconditionally — used after a write that can change the
 * ledger ITSELF (a report, a payment, a match/unmatch), where any batch's OWN rate can move,
 * not just a borrower's. `chinaRecostBorrowers` above stays for a plain batch/cost save, where
 * only the borrowing chain can possibly be affected.
 */
function chinaRecostAll(ss, username) {
  const batches = chinaReadSheet(ss, CHINA_BATCHES_SHEET, CHINA_BATCH_HEADERS).rows.map(chinaBatchFromRow);
  batches.forEach(function (b) { recalcChinaBatch(ss, b.id, username); });
}

const CHINA_CHECK_MARKS = ['', 'скрипт', 'скрипт+ИИ', 'ИИ', 'расхождение ИИ'];

function chinaCheckMarkOf(value) {
  const v = String(value === undefined || value === null ? '' : value).trim();
  if (CHINA_CHECK_MARKS.indexOf(v) === -1) throw new Error('Неизвестная отметка проверки: ' + v);
  return v;
}

// Russian genitive month names, for a short human date label ('августа 2026') — see
// chinaTrackingStartLabel.
const CHINA_MONTHS_GENITIVE = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля',
  'августа', 'сентября', 'октября', 'ноября', 'декабря'];

// CHINA_TRACKING_START_DATE ('2026-08-01') read out as «августа 2026», for the missing-list
// history clause — derived from the constant so the two never drift apart if it ever changes.
function chinaTrackingStartLabel() {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(CHINA_TRACKING_START_DATE);
  if (!m) return CHINA_TRACKING_START_DATE;
  return CHINA_MONTHS_GENITIVE[Number(m[2]) - 1] + ' ' + m[1];
}

// 'a, b и c' — the owner's own way of listing a few things in Russian prose, used only for the
// short list of pending receipts in chinaLotsMissingMessages.
function chinaJoinAnd(parts) {
  if (parts.length <= 1) return (parts[0] || '');
  return parts.slice(0, -1).join(', ') + ' и ' + parts[parts.length - 1];
}

/**
 * Coordinator, 2026-09-25 (live check): the owner could not tell what «оплата от заказа на
 * 4056 ¥ ещё не внесена» actually meant — which receipts, which dates. This names them: every
 * PENDING lot as its receipt's date and ¥ (with «из <receipt total> ¥» when the lot is only part
 * of that receipt — the rest went to another order), plus a separate line for money that came in
 * before tracking started and so has no course at all. Pure — `lots` is an order's own lots
 * (chinaOrderKnown) or a bill's own slices (chinaBillKnown, same {receiptId, cny} shape);
 * `historyCny` is that same order/bill's own precomputed total (NOT re-summed here — a freight
 * bill's opening balance is a synthetic 'OPENING' lot with no receipt of its own, so walking the
 * lots a second time would undercount it).
 */
function chinaLotsMissingMessages(lots, receiptsById, cnyField, subject, historyCny) {
  const parts = [];
  (lots || []).forEach(function (l) {
    if (l.receiptId === 'UNKNOWN' || l.receiptId === 'OPENING') return;
    const r = receiptsById[l.receiptId];
    if (!r || chinaReceiptStatusBucket(r.status) !== 'pendingCny') return;
    const lotCny = Number(l.cny) || 0;
    const total = Number(r[cnyField]) || 0;
    const label = (total > 0.004 && Math.abs(lotCny - total) > 0.005)
      ? (lotCny + ' ¥ из ' + total + ' ¥') : (lotCny + ' ¥');
    parts.push(chinaShortDate(r.date) + ' (' + label + ')');
  });
  const out = [];
  if (parts.length) {
    out.push('в отчёте есть поступления ' + chinaJoinAnd(parts) + ' ' + subject +
      ', а оплат в приложении нет — внесите их');
  }
  if (Number(historyCny) > 0.004) {
    out.push(roundToTwo(Number(historyCny)) + ' ¥ пришли до ' + chinaTrackingStartLabel() + ' — история без курса');
  }
  return out;
}

/**
 * Item 81g-3: what still stands between a batch and «Расчёт закрыт» — Russian text, one entry
 * per unresolved thing, in the order the owner is likeliest to fix them. A history batch (no
 * tracking-era money anywhere) is exempt outright: there is nothing for it to ever resolve.
 * `rated` is the batch AFTER chinaWithPaymentRate (carries `orderInfo`/`billInfo`/`history`/
 * `receiptsById`); `calc` is chinaBatchCost's own result for the same batch.
 */
function chinaMissingListOf(rated, calc) {
  if (rated.history) return [];
  const missing = [];
  if (String(rated.status || '') !== 'Прибыла') missing.push('статус не «Прибыла»');
  const hasWeight = Number(rated.weightKg) > 0;
  const hasFreight = Number(rated.freightUsd) > 0 || (Number(rated.ratePerKgUsd) > 0 && hasWeight);
  if (!hasWeight || !hasFreight) missing.push('не загружен файл партии (нет веса или перевозки)');
  const bill = rated.billInfo;
  if (!bill) missing.push('в отчёте нет накладной карго на эту партию');
  const receiptsById = rated.receiptsById || {};
  const order = rated.orderInfo || { pendingCny: 0, historyCny: 0, unknownCny: 0, lots: [] };
  if (order.pendingCny > 0.004 || order.historyCny > 0.004) {
    missing.push.apply(missing,
      chinaLotsMissingMessages(order.lots, receiptsById, 'goodsCny', 'на этот заказ', order.historyCny));
  }
  if (order.unknownCny > 0.004) missing.push(order.unknownCny + ' ¥ товара без курса (не хватает поступлений)');
  if (bill && bill.unpaidUsd > 0.004) missing.push('перевозка не оплачена полностью (' + bill.unpaidUsd + ' $)');
  if (bill && (bill.pendingCny > 0.004 || bill.historyCny > 0.004)) {
    missing.push.apply(missing,
      chinaLotsMissingMessages(bill.slices, receiptsById, 'freightCny', 'на эту перевозку', bill.historyCny));
  }
  // Owner, 2026-09-25 (live check): a batch costed at a provisional rate — the last known
  // payment, or borrowed from another batch — must still say so, so «Расчёт закрыт» is never
  // confused with a rate the owner can actually rely on.
  if (rated.goodsRateSource === 'последняя оплата' || rated.freightRateSource === 'последняя оплата') {
    const paymentDate = String(rated.rateFromPayment || '').split(' ')[0];
    missing.push('курс предварительный — по последней оплате' + (paymentDate ? ' от ' + chinaShortDate(paymentDate) : ''));
  }
  if (rated.goodsRateSource === 'предыдущая партия' || rated.freightRateSource === 'предыдущая партия') {
    missing.push('курс предварительный — из партии ' + (rated.rubRateFrom || ''));
  }
  if (!rated.rubCostsDone) missing.push('расходы РФ не подтверждены');
  return missing;
}

// The whole costing pipeline of a batch, plus the analytics that only make sense once the money
// itself is known — one function so every save/recalc path produces them the same way.
function chinaFullyCost(rated, lines, rubCostsTotal, settings) {
  const calc = chinaBatchCost(rated, lines, rubCostsTotal, settings);
  calc.history = !!rated.history;
  calc.missing = chinaMissingListOf(rated, calc);
  calc.closed = calc.missing.length === 0;
  return calc;
}

function writeChinaBatch(ss, batchCtx, batch, lines, calc, username) {
  const values = {
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
    'Обновлено': chinaStamp(),
    // Item 81e: box data survives as given; the rest is chinaPackagingStats, fresh every time.
    'Дата приёмки': batch.receivedAt || '',
    'Вес товара, кг': calc.goodsKg,
    'Объём товара, м³': calc.goodsVolumeM3,
    'Вес упаковки, кг': calc.packagingKg,
    'Объём упаковки, м³': calc.packagingM3,
    'Плотность товара, кг/м³': calc.goodsDensity,
    'Плотность в упаковке, кг/м³': calc.packedDensity,
    'Тариф за': calc.tariffBasis,
    'Упаковка всего $': calc.packagingUsd,
    'Перевозка товара $': calc.goodsFreightUsd,
    'Упаковка ₽': calc.packagingRub,
    'Перевозка товара ₽': calc.goodsFreightRub,
    'Доля упаковки в перевозке, %': calc.packagingShareFreight,
    'Доля упаковки в себестоимости, %': calc.packagingShareCost,
    'Доля перевозки товара в себестоимости, %': calc.goodsFreightShareCost,
    // Owner, 2026-09-24: ruble equivalents of the batch's currency totals, and — only when the
    // rate was borrowed — the batch it was borrowed from.
    'Товар ₽': calc.goodsRub,
    'Доставка по Китаю ₽': calc.chinaDeliveryRub,
    'Перевозка ₽': calc.freightRub,
    'Курс взят из партии': batch.rubRateFrom || '',
    'Курс взят из оплаты': batch.rateFromPayment || '',
    // Owner, 2026-09-24: freight per kilogram, and the carrier's own tariff next to it.
    'Перевозка за 1 кг $': calc.freightPerKgUsd,
    'Перевозка за 1 кг ₽': calc.freightPerKgRub,
    'Перевозка за 1 кг считается от': calc.freightPerKgBase,
    'Тариф карго ₽': calc.tariffRub,
    // Item 81g-3: goods/freight rates and sources, and what chinaFullyCost worked out — all
    // FRESH every time (recomputed from the ledger on every recalc, never merged forward).
    'Курс товара ₽/¥': calc.rubRate,
    'Источник курса товара': batch.goodsRateSource || '',
    'Курс перевозки ₽/¥': calc.freightRate,
    'Источник курса перевозки': batch.freightRateSource || '',
    'История': calc.history ? 'да' : '',
    'Расчёт закрыт': calc.closed ? 'да' : '',
    'Чего не хватает': (calc.missing || []).join('; ')
  };
  // Item 81g-3: checkMark/checkNote are the OWNER's own input (saveChinaBatch), not something
  // every recalc derives — included only when actually PROVIDED, so an unrelated recost (a
  // payment, a report) preserves whatever is already on the row via the merge just below,
  // instead of resetting it to '' because this particular save never touched it.
  if (batch.checkMark !== undefined) values['Проверка'] = batch.checkMark;
  if (batch.checkNote !== undefined) values['Проверка: детали'] = batch.checkNote;

  let targetRow = 0, previousRecord = null;
  batchCtx.rows.forEach(function (r) {
    if (String(r['ID']).trim() === batch.id) { targetRow = r.__row; previousRecord = r; }
  });
  // Item 81g-1: a header this save knows nothing about keeps whatever the PREVIOUS row held
  // instead of being blanked to '' — every save/recost path in this file goes through here, so
  // without this a Russian-side cost or a payment recost would silently erase a column no logic
  // here has been taught to write yet. A brand new batch has no previous row, so chinaRowFrom's
  // own '' default applies.
  const merged = previousRecord ? Object.assign({}, chinaStripRow(previousRecord), values) : values;
  const row = chinaRowFrom(batchCtx.headers, merged);
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
      'Один товар': l.group,
      // Item 81e: box data survives as given; the stats next to it are chinaLineBoxStats.
      'Длина коробки, м': l.boxLengthM,
      'Ширина коробки, м': l.boxWidthM,
      'Высота коробки, м': l.boxHeightM,
      'Вес коробки фабрики, кг': l.factoryBoxKg,
      'Объём коробки, м³': c.boxVolumeM3,
      'Вес товара, кг': c.goodsKg,
      'Плотность, кг/м³': c.densityKgM3,
      'Вес 1 шт, кг': c.kgPerPiece,
      // Owner, 2026-09-24: ruble equivalents of this line's own three currency components.
      'Товар ₽': c.goodsRub,
      'Доставка Китай ₽': c.chinaShareRub,
      'Перевозка ₽': c.freightShareRub
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
  const calc = chinaFullyCost(rated, lines, rubTotal, getChinaSettings());
  writeChinaBatch(ss, batchCtx, rated, lines, calc, username || batch.user);
  return calc;
}

// A sheet's row, keyed by header text, minus the __row bookkeeping field chinaReadSheet adds —
// what actually goes into an archive DataJSON or is handed to chinaRowFrom for a fresh write.
function chinaStripRow(r) {
  const out = {};
  Object.keys(r || {}).forEach(function (k) { if (k !== '__row') out[k] = r[k]; });
  return out;
}

function deleteChinaBatch(data, username) {
  const id = String((data || {}).id || '').trim();
  if (!id) throw new Error('Не указана партия для удаления');
  const ss = chinaSpreadsheet();

  const batchCtx = chinaReadSheet(ss, CHINA_BATCHES_SHEET, CHINA_BATCH_HEADERS);
  let targetRow = 0, batchRecord = null;
  batchCtx.rows.forEach(function (r) { if (String(r['ID']).trim() === id) { targetRow = r.__row; batchRecord = r; } });
  if (!targetRow) throw new Error('Партия ' + id + ' не найдена');

  const lineCtx = chinaReadSheet(ss, CHINA_LINES_SHEET, CHINA_LINE_HEADERS);
  const removedLines = lineCtx.rows.filter(function (r) { return String(r['ПартияID']).trim() === id; });
  const keptLines = lineCtx.rows
    .filter(function (r) { return String(r['ПартияID']).trim() !== id; })
    .map(function (r) { return chinaRowFrom(lineCtx.headers, r); });

  const costCtx = chinaReadSheet(ss, CHINA_COSTS_SHEET, CHINA_COST_HEADERS);
  const removedCosts = costCtx.rows.filter(function (r) { return String(r['ПартияID']).trim() === id; });
  const keptCosts = costCtx.rows
    .filter(function (r) { return String(r['ПартияID']).trim() !== id; })
    .map(function (r) { return chinaRowFrom(costCtx.headers, r); });

  // Owner, 2026-09-24: a deleted batch goes to «Удаленное» in the MAIN database, not into the
  // void — its own row, lines and Russian-side costs, keyed by the sheet's own headers so a
  // restore can write them back exactly. Payments are per ORDER, not per batch, and stay where
  // they are. archiveItem lives in Code.gs; the trash lights up with just `code`, one line per
  // deleted batch, instead of the whole dump (owner, 2026-09-24).
  archiveItem('ChinaBatch', {
    code: String((batchRecord && batchRecord['Код партии']) || '').trim(),
    batch: chinaStripRow(batchRecord),
    lines: removedLines.map(chinaStripRow),
    costs: removedCosts.map(chinaStripRow)
  }, username);

  batchCtx.sheet.deleteRow(targetRow);
  chinaWriteSheet(lineCtx.sheet, lineCtx.headers, keptLines);
  chinaWriteSheet(costCtx.sheet, costCtx.headers, keptCosts);

  // The deleted batch may have been the source of a borrowed rate — its borrowers must not
  // keep costing at a rate that no longer exists.
  chinaRecostBorrowers(ss, username, []);

  Logger.log('Заказы в Китае: партия ' + id + ' удалена пользователем ' + (username || '—'));
  return getChinaBatches();
}

/**
 * Owner, 2026-09-24: the other half of the trash — writes an archived 'ChinaBatch' back into
 * the module's own spreadsheet. Called from Code.gs's restoreArchivedItem/
 * restoreMultipleArchivedItems (the archive itself lives in the MAIN database, this module's
 * spreadsheet does not).
 *
 * The batch's own ID survives the round trip untouched UNLESS a batch with that ID exists
 * again by now (an id the counter has since reused) — then a fresh ID is handed out and the
 * lines/costs are re-keyed under it, so nothing restored can collide with what is already
 * there. A batch with the same CODE is refused outright: two batches of the same code is the
 * exact ambiguity the archive exists to prevent, so the archive row is left in place for the
 * owner to sort out by hand (the caller must not delete it when this throws).
 */
function restoreChinaBatch(payload, username) {
  const ss = chinaSpreadsheet();
  const p = payload || {};
  const originalBatch = p.batch || {};
  const code = String(originalBatch['Код партии'] || '').trim();
  if (!code) throw new Error('В архиве повреждена запись партии «Заказы в Китае»: нет кода партии');

  const batchCtx = chinaReadSheet(ss, CHINA_BATCHES_SHEET, CHINA_BATCH_HEADERS);
  const codeTaken = batchCtx.rows.some(function (r) { return String(r['Код партии'] || '').trim() === code; });
  if (codeTaken) {
    throw new Error('Партия с кодом «' + code + '» уже существует — восстановление отменено');
  }

  const originalId = String(originalBatch['ID'] || '').trim();
  const idTaken = originalId !== '' && batchCtx.rows.some(function (r) { return String(r['ID'] || '').trim() === originalId; });
  const batchId = (originalId && !idTaken) ? originalId : chinaNextId(batchCtx.rows, 'CB');
  const reKeyed = batchId !== originalId;

  const batchRow = chinaRowFrom(batchCtx.headers, Object.assign({}, originalBatch, { 'ID': batchId }));
  batchCtx.sheet.appendRow(batchRow);

  // recalcChinaBatch below calls writeChinaBatch, which REWRITES the whole lines sheet under
  // this batch id and re-derives every line's own id as batchId + '-' + (its position) — same
  // as any ordinary save. So the id put here is only ever a placeholder; giving it the CORRECT
  // final shape up front just avoids a pointless intermediate row.
  const lines = Array.isArray(p.lines) ? p.lines : [];
  const lineCtx = chinaReadSheet(ss, CHINA_LINES_SHEET, CHINA_LINE_HEADERS);
  lines.forEach(function (l, i) {
    const row = chinaRowFrom(lineCtx.headers, Object.assign({}, l, { 'ID': batchId + '-' + (i + 1), 'ПартияID': batchId }));
    lineCtx.sheet.appendRow(row);
  });

  // Costs are NOT rewritten by recalcChinaBatch (only the batch row and its lines are), so
  // their ids need to be got right HERE. The 'CC' series is global across every batch and
  // independent of whether the BATCH id conflicted — a cost keeps its original id only when
  // nothing else has taken it in the meantime; a fresh one is handed out otherwise, checked one
  // cost at a time so two archived costs can never collide with EACH OTHER either.
  const costs = Array.isArray(p.costs) ? p.costs : [];
  const costCtx = chinaReadSheet(ss, CHINA_COSTS_SHEET, CHINA_COST_HEADERS);
  const usedCostIds = {};
  costCtx.rows.forEach(function (r) { usedCostIds[String(r['ID'] || '').trim()] = true; });
  const knownCostRows = costCtx.rows.slice();
  costs.forEach(function (c) {
    const original = String(c['ID'] || '').trim();
    const costId = (original && !usedCostIds[original]) ? original : chinaNextId(knownCostRows, 'CC');
    usedCostIds[costId] = true;
    knownCostRows.push({ 'ID': costId });
    const row = chinaRowFrom(costCtx.headers, Object.assign({}, c, { 'ID': costId, 'ПартияID': batchId }));
    costCtx.sheet.appendRow(row);
  });

  recalcChinaBatch(ss, batchId, username);
  // The restored batch may itself be a rate SOURCE for other batches that had nothing to
  // borrow while it was gone.
  chinaRecostBorrowers(ss, username, [batchId]);

  Logger.log('Заказы в Китае: партия ' + batchId + ' восстановлена из архива пользователем ' + (username || '—'));
  return { batchId: batchId, reKeyed: reKeyed };
}

/**
 * Item 81g-3: the owner's own mark that the Russian-side costs of a batch are complete — text
 * and numbers here always differ from batch to batch, so only the owner can say when nothing
 * more is coming. Column 'Расходы РФ внесены'; feeds straight into `missing`/`closed` on recost.
 */
function setChinaRubCostsDone(data, username) {
  const batchId = String((data || {}).batchId || '').trim();
  if (!batchId) throw new Error('Не указана партия');
  const done = !!(data || {}).done;
  const ss = chinaSpreadsheet();
  const ctx = chinaReadSheet(ss, CHINA_BATCHES_SHEET, CHINA_BATCH_HEADERS);
  let targetRow = 0;
  ctx.rows.forEach(function (r) { if (String(r['ID']).trim() === batchId) targetRow = r.__row; });
  if (!targetRow) throw new Error('Партия ' + batchId + ' не найдена');
  const col = ctx.headers.indexOf('Расходы РФ внесены') + 1;
  ctx.sheet.getRange(targetRow, col, 1, 1).setValues([[done ? 'да' : '']]);
  recalcChinaBatch(ss, batchId, username);
  chinaRecostBorrowers(ss, username, [batchId]);
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
  chinaRecostBorrowers(ss, username, [batchId]);
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
  let targetRow = 0, previousOrder = '', previousRecord = null;
  ctx.rows.forEach(function (r) {
    if (String(r['ID']).trim() === requested) {
      targetRow = r.__row;
      previousOrder = String(r['Номер заказа'] || '').trim();
      previousRecord = r;
    }
  });
  if (requested && !targetRow) throw new Error('Оплата ' + requested + ' не найдена');
  const isNew = !targetRow;

  const values = {
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
  };
  // Item 81g-2: a brand new payment starts «не распределена» — an EDIT of an existing one
  // leaves the matching columns exactly as the previous-row merge below finds them (money is
  // matched/unmatched through matchChinaPayment/unmatchChinaPayment, never through a plain save).
  if (isNew) values['Статус'] = 'не распределена';
  const merged = previousRecord ? Object.assign({}, chinaStripRow(previousRecord), values) : values;
  const row = chinaRowFrom(ctx.headers, merged);
  if (targetRow > 0) {
    ctx.sheet.getRange(targetRow, 1, 1, ctx.headers.length).setValues([row]);
  } else {
    ctx.sheet.appendRow(row);
  }

  // An edit can move a payment from one order to another, and BOTH change their rate. This is
  // the OLD orderNo-driven rate path (81a/81d), left untouched for the sheet's old rows — 81g-2
  // payments no longer set orderNo, so it simply finds nothing to do for them.
  recalcChinaOrders(ss, [orderNo, previousOrder], username);
  // Item 81g-2: a freshly created payment tries to auto-match itself against the report's
  // receipts right away — an edit does not re-run matching (the owner uses match/unmatch for
  // that explicitly).
  if (isNew) chinaAutoMatchPending(ss, username);
  // Item 81g-3: any payment write can move a rate somewhere in the ledger — every batch is
  // re-costed, not just the ones the old orderNo path touched.
  chinaRecostAll(ss, username);
  return getChinaBatches();
}

function deleteChinaPayment(data, username) {
  const id = String((data || {}).id || '').trim();
  if (!id) throw new Error('Не указана оплата для удаления');
  const ss = chinaSpreadsheet();
  const ctx = chinaReadSheet(ss, CHINA_PAYMENTS_SHEET, CHINA_PAYMENT_HEADERS);
  let targetRow = 0, orderNo = '', status = '';
  ctx.rows.forEach(function (r) {
    if (String(r['ID']).trim() === id) {
      targetRow = r.__row;
      orderNo = String(r['Номер заказа'] || '').trim();
      status = String(r['Статус'] || '').trim();
    }
  });
  if (!targetRow) throw new Error('Оплата ' + id + ' не найдена');
  // Item 81g-2: a matched payment unmatches first — the receipt it was tied to must go back to
  // waiting for a payment, not vanish along with the payment row.
  if (status === CHINA_PAYMENT_ALLOCATED) chinaUnmatchInternal(ss, id, username);
  ctx.sheet.deleteRow(targetRow);
  recalcChinaOrders(ss, [orderNo], username);
  chinaRecostAll(ss, username);
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
  const recalced = [];
  batches.forEach(function (b) {
    if (wanted[String(b.orderNo || '').trim()]) { recalcChinaBatch(ss, b.id, username); recalced.push(b.id); }
  });
  // A payment's rate can make or unmake a batch as a rate SOURCE for others — re-cost every
  // borrower that is not one of the batches just recalculated above.
  chinaRecostBorrowers(ss, username, recalced);
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
  if (batchId) {
    recalcChinaBatch(ss, batchId, username);
    chinaRecostBorrowers(ss, username, [batchId]);
  }
  return getChinaBatches();
}

// ================================================================================
// Item 81g-1: the Chinese financial report — ingestion and the goods pool allocation.
//
// The running account (货款结算) never states which transfer went to which order: it only
// gives each order a running «получено». A move between orders — or into an order that had no
// bill of its own — is visible only as the DIFFERENCE between two reports. saveChinaReport
// below turns that difference into a movement per order, and chinaAllocateGoodsLedger turns
// the whole HISTORY of movements into "which dated receipts actually fund this order today",
// recomputed from scratch every time so a receipt that gets matched to a payment later (81g-2)
// retroactively updates every order that ever touched it — nothing here is cached.
//
// Matching, freight, rates and "чего не хватает" are 81g-2/3; this stage only builds the
// ledger and the pure goods allocation they will read.
// ================================================================================

function chinaReportFromRow(r) {
  let parsed = {};
  try { parsed = JSON.parse(String(r['Данные (JSON)'] || '') || '{}'); } catch (e) { parsed = {}; }
  return {
    id: String(r['ID'] || '').trim(),
    loadedAt: String(r['Загружен'] || '').trim(),
    reportDate: chinaDateText(r['Дата отчёта'], 'Дата отчёта'),
    source: String(r['Источник'] || '').trim(),
    aiReason: String(r['Причина ИИ'] || '').trim(),
    user: String(r['Кто'] || '').trim(),
    orders: Array.isArray(parsed.orders) ? parsed.orders : [],
    // Coordinator review, 2026-09-25: the grouped receipts of the report are stored on it too
    // (not just in «Поступления») purely so a LATER upload of the same reportDate has something
    // to diff its own content against — see chinaReportCanonical/the same-date revision path.
    receipts: Array.isArray(parsed.receipts) ? parsed.receipts : [],
    freights: Array.isArray(parsed.freights) ? parsed.freights : [],
    carriedOverCny: Number(parsed.carriedOverCny) || 0,
    openingFreightUsd: Number(parsed.openingFreightUsd) || 0
  };
}

function chinaReceiptFromRow(r) {
  return {
    id: String(r['ID'] || '').trim(),
    date: chinaDateText(r['Дата'], 'Дата'),
    goodsCny: parseNumber(r['Товар ¥']),
    freightCny: parseNumber(r['Доставка ¥']),
    freightUsd: parseNumber(r['Доставка $']),
    cargoRate: parseNumber(r['Курс ¥/$']),
    totalCny: parseNumber(r['Всего ¥']),
    status: String(r['Статус'] || '').trim() || 'ждёт оплату',
    paymentId: String(r['ОплатаID'] || '').trim(),
    rubGoods: parseNumber(r['₽ товар']),
    rubFreight: parseNumber(r['₽ доставка']),
    reportId: String(r['Отчёт'] || '').trim(),
    // Owner, 2026-09-25: set only by setChinaReceiptHistory — see the header comment above.
    historyManual: String(r['История вручную'] || '').trim() === 'да'
  };
}

function chinaMovementFromRow(r) {
  return {
    reportId: String(r['Отчёт'] || '').trim(),
    reportDate: chinaDateText(r['Дата отчёта'], 'Дата отчёта'),
    orderNo: String(r['Номер заказа'] || '').trim(),
    deltaCny: parseNumber(r['Изменение ¥'])
  };
}

// A receipt dated before CHINA_TRACKING_START_DATE (the 结转 carry-over included, by
// construction of its sentinel date) is «история без курса» — the owner is not asked to rate
// money that arrived before he started tracking it. Everything from that date on starts life
// waiting for a payment.
function chinaReceiptStatus(dateText) {
  return String(dateText || '') < CHINA_TRACKING_START_DATE ? 'история' : 'ждёт оплату';
}

const CHINA_REPORT_SOURCES = ['скрипт', 'ИИ'];

// Validates the shape saveChinaReport needs BEFORE anything is written: a malformed report
// must change nothing, not leave the sheets half updated.
function chinaValidateReportPayload(data) {
  if (!data || typeof data !== 'object') throw new Error('Некорректные данные отчёта');
  const reportDate = chinaDateText(data.reportDate, 'Дата отчёта');
  if (!reportDate) throw new Error('Не указана дата отчёта');
  const source = String(data.source || '').trim();
  if (CHINA_REPORT_SOURCES.indexOf(source) === -1) {
    throw new Error('Неизвестный источник отчёта: ' + source);
  }
  const orders = Array.isArray(data.orders) ? data.orders : [];
  orders.forEach(function (o, i) {
    if (!String((o || {}).orderNo || '').trim()) {
      throw new Error('В отчёте, заказ ' + (i + 1) + ': не указан номер заказа');
    }
  });
  const receipts = Array.isArray(data.receipts) ? data.receipts : [];
  const seenDates = {};
  receipts.forEach(function (r, i) {
    const d = chinaDateText((r || {}).date, 'Дата поступления');
    if (!d) throw new Error('В отчёте, поступление ' + (i + 1) + ': не указана дата');
    if (seenDates[d]) throw new Error('В отчёте два поступления на одну дату ' + d);
    seenDates[d] = true;
  });
  return { reportDate: reportDate, source: source, receipts: receipts };
}

/**
 * Coordinator review, 2026-09-25: same reportDate does NOT mean "identical report" — the
 * Chinese side can move money between orders with no new transfer at all, and the owner's own
 * next upload of the SAME date then carries different order totals. "Identical → no-op" has to
 * compare CONTENT, not the date. Canonicalizes the parts that matter (orders' own money fields,
 * the receipts as grouped, the freight bills, the two lump sums) into one sorted, rounded JSON
 * string so two payloads that differ only in array order or float noise still compare equal.
 */
function chinaReportCanonical(orders, receipts, freights, carriedOverCny, openingFreightUsd) {
  const o = (orders || []).map(function (x) {
    const v = x || {};
    return {
      orderNo: String(v.orderNo || '').trim(),
      receivedCny: roundToTwo(parseNumber(v.receivedCny)),
      totalCny: roundToTwo(parseNumber(v.totalCny)),
      depositCny: roundToTwo(parseNumber(v.depositCny)),
      unpaidCny: roundToTwo(parseNumber(v.unpaidCny))
    };
  }).sort(function (a, b) { return a.orderNo.localeCompare(b.orderNo); });
  const r = (receipts || []).map(function (x) {
    const v = x || {};
    return {
      date: chinaDateText(v.date, 'Дата поступления'),
      goodsCny: roundToTwo(parseNumber(v.goodsCny)),
      freightCny: roundToTwo(parseNumber(v.freightCny)),
      freightUsd: roundToTwo(parseNumber(v.freightUsd)),
      cargoRate: parseNumber(v.cargoRate)
    };
  }).sort(function (a, b) { return a.date.localeCompare(b.date); });
  const f = (freights || []).map(function (x) {
    const v = x || {};
    return {
      code: String(v.code || '').trim(), orderNo: String(v.orderNo || '').trim(),
      shippedAt: String(v.shippedAt || '').trim(), arrivedAt: String(v.arrivedAt || '').trim(),
      ratePerKgUsd: parseNumber(v.ratePerKgUsd), volumeM3: parseNumber(v.volumeM3),
      weightKg: parseNumber(v.weightKg), amountUsd: roundToTwo(parseNumber(v.amountUsd)),
      cargoRate: parseNumber(v.cargoRate)
    };
  }).sort(function (a, b) { return a.code.localeCompare(b.code); });
  return JSON.stringify({
    orders: o, receipts: r, freights: f,
    carriedOverCny: roundToTwo(parseNumber(carriedOverCny)), openingFreightUsd: parseNumber(openingFreightUsd)
  });
}

// Keeps only the 3 newest report rows by «Дата отчёта» (owner, 2026-09-24: "keep only the last
// 2–3 reports"). Deletes bottom-up by row number so an earlier delete never shifts the row
// number of one still to be removed.
function chinaPruneReports(ss) {
  const ctx = chinaReadSheet(ss, CHINA_REPORTS_SHEET, CHINA_REPORT_HEADERS);
  const sorted = ctx.rows.slice().sort(function (a, b) {
    return String(b['Дата отчёта']).localeCompare(String(a['Дата отчёта']));
  });
  sorted.slice(3)
    .map(function (r) { return r.__row; })
    .sort(function (a, b) { return b - a; })
    .forEach(function (row) { ctx.sheet.deleteRow(row); });
}

// ---------------------------------------------------------------- the pure goods allocation

// The total ¥ of a list of {receiptId, cny} lots, rounded to the kopeck as it accumulates so
// many small additions never drift.
function chinaLotsTotal(lots) {
  let sum = 0;
  (lots || []).forEach(function (l) { sum = roundToTwo(sum + (Number(l.cny) || 0)); });
  return sum;
}

// Collapses repeated receiptIds into one lot each and drops anything left at a fraction of a
// kopeck — otherwise dust from rounding would accumulate into an ever-growing lot list across
// many reports.
function chinaMergeLots(lots) {
  const byId = {};
  const order = [];
  (lots || []).forEach(function (l) {
    const id = l.receiptId;
    if (!(id in byId)) { byId[id] = 0; order.push(id); }
    byId[id] = roundToTwo(byId[id] + (Number(l.cny) || 0));
  });
  return order
    .map(function (id) { return { receiptId: id, cny: byId[id] }; })
    .filter(function (l) { return Math.abs(l.cny) >= 0.005; });
}

/**
 * Takes `amount` ¥ out of `lots` proportionally to each lot's own share (rounding remainder on
 * the largest lot — the same rule chinaAllocate uses elsewhere in this file), so an order that
 * releases part of its money into the pool, or takes part of the pool, does so "at its/the
 * pool's current AVERAGE composition" exactly as the owner asked. When `lots` do not hold
 * enough, everything they have is taken and the difference comes back as `shortfall` instead of
 * being silently understated — the caller turns it into an 'UNKNOWN' lot plus a warning.
 */
function chinaSplitLots(lots, amount) {
  const merged = chinaMergeLots(lots);
  const total = chinaLotsTotal(merged);
  const want = roundToTwo(Number(amount) || 0);
  if (want <= 0 || merged.length === 0) {
    return { taken: [], remaining: merged, shortfall: want > 0 ? want : 0 };
  }
  const take = Math.min(want, total);
  const bases = merged.map(function (l) { return l.cny; });
  const shares = chinaAllocate(take, bases);
  const taken = [], remaining = [];
  merged.forEach(function (l, i) {
    if (shares[i] > 0) taken.push({ receiptId: l.receiptId, cny: shares[i] });
    const left = roundToTwo(l.cny - shares[i]);
    if (left >= 0.005) remaining.push({ receiptId: l.receiptId, cny: left });
  });
  return { taken: taken, remaining: remaining, shortfall: roundToTwo(want - take) };
}

/**
 * Takes `amount` ¥ out of `lots` STRICTLY IN THE ORDER GIVEN — the front lot is used up before
 * the next one is touched at all. This is the baseline's own rule ("orders … take their
 * receivedCny FIFO from the receipts in date order"), and is deliberately a DIFFERENT function
 * from chinaSplitLots: the baseline consumes a dated queue in sequence, while a later report's
 * pool release/take spreads at the pool's/order's AVERAGE composition (chinaSplitLots) — using
 * the wrong one for either would either scatter a baseline order over every receipt in the
 * batch, or make a pool release ignore its own composition.
 */
function chinaTakeFifo(lots, amount) {
  const queue = (lots || []).map(function (l) { return { receiptId: l.receiptId, cny: Number(l.cny) || 0 }; });
  let remaining = roundToTwo(Number(amount) || 0);
  const taken = [];
  let i = 0;
  while (remaining > 0.004 && i < queue.length) {
    const lot = queue[i];
    if (lot.cny <= 0.004) { i++; continue; }
    const take = roundToTwo(Math.min(lot.cny, remaining));
    taken.push({ receiptId: lot.receiptId, cny: take });
    lot.cny = roundToTwo(lot.cny - take);
    remaining = roundToTwo(remaining - take);
    if (lot.cny <= 0.004) i++;
  }
  return {
    taken: chinaMergeLots(taken),
    remaining: queue.slice(i).filter(function (l) { return Math.abs(l.cny) >= 0.005; }),
    shortfall: remaining > 0.004 ? remaining : 0
  };
}

function chinaReceiptStatusBucket(status) {
  if (status === 'история') return 'historyCny';
  if (status === 'сопоставлено') return 'knownCny';
  return 'pendingCny'; // 'ждёт оплату', or a status this stage does not know about
}

// Sums a lot list into known/pending/history/unknown ¥ by each lot's receipt's CURRENT status —
// looked up fresh every call, which is exactly why a receipt matched later moves every order
// that holds a lot of it without anything here needing to change.
function chinaLotsSummary(lots, receiptsById) {
  const out = { knownCny: 0, pendingCny: 0, historyCny: 0, unknownCny: 0 };
  (lots || []).forEach(function (l) {
    const cny = Number(l.cny) || 0;
    if (l.receiptId === 'UNKNOWN') { out.unknownCny = roundToTwo(out.unknownCny + cny); return; }
    const r = receiptsById[l.receiptId];
    const bucket = r ? chinaReceiptStatusBucket(r.status) : 'pendingCny';
    out[bucket] = roundToTwo(out[bucket] + cny);
  });
  return out;
}

/**
 * Which receipts fund which order, recomputed from scratch every time — pure, no sheet access.
 *
 * `reports` — every stored report: {id, reportDate, orders: [{orderNo, date, receivedCny, ...}]}.
 *             Sorted here by reportDate; the caller may hand them in any order.
 * `receipts` — every stored receipt: {id, date, goodsCny, status, reportId}. `reportId` is the
 *             id of the report that FIRST introduced it — a receipt whose report has since been
 *             pruned away (chinaPruneReports keeps only 3) is treated as introduced by the
 *             OLDEST report still given here, so nothing is lost when history is trimmed.
 *
 * Algorithm (owner, 2026-09-24): the OLDEST report is the baseline — orders sorted by (order
 * date, order number) take their receivedCny FIFO from the receipts that report introduces, in
 * date order. Every later report: every order with a negative Δ releases |Δ| from its OWN lots
 * into the pool first (at its own current composition); the receipts that report introduces
 * join the pool next; then every order with a positive Δ takes from the pool (at the pool's
 * current composition). A pool too small to satisfy a positive Δ is a genuine mismatch between
 * the two Chinese sheets — capped, reported as a warning, and the shortfall is kept as an
 * 'UNKNOWN' lot so an order's composition still adds up to its own receivedCny.
 *
 * Returns { orders: { [orderNo]: { lots, knownCny, pendingCny, historyCny, unknownCny,
 * totalCny } }, pool: { lots, knownCny, pendingCny, historyCny, unknownCny, totalCny },
 * warnings: string[] } — see the ChinaOrders.gs comment block above this section for how
 * 81g-2/3 are meant to consume it (matching turns a lot's receipt status into 'сопоставлено',
 * which this function picks up on its very next call; freight is a separate FIFO walk this
 * function does not touch).
 */
function chinaAllocateGoodsLedger(reports, receipts) {
  const receiptsById = {};
  (receipts || []).forEach(function (r) { receiptsById[r.id] = r; });

  const sortedReports = (reports || []).slice().sort(function (a, b) {
    return String(a.reportDate).localeCompare(String(b.reportDate));
  });
  const keptIds = {};
  sortedReports.forEach(function (r) { keptIds[r.id] = true; });

  const byReport = {};
  (receipts || []).forEach(function (r) {
    let key = r.reportId || '';
    // Orphaned by pruning (or never tagged) — treated as introduced at the very start, so a
    // trimmed history never drops a receipt out of the simulation entirely.
    if (!keptIds[key]) key = sortedReports.length ? sortedReports[0].id : key;
    if (!byReport[key]) byReport[key] = [];
    byReport[key].push(r);
  });
  Object.keys(byReport).forEach(function (key) {
    byReport[key].sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); });
  });

  const orders = {};
  let pool = [];
  const warnings = [];
  let previousByOrder = {};

  sortedReports.forEach(function (report, reportIndex) {
    const introduced = (byReport[report.id] || []).map(function (r) {
      return { receiptId: r.id, cny: Number(r.goodsCny) || 0 };
    });
    const list = Array.isArray(report.orders) ? report.orders : [];

    if (reportIndex === 0) {
      const sortedOrders = list.slice().sort(function (a, b) {
        const d = String(a.date || '').localeCompare(String(b.date || ''));
        return d !== 0 ? d : String(a.orderNo || '').localeCompare(String(b.orderNo || ''));
      });
      let queue = introduced.slice();
      sortedOrders.forEach(function (o) {
        const orderNo = String(o.orderNo || '').trim();
        if (!orderNo) return;
        const want = Number(o.receivedCny) || 0;
        const split = chinaTakeFifo(queue, want);
        queue = split.remaining;
        const lots = split.taken.slice();
        if (split.shortfall > 0.004) {
          lots.push({ receiptId: 'UNKNOWN', cny: split.shortfall });
          warnings.push('Заказ ' + orderNo + ': не хватает ' + split.shortfall +
            ' ¥ поступлений на первый отчёт (' + report.reportDate + ')');
        }
        orders[orderNo] = { lots: chinaMergeLots(lots), totalCny: roundToTwo(want) };
      });
      // Whatever this report's receipts nobody claimed stays in the pool from day one.
      pool = queue;
    } else {
      const deltas = {};
      list.forEach(function (o) {
        const orderNo = String(o.orderNo || '').trim();
        if (!orderNo) return;
        const before = Number(previousByOrder[orderNo]) || 0;
        deltas[orderNo] = roundToTwo((Number(o.receivedCny) || 0) - before);
      });

      // Releases first: "money left order 29" happens before "money joined order 30" in the
      // owner's own reading of a move between orders.
      Object.keys(deltas).forEach(function (orderNo) {
        const delta = deltas[orderNo];
        if (delta >= -0.004) return;
        const current = orders[orderNo] || { lots: [], totalCny: 0 };
        const split = chinaSplitLots(current.lots, -delta);
        orders[orderNo] = { lots: split.remaining, totalCny: roundToTwo(current.totalCny + delta) };
        pool = chinaMergeLots(pool.concat(split.taken));
        if (split.shortfall > 0.004) {
          // The order's own lots ran out before covering the whole release — nothing left to
          // give the pool; can only happen if the order's composition was already short.
          warnings.push('Заказ ' + orderNo + ': уменьшение по отчёту от ' + report.reportDate +
            ' больше известного состава на ' + split.shortfall + ' ¥');
        }
      });

      pool = chinaMergeLots(pool.concat(introduced));

      Object.keys(deltas).forEach(function (orderNo) {
        const delta = deltas[orderNo];
        if (delta <= 0.004) return;
        const current = orders[orderNo] || { lots: [], totalCny: 0 };
        const split = chinaSplitLots(pool, delta);
        pool = split.remaining;
        const lots = split.taken.slice();
        if (split.shortfall > 0.004) {
          lots.push({ receiptId: 'UNKNOWN', cny: split.shortfall });
          warnings.push('Заказ ' + orderNo + ': не хватает ' + split.shortfall +
            ' ¥ в общем остатке поступлений по отчёту от ' + report.reportDate);
        }
        orders[orderNo] = { lots: chinaMergeLots(current.lots.concat(lots)), totalCny: roundToTwo(current.totalCny + delta) };
      });

      // An order the report mentions with Δ = 0 (or that had never been seen before, with a
      // zero receivedCny) keeps its lots untouched and simply gets a record if it had none.
      list.forEach(function (o) {
        const orderNo = String(o.orderNo || '').trim();
        if (!orderNo || deltas[orderNo] !== 0) return;
        if (!orders[orderNo]) orders[orderNo] = { lots: [], totalCny: roundToTwo(Number(o.receivedCny) || 0) };
      });
    }

    previousByOrder = {};
    list.forEach(function (o) {
      const orderNo = String(o.orderNo || '').trim();
      if (orderNo) previousByOrder[orderNo] = Number(o.receivedCny) || 0;
    });
  });

  const out = { orders: {}, pool: null, warnings: warnings };
  Object.keys(orders).forEach(function (orderNo) {
    const o = orders[orderNo];
    const summary = chinaLotsSummary(o.lots, receiptsById);
    out.orders[orderNo] = {
      lots: o.lots,
      knownCny: summary.knownCny,
      pendingCny: summary.pendingCny,
      historyCny: summary.historyCny,
      unknownCny: summary.unknownCny,
      totalCny: o.totalCny
    };
  });
  const poolSummary = chinaLotsSummary(pool, receiptsById);
  out.pool = {
    lots: pool,
    knownCny: poolSummary.knownCny,
    pendingCny: poolSummary.pendingCny,
    historyCny: poolSummary.historyCny,
    unknownCny: poolSummary.unknownCny,
    totalCny: chinaLotsTotal(pool)
  };
  return out;
}

// ---------------------------------------------------------------- ingestion

/**
 * Item 81g-1: stores one uploaded report — refusing one older than what is already saved,
 * doing nothing for one identical to the newest (same reportDate — the owner only ever
 * uploads one report per date) — then upserts «Поступления» by date (a changed amount on a
 * known date updates it and is reported as a warning), records each order's movement against
 * the PREVIOUS newest report (baseline = 0 for the very first report, and for any order missing
 * before), prunes «Отчёты» to the 3 newest, and finally runs the pure goods allocation for its
 * conservation warnings. Matching, freight and re-costing every batch are 81g-2/3 — this stage
 * returns getChinaBatches() unchanged, plus the warnings.
 */
function saveChinaReport(data, username) {
  const parsed = chinaValidateReportPayload(data);
  const ss = chinaSpreadsheet();

  const reportCtx = chinaReadSheet(ss, CHINA_REPORTS_SHEET, CHINA_REPORT_HEADERS);
  const existingReports = reportCtx.rows.map(chinaReportFromRow);
  let newest = null;
  existingReports.forEach(function (r) { if (!newest || r.reportDate > newest.reportDate) newest = r; });

  if (newest && parsed.reportDate < newest.reportDate) {
    throw new Error('Отчёт от ' + parsed.reportDate + ' старше уже сохранённого отчёта от ' + newest.reportDate);
  }

  const orders = Array.isArray(data.orders) ? data.orders : [];
  const freights = Array.isArray(data.freights) ? data.freights : [];
  const carriedOverCnyRaw = roundToTwo(parseNumber(data.carriedOverCny));
  const openingFreightUsdRaw = parseNumber(data.openingFreightUsd);

  // Same reportDate as the newest stored report: could be the SAME upload repeated, or a
  // correction of the same day (the owner's own case — money moved between orders with no new
  // transfer, so the file for that date changes without its date changing). Only true content
  // equality is a no-op; anything else replaces the existing row of that date in place.
  const isRevision = !!(newest && parsed.reportDate === newest.reportDate);
  if (isRevision) {
    const same = chinaReportCanonical(orders, parsed.receipts, freights, carriedOverCnyRaw, openingFreightUsdRaw) ===
      chinaReportCanonical(newest.orders, newest.receipts, newest.freights, newest.carriedOverCny, newest.openingFreightUsd);
    if (same) return Object.assign(getChinaBatches(), { warnings: [] });
  }

  // Movements are the difference against whatever the LAST SAVED state was: for an ordinary
  // new report that is `newest` (an earlier date) itself; for a same-date revision it is still
  // `newest` — the PRE-revision content of the very row being replaced — so a revision that only
  // moves money between orders (no new transfer at all) still produces exactly that Δ, not a
  // fresh baseline for every order.
  const warnings = [];
  const reportId = isRevision ? newest.id : chinaNextId(reportCtx.rows, 'CR');
  if (isRevision) {
    // The movement rows the ORIGINAL upload of this date wrote are stale — the revision
    // recomputes its own Δ below and replaces them, not adds to them.
    const staleMovements = chinaReadSheet(ss, CHINA_MOVEMENTS_SHEET, CHINA_MOVEMENT_HEADERS);
    const kept = staleMovements.rows
      .filter(function (r) { return String(r['Отчёт']).trim() !== reportId; })
      .map(function (r) { return chinaRowFrom(staleMovements.headers, r); });
    chinaWriteSheet(staleMovements.sheet, staleMovements.headers, kept);
  }

  const incomingReceipts = parsed.receipts.map(function (r) {
    return {
      date: chinaDateText(r.date, 'Дата поступления'),
      goodsCny: roundToTwo(parseNumber(r.goodsCny)),
      freightCny: roundToTwo(parseNumber(r.freightCny)),
      freightUsd: roundToTwo(parseNumber(r.freightUsd)),
      cargoRate: parseNumber(r.cargoRate)
    };
  });
  if (carriedOverCnyRaw > 0) {
    incomingReceipts.push({
      date: CHINA_CARRYOVER_RECEIPT_DATE, goodsCny: carriedOverCnyRaw, freightCny: 0, freightUsd: 0, cargoRate: 0
    });
  }

  const receiptCtx = chinaReadSheet(ss, CHINA_RECEIPTS_SHEET, CHINA_RECEIPT_HEADERS);
  const byDate = {};
  receiptCtx.rows.forEach(function (r) { byDate[chinaDateText(r['Дата'], 'Дата')] = r; });

  const freshCount = incomingReceipts.filter(function (r) { return !byDate[r.date]; }).length;
  const freshIds = chinaNextIds(receiptCtx.rows, 'CG', freshCount);
  let freshIndex = 0;

  incomingReceipts.forEach(function (r) {
    const totalCny = roundToTwo(r.goodsCny + r.freightCny);
    const existingRow = byDate[r.date];
    if (existingRow) {
      const previousTotal = parseNumber(existingRow['Всего ¥']);
      if (Math.abs(previousTotal - totalCny) > 0.004) {
        warnings.push('Поступление за ' + r.date + ' изменилось: было ' + previousTotal +
          ' ¥, стало ' + totalCny + ' ¥');
        const row = chinaRowFrom(receiptCtx.headers, Object.assign({}, chinaStripRow(existingRow), {
          'Товар ¥': r.goodsCny, 'Доставка ¥': r.freightCny, 'Доставка $': r.freightUsd,
          'Курс ¥/$': r.cargoRate, 'Всего ¥': totalCny
        }));
        receiptCtx.sheet.getRange(existingRow.__row, 1, 1, receiptCtx.headers.length).setValues([row]);
      }
      return; // already known — not "introduced" by THIS report
    }
    const id = freshIds[freshIndex++];
    receiptCtx.sheet.appendRow(chinaRowFrom(receiptCtx.headers, {
      'ID': id, 'Дата': r.date, 'Товар ¥': r.goodsCny, 'Доставка ¥': r.freightCny,
      'Доставка $': r.freightUsd, 'Курс ¥/$': r.cargoRate, 'Всего ¥': totalCny,
      'Статус': chinaReceiptStatus(r.date), 'ОплатаID': '', '₽ товар': '', '₽ доставка': '',
      'Отчёт': reportId
    }));
  });

  const movementCtx = chinaReadSheet(ss, CHINA_MOVEMENTS_SHEET, CHINA_MOVEMENT_HEADERS);
  const previousByOrder = {};
  if (newest) {
    (newest.orders || []).forEach(function (o) {
      const orderNo = String(o.orderNo || '').trim();
      if (orderNo) previousByOrder[orderNo] = Number(o.receivedCny) || 0;
    });
  }
  orders.forEach(function (o) {
    const orderNo = String(o.orderNo || '').trim();
    if (!orderNo) return;
    const delta = roundToTwo((Number(o.receivedCny) || 0) - (previousByOrder[orderNo] || 0));
    if (Math.abs(delta) < 0.005) return;
    movementCtx.sheet.appendRow(chinaRowFrom(movementCtx.headers, {
      'Отчёт': reportId, 'Дата отчёта': parsed.reportDate, 'Номер заказа': orderNo, 'Изменение ¥': delta
    }));
  });

  const reportRow = chinaRowFrom(reportCtx.headers, {
    'ID': reportId, 'Загружен': chinaStamp(), 'Дата отчёта': parsed.reportDate,
    'Источник': parsed.source, 'Причина ИИ': String(data.aiReason || '').trim(),
    'Данные (JSON)': JSON.stringify({
      orders: orders, receipts: parsed.receipts, freights: freights,
      carriedOverCny: carriedOverCnyRaw, openingFreightUsd: openingFreightUsdRaw
    }),
    'Кто': username || ''
  });
  if (isRevision) {
    // Same date, different content: this REPLACES the existing row for that date rather than
    // adding a second row with a duplicate reportDate. chinaReportFromRow strips `__row`, so the
    // row number comes from the sheet's OWN raw rows, not from the parsed `newest`.
    let newestRow = 0;
    reportCtx.rows.forEach(function (r) { if (String(r['ID']).trim() === newest.id) newestRow = r.__row; });
    reportCtx.sheet.getRange(newestRow, 1, 1, reportCtx.headers.length).setValues([reportRow]);
  } else {
    reportCtx.sheet.appendRow(reportRow);
  }
  chinaPruneReports(ss);

  // Item 81g-2: new receipts can turn an old orphan payment into an exact match — tried on
  // every report, not just on saving a payment.
  chinaAutoMatchPending(ss, username);
  // Item 81g-3: the report itself is the ledger every batch's rate is resolved against —
  // every batch is re-costed, not just the ones whose OWN order/bill changed.
  chinaRecostAll(ss, username);

  const allReports = chinaReadSheet(ss, CHINA_REPORTS_SHEET, CHINA_REPORT_HEADERS).rows.map(chinaReportFromRow);
  const allReceipts = chinaReadSheet(ss, CHINA_RECEIPTS_SHEET, CHINA_RECEIPT_HEADERS).rows.map(chinaReceiptFromRow);
  const allocation = chinaAllocateGoodsLedger(allReports, allReceipts);
  warnings.push.apply(warnings, allocation.warnings);

  return Object.assign(getChinaBatches(), { warnings: warnings });
}

// ================================================================================
// Item 81g-2: payment matching, the freight FIFO, and getChinaMoney().
//
// A payment is now matched to a dated RECEIPT (81g-1's «Поступления»), not typed against an
// order — the running account never says which order a transfer went to, only the report's
// movements do (chinaAllocateGoodsLedger already reads those). Matching only decides WHOSE
// money a receipt's ¥ actually is (in rubles); which ORDER that ¥ belongs to is a separate
// question the goods pool allocation already answers, independently, from the report alone.
// ================================================================================

// Adds `days` calendar days to a 'yyyy-MM-dd' string, in UTC only — the module has already been
// bitten once by timezone-dependent date arithmetic (item 81e's off-by-one), so this never
// touches the local Date constructor for anything but reading out UTC fields.
function chinaAddDaysText(dateText, days) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateText || ''));
  if (!m) return String(dateText || '');
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  d.setUTCDate(d.getUTCDate() + (Number(days) || 0));
  const pad = function (n) { return (n < 10 ? '0' : '') + n; };
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
}

/**
 * Which receipts a payment COULD be matched to, per the contract's own rule: the receipt's date
 * falls in [payment date, +3 days], the receipt is not already matched to another payment, and
 * the ¥ the payment's rubles imply (amountRub / rate) is within max(1, 1 %) of the receipt's
 * total ¥. Pure — `receipts` is any list of {id, date, goodsCny, freightCny, status}.
 */
function chinaPaymentCandidates(payment, receipts) {
  const amountRub = Number((payment || {}).amountRub) || 0;
  const rate = Number((payment || {}).rate) || 0;
  if (!(amountRub > 0) || !(rate > 0)) return [];
  const impliedCny = amountRub / rate;
  const from = String((payment || {}).date || '');
  const to = chinaAddDaysText(from, 3);
  return (receipts || []).filter(function (r) {
    if (String(r.status || '').trim() === 'сопоставлено') return false;
    const d = String(r.date || '');
    if (!from || d < from || d > to) return false;
    const total = roundToTwo((Number(r.goodsCny) || 0) + (Number(r.freightCny) || 0));
    if (!(total > 0)) return false;
    const tolerance = Math.max(1, total * 0.01);
    return Math.abs(impliedCny - total) <= tolerance;
  }).map(function (r) { return r.id; });
}

/**
 * Actually ties one payment to one receipt: the ACTUAL ₽/¥ rate is amountRub / receipt total ¥
 * (may differ a little from the typed rate — that slack is exactly what the tolerance above
 * allows for), and the ₽ splits goods/freight EXACTLY (rubFreight is the remainder, not a second
 * multiplication, so the two always sum to amountRub whatever the rounding of rubGoods did).
 * Refuses a payment or receipt that is already matched — unmatch first (owner's own order of
 * events, same rule the rest of this module already follows for a payment/order tie).
 */
function chinaMatchInternal(ss, paymentId, receiptId, username) {
  const payCtx = chinaReadSheet(ss, CHINA_PAYMENTS_SHEET, CHINA_PAYMENT_HEADERS);
  let payRow = null;
  payCtx.rows.forEach(function (r) { if (String(r['ID']).trim() === paymentId) payRow = r; });
  if (!payRow) throw new Error('Оплата ' + paymentId + ' не найдена');
  if (String(payRow['Статус'] || '').trim() === CHINA_PAYMENT_ALLOCATED) {
    throw new Error('Оплата ' + paymentId + ' уже сопоставлена — сначала отмените сопоставление');
  }

  const receiptCtx = chinaReadSheet(ss, CHINA_RECEIPTS_SHEET, CHINA_RECEIPT_HEADERS);
  let recRow = null;
  receiptCtx.rows.forEach(function (r) { if (String(r['ID']).trim() === receiptId) recRow = r; });
  if (!recRow) throw new Error('Поступление ' + receiptId + ' не найдено');
  if (String(recRow['Статус'] || '').trim() === 'сопоставлено') {
    throw new Error('Поступление ' + receiptId + ' уже сопоставлено с другой оплатой');
  }

  const amountRub = parseNumber(payRow['Сумма ₽']);
  const goodsCny = parseNumber(recRow['Товар ¥']);
  const freightCny = parseNumber(recRow['Доставка ¥']);
  const totalCny = roundToTwo(goodsCny + freightCny);
  if (!(totalCny > 0)) throw new Error('У поступления ' + receiptId + ' нулевая сумма — сопоставлять нечего');

  const actualRate = Math.round((amountRub / totalCny) * 10000) / 10000;
  const rubGoods = roundToTwo(amountRub * goodsCny / totalCny);
  const rubFreight = roundToTwo(amountRub - rubGoods);

  payCtx.sheet.getRange(payRow.__row, 1, 1, payCtx.headers.length).setValues([chinaRowFrom(payCtx.headers,
    Object.assign({}, chinaStripRow(payRow), {
      'Статус': CHINA_PAYMENT_ALLOCATED, 'ПоступлениеID': receiptId, 'Юани по отчёту': totalCny, 'Курс фактический': actualRate
    }))]);
  receiptCtx.sheet.getRange(recRow.__row, 1, 1, receiptCtx.headers.length).setValues([chinaRowFrom(receiptCtx.headers,
    Object.assign({}, chinaStripRow(recRow), {
      'Статус': 'сопоставлено', 'ОплатаID': paymentId, '₽ товар': rubGoods, '₽ доставка': rubFreight
    }))]);

  return { actualRate: actualRate, rubGoods: rubGoods, rubFreight: rubFreight };
}

// The other half: a receipt goes back to whatever status its OWN date implies (history/pending
// — never straight to 'сопоставлено' again, obviously), and the payment goes back to waiting.
function chinaUnmatchInternal(ss, paymentId, username) {
  const payCtx = chinaReadSheet(ss, CHINA_PAYMENTS_SHEET, CHINA_PAYMENT_HEADERS);
  let payRow = null;
  payCtx.rows.forEach(function (r) { if (String(r['ID']).trim() === paymentId) payRow = r; });
  if (!payRow) throw new Error('Оплата ' + paymentId + ' не найдена');
  const receiptId = String(payRow['ПоступлениеID'] || '').trim();

  payCtx.sheet.getRange(payRow.__row, 1, 1, payCtx.headers.length).setValues([chinaRowFrom(payCtx.headers,
    Object.assign({}, chinaStripRow(payRow), {
      'Статус': 'не распределена', 'ПоступлениеID': '', 'Юани по отчёту': '', 'Курс фактический': ''
    }))]);

  if (receiptId) {
    const receiptCtx = chinaReadSheet(ss, CHINA_RECEIPTS_SHEET, CHINA_RECEIPT_HEADERS);
    let recRow = null;
    receiptCtx.rows.forEach(function (r) { if (String(r['ID']).trim() === receiptId) recRow = r; });
    if (recRow) {
      const status = chinaReceiptStatus(chinaDateText(recRow['Дата'], 'Дата'));
      receiptCtx.sheet.getRange(recRow.__row, 1, 1, receiptCtx.headers.length).setValues([chinaRowFrom(receiptCtx.headers,
        Object.assign({}, chinaStripRow(recRow), { 'Статус': status, 'ОплатаID': '', '₽ товар': '', '₽ доставка': '' }))]);
    }
  }
  return { receiptId: receiptId };
}

function matchChinaPayment(data, username) {
  const paymentId = String((data || {}).paymentId || '').trim();
  const receiptId = String((data || {}).receiptId || '').trim();
  if (!paymentId || !receiptId) throw new Error('Не указаны оплата и поступление для сопоставления');
  const ss = chinaSpreadsheet();
  chinaMatchInternal(ss, paymentId, receiptId, username);
  chinaRecostAll(ss, username);
  return getChinaBatches();
}

function unmatchChinaPayment(data, username) {
  const paymentId = String((data || {}).paymentId || '').trim();
  if (!paymentId) throw new Error('Не указана оплата для отмены сопоставления');
  const ss = chinaSpreadsheet();
  chinaUnmatchInternal(ss, paymentId, username);
  chinaRecostAll(ss, username);
  return getChinaBatches();
}

/**
 * Owner, 2026-09-25 (live check): the report highlights EVERY 'ждёт оплату' receipt as
 * unpaid, which is right for a new one but wrong for the live 2026-08-04 receipt (4 819 ¥) —
 * that money is simply not going to be matched, and the owner marks it «история» by hand so the
 * highlight goes away for good. history=true sets 'История' AND the manual flag; history=false
 * puts it back to 'ждёт оплату' — but only for a receipt dated in the tracked era (before that,
 * 'история' is the DATE's own status, not something to undo). Either direction is refused on a
 * receipt already 'сопоставлено' — a matched receipt has real money behind it, marking it history
 * would hide that from the ledger. Every batch is re-costed afterwards: the receipt's status
 * bucket (chinaReceiptStatusBucket) feeds straight into the goods/freight ledgers a batch's rate
 * is resolved against.
 */
function setChinaReceiptHistory(data, username) {
  const receiptId = String((data || {}).receiptId || '').trim();
  if (!receiptId) throw new Error('Не указано поступление');
  const history = !!(data || {}).history;
  const ss = chinaSpreadsheet();
  const ctx = chinaReadSheet(ss, CHINA_RECEIPTS_SHEET, CHINA_RECEIPT_HEADERS);
  let row = null;
  ctx.rows.forEach(function (r) { if (String(r['ID']).trim() === receiptId) row = r; });
  if (!row) throw new Error('Поступление ' + receiptId + ' не найдено');
  if (String(row['Статус'] || '').trim() === 'сопоставлено') {
    throw new Error('Поступление ' + receiptId + ' уже сопоставлено с оплатой — отметку «история» ставить незачем');
  }

  if (history) {
    ctx.sheet.getRange(row.__row, 1, 1, ctx.headers.length).setValues([chinaRowFrom(ctx.headers,
      Object.assign({}, chinaStripRow(row), { 'Статус': 'история', 'История вручную': 'да' }))]);
  } else {
    const date = chinaDateText(row['Дата'], 'Дата');
    if (date < CHINA_TRACKING_START_DATE) {
      throw new Error('Поступление от ' + date + ' раньше начала учёта (' + CHINA_TRACKING_START_DATE +
        ') — снять отметку «история» нельзя');
    }
    ctx.sheet.getRange(row.__row, 1, 1, ctx.headers.length).setValues([chinaRowFrom(ctx.headers,
      Object.assign({}, chinaStripRow(row), { 'Статус': 'ждёт оплату', 'История вручную': '' }))]);
  }

  chinaRecostAll(ss, username);
  return getChinaBatches();
}

/**
 * Auto-matches every payment that is not 'сопоставлено' yet: EXACTLY one candidate matches it,
 * several or none leave it pending — the contract's own rule. Runs after a new payment is saved
 * and after every saveChinaReport (new receipts can turn an old orphan payment into an exact
 * match). Processes payments in DATE order so an earlier payment claims a receipt before a
 * later one competing for the same date gets to look — `claimed` tracks that within one call,
 * since two matches in the same pass must never both grab the same receipt.
 */
function chinaAutoMatchPending(ss, username) {
  const receipts = chinaReadSheet(ss, CHINA_RECEIPTS_SHEET, CHINA_RECEIPT_HEADERS).rows.map(chinaReceiptFromRow);
  const claimed = {};
  receipts.forEach(function (r) { if (r.status === 'сопоставлено') claimed[r.id] = true; });

  const pending = chinaReadSheet(ss, CHINA_PAYMENTS_SHEET, CHINA_PAYMENT_HEADERS).rows
    .map(chinaPaymentFromRow)
    .filter(function (p) { return p.status !== CHINA_PAYMENT_ALLOCATED; })
    .sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); });

  pending.forEach(function (p) {
    const pool = receipts.filter(function (r) { return !claimed[r.id]; });
    const candidates = chinaPaymentCandidates(p, pool);
    if (candidates.length === 1) {
      chinaMatchInternal(ss, p.id, candidates[0], username);
      claimed[candidates[0]] = true;
    }
  });
}

// ---------------------------------------------------------------- the freight FIFO

/**
 * How much of each freight bill's ¥ is known (₽ traceable to a matched payment), pending (a
 * receipt exists but no payment yet) or history (before tracking / the opening balance). Same
 * FIFO consumption as the goods baseline (chinaTakeFifo) — bills of the newest report, IN THE
 * ORDER GIVEN (the contract's own words; unlike goods this is not claimed to be date order),
 * against the receipts' freight ¥ parts in date order. The opening balance (`openingFreightUsd`,
 * converted to ¥ at the FIRST bill's own carrier rate — documented here since the contract does
 * not say which bill's rate to use) is a synthetic lot at the very front, always «история»: a
 * balance from before tracking has no payment of its own to be known by, ever.
 *
 * Returns { bills: { [code]: { lots, knownCny, knownRub, knownRate, pendingCny, historyCny,
 * unknownCny, totalCny } }, warnings: string[] } — see the ChinaOrders.gs comment above this
 * section, and the report to the coordinator, for how 81g-3 is meant to read this.
 */
/**
 * Coordinator review, 2026-09-25: ROOT CAUSE of the first version — bills are billed in $, and
 * every freight payment ROW of the report credits its OWN explicit $ amount (the carrier's
 * notes divide different rows by DIFFERENT rates — "37491/7.25=5171", "2466*7=17262" — so there
 * is no single batch-wide cargo rate to convert through). The FIFO now runs in DOLLARS: bills
 * consume the receipts' own `freightUsd`, in the report's bill-list order against receipts in
 * DATE order — chinaTakeFifo/chinaMergeLots are reused as-is here to hold $ instead of ¥ (their
 * `.cny` field name is just a leftover of the goods use case, not a currency claim). A slice's ¥
 * (and, once its receipt is matched, ₽) is that receipt's OWN freight ¥/₽ pro rata to the $
 * share taken — never the bill's own $/¥ rate, which the receipt need not share at all.
 *
 * The opening balance's SIGN decides what it is (owner, 2026-09-25): negative = a CREDIT, an
 * extra payment made before any bill existed — always history, since there is no receipt to
 * match it to; positive = a DEBT, an unresolved bill from before tracking with no code of its
 * own, paid off FIRST, ahead of every real bill, from the very same $ queue.
 */
function chinaAllocateFreightLedger(freights, receipts, openingFreightUsd) {
  const receiptsById = {};
  (receipts || []).forEach(function (r) { receiptsById[r.id] = r; });
  receiptsById.OPENING = { id: 'OPENING', status: 'история' };

  const bills = (freights || []).filter(function (f) { return String((f || {}).code || '').trim(); });

  // The $ payment queue, in receipt DATE order.
  let queue = (receipts || []).slice()
    .sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); })
    .map(function (r) { return { receiptId: r.id, cny: Number(r.freightUsd) || 0 }; })
    .filter(function (l) { return l.cny > 0.004; });

  const openingUsd = Number(openingFreightUsd) || 0;
  let openingDebtUnpaidUsd = 0;
  if (openingUsd < -0.004) {
    queue.unshift({ receiptId: 'OPENING', cny: roundToTwo(-openingUsd) });
  } else if (openingUsd > 0.004) {
    const opening = chinaTakeFifo(queue, openingUsd);
    queue = opening.remaining;
    openingDebtUnpaidUsd = opening.shortfall;
  }

  const out = { bills: {}, openingDebtUnpaidUsd: openingDebtUnpaidUsd, warnings: [] };
  bills.forEach(function (bill) {
    const code = String(bill.code || '').trim();
    const wantUsd = roundToTwo(Number(bill.amountUsd) || 0);
    const split = chinaTakeFifo(queue, wantUsd);
    queue = split.remaining;

    let paidUsd = 0, knownCny = 0, knownRub = 0, pendingCny = 0, historyCny = 0;
    const slices = split.taken.map(function (s) {
      paidUsd = roundToTwo(paidUsd + s.cny);
      const r = receiptsById[s.receiptId];
      const freightUsd = r ? (Number(r.freightUsd) || 0) : 0;
      const freightCny = r ? (Number(r.freightCny) || 0) : 0;
      const sliceCny = freightUsd > 0.004 ? roundToTwo(freightCny * s.cny / freightUsd) : 0;
      const bucket = chinaReceiptStatusBucket(r ? r.status : '');
      if (bucket === 'historyCny') historyCny = roundToTwo(historyCny + sliceCny);
      else if (bucket === 'knownCny') {
        knownCny = roundToTwo(knownCny + sliceCny);
        const rubFreight = r ? (Number(r.rubFreight) || 0) : 0;
        if (rubFreight > 0.004 && freightCny > 0.004) {
          knownRub = roundToTwo(knownRub + roundToTwo(rubFreight * sliceCny / freightCny));
        }
      } else {
        pendingCny = roundToTwo(pendingCny + sliceCny);
      }
      return { receiptId: s.receiptId, usd: s.cny, cny: sliceCny };
    });
    if (split.shortfall > 0.004) {
      slices.push({ receiptId: 'UNKNOWN', usd: split.shortfall, cny: 0 });
      out.warnings.push('Накладная ' + code + ': не хватает ' + split.shortfall + ' $ платежей на перевозку');
    }

    out.bills[code] = {
      slices: slices,
      paidUsd: paidUsd, unpaidUsd: roundToTwo(wantUsd - paidUsd),
      knownCny: knownCny, knownRub: knownRub,
      knownRate: knownCny > 0.004 ? Math.round((knownRub / knownCny) * 10000) / 10000 : 0,
      pendingCny: pendingCny, historyCny: historyCny,
      totalUsd: wantUsd
    };
  });
  return out;
}

/**
 * The ₽ of the KNOWN portion of a lot list: each lot's ₽ = its receipt's own `rubField` × the
 * lot's ¥ ÷ the receipt's own `cnyField` (the coordinator's own rule, applied identically to
 * goods and freight) — rounded to the kopeck PER LOT, then summed. Sums may drift up to a kopeck
 * from the receipt's own stored ₽ when one receipt is split across several lots (each split
 * rounds independently) — the same rounding convention chinaAllocate/chinaSplitLots already use
 * everywhere else in this module, chosen over carrying fractional kopecks between lots. Only
 * 'сопоставлено' receipts contribute — an 'UNKNOWN'/'OPENING' lot, or one whose receipt has no
 * rubles yet, has nothing known to add.
 */
function chinaLotsKnownRub(lots, receiptsById, rubField, cnyField) {
  let sum = 0;
  (lots || []).forEach(function (l) {
    if (l.receiptId === 'UNKNOWN' || l.receiptId === 'OPENING') return;
    const r = receiptsById[l.receiptId];
    if (!r || r.status !== 'сопоставлено') return;
    const totalCny = Number(r[cnyField]) || 0;
    const rub = Number(r[rubField]) || 0;
    if (!(totalCny > 0) || !(rub > 0)) return;
    sum = roundToTwo(sum + roundToTwo(rub * (Number(l.cny) || 0) / totalCny));
  });
  return sum;
}

// ---------------------------------------------------------------- getChinaMoney()

/**
 * Item 81g-2's read: everything the browser needs to show payments, receipts, orders and the
 * pool — lock-free (see Code.gs) and uncached (see server.ts), same reasoning as getChinaBatches
 * before it. Recomputed from the ledger every call, same as chinaAllocateGoodsLedger itself.
 */
function getChinaMoney() {
  const ss = chinaSpreadsheet();
  const reports = chinaReadSheet(ss, CHINA_REPORTS_SHEET, CHINA_REPORT_HEADERS).rows.map(chinaReportFromRow);
  const receipts = chinaReadSheet(ss, CHINA_RECEIPTS_SHEET, CHINA_RECEIPT_HEADERS).rows.map(chinaReceiptFromRow);
  const payments = chinaReadSheet(ss, CHINA_PAYMENTS_SHEET, CHINA_PAYMENT_HEADERS).rows.map(chinaPaymentFromRow);

  const receiptsById = {};
  receipts.forEach(function (r) { receiptsById[r.id] = r; });

  const allocation = chinaAllocateGoodsLedger(reports, receipts);

  let newest = null;
  reports.forEach(function (r) { if (!newest || r.reportDate > newest.reportDate) newest = r; });
  const newestOrders = newest ? newest.orders : [];
  const newestFreights = newest ? newest.freights : [];
  const freightAlloc = chinaAllocateFreightLedger(newestFreights, receipts, newest ? newest.openingFreightUsd : 0);

  const billedOrders = {};
  newestFreights.forEach(function (f) {
    const o = String((f || {}).orderNo || '').trim();
    if (o) billedOrders[o] = true;
  });

  const orders = newestOrders.map(function (o) {
    const orderNo = String(o.orderNo || '').trim();
    const alloc = allocation.orders[orderNo] || { lots: [], knownCny: 0, pendingCny: 0, historyCny: 0, unknownCny: 0, totalCny: 0 };
    const knownRub = chinaLotsKnownRub(alloc.lots, receiptsById, 'rubGoods', 'goodsCny');
    const receivedCny = Number(o.receivedCny) || 0;
    const totalCny = Number(o.totalCny) || 0;
    return {
      orderNo: orderNo, date: String(o.date || ''), totalCny: totalCny, receivedCny: receivedCny,
      unpaidCny: Number(o.unpaidCny) || 0,
      knownCny: alloc.knownCny, knownRub: knownRub,
      rate: alloc.knownCny > 0 ? Math.round((knownRub / alloc.knownCny) * 10000) / 10000 : 0,
      pendingCny: alloc.pendingCny, historyCny: alloc.historyCny,
      // Owner, 2026-09-24: an advance must be at least 30 % of the goods — flagged only while
      // no carrier bill exists yet for the order (once billed, the freight side is what matters).
      advanceWarning: !billedOrders[orderNo] && totalCny > 0 && receivedCny < totalCny * 0.3
    };
  });

  const poolKnownRub = chinaLotsKnownRub(allocation.pool.lots, receiptsById, 'rubGoods', 'goodsCny');
  const pool = {
    cny: allocation.pool.totalCny, knownCny: allocation.pool.knownCny, knownRub: poolKnownRub,
    pendingCny: allocation.pool.pendingCny, historyCny: allocation.pool.historyCny
  };

  const unmatchedReceipts = receipts.filter(function (r) { return r.status !== 'сопоставлено'; });
  const paymentsOut = payments.map(function (p) {
    const candidates = p.status === CHINA_PAYMENT_ALLOCATED ? [] : chinaPaymentCandidates(p, unmatchedReceipts);
    return Object.assign({}, p, { candidates: candidates });
  });

  const receiptsOut = receipts.map(function (r) {
    return {
      id: r.id, date: r.date, goodsCny: r.goodsCny, freightCny: r.freightCny, freightUsd: r.freightUsd,
      cargoRate: r.cargoRate, totalCny: roundToTwo(r.goodsCny + r.freightCny), status: r.status,
      paymentId: r.paymentId, rubGoods: r.rubGoods, rubFreight: r.rubFreight,
      // Owner, 2026-09-25: whether 'история' is the owner's own mark (setChinaReceiptHistory) or
      // just the receipt's date being before tracking — the browser's highlight rule needs both.
      historyManual: r.historyManual
    };
  });

  const reportsOut = reports.slice()
    .sort(function (a, b) { return String(b.reportDate).localeCompare(String(a.reportDate)); })
    .map(function (r) { return { id: r.id, loadedAt: r.loadedAt, reportDate: r.reportDate, source: r.source, aiReason: r.aiReason }; });

  return {
    payments: paymentsOut, receipts: receiptsOut, orders: orders, pool: pool, reports: reportsOut,
    warnings: allocation.warnings.concat(freightAlloc.warnings)
  };
}
