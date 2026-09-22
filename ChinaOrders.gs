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
  'Расходы РФ ₽', 'Курс ₽/¥', 'Себестоимость партии ₽', 'Коэффициент веса',
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

// The wallet of stage 81d. The sheet is created now so the spreadsheet is complete, but
// nothing reads or writes it yet.
const CHINA_PAYMENT_HEADERS = ['ID', 'Дата', 'Сумма ₽', 'Курс ₽/¥', 'Куплено ¥', 'Назначение', 'Комментарий', 'Кто'];

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

function chinaSpreadsheet() {
  const id = chinaIdFromSetting(PropertiesService.getScriptProperties().getProperty(CHINA_PROPERTY));
  if (!id) {
    throw new Error('Таблица «Заказы в Китае» не настроена: в свойствах скрипта нет ' + CHINA_PROPERTY);
  }
  try {
    return SpreadsheetApp.openById(id);
  } catch (e) {
    throw new Error('Таблица «Заказы в Китае» недоступна: ' + errorMessage(e));
  }
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
function chinaReadSheet(ss, name, headers) {
  const sheet = chinaSheet(ss, name, headers);
  const lastRow = sheet.getLastRow();
  const lastCol = Math.max(sheet.getLastColumn(), headers.length);
  if (lastRow <= 1) return { sheet: sheet, headers: headers.slice(), rows: [] };
  const values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  const head = values[0].map(function (h) { return String(h).trim(); });
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
    return Utilities.formatDate(value, Session.getScriptTimeZone() || 'GMT', 'yyyy-MM-dd');
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
    totalRub: parseNumber(r['Себестоимость партии ₽']),
    weightFactor: r['Коэффициент веса'] === '' ? null : parseNumber(r['Коэффициент веса']),
    comment: String(r['Комментарий'] || '').trim(),
    user: String(r['Кто'] || '').trim(),
    updatedAt: String(r['Обновлено'] || '').trim()
  };
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

function getChinaBatches() {
  const ss = chinaSpreadsheet();
  const batches = chinaReadSheet(ss, CHINA_BATCHES_SHEET, CHINA_BATCH_HEADERS).rows.map(chinaBatchFromRow);
  const lines = chinaReadSheet(ss, CHINA_LINES_SHEET, CHINA_LINE_HEADERS).rows.map(chinaLineFromRow);
  const costs = chinaReadSheet(ss, CHINA_COSTS_SHEET, CHINA_COST_HEADERS).rows.map(chinaCostFromRow);
  const byId = {};
  batches.forEach(function (b) { b.lines = []; b.costs = []; byId[b.id] = b; });
  lines.forEach(function (l) { if (byId[l.batchId]) byId[l.batchId].lines.push(l); });
  costs.forEach(function (c) { if (byId[c.batchId]) byId[c.batchId].costs.push(c); });
  return { batches: batches, settings: getChinaSettings() };
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

// What makes two lines THE SAME GOODS (owner, 2026-09-22). The carrier splits one product
// over several lines and pallets, so lines have to be grouped before anything is split
// between them. Three keys, in order:
//
//   «Один товар»  the owner said so himself — the same box in two colours carries two
//                  different articles of ours and nothing else could tie the lines together;
//   «Наш артикул» once it is written against a line, it says what the goods are;
//   the marking    the carrier's own, good only inside this batch, and all there is until
//                  the articles are assigned.
function chinaGroupKey(line) {
  const group = String((line || {}).group || '').trim();
  if (group) return 'G:' + group.toLowerCase();
  const article = String((line || {}).article || '').trim();
  if (article) return 'A:' + article.toLowerCase();
  return 'M:' + String((line || {}).marking || '').trim().toLowerCase();
}

// Weight of every line, in kilograms, and where each number came from. Kilograms per box are
// derived per GROUP, not per line: lines of one product weigh the same per box, whichever
// pallet they were packed into and whichever marking the carrier gave them.
function chinaLineWeights(lines, invoiceWeight) {
  const boxes = lines.map(function (l) { return Number(l.boxes) || 0; });
  const marks = lines.map(chinaGroupKey);

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
  lines.forEach(function (l, i) {
    const key = chinaGroupKey(l);
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
// how many lines there are, and rewriting is both simpler and safer than patching rows.
function chinaWriteSheet(sheet, headers, rows) {
  sheet.clearContents();
  const table = [headers.slice()].concat(rows);
  sheet.getRange(1, 1, table.length, headers.length).setValues(table);
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

  const calc = chinaBatchCost(batch, lines, rubTotal, getChinaSettings());
  writeChinaBatch(ss, batchCtx, batch, lines, calc, username);
  return getChinaBatches();
}

function writeChinaBatch(ss, batchCtx, batch, lines, calc, username) {
  const row = chinaRowFrom(CHINA_BATCH_HEADERS, {
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
    'Себестоимость партии ₽': calc.totalRub,
    'Коэффициент веса': calc.weightFactor === null ? '' : calc.weightFactor,
    'Комментарий': batch.comment,
    'Кто': username || '',
    'Обновлено': chinaStamp()
  });

  let targetRow = 0;
  batchCtx.rows.forEach(function (r) { if (String(r['ID']).trim() === batch.id) targetRow = r.__row; });
  if (targetRow > 0) {
    batchCtx.sheet.getRange(targetRow, 1, 1, CHINA_BATCH_HEADERS.length).setValues([row]);
  } else {
    batchCtx.sheet.appendRow(row);
  }

  const lineCtx = chinaReadSheet(ss, CHINA_LINES_SHEET, CHINA_LINE_HEADERS);
  const kept = lineCtx.rows
    .filter(function (r) { return String(r['ПартияID']).trim() !== batch.id; })
    .map(function (r) { return chinaRowFrom(CHINA_LINE_HEADERS, r); });

  const fresh = lines.map(function (l, i) {
    const c = calc.lines[i];
    return chinaRowFrom(CHINA_LINE_HEADERS, {
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

  chinaWriteSheet(lineCtx.sheet, CHINA_LINE_HEADERS, kept.concat(fresh));
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

  const calc = chinaBatchCost(batch, lines, rubTotal, getChinaSettings());
  writeChinaBatch(ss, batchCtx, batch, lines, calc, username || batch.user);
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
    .map(function (r) { return chinaRowFrom(CHINA_LINE_HEADERS, r); });
  chinaWriteSheet(lineCtx.sheet, CHINA_LINE_HEADERS, keptLines);

  const costCtx = chinaReadSheet(ss, CHINA_COSTS_SHEET, CHINA_COST_HEADERS);
  const keptCosts = costCtx.rows
    .filter(function (r) { return String(r['ПартияID']).trim() !== id; })
    .map(function (r) { return chinaRowFrom(CHINA_COST_HEADERS, r); });
  chinaWriteSheet(costCtx.sheet, CHINA_COST_HEADERS, keptCosts);

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
  const ctx = chinaReadSheet(ss, CHINA_COSTS_SHEET, CHINA_COST_HEADERS);
  const requested = String(data.id || '').trim();
  let targetRow = 0;
  ctx.rows.forEach(function (r) { if (String(r['ID']).trim() === requested) targetRow = r.__row; });
  if (requested && !targetRow) throw new Error('Расход ' + requested + ' не найден');

  const row = chinaRowFrom(CHINA_COST_HEADERS, {
    'ID': requested || chinaNextId(ctx.rows, 'CC'),
    'ПартияID': batchId,
    'Дата': chinaDateText(data.date, 'Дата') || getTodayDateString(),
    'Тип': kind,
    'Сумма ₽': amount,
    'Комментарий': String(data.comment || '').trim(),
    'Кто': username || ''
  });
  if (targetRow > 0) {
    ctx.sheet.getRange(targetRow, 1, 1, CHINA_COST_HEADERS.length).setValues([row]);
  } else {
    ctx.sheet.appendRow(row);
  }

  recalcChinaBatch(ss, batchId, username);
  return getChinaBatches();
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
