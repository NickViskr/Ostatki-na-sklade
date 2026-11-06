/**
 * Item 97 rollback, Task C: one-off functions for the owner. NOT part of the app and never pushed by
 * clasp (.claspignore lets only Code.gs / ChinaOrders.gs / appsscript.json out).
 *
 * What it does: removes the fixed week-44 sums that item 97 wrote into five rows of «История»
 * (the shipment of 2026-10-31), puts those rows back to the plain cost of the write-off, tells the
 * journal «Себестоимость Озон» about the new unit costs (so KAN gets them), and deletes the six
 * sheets of item 97. The PDF on Drive is not touched.
 *
 * Paste into a NEW script file of the live Apps Script project (it must already run the new
 * Code.gs) and run by hand, in this order:
 *   1. tmp97RollbackDryRun()  - writes NOTHING; read the log («Выполнение» -> «Журнал выполнения»):
 *                               per row old -> new Сумма / Цена, the journal rows to re-issue, the six
 *                               sheets with their row counts, every check.
 *   2. tmp97RollbackApply()   - does the work. Refuses (writes nothing) if any check fails. Safe to run
 *                               again after an interruption: it finishes the job without doing it twice.
 * All files of an Apps Script project share one global scope, so Code.gs functions are called directly.
 * Delete this file from the project afterwards.
 */

const TMP97_SHIP = '06192f17-397a-4206-a245-f1a8c0b132f5';
const TMP97_TAG_1 = ' [Счёт № 5477 от 02.11.2026: 974,52₽]';
const TMP97_TAG_2 = ' [Счёт № 5477 от 02.11.2026: 3118,48₽]';
const TMP97_TAG_MARK = ' [Счёт №';
const TMP97_REASON = 'откат пункта 97';

// Money in integer kopecks. sum/fixedP/fixedI = BEFORE state, targetSum/targetPrice = AFTER state.
const TMP97_ROWS = [
  { id: '764b9e01-e6d1-4a47-912b-cdd59096af24', opId: TMP97_SHIP + '-1', article: 'Органайзер_3_пол_PureWhite', qty: 27, sum: 2153880, fixedP: 13500, fixedI: 97452, tag: TMP97_TAG_1, targetSum: 2042928, targetPrice: 75664 },
  { id: '9ca0582b-2dd5-49f0-8d1b-527e1db9d574', opId: TMP97_SHIP + '-2', article: 'Органайзер_3_пол_PureWhite', qty: 34, sum: 2706519, fixedP: 17000, fixedI: 116943, tag: TMP97_TAG_2, targetSum: 2572576, targetPrice: 75664 },
  { id: '8741b8c1-9ab5-4177-ad86-cc10ed85d6ca', opId: TMP97_SHIP + '-2', article: 'Органайзер_полка_черн', qty: 40, sum: 3583282, fixedP: 20000, fixedI: 77962, tag: TMP97_TAG_2, targetSum: 3485320, targetPrice: 87133 },
  { id: 'd7ee42ff-ab98-4dae-9e2f-25fe89cc77c0', opId: TMP97_SHIP + '-2', article: 'Полка_выдв_27см_черн', qty: 24, sum: 1735378, fixedP: 12000, fixedI: 77962, tag: TMP97_TAG_2, targetSum: 1645416, targetPrice: 68559 },
  { id: '0afaca63-fcfc-4ffb-af54-1f7094f5f123', opId: TMP97_SHIP + '-2', article: 'Полка_выдв_27см', qty: 12, sum: 879989, fixedP: 6000, fixedI: 38981, tag: TMP97_TAG_2, targetSum: 835008, targetPrice: 69584 }
];

// Sheets of item 97 and the data-row count each must have (null = any count).
const TMP97_SHEETS = [
  { name: 'Счета подрядчика', rows: 1 },
  { name: 'Строки счетов', rows: 5 },
  { name: 'Упаковка недели', rows: 4 },
  { name: 'Доли счетов', rows: 5 },
  { name: 'Распределения счетов', rows: 1 },
  { name: 'Журнал статусов Ozon', rows: null }
];

function tmp97Kop(value) {
  return Math.round(Number(value) * 100);
}

function tmp97Money(kop) {
  return (kop / 100).toFixed(2);
}

/** Reads «История» and runs every guard. Nothing is written. Returns { checks, rows, sheet, headers, ss, sheets }. */
function tmp97Inspect() {
  const checks = [];
  const guard = function(name, ok, detail) { checks.push({ name: name, ok: !!ok, detail: detail || '' }); };

  guard('production database (no dev-mode spreadsheet)', !_devModeSpreadsheet);
  const ss = getSpreadsheet();
  const sheet = getTransactionSheet(ss);
  const headers = readHeaderRow(sheet);
  // Only these five columns are written; «Комментарий» and «Отгрузка» exist twice and are never touched.
  const col = {};
  ['ID', 'Тип', 'Артикул', 'Количество', 'Цена', 'Сумма', 'Объект', 'Дата', 'Дата поставки', 'OpID', 'Упаковка недели', 'Счёт недели'].forEach(function(name) {
    col[name] = headers.indexOf(name);
    guard('column «' + name + '» present in «История»', col[name] !== -1);
  });

  const values = checks.every(function(c) { return c.ok; }) ? sheet.getDataRange().getValues() : [];
  const blank = function(v) { return String(v === undefined || v === null ? '' : v).trim() === ''; };
  const fiveIds = TMP97_ROWS.map(function(r) { return r.id; });

  // No OTHER «История» row may carry a week packaging / invoice figure.
  const foreign = [];
  for (let i = 1; i < values.length; i++) {
    if (fiveIds.indexOf(String(values[i][col['ID']])) !== -1) continue;
    if (!blank(values[i][col['Упаковка недели']]) || !blank(values[i][col['Счёт недели']])) foreign.push(i + 1);
  }
  guard('no other «История» row has «Упаковка недели» / «Счёт недели»', values.length > 0 && foreign.length === 0, foreign.length ? 'rows ' + foreign.join(', ') : '');

  const rows = TMP97_ROWS.map(function(spec) {
    const found = [];
    for (let i = 1; i < values.length; i++) if (String(values[i][col['ID']]) === spec.id) found.push(i);
    guard(spec.id + ': found exactly once in «История»', found.length === 1, 'found ' + found.length);
    if (found.length !== 1) return null;
    const row = values[found[0]];
    const objectText = String(row[col['Объект']]);
    const sumKop = tmp97Kop(row[col['Сумма']]);
    const pBlank = blank(row[col['Упаковка недели']]);
    const iBlank = blank(row[col['Счёт недели']]);
    const identity = String(row[col['Тип']]) === 'Расход' && String(row[col['Артикул']]) === spec.article
      && Number(row[col['Количество']]) === spec.qty && String(row[col['OpID']]).trim() === spec.opId;
    guard(spec.id + ': type «Расход», article, quantity and OpID as expected', identity);
    const tagOn = objectText.slice(-spec.tag.length) === spec.tag;
    const tagOff = objectText.indexOf(TMP97_TAG_MARK) === -1;
    // BEFORE: Сумма still the old one; P / I / tag exact, or already cleared (Сумма is written last, so a cut-off
    // inside one row leaves it here). AFTER: Сумма = target, P and I empty, no tag.
    const pOk = pBlank || tmp97Kop(row[col['Упаковка недели']]) === spec.fixedP;
    const iOk = iBlank || tmp97Kop(row[col['Счёт недели']]) === spec.fixedI;
    let state = '';
    if (sumKop === spec.sum && pOk && iOk && (tagOn || tagOff)) state = 'before';
    else if (sumKop === spec.targetSum && pBlank && iBlank && tagOff) state = 'after';
    guard(spec.id + ': exact before or after state', state !== '', 'Сумма ' + tmp97Money(sumKop) + ', P "' + row[col['Упаковка недели']] + '", I "' + row[col['Счёт недели']] + '"');
    return { spec: spec, sheetRow: found[0] + 1, state: state, values: row, objectText: objectText, tagOn: tagOn };
  });

  const sheets = TMP97_SHEETS.map(function(s) {
    const sh = ss.getSheetByName(s.name);
    const count = sh ? Math.max(sh.getLastRow() - 1, 0) : null;
    if (sh && s.rows !== null) guard('sheet «' + s.name + '»: ' + s.rows + ' data row(s)', count === s.rows, 'has ' + count);
    return { spec: s, sheet: sh, count: count };
  });

  return { checks: checks, rows: rows, sheet: sheet, headers: headers, col: col, ss: ss, sheets: sheets };
}

/** The journal candidates, shaped like saveWeekPackaging builds them; newUnitCost = target «Цена». */
function tmp97Candidates(state) {
  return state.rows.map(function(r) {
    const parsed = parseTransactionRow(r.values, state.headers);
    return {
      id: parsed.id, opId: parsed.opId, date: parsed.date, kanDay: ozonCostDayFor(parsed.deliveryDate, parsed.date),
      operationDay: String(parsed.date || '').slice(0, 10),
      destination: r.tagOn ? r.objectText.slice(0, -r.spec.tag.length) : r.objectText,
      article: parsed.article, quantity: parsed.quantity,
      oldUnitCost: roundToTwo(Number(parsed.price) || 0), newUnitCost: r.spec.targetPrice / 100
    };
  });
}

function tmp97LogChecks(state) {
  state.checks.forEach(function(c) {
    Logger.log((c.ok ? 'OK    ' : 'FAIL  ') + c.name + (c.ok || !c.detail ? '' : ' -- ' + c.detail));
  });
}

function tmp97RollbackDryRun() {
  const state = tmp97Inspect();
  tmp97LogChecks(state);
  if (state.rows.some(function(r) { return r === null; })) { Logger.log('Some rows were not found: nothing more to show.'); return; }
  state.rows.forEach(function(r) {
    const v = r.values;
    Logger.log('row ' + r.sheetRow + ' ' + r.spec.article + ' ' + r.spec.opId.slice(-2) + ' [' + r.state + ']: Сумма '
      + tmp97Money(tmp97Kop(v[state.col['Сумма']])) + ' → ' + tmp97Money(r.spec.targetSum)
      + '; Цена ' + tmp97Money(tmp97Kop(v[state.col['Цена']])) + ' → ' + tmp97Money(r.spec.targetPrice)
      + '; Объект → ' + (r.tagOn ? r.objectText.slice(0, -r.spec.tag.length) : r.objectText));
  });
  const stale = weekPackagingStaleJournalEntries(tmp97Candidates(state));
  Logger.log('Journal «Себестоимость Озон»: ' + stale.length + ' row(s) would be re-issued (' + TMP97_REASON + ')');
  stale.forEach(function(c) {
    Logger.log('  journal: ' + c.article + ' ' + c.opId.slice(-2) + ' day ' + c.kanDay + ' → unit cost ' + tmp97Money(Math.round(c.newUnitCost * 100)));
  });
  state.sheets.forEach(function(s) {
    Logger.log(s.sheet ? 'sheet «' + s.spec.name + '»: ' + s.count + ' data row(s), would be deleted' : 'sheet «' + s.spec.name + '»: not present');
  });
  Logger.log('Dry run finished. Nothing was written.' + (state.checks.every(function(c) { return c.ok; }) ? '' : ' SOME CHECKS FAILED: apply would refuse.'));
}

function tmp97RollbackApply() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const state = tmp97Inspect();
    tmp97LogChecks(state);
    const failed = state.checks.filter(function(c) { return !c.ok; });
    if (failed.length > 0) throw new Error('Откат отменён, ничего не записано. Не прошла проверка: ' + failed[0].name + (failed[0].detail ? ' (' + failed[0].detail + ')' : ''));

    // a. rows still in the «before» state, cell by cell by header name; Сумма goes last
    let rowsChanged = 0;
    const setCell = function(sheetRow, name, value) { state.sheet.getRange(sheetRow, state.col[name] + 1).setValue(value); };
    state.rows.forEach(function(r) {
      if (r.state !== 'before') return;
      setCell(r.sheetRow, 'Цена', r.spec.targetPrice / 100);
      setCell(r.sheetRow, 'Объект', r.tagOn ? r.objectText.slice(0, -r.spec.tag.length) : r.objectText);
      setCell(r.sheetRow, 'Упаковка недели', '');
      setCell(r.sheetRow, 'Счёт недели', '');
      setCell(r.sheetRow, 'Сумма', r.spec.targetSum / 100);
      rowsChanged += 1;
    });
    SpreadsheetApp.flush();
    Logger.log('Step a: ' + rowsChanged + ' row(s) rewritten.');

    // b. journal: the candidates are re-read from the sheet now; weekPackagingStaleJournalEntries returns only the
    // rows whose latest journal cost differs from the new «Цена», so a finished journal gets nothing again.
    let appended = 0;
    try {
      const fresh = tmp97Inspect();
      const stale = weekPackagingStaleJournalEntries(tmp97Candidates(fresh));
      appended = reissueOzonCostRows(stale, TMP97_REASON).appended;
      Logger.log('Step b: ' + stale.length + ' row(s) stale, ' + appended + ' journal row(s) appended.');
    } catch (e) {
      Logger.log('Step b FAILED, sheets are NOT deleted. Run tmp97RollbackApply again. Error: ' + e);
      return;
    }

    // c. delete the six sheets that still exist
    let deleted = 0;
    state.sheets.forEach(function(s) {
      const sh = state.ss.getSheetByName(s.spec.name);
      if (!sh) return;
      state.ss.deleteSheet(sh);
      deleted += 1;
      Logger.log('Step c: sheet «' + s.spec.name + '» deleted.');
    });

    // d. summary
    Logger.log('Done: rows changed ' + rowsChanged + ', journal rows appended ' + appended + ', sheets deleted ' + deleted + '.');
  } finally {
    lock.releaseLock();
  }
}
