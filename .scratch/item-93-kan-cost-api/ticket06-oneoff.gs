/**
 * Item 93, ticket 06: one-off functions for the owner. NOT part of the app and never pushed by
 * clasp (.claspignore lets only Code.gs / ChinaOrders.gs / appsscript.json out).
 *
 * Paste into a NEW script file of the live Apps Script project (it must already run the current
 * Code.gs) and run by hand, in this order:
 *   1. tmp93FixJournal()   - corrects the journal «Себестоимость Озон»; writes the journal only,
 *                            makes NO request to KAN.
 *   2. tmp93SendBacklog()  - checks that exactly the expected 13 groups are pending, then sends
 *                            them to KAN once through the regular sender.
 * All files of an Apps Script project share one global scope, so Code.gs functions are called
 * directly. Delete this file from the project after step 2.
 */

// applyOzonCostChainOps refuses a source that does not start with «пересчёт».
const TMP93_SOURCE = 'пересчёт: исправление журнала, пункт 93';

// What the sender must find pending after tmp93FixJournal: 13 upserts, no deletes.
const TMP93_EXPECTED_PENDING = [
  { cabinet: 'MaxiStore', article: 'BowlGrayMini_01', date: '2026-09-12', cost: 225.60 },
  { cabinet: 'MaxiStore', article: 'BowlGrayMini_01', date: '2026-09-19', cost: 224.12 },
  { cabinet: 'MaxiStore', article: 'BowlGrayMini_01', date: '2026-09-21', cost: 223.93 },
  { cabinet: 'MaxiStore', article: 'BowlGrayMini_01', date: '2026-09-28', cost: 222.69 },
  { cabinet: 'MaxiStore', article: 'BowlGrayMini_01', date: '2026-10-09', cost: 241.99 },
  { cabinet: 'MaxiStore', article: 'Миска_двойная', date: '2026-09-03', cost: 229.58 },
  { cabinet: 'Mercurius', article: 'Полка_выдв_27см', date: '2026-08-23', cost: 667.50 },
  { cabinet: 'Mercurius', article: 'Полка_выдв_27см', date: '2026-08-25', cost: 659.21 },
  { cabinet: 'Mercurius', article: 'Полка_выдв_27см', date: '2026-09-03', cost: 656.54 },
  { cabinet: 'Mercurius', article: 'Полка_выдв_27см', date: '2026-10-13', cost: 709.51 },
  { cabinet: 'Mercurius', article: 'Полка_выдв_27см', date: '2026-10-17', cost: 710.12 },
  { cabinet: 'Mercurius', article: 'Полка_выдв_27см', date: '2026-10-20', cost: 710.43 },
  { cabinet: 'Mercurius', article: 'Набор_полок_выдв_бел', date: '2026-09-03', cost: 1647.59 }
];

/** Money compared to the kopeck: 225.6 and 225.60000000000002 are the same figure. */
function tmp93Kopecks(value) {
  return Math.round(Number(value) * 100);
}

/** The LAST journal row of one (cabinet, article, day) group, or null. The last row decides the day. */
function tmp93LastRowOfGroup(journal, cabinet, article, date) {
  let last = null;
  journal.forEach(function(r) {
    if (r.cabinet === cabinet && r.article === article && r.date.slice(0, 10) === date) last = r;
  });
  return last;
}

/**
 * Step 1. Drops the OpID-less 12.09 shipment of BowlGrayMini_01 (sheet row 60), re-states the two
 * Полка_выдв_27см shipments from «История», and marks two 03.09 day groups «ошибка» so the sender
 * picks them up. Every check runs BEFORE the first write; a failed check writes nothing.
 */
function tmp93FixJournal() {
  const journalBefore = getOzonCostJournal();

  // Guard 1: never twice.
  if (journalBefore.some(function(r) { return r.source === TMP93_SOURCE; })) {
    throw new Error('Исправление журнала уже сделано — повторно не запускать');
  }

  const problems = [];

  // Guard 2: sheet row 60 is still the OpID-less «отгрузка» of 12.09 that has to go.
  const row60 = journalBefore.filter(function(r) { return r.row === 60; })[0];
  if (!row60) {
    problems.push('в журнале нет строки 60');
  } else {
    if (row60.date.slice(0, 10) !== '2026-09-12') problems.push('строка 60: дата «' + row60.date + '» вместо 2026-09-12');
    if (row60.cabinet !== 'MaxiStore') problems.push('строка 60: кабинет «' + row60.cabinet + '» вместо MaxiStore');
    if (row60.article !== 'BowlGrayMini_01') problems.push('строка 60: артикул «' + row60.article + '» вместо BowlGrayMini_01');
    if (row60.opId !== '') problems.push('строка 60: OpID «' + row60.opId + '» вместо пустого');
    if (row60.source !== 'отгрузка') problems.push('строка 60: источник «' + row60.source + '» вместо «отгрузка»');
    if (tmp93Kopecks(row60.stockBefore) !== tmp93Kopecks(335)) problems.push('строка 60: «Остаток до» ' + row60.stockBefore + ' вместо 335');
    if (tmp93Kopecks(row60.costAfter) !== tmp93Kopecks(222.66)) problems.push('строка 60: «Себестоимость после» ' + row60.costAfter + ' вместо 222.66');
  }

  // Guard 3: the last row of the two 03.09 day groups (sheet rows 48 and 51 at the time of writing)
  // still holds the figure KAN has to be given.
  const dayGroups = [
    { cabinet: 'MaxiStore', article: 'Миска_двойная', date: '2026-09-03', cost: 229.58 },
    { cabinet: 'Mercurius', article: 'Набор_полок_выдв_бел', date: '2026-09-03', cost: 1647.59 }
  ];
  const dayRows = dayGroups.map(function(g) {
    const last = tmp93LastRowOfGroup(journalBefore, g.cabinet, g.article, g.date);
    const name = g.cabinet + ' / ' + g.article + ' / ' + g.date;
    if (!last) problems.push(name + ': в журнале нет такого дня');
    else if (tmp93Kopecks(last.costAfter) !== tmp93Kopecks(g.cost)) {
      problems.push(name + ': в последней строке (' + last.row + ') «Себестоимость после» ' + last.costAfter + ' вместо ' + g.cost);
    }
    return last;
  });

  if (problems.length > 0) {
    throw new Error('Журнал не такой, как ожидалось, ничего не записано: ' + problems.join('; ') + '.');
  }

  // The three KAN columns, exactly as runKanCostSend makes sure of them. Done before the journal
  // writes on purpose: ensureColumns returns quietly when it cannot get the script lock, and a
  // failure after the writes would leave the journal half-fixed behind guard 1.
  const sheet = getOzonCostSheet(getSpreadsheet());
  ensureColumns(sheet, OZON_COST_HEADERS.concat(OZON_COST_KAN_HEADERS));
  const headers = readHeaderRow(sheet);
  if (OZON_COST_KAN_HEADERS.some(function(h) { return headers.indexOf(h) === -1; })) {
    throw new Error('Не удалось добавить колонки «Статус КАН», «Ответ КАН», «Время КАН» — ничего не записано, запустите ещё раз.');
  }
  const colStatus = headers.indexOf(OZON_COST_KAN_HEADERS[0]) + 1;
  const colAnswer = headers.indexOf(OZON_COST_KAN_HEADERS[1]) + 1;

  const lastRowBefore = journalBefore[journalBefore.length - 1].row;

  // BowlGrayMini_01 / MaxiStore: drop the OpID-less shipment of row 60.
  applyOzonCostChainOps('MaxiStore', 'BowlGrayMini_01', { 'row:60': { drop: true } }, TMP93_SOURCE);
  // Полка_выдв_27см / Mercurius: ONE call with both OpIDs — two separate calls pass through a wrong intermediate state.
  resyncOzonCostForOps(['444547eb-2c66-4b35-82d2-c432d7b1dd67', 'fe030a3b-1f2d-4c01-9e81-4c15dc7114a7'], TMP93_SOURCE);

  // The two legacy-stamped 03.09 days: status «ошибка» makes them pending. «Время КАН» stays empty,
  // columns 1–12 are never touched.
  dayRows.forEach(function(r) {
    sheet.getRange(r.row, colStatus).setValue(KAN_COST_STATUS.ERROR);
    sheet.getRange(r.row, colAnswer).setValue('разовая отправка, пункт 93: в КАН другое значение');
  });
  SpreadsheetApp.flush();

  // Summary.
  const journalAfter = getOzonCostJournal();
  const appendedPerArticle = {};
  journalAfter.forEach(function(r) {
    if (r.row <= lastRowBefore) return;
    const name = r.cabinet + ' / ' + r.article;
    appendedPerArticle[name] = (appendedPerArticle[name] || 0) + 1;
  });
  Logger.log('Добавлено строк в журнал:');
  Object.keys(appendedPerArticle).forEach(function(name) { Logger.log('  ' + name + ': ' + appendedPerArticle[name]); });

  [{ cabinet: 'MaxiStore', article: 'BowlGrayMini_01' }, { cabinet: 'Mercurius', article: 'Полка_выдв_27см' }].forEach(function(c) {
    const lastOfDay = {};
    const days = [];
    journalAfter.forEach(function(r) {
      if (r.cabinet !== c.cabinet || r.article !== c.article) return;
      const day = r.date.slice(0, 10);
      if (!lastOfDay[day]) days.push(day);
      lastOfDay[day] = r;
    });
    days.sort();
    Logger.log('Последняя строка каждого дня, ' + c.cabinet + ' / ' + c.article + ':');
    days.forEach(function(day) {
      const r = lastOfDay[day];
      Logger.log('  ' + day + ': ' + (isOzonCostDropRow(r) ? 'день удалён (маркер)' : 'себестоимость после ' + r.costAfter));
    });
  });

  Logger.log('Помечены «' + KAN_COST_STATUS.ERROR + '» (отправятся в КАН):');
  dayRows.forEach(function(r) {
    Logger.log('  строка ' + r.row + ': ' + r.cabinet + ' / ' + r.article + ' / ' + r.date.slice(0, 10) + ', себестоимость после ' + r.costAfter);
  });
  Logger.log('Готово. Следующий шаг: tmp93SendBacklog.');
}

/**
 * Step 2. Sends the pending groups to KAN once — but only when the pending set is EXACTLY
 * TMP93_EXPECTED_PENDING. Any difference (extra group, missing group, other cost, a delete)
 * throws before anything leaves for KAN.
 */
function tmp93SendBacklog() {
  // The groups exactly as the sender will see them: no age cut, every pending group.
  const pending = collectOzonCostKanGroups(getOzonCostJournal()).pending;

  const problems = [];
  const expectedByKey = {};
  TMP93_EXPECTED_PENDING.forEach(function(e) { expectedByKey[e.cabinet + '|' + e.article + '|' + e.date] = e; });

  const pendingKeys = {};
  pending.forEach(function(g) {
    const key = g.cabinet + '|' + g.article + '|' + g.date;
    pendingKeys[key] = true;
    const expected = expectedByKey[key];
    if (!expected) {
      problems.push('лишняя группа ' + key + ' (' + (g.action === 'upsert' ? 'себестоимость ' + g.cost : 'удаление') + ')');
    } else if (g.action !== 'upsert') {
      problems.push(key + ': в очереди удаление вместо себестоимости ' + expected.cost);
    } else if (tmp93Kopecks(g.cost) !== tmp93Kopecks(expected.cost)) {
      problems.push(key + ': себестоимость ' + g.cost + ' вместо ' + expected.cost);
    }
  });
  Object.keys(expectedByKey).forEach(function(key) {
    if (!pendingKeys[key]) problems.push('нет в очереди ' + key);
  });
  if (problems.length > 0) {
    throw new Error('Очередь отправки в КАН не такая, как ожидалось, ничего не отправлено: ' + problems.join('; ') + '.');
  }

  const r = sendOzonCostToKan('пункт 93 разовая отправка');
  Logger.log(JSON.stringify(r));
  if (r.busy) {
    Logger.log('Ничего не отправлено, отправитель занят: ' + r.message);
    return;
  }
  Logger.log('КАН принял: ' + r.accepted.length + ', не принял: ' + r.failed.length + '.');
  r.failed.forEach(function(g) {
    Logger.log('  не принято: ' + g.cabinet + ' / ' + g.article + ' / ' + g.date + ' — ' + g.reason);
  });
  if (r.notWritten > 0) Logger.log('Строк журнала, где статус не записан: ' + r.notWritten + ' (они отправятся снова).');
}
