'use strict';
/**
 * Item 97 rollback, Task C: checks for the one-off rollback-oneoff.gs (tmp97RollbackDryRun / tmp97RollbackApply).
 * Money tier. Run:   node .scratch/item-97-contractor-invoice/rollback-oneoff.test.cjs
 * Both time zones:   TZ=Asia/Yekaterinburg node ...   and   TZ=UTC node ...
 * Replay on a real export (path only, never copied into the repo - the repo is PUBLIC):
 *   ROLLBACK_XLSX=/abs/path/db.xlsx node .scratch/item-97-contractor-invoice/rollback-oneoff.test.cjs
 *
 * The stand is tests/apps-script/harness.cjs (Code.gs + ChinaOrders.gs in one vm context). The one-off file is
 * loaded into the SAME context afterwards, as Apps Script shares one global scope between the files of a project.
 * While rollback-oneoff.gs does not exist every check is reported as failing (never a silent crash).
 */
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');
const HARNESS = path.join(REPO, 'tests', 'apps-script', 'harness.cjs');
const ONEOFF = process.env.ROLLBACK_ONEOFF || path.join(__dirname, 'rollback-oneoff.gs'); // override only to validate the runner itself

const results = [];
function check(name, condition, details) {
  results.push({ name, ok: !!condition });
  console.log((condition ? 'OK    ' : 'FAIL  ') + name + (!condition && details ? '  -- ' + details : ''));
}

// ---------- the five rows of rollback-plan.md section 2.4 ----------
const SHIP = '06192f17-397a-4206-a245-f1a8c0b132f5';
const TAG1 = ' [Счёт № 5477 от 02.11.2026: 974,52₽]';
const TAG2 = ' [Счёт № 5477 от 02.11.2026: 3118,48₽]';
const base = (share) => 'Ozon (Mercurius) [Общая поставка: заявки № 135507457-1, № 135475876-1; доля этой заявки ' + share
  + ' из 137 шт., 0.00 руб. из 0.00 руб.]';
const FIVE = [
  { id: '764b9e01-e6d1-4a47-912b-cdd59096af24', opId: SHIP + '-1', article: 'Органайзер_3_пол_PureWhite', qty: 27, price: 797.73, cost: 20429.28, sum: 21538.80, P: 135, I: 974.52, obj: base(27), tag: TAG1, sumAfter: 20429.28, priceAfter: 756.64, sku: 3361926954 },
  { id: '9ca0582b-2dd5-49f0-8d1b-527e1db9d574', opId: SHIP + '-2', article: 'Органайзер_3_пол_PureWhite', qty: 34, price: 796.04, cost: 25725.76, sum: 27065.19, P: 170, I: 1169.43, obj: base(110), tag: TAG2, sumAfter: 25725.76, priceAfter: 756.64, sku: 3361926954 },
  { id: '8741b8c1-9ab5-4177-ad86-cc10ed85d6ca', opId: SHIP + '-2', article: 'Органайзер_полка_черн', qty: 40, price: 895.82, cost: 34853.20, sum: 35832.82, P: 200, I: 779.62, obj: base(110), tag: TAG2, sumAfter: 34853.20, priceAfter: 871.33, sku: 2128475059 },
  { id: 'd7ee42ff-ab98-4dae-9e2f-25fe89cc77c0', opId: SHIP + '-2', article: 'Полка_выдв_27см_черн', qty: 24, price: 723.07, cost: 16454.16, sum: 17353.78, P: 120, I: 779.62, obj: base(110), tag: TAG2, sumAfter: 16454.16, priceAfter: 685.59, sku: '' },
  { id: '0afaca63-fcfc-4ffb-af54-1f7094f5f123', opId: SHIP + '-2', article: 'Полка_выдв_27см', qty: 12, price: 733.32, cost: 8350.08, sum: 8799.89, P: 60, I: 389.81, obj: base(110), tag: TAG2, sumAfter: 8350.08, priceAfter: 695.84, sku: 2071666870 }
];
const SUM_AFTER_KOP = 10581248; // 105 812.48

// «История»: 0 ID ... 15 Комментарий, 16 Отгрузка, 17 Комментарий, 18 Отгрузка, 19 Упаковка недели, 20 Счёт недели (duplicate headers!)
const HIST_HEADERS = ['ID', 'Дата', 'Тип', 'Артикул', 'Количество', 'Цена', 'Себестоимость списания', 'Сумма', 'Объект', 'Дата поставки',
  'Пользователь', 'groupId', 'isComponent', 'OpID', 'ДопРасходы', 'Комментарий', 'Отгрузка', 'Комментарий', 'Отгрузка', 'Упаковка недели', 'Счёт недели'];
const COL = { id: 0, price: 5, cost: 6, sum: 7, obj: 8, op: 13, c15: 15, s16: 16, c17: 17, s18: 18, P: 19, I: 20 };
const SIX = [
  { name: 'Счета подрядчика', rows: 1, headers: ['ID счёта', 'Неделя', 'Поставщик', 'Номер', 'Дата счёта', 'Покупатель', 'Всего к оплате', 'НДС', 'Всего наименований', 'Файл ID', 'Файл', 'Загрузил', 'Загружено', 'Заменён'] },
  { name: 'Строки счетов', rows: 5, headers: ['ID счёта', '№', 'Наименование', 'Кол-во', 'Ед.', 'Цена', 'Сумма', 'На поставку', 'Упаковка'] },
  { name: 'Упаковка недели', rows: 4, headers: ['Неделя', 'Артикул', 'OpID', '₽/шт', 'Сохранил', 'Сохранено'] },
  { name: 'Доли счетов', rows: 5, headers: ['ID счёта', 'Неделя', 'OpID', 'ID строки', 'Доля (₽)', 'Применил', 'Применено'] },
  { name: 'Распределения счетов', rows: 1, headers: ['ID счёта', 'Неделя', 'Строки', 'Поставки', 'Применил', 'Применено'] },
  { name: 'Журнал статусов Ozon', rows: 31, headers: ['Время опроса', 'Постинг', 'Заказ', 'Кабинет', 'Было', 'Стало', 'Статус заявки', 'Дата статуса Ozon'] }
];

function freshStand() {
  delete require.cache[require.resolve(HARNESS)];
  const h = require(HARNESS);
  h.setScriptTimeZone('Asia/Yekaterinburg');
  h.setNow('2026-11-06T09:30:00Z');
  h.logs.length = 0;
  return h;
}
function loadOneOff(h) {
  if (!fs.existsSync(ONEOFF)) return false;
  h.vm.runInContext(fs.readFileSync(ONEOFF, 'utf8'), h.context, { filename: 'rollback-oneoff.gs' });
  return true;
}

function histRow(h, o) {
  const r = new Array(HIST_HEADERS.length).fill('');
  r[0] = o.id; r[1] = '2026-11-06T08:49:56.672Z'; r[2] = o.type || 'Расход'; r[3] = o.article; r[4] = o.qty; r[5] = o.price;
  r[6] = o.cost; r[7] = o.sum; r[8] = o.obj; r[9] = o.delivery === undefined ? new h.FakeDate(Date.UTC(2026, 9, 30, 19, 0, 0)) : o.delivery;
  r[10] = 'администратор'; r[11] = ''; r[12] = false; r[13] = o.opId || '';
  if (o.shipment) { r[16] = o.shipment; r[18] = o.shipment; }
  if (o.P !== undefined) r[COL.P] = o.P;
  if (o.I !== undefined) r[COL.I] = o.I;
  return r;
}

// The journal rows 118-127 of rollback-plan.md section 2.6 (+ seeds before, one LATER link of an article after).
function journalRows() {
  const C = 'Mercurius';
  const seed = (art, sku, base, cost) => ['2026-10-19', C, art, sku, base, '', '', '', cost, '', '2026-10-27 22:49:04 пункт 93 разовая отправка', 'стартовая себестоимость', 'принято', 'КАН принял ' + cost, '2026-10-27 22:49:04'];
  const o = (art, sku, stockBefore, costBefore, shipped, shippedCost, after, opId, src, answer) =>
    ['2026-10-31', C, art, sku, stockBefore, costBefore, shipped, shippedCost, after, opId, '2026-11-06 13:50:26 администратор', src, 'принято', answer, '2026-11-06 14:11:12'];
  const A = 'Органайзер_3_пол_PureWhite', B = 'Органайзер_полка_черн', D = 'Полка_выдв_27см_черн', E = 'Полка_выдв_27см';
  return [
    seed(A, 3361926954, 92, 820.91), seed(B, 2128475059, 196, 748.75), seed(D, '', 90, 702.46), seed(E, 2071666870, 107, 710.43),
    o(A, 3361926954, 92, 820.91, 27, 787.13, 813.25, SHIP + '-1', 'отгрузка', 'КАН принял 810,36'),
    o(A, 3361926954, 92, 813.25, 34, 787.13, 806.20, SHIP + '-2', 'отгрузка', 'КАН принял 810,36'),
    o(B, 2128475059, 196, 748.75, 40, 901.82, 774.69, SHIP + '-2', 'отгрузка', 'КАН принял 774,69'),
    o(D, '', 90, 702.46, 24, 716.08, 705.33, SHIP + '-2', 'отгрузка', 'КАН принял 705,33'),
    o(E, 2071666870, 107, 710.43, 12, 726.33, 712.03, SHIP + '-2', 'отгрузка', 'КАН принял 712,74'),
    o(A, 3361926954, 92, 820.91, 27, 797.73, 815.65, SHIP + '-1', 'пересчёт после правки прихода', 'КАН принял 810,36'),
    o(A, 3361926954, 92, 815.65, 34, 796.04, 810.36, SHIP + '-2', 'пересчёт после правки прихода', 'КАН принял 810,36'),
    o(B, 2128475059, 196, 748.75, 40, 895.82, 773.68, SHIP + '-2', 'пересчёт после правки прихода', 'КАН принял 773,68'),
    o(D, '', 90, 702.46, 24, 723.07, 706.80, SHIP + '-2', 'пересчёт после правки прихода', 'КАН принял 706,80'),
    o(E, 2071666870, 107, 710.43, 12, 733.32, 712.74, SHIP + '-2', 'пересчёт после правки прихода', 'КАН принял 712,74'),
    // a LATER link of one chain: the moving average shifts it, its own shipped cost must stay 900
    ['2026-11-03', C, B, 2128475059, 156, 773.68, 10, 900.00, 785.50, 'LATER-OP-9', '', 'отгрузка', '', '', '']
  ];
}

function buildFixture(h, opts) {
  opts = opts || {};
  const hist = [HIST_HEADERS.slice()];
  const filler = (n, extra) => histRow(h, Object.assign({ id: 'filler-' + n, type: 'Приход', article: 'Органайзер_3_пол_PureWhite', qty: 100, price: 700, cost: 0, sum: 70000, obj: 'Склад', delivery: '' }, extra || {}));
  for (let i = 0; i < 4; i++) hist.push(filler(i, i === 2 && opts.foreignP !== undefined ? { P: opts.foreignP } : (i === 3 && opts.foreignI !== undefined ? { I: opts.foreignI } : {})));
  hist.push(histRow(h, { id: 'old-ship-1', article: 'Полка_выдв_27см', qty: 6, price: 716.68, cost: 4300.08, sum: 4300.08, obj: 'Ozon (Mercurius)', opId: 'old-op-1' }));
  FIVE.forEach((f) => {
    const tampered = opts.tamper && opts.tamper.id === f.id ? opts.tamper : {};
    hist.push(histRow(h, {
      id: f.id, opId: f.opId, article: f.article, qty: f.qty, price: f.price, cost: f.cost, sum: tampered.sum !== undefined ? tampered.sum : f.sum,
      obj: f.obj + f.tag, shipment: SHIP, P: tampered.P !== undefined ? tampered.P : f.P, I: f.I
    }));
  });
  hist.push(filler(9));
  h.setRegistrySheet('История', hist);
  h.setRegistrySheet('Остатки', [['Артикул', 'Количество на складе', 'Средняя себестоимость', 'Капитализация', 'Продажи за 120д', 'Оборачиваемость (дн)'], ['Органайзер_3_пол_PureWhite', 300, 700, 210000, 10, 20]]);
  h.setOzonCostSheet(journalRows(), h.OZON_COST_HEADERS.concat(h.OZON_COST_KAN_HEADERS));
  SIX.forEach((s) => {
    const n = s.name === 'Доли счетов' && opts.sharesRows ? opts.sharesRows : s.rows;
    const rows = [s.headers.slice()];
    for (let i = 0; i < n; i++) rows.push(s.headers.map((_, c) => 'x' + (i + 1) + 'c' + (c + 1)));
    h.setRegistrySheet(s.name, rows);
  });
}

// ---------- observation helpers ----------
function snapshot(h) {
  const snap = {};
  h.registrySheetNames().forEach((n) => { snap[n] = JSON.stringify(h.getRegistrySheet(n).__dump()); });
  return snap;
}
function sameSnapshot(a, b) {
  const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
  if (JSON.stringify(ka) !== JSON.stringify(kb)) return 'sheet set differs: ' + ka.length + ' vs ' + kb.length;
  for (const k of ka) if (a[k] !== b[k]) return 'sheet "' + k + '" differs';
  return '';
}
const kop = (x) => Math.round(Number(x) * 100);
function histRows(h) { return h.getRegistrySheet('История').__dump(); }
function rowById(h, id) { return histRows(h).filter((r, i) => i > 0 && r[COL.id] === id)[0]; }
function journalFull(h) { return h.dumpOzonCostFull(); }
function journalCount(h) { return journalFull(h).length; }
function latestCost(h, opId, article) {
  let last = null;
  journalFull(h).forEach((r) => {
    if (String(r['OpID']).trim() === opId && String(r['Артикул']).trim() === article && String(r['Источник']).indexOf('удалено') !== 0) last = r;
  });
  return last;
}
function callOneOff(h, fn) {
  const f = h.context[fn];
  if (typeof f !== 'function') return { exists: false, threw: true, message: fn + ' is not defined (rollback-oneoff.gs missing or incomplete)' };
  try { f(); return { exists: true, threw: false, message: '' }; } catch (e) { return { exists: true, threw: true, message: String(e && e.message ? e.message : e) }; }
}
const ACCIDENT = /TypeError|ReferenceError|is not a function|is not defined|Cannot read|undefined/;
const isRefusal = (r) => r.exists && r.threw && !ACCIDENT.test(r.message);

// A number as the log may print it: 21538.8 / 21538.80 / 21538,80 / 21 538,80
function numRe(n) {
  const fixed = Number(n).toFixed(2);
  const [ip, fp] = fixed.split('.');
  const intRe = ip.replace(/\B(?=(\d{3})+(?!\d))/g, '\u0001').split('\u0001').join('[ \\u00a0]?');
  let frac;
  if (fp === '00') frac = '(?:[.,]00?)?';
  else if (fp[1] === '0') frac = '[.,]' + fp[0] + '0?';
  else frac = '[.,]' + fp;
  return new RegExp('(?<![\\d.,])' + intRe + frac + '(?!\\d)(?![.,]\\d)');
}

// Asserts the AFTER state of the five rows (and that nothing else in «История» moved).
function assertAfterRows(h, label, before, ran) {
  const sheetRows = histRows(h);
  FIVE.forEach((f, k) => {
    const r = rowById(h, f.id);
    const b = before.find((x) => x[COL.id] === f.id);
    const tag = label + ' row ' + (k + 1) + ' (' + f.article + ' ' + f.opId.slice(-2) + ')';
    check(tag + ': Сумма = ' + f.sumAfter.toFixed(2), r && kop(r[COL.sum]) === kop(f.sumAfter), r && String(r[COL.sum]));
    check(tag + ': Цена = ' + f.priceAfter.toFixed(2), r && kop(r[COL.price]) === kop(f.priceAfter), r && String(r[COL.price]));
    check(tag + ': «Упаковка недели» and «Счёт недели» empty', r && r[COL.P] === '' && r[COL.I] === '', r && JSON.stringify([r[COL.P], r[COL.I]]));
    check(tag + ': «Объект» = base text without the invoice tag, «[Общая поставка …]» kept exactly', r && r[COL.obj] === f.obj, r && String(r[COL.obj]));
    const rest = (x) => x && x.map((v, i) => ([COL.price, COL.sum, COL.obj, COL.P, COL.I].indexOf(i) !== -1 ? '*' : JSON.stringify(v)));
    check(tag + ': every other column untouched (incl. the duplicate «Комментарий»/«Отгрузка» columns 15-18)', ran && r && b && JSON.stringify(rest(r)) === JSON.stringify(rest(b)), r && b && JSON.stringify(rest(r)) !== JSON.stringify(rest(b)) ? 'a column other than Цена/Сумма/Объект/P/I changed' : '');
  });
  const total = FIVE.reduce((s, f) => s + kop(rowById(h, f.id) ? rowById(h, f.id)[COL.sum] : 0), 0);
  check(label + ': Σ Сумма of the five rows = 105 812.48', total === SUM_AFTER_KOP, 'kopecks ' + total);
  const ids = FIVE.map((f) => f.id);
  const others = sheetRows.filter((r, i) => i > 0 && ids.indexOf(r[COL.id]) === -1).map((r) => JSON.stringify(r));
  const othersBefore = before.filter((r, i) => i > 0 && ids.indexOf(r[COL.id]) === -1).map((r) => JSON.stringify(r));
  check(label + ': all other «История» rows untouched', ran && JSON.stringify(others) === JSON.stringify(othersBefore));
}

function assertJournalLatest(h, label, journalBefore, expectLater, ran) {
  FIVE.forEach((f) => {
    const last = latestCost(h, f.opId, f.article);
    check(label + ': journal latest cost of ' + f.article + ' ' + f.opId.slice(-2) + ' = ' + f.priceAfter.toFixed(2),
      last && kop(last['Себестоимость отгрузки']) === kop(f.priceAfter) && Number(last['Отгружено']) === f.qty, last && (last['Себестоимость отгрузки'] + ' x ' + last['Отгружено']));
  });
  const after = journalFull(h);
  check(label + ': the journal is append-only (old rows unchanged, in place)', ran && after.length >= journalBefore.length
    && JSON.stringify(after.slice(0, journalBefore.length)) === JSON.stringify(journalBefore));
  if (expectLater) {
    const later = latestCost(h, 'LATER-OP-9', 'Органайзер_полка_черн');
    check(label + ': a later link of the chain keeps its own shipped cost 900.00 x 10 (only the blend moves)', ran && later && kop(later['Себестоимость отгрузки']) === 90000 && Number(later['Отгружено']) === 10, later && String(later['Себестоимость отгрузки']));
  }
}

function sixGone(h) { return SIX.every((s) => h.getRegistrySheet(s.name) === null); }
function sixAll(h) { return SIX.every((s) => h.getRegistrySheet(s.name) !== null); }

// ---------- scenarios ----------
function scenario1() {
  const h = freshStand(); buildFixture(h); const has = loadOneOff(h);
  const before = snapshot(h);
  const r = callOneOff(h, 'tmp97RollbackDryRun');
  check('1. dry run: runs without error', r.exists && !r.threw, r.message);
  check('1. dry run: writes nothing (every sheet byte for byte, same set of sheets)', r.exists && !r.threw && sameSnapshot(before, snapshot(h)) === '', sameSnapshot(before, snapshot(h)));
  const log = h.logs.join('\n');
  FIVE.forEach((f, k) => {
    const hit = h.logs.some((l) => numRe(f.sum).test(l) && numRe(f.sumAfter).test(l) && /→|->|=>/.test(l));
    check('1. dry run: logs row ' + (k + 1) + ' (' + f.article + ' ' + f.opId.slice(-2) + ') old Сумма ' + f.sum.toFixed(2) + ' → new ' + f.sumAfter.toFixed(2), hit);
    const hitPrice = h.logs.some((l) => numRe(f.price).test(l) && numRe(f.priceAfter).test(l) && /→|->|=>/.test(l));
    check('1. dry run: logs row ' + (k + 1) + ' old Цена ' + f.price + ' → new ' + f.priceAfter, hitPrice);
  });
  check('1. dry run: logs every one of the six sheets with its row count', r.exists && !r.threw && SIX.every((s) => log.indexOf(s.name) !== -1) && /\b31\b/.test(log));
}

function scenario2() {
  const h = freshStand(); buildFixture(h); loadOneOff(h);
  const beforeRows = histRows(h).map((r) => r.slice());
  const journalBefore = journalFull(h);
  const r = callOneOff(h, 'tmp97RollbackApply');
  check('2. apply: runs without error', r.exists && !r.threw, r.message);
  assertAfterRows(h, '2. apply', beforeRows, r.exists && !r.threw);
  assertJournalLatest(h, '2. apply', journalBefore, true, r.exists && !r.threw);
  check('2. apply: the journal got new rows (re-issue happened)', journalCount(h) > journalBefore.length);
  check('2. apply: the six item-97 sheets are deleted', sixGone(h), 'left: ' + SIX.filter((s) => h.getRegistrySheet(s.name)).map((s) => s.name).join(', '));
  check('2. apply: «История», «Себестоимость Озон» and «Остатки» still exist', r.exists && !r.threw && ['История', 'Себестоимость Озон', 'Остатки'].every((n) => h.getRegistrySheet(n) !== null));
  check('2. apply: logs a summary (rows changed / journal rows / sheets deleted)', r.exists && !r.threw && h.logs.length > 0);
}

function scenario3() {
  const h = freshStand(); buildFixture(h); loadOneOff(h);
  const r1 = callOneOff(h, 'tmp97RollbackApply');
  const after1 = snapshot(h);
  const r2 = callOneOff(h, 'tmp97RollbackApply');
  check('3. second apply: first apply succeeded', r1.exists && !r1.threw, r1.message);
  check('3. second apply: runs without error', r2.exists && !r2.threw, r2.message);
  check('3. second apply: writes nothing (all sheets byte for byte, journal not doubled)', r1.exists && !r1.threw && r2.exists && !r2.threw && sameSnapshot(after1, snapshot(h)) === '', sameSnapshot(after1, snapshot(h)));
}

function scenario4() {
  // reference: the number of journal rows a clean single run appends
  const ref = freshStand(); buildFixture(ref); loadOneOff(ref);
  const refBefore = journalCount(ref);
  callOneOff(ref, 'tmp97RollbackApply');
  const refAppended = journalCount(ref) - refBefore;

  const h = freshStand(); buildFixture(h); loadOneOff(h);
  const realReissue = h.context.reissueOzonCostRows;
  const beforeRows = histRows(h).map((r) => r.slice());
  const journalBefore = journalFull(h);
  h.context.reissueOzonCostRows = function () { throw new Error('simulated cut-off after step a'); };
  const r1 = callOneOff(h, 'tmp97RollbackApply'); // may throw or return after logging; both are allowed
  check('4. cut-off: the one-off exists', r1.exists, r1.message);
  const rowsDone = FIVE.every((f) => { const r = rowById(h, f.id); return r && kop(r[COL.sum]) === kop(f.sumAfter) && r[COL.P] === '' && r[COL.I] === ''; });
  check('4. cut-off: step a is done (the five rows rewritten, Σ 105 812.48)', r1.exists && rowsDone);
  check('4. cut-off: journal not re-issued yet (unchanged)', r1.exists && rowsDone && JSON.stringify(journalFull(h)) === JSON.stringify(journalBefore));
  check('4. cut-off: step b failed, so step c did not run (all six sheets still exist)', r1.exists && rowsDone && sixAll(h));
  h.context.reissueOzonCostRows = realReissue;
  const r2 = callOneOff(h, 'tmp97RollbackApply');
  check('4. rerun: runs without error', r2.exists && !r2.threw, r2.message);
  check('4. rerun: journal re-issue appended exactly once (same row count as one clean run, ' + refAppended + ')', refAppended > 0 && journalCount(h) - journalBefore.length === refAppended, 'appended ' + (journalCount(h) - journalBefore.length) + ' vs clean ' + refAppended);
  assertAfterRows(h, '4. rerun', beforeRows, r2.exists && !r2.threw);
  assertJournalLatest(h, '4. rerun', journalBefore, true, r2.exists && !r2.threw);
  check('4. rerun: the six sheets are deleted only now', sixGone(h));
  const snap = snapshot(h);
  const r3 = callOneOff(h, 'tmp97RollbackApply');
  check('4. third run after healing: writes nothing', r3.exists && !r3.threw && sameSnapshot(snap, snapshot(h)) === '', r3.message || sameSnapshot(snap, snapshot(h)));
}

function scenario5() {
  [
    { label: 'Сумма +0.01 on the 3rd row', tamper: { id: FIVE[2].id, sum: FIVE[2].sum + 0.01 } },
    { label: 'Сумма +0.01 on the 1st row', tamper: { id: FIVE[0].id, sum: FIVE[0].sum + 0.01 } },
    { label: '«Упаковка недели» 121 instead of 120 on the 4th row', tamper: { id: FIVE[3].id, P: 121 } }
  ].forEach((t) => {
    const h = freshStand(); buildFixture(h, { tamper: t.tamper }); loadOneOff(h);
    const before = snapshot(h);
    const r = callOneOff(h, 'tmp97RollbackApply');
    check('5. tampered row (' + t.label + '): apply refuses with a guard error', isRefusal(r), r.message);
    check('5. tampered row (' + t.label + '): NOTHING written (rows, journal, six sheets intact)', isRefusal(r) && sameSnapshot(before, snapshot(h)) === '', sameSnapshot(before, snapshot(h)));
  });
}

function scenario6() {
  const cases = [
    { label: 'another «История» row has a non-empty «Упаковка недели»', opts: { foreignP: 5 } },
    { label: 'another «История» row has a non-empty «Счёт недели»', opts: { foreignI: 12.5 } },
    { label: 'item-97 sheet «Доли счетов» has 6 rows instead of 5', opts: { sharesRows: 6 } },
    { label: 'dev-mode spreadsheet is set', opts: {}, dev: true }
  ];
  cases.forEach((c) => {
    const h = freshStand(); buildFixture(h, c.opts); loadOneOff(h);
    if (c.dev) {
      h.context.__dev = h.context.SpreadsheetApp.getActiveSpreadsheet(); // a working spreadsheet: only the guard can stop the run
      h.vm.runInContext('_devModeSpreadsheet = __dev', h.context);
    }
    const before = snapshot(h);
    const r = callOneOff(h, 'tmp97RollbackApply');
    check('6. guard (' + c.label + '): apply refuses with a guard error', isRefusal(r), r.message);
    check('6. guard (' + c.label + '): nothing written', isRefusal(r) && sameSnapshot(before, snapshot(h)) === '', sameSnapshot(before, snapshot(h)));
  });
}

// ---------- 7. replay on a real export (never copied into the repo; path via env var) ----------
function loadFromXlsx(h, file) {
  const X = require(path.join(REPO, 'node_modules', 'xlsx'));
  const wb = X.readFile(file, { cellDates: false, cellNF: true });
  const wanted = ['История', 'Себестоимость Озон'].concat(SIX.map((s) => s.name)); // never «Пользователи» / «Сессии»
  wanted.forEach((name) => {
    const ws = wb.Sheets[name];
    if (!ws) return;
    const range = X.utils.decode_range(ws['!ref'] || 'A1:A1');
    const rows = [];
    for (let R = range.s.r; R <= range.e.r; R++) {
      const row = [];
      for (let C = range.s.c; C <= range.e.c; C++) {
        const cell = ws[X.utils.encode_cell({ r: R, c: C })];
        if (!cell || cell.v === undefined || cell.v === null) { row.push(''); continue; }
        if (cell.t === 'n' && ((cell.z && X.SSF.is_date(cell.z)) || /^\d{4}-\d{2}-\d{2}/.test(String(cell.w || '')))) {
          // a Sheets date cell: a Date holding the wall time of the Ekaterinburg-zone spreadsheet (tz independent: from the serial)
          const ms = Math.round((cell.v - 25569) * 86400000);
          row.push(new h.FakeDate(ms - 5 * 3600000));
        } else row.push(cell.v);
      }
      rows.push(row);
    }
    h.setRegistrySheet(name === 'Себестоимость Озон' ? name : name, rows);
  });
  return wanted.filter((n) => wb.Sheets[n]);
}

function scenario7() {
  const file = process.env.ROLLBACK_XLSX;
  if (!file) { console.log('SKIP  7. replay on a real export: ROLLBACK_XLSX is not set (set it to the xlsx export path to run this check)'); return; }
  const h = freshStand();
  const loaded = loadFromXlsx(h, file);
  check('7. replay: the export has «История», «Себестоимость Озон» and the six sheets', loaded.length === 8, 'loaded: ' + loaded.join(', '));
  loadOneOff(h);
  const before = snapshot(h);
  const beforeRows = histRows(h).map((r) => r.slice());
  const journalBefore = journalFull(h);
  const found = FIVE.filter((f) => rowById(h, f.id));
  check('7. replay: all five ids are present in «История» (export is from before the one-off)', found.length === 5, 'found ' + found.length);
  const d = callOneOff(h, 'tmp97RollbackDryRun');
  check('7. replay: dry run runs without error', d.exists && !d.threw, d.message);
  check('7. replay: dry run writes nothing', d.exists && !d.threw && sameSnapshot(before, snapshot(h)) === '', sameSnapshot(before, snapshot(h)));
  const a = callOneOff(h, 'tmp97RollbackApply');
  if (process.env.ROLLBACK_DEBUG) console.log(h.logs.join('\n'));
  check('7. replay: apply runs without error', a.exists && !a.threw, a.message);
  assertAfterRows(h, '7. replay', beforeRows, a.exists && !a.threw);
  assertJournalLatest(h, '7. replay', journalBefore, false, a.exists && !a.threw);
  check('7. replay: the six item-97 sheets are deleted', sixGone(h));
  const snap = snapshot(h);
  const a2 = callOneOff(h, 'tmp97RollbackApply');
  check('7. replay: a second apply writes nothing', a2.exists && !a2.threw && sameSnapshot(snap, snapshot(h)) === '', a2.message);
}

console.log('one-off file: ' + ONEOFF + (fs.existsSync(ONEOFF) ? '' : '  (DOES NOT EXIST YET - every check below is expected to fail)'));
[scenario1, scenario2, scenario3, scenario4, scenario5, scenario6, scenario7].forEach((s) => {
  try { s(); } catch (e) { check(s.name + ' crashed in the test itself', false, String(e && e.stack ? e.stack : e)); }
});
const failed = results.filter((r) => !r.ok);
console.log('=== TOTAL: ' + results.length + ' checks, failed: ' + failed.length + ' ===');
process.exit(failed.length ? 1 : 0);
