'use strict';

const results = [];
// Owner, 2026-09-25: less output while working. GAS_ONLY=<text> prints only the checks whose
// name contains <text>; GAS_QUIET=1 prints none. Every check still runs and a failure is
// ALWAYS printed, so a mutation that breaks something elsewhere is never hidden.
const GAS_ONLY = process.env.GAS_ONLY || '';
const GAS_QUIET = process.env.GAS_QUIET === '1';
function check(name, condition, details) {
  results.push({ name, ok: !!condition, details });
  const shown = !condition || (!GAS_QUIET && (!GAS_ONLY || String(name).indexOf(GAS_ONLY) !== -1));
  if (shown) console.log((condition ? 'OK    ' : 'ПРОВАЛ') + '  ' + name + (details ? ('  -- ' + details) : ''));
}

// Собирает finalRows/headers в формате листа "Остатки Ozon" (OZON_STOCKS_HEADERS)
// из компактного описания сочетаний Кабинет+Артикул+КластерID (с возможностью
// нескольких складов на одно сочетание — для проверки свёртки в кластер).
function buildFinalRows(headers, combos) {
  const idx = (name) => headers.indexOf(name);
  const rows = [];
  combos.forEach(combo => {
    combo.warehouses.forEach(w => {
      const row = new Array(headers.length).fill('');
      row[idx('Кабинет')] = combo.cabinet;
      row[idx('SKU')] = combo.sku || (combo.article + '-sku');
      row[idx('Артикул')] = combo.article;
      row[idx('Название')] = combo.name || combo.article;
      row[idx('Склад')] = w.warehouse;
      row[idx('Кластер')] = combo.clusterName;
      row[idx('Доступно')] = w.available || 0;
      row[idx('Готовим к продаже')] = 0;
      row[idx('В заявках')] = 0;
      row[idx('В пути')] = w.transit || 0;
      row[idx('Излишки')] = 0;
      row[idx('Возвраты')] = 0;
      row[idx('Прочее')] = 0;
      row[idx('Обновлено')] = '';
      row[idx('КластерID')] = combo.clusterId;
      rows.push(row);
    });
  });
  return rows;
}

function findHistoryRow(history, headers, cabinet, article, clusterId, week) {
  const wi = headers.indexOf('Неделя');
  const ci = headers.indexOf('Кабинет');
  const ai = headers.indexOf('Артикул');
  const cli = headers.indexOf('КластерID');
  return history.find(r =>
    String(r[ci]) === cabinet && String(r[ai]) === article && String(r[cli]) === clusterId &&
    String(r[wi]) === week
  );
}

function main() {
  const HDR = require('./harness.cjs').OZON_STOCKS_HEADERS; // захватим headers один раз ниже через свежий модуль
}

// Каждый пункт получает СВОЙ свежий экземпляр стенда (require заново через delete кэша),
// чтобы тесты не влияли друг на друга.
function freshHarness() {
  const modPath = require.resolve('./harness.cjs');
  delete require.cache[modPath];
  return require('./harness.cjs');
}

// ================= Пункт 1: первый запуск дня =================
(function test1() {
  const h = freshHarness();
  const stockHeaders = h.OZON_STOCKS_HEADERS;
  h.setNow('2026-01-05T09:00:00Z'); // понедельник 12:00 МСК
  const combos = [
    { cabinet: 'Cab1', article: 'ART1', clusterId: 'CL1', clusterName: 'Центр', warehouses: [{ warehouse: 'W1', available: 5, transit: 0 }] },
    { cabinet: 'Cab1', article: 'ART2', clusterId: 'CL1', clusterName: 'Центр', warehouses: [{ warehouse: 'W1', available: 0, transit: 3 }] },
    { cabinet: 'Cab1', article: 'ART3', clusterId: 'CL1', clusterName: 'Центр', warehouses: [{ warehouse: 'W1', available: 0, transit: 0 }] }
  ];
  const rows = buildFinalRows(stockHeaders, combos);
  h.updateOzonStockHistory(rows, stockHeaders);

  const hist = h.dumpHistory();
  const H = h.OZON_STOCK_HISTORY_HEADERS;
  const week = '2026-01-05';
  const today = '2026-01-05';

  check('П1: создано ровно 3 строки текущей недели', hist.length === 3, `фактически строк: ${hist.length}`);

  const r1 = findHistoryRow(hist, H, 'Cab1', 'ART1', 'CL1', week);
  const r2 = findHistoryRow(hist, H, 'Cab1', 'ART2', 'CL1', week);
  const r3 = findHistoryRow(hist, H, 'Cab1', 'ART3', 'CL1', week);
  const dAvail = H.indexOf('Дней в наличии'), dObs = H.indexOf('Дней наблюдений'), lastDay = H.indexOf('Последний учтённый день');

  check('П1: ART1 (Доступно=5) Дней в наличии=1', r1 && Number(r1[dAvail]) === 1, `получено: ${r1 && r1[dAvail]}`);
  check('П1: ART2 (В пути=3) Дней в наличии=1', r2 && Number(r2[dAvail]) === 1, `получено: ${r2 && r2[dAvail]}`);
  check('П1: ART3 (нулевой остаток) Дней в наличии=0', r3 && Number(r3[dAvail]) === 0, `получено: ${r3 && r3[dAvail]}`);
  check('П1: у всех Дней наблюдений=1', [r1, r2, r3].every(r => Number(r[dObs]) === 1), `получено: ${[r1, r2, r3].map(r => r[dObs])}`);
  check('П1: у всех Последний учтённый день=сегодня', [r1, r2, r3].every(r => r[lastDay] === today), `получено: ${[r1, r2, r3].map(r => r[lastDay])}`);

  module.exports.h1 = h; // сохраним для использования в пункте 2 (тот же лист)
})();

// ================= Пункт 2: второй запуск в тот же день (идемпотентность) =================
(function test2() {
  const h = freshHarness();
  const stockHeaders = h.OZON_STOCKS_HEADERS;
  h.setNow('2026-01-05T09:00:00Z');
  const combos = [
    { cabinet: 'Cab1', article: 'ART1', clusterId: 'CL1', clusterName: 'Центр', warehouses: [{ warehouse: 'W1', available: 5, transit: 0 }] },
    { cabinet: 'Cab1', article: 'ART2', clusterId: 'CL1', clusterName: 'Центр', warehouses: [{ warehouse: 'W1', available: 0, transit: 3 }] },
    { cabinet: 'Cab1', article: 'ART3', clusterId: 'CL1', clusterName: 'Центр', warehouses: [{ warehouse: 'W1', available: 0, transit: 0 }] }
  ];
  const rows = buildFinalRows(stockHeaders, combos);
  h.updateOzonStockHistory(rows, stockHeaders); // 1-й вызов
  const histAfter1 = JSON.parse(JSON.stringify(h.dumpHistory()));

  h.setNow('2026-01-05T20:00:00Z'); // тот же день, но вечером (второй прогон автоопроса)
  h.updateOzonStockHistory(rows, stockHeaders); // 2-й вызов, те же данные
  const histAfter2 = h.dumpHistory();

  check('П2: строк по-прежнему 3', histAfter2.length === 3, `фактически строк: ${histAfter2.length}`);
  check('П2: содержимое листа не изменилось (счётчики и даты идентичны)',
    JSON.stringify(histAfter1.sort()) === JSON.stringify(histAfter2.sort()),
    `до: ${JSON.stringify(histAfter1)} после: ${JSON.stringify(histAfter2)}`);

  module.exports.h2 = h;
})();

// ================= Пункт 3: следующий день =================
(function test3() {
  const h = freshHarness();
  const stockHeaders = h.OZON_STOCKS_HEADERS;
  const H = h.OZON_STOCK_HISTORY_HEADERS;
  h.setNow('2026-01-05T09:00:00Z');
  const combos = [
    { cabinet: 'Cab1', article: 'ART1', clusterId: 'CL1', clusterName: 'Центр', warehouses: [{ warehouse: 'W1', available: 5, transit: 0 }] },
    { cabinet: 'Cab1', article: 'ART2', clusterId: 'CL1', clusterName: 'Центр', warehouses: [{ warehouse: 'W1', available: 0, transit: 3 }] },
    { cabinet: 'Cab1', article: 'ART3', clusterId: 'CL1', clusterName: 'Центр', warehouses: [{ warehouse: 'W1', available: 0, transit: 0 }] }
  ];
  const rows = buildFinalRows(stockHeaders, combos);
  h.updateOzonStockHistory(rows, stockHeaders); // день 1

  h.setNow('2026-01-06T09:00:00Z'); // следующий день, та же неделя (вторник)
  h.updateOzonStockHistory(rows, stockHeaders); // день 2

  const hist = h.dumpHistory();
  const week = '2026-01-05';
  const r1 = findHistoryRow(hist, H, 'Cab1', 'ART1', 'CL1', week);
  const r2 = findHistoryRow(hist, H, 'Cab1', 'ART2', 'CL1', week);
  const r3 = findHistoryRow(hist, H, 'Cab1', 'ART3', 'CL1', week);
  const dAvail = H.indexOf('Дней в наличии'), dObs = H.indexOf('Дней наблюдений');

  check('П3: строк по-прежнему 3 (та же неделя)', hist.length === 3, `фактически строк: ${hist.length}`);
  check('П3: Дней наблюдений=2 у всех', [r1, r2, r3].every(r => Number(r[dObs]) === 2), `получено: ${[r1, r2, r3].map(r => r[dObs])}`);
  check('П3: Дней в наличии=2 у ART1 и ART2', Number(r1[dAvail]) === 2 && Number(r2[dAvail]) === 2, `ART1=${r1[dAvail]}, ART2=${r2[dAvail]}`);
  check('П3: Дней в наличии=0 у ART3', Number(r3[dAvail]) === 0, `получено: ${r3[dAvail]}`);
})();

// ================= Пункт 4: регресс на объект Date вместо строки =================
(function test4() {
  const h = freshHarness();
  const stockHeaders = h.OZON_STOCKS_HEADERS;
  const H = h.OZON_STOCK_HISTORY_HEADERS;
  h.setNow('2026-01-05T09:00:00Z');
  const combos = [
    { cabinet: 'Cab1', article: 'ART1', clusterId: 'CL1', clusterName: 'Центр', warehouses: [{ warehouse: 'W1', available: 5, transit: 0 }] }
  ];
  const rows = buildFinalRows(stockHeaders, combos);
  h.updateOzonStockHistory(rows, stockHeaders); // создаём строку недели

  const beforeMutation = h.dumpHistory();
  const weekIdx = H.indexOf('Неделя'), lastDayIdx = H.indexOf('Последний учтённый день');
  const dObs = H.indexOf('Дней наблюдений'), dAvail = H.indexOf('Дней в наличии');
  const obsBefore = Number(beforeMutation[0][dObs]);
  const availBefore = Number(beforeMutation[0][dAvail]);

  // Симулируем поведение Google Sheets: значения колонок "Неделя" и "Последний учтённый день"
  // при повторном чтении листа приходят как объекты Date того же дня, а не строки yyyy-MM-dd.
  const sheet = h.getHistorySheet();
  const raw = sheet.__dump();
  const dataRowIdx = raw.findIndex((r, i) => i > 0 && String(r[H.indexOf('Кабинет')]) === 'Cab1');
  const DateCtor = h.context.Date;
  raw[dataRowIdx][weekIdx] = new DateCtor('2026-01-05T00:00:00Z');
  raw[dataRowIdx][lastDayIdx] = new DateCtor('2026-01-05T00:00:00Z');
  sheet.__setData(raw);

  // Повторный вызов в тот же день с теми же данными.
  h.updateOzonStockHistory(rows, stockHeaders);

  const after = h.dumpHistory();
  check('П4: строк по-прежнему 1 (не задвоилась строка недели)', after.length === 1, `фактически строк: ${after.length}`);
  const obsAfter = Number(after[0][dObs]);
  const availAfter = Number(after[0][dAvail]);
  check('П4: Дней наблюдений не выросло из-за Date-ячейки', obsAfter === obsBefore, `было: ${obsBefore}, стало: ${obsAfter}`);
  check('П4: Дней в наличии не выросло из-за Date-ячейки', availAfter === availBefore, `было: ${availBefore}, стало: ${availAfter}`);
})();

// ================= Пункт 5: новая неделя =================
(function test5() {
  const h = freshHarness();
  const stockHeaders = h.OZON_STOCKS_HEADERS;
  const H = h.OZON_STOCK_HISTORY_HEADERS;
  h.setNow('2026-01-05T09:00:00Z'); // неделя 1: понедельник 2026-01-05
  const combos = [
    { cabinet: 'Cab1', article: 'ART1', clusterId: 'CL1', clusterName: 'Центр', warehouses: [{ warehouse: 'W1', available: 5, transit: 0 }] }
  ];
  const rows = buildFinalRows(stockHeaders, combos);
  h.updateOzonStockHistory(rows, stockHeaders);
  h.setNow('2026-01-06T09:00:00Z');
  h.updateOzonStockHistory(rows, stockHeaders); // 2 дня наблюдений на неделе 1

  const week1Snapshot = JSON.parse(JSON.stringify(h.dumpHistory().find(r => r[H.indexOf('Неделя')] === '2026-01-05')));

  h.setNow('2026-01-12T09:00:00Z'); // +7 дней -> новая неделя, понедельник 2026-01-12
  h.updateOzonStockHistory(rows, stockHeaders);

  const hist = h.dumpHistory();
  const week1After = hist.find(r => r[H.indexOf('Неделя')] === '2026-01-05');
  const week2After = hist.find(r => r[H.indexOf('Неделя')] === '2026-01-12');

  check('П5: появилась строка новой недели 2026-01-12', !!week2After, `найдено недель: ${hist.map(r => r[H.indexOf('Неделя')])}`);
  check('П5: строка прошлой недели осталась (2 строки всего)', hist.length === 2, `фактически строк: ${hist.length}`);
  check('П5: счётчики прошлой недели не изменились', JSON.stringify(week1After) === JSON.stringify(week1Snapshot),
    `было: ${JSON.stringify(week1Snapshot)}, стало: ${JSON.stringify(week1After)}`);
  check('П5: у новой недели Дней наблюдений=1', week2After && Number(week2After[H.indexOf('Дней наблюдений')]) === 1,
    `получено: ${week2After && week2After[H.indexOf('Дней наблюдений')]}`);
})();

// ================= Пункт 6: срок хранения =================
// Item 86 step A (2026-09-26): the speed calculation looks back 26 weeks, so the effective
// retention is now max(setting, 26) — a setting below 26 no longer shortens the kept history,
// it can only extend it.
(function test6() {
  function makeOldRow(H, week, article) {
    const row = new Array(H.length).fill('');
    row[H.indexOf('Неделя')] = week;
    row[H.indexOf('Кабинет')] = 'Cab1';
    row[H.indexOf('Артикул')] = article;
    row[H.indexOf('КластерID')] = 'CL1';
    row[H.indexOf('Кластер')] = 'Центр';
    row[H.indexOf('Дней в наличии')] = 3;
    row[H.indexOf('Дней наблюдений')] = 5;
    row[H.indexOf('Последний учтённый день')] = week;
    row[H.indexOf('Обновлено')] = week + ' 10:00:00';
    return row;
  }
  const combos = [
    { cabinet: 'Cab1', article: 'ART1', clusterId: 'CL1', clusterName: 'Центр', warehouses: [{ warehouse: 'W1', available: 5, transit: 0 }] }
  ];

  // Настройка (15) НИЖЕ пола (26): пол побеждает -- строка 20 недель назад сохранена,
  // строка 27 недель назад (за полом) удалена.
  const h = freshHarness();
  const stockHeaders = h.OZON_STOCKS_HEADERS;
  const H = h.OZON_STOCK_HISTORY_HEADERS;
  h.setRetentionWeeks(15);
  h.setNow('2026-06-01T09:00:00Z'); // понедельник, текущая неделя
  const todayStr = h.context.Utilities.formatDate(new h.context.Date(), 'Europe/Moscow', 'yyyy-MM-dd');
  const curMonday = h.context.getIsoWeekMonday(todayStr);
  const week20Ago = h.context.shiftIsoWeek(curMonday, -20);
  const week27Ago = h.context.shiftIsoWeek(curMonday, -27);
  h.setHistoryRaw([makeOldRow(H, week20Ago, 'ART20AGO'), makeOldRow(H, week27Ago, 'ART27AGO')]);
  h.updateOzonStockHistory(buildFinalRows(stockHeaders, combos), stockHeaders);

  const hist = h.dumpHistory();
  const kept20 = hist.find(r => r[H.indexOf('Артикул')] === 'ART20AGO');
  const kept27 = hist.find(r => r[H.indexOf('Артикул')] === 'ART27AGO');
  const curRow = hist.find(r => r[H.indexOf('Артикул')] === 'ART1');

  check('П6: setting=15 ниже пола 26 -- строка 20 недель назад сохранена (пол защищает)', !!kept20, `осталась ли ART20AGO: ${!!kept20}`);
  check('П6: setting=15 ниже пола 26 -- строка 27 недель назад удалена (старше пола)', !kept27, `осталась ли ART27AGO: ${!!kept27}`);
  check('П6: текущая неделя на месте', !!curRow, `curRow найден: ${!!curRow}`);

  // Настройка (40) ВЫШЕ пола: настройка соблюдена -- строка 35 недель назад сохранена
  // (при поле 26 она была бы удалена), а строка 41 недель назад всё равно удалена.
  const h2 = freshHarness();
  h2.setRetentionWeeks(40);
  h2.setNow('2026-06-01T09:00:00Z');
  const week35Ago = h2.context.shiftIsoWeek(curMonday, -35);
  const week41Ago = h2.context.shiftIsoWeek(curMonday, -41);
  h2.setHistoryRaw([makeOldRow(H, week35Ago, 'ART35AGO'), makeOldRow(H, week41Ago, 'ART41AGO')]);
  h2.updateOzonStockHistory(buildFinalRows(h2.OZON_STOCKS_HEADERS, combos), h2.OZON_STOCKS_HEADERS);
  const hist2 = h2.dumpHistory();
  const kept35 = hist2.find(r => r[H.indexOf('Артикул')] === 'ART35AGO');
  const kept41 = hist2.find(r => r[H.indexOf('Артикул')] === 'ART41AGO');

  check('П6: setting=40 выше пола -- строка 35 недель назад сохранена (настройка соблюдена)', !!kept35, `осталась ли ART35AGO: ${!!kept35}`);
  check('П6: setting=40 выше пола -- строка 41 недель назад всё равно удалена', !kept41, `осталась ли ART41AGO: ${!!kept41}`);
})();

// ================= Пункт 7: новое сочетание среди недели =================
(function test7() {
  const h = freshHarness();
  const stockHeaders = h.OZON_STOCKS_HEADERS;
  const H = h.OZON_STOCK_HISTORY_HEADERS;
  h.setNow('2026-01-05T09:00:00Z'); // день 1
  const combosDay1 = [
    { cabinet: 'Cab1', article: 'ART1', clusterId: 'CL1', clusterName: 'Центр', warehouses: [{ warehouse: 'W1', available: 5, transit: 0 }] }
  ];
  h.updateOzonStockHistory(buildFinalRows(stockHeaders, combosDay1), stockHeaders);

  h.setNow('2026-01-06T09:00:00Z'); // день 2, то же сочетание
  h.updateOzonStockHistory(buildFinalRows(stockHeaders, combosDay1), stockHeaders);

  h.setNow('2026-01-07T09:00:00Z'); // день 3: добавляем НОВОЕ сочетание ART2
  const combosDay3 = [
    { cabinet: 'Cab1', article: 'ART1', clusterId: 'CL1', clusterName: 'Центр', warehouses: [{ warehouse: 'W1', available: 5, transit: 0 }] },
    { cabinet: 'Cab1', article: 'ART2', clusterId: 'CL1', clusterName: 'Центр', warehouses: [{ warehouse: 'W1', available: 7, transit: 0 }] }
  ];
  h.updateOzonStockHistory(buildFinalRows(stockHeaders, combosDay3), stockHeaders);

  const hist = h.dumpHistory();
  const r1 = findHistoryRow(hist, H, 'Cab1', 'ART1', 'CL1', '2026-01-05');
  const r2 = findHistoryRow(hist, H, 'Cab1', 'ART2', 'CL1', '2026-01-05');
  const dObs = H.indexOf('Дней наблюдений');

  check('П7: у старого сочетания ART1 Дней наблюдений=3', r1 && Number(r1[dObs]) === 3, `получено: ${r1 && r1[dObs]}`);
  check('П7: у нового сочетания ART2 Дней наблюдений=1 (не 3)', r2 && Number(r2[dObs]) === 1, `получено: ${r2 && r2[dObs]}`);
})();

// ================= Пункт 8: свёртка складов в кластер =================
(function test8() {
  const h = freshHarness();
  const stockHeaders = h.OZON_STOCKS_HEADERS;
  const H = h.OZON_STOCK_HISTORY_HEADERS;
  h.setNow('2026-01-05T09:00:00Z');
  const combos = [
    {
      cabinet: 'Cab1', article: 'ART1', clusterId: 'CL1', clusterName: 'Центр',
      warehouses: [
        { warehouse: 'WarehouseA', available: 0, transit: 0 },
        { warehouse: 'WarehouseB', available: 5, transit: 0 }
      ]
    }
  ];
  const rows = buildFinalRows(stockHeaders, combos);
  h.updateOzonStockHistory(rows, stockHeaders);

  const hist = h.dumpHistory();
  const matching = hist.filter(r => String(r[H.indexOf('Артикул')]) === 'ART1');
  const dAvail = H.indexOf('Дней в наличии');

  check('П8: ровно одна строка истории на сочетание (склады свёрнуты)', matching.length === 1, `фактически строк: ${matching.length}`);
  check('П8: остаток признан "в наличии" (сумма по складам 0+5=5>0)', matching[0] && Number(matching[0][dAvail]) === 1,
    `получено Дней в наличии: ${matching[0] && matching[0][dAvail]}`);
})();

// ============================================================================
// Проверки updateSkuNamesFromOzonStocks() — дублирование названий Ozon в лист
// SKU, чтобы название переживало распродажу товара в ноль (лист "Остатки Ozon"
// перезаписывается целиком, и у распроданной позиции строки остатков просто нет).
// ============================================================================

// Заголовки листа SKU, которые ensureColumns требует внутри проверяемой функции.
// Порядок и состав скопированы из вызова ensureColumns в Code.gs — если там
// список изменится, тест не заметит новые поля (это нормально: они здесь не при делах),
// но должен продолжать работать, т.к. ensureColumns лишь ДОБАВЛЯЕТ недостающие колонки.
const SKU_FULL_HEADERS = ['SKU', 'ШТ/КОР', 'Мин. остаток', 'ШК Ozon', 'Баркод WB', 'КОР/ПАЛ', 'Литраж (л)', 'Срок поставки (дни)', 'Название Ozon'];
const SKU_HEADERS_WITHOUT_NAME = SKU_FULL_HEADERS.filter(h => h !== 'Название Ozon');

// Строит строку листа SKU по названиям колонок (аналог buildFinalRows выше, но по объекту).
function buildSkuRow(headers, obj) {
  const row = new Array(headers.length).fill('');
  Object.keys(obj).forEach(key => {
    const idx = headers.indexOf(key);
    if (idx !== -1) row[idx] = obj[key];
  });
  return row;
}

// ================= Пункт 9: колонки "Название Ozon" в листе SKU ещё нет =================
(function test9() {
  const h = freshHarness();
  h.setSkuSheet(SKU_HEADERS_WITHOUT_NAME, [
    buildSkuRow(SKU_HEADERS_WITHOUT_NAME, { SKU: 'ART1', 'ШК Ozon': '111' }),
    buildSkuRow(SKU_HEADERS_WITHOUT_NAME, { SKU: 'ART2', 'ШК Ozon': '222' })
  ]);
  const rows = [
    { offerId: 'ART1', sku: '111', name: 'Товар 1' },
    { offerId: 'ART2', sku: '222', name: 'Товар 2' }
  ];
  h.updateSkuNamesFromOzonStocks(rows);

  const dump = h.dumpSkuSheet();
  const nameIdx = dump.headers.indexOf('Название Ozon');

  check('П9: колонка "Название Ozon" появилась в листе', nameIdx !== -1, `заголовки: ${dump.headers}`);
  check('П9: название ART1 проставлено', nameIdx !== -1 && dump.rows[0][nameIdx] === 'Товар 1', `получено: ${nameIdx !== -1 && dump.rows[0][nameIdx]}`);
  check('П9: название ART2 проставлено', nameIdx !== -1 && dump.rows[1][nameIdx] === 'Товар 2', `получено: ${nameIdx !== -1 && dump.rows[1][nameIdx]}`);
})();

// ================= Пункт 10: товар распродан (в rows его нет) — название в листе НЕ стирается =================
(function test10() {
  const h = freshHarness();
  h.setSkuSheet(SKU_FULL_HEADERS, [
    buildSkuRow(SKU_FULL_HEADERS, { SKU: 'ART1', 'ШК Ozon': '111', 'Название Ozon': 'Уже сохранённое название' })
  ]);
  // В выгрузке остатков есть данные, но только по ДРУГОМУ товару — ART1 распродан в ноль
  // и его строки в "Остатки Ozon" не существует вовсе, поэтому в rows его тоже нет.
  const rows = [
    { offerId: 'ДРУГОЙ-АРТИКУЛ', sku: '999', name: 'Другой товар' }
  ];
  h.getSkuSheet().__resetSetValuesCallCount();
  h.updateSkuNamesFromOzonStocks(rows);

  const dump = h.dumpSkuSheet();
  const nameIdx = dump.headers.indexOf('Название Ozon');

  check('П10: название распроданного товара ОСТАЛОСЬ прежним', dump.rows[0][nameIdx] === 'Уже сохранённое название', `получено: ${dump.rows[0][nameIdx]}`);
  check('П10: запись в лист не выполнялась (нечего менять)', h.getSkuSheet().__getSetValuesCallCount() === 0, `вызовов setValues: ${h.getSkuSheet().__getSetValuesCallCount()}`);
})();

// ================= Пункт 11: название в Ozon изменилось — в листе обновилось на новое =================
(function test11() {
  const h = freshHarness();
  h.setSkuSheet(SKU_FULL_HEADERS, [
    buildSkuRow(SKU_FULL_HEADERS, { SKU: 'ART1', 'ШК Ozon': '111', 'Название Ozon': 'Старое название' })
  ]);
  const rows = [{ offerId: 'ART1', sku: '111', name: 'Новое название' }];
  h.updateSkuNamesFromOzonStocks(rows);

  const dump = h.dumpSkuSheet();
  const nameIdx = dump.headers.indexOf('Название Ozon');
  check('П11: название обновилось на новое', dump.rows[0][nameIdx] === 'Новое название', `получено: ${dump.rows[0][nameIdx]}`);
})();

// ================= Пункт 12: ничего не изменилось — в лист не было НИ ОДНОЙ записи =================
(function test12() {
  const h = freshHarness();
  h.setSkuSheet(SKU_FULL_HEADERS, [
    buildSkuRow(SKU_FULL_HEADERS, { SKU: 'ART1', 'ШК Ozon': '111', 'Название Ozon': 'Имя без изменений' })
  ]);
  const rows = [{ offerId: 'ART1', sku: '111', name: 'Имя без изменений' }];
  h.getSkuSheet().__resetSetValuesCallCount();
  h.updateSkuNamesFromOzonStocks(rows);

  check('П12: setValues на лист SKU не вызывался ни разу', h.getSkuSheet().__getSetValuesCallCount() === 0, `вызовов setValues: ${h.getSkuSheet().__getSetValuesCallCount()}`);
})();

// ================= Пункт 13: связывание по ШК Ozon, когда артикул в листе не совпадает с offerId =================
(function test13() {
  const h = freshHarness();
  h.setSkuSheet(SKU_FULL_HEADERS, [
    // Внутренний артикул склада не похож на offerId Ozon — связь возможна только по ШК Ozon.
    buildSkuRow(SKU_FULL_HEADERS, { SKU: 'ВНУТРЕННИЙ-КОД-42', 'ШК Ozon': '555555', 'Название Ozon': '' })
  ]);
  const rows = [{ offerId: 'OZON-OFFER-XYZ', sku: '555555', name: 'Связано по ШК Ozon' }];
  h.updateSkuNamesFromOzonStocks(rows);

  const dump = h.dumpSkuSheet();
  const nameIdx = dump.headers.indexOf('Название Ozon');
  check('П13: название подставилось по совпадению ШК Ozon (артикулы разные)', dump.rows[0][nameIdx] === 'Связано по ШК Ozon', `получено: ${dump.rows[0][nameIdx]}`);
})();

// ================= Пункт 14: ШК Ozon приходит числом, в листе тоже хранится числом =================
(function test14() {
  const h = freshHarness();
  h.setSkuSheet(SKU_FULL_HEADERS, [
    buildSkuRow(SKU_FULL_HEADERS, { SKU: 'НЕ-СОВПАДАЕТ', 'ШК Ozon': 777777, 'Название Ozon': '' })
  ]);
  const rows = [{ offerId: 'ANY-OFFER', sku: 777777, name: 'Числовой ШК связался' }];
  h.updateSkuNamesFromOzonStocks(rows);

  const dump = h.dumpSkuSheet();
  const nameIdx = dump.headers.indexOf('Название Ozon');
  check('П14: связывание по ШК Ozon работает при числовых типах с обеих сторон', dump.rows[0][nameIdx] === 'Числовой ШК связался', `получено: ${dump.rows[0][nameIdx]}`);
})();

// ================= Пункт 15: в листе SKU ШК Ozon = '0' ("баркода нет") — связывания НЕ происходит =================
(function test15() {
  const h = freshHarness();
  h.setSkuSheet(SKU_FULL_HEADERS, [
    buildSkuRow(SKU_FULL_HEADERS, { SKU: 'АРТИКУЛ-БЕЗ-БАРКОДА', 'ШК Ozon': '0', 'Название Ozon': '' })
  ]);
  // Чужой товар случайно тоже пришёл с sku='0' -- по этому ключу подстановки быть не должно.
  const rows = [{ offerId: 'ЧУЖОЙ-АРТИКУЛ', sku: '0', name: 'Чужое название не должно подставиться' }];
  h.getSkuSheet().__resetSetValuesCallCount();
  h.updateSkuNamesFromOzonStocks(rows);

  const dump = h.dumpSkuSheet();
  const nameIdx = dump.headers.indexOf('Название Ozon');
  check('П15: название по ключу ШК Ozon="0" НЕ подставилось', dump.rows[0][nameIdx] === '', `получено: ${dump.rows[0][nameIdx]}`);
  check('П15: запись в лист не выполнялась', h.getSkuSheet().__getSetValuesCallCount() === 0, `вызовов setValues: ${h.getSkuSheet().__getSetValuesCallCount()}`);
})();

// ================= Пункт 16: пустое название в rows не затирает уже сохранённое =================
(function test16() {
  const h = freshHarness();
  h.setSkuSheet(SKU_FULL_HEADERS, [
    buildSkuRow(SKU_FULL_HEADERS, { SKU: 'ART1', 'ШК Ozon': '111', 'Название Ozon': 'Сохранённое имя' })
  ]);
  const rows = [{ offerId: 'ART1', sku: '111', name: '' }];
  h.getSkuSheet().__resetSetValuesCallCount();
  h.updateSkuNamesFromOzonStocks(rows);

  const dump = h.dumpSkuSheet();
  const nameIdx = dump.headers.indexOf('Название Ozon');
  check('П16: пустое название из Ozon не затёрло сохранённое', dump.rows[0][nameIdx] === 'Сохранённое имя', `получено: ${dump.rows[0][nameIdx]}`);
  check('П16: запись в лист не выполнялась', h.getSkuSheet().__getSetValuesCallCount() === 0, `вызовов setValues: ${h.getSkuSheet().__getSetValuesCallCount()}`);
})();

// ================= Пункт 17: строки одного товара с разных складов — берётся первое непустое, без дублей =================
(function test17() {
  const h = freshHarness();
  h.setSkuSheet(SKU_FULL_HEADERS, [
    buildSkuRow(SKU_FULL_HEADERS, { SKU: 'ART1', 'ШК Ozon': '111', 'Название Ozon': '' })
  ]);
  const rows = [
    { offerId: 'ART1', sku: '111', name: '' }, // склад без имени в выгрузке
    { offerId: 'ART1', sku: '111', name: 'Имя со склада 1' },
    { offerId: 'ART1', sku: '111', name: 'Имя со склада 2 (должно быть проигнорировано)' }
  ];
  h.updateSkuNamesFromOzonStocks(rows);

  const dump = h.dumpSkuSheet();
  const nameIdx = dump.headers.indexOf('Название Ozon');
  check('П17: взято первое непустое название среди складов', dump.rows[0][nameIdx] === 'Имя со склада 1', `получено: ${dump.rows[0][nameIdx]}`);
  check('П17: запись в лист выполнена ровно один раз (без дублирования)', h.getSkuSheet().__getSetValuesCallCount() === 1, `вызовов setValues: ${h.getSkuSheet().__getSetValuesCallCount()}`);
})();

// ================= Пункт 18: Списание до нулевого остатка не обнуляет капитализацию (долг себестоимости) =================
// Регресс-гвардия на Пункт 40, этап B: раньше newCap принудительно зануляли при newQty===0,
// молча уничтожая стоимость брака. Сейчас капитализация должна остаться прежней.
(function test18() {
  const h = freshHarness();
  h.ensureTransSheet();
  h.setStockSheet([{ article: 'ART1', quantity: 10, avgCost: 5, capitalization: 50 }]);

  const res = h.commitTransaction(
    [{ article: 'ART1', quantity: 10, price: 5 }],
    'Расход', 'Списание - Брак', '', 'tester', '2026-01-05T09:00:00Z', ''
  );
  const row = res.stock.find(r => r.article === 'ART1');

  check('П18: количество обнулилось', row && row.quantity === 0, `получено: ${row && row.quantity}`);
  check('П18: капитализация НЕ обнулилась (долг себестоимости сохранён)', row && row.capitalization === 50, `получено: ${row && row.capitalization}`);
  check('П18: средняя себестоимость при нулевом остатке = 0', row && row.avgCost === 0, `получено: ${row && row.avgCost}`);
})();

// ================= Пункт 19: Списание, оставляющее остаток > 0 — капитализация не трогается, средняя пересчитывается =================
(function test19() {
  const h = freshHarness();
  h.ensureTransSheet();
  h.setStockSheet([{ article: 'ART2', quantity: 10, avgCost: 4, capitalization: 40 }]);

  const res = h.commitTransaction(
    [{ article: 'ART2', quantity: 6, price: 4 }],
    'Расход', 'Списание - Утеря', '', 'tester', '2026-01-05T09:00:00Z', ''
  );
  const row = res.stock.find(r => r.article === 'ART2');

  check('П19: количество уменьшилось на списанное', row && row.quantity === 4, `получено: ${row && row.quantity}`);
  check('П19: капитализация не изменилась', row && row.capitalization === 40, `получено: ${row && row.capitalization}`);
  check('П19: средняя пересчитана как капитализация/остаток (40/4=10)', row && row.avgCost === 10, `получено: ${row && row.avgCost}`);
})();

// ================= Пункт 20: обычный Расход (не списание) по-прежнему уменьшает капитализацию =================
// Доказывает, что фикс Пункта 40 не задел нормальное потребление остатка.
(function test20() {
  const h = freshHarness();
  h.ensureTransSheet();
  h.setStockSheet([{ article: 'ART3', quantity: 10, avgCost: 3, capitalization: 30 }]);

  const res = h.commitTransaction(
    [{ article: 'ART3', quantity: 4, price: 3 }],
    'Расход', 'Продажа Ozon', '', 'tester', '2026-01-05T09:00:00Z', ''
  );
  const row = res.stock.find(r => r.article === 'ART3');

  check('П20: количество уменьшилось на отгруженное', row && row.quantity === 6, `получено: ${row && row.quantity}`);
  check('П20: капитализация уменьшилась на себестоимость отгрузки (30-12=18)', row && row.capitalization === 18, `получено: ${row && row.capitalization}`);
  check('П20: средняя себестоимость не изменилась', row && row.avgCost === 3, `получено: ${row && row.avgCost}`);
})();

// ================= Пункт 21: Приход на артикул с долгом себестоимости при нулевом остатке поглощает долг =================
// Это то самое поведение, ради которого сделан фикс: долг остаётся на артикуле до прихода,
// а пришедшая партия забирает его в свою капитализацию и среднюю.
(function test21() {
  const h = freshHarness();
  h.ensureTransSheet();
  h.setStockSheet([{ article: 'ART4', quantity: 0, avgCost: 0, capitalization: 50 }]);

  const res = h.commitTransaction(
    [{ article: 'ART4', quantity: 20, price: 10 }],
    'Приход', 'Поставка', '2026-01-06', 'tester', '2026-01-05T09:00:00Z', ''
  );
  const row = res.stock.find(r => r.article === 'ART4');

  check('П21: количество увеличилось на пришедшее', row && row.quantity === 20, `получено: ${row && row.quantity}`);
  check('П21: капитализация = старый долг + стоимость партии (50+200=250)', row && row.capitalization === 250, `получено: ${row && row.capitalization}`);
  check('П21: средняя = (долг+партия)/новое количество (250/20=12.5)', row && row.avgCost === 12.5, `получено: ${row && row.avgCost}`);
})();

// ================= Пункт 22: Списание компонента виртуального комплекта до нуля тоже не обнуляет капитализацию =================
(function test22() {
  const h = freshHarness();
  h.ensureTransSheet();
  h.setKitSheet([{ kitSku: 'KIT1', componentSku: 'COMP1', quantity: 2, kitType: 'virtual' }]);
  h.setStockSheet([{ article: 'COMP1', quantity: 6, avgCost: 5, capitalization: 30 }]);

  const res = h.commitTransaction(
    [{ article: 'KIT1', quantity: 3, price: 0 }],
    'Расход', 'Списание - Брак', '', 'tester', '2026-01-05T09:00:00Z', ''
  );
  const row = res.stock.find(r => r.article === 'COMP1');

  check('П22: остаток компонента списан полностью (6 - 2*3=0)', row && row.quantity === 0, `получено: ${row && row.quantity}`);
  check('П22: капитализация компонента НЕ обнулилась (долг себестоимости сохранён)', row && row.capitalization === 30, `получено: ${row && row.capitalization}`);
})();

// ================= Пункт 23: Списание С МЕТКОЙ «себестоимость обнулена», опустошающее остаток =================
// Пункт 40, этап A: владелец выбрал не копить долг — товар списывается ПОЛНОСТЬЮ,
// как обычный Расход: капитализация уменьшается на стоимость списанного, вплоть до нуля.
// Средняя себестоимость при этом не пересчитывается на 0 отдельной веткой, а остаётся
// прежней (как у обычного Расхода — см. П20/П26), потому что код обнулённого списания
// буквально переиспользует формулу обычного Расхода (newAvgCost = curr.avgCost).
(function test23() {
  const h = freshHarness();
  h.ensureTransSheet();
  h.setStockSheet([{ article: 'ART5', quantity: 10, avgCost: 5, capitalization: 50 }]);

  const res = h.commitTransaction(
    [{ article: 'ART5', quantity: 10, price: 5 }],
    'Расход', 'Склад [Списание - Брак] [себестоимость обнулена]', '', 'tester', '2026-01-05T09:00:00Z', ''
  );
  const row = res.stock.find(r => r.article === 'ART5');

  check('П23: количество обнулилось', row && row.quantity === 0, `получено: ${row && row.quantity}`);
  check('П23: капитализация обнулилась вместе с товаром (50-50=0)', row && row.capitalization === 0, `получено: ${row && row.capitalization}`);
  check('П23: средняя себестоимость не пересчитана отдельно, как у обычного Расхода (осталась 5)', row && row.avgCost === 5, `получено: ${row && row.avgCost}`);
})();

// ================= Пункт 24: то же самое списание, но БЕЗ метки — капитализация остаётся долгом =================
// Гвардия: единственное различие с П23 — строка объекта операции (метка внутри неё).
// Без метки действует поведение по умолчанию (Пункт 40, этап B) — капитализация НЕ трогается.
(function test24() {
  const h = freshHarness();
  h.ensureTransSheet();
  h.setStockSheet([{ article: 'ART6', quantity: 10, avgCost: 5, capitalization: 50 }]);

  const res = h.commitTransaction(
    [{ article: 'ART6', quantity: 10, price: 5 }],
    'Расход', 'Склад [Списание - Брак]', '', 'tester', '2026-01-05T09:00:00Z', ''
  );
  const row = res.stock.find(r => r.article === 'ART6');

  check('П24: количество обнулилось', row && row.quantity === 0, `получено: ${row && row.quantity}`);
  check('П24: капитализация НЕ обнулилась без метки (долг себестоимости сохранён, 50)', row && row.capitalization === 50, `получено: ${row && row.capitalization}`);
})();

// ================= Пункт 25: Списание С МЕТКОЙ, оставляющее остаток > 0 =================
// Капитализация уменьшается на стоимость списанного (как у обычного Расхода),
// средняя себестоимость НЕ пересчитывается (остаётся прежней) — это и есть поведение
// обычного Расхода, которое метка воспроизводит для списания.
(function test25() {
  const h = freshHarness();
  h.ensureTransSheet();
  h.setStockSheet([{ article: 'ART7', quantity: 10, avgCost: 4, capitalization: 40 }]);

  const res = h.commitTransaction(
    [{ article: 'ART7', quantity: 6, price: 4 }],
    'Расход', 'Склад [Списание - Утеря] [себестоимость обнулена]', '', 'tester', '2026-01-05T09:00:00Z', ''
  );
  const row = res.stock.find(r => r.article === 'ART7');

  check('П25: количество уменьшилось на списанное', row && row.quantity === 4, `получено: ${row && row.quantity}`);
  check('П25: капитализация уменьшилась на себестоимость списания (40-24=16)', row && row.capitalization === 16, `получено: ${row && row.capitalization}`);
  check('П25: средняя себестоимость не изменилась (4)', row && row.avgCost === 4, `получено: ${row && row.avgCost}`);
})();

// ================= Пункт 26: метка «себестоимость обнулена» не влияет на обычный (не-списание) Расход =================
// Строка объекта не содержит «Списание», значит isWriteOffDestination === false и
// формула та же независимо от присутствия метки. Два прогона с одинаковым стартовым
// остатком должны дать идентичный результат при destination с меткой и без.
(function test26() {
  const hA = freshHarness();
  hA.ensureTransSheet();
  hA.setStockSheet([{ article: 'ART8', quantity: 10, avgCost: 3, capitalization: 30 }]);
  const resA = hA.commitTransaction(
    [{ article: 'ART8', quantity: 4, price: 3 }],
    'Расход', 'Продажа Ozon', '', 'tester', '2026-01-05T09:00:00Z', ''
  );
  const rowA = resA.stock.find(r => r.article === 'ART8');

  const hB = freshHarness();
  hB.ensureTransSheet();
  hB.setStockSheet([{ article: 'ART8', quantity: 10, avgCost: 3, capitalization: 30 }]);
  const resB = hB.commitTransaction(
    [{ article: 'ART8', quantity: 4, price: 3 }],
    'Расход', 'Продажа Ozon [себестоимость обнулена]', '', 'tester', '2026-01-05T09:00:00Z', ''
  );
  const rowB = resB.stock.find(r => r.article === 'ART8');

  check('П26: обычный Расход без метки — капитализация уменьшилась (30-12=18)', rowA && rowA.capitalization === 18, `получено: ${rowA && rowA.capitalization}`);
  check('П26: обычный Расход с посторонней меткой — результат тот же (метка не сработала без "Списание")',
    rowB && rowB.quantity === rowA.quantity && rowB.capitalization === rowA.capitalization && rowB.avgCost === rowA.avgCost,
    `A: ${JSON.stringify(rowA)}, B: ${JSON.stringify(rowB)}`);
})();

// ================= Пункт 27: метка «себестоимость обнулена» не влияет на Приход =================
// Ветка Приход вообще не проверяет isWriteOffDestination/isCapitalizationZeroed — метка
// в строке объекта поставки должна быть полностью безразлична.
(function test27() {
  const hA = freshHarness();
  hA.ensureTransSheet();
  hA.setStockSheet([{ article: 'ART9', quantity: 0, avgCost: 0, capitalization: 50 }]);
  const resA = hA.commitTransaction(
    [{ article: 'ART9', quantity: 20, price: 10 }],
    'Приход', 'Поставка', '2026-01-06', 'tester', '2026-01-05T09:00:00Z', ''
  );
  const rowA = resA.stock.find(r => r.article === 'ART9');

  const hB = freshHarness();
  hB.ensureTransSheet();
  hB.setStockSheet([{ article: 'ART9', quantity: 0, avgCost: 0, capitalization: 50 }]);
  const resB = hB.commitTransaction(
    [{ article: 'ART9', quantity: 20, price: 10 }],
    'Приход', 'Поставка [себестоимость обнулена]', '2026-01-06', 'tester', '2026-01-05T09:00:00Z', ''
  );
  const rowB = resB.stock.find(r => r.article === 'ART9');

  check('П27: Приход без метки — долг поглощён партией (50+200=250)', rowA && rowA.capitalization === 250, `получено: ${rowA && rowA.capitalization}`);
  check('П27: Приход с меткой в строке объекта — результат тот же (метка не влияет на Приход)',
    rowB && rowB.quantity === rowA.quantity && rowB.capitalization === rowA.capitalization && rowB.avgCost === rowA.avgCost,
    `A: ${JSON.stringify(rowA)}, B: ${JSON.stringify(rowB)}`);
})();

// ================= Пункт 28: Списание С МЕТКОЙ компонента виртуального комплекта =================
// Ветка компонентов (~1646) зеркалит ветку обычного артикула (~1742): с меткой капитализация
// компонента уменьшается на его долю стоимости, как у обычного Расхода.
(function test28() {
  const h = freshHarness();
  h.ensureTransSheet();
  h.setKitSheet([{ kitSku: 'KIT2', componentSku: 'COMP2', quantity: 2, kitType: 'virtual' }]);
  h.setStockSheet([{ article: 'COMP2', quantity: 6, avgCost: 5, capitalization: 30 }]);

  const res = h.commitTransaction(
    [{ article: 'KIT2', quantity: 3, price: 0 }],
    'Расход', 'Склад [Списание - Брак] [себестоимость обнулена]', '', 'tester', '2026-01-05T09:00:00Z', ''
  );
  const row = res.stock.find(r => r.article === 'COMP2');

  check('П28: остаток компонента списан полностью (6 - 2*3=0)', row && row.quantity === 0, `получено: ${row && row.quantity}`);
  check('П28: капитализация компонента обнулилась вместе с товаром (30-30=0)', row && row.capitalization === 0, `получено: ${row && row.capitalization}`);
})();

// ================= Пункт 22, этап I: окно недель в getOzonSales =================
// Дефект, найденный живым регрессом 19.08.2026: окно отбиралось по числу РАЗЛИЧНЫХ
// значений колонки «Неделя» и включало текущую незавершённую неделю, поэтому из
// запрошенных 12 недель полных до расчёта доходило 11, а окно тренда настроено на 13.
(() => {
  const H = freshHarness();
  // «Сейчас» — среда 07.01.2026, понедельник текущей недели 05.01.2026.
  H.setNow('2026-01-07T09:00:00Z');

  // Item 86 step A: the default window is now max(trend, speed, 26) + 2, so the mock series
  // needs to reach back further than the old 20 weeks to still exercise the widening checks.
  const mondays = [];
  for (let i = 0; i < 40; i++) {
    const dt = new Date(Date.UTC(2026, 0, 5) - i * 7 * 86400000);
    mondays.push(dt.toISOString().slice(0, 10));
  }
  const weekly = mondays.map(w => ({ week: w, offerId: 'ART', qty: 10, days: 7 }));
  H.setOzonSalesSheet(weekly);
  H.setOzonSettings({ trendWeeks: 13, speedWeeks: 4 });

  const auto = H.getOzonSales();
  const autoWeeks = Array.from(new Set(auto.map(r => r.week))).sort();
  const current = '2026-01-05';
  const fullAuto = autoWeeks.filter(w => w < current);

  check('П71: без явного окна getOzonSales берёт его из настроек, floor 26 недель + 2 запаса = 28 полных недель',
    fullAuto.length === 28, `получено полных недель: ${fullAuto.length} (${autoWeeks.length} всего, с ${autoWeeks[0]})`);
  check('П71: текущая незавершённая неделя тоже отдаётся, но НЕ занимает место полной',
    autoWeeks.indexOf(current) !== -1 && autoWeeks.length === 29,
    `недель всего: ${autoWeeks.length}`);

  // Рост настройки должен сразу расширять окно — раньше он упирался в число на клиенте.
  // trendWeeks поднят выше пола 26, иначе рост настройки ничего бы не поменял.
  H.setOzonSettings({ trendWeeks: 30, speedWeeks: 4 });
  const wider = H.getOzonSales();
  const widerFull = Array.from(new Set(wider.map(r => r.week))).filter(w => w < current);
  check('П72: увеличение настройки «Окно тренда» выше пола 26 сразу расширяет окно выдачи',
    widerFull.length === 32, `получено полных недель: ${widerFull.length}`);

  // Явно переданное окно имеет приоритет над настройками.
  H.setOzonSettings({ trendWeeks: 13, speedWeeks: 4 });
  const explicit = H.getOzonSales(6);
  const explicitFull = Array.from(new Set(explicit.map(r => r.week))).filter(w => w < current);
  check('П73: явно переданное окно имеет приоритет над настройками',
    explicitFull.length === 6, `получено полных недель: ${explicitFull.length}`);

  // Архивные строки по 28 дней стоят на той же сетке понедельников. Отбор по дате
  // не должен считать их отдельными неделями и укорачивать окно.
  const archiveOnly = [
    { week: '2025-11-24', offerId: 'ART', qty: 40, days: 28 },
    { week: '2025-12-01', offerId: 'ART', qty: 40, days: 28 }
  ];
  H.setOzonSalesSheet(weekly.concat(archiveOnly));
  const mixed = H.getOzonSales(6);
  const mixedFull = Array.from(new Set(mixed.map(r => r.week))).filter(w => w < current);
  check('П74: архивные строки по 28 дней не съедают окно (те же 6 полных недель)',
    mixedFull.length === 6, `получено полных недель: ${mixedFull.length}`);

  // Строки старше окна отсекаются целиком.
  const oldest = mixed.filter(r => r.week < '2025-11-24');
  check('П74: строки старше окна не отдаются', oldest.length === 0, `лишних строк: ${oldest.length}`);
})();

// ========== Item 26: sales sheet split into weekly and archive ==========
// Item 86 step A (2026-09-26): weekly zone widened from 13 to 27 weeks, so a full 26-week
// speed lookback stays weekly. Before this change both zones lived in one sheet, and
// getOzonSales read all of it on every start-up: 1805 of 3194 rows were archive rows the date
// window always discards.
(() => {
  // Same Monday-of-N-weeks-ago math as the production formula, used to derive test weeks
  // whose zone side is unambiguous rather than guessed at.
  function mondayAgo(weeksAgo) {
    return new Date(Date.UTC(2026, 0, 5) - weeksAgo * 7 * 86400000).toISOString().slice(0, 10);
  }

  const H = freshHarness();
  H.setNow('2026-01-05T09:00:00Z');           // понедельник 05.01.2026
  H.setOzonSettings({ salesRetentionWeeks: 78 });

  // 20 недель назад — внутри расширенной недельной зоны (27), остаётся недельной строкой.
  // 30 недель назад — за зоной, уходит в 28-дневный блок.
  H.setOzonSalesSheet([
    { week: mondayAgo(20), offerId: 'ART', qty: 10, days: 7 },
    { week: mondayAgo(30), offerId: 'ART', qty: 5, days: 7 }
  ]);
  H.setOzonSalesArchiveSheet([]);
  H.saveOzonSales({ rows: [], okCabinets: [], mode: 'recent', replacedWeeks: [] });

  const weekly = H.dumpSalesSheet('Продажи Ozon');
  const archive = H.dumpSalesSheet('Продажи Ozon Архив');

  check('П75: неделя 20 недель назад осталась недельной строкой в основном листе (зона 27)',
    weekly.length === 1 && weekly[0].week === mondayAgo(20) && weekly[0].qty === 10 && weekly[0].days === 7,
    `получено: ${JSON.stringify(weekly)}`);
  check('П75: неделя 30 недель назад ушла в архивный 28-дневный блок',
    archive.length === 1 && archive[0].days === 28 && archive[0].qty === 5,
    `получено: ${JSON.stringify(archive)}`);

  // Второй прогон: старый блок уже лежит в архивном листе и должен быть подхвачен, а не потерян.
  const H2 = freshHarness();
  H2.setNow('2026-01-05T09:00:00Z');
  H2.setOzonSettings({ salesRetentionWeeks: 78 });
  H2.setOzonSalesSheet([{ week: mondayAgo(20), offerId: 'ART', qty: 10, days: 7 }]);
  H2.setOzonSalesArchiveSheet([{ week: mondayAgo(30), offerId: 'ART', qty: 100, days: 28 }]);
  H2.saveOzonSales({ rows: [], okCabinets: [], mode: 'recent', replacedWeeks: [] });
  const arch2 = H2.dumpSalesSheet('Продажи Ozon Архив');
  check('П76: существующий архивный блок прочитан и сохранён, а не потерян',
    arch2.length === 1 && arch2[0].qty === 100, `получено: ${JSON.stringify(arch2)}`);

  // Третий прогон: строка из основного листа доливается в УЖЕ существующий блок того же периода.
  const H3 = freshHarness();
  H3.setNow('2026-01-05T09:00:00Z');
  H3.setOzonSettings({ salesRetentionWeeks: 78 });
  H3.setOzonSalesSheet([{ week: mondayAgo(31), offerId: 'ART', qty: 7, days: 7 }]);
  H3.setOzonSalesArchiveSheet([{ week: mondayAgo(30), offerId: 'ART', qty: 100, days: 28 }]);
  H3.saveOzonSales({ rows: [], okCabinets: [], mode: 'recent', replacedWeeks: [] });
  const arch3 = H3.dumpSalesSheet('Продажи Ozon Архив');
  check('П77: строка того же 28-дневного периода долилась в блок (100 + 7 = 107)',
    arch3.length === 1 && arch3[0].qty === 107, `получено: ${JSON.stringify(arch3)}`);

  // Четвёртый прогон: ретенция режет обе зоны.
  const H4 = freshHarness();
  H4.setNow('2026-01-05T09:00:00Z');
  H4.setOzonSettings({ salesRetentionWeeks: 10 });   // 10 недель — отсечка 2025-10-27
  H4.setOzonSalesSheet([{ week: '2025-12-29', offerId: 'ART', qty: 10, days: 7 }]);
  H4.setOzonSalesArchiveSheet([{ week: '2024-05-06', offerId: 'ART', qty: 999, days: 28 }]);
  H4.saveOzonSales({ rows: [], okCabinets: [], mode: 'recent', replacedWeeks: [] });
  check('П78: ретенция вычистила устаревший блок из архивного листа',
    H4.dumpSalesSheet('Продажи Ozon Архив').length === 0,
    `получено: ${JSON.stringify(H4.dumpSalesSheet('Продажи Ozon Архив'))}`);
  check('П78: свежая недельная строка ретенцией не тронута',
    H4.dumpSalesSheet('Продажи Ozon').length === 1,
    `получено: ${JSON.stringify(H4.dumpSalesSheet('Продажи Ozon'))}`);

  // ================= Item 86 step A: getOzonSales reads the archive within its window =================
  // Total: the window now (default max(trend,speed,26)+2 = 28 weeks) reaches PAST the 27-week
  // weekly zone into the archive's 28-day blocks — they carry the SAME columns, only «Дней»=28.
  const H5 = freshHarness();
  H5.setNow('2026-01-05T09:00:00Z');
  H5.setOzonSettings({ trendWeeks: 13, speedWeeks: 4, salesRetentionWeeks: 78 });
  H5.setOzonSalesSheet([{ week: mondayAgo(1), offerId: 'ART', qty: 10, days: 7 }]);
  H5.setOzonSalesArchiveSheet([
    { week: mondayAgo(28), offerId: 'ART', qty: 40, days: 28 },  // внутри окна 28 недель
    { week: mondayAgo(60), offerId: 'ART', qty: 999, days: 28 }  // старше окна — не должна попасть
  ]);
  const withArchive = H5.getOzonSales();
  const insideBlock = withArchive.find(r => r.week === mondayAgo(28));
  const outsideBlock = withArchive.find(r => r.week === mondayAgo(60));
  check('П79: getOzonSales включает архивный 28-дневный блок внутри окна',
    !!insideBlock && insideBlock.days === 28 && insideBlock.qty === 40, `получено: ${JSON.stringify(insideBlock)}`);
  check('П79: блок старше окна не отдаётся', !outsideBlock, `получено outsideBlock: ${JSON.stringify(outsideBlock)}`);

  // ================= Item 86 step A: qty conserved across a sync (nothing gained or lost) =================
  const H6 = freshHarness();
  H6.setNow('2026-01-05T09:00:00Z');
  H6.setOzonSettings({ salesRetentionWeeks: 78 });
  H6.setOzonSalesSheet([
    { week: mondayAgo(20), offerId: 'ART', qty: 11, days: 7 },
    { week: mondayAgo(30), offerId: 'ART', qty: 13, days: 7 } // will be compacted this sync
  ]);
  H6.setOzonSalesArchiveSheet([{ week: mondayAgo(35), offerId: 'ART', qty: 17, days: 28 }]);
  const sumBefore = 11 + 13 + 17;
  H6.saveOzonSales({ rows: [], okCabinets: [], mode: 'recent', replacedWeeks: [] });
  const sumAfter = H6.dumpSalesSheet('Продажи Ozon').reduce((s, r) => s + r.qty, 0)
    + H6.dumpSalesSheet('Продажи Ozon Архив').reduce((s, r) => s + r.qty, 0);
  check('П80: сумма Количество по артикулу сохранена через синхронизацию (17+11+13)',
    sumAfter === sumBefore, `было: ${sumBefore}, стало: ${sumAfter}`);

  // ================= Item 86 step A: idempotency — two syncs the same day give the same sheet =================
  const H7 = freshHarness();
  H7.setNow('2026-01-05T09:00:00Z');
  H7.setOzonSettings({ salesRetentionWeeks: 78 });
  H7.setOzonSalesSheet([{ week: mondayAgo(20), offerId: 'ART', qty: 10, days: 7 }]);
  H7.setOzonSalesArchiveSheet([{ week: mondayAgo(35), offerId: 'ART', qty: 50, days: 28 }]);
  H7.saveOzonSales({ rows: [], okCabinets: [], mode: 'recent', replacedWeeks: [] });
  const afterFirst = { weekly: H7.dumpSalesSheet('Продажи Ozon'), archive: H7.dumpSalesSheet('Продажи Ozon Архив') };
  H7.saveOzonSales({ rows: [], okCabinets: [], mode: 'recent', replacedWeeks: [] });
  const afterSecond = { weekly: H7.dumpSalesSheet('Продажи Ozon'), archive: H7.dumpSalesSheet('Продажи Ozon Архив') };
  check('П81: повторная синхронизация в тот же день не меняет лист (идемпотентность)',
    JSON.stringify(afterFirst) === JSON.stringify(afterSecond),
    `1-й прогон: ${JSON.stringify(afterFirst)}, 2-й прогон: ${JSON.stringify(afterSecond)}`);
})();

// ================= Item 71: the row of the current week carries its real length =================
// The poll counts postings up to the moment it runs, so the current week's row is a part-week.
// It used to be written with «Дней» = 7 like a completed week, which is why the client could not
// include it: counting a part-week as a whole would understate the speed. Now «Дней» is the
// number of days elapsed since Monday 00:00 МСК at the moment of the poll.
(() => {
  const H = freshHarness();
  H.setNow('2026-09-16T02:07:00Z');           // среда 05:07 МСК; понедельник — 14.09
  H.setOzonSettings({ salesRetentionWeeks: 78 });
  H.setOzonSalesSheet([]);
  H.setOzonSalesArchiveSheet([]);
  H.saveOzonSales({
    rows: [
      { week: '2026-09-14', cabinet: 'Mercurius', offerId: 'ART', cluster: 'Екатеринбург', qty: 40 },
      { week: '2026-09-07', cabinet: 'Mercurius', offerId: 'ART', cluster: 'Екатеринбург', qty: 70 },
      { week: '2026-08-31', cabinet: 'Mercurius', offerId: 'ART', cluster: 'Екатеринбург', qty: 63 }
    ],
    okCabinets: ['Mercurius'], mode: 'recent', replacedWeeks: ['2026-09-14', '2026-09-07', '2026-08-31']
  });
  const rows = H.dumpSalesSheet('Продажи Ozon');
  const byWeek = {};
  for (const r of rows) byWeek[r.week] = r;
  check('П79: строка текущей недели получает прошедшие дни (2 дня 5 ч 07 мин = 2.21)',
    byWeek['2026-09-14'] && byWeek['2026-09-14'].days === 2.21, `получено: ${JSON.stringify(byWeek['2026-09-14'])}`);
  check('П79: завершённые недели по-прежнему 7',
    byWeek['2026-09-07'] && byWeek['2026-09-07'].days === 7 && byWeek['2026-08-31'] && byWeek['2026-08-31'].days === 7,
    `получено: ${JSON.stringify(rows.map(r => [r.week, r.days]))}`);

  // Monday just after midnight: a positive length, never zero.
  const H2 = freshHarness();
  H2.setNow('2026-09-13T21:05:00Z');          // понедельник 14.09 00:05 МСК
  H2.setOzonSettings({ salesRetentionWeeks: 78 });
  H2.setOzonSalesSheet([]);
  H2.setOzonSalesArchiveSheet([]);
  H2.saveOzonSales({
    rows: [{ week: '2026-09-14', cabinet: 'Mercurius', offerId: 'ART', cluster: 'Екатеринбург', qty: 1 }],
    okCabinets: ['Mercurius'], mode: 'recent', replacedWeeks: ['2026-09-14']
  });
  const mon = H2.dumpSalesSheet('Продажи Ozon')[0];
  check('П80: понедельник 00:05 МСК — «Дней» = 0.01, не ноль', mon && mon.days === 0.01, `получено: ${JSON.stringify(mon)}`);

  // Sunday 23:59: still the current week, still below 7.
  const H3 = freshHarness();
  H3.setNow('2026-09-20T20:59:00Z');          // воскресенье 20.09 23:59 МСК
  H3.setOzonSettings({ salesRetentionWeeks: 78 });
  H3.setOzonSalesSheet([]);
  H3.setOzonSalesArchiveSheet([]);
  H3.saveOzonSales({
    rows: [{ week: '2026-09-14', cabinet: 'Mercurius', offerId: 'ART', cluster: 'Екатеринбург', qty: 1 }],
    okCabinets: ['Mercurius'], mode: 'recent', replacedWeeks: ['2026-09-14']
  });
  const sun = H3.dumpSalesSheet('Продажи Ozon')[0];
  check('П81: воскресенье 23:59 МСК — «Дней» = 6.99, не 7', sun && sun.days === 6.99, `получено: ${JSON.stringify(sun)}`);

  // The next poll after the week has turned writes the same week as a completed one.
  const H4 = freshHarness();
  H4.setNow('2026-09-21T02:07:00Z');          // понедельник 21.09 05:07 МСК
  H4.setOzonSettings({ salesRetentionWeeks: 78 });
  H4.setOzonSalesSheet([{ week: '2026-09-14', offerId: 'ART', qty: 40, days: 6.2 }]);
  H4.setOzonSalesArchiveSheet([]);
  H4.saveOzonSales({
    rows: [
      { week: '2026-09-21', cabinet: 'Mercurius', offerId: 'ART', cluster: 'Екатеринбург', qty: 3 },
      { week: '2026-09-14', cabinet: 'Mercurius', offerId: 'ART', cluster: 'Екатеринбург', qty: 75 }
    ],
    okCabinets: ['Mercurius'], mode: 'recent', replacedWeeks: ['2026-09-21', '2026-09-14', '2026-09-07']
  });
  const after = {};
  for (const r of H4.dumpSalesSheet('Продажи Ozon')) after[r.week] = r;
  check('П82: неделя, ставшая прошлой, перезаписана как полная (75 шт, 7 дней)',
    after['2026-09-14'] && after['2026-09-14'].days === 7 && after['2026-09-14'].qty === 75, `получено: ${JSON.stringify(after['2026-09-14'])}`);
  check('П82: новая текущая неделя — 0.21 дня', after['2026-09-21'] && after['2026-09-21'].days === 0.21, `получено: ${JSON.stringify(after['2026-09-21'])}`);
})();

// ================= Item 74a: the journal «Заявки Ozon» keeps the outcome of the document build =================
// The proxy rebuilds cargoes, labels and the Drive folder by order id and reports the outcome
// here; the tab of 74b reads it back as docsJSON. A journal created before the column existed
// gets it appended on first read or write.
(() => {
  const H = freshHarness();
  H.setNow('2026-09-18T14:00:00Z');
  const ctx = H.context;
  // A journal of the old shape: ten columns, no «Документы».
  const ss = ctx.SpreadsheetApp.getActiveSpreadsheet();
  const oldHeaders = ['ID', 'Дата', 'Кабинет', 'DraftID', 'OrderID', 'Точка отгрузки', 'Кластеры', 'Состав', 'Кто', 'Статус'];
  const sheet = ss.insertSheet('Заявки Ozon');
  sheet.__setData([
    oldHeaders,
    ['SUP-1', new Date('2026-09-14T10:00:00Z'), 'Mercurius', 'D1', '128602806', 'Хоругвино', '1', '[]', 'Николай', 'Создана'],
    ['SUP-2', new Date('2026-09-18T13:26:00Z'), 'Mercurius', 'D2', '129260922', 'Хоругвино', '1,2', '[]', 'Николай', 'Создана'],
    // Bound as a duplicate: a second journal row of the same order.
    ['SUP-3', new Date('2026-09-18T13:30:00Z'), 'Mercurius', 'D2', '129260922', 'Хоругвино', '1,2', '[]', 'Николай', 'Создана']
  ]);

  const before = ctx.getOzonSupplyRequests();
  check('П83: чтение старого журнала дописывает колонку «Документы» и отдаёт пустой docsJSON',
    H.headerRowOf(sheet).indexOf('Документы') === 10 && before.length === 3 && before.every(r => r.docsJSON === ''),
    `заголовки: ${JSON.stringify(H.headerRowOf(sheet))}, строки: ${JSON.stringify(before.map(r => r.docsJSON))}`);

  const docs = JSON.stringify({ at: '2026-09-18T14:00:00.000Z', orderNumber: '129260922-1', folderUrl: 'https://drive/x', ok: true });
  const res = ctx.saveOzonSupplyDocs({ orderId: '129260922', docsJSON: docs });
  const after = ctx.getOzonSupplyRequests();
  const byId = {};
  for (const r of after) byId[r.id] = r;
  check('П84: запись ложится в КАЖДУЮ строку своей заявки, чужая не тронута',
    res.updated === 2 && byId['SUP-2'].docsJSON === docs && byId['SUP-3'].docsJSON === docs && byId['SUP-1'].docsJSON === '',
    `updated=${res.updated}, SUP-2=${byId['SUP-2'] && byId['SUP-2'].docsJSON}, SUP-3=${byId['SUP-3'] && byId['SUP-3'].docsJSON}, SUP-1=${byId['SUP-1'] && byId['SUP-1'].docsJSON}`);
  check('П84: остальные поля строки сохранены',
    byId['SUP-2'].status === 'Создана' && byId['SUP-2'].clusters === '1,2' && byId['SUP-2'].who === 'Николай',
    JSON.stringify(byId['SUP-2']));

  const none = ctx.saveOzonSupplyDocs({ orderId: '999', docsJSON: docs });
  check('П85: заявка без строки в журнале — updated 0, без ошибки', none.updated === 0, JSON.stringify(none));

  let thrown = '';
  try { ctx.saveOzonSupplyDocs({ orderId: '129260922', docsJSON: '' }); } catch (e) { thrown = String(e); }
  check('П85: пустой docsJSON отвергается', thrown.indexOf('docsJSON') >= 0, thrown);

  // A repeated build overwrites the record: the latest outcome is the one that counts.
  const docs2 = JSON.stringify({ at: '2026-09-18T15:00:00.000Z', orderNumber: '129260922-1', ok: false, warnings: ['x'] });
  ctx.saveOzonSupplyDocs({ orderId: '129260922', docsJSON: docs2 });
  const again = ctx.getOzonSupplyRequests().find(r => r.id === 'SUP-2');
  check('П86: повторная сборка перезаписывает запись', again.docsJSON === docs2, again.docsJSON);

  // A row appended by the wizard after the column exists reads back with an empty record.
  ctx.saveOzonSupplyRequest({ cabinet: 'Mercurius', draftId: 'D3', orderId: '130000000', dropOffName: 'X', clusters: '1', itemsJSON: '[]', status: 'Создана' }, 'Николай');
  const fresh = ctx.getOzonSupplyRequests().find(r => r.orderId === '130000000');
  check('П86: новая строка журнала — docsJSON пуст', !!fresh && fresh.docsJSON === '', JSON.stringify(fresh));
})();

// ================= Item 49: «Коробка ФФ» in the SKU sheet =================
// Whether an article needs a fulfilment-centre box. The column is appended by ensureColumns on
// the first read; an empty cell (an article saved before the column) means «yes» — only an
// explicit «нет» switches the box off. addSku/updateSku write «да»/«нет» from needsFfBox.
(() => {
  const H = freshHarness();
  const ctx = H.context;
  // A sheet of the old shape: nine columns, no «Коробка ФФ».
  H.setSkuSheet(SKU_FULL_HEADERS, [
    buildSkuRow(SKU_FULL_HEADERS, { SKU: 'ART-A', 'ШТ/КОР': 10 }),
    buildSkuRow(SKU_FULL_HEADERS, { SKU: 'ART-B', 'ШТ/КОР': 24 })
  ]);
  const first = ctx.getSkus();
  const dump = H.dumpSkuSheet();
  check('П87: чтение старого листа дописывает колонку «Коробка ФФ»', dump.headers.indexOf('Коробка ФФ') === SKU_FULL_HEADERS.length, JSON.stringify(dump.headers));
  check('П87: пустая ячейка = коробка нужна', first.every(r => r.needsFfBox === true), JSON.stringify(first));

  ctx.updateSku({ sku: 'ART-B', pcsPerBox: 24, minStock: 0, needsFfBox: false }, 'ART-B');
  const afterUpdate = ctx.getSkus();
  const b = afterUpdate.find(r => r.sku === 'ART-B');
  const a = afterUpdate.find(r => r.sku === 'ART-A');
  check('П88: updateSku с needsFfBox=false пишет «нет» и читается как false', !!b && b.needsFfBox === false, JSON.stringify(b));
  check('П88: соседний артикул не тронут', !!a && a.needsFfBox === true && a.pcsPerBox === 10, JSON.stringify(a));
  const colIdx = H.dumpSkuSheet().headers.indexOf('Коробка ФФ');
  const rowB = H.dumpSkuSheet().rows.find(r => r[0] === 'ART-B');
  check('П88: в ячейке ровно «нет»', rowB[colIdx] === 'нет', JSON.stringify(rowB));

  ctx.updateSku({ sku: 'ART-B', pcsPerBox: 24, minStock: 0, needsFfBox: true }, 'ART-B');
  check('П89: обратное включение пишет «да»', ctx.getSkus().find(r => r.sku === 'ART-B').needsFfBox === true, JSON.stringify(H.dumpSkuSheet()));

  ctx.addSku({ sku: 'ART-C', pcsPerBox: 5, minStock: 0, needsFfBox: false });
  ctx.addSku({ sku: 'ART-D', pcsPerBox: 5, minStock: 0 });
  const added = ctx.getSkus();
  check('П90: addSku с needsFfBox=false — «нет»', added.find(r => r.sku === 'ART-C').needsFfBox === false, JSON.stringify(added));
  check('П90: addSku без поля — коробка нужна', added.find(r => r.sku === 'ART-D').needsFfBox === true, JSON.stringify(added));

  // Case and spaces in a hand-typed cell.
  const d2 = H.dumpSkuSheet();
  const rowD = d2.rows.findIndex(r => r[0] === 'ART-D');
  d2.rows[rowD][colIdx] = ' НЕТ ';
  H.getSkuSheet().__setData([d2.headers, ...d2.rows]);
  check('П91: « НЕТ » руками в ячейке читается как нет', ctx.getSkus().find(r => r.sku === 'ART-D').needsFfBox === false, JSON.stringify(ctx.getSkus()));
})();

// ================= Item 56, stage 2: additional costs stated as a number, not dug out of the text =================
// Several Ozon orders shipped as one batch are written as several expenses, and the destination
// text of each one names the cost of the WHOLE batch. Parsing that text would charge the batch
// in full to every order, so the caller may now state the sum for this operation as a number.

// Reads the main (non-component) rows of the transactions sheet as plain objects.
function dumpTransRows(sheet) {
  const data = sheet.__dump();
  const headers = data[0].map(x => String(x).trim());
  const lastRow = sheet.getLastRow();
  const col = (row, name) => row[headers.indexOf(name)];
  return data.slice(1, Math.max(lastRow, 1))
    .filter(r => r.some(v => String(v).trim() !== ''))
    .filter(r => headers.indexOf('isComponent') === -1 || col(r, 'isComponent') !== true)
    .map(r => ({
      article: String(col(r, 'Артикул')),
      quantity: Number(col(r, 'Количество')),
      price: Number(col(r, 'Цена')),
      total: Number(col(r, 'Сумма')),
      additional: headers.indexOf('ДопРасходы') === -1 ? '' : col(r, 'ДопРасходы')
    }));
}

(function test79() {
  const h = freshHarness();
  const ts = h.ensureTransSheet();
  h.setStockSheet([{ article: 'ART-A', quantity: 10, avgCost: 100, capitalization: 1000 }]);

  // No number passed: the old parsing of the destination text must still work, untouched.
  h.commitTransaction(
    [{ article: 'ART-A', quantity: 10, price: 100 }],
    'Расход', 'Ozon (Shop) [Услуги: Паллета x1 (500₽)]', '', 'tester', '2026-01-05T09:00:00Z', ''
  );
  const rows = dumpTransRows(ts);
  check('Item 56: without a number the destination text is still parsed (1000 + 500 = 1500)',
    rows.length === 1 && rows[0].total === 1500, `получено: ${JSON.stringify(rows)}`);
  check('Item 56: unit cost carries the parsed costs (150)',
    rows.length === 1 && rows[0].price === 150, `получено: ${rows.length && rows[0].price}`);
  check('Item 56: the resolved sum is stored in its own column (500)',
    rows.length === 1 && Number(rows[0].additional) === 500, `получено: ${rows.length && rows[0].additional}`);
})();

(function test80() {
  const h = freshHarness();
  const ts = h.ensureTransSheet();
  h.setStockSheet([{ article: 'ART-B', quantity: 10, avgCost: 100, capitalization: 1000 }]);

  // The same text, but the caller states this order's own share: the number must win.
  h.commitTransaction(
    [{ article: 'ART-B', quantity: 10, price: 100 }],
    'Расход', 'Ozon (Shop) [Услуги: Паллета x1 (500₽)]', '', 'tester', '2026-01-05T09:00:00Z', '', 300
  );
  const rows = dumpTransRows(ts);
  check('Item 56: the stated number wins over the text (1000 + 300 = 1300)',
    rows.length === 1 && rows[0].total === 1300, `получено: ${JSON.stringify(rows)}`);
  check('Item 56: the stated number is what gets stored (300)',
    rows.length === 1 && Number(rows[0].additional) === 300, `получено: ${rows.length && rows[0].additional}`);
})();

(function test81() {
  const h = freshHarness();
  const ts = h.ensureTransSheet();
  h.setStockSheet([{ article: 'ART-C', quantity: 10, avgCost: 100, capitalization: 1000 }]);

  // Zero is a statement, not a missing value: an order that carries none of the costs.
  h.commitTransaction(
    [{ article: 'ART-C', quantity: 10, price: 100 }],
    'Расход', 'Ozon (Shop) [Услуги: Паллета x1 (500₽)]', '', 'tester', '2026-01-05T09:00:00Z', '', 0
  );
  const rows = dumpTransRows(ts);
  check('Item 56: a stated zero suppresses the text (1000, not 1500)',
    rows.length === 1 && rows[0].total === 1000, `получено: ${JSON.stringify(rows)}`);
  check('Item 56: nothing is stored when the operation carries no costs',
    rows.length === 1 && String(rows[0].additional).trim() === '', `получено: "${rows.length && rows[0].additional}"`);
})();

(function test82() {
  // The whole point of the change: two orders written separately must land exactly where
  // one combined expense would have landed.
  const combined = freshHarness();
  const combinedSheet = combined.ensureTransSheet();
  combined.setStockSheet([
    { article: 'ART-A', quantity: 10, avgCost: 100, capitalization: 1000 },
    { article: 'ART-B', quantity: 20, avgCost: 50, capitalization: 1000 }
  ]);
  combined.commitTransaction(
    [{ article: 'ART-A', quantity: 10, price: 100 }, { article: 'ART-B', quantity: 20, price: 50 }],
    'Расход', 'Ozon (Shop) [Услуги: Паллета x2 (600₽)]', '', 'tester', '2026-01-05T09:00:00Z', ''
  );
  const one = dumpTransRows(combinedSheet);

  const split = freshHarness();
  const splitSheet = split.ensureTransSheet();
  split.setStockSheet([
    { article: 'ART-A', quantity: 10, avgCost: 100, capitalization: 1000 },
    { article: 'ART-B', quantity: 20, avgCost: 50, capitalization: 1000 }
  ]);
  // 600 roubles over 30 pieces: 10 pieces carry 200, 20 pieces carry 400.
  split.commitTransaction(
    [{ article: 'ART-A', quantity: 10, price: 100 }],
    'Расход', 'Ozon (Shop) [Услуги: Паллета x2 (600₽)]', '', 'tester', '2026-01-05T09:00:00Z', '', 200
  );
  split.commitTransaction(
    [{ article: 'ART-B', quantity: 20, price: 50 }],
    'Расход', 'Ozon (Shop) [Услуги: Паллета x2 (600₽)]', '', 'tester', '2026-01-05T09:00:00Z', '', 400
  );
  const two = dumpTransRows(splitSheet);

  const byArticle = (rows, article) => rows.find(r => r.article === article) || {};
  check('Item 56: split expenses put the same cost on the first order as one combined expense',
    byArticle(one, 'ART-A').total === byArticle(two, 'ART-A').total && byArticle(two, 'ART-A').total === 1200,
    `объединённое: ${byArticle(one, 'ART-A').total}, раздельное: ${byArticle(two, 'ART-A').total}`);
  check('Item 56: and the same on the second order',
    byArticle(one, 'ART-B').total === byArticle(two, 'ART-B').total && byArticle(two, 'ART-B').total === 1400,
    `объединённое: ${byArticle(one, 'ART-B').total}, раздельное: ${byArticle(two, 'ART-B').total}`);
  check('Item 56: unit cost is the same in both orders of the batch (base + 20 per piece)',
    byArticle(two, 'ART-A').price === 120 && byArticle(two, 'ART-B').price === 70,
    `получено: ${byArticle(two, 'ART-A').price} и ${byArticle(two, 'ART-B').price}`);
  check('Item 56: writing the batch in full to every order would have cost 600 more — it does not',
    (byArticle(two, 'ART-A').total + byArticle(two, 'ART-B').total) === 2600,
    `получено: ${byArticle(two, 'ART-A').total + byArticle(two, 'ART-B').total}`);
})();

(function test83() {
  // The stored number is what the re-run paths (an edit in History, a пересорт re-commit)
  // read back instead of the destination text, so it has to survive the round trip.
  const h = freshHarness();
  h.ensureTransSheet();
  h.setStockSheet([{ article: 'ART-D', quantity: 10, avgCost: 100, capitalization: 1000 }]);
  h.commitTransaction(
    [{ article: 'ART-D', quantity: 10, price: 100 }],
    'Расход', 'Ozon (Shop) [Услуги: Паллета x1 (500₽)]', '', 'tester', '2026-01-05T09:00:00Z', '', 250
  );
  const rows = h.getTransactions().rows.filter(r => r.isComponent !== true);
  check('Item 56: the stated sum is read back from the sheet as a number (250)',
    rows.length === 1 && rows[0].additionalCosts === 250, `получено: ${rows.length && rows[0].additionalCosts}`);

  const h2 = freshHarness();
  h2.ensureTransSheet();
  h2.setStockSheet([{ article: 'ART-E', quantity: 10, avgCost: 100, capitalization: 1000 }]);
  h2.commitTransaction(
    [{ article: 'ART-E', quantity: 10, price: 100 }],
    'Расход', 'Ozon (Shop)', '', 'tester', '2026-01-05T09:00:00Z', ''
  );
  const rows2 = h2.getTransactions().rows.filter(r => r.isComponent !== true);
  check('Item 56: an expense with no costs reads back as «not stated», not as zero',
    rows2.length === 1 && rows2[0].additionalCosts === null, `получено: ${rows2.length && JSON.stringify(rows2[0].additionalCosts)}`);
})();

// ================= 25.08.2026: a column must never be created twice =================
// Found in production: the History sheet ended up with TWO «ДопРасходы» columns. The app
// fires several requests as it loads; two of them read the header row before either had
// written, and both appended. Values in the twin columns matched, so no money was lost —
// but the sheet must not grow twins.

(function test84() {
  const h = freshHarness();
  const sheet = h.makeSheet(['A', 'B'], 'Проба');

  h.ensureColumns(sheet, ['A', 'B', 'НоваяКолонка']);
  check('ensureColumns: the missing column is added once',
    JSON.stringify(h.headerRowOf(sheet)) === JSON.stringify(['A', 'B', 'НоваяКолонка']),
    `получено: ${JSON.stringify(h.headerRowOf(sheet))}`);

  // Every later call sees it in place — this is the loop that produced the twin.
  h.ensureColumns(sheet, ['A', 'B', 'НоваяКолонка']);
  h.ensureColumns(sheet, ['A', 'B', 'НоваяКолонка']);
  const headers = h.headerRowOf(sheet);
  check('ensureColumns: repeated calls do not add a twin',
    headers.filter(x => x === 'НоваяКолонка').length === 1,
    `получено: ${JSON.stringify(headers)}`);
})();

(function test85() {
  const h = freshHarness();
  const sheet = h.makeSheet(['A', 'B'], 'Проба');

  const before = h.lockRequests();
  h.ensureColumns(sheet, ['A', 'B']);
  check('ensureColumns: nothing missing — no lock is taken and nothing is written',
    h.lockRequests() === before && JSON.stringify(h.headerRowOf(sheet)) === JSON.stringify(['A', 'B']),
    `запросов замка: ${h.lockRequests() - before}`);

  h.ensureColumns(sheet, ['A', 'B', 'C']);
  check('ensureColumns: a column to add — the write happens under a lock',
    h.lockRequests() === before + 1,
    `запросов замка: ${h.lockRequests() - before}`);
})();

(function test86() {
  const h = freshHarness();
  // Several columns missing at once are added in one locked pass, in the order requested.
  const sheet = h.makeSheet(['A'], 'Проба');
  const before = h.lockRequests();
  h.ensureColumns(sheet, ['A', 'B', 'C', 'D']);
  check('ensureColumns: several missing columns take the lock once',
    h.lockRequests() === before + 1, `запросов замка: ${h.lockRequests() - before}`);
  check('ensureColumns: all of them are added, in order',
    JSON.stringify(h.headerRowOf(sheet)) === JSON.stringify(['A', 'B', 'C', 'D']),
    `получено: ${JSON.stringify(h.headerRowOf(sheet))}`);
})();

(function test87() {
  // The real defect was a race, and a single-threaded stand cannot reproduce one by running
  // code twice. So the race is staged inside the sheet: the FIRST read of the header row
  // reports the column missing, every read after it reports the column present — exactly what
  // a competing execution that appended while we waited for the lock would look like.
  // The fix must re-read the headers INSIDE the lock and then leave the sheet alone.
  const h = freshHarness();
  let headers = ['A', 'B'];
  let reads = 0;
  const writes = [];
  const racingSheet = {
    getLastColumn() { return headers.length; },
    getRange(row, col, numRows, numCols) {
      if (numCols !== undefined) {
        return {
          getValues() {
            reads += 1;
            const snapshot = headers.slice();
            // A competing execution appends the column right after our first look.
            if (reads === 1) headers = headers.concat(['Двойник']);
            return [snapshot];
          }
        };
      }
      return { setValue(value) { writes.push([col, value]); headers[col - 1] = value; } };
    }
  };

  h.ensureColumns(racingSheet, ['A', 'B', 'Двойник']);

  check('Гонка: заголовки перечитаны под замком (чтений больше одного)',
    reads >= 2, `чтений: ${reads}`);
  check('Гонка: колонку уже добавил другой запрос — второй раз не пишем',
    writes.length === 0, `записей: ${JSON.stringify(writes)}`);
  check('Гонка: двойника в шапке не появилось',
    headers.filter(x => x === 'Двойник').length === 1, `шапка: ${JSON.stringify(headers)}`);
})();

// ============ 25.08.2026: both shapes of «Упаковка» and «Прочее» must be read ============
// Reported by the owner: packaging entered «for the whole batch» never reached the cost of
// the goods. Its pattern demanded the «= N ₽» tail that only the per-piece shape has.
// «Прочее» carried the mirror image of the same defect.

(function test88() {
  const h = freshHarness();
  const P = (dest) => h.parseAdditionalCostsFromDestination(dest);

  check('Упаковка «на всю партию» больше не теряется',
    P('Ozon [Упаковка: 500₽]') === 500, `получено: ${P('Ozon [Упаковка: 500₽]')}`);
  check('Упаковка «на единицу» читается как прежде — берётся итог, а не цена штуки',
    P('Ozon [Упаковка: 196 шт. x 5₽ = 980₽]') === 980,
    `получено: ${P('Ozon [Упаковка: 196 шт. x 5₽ = 980₽]')}`);

  check('Прочее «на единицу» больше не теряется',
    P('Ozon [Прочее: 196 шт. x 55₽ = 10780₽]') === 10780,
    `получено: ${P('Ozon [Прочее: 196 шт. x 55₽ = 10780₽]')}`);
  check('Прочее «на всю партию» читается как прежде',
    P('Ozon [Прочее: 55₽]') === 55, `получено: ${P('Ozon [Прочее: 55₽]')}`);

  check('Обе части и услуги складываются вместе',
    P('Ozon [Упаковка: 500₽ | Прочее: 10 шт. x 7₽ = 70₽ | Услуги: Паллета x2 (600₽), Короб x1 (40₽)]') === 1210,
    `получено: ${P('Ozon [Упаковка: 500₽ | Прочее: 10 шт. x 7₽ = 70₽ | Услуги: Паллета x2 (600₽), Короб x1 (40₽)]')}`);

  check('Нет доп. расходов — ноль, а не выдумка',
    P('Ozon (Mercurius)') === 0 && P('') === 0, `получено: ${P('Ozon (Mercurius)')}`);
})();

(function test89() {
  // The exact destinations of the owner's production write-offs of 25.08.2026: their numbers
  // must not move, because those expenses are already in the books.
  const h = freshHarness();
  const P = (dest) => h.parseAdditionalCostsFromDestination(dest);

  const merc = 'Ozon (Mercurius) [Упаковка: 196 шт. x 5₽ = 980₽ | Услуги: Доставка по городу 1 короб x1 (159₽), Доставка  1 пал + сборка x3 (5097₽)]';
  check('Боевая операция Mercurius по-прежнему даёт 6236',
    P(merc) === 6236, `получено: ${P(merc)}`);

  const batch = 'Ozon (MaxiStore) [Упаковка: 294 шт. x 5₽ = 1470₽ | Услуги: Доставка  1 пал + сборка x1 (1699₽)] [Общая поставка: заявки № 124792864-1, № 124792158-1; доля этой заявки 84 из 294 шт., 905.43 руб. из 3169.00 руб.]';
  check('Боевая партия по-прежнему даёт 3169, а пометка про общую поставку денег не добавляет',
    P(batch) === 3169, `получено: ${P(batch)}`);

  const wb = 'Wildberries FBS [Упаковка: 1 шт. x 5₽ = 5₽ | Прочее: 55₽]';
  check('Боевое списание Wildberries по-прежнему даёт 60',
    P(wb) === 60, `получено: ${P(wb)}`);
})();

(function test90() {
  // End to end: the cost of the goods must actually carry the whole-batch packaging now.
  const h = freshHarness();
  const ts = h.ensureTransSheet();
  h.setStockSheet([{ article: 'ART-P', quantity: 10, avgCost: 100, capitalization: 1000 }]);
  h.commitTransaction(
    [{ article: 'ART-P', quantity: 10, price: 100 }],
    'Расход', 'Ozon (Shop) [Упаковка: 500₽]', '', 'tester', '2026-01-05T09:00:00Z', ''
  );
  const rows = dumpTransRows(ts);
  check('Упаковка «на всю партию» дошла до себестоимости (1000 + 500)',
    rows.length === 1 && rows[0].total === 1500, `получено: ${JSON.stringify(rows)}`);
  check('И на единицу товара она тоже разнеслась (100 + 50)',
    rows.length === 1 && rows[0].price === 150, `получено: ${rows.length && rows[0].price}`);
})();

// ============ Item 47, stage 1: журнал себестоимости товаров на Озоне ============
// Текущая себестоимость артикула — это ПОСЛЕДНЯЯ его строка в журнале. Ключ операции в
// строке отвечает на вопрос владельца «по какой поставке уже посчитано, а по какой нет».

// [Дата, Кабинет, Артикул, SKU, ОстатокДо, СебестДо, Отгружено, СебестОтгрузки, СебестПосле, OpID, Выгружено, Источник]
const costRow = (date, cab, art, after, opId, extra = {}) => [
  date, cab, art, extra.sku || '', extra.stockBefore ?? '', extra.costBefore ?? '',
  extra.shipped ?? '', extra.shippedCost ?? '', after, opId, extra.exported || '', extra.source || '',
];

(function test91() {
  const h = freshHarness();
  h.setOzonCostSheet([
    costRow('2026-08-01', 'MaxiStore', 'ART-A', 200.00, 'НАЧАЛЬНАЯ ТОЧКА', { sku: '111' }),
    costRow('2026-08-06', 'MaxiStore', 'ART-A', 210.50, 'op-1', { sku: '111', stockBefore: 100, costBefore: 200, shipped: 50, shippedCost: 231.5 }),
    costRow('2026-08-01', 'Mercurius', 'ART-B', 500.00, 'НАЧАЛЬНАЯ ТОЧКА', { sku: '222' }),
  ]);

  const journal = h.getOzonCostJournal();
  check('Item 47: журнал читается целиком и в порядке записи',
    journal.length === 3 && journal[0].article === 'ART-A' && journal[2].article === 'ART-B',
    `получено строк: ${journal.length}`);
  check('Item 47: числа разобраны как числа, а не как текст',
    journal[1].shipped === 50 && journal[1].shippedCost === 231.5 && journal[1].costAfter === 210.5,
    `получено: ${JSON.stringify(journal[1])}`);

  const state = h.getOzonCostState();
  check('Item 47: текущая себестоимость — последняя строка артикула, а не первая',
    state['MaxiStore|ART-A'].cost === 210.5, `получено: ${state['MaxiStore|ART-A'] && state['MaxiStore|ART-A'].cost}`);
  check('Item 47: артикул без отгрузок остаётся на своей начальной точке',
    state['Mercurius|ART-B'].cost === 500, `получено: ${state['Mercurius|ART-B'] && state['Mercurius|ART-B'].cost}`);
  check('Item 47: один и тот же артикул в разных магазинах — разные строки состояния',
    Object.keys(state).length === 2, `получено: ${Object.keys(state).join(', ')}`);
})();

(function test92() {
  // Один артикул в двух магазинах не должен слипаться: себестоимость у них своя.
  const h = freshHarness();
  h.setOzonCostSheet([
    costRow('2026-08-01', 'MaxiStore', 'ART-X', 100.00, 'НАЧАЛЬНАЯ ТОЧКА'),
    costRow('2026-08-01', 'Mercurius', 'ART-X', 900.00, 'НАЧАЛЬНАЯ ТОЧКА'),
  ]);
  const state = h.getOzonCostState();
  check('Item 47: одинаковый артикул в разных магазинах не смешивается',
    state['MaxiStore|ART-X'].cost === 100 && state['Mercurius|ART-X'].cost === 900,
    `получено: ${JSON.stringify(state)}`);
})();

(function test93() {
  const h = freshHarness();
  h.setOzonCostSheet([
    costRow('2026-08-06', 'MaxiStore', 'ART-A', 210.50, 'op-1'),
    costRow('2026-08-06', 'MaxiStore', 'ART-B', 300.00, 'op-1'),
  ]);
  const j = h.getOzonCostJournal();
  check('Item 47: поставка, уже посчитанная по этому артикулу, распознаётся',
    h.isOzonCostCounted(j, 'op-1', 'MaxiStore', 'ART-A') === true, '');
  check('Item 47: та же операция по ДРУГОМУ артикулу того же магазина тоже посчитана',
    h.isOzonCostCounted(j, 'op-1', 'MaxiStore', 'ART-B') === true, '');
  check('Item 47: артикул, которого в этой операции не было, не считается посчитанным',
    h.isOzonCostCounted(j, 'op-1', 'MaxiStore', 'ART-C') === false, '');
  check('Item 47: тот же ключ, но другой магазин — не посчитано',
    h.isOzonCostCounted(j, 'op-1', 'Mercurius', 'ART-A') === false, '');
  check('Item 47: новая операция не считается посчитанной',
    h.isOzonCostCounted(j, 'op-2', 'MaxiStore', 'ART-A') === false, '');
  check('Item 47: пустой ключ никогда не считается посчитанным — иначе одна кривая строка застопорит всё',
    h.isOzonCostCounted(j, '', 'MaxiStore', 'ART-A') === false, '');
})();

(function test94() {
  const h = freshHarness();
  h.setOzonCostSheet([]);
  check('Item 47: пустой журнал — пустое состояние, а не падение',
    h.getOzonCostJournal().length === 0 && Object.keys(h.getOzonCostState()).length === 0, '');
  check('Item 47: в пустом журнале ничего не посчитано',
    h.isOzonCostCounted([], 'op-1', 'MaxiStore', 'ART-A') === false, '');
  const created = h.getOzonCostJournal.length !== undefined;
  check('Item 47: лист создаётся сам, если его ещё нет',
    JSON.stringify(h.OZON_COST_HEADERS) === JSON.stringify(['Дата','Кабинет','Артикул','SKU','Остаток до','Себестоимость до','Отгружено','Себестоимость отгрузки','Себестоимость после','OpID','Выгружено в КАН','Источник']),
    `шапка: ${JSON.stringify(h.OZON_COST_HEADERS)}`);
})();

// ============ Item 47, этап 2: пересчёт себестоимости на Озоне при отгрузке ============
// Себестоимость товара НА ОЗОНЕ = скользящая средняя: каждая поставка подмешивает свою
// стоимость к тому, что там уже лежало. Основание — остаток МИНУС эта самая поставка:
// списание становится доступным только после того, как Озон принял товар, значит в остатке
// он уже сидит, и не вычесть его — значит смешать поставку саму с собой.

(function test95() {
  const h = freshHarness();
  h.setOzonCostSheet([
    costRow('2026-08-01', 'MaxiStore', 'ART-A', 500.00, 'НАЧАЛЬНАЯ ТОЧКА', { sku: '111' }),
  ]);
  // Озон принял на остаток 300 (290 доступно + 10 возвратов). «В пути» 40 в основание НЕ идёт:
  // это чужая колонка, товар в пути мы считаем по своим записям.
  h.setOzonStocksSheet([{ cabinet: 'MaxiStore', article: 'ART-A', available: 290, transit: 40, returns: 10 }]);

  const res = h.appendOzonCostForShipment(
    [{ article: 'ART-A', quantity: 100, price: 600, status: 'ok' }],
    'Ozon (MaxiStore) [Упаковка: 100₽]', '2026-08-26T09:00:00Z', 'op-1', 'tester'
  );
  const rows = h.dumpOzonCost();
  const last = rows[rows.length - 1];
  check('Item 47: строка дописана в журнал', res.written === 1 && rows.length === 2, `получено: ${JSON.stringify(res)}`);
  check('Item 47: основание — принятое Озоном, своя поставка не вычитается (290 + 10 = 300)',
    last['Остаток до'] === 300, `получено: ${last['Остаток до']}`);
  check('Item 47: средняя пересчитана верно ((300×500 + 100×600) / 400 = 525)',
    last['Себестоимость после'] === 525, `получено: ${last['Себестоимость после']}`);
  check('Item 47: в строке записаны и прежняя себестоимость, и себестоимость отгрузки',
    last['Себестоимость до'] === 500 && last['Себестоимость отгрузки'] === 600 && last['Отгружено'] === 100,
    `получено: ${JSON.stringify(last)}`);
  check('Item 47: ключ операции и дата отгрузки попали в строку',
    last['OpID'] === 'op-1' && last['Дата'] === '2026-08-26', `получено: ${last['OpID']} / ${last['Дата']}`);
  check('Item 47: SKU подхвачен из прежней строки артикула',
    last['SKU'] === '111', `получено: ${last['SKU']}`);
})();

(function test96() {
  // Требование владельца: приложение обязано знать, по какой поставке уже посчитано.
  const h = freshHarness();
  h.setOzonCostSheet([costRow('2026-08-01', 'MaxiStore', 'ART-A', 500.00, 'НАЧАЛЬНАЯ ТОЧКА')]);
  h.setOzonStocksSheet([{ cabinet: 'MaxiStore', article: 'ART-A', available: 300 }]);
  const items = [{ article: 'ART-A', quantity: 100, price: 600, status: 'ok' }];
  const dest = 'Ozon (MaxiStore)';

  h.appendOzonCostForShipment(items, dest, '2026-08-26T09:00:00Z', 'op-1', 'tester');
  const afterFirst = h.dumpOzonCost().length;
  const second = h.appendOzonCostForShipment(items, dest, '2026-08-26T09:00:00Z', 'op-1', 'tester');

  check('Item 47: та же поставка второй раз НЕ считается',
    second.written === 0 && second.skipped === 1 && h.dumpOzonCost().length === afterFirst,
    `получено: ${JSON.stringify(second)}, строк ${h.dumpOzonCost().length}`);
  const rows = h.dumpOzonCost();
  check('Item 47: себестоимость от повтора не сдвинулась',
    rows[rows.length - 1]['Себестоимость после'] === 525, `получено: ${rows[rows.length - 1]['Себестоимость после']}`);
})();

(function test97() {
  // Одна операция везёт несколько артикулов — у каждого своя строка и свой пересчёт.
  const h = freshHarness();
  h.setOzonCostSheet([
    costRow('2026-08-01', 'Mercurius', 'ART-A', 500.00, 'НАЧАЛЬНАЯ ТОЧКА'),
    costRow('2026-08-01', 'Mercurius', 'ART-B', 1000.00, 'НАЧАЛЬНАЯ ТОЧКА'),
  ]);
  h.setOzonStocksSheet([
    { cabinet: 'Mercurius', article: 'ART-A', available: 300 },
    { cabinet: 'Mercurius', article: 'ART-B', available: 40 },
  ]);
  const res = h.appendOzonCostForShipment(
    [{ article: 'ART-A', quantity: 100, price: 600, status: 'ok' },
     { article: 'ART-B', quantity: 10, price: 1200, status: 'ok' }],
    'Ozon (Mercurius)', '2026-08-26T09:00:00Z', 'op-multi', 'tester'
  );
  const rows = h.dumpOzonCost().filter(r => r['OpID'] === 'op-multi');
  check('Item 47: операция на два артикула дала две строки, второй не «съеден» защитой',
    res.written === 2 && rows.length === 2, `получено: ${JSON.stringify(res)}`);
  const a = rows.find(r => r['Артикул'] === 'ART-A'), b = rows.find(r => r['Артикул'] === 'ART-B');
  check('Item 47: каждый артикул пересчитан по своему остатку',
    a['Себестоимость после'] === 525 && b['Себестоимость после'] === 1040,
    `получено: ART-A ${a['Себестоимость после']}, ART-B ${b['Себестоимость после']}`);
})();

(function test98() {
  // Партия из двух заявок: один артикул приходит двумя строками одной операции.
  const h = freshHarness();
  h.setOzonCostSheet([costRow('2026-08-01', 'MaxiStore', 'ART-A', 500.00, 'НАЧАЛЬНАЯ ТОЧКА')]);
  h.setOzonStocksSheet([{ cabinet: 'MaxiStore', article: 'ART-A', available: 300 }]);
  const res = h.appendOzonCostForShipment(
    [{ article: 'ART-A', quantity: 60, price: 600, status: 'ok' },
     { article: 'ART-A', quantity: 40, price: 600, status: 'ok' }],
    'Ozon (MaxiStore)', '2026-08-26T09:00:00Z', 'op-1', 'tester'
  );
  const rows = h.dumpOzonCost();
  const last = rows[rows.length - 1];
  check('Item 47: две строки одного артикула сложились в одну запись, а не потерялись',
    res.written === 1 && last['Отгружено'] === 100, `получено: ${JSON.stringify(res)}, отгружено ${last['Отгружено']}`);
  check('Item 47: и дали ту же среднюю, что одна строка на 100 шт',
    last['Себестоимость после'] === 525, `получено: ${last['Себестоимость после']}`);
})();

(function test99() {
  const h = freshHarness();
  h.setOzonCostSheet([]);
  h.setOzonStocksSheet([{ cabinet: 'MaxiStore', article: 'НОВЫЙ', available: 0 }]);
  h.appendOzonCostForShipment(
    [{ article: 'НОВЫЙ', quantity: 50, price: 777.5, status: 'ok' }],
    'Ozon (MaxiStore)', '2026-08-26T09:00:00Z', 'op-new', 'tester'
  );
  const last = h.dumpOzonCost().slice(-1)[0];
  check('Item 47: у артикула без прежней себестоимости берётся себестоимость отгрузки',
    last['Себестоимость после'] === 777.5, `получено: ${last['Себестоимость после']}`);
  check('Item 47: и это честно помечено в источнике строки',
    String(last['Источник']).indexOf('прежней себестоимости нет') !== -1, `получено: ${last['Источник']}`);
})();

(function test100() {
  const h = freshHarness();
  h.setOzonCostSheet([costRow('2026-08-01', 'MaxiStore', 'ART-A', 500.00, 'НАЧАЛЬНАЯ ТОЧКА')]);
  h.setOzonStocksSheet([{ cabinet: 'MaxiStore', article: 'ART-A', available: 300 }]);

  const notOzon = h.appendOzonCostForShipment(
    [{ article: 'ART-A', quantity: 10, price: 600, status: 'ok' }],
    'Wildberries FBS [Упаковка: 5₽]', '2026-08-26T09:00:00Z', 'op-wb', 'tester');
  check('Item 47: списание не на Ozon журнал не трогает',
    notOzon.written === 0 && h.dumpOzonCost().length === 1, `получено: ${JSON.stringify(notOzon)}`);

  check('Item 47: магазин вынимается из назначения',
    h.ozonCabinetFromDestination('Ozon (MaxiStore) [Упаковка: 1₽]') === 'MaxiStore' &&
    h.ozonCabinetFromDestination('Склад') === '', '');

  const zeroQty = h.appendOzonCostForShipment(
    [{ article: 'ART-A', quantity: 0, price: 600, status: 'ok' }],
    'Ozon (MaxiStore)', '2026-08-26T09:00:00Z', 'op-zero', 'tester');
  check('Item 47: строка с нулевым количеством не создаёт записи',
    zeroQty.written === 0, `получено: ${JSON.stringify(zeroQty)}`);

  const bad = h.appendOzonCostForShipment(
    [{ article: 'ART-A', quantity: 10, price: 600, status: 'unknown' }],
    'Ozon (MaxiStore)', '2026-08-26T09:00:00Z', 'op-bad', 'tester');
  check('Item 47: нераспознанная позиция в пересчёт не идёт — её и сервер не проводит',
    bad.written === 0, `получено: ${JSON.stringify(bad)}`);
})();

(function test101() {
  // Основание = «Доступно» + «Возвраты» по всем складам. «В пути», «В заявках», «Готовим»,
  // «Излишки» и «Прочее» в него не входят: товар в пути считается по нашим записям.
  const h = freshHarness();
  h.setOzonStocksSheet([
    { cabinet: 'MaxiStore', article: 'ART-A', warehouse: 'W1', available: 100, transit: 10, returns: 1, preparing: 7, requested: 9, excess: 3, other: 5 },
    { cabinet: 'MaxiStore', article: 'ART-A', warehouse: 'W2', available: 50, transit: 5, returns: 2 },
    { cabinet: 'Mercurius', article: 'ART-A', warehouse: 'W1', available: 999 },
    { cabinet: 'MaxiStore', article: 'ART-B', warehouse: 'W1', available: 777 },
  ]);
  check('Item 47: принято Озоном = Доступно + Возвраты по всем складам (153), «В пути» не в счёт',
    h.getOzonAcceptedStockForCost('MaxiStore', 'ART-A') === 153,
    `получено: ${h.getOzonAcceptedStockForCost('MaxiStore', 'ART-A')}`);
  check('Item 47: чужой магазин в остаток не попадает',
    h.getOzonAcceptedStockForCost('Mercurius', 'ART-A') === 999, `получено: ${h.getOzonAcceptedStockForCost('Mercurius', 'ART-A')}`);
  check('Item 47: артикула нет на Озоне — ноль, а не падение',
    h.getOzonAcceptedStockForCost('MaxiStore', 'НЕТ-ТАКОГО') === 0, '');
})();

(function test101b() {
  // Товар в пути берём из СВОИХ записей: списанные поставки, которые Озон ещё не завершил.
  const h = freshHarness();
  h.setSkuSheet(['SKU', 'ШТ/КОР', 'ШК Ozon'], [['ART-A', 10, 'OZN-A'], ['ART-B', 10, 'OZN-B']]);
  h.setExternalShipmentsSheet([
    { cabinet: 'MaxiStore', status: 'processed', ozonStatus: 'IN_TRANSIT', items: [{ offerId: 'ART-A', quantity: 40 }] },
    { cabinet: 'MaxiStore', status: 'processed', ozonStatus: 'ACCEPTED_AT_SUPPLY_WAREHOUSE', items: [{ offerId: 'ART-A', quantity: 25 }] },
    { cabinet: 'MaxiStore', status: 'processed', ozonStatus: 'ACCEPTANCE_AT_STORAGE_WAREHOUSE', items: [{ offerId: 'ART-A', quantity: 111 }] },
    { cabinet: 'MaxiStore', status: 'processed', ozonStatus: 'REPORTS_CONFIRMATION_AWAITING', items: [{ offerId: 'ART-A', quantity: 222 }] },
    { cabinet: 'MaxiStore', status: 'processed', ozonStatus: 'COMPLETED', items: [{ offerId: 'ART-A', quantity: 1000 }] },
    { cabinet: 'MaxiStore', status: 'processed', ozonStatus: 'CANCELLED', items: [{ offerId: 'ART-A', quantity: 500 }] },
    { cabinet: 'MaxiStore', status: 'new', ozonStatus: 'IN_TRANSIT', items: [{ offerId: 'ART-A', quantity: 300 }] },
    { cabinet: 'Mercurius', status: 'processed', ozonStatus: 'IN_TRANSIT', items: [{ offerId: 'ART-A', quantity: 700 }] },
    { cabinet: 'MaxiStore', status: 'processed', ozonStatus: 'IN_TRANSIT', items: [{ barcode: 'OZN-B', offerId: 'чужой-код', quantity: 9 }] },
  ]);
  const flight = h.getOzonShippedNotAcceptedForCost('MaxiStore', h.buildOzonArticleResolver());
  check('Item 47: в пути считаются только списанные и не завершённые поставки (40 + 25 = 65)',
    flight['ART-A'] === 65, `получено: ${JSON.stringify(flight)}`);
  check('Item 47: завершённая поставка в «в пути» не идёт — её товар уже в «Доступно»',
    flight['ART-A'] !== 1065, `получено: ${flight['ART-A']}`);
  check('Item 47: доехавшая до склада хранения — тоже не в пути, Озон уже поставил её на остаток',
    flight['ART-A'] === 65, `получено: ${flight['ART-A']} (ожидалось 65, без 111 и 222)`);
  check('Item 47: НЕ списанная поставка в основание не идёт — её себестоимость ещё не подмешана',
    flight['ART-A'] === 65, `получено: ${flight['ART-A']}`);
  check('Item 47: артикул опознан по штрихкоду Ozon, когда offerId чужой',
    flight['ART-B'] === 9, `получено: ${JSON.stringify(flight)}`);
})();

(function test102() {
  // Сквозная проверка: настоящее списание через commitTransaction должно само дописать
  // строку в журнал себестоимости — без отдельного вызова откуда-либо ещё.
  const h = freshHarness();
  h.ensureTransSheet();
  h.setStockSheet([{ article: 'ART-E2E', quantity: 200, avgCost: 300, capitalization: 60000 }]);
  h.setOzonCostSheet([costRow('2026-08-01', 'MaxiStore', 'ART-E2E', 500.00, 'НАЧАЛЬНАЯ ТОЧКА')]);
  h.setOzonStocksSheet([{ cabinet: 'MaxiStore', article: 'ART-E2E', available: 300 }]);

  h.commitTransaction(
    [{ article: 'ART-E2E', quantity: 100, price: 300 }],
    'Расход', 'Ozon (MaxiStore) [Упаковка: 100 шт. x 300₽ = 30000₽]', '', 'tester',
    '2026-08-26T09:00:00Z', 'op-e2e'
  );

  const rows = h.dumpOzonCost();
  const last = rows[rows.length - 1];
  check('Item 47: обычное списание на Ozon само дописало строку в журнал',
    rows.length === 2 && last['OpID'] === 'op-e2e', `строк: ${rows.length}, ключ: ${last && last['OpID']}`);
  check('Item 47: в журнал попала себестоимость С УЧЁТОМ разнесённых расходов (300 + 300 = 600)',
    last['Себестоимость отгрузки'] === 600, `получено: ${last['Себестоимость отгрузки']}`);
  check('Item 47: и средняя посчитана от неё ((300×500 + 100×600) / 400 = 525)',
    last['Себестоимость после'] === 525, `получено: ${last['Себестоимость после']}`);

  // Повтор той же операции: сервер отдаёт прежний результат по ключу идемпотентности,
  // и журнал тоже не должен вырасти.
  h.commitTransaction(
    [{ article: 'ART-E2E', quantity: 100, price: 300 }],
    'Расход', 'Ozon (MaxiStore) [Упаковка: 100 шт. x 300₽ = 30000₽]', '', 'tester',
    '2026-08-26T09:00:00Z', 'op-e2e'
  );
  check('Item 47: повтор операции журнал не удлинил',
    h.dumpOzonCost().length === 2, `строк: ${h.dumpOzonCost().length}`);
})();

(function test103() {
  // Списание на свой склад или на другую площадку журнала не касается.
  const h = freshHarness();
  h.ensureTransSheet();
  h.setStockSheet([{ article: 'ART-W', quantity: 50, avgCost: 100, capitalization: 5000 }]);
  h.setOzonCostSheet([costRow('2026-08-01', 'MaxiStore', 'ART-W', 100.00, 'НАЧАЛЬНАЯ ТОЧКА')]);
  h.setOzonStocksSheet([{ cabinet: 'MaxiStore', article: 'ART-W', available: 400 }]);
  h.commitTransaction([{ article: 'ART-W', quantity: 10, price: 100 }],
    'Расход', 'Склад [Списание - Брак]', '', 'tester', '2026-08-26T09:00:00Z', 'op-scrap');
  check('Item 47: списание брака на складе журнал себестоимости Озона не трогает',
    h.dumpOzonCost().length === 1, `строк: ${h.dumpOzonCost().length}`);

  h.commitTransaction([{ article: 'ART-W', quantity: 5, price: 100 }],
    'Приход', 'Ozon (MaxiStore)', '', 'tester', '2026-08-26T09:00:00Z', 'op-income');
  check('Item 47: приход журнал тоже не трогает — себестоимость на Озоне двигает только отгрузка',
    h.dumpOzonCost().length === 1, `строк: ${h.dumpOzonCost().length}`);
})();

(function test104() {
  // Требование владельца: себестоимость виртуального комплекта = комплектующие + услуги
  // подрядчиков по упаковке и доставке. В журнал должна попасть строка КОМПЛЕКТА с полной
  // себестоимостью, а не строки комплектующих.
  const h = freshHarness();
  h.ensureTransSheet();
  h.setKitSheet([
    { kitSku: 'КОМПЛЕКТ', componentSku: 'МИСКА', quantity: 1, kitType: 'virtual' },
    { kitSku: 'КОМПЛЕКТ', componentSku: 'ПАКЕТ', quantity: 1, kitType: 'virtual' },
  ]);
  h.setStockSheet([
    { article: 'МИСКА', quantity: 500, avgCost: 190, capitalization: 95000 },
    { article: 'ПАКЕТ', quantity: 500, avgCost: 10, capitalization: 5000 },
  ]);
  h.setOzonCostSheet([costRow('2026-08-01', 'MaxiStore', 'КОМПЛЕКТ', 200.00, 'НАЧАЛЬНАЯ ТОЧКА')]);
  h.setOzonStocksSheet([{ cabinet: 'MaxiStore', article: 'КОМПЛЕКТ', available: 100 }]);

  // 100 комплектов: 190 + 10 = 200 за комплектующие, плюс услуги 5000 на 100 шт = 50 на штуку.
  h.commitTransaction(
    [{ article: 'КОМПЛЕКТ', quantity: 100, price: 0 }],
    'Расход', 'Ozon (MaxiStore) [Услуги: Паллета x1 (5000₽)]', '', 'tester',
    '2026-08-26T09:00:00Z', 'op-kit'
  );

  const rows = h.dumpOzonCost();
  const kitRows = rows.filter(r => r['OpID'] === 'op-kit');
  check('Item 47: у комплекта одна строка в журнале, комплектующие в журнал не попали',
    kitRows.length === 1 && kitRows[0]['Артикул'] === 'КОМПЛЕКТ',
    `получено: ${JSON.stringify(kitRows.map(r => r['Артикул']))}`);
  check('Item 47: себестоимость комплекта = комплектующие + услуги (190 + 10 + 50 = 250)',
    kitRows[0]['Себестоимость отгрузки'] === 250, `получено: ${kitRows[0]['Себестоимость отгрузки']}`);
  check('Item 47: средняя на Озоне пересчитана от полной себестоимости ((100×200 + 100×250) / 200 = 225)',
    kitRows[0]['Себестоимость после'] === 225, `получено: ${kitRows[0]['Себестоимость после']}`);
})();

// ================= Пункт 47, этап 3: выгрузка себестоимости в КАН =================

(function test110() {
  // Что попадает в файл: всё, чего КАН ещё не видел, включая строки «НАЧАЛЬНАЯ ТОЧКА».
  const h = freshHarness();
  h.setOzonCostSheet([
    costRow('2026-08-01', 'MaxiStore', 'ART-A', 200.00, 'НАЧАЛЬНАЯ ТОЧКА', { sku: '111' }),
    costRow('2026-08-06', 'MaxiStore', 'ART-A', 210.50, 'op-1', { sku: '111', shipped: 50, shippedCost: 231.5 }),
    costRow('2026-08-10', 'Mercurius', 'ART-B', 500.00, 'op-2', { sku: '222', exported: '2026-08-11 10:00:00 admin' }),
  ]);

  const res = h.getOzonCostExport();
  check('Item 47: в выгрузку попали только строки без отметки',
    res.pending === 2 && res.rows.every(r => r.article === 'ART-A'),
    `получено: ${JSON.stringify(res.rows.map(r => r.article))}`);
  check('Item 47: строка «НАЧАЛЬНАЯ ТОЧКА» тоже выгружается — это первая себестоимость артикула',
    res.rows.some(r => r.opId === 'НАЧАЛЬНАЯ ТОЧКА'),
    `получено: ${JSON.stringify(res.rows.map(r => r.opId))}`);
  check('Item 47: строки идут в порядке листа, от старой к новой',
    res.rows[0].date === '2026-08-01' && res.rows[1].date === '2026-08-06',
    `получено: ${res.rows.map(r => r.date).join(', ')}`);
  check('Item 47: в КАН уходит «Себестоимость после», а не себестоимость отгрузки',
    res.rows[1].cost === 210.5, `получено: ${res.rows[1].cost}`);
  check('Item 47: каждая строка знает свой номер в листе — по нему потом ставится отметка',
    res.rows[0].row === 2 && res.rows[1].row === 3,
    `получено: ${res.rows.map(r => r.row).join(', ')}`);
})();

(function test111() {
  // Отметка ставится только тем строкам, что реально ушли в файл, и только один раз.
  const h = freshHarness();
  h.setOzonCostSheet([
    costRow('2026-08-01', 'MaxiStore', 'ART-A', 200.00, 'НАЧАЛЬНАЯ ТОЧКА', { sku: '111' }),
    costRow('2026-08-06', 'MaxiStore', 'ART-A', 210.50, 'op-1', { sku: '111' }),
  ]);

  const first = h.getOzonCostExport();
  const marked = h.markOzonCostExported({ rows: first.rows.map(r => ({
    row: r.row, opId: r.opId, cabinet: r.cabinet, article: r.article
  })) }, 'tester');

  check('Item 47: отмечены обе выгруженные строки, расхождений нет',
    marked.marked === 2 && marked.mismatched.length === 0,
    `отмечено: ${marked.marked}, расхождений: ${marked.mismatched.length}`);

  const rows = h.dumpOzonCost();
  check('Item 47: отметка записана в колонку «Выгружено в КАН» и несёт имя пользователя',
    rows.every(r => String(r['Выгружено в КАН']).indexOf('tester') !== -1),
    `получено: ${JSON.stringify(rows.map(r => r['Выгружено в КАН']))}`);

  // Владелец 26.08.2026: файл должен отдаваться ВСЕГДА. Новых отгрузок нет — значит нечего
  // пересчитывать, и в файл идут последние расчётные данные, то есть строки прошлой выгрузки.
  const second = h.getOzonCostExport();
  check('Item 47: повторное нажатие отдаёт последние расчётные данные, а не пустоту',
    second.repeat === true && second.rows.length === 2,
    `повтор: ${second.repeat}, строк: ${second.rows.length}`);
  check('Item 47: новых строк при этом ноль — сообщение будет честным',
    second.pending === 0, `получено: ${second.pending}`);
  check('Item 47: повтор несёт время прошлой выгрузки',
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(second.lastExportedAt),
    `получено: ${second.lastExportedAt}`);
  check('Item 47: и общее число строк журнала при этом не изменилось',
    second.total === 2, `получено: ${second.total}`);
})();

(function test112() {
  // Новая отгрузка после выгрузки: в файл идёт только она.
  const h = freshHarness();
  h.ensureTransSheet();
  h.setStockSheet([{ article: 'ART-N', quantity: 200, avgCost: 300, capitalization: 60000 }]);
  h.setOzonCostSheet([costRow('2026-08-01', 'MaxiStore', 'ART-N', 500.00, 'НАЧАЛЬНАЯ ТОЧКА', { sku: '777' })]);
  h.setOzonStocksSheet([{ cabinet: 'MaxiStore', article: 'ART-N', available: 300, sku: '777' }]);

  const before = h.getOzonCostExport();
  h.markOzonCostExported({ rows: before.rows.map(r => ({
    row: r.row, opId: r.opId, cabinet: r.cabinet, article: r.article
  })) }, 'tester');

  h.commitTransaction(
    [{ article: 'ART-N', quantity: 100, price: 300 }],
    'Расход', 'Ozon (MaxiStore)', '', 'tester', '2026-08-26T09:00:00Z', 'op-new'
  );

  const after = h.getOzonCostExport();
  check('Item 47: после новой отгрузки в выгрузку идёт ровно одна новая строка',
    after.pending === 1 && after.rows[0].opId === 'op-new',
    `получено: ${JSON.stringify(after.rows.map(r => r.opId))}`);
  check('Item 47: и это не повтор, а новый расчёт',
    after.repeat === false, `получено: ${after.repeat}`);
  check('Item 47: уже выгруженная строка второй раз не выгружается',
    after.rows.every(r => r.opId !== 'НАЧАЛЬНАЯ ТОЧКА'),
    `получено: ${JSON.stringify(after.rows.map(r => r.opId))}`);

  // Отмечаем новую строку и жмём ещё раз: повтор обязан взять ТОЛЬКО последнюю выгрузку,
  // а не всё, что когда-либо уходило в КАН. Часы стенда стоят, поэтому вторую выгрузку
  // сдвигаем во времени руками — иначе обе отметки получат одну метку и проверка ничего
  // не проверит.
  h.setNow('2026-01-06T09:00:00Z');
  h.markOzonCostExported({ rows: after.rows.map(r => ({
    row: r.row, opId: r.opId, cabinet: r.cabinet, article: r.article
  })) }, 'tester');
  const repeat = h.getOzonCostExport();
  check('Item 47: повтор берёт только последнюю выгрузку, а не весь журнал',
    repeat.repeat === true && repeat.rows.length === 1 && repeat.rows[0].opId === 'op-new',
    `строк: ${repeat.rows.length}, ключи: ${JSON.stringify(repeat.rows.map(r => r.opId))}`);
  h.setNow('2026-01-05T09:00:00Z');
})();

(function test113() {
  // Строка сдвинулась после сборки файла — отметку ставить нельзя: она попадёт не туда,
  // и изменение себестоимости КАН не увидит никогда.
  const h = freshHarness();
  h.setOzonCostSheet([
    costRow('2026-08-01', 'MaxiStore', 'ART-A', 200.00, 'op-1', { sku: '111' }),
    costRow('2026-08-02', 'MaxiStore', 'ART-B', 300.00, 'op-2', { sku: '222' }),
  ]);

  const wrongOp = h.markOzonCostExported({ rows: [
    { row: 2, opId: 'op-ЧУЖОЙ', cabinet: 'MaxiStore', article: 'ART-A' }
  ] }, 'tester');
  check('Item 47: чужой ключ операции — отметка НЕ ставится, расхождение возвращается',
    wrongOp.marked === 0 && wrongOp.mismatched.length === 1,
    `отмечено: ${wrongOp.marked}, расхождений: ${wrongOp.mismatched.length}`);

  const wrongArticle = h.markOzonCostExported({ rows: [
    { row: 2, opId: 'op-1', cabinet: 'MaxiStore', article: 'ART-B' }
  ] }, 'tester');
  check('Item 47: тот же ключ, но другой артикул — тоже расхождение, а не тихая отметка',
    wrongArticle.marked === 0 && wrongArticle.mismatched.length === 1,
    `отмечено: ${wrongArticle.marked}`);

  const outOfRange = h.markOzonCostExported({ rows: [
    { row: 99, opId: 'op-1', cabinet: 'MaxiStore', article: 'ART-A' }
  ] }, 'tester');
  check('Item 47: номера строки нет в листе — сообщение, а не падение',
    outOfRange.marked === 0 && outOfRange.mismatched[0].reason.indexOf('нет') !== -1,
    `получено: ${JSON.stringify(outOfRange.mismatched)}`);

  check('Item 47: после трёх неудачных попыток обе строки остались невыгруженными',
    h.getOzonCostExport().pending === 2, `получено: ${h.getOzonCostExport().pending}`);
})();

(function test114() {
  // Пустой SKU выгрузку не роняет — товар мог не доехать до справочника Озона.
  const h = freshHarness();
  h.setOzonCostSheet([
    costRow('2026-08-01', 'MaxiStore', 'ART-БЕЗ-SKU', 123.45, 'op-1'),
  ]);
  const res = h.getOzonCostExport();
  check('Item 47: строка с пустым SKU выгружается, поле остаётся пустым',
    res.pending === 1 && res.rows[0].sku === '' && res.rows[0].cost === 123.45,
    `получено: ${JSON.stringify(res.rows)}`);

  const marked = h.markOzonCostExported({ rows: [{
    row: res.rows[0].row, opId: 'op-1', cabinet: 'MaxiStore', article: 'ART-БЕЗ-SKU'
  }] }, 'tester');
  check('Item 47: и отмечается она так же, как любая другая',
    marked.marked === 1, `отмечено: ${marked.marked}`);
})();

(function test115a() {
  // Журнал пуст: отдавать нечего, но и падать нельзя — фронтенд отдаст файл с одним заголовком.
  const h = freshHarness();
  h.setOzonCostSheet([]);
  const res = h.getOzonCostExport();
  check('Item 47: пустой журнал — ноль строк и никакого падения',
    res.rows.length === 0 && res.total === 0, `получено: ${JSON.stringify(res)}`);
})();

(function test115() {
  // Пустой список на входе — не запись в лист и не ошибка.
  const h = freshHarness();
  h.setOzonCostSheet([costRow('2026-08-01', 'MaxiStore', 'ART-A', 200.00, 'op-1')]);
  const res = h.markOzonCostExported({ rows: [] }, 'tester');
  check('Item 47: отметить нечего — ноль отмеченных и ни одной правки в листе',
    res.marked === 0 && h.getOzonCostExport().pending === 1,
    `отмечено: ${res.marked}`);
})();

// ====== Пункт 47, этап 4, подготовка: правка и удаление операций на стенде ======
// Стенд впервые умеет удалять строки и вести лист «Удаленное». До 26.08.2026 вся эта
// область не проверялась вовсе — правка операции это «удалить и провести заново», а
// поддельные листы не умели ни того, ни другого.

// Готовый склад с одним приходом: возвращает стенд и идентификатор строки прихода.
function withReceipt(price, qty, opts) {
  opts = opts || {};
  const h = freshHarness();
  h.ensureTransSheet();
  h.ensureArchiveSheet();
  h.setStockSheet([{ article: 'ART', quantity: 0, avgCost: 0, capitalization: 0 }]);
  h.setOzonCostSheet(opts.costRows || []);
  h.setOzonStocksSheet([{ cabinet: 'MaxiStore', article: 'ART', available: opts.ozonAvailable || 500, sku: '999' }]);
  h.commitTransaction([{ article: 'ART', quantity: qty, price: price }],
    'Приход', 'Склад', '', 'tester', opts.date || '2026-08-01T09:00:00Z', 'op-in');
  const id = h.getTransactions().rows.find(t => t.type === 'Приход').id;
  return { h, id };
}

const editReceipt = (h, id, price, qty, date) => h.updateTransaction(id, {
  article: 'ART', quantity: qty, price: price, type: 'Приход',
  destination: 'Склад', date: date || '2026-08-01T09:00:00Z'
}, 'tester');

(function test120() {
  // Цена вверх, ничего не отгружено: количество на месте, деньги пересчитаны.
  const { h, id } = withReceipt(300, 100);
  editReceipt(h, id, 400, 100);
  const st = h.stockOf('ART');
  check('Правка прихода: количество не изменилось',
    st.quantity === 100, `получено: ${st.quantity}`);
  check('Правка прихода: капитализация стала 100 x 400 = 40000',
    st.capitalization === 40000, `получено: ${st.capitalization}`);
  check('Правка прихода: средняя себестоимость стала 400',
    st.avgCost === 400, `получено: ${st.avgCost}`);
  check('Правка прихода: строк в Истории по-прежнему одна, а не две',
    h.getTransactions().rows.length === 1, `получено: ${h.getTransactions().rows.length}`);
  check('Правка прихода: прежняя версия ушла в «Удаленное»',
    h.dumpArchive().length === 1 && h.dumpArchive()[0].data.type === 'UpdatedVersion',
    `получено: ${JSON.stringify(h.dumpArchive().map(a => a.data.type))}`);
  check('Правка прихода: в архиве лежит СТАРАЯ цена, а не новая',
    h.dumpArchive()[0].data.price === 300, `получено: ${h.dumpArchive()[0].data.price}`);
})();

(function test121() {
  // Цена вниз — то же самое в обратную сторону.
  const { h, id } = withReceipt(400, 100);
  editReceipt(h, id, 250, 100);
  const st = h.stockOf('ART');
  check('Правка прихода вниз: капитализация 25000, средняя 250',
    st.capitalization === 25000 && st.avgCost === 250,
    `получено: кап=${st.capitalization}, средняя=${st.avgCost}`);
})();

(function test122() {
  // Правка количества, а не цены: тоже разрешена, пока ничего не отгружено.
  const { h, id } = withReceipt(300, 100);
  editReceipt(h, id, 300, 120);
  const st = h.stockOf('ART');
  check('Правка количества прихода: 120 шт и капитализация 36000',
    st.quantity === 120 && st.capitalization === 36000,
    `получено: ${st.quantity} шт, кап=${st.capitalization}`);
})();

(function test123() {
  // Две партии по разным ценам, правим ПЕРВУЮ: средняя обязана пересчитаться по обеим.
  const { h, id } = withReceipt(300, 100);
  h.commitTransaction([{ article: 'ART', quantity: 50, price: 600 }],
    'Приход', 'Склад', '', 'tester', '2026-08-05T09:00:00Z', 'op-in2');
  const before = h.stockOf('ART');
  check('Две партии: до правки средняя (100x300 + 50x600) / 150 = 400',
    before.avgCost === 400 && before.capitalization === 60000,
    `получено: средняя=${before.avgCost}, кап=${before.capitalization}`);

  editReceipt(h, id, 360, 100);
  const st = h.stockOf('ART');
  check('Две партии: после правки первой средняя (100x360 + 50x600) / 150 = 440',
    st.avgCost === 440 && st.capitalization === 66000,
    `получено: средняя=${st.avgCost}, кап=${st.capitalization}`);
  check('Две партии: количество не поехало — 150 шт',
    st.quantity === 150, `получено: ${st.quantity}`);
})();

(function test124() {
  // ЛОВУШКА ДЛЯ ЭТАПА 4: правка не переписывает строку на месте, а дописывает её В КОНЕЦ.
  // Значит порядок строк в листе перестаёт совпадать с порядком дат, и проигрывание
  // истории обязано сортировать по ДАТЕ, а не по номеру строки.
  const { h, id } = withReceipt(300, 100);
  h.commitTransaction([{ article: 'ART', quantity: 50, price: 600 }],
    'Приход', 'Склад', '', 'tester', '2026-08-05T09:00:00Z', 'op-in2');
  editReceipt(h, id, 360, 100, '2026-08-01T09:00:00Z');

  const sheetOrder = h.dumpTransSheet().map(r => String(r['Дата']).slice(0, 10));
  check('Правка ставит строку в КОНЕЦ листа: даты в листе идут не по порядку',
    sheetOrder.length === 2 && sheetOrder[0] === '2026-08-05' && sheetOrder[1] === '2026-08-01',
    `порядок дат в листе: ${sheetOrder.join(', ')}`);
  check('Но сама дата операции сохранена, а не подменена днём правки',
    sheetOrder.indexOf('2026-08-01') !== -1, `получено: ${sheetOrder.join(', ')}`);
})();

(function test125() {
  // Удаление прихода, из которого ничего не ушло: склад возвращается в ноль.
  const { h, id } = withReceipt(300, 100);
  h.deleteTransaction(id, 'tester');
  const st = h.stockOf('ART');
  check('Удаление прихода: остаток и капитализация обнулились',
    st.quantity === 0 && st.capitalization === 0 && st.avgCost === 0,
    `получено: ${st.quantity} шт, кап=${st.capitalization}, средняя=${st.avgCost}`);
  check('Удаление прихода: строка из Истории убрана',
    h.getTransactions().rows.length === 0, `получено: ${h.getTransactions().rows.length}`);
})();

(function test126() {
  // Защита от отрицательного остатка при НАСТОЯЩЕМ удалении прихода обязана остаться:
  // товара на складе меньше, чем в приходе, потому что часть уже уехала.
  const { h, id } = withReceipt(300, 100);
  h.commitTransaction([{ article: 'ART', quantity: 50, price: 300 }],
    'Расход', 'Ozon (MaxiStore)', '', 'tester', '2026-08-10T09:00:00Z', 'op-ship');
  let message = '';
  try { h.deleteTransaction(id, 'tester'); } catch (e) { message = String(e.message || e); }
  check('Удаление отгруженного прихода отклонено — защита от отрицательного остатка',
    message.indexOf('отрицательному остатку') !== -1, `получено: ${message || 'без ошибки'}`);
  check('И склад после отказа не тронут: 50 шт на месте',
    h.stockOf('ART').quantity === 50, `получено: ${h.stockOf('ART').quantity}`);
})();

// Приход 100 x 300, из него 50 шт уехали на Озон по 300. На складе 50 шт на 15000 руб.
function withShippedReceipt() {
  const made = withReceipt(300, 100);
  made.h.commitTransaction([{ article: 'ART', quantity: 50, price: 300 }],
    'Расход', 'Ozon (MaxiStore)', '', 'tester', '2026-08-10T09:00:00Z', 'op-ship');
  return made;
}

(function test127() {
  // ЭТАП 2 ИСПРАВИЛ. Правка цены количества не меняет, запрещать её не за что.
  const { h, id } = withShippedReceipt();
  const before = h.stockOf('ART');
  check('До правки: на складе 50 шт на 15000 руб по 300',
    before.quantity === 50 && before.capitalization === 15000 && before.avgCost === 300,
    `получено: ${before.quantity} шт, кап=${before.capitalization}, средняя=${before.avgCost}`);

  let message = '';
  try { editReceipt(h, id, 400, 100); } catch (e) { message = String(e.message || e); }
  check('Правка цены отгруженного прихода ПРОХОДИТ, а не отклоняется',
    message === '', `получено: ${message}`);
  check('И новая цена записана — 400',
    h.getTransactions().rows.find(t => t.type === 'Приход').price === 400,
    `получено: ${h.getTransactions().rows.find(t => t.type === 'Приход').price}`);
  check('Количество на складе не поехало — по-прежнему 50 шт',
    h.stockOf('ART').quantity === 50, `получено: ${h.stockOf('ART').quantity}`);

  // ПОДЭТАП 4. Разница 100 x (400 - 300) = 10000 руб НЕ оседает на остатке целиком:
  // 5000 из них принадлежат уехавшим 50 шт. После пересчёта остаток 50 шт стоит 20000
  // при средней 400, а отгрузка — тоже по 400.
  const after = h.stockOf('ART');
  check('Подэтап 4: остаток 20000 руб на 50 шт, средняя 400 — а не 500',
    after.capitalization === 20000 && after.avgCost === 400,
    `получено: кап=${after.capitalization}, средняя=${after.avgCost}`);
  const shipped = h.getTransactions().rows.find(t => t.type === 'Расход');
  check('Подэтап 4: себестоимость списания отгрузки пересчитана с 15000 на 20000',
    shipped.writeOffCost === 20000, `получено: ${shipped.writeOffCost}`);
  const journal = h.dumpOzonCost();
  check('Подэтап 4: в журнал дописана строка с новой себестоимостью 400',
    journal.length === 2 && journal[1]['Себестоимость отгрузки'] === 400,
    `получено: ${JSON.stringify(journal.map(r => r['Себестоимость отгрузки']))}`);
  check('Подэтап 4: у дописанной строки дата ТОЙ отгрузки, а не сегодняшняя',
    String(journal[1]['Дата']).slice(0, 10) === '2026-08-10',
    `получено: ${journal[1]['Дата']}`);
  check('Подэтап 4: и она помечена как пересчёт, чтобы происхождение было видно',
    String(journal[1]['Источник']).indexOf('пересчёт') !== -1,
    `получено: ${journal[1]['Источник']}`);
  check('Подэтап 4: отметка о выгрузке пуста — строка уедет в КАН ближайшей выгрузкой',
    String(journal[1]['Выгружено в КАН']).trim() === '' && h.getOzonCostExport().pending === 2,
    `получено: "${journal[1]['Выгружено в КАН']}", в очереди: ${h.getOzonCostExport().pending}`);
})();

(function test150() {
  // Цена ВНИЗ: 300 -> 200. Отгруженные 50 шт должны подешеветь до 200.
  const { h, id } = withShippedReceipt();
  editReceipt(h, id, 200, 100);
  const st = h.stockOf('ART');
  const shipped = h.getTransactions().rows.find(t => t.type === 'Расход');
  check('Подэтап 4: цена вниз — отгрузка списана по 200 (10000 руб)',
    shipped.writeOffCost === 10000, `получено: ${shipped.writeOffCost}`);
  check('Подэтап 4: и остаток 10000 руб на 50 шт, средняя 200',
    st.capitalization === 10000 && st.avgCost === 200,
    `получено: кап=${st.capitalization}, средняя=${st.avgCost}`);
  check('Подэтап 4: в КАН уходит подешевевшая себестоимость 200',
    h.dumpOzonCost().pop()['Себестоимость отгрузки'] === 200,
    `получено: ${h.dumpOzonCost().pop()['Себестоимость отгрузки']}`);
})();

(function test151() {
  // Правка КОЛИЧЕСТВА при той же цене среднюю не двигает — значит и пересчитывать нечего.
  const { h, id } = withShippedReceipt();
  editReceipt(h, id, 300, 120);
  const shipped = h.getTransactions().rows.find(t => t.type === 'Расход');
  check('Подэтап 4: цена не менялась — себестоимость отгрузки осталась 15000',
    shipped.writeOffCost === 15000, `получено: ${shipped.writeOffCost}`);
  check('Подэтап 4: и в журнал ничего лишнего не дописано',
    h.dumpOzonCost().length === 1, `строк: ${h.dumpOzonCost().length}`);
  check('Подэтап 4: остаток 70 шт по 300',
    h.stockOf('ART').quantity === 70 && h.stockOf('ART').avgCost === 300,
    `получено: ${h.stockOf('ART').quantity} шт, средняя=${h.stockOf('ART').avgCost}`);
})();

(function test152() {
  // Правка «в ту же цену» не должна менять ничего вообще.
  const { h, id } = withShippedReceipt();
  const before = JSON.stringify(h.stockOf('ART'));
  editReceipt(h, id, 300, 100);
  check('Подэтап 4: правка без изменений оставила склад нетронутым',
    JSON.stringify(h.stockOf('ART')) === before, `было ${before}, стало ${JSON.stringify(h.stockOf('ART'))}`);
  check('Подэтап 4: и журнал не вырос',
    h.dumpOzonCost().length === 1, `строк: ${h.dumpOzonCost().length}`);
})();

(function test153() {
  // ДВЕ отгрузки после прихода: пересчитаться обязаны обе, и цепочка средней на Озоне тоже.
  const { h, id } = withReceipt(300, 100);
  h.commitTransaction([{ article: 'ART', quantity: 30, price: 300 }],
    'Расход', 'Ozon (MaxiStore)', '', 'tester', '2026-08-10T09:00:00Z', 'op-s1');
  h.commitTransaction([{ article: 'ART', quantity: 20, price: 300 }],
    'Расход', 'Ozon (MaxiStore)', '', 'tester', '2026-08-12T09:00:00Z', 'op-s2');
  editReceipt(h, id, 400, 100);
  const outs = h.getTransactions().rows.filter(t => t.type === 'Расход')
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  check('Подэтап 4: пересчитаны ОБЕ отгрузки — 12000 и 8000',
    outs[0].writeOffCost === 12000 && outs[1].writeOffCost === 8000,
    `получено: ${outs.map(o => o.writeOffCost).join(', ')}`);
  const j = h.dumpOzonCost();
  const reissued = j.filter(r => String(r['Источник']).indexOf('пересчёт') !== -1);
  check('Подэтап 4: в журнал дописаны обе строки, обе по 400',
    reissued.length === 2 && reissued.every(r => r['Себестоимость отгрузки'] === 400),
    `получено: ${JSON.stringify(reissued.map(r => r['Себестоимость отгрузки']))}`);
  check('Подэтап 4: даты дописанных строк — даты тех отгрузок',
    reissued.map(r => String(r['Дата']).slice(0, 10)).join(',') === '2026-08-10,2026-08-12',
    `получено: ${reissued.map(r => String(r['Дата']).slice(0, 10)).join(',')}`);
  check('Подэтап 4: вторая строка считает среднюю от ИСПРАВЛЕННОЙ первой, а не от старой',
    reissued[1]['Себестоимость до'] === reissued[0]['Себестоимость после'],
    `до второй: ${reissued[1]['Себестоимость до']}, после первой: ${reissued[0]['Себестоимость после']}`);
})();

(function test154() {
  // Списание брака после прихода пересчитывается в «Истории», но в КАН не едет:
  // на Озон этот товар не уезжал.
  const { h, id } = withReceipt(300, 100);
  h.commitTransaction([{ article: 'ART', quantity: 20, price: 300 }],
    'Расход', 'Склад [Списание - Брак] [себестоимость обнулена]', '', 'tester', '2026-08-05T09:00:00Z', 'op-scrap');
  editReceipt(h, id, 400, 100);
  const scrap = h.getTransactions().rows.find(t => t.type === 'Расход');
  check('Подэтап 4: списание брака пересчитано — 8000 вместо 6000',
    scrap.writeOffCost === 8000, `получено: ${scrap.writeOffCost}`);
  check('Подэтап 4: но в журнал себестоимости Озона оно не попало',
    h.dumpOzonCost().length === 0, `строк: ${h.dumpOzonCost().length}`);
})();

(function test155() {
  // ОТКАЗ. Если склад разошёлся с историей, пересчёт дал бы неверные деньги — правка
  // отклоняется целиком, и ни одна ячейка не тронута.
  const { h, id } = withShippedReceipt();
  h.setStockSheet([{ article: 'ART', quantity: 50, avgCost: 300, capitalization: 99999 }]);
  let message = '';
  try { editReceipt(h, id, 400, 100); } catch (e) { message = String(e.message || e); }
  check('Подэтап 4: расхождение склада с историей отклоняет правку',
    message.indexOf('не сходится с базой') !== -1, `получено: ${message || 'без ошибки'}`);
  check('Подэтап 4: сообщение называет расхождение поимённо — операцию и обе цифры',
    message.indexOf('себестоимость списания операции от 2026-08-10') !== -1
    && message.indexOf('в базе 15000') !== -1,
    `получено: ${message}`);
  check('Подэтап 4: после отказа цена прихода прежняя и склад не тронут',
    h.getTransactions().rows.find(t => t.type === 'Приход').price === 300
    && h.stockOf('ART').capitalization === 99999,
    `цена: ${h.getTransactions().rows.find(t => t.type === 'Приход').price}, кап: ${h.stockOf('ART').capitalization}`);
  check('Подэтап 4: и в журнал ничего не дописано',
    h.dumpOzonCost().length === 1, `строк: ${h.dumpOzonCost().length}`);
})();

(function test156() {
  // Отгрузка с услугами: пересчитывается ЧИСТАЯ себестоимость, а разнесённые услуги
  // остаются на месте — правка прихода к подрядчикам отношения не имеет.
  const { h, id } = withReceipt(300, 100);
  h.commitTransaction([{ article: 'ART', quantity: 50, price: 300 }],
    'Расход', 'Ozon (MaxiStore) [Упаковка: 50 шт. x 20₽ = 1000₽]', '', 'tester', '2026-08-10T09:00:00Z', 'op-svc');
  const before = h.getTransactions().rows.find(t => t.type === 'Расход');
  check('До правки: цена 320 (300 товар + 20 упаковка), списание 15000',
    before.price === 320 && before.writeOffCost === 15000,
    `цена: ${before.price}, списание: ${before.writeOffCost}`);
  editReceipt(h, id, 400, 100);
  const after = h.getTransactions().rows.find(t => t.type === 'Расход');
  check('Подэтап 4: списание стало 20000, а цена 420 — упаковка те же 20 руб',
    after.writeOffCost === 20000 && after.price === 420,
    `цена: ${after.price}, списание: ${after.writeOffCost}`);
  check('Подэтап 4: в КАН уходит полная себестоимость 420, с услугами',
    h.dumpOzonCost().pop()['Себестоимость отгрузки'] === 420,
    `получено: ${h.dumpOzonCost().pop()['Себестоимость отгрузки']}`);
})();

(function test127b() {
  // Количество ВВЕРХ: приход был 100, стал 120 — на складе становится 70.
  const { h, id } = withShippedReceipt();
  let message = '';
  try { editReceipt(h, id, 300, 120); } catch (e) { message = String(e.message || e); }
  check('Правка количества вверх по отгруженному приходу проходит',
    message === '', `получено: ${message}`);
  check('И на складе становится 70 шт на 21000 руб',
    h.stockOf('ART').quantity === 70 && h.stockOf('ART').capitalization === 21000,
    `получено: ${h.stockOf('ART').quantity} шт, кап=${h.stockOf('ART').capitalization}`);
})();

(function test127c() {
  // Количество ВНИЗ до границы: 50 шт уже уехали, значит приход можно ужать ровно до 50.
  const { h, id } = withShippedReceipt();
  let message = '';
  try { editReceipt(h, id, 300, 50); } catch (e) { message = String(e.message || e); }
  check('Приход можно ужать ровно до отгруженного количества — 50 шт',
    message === '', `получено: ${message}`);
  check('И склад обнуляется, а не уходит в минус',
    h.stockOf('ART').quantity === 0, `получено: ${h.stockOf('ART').quantity}`);
})();

(function test127d() {
  // Количество ВНИЗ за границу: 49 шт меньше, чем уже уехало. Отказ обязателен.
  const { h, id } = withShippedReceipt();
  let message = '';
  try { editReceipt(h, id, 300, 49); } catch (e) { message = String(e.message || e); }
  check('Ужать приход ниже отгруженного нельзя — отказ',
    message.indexOf('отрицательному остатку') !== -1, `получено: ${message || 'без ошибки'}`);
  check('Сообщение говорит о ПРАВКЕ и подсказывает предел, а не зовёт удалять расходы',
    message.indexOf('Правка') === 0 && message.indexOf('не более чем до 50') !== -1,
    `получено: ${message}`);
  check('И склад после отказа цел: 50 шт по 300',
    h.stockOf('ART').quantity === 50 && h.stockOf('ART').avgCost === 300,
    `получено: ${h.stockOf('ART').quantity} шт, средняя=${h.stockOf('ART').avgCost}`);
})();

(function test127e() {
  // Приход, из которого не ушло НИЧЕГО, по-прежнему ужимается до нуля и удаляется.
  const { h, id } = withReceipt(300, 100);
  let message = '';
  try { editReceipt(h, id, 300, 0); } catch (e) { message = String(e.message || e); }
  check('Приход без отгрузок можно ужать до нуля',
    message === '' && h.stockOf('ART').quantity === 0,
    `сообщение: ${message}, остаток: ${h.stockOf('ART').quantity}`);
})();

(function test128() {
  // Правка прихода, по которому отгрузок НЕ было, журнал Озона тоже не трогает —
  // и трогать нечего: на Озон ничего не уезжало.
  const { h, id } = withReceipt(300, 100);
  editReceipt(h, id, 400, 100);
  check('Правка прихода без отгрузок: журнал себестоимости Озона пуст',
    h.dumpOzonCost().length === 0, `получено строк: ${h.dumpOzonCost().length}`);
})();

// ====== Пункт 47, этап 4, подэтап 3: окно правки прихода в 30 дней ======

// Приход датирован 01.08.2026 09:00 UTC. Двигаем «сегодня» и смотрим, пускает ли правка.
const editAtDay = (nowIso, qty) => {
  const { h, id } = withReceipt(300, 100);
  h.setNow(nowIso);
  let message = '';
  try { editReceipt(h, id, 400, qty === undefined ? 100 : qty); }
  catch (e) { message = String(e.message || e); }
  const price = h.getTransactions().rows.find(t => t.type === 'Приход').price;
  h.setNow('2026-01-05T09:00:00Z');
  return { message, price, h };
};

(function test130() {
  const at29 = editAtDay('2026-08-30T09:00:00Z');
  check('Подэтап 3: приходу 29 дней — правка проходит',
    at29.message === '' && at29.price === 400, `сообщение: ${at29.message}, цена: ${at29.price}`);

  const at30 = editAtDay('2026-08-31T09:00:00Z');
  check('Подэтап 3: ровно 30 дней — правка проходит, граница включена',
    at30.message === '' && at30.price === 400, `сообщение: ${at30.message}, цена: ${at30.price}`);

  const at31 = editAtDay('2026-09-01T09:00:00Z');
  check('Подэтап 3: 31 день — отказ, и отказ именно на ПРАВКЕ, а не на удалении',
    at31.message.indexOf('старше 30 дней править нельзя') !== -1,
    `получено: ${at31.message || 'без ошибки'}`);
  check('Подэтап 3: и цена после отказа осталась прежней — 300',
    at31.price === 300, `получено: ${at31.price}`);
  check('Подэтап 3: сообщение называет возраст прихода, а не одно только правило',
    /этому приходу 31 дн\./.test(at31.message), `получено: ${at31.message}`);
})();

(function test131() {
  // Сутки считаются полными: за минуту до конца тридцать первых суток это ещё 30 дней.
  const almost = editAtDay('2026-09-01T08:59:00Z');
  check('Подэтап 3: 30 дней 23 ч 59 мин — ещё можно',
    almost.message === '' && almost.price === 400,
    `сообщение: ${almost.message}, цена: ${almost.price}`);
})();

(function test132() {
  // Обход подстановкой свежей даты в той же правке: дата берётся из СОХРАНЁННОЙ строки.
  const { h, id } = withReceipt(300, 100);
  h.setNow('2026-09-10T09:00:00Z');
  let message = '';
  try {
    h.updateTransaction(id, { article: 'ART', quantity: 100, price: 400, type: 'Приход',
      destination: 'Склад', date: '2026-09-10T09:00:00Z' }, 'tester');
  } catch (e) { message = String(e.message || e); }
  check('Подэтап 3: свежая дата в самой правке правило не обходит',
    message.indexOf('старше 30 дней') !== -1, `получено: ${message || 'без ошибки'}`);
  check('Подэтап 3: склад после отказа цел — 100 шт по 300',
    h.stockOf('ART').quantity === 100 && h.stockOf('ART').avgCost === 300,
    `получено: ${h.stockOf('ART').quantity} шт, средняя=${h.stockOf('ART').avgCost}`);
  h.setNow('2026-01-05T09:00:00Z');
})();

(function test133() {
  // Правило про ПРИХОД. Старый расход правится как правился — трогать его не просили.
  const { h } = withReceipt(300, 100);
  h.commitTransaction([{ article: 'ART', quantity: 10, price: 300 }],
    'Расход', 'Склад [Списание - Брак]', '', 'tester', '2026-08-02T09:00:00Z', 'op-out');
  const outId = h.getTransactions().rows.find(t => t.type === 'Расход').id;
  h.setNow('2026-10-01T09:00:00Z');
  let message = '';
  try {
    h.updateTransaction(outId, { article: 'ART', quantity: 5, type: 'Расход',
      destination: 'Склад [Списание - Брак]', date: '2026-08-02T09:00:00Z' }, 'tester');
  } catch (e) { message = String(e.message || e); }
  check('Подэтап 3: окно 30 дней на расходы НЕ распространяется',
    message.indexOf('старше 30 дней') === -1, `получено: ${message}`);
  h.setNow('2026-01-05T09:00:00Z');
})();

(function test134() {
  // Дата в будущем и нечитаемая дата не должны запрещать правку: отказывать из-за
  // собственного непонимания даты неправильно.
  const future = editAtDay('2026-07-01T09:00:00Z');
  check('Подэтап 3: приход из будущего правку не блокирует',
    future.message === '' && future.price === 400, `сообщение: ${future.message}`);

  const h = freshHarness();
  check('Подэтап 3: пустая дата — ноль дней, а не отказ',
    h.daysSinceTransactionDate('') === 0 && h.daysSinceTransactionDate('не дата') === 0,
    `получено: ${h.daysSinceTransactionDate('')}, ${h.daysSinceTransactionDate('не дата')}`);
})();

// ====== Подэтап 4, шаг 1: ВЕРНОСТЬ ПРОИГРЫВАНИЯ ======
// Прежде чем что-то пересчитывать, проигрывание обязано в точности воспроизвести историю,
// которую написал сам сервер. Не воспроизводит — значит мои правила и настоящие правила
// разошлись, и трогать деньги нельзя. Каждый сценарий строится НАСТОЯЩИМ commitTransaction.

const FROM = new Date('2026-07-01T00:00:00Z').getTime();

function replayBench() {
  const h = freshHarness();
  h.ensureTransSheet();
  h.ensureArchiveSheet();
  h.setOzonCostSheet([]);
  h.setOzonStocksSheet([{ cabinet: 'MaxiStore', article: 'ART', available: 5000, sku: '999' }]);
  h.setStockSheet([{ article: 'ART', quantity: 0, avgCost: 0, capitalization: 0 }]);
  return h;
}

function checkFidelity(name, h, article) {
  const replayed = h.replayArticle(article || 'ART', FROM);
  const verdict = h.replayMatchesFacts(replayed);
  check('Верность проигрывания: ' + name,
    verdict.ok === true, `не сошлось: ${verdict.reason}`);
  return replayed;
}

(function test140() {
  // Простейшее: приход и обычный расход.
  const h = replayBench();
  h.commitTransaction([{ article: 'ART', quantity: 100, price: 300 }],
    'Приход', 'Склад', '', 'tester', '2026-08-01T09:00:00Z', 'a1');
  h.commitTransaction([{ article: 'ART', quantity: 40, price: 300 }],
    'Расход', 'Ozon (MaxiStore)', '', 'tester', '2026-08-05T09:00:00Z', 'a2');
  checkFidelity('приход и расход', h);
})();

(function test141() {
  // Приходы по разным ценам вперемешку с расходами — средняя гуляет.
  const h = replayBench();
  h.commitTransaction([{ article: 'ART', quantity: 100, price: 300 }], 'Приход', 'Склад', '', 'tester', '2026-08-01T09:00:00Z', 'b1');
  h.commitTransaction([{ article: 'ART', quantity: 30, price: 0 }], 'Расход', 'Ozon (MaxiStore)', '', 'tester', '2026-08-02T09:00:00Z', 'b2');
  h.commitTransaction([{ article: 'ART', quantity: 70, price: 517.33 }], 'Приход', 'Склад', '', 'tester', '2026-08-03T09:00:00Z', 'b3');
  h.commitTransaction([{ article: 'ART', quantity: 45, price: 0 }], 'Расход', 'Ozon (MaxiStore)', '', 'tester', '2026-08-04T09:00:00Z', 'b4');
  h.commitTransaction([{ article: 'ART', quantity: 13, price: 1207.77 }], 'Приход', 'Склад', '', 'tester', '2026-08-05T09:00:00Z', 'b5');
  h.commitTransaction([{ article: 'ART', quantity: 61, price: 0 }], 'Расход', 'Ozon (MaxiStore)', '', 'tester', '2026-08-06T09:00:00Z', 'b6');
  const r = checkFidelity('пять приходов и расходов с некруглыми ценами', h);
  check('Верность: и остаток совпал с фактом до копейки',
    Math.abs(r.final.capitalization - r.stock.capitalization) < 0.005
    && r.final.quantity === r.stock.quantity,
    `проигрыш: ${r.final.quantity} шт / ${r.final.capitalization}, факт: ${r.stock.quantity} / ${r.stock.capitalization}`);
})();

(function test142() {
  // Списание брака БЕЗ обнуления: количество уходит, деньги остаются долгом на артикуле.
  const h = replayBench();
  h.commitTransaction([{ article: 'ART', quantity: 100, price: 300 }], 'Приход', 'Склад', '', 'tester', '2026-08-01T09:00:00Z', 'c1');
  h.commitTransaction([{ article: 'ART', quantity: 20, price: 0 }], 'Расход', 'Склад [Списание - Брак]', '', 'tester', '2026-08-02T09:00:00Z', 'c2');
  h.commitTransaction([{ article: 'ART', quantity: 10, price: 0 }], 'Расход', 'Ozon (MaxiStore)', '', 'tester', '2026-08-03T09:00:00Z', 'c3');
  const r = checkFidelity('списание брака без обнуления — долг себестоимости', h);
  check('Верность: долг поднял среднюю выше цены прихода',
    r.stock.avgCost > 300, `средняя: ${r.stock.avgCost}`);
})();

(function test143() {
  // Списание С обнулением: деньги снимаются вместе с товаром.
  const h = replayBench();
  h.commitTransaction([{ article: 'ART', quantity: 100, price: 300 }], 'Приход', 'Склад', '', 'tester', '2026-08-01T09:00:00Z', 'd1');
  h.commitTransaction([{ article: 'ART', quantity: 20, price: 0 }], 'Расход', 'Склад [Списание - Брак] [себестоимость обнулена]', '', 'tester', '2026-08-02T09:00:00Z', 'd2');
  h.commitTransaction([{ article: 'ART', quantity: 10, price: 0 }], 'Расход', 'Ozon (MaxiStore)', '', 'tester', '2026-08-03T09:00:00Z', 'd3');
  const r = checkFidelity('списание с обнулением себестоимости', h);
  check('Верность: средняя после обнулённого списания осталась 300',
    r.stock.avgCost === 300, `средняя: ${r.stock.avgCost}`);
})();

(function test144() {
  // Расход с доп. расходами: цена строки выше средней, себестоимость списания — чистая.
  const h = replayBench();
  h.commitTransaction([{ article: 'ART', quantity: 100, price: 300 }], 'Приход', 'Склад', '', 'tester', '2026-08-01T09:00:00Z', 'e1');
  h.commitTransaction([{ article: 'ART', quantity: 50, price: 300 }],
    'Расход', 'Ozon (MaxiStore) [Упаковка: 50 шт. x 20₽ = 1000₽]', '', 'tester', '2026-08-02T09:00:00Z', 'e2');
  const r = checkFidelity('отгрузка с упаковкой в цене', h);
  const out = h.getTransactions().rows.find(t => t.type === 'Расход');
  check('Верность: цена строки несёт расходы (320), а списание — чистое (15000)',
    out.price === 320 && out.writeOffCost === 15000,
    `цена: ${out.price}, списание: ${out.writeOffCost}`);
})();

(function test145() {
  // Виртуальный комплект: сам комплект склад не двигает, двигают комплектующие.
  const h = replayBench();
  h.setStockSheet([
    { article: 'ART', quantity: 0, avgCost: 0, capitalization: 0 },
    { article: 'COMP', quantity: 0, avgCost: 0, capitalization: 0 }
  ]);
  h.setKitSheet([{ kitSku: 'KIT', componentSku: 'COMP', quantity: 2, kitType: 'virtual' }]);
  h.commitTransaction([{ article: 'COMP', quantity: 200, price: 95 }], 'Приход', 'Склад', '', 'tester', '2026-08-01T09:00:00Z', 'f1');
  h.commitTransaction([{ article: 'KIT', quantity: 30, price: 0 }], 'Расход', 'Ozon (MaxiStore)', '', 'tester', '2026-08-02T09:00:00Z', 'f2');
  checkFidelity('комплектующее под виртуальным комплектом', h, 'COMP');
  const kitRow = h.getTransactions().rows.find(t => t.article === 'KIT');
  check('Верность: строка комплекта опознана как виртуальная и склад не двигает',
    h.isVirtualKitMainRow(kitRow) === true, `получено: ${JSON.stringify(kitRow)}`);
})();

(function test146() {
  // Остаток уходит в ноль и снова наполняется.
  const h = replayBench();
  h.commitTransaction([{ article: 'ART', quantity: 50, price: 300 }], 'Приход', 'Склад', '', 'tester', '2026-08-01T09:00:00Z', 'g1');
  h.commitTransaction([{ article: 'ART', quantity: 50, price: 0 }], 'Расход', 'Ozon (MaxiStore)', '', 'tester', '2026-08-02T09:00:00Z', 'g2');
  h.commitTransaction([{ article: 'ART', quantity: 80, price: 410 }], 'Приход', 'Склад', '', 'tester', '2026-08-03T09:00:00Z', 'g3');
  h.commitTransaction([{ article: 'ART', quantity: 20, price: 0 }], 'Расход', 'Ozon (MaxiStore)', '', 'tester', '2026-08-04T09:00:00Z', 'g4');
  checkFidelity('остаток обнулялся и наполнялся заново', h);
})();

(function test147() {
  // Несколько операций одной датой: порядок обязан остаться тем, в котором их провели.
  const h = replayBench();
  h.commitTransaction([{ article: 'ART', quantity: 100, price: 300 }], 'Приход', 'Склад', '', 'tester', '2026-08-01T09:00:00Z', 'h1');
  h.commitTransaction([{ article: 'ART', quantity: 40, price: 0 }], 'Расход', 'Ozon (MaxiStore)', '', 'tester', '2026-08-01T09:00:00Z', 'h2');
  h.commitTransaction([{ article: 'ART', quantity: 60, price: 500 }], 'Приход', 'Склад', '', 'tester', '2026-08-01T09:00:00Z', 'h3');
  h.commitTransaction([{ article: 'ART', quantity: 30, price: 0 }], 'Расход', 'Ozon (MaxiStore)', '', 'tester', '2026-08-01T09:00:00Z', 'h4');
  const r = checkFidelity('четыре операции одной и той же датой', h);
  check('Верность: порядок в проигрывании — порядок проведения',
    r.rows.map(t => t.type).join(',') === 'Приход,Расход,Приход,Расход',
    `получено: ${r.rows.map(t => t.type).join(',')}`);
})();

(function test147b() {
  // ГЛАВНАЯ ЛОВУШКА ПРОИГРЫВАНИЯ. При обычном расходе средняя ПЕРЕНОСИТСЯ, а не считается
  // заново делением. Пока капитализация ровно равна «средняя x количество», делить и
  // переносить — одно и то же, и подмену не видно. Здесь она видна: приход 1 шт за 3 копейки
  // делает капитализацию 700,03 при средней 87,50, то есть на 3 копейки больше, чем
  // 87,50 x 8. После расхода 7 шт остаётся 87,53 руб на 1 шт — и деление дало бы 87,53
  // вместо честных 87,50.
  const h = replayBench();
  h.commitTransaction([{ article: 'ART', quantity: 7, price: 100 }], 'Приход', 'Склад', '', 'tester', '2026-08-01T09:00:00Z', 'j1');
  h.commitTransaction([{ article: 'ART', quantity: 1, price: 0.03 }], 'Приход', 'Склад', '', 'tester', '2026-08-02T09:00:00Z', 'j2');
  h.commitTransaction([{ article: 'ART', quantity: 7, price: 0 }], 'Расход', 'Ozon (MaxiStore)', '', 'tester', '2026-08-03T09:00:00Z', 'j3');
  h.commitTransaction([{ article: 'ART', quantity: 1, price: 0 }], 'Расход', 'Ozon (MaxiStore)', '', 'tester', '2026-08-04T09:00:00Z', 'j4');
  checkFidelity('копеечный расход средней и капитализации', h);
  const last = h.getTransactions().rows.filter(t => t.type === 'Расход')
    .sort((a, b) => String(a.date).localeCompare(String(b.date))).pop();
  check('Верность: последний расход списан по перенесённой средней 87,50, а не по 87,53',
    last.writeOffCost === 87.5, `получено: ${last.writeOffCost}`);
})();

(function test147c() {
  // Комплект, чей артикул ЕСТЬ в листе «Остатки». Строка комплекта склад двигать не должна:
  // товар лежит комплектующими. Без этой фикстуры подмену признака комплекта не видно.
  const h = replayBench();
  h.setStockSheet([
    { article: 'COMP', quantity: 0, avgCost: 0, capitalization: 0 },
    { article: 'KIT', quantity: 0, avgCost: 0, capitalization: 0 }
  ]);
  h.setKitSheet([{ kitSku: 'KIT', componentSku: 'COMP', quantity: 2, kitType: 'virtual' }]);
  h.commitTransaction([{ article: 'COMP', quantity: 200, price: 95 }], 'Приход', 'Склад', '', 'tester', '2026-08-01T09:00:00Z', 'k1');
  h.commitTransaction([{ article: 'KIT', quantity: 30, price: 0 }], 'Расход', 'Ozon (MaxiStore)', '', 'tester', '2026-08-02T09:00:00Z', 'k2');
  checkFidelity('комплект, заведённый и в «Остатках»', h, 'KIT');
  check('Верность: склад комплекта остался нулевым',
    h.stockRowForArticle('KIT').quantity === 0, `получено: ${h.stockRowForArticle('KIT').quantity}`);
})();

(function test148() {
  // Нечитаемая дата обязана останавливать пересчёт, а не тихо выпадать из него.
  const h = replayBench();
  h.commitTransaction([{ article: 'ART', quantity: 100, price: 300 }], 'Приход', 'Склад', '', 'tester', '2026-08-01T09:00:00Z', 'i1');
  h.commitTransaction([{ article: 'ART', quantity: 10, price: 0 }], 'Расход', 'Ozon (MaxiStore)', '', 'tester', 'позавчера', 'i2');
  let message = '';
  try { h.replayArticle('ART', FROM); } catch (e) { message = String(e.message || e); }
  check('Верность: нечитаемая дата останавливает пересчёт с понятным сообщением',
    message.indexOf('нечитаемая дата') !== -1, `получено: ${message || 'без ошибки'}`);
})();

// ====== Окно 30 дней на УДАЛЕНИЕ и округление при восстановлении ======

(function test160() {
  // Дырка, которую закрыли: старый приход удаляли и заводили заново с другой ценой,
  // и правило «не позднее 30 дней» обходилось в два хода.
  const { h, id } = withReceipt(300, 100);
  h.setNow('2026-09-10T09:00:00Z');
  let message = '';
  try { h.deleteTransaction(id, 'tester'); } catch (e) { message = String(e.message || e); }
  check('Удаление прихода старше 30 дней отклонено',
    message.indexOf('старше 30 дней удалять нельзя') !== -1, `получено: ${message || 'без ошибки'}`);
  check('Сообщение об удалении называет возраст прихода',
    /этому приходу 40 дн\./.test(message), `получено: ${message}`);
  check('И приход остался на месте, склад цел',
    h.getTransactions().rows.length === 1 && h.stockOf('ART').quantity === 100,
    `строк: ${h.getTransactions().rows.length}, остаток: ${h.stockOf('ART').quantity}`);
  h.setNow('2026-01-05T09:00:00Z');
})();

(function test161() {
  // Внутри окна удаление работает как работало.
  const { h, id } = withReceipt(300, 100);
  h.setNow('2026-08-20T09:00:00Z');
  let message = '';
  try { h.deleteTransaction(id, 'tester'); } catch (e) { message = String(e.message || e); }
  check('Удаление прихода внутри окна проходит',
    message === '' && h.stockOf('ART').quantity === 0,
    `сообщение: ${message}, остаток: ${h.stockOf('ART').quantity}`);
  h.setNow('2026-01-05T09:00:00Z');
})();

(function test162() {
  // Массовое удаление — вторая дверь к той же дырке, и она тоже закрыта.
  const { h, id } = withReceipt(300, 100);
  h.setNow('2026-09-10T09:00:00Z');
  let message = '';
  try { h.deleteMultipleTransactions([id], 'tester'); } catch (e) { message = String(e.message || e); }
  check('Массовое удаление старого прихода тоже отклонено',
    message.indexOf('старше 30 дней удалять нельзя') !== -1, `получено: ${message || 'без ошибки'}`);
  check('И база после отказа не тронута: приход на месте, остаток 100',
    h.getTransactions().rows.length === 1 && h.stockOf('ART').quantity === 100,
    `строк: ${h.getTransactions().rows.length}, остаток: ${h.stockOf('ART').quantity}`);
  h.setNow('2026-01-05T09:00:00Z');
})();

(function test163() {
  // Окно про ПРИХОД. Старый расход удаляется как удалялся.
  const { h } = withReceipt(300, 100);
  h.commitTransaction([{ article: 'ART', quantity: 10, price: 300 }],
    'Расход', 'Ozon (MaxiStore)', '', 'tester', '2026-08-02T09:00:00Z', 'op-old');
  const outId = h.getTransactions().rows.find(t => t.type === 'Расход').id;
  h.setNow('2026-10-01T09:00:00Z');
  let message = '';
  try { h.deleteTransaction(outId, 'tester'); } catch (e) { message = String(e.message || e); }
  check('Окно 30 дней на удаление РАСХОДА не распространяется',
    message.indexOf('удалять нельзя') === -1, `получено: ${message}`);
  h.setNow('2026-01-05T09:00:00Z');
})();

(function test164() {
  // Восстановление операции обязано писать среднюю ОКРУГЛЁННОЙ — как её пишет проведение.
  // До 26.08.2026 тут делили без округления, и в боевой базе осели значения вида
  // 5,889198396793588, из-за которых пересчёт себестоимости отказывался работать.
  const h = replayBench();
  h.commitTransaction([{ article: 'ART', quantity: 3, price: 100 }], 'Приход', 'Склад', '', 'tester', '2026-08-01T09:00:00Z', 'r1');
  h.commitTransaction([{ article: 'ART', quantity: 7, price: 33.33 }], 'Приход', 'Склад', '', 'tester', '2026-08-02T09:00:00Z', 'r2');
  const afterCommit = h.stockOf('ART');
  check('Проведение записало среднюю округлённой — 53,33 от 533,31 на 10 шт',
    afterCommit.avgCost === 53.33 && afterCommit.capitalization === 533.31,
    `средняя: ${afterCommit.avgCost}, кап: ${afterCommit.capitalization}`);

  const second = h.getTransactions().rows.find(t => String(t.date).indexOf('2026-08-02') === 0);
  h.deleteTransaction(second.id, 'tester');
  h.restoreTransaction({
    id: second.id, date: second.date, type: 'Приход', article: 'ART',
    quantity: 7, price: 33.33, writeOffCost: 0, total: 233.31,
    destination: 'Склад', deliveryDate: '', user: 'tester'
  });

  const afterRestore = h.stockOf('ART');
  check('Восстановление записало ТУ ЖЕ округлённую среднюю, а не 53,331',
    afterRestore.avgCost === 53.33,
    `получено: ${afterRestore.avgCost}`);
  check('И капитализация вернулась ровно та же — 533,31 на 10 шт',
    afterRestore.capitalization === 533.31 && afterRestore.quantity === 10,
    `кап: ${afterRestore.capitalization}, шт: ${afterRestore.quantity}`);
  check('Проведение и восстановление дают одинаковый склад — в этом и был дефект',
    JSON.stringify(afterRestore) === JSON.stringify(afterCommit),
    `проведение ${JSON.stringify(afterCommit)}, восстановление ${JSON.stringify(afterRestore)}`);
})();

(function test165() {
  // И после восстановления сверка проигрывания сходится: неокруглённая средняя её ломала.
  const h = replayBench();
  h.commitTransaction([{ article: 'ART', quantity: 3, price: 100 }], 'Приход', 'Склад', '', 'tester', '2026-08-01T09:00:00Z', 's1');
  h.commitTransaction([{ article: 'ART', quantity: 7, price: 33.33 }], 'Приход', 'Склад', '', 'tester', '2026-08-02T09:00:00Z', 's2');
  const second = h.getTransactions().rows.find(t => String(t.date).indexOf('2026-08-02') === 0);
  h.deleteTransaction(second.id, 'tester');
  h.restoreTransaction({
    id: second.id, date: second.date, type: 'Приход', article: 'ART',
    quantity: 7, price: 33.33, writeOffCost: 0, total: 233.31,
    destination: 'Склад', deliveryDate: '', user: 'tester'
  });
  h.commitTransaction([{ article: 'ART', quantity: 4, price: 0 }], 'Расход', 'Ozon (MaxiStore)', '', 'tester', '2026-08-03T09:00:00Z', 's3');
  checkFidelity('история, прошедшая через удаление и восстановление', h);
})();

(function test166() {
  // ДЕФЕКТ, НАЙДЕННЫЙ ПРОГОНОМ НА БОЕВОЙ БАЗЕ 26.08.2026: правка одного товара дописывала
  // строки в журнал по ЧУЖИМ товарам. У их цепочек на Озоне есть собственный копеечный
  // дрейф, и пересчёт объявлял его расхождением. На стенде этого случая не было — там
  // журнал всегда идеально сходился сам с собой.
  const { h, id } = withShippedReceipt();
  // Чужой товар со СВОИМ дрейфом: 500 после отгрузки по 600 от базы 100 по 400 дало бы
  // не 566.67, а записано 560 — расхождение, которое нас не касается.
  h.setOzonCostSheet([
    costRow('2026-08-01', 'MaxiStore', 'ART-ЧУЖОЙ', 400, 'НАЧАЛЬНАЯ ТОЧКА', { sku: '111' }),
    costRow('2026-08-05', 'MaxiStore', 'ART-ЧУЖОЙ', 560, 'op-alien',
      { sku: '111', stockBefore: 100, costBefore: 400, shipped: 50, shippedCost: 600 }),
  ]);
  h.commitTransaction([{ article: 'ART', quantity: 10, price: 300 }],
    'Расход', 'Ozon (MaxiStore)', '', 'tester', '2026-08-11T09:00:00Z', 'op-mine');
  const alienBefore = h.dumpOzonCost().filter(r => r['Артикул'] === 'ART-ЧУЖОЙ').length;

  editReceipt(h, id, 400, 100);

  const j = h.dumpOzonCost();
  const alienAfter = j.filter(r => r['Артикул'] === 'ART-ЧУЖОЙ').length;
  check('Правка товара не трогает журнал ЧУЖИХ товаров',
    alienAfter === alienBefore, `было ${alienBefore}, стало ${alienAfter}`);
  const mine = j.filter(r => String(r['Источник']).indexOf('пересчёт') !== -1);
  check('Дописаны строки только по правленому товару',
    mine.length > 0 && mine.every(r => r['Артикул'] === 'ART'),
    `получено: ${JSON.stringify(mine.map(r => r['Артикул']))}`);
})();

(function test167() {
  // И внутри СВОЕГО товара цепочка не пересчитывается до первой сдвинувшейся отгрузки:
  // всё, что было раньше, правка не затрагивает.
  const { h, id } = withReceipt(300, 100, { date: '2026-08-10T09:00:00Z' });
  h.setOzonCostSheet([
    costRow('2026-08-01', 'MaxiStore', 'ART', 250, 'op-ранняя',
      { sku: '999', stockBefore: 100, costBefore: 200, shipped: 40, shippedCost: 999 }),
  ]);
  h.commitTransaction([{ article: 'ART', quantity: 20, price: 300 }],
    'Расход', 'Ozon (MaxiStore)', '', 'tester', '2026-08-12T09:00:00Z', 'op-поздняя');
  editReceipt(h, id, 400, 100, '2026-08-10T09:00:00Z');
  const reissued = h.dumpOzonCost().filter(r => String(r['Источник']).indexOf('пересчёт') !== -1);
  check('Отгрузка ДО правленого прихода в пересчёт не попала',
    reissued.every(r => String(r['Дата']).slice(0, 10) !== '2026-08-01'),
    `получено даты: ${JSON.stringify(reissued.map(r => String(r['Дата']).slice(0, 10)))}`);
  check('А отгрузка после — попала',
    reissued.some(r => String(r['Дата']).slice(0, 10) === '2026-08-12'),
    `получено даты: ${JSON.stringify(reissued.map(r => String(r['Дата']).slice(0, 10)))}`);
})();

// ====== Текст ошибки без служебной приставки ======

(function test170() {
  const h = freshHarness();
  check('Ошибка отдаётся без приставки «Error:»',
    h.errorMessage(new Error('Приход старше 30 дней удалять нельзя')) === 'Приход старше 30 дней удалять нельзя',
    `получено: ${h.errorMessage(new Error('Приход старше 30 дней удалять нельзя'))}`);
  check('И «Error:» не остаётся даже кусочком',
    h.errorMessage(new Error('текст')).indexOf('Error') === -1,
    `получено: ${h.errorMessage(new Error('текст'))}`);
  check('Брошенная строка проходит как есть',
    h.errorMessage('просто строка') === 'просто строка', `получено: ${h.errorMessage('просто строка')}`);
  check('Пустое сообщение не превращается в пустой экран',
    h.errorMessage(new Error('')) === 'Error', `получено: "${h.errorMessage(new Error(''))}"`);
  check('null и undefined дают понятный текст, а не «null»',
    h.errorMessage(null) === 'Неизвестная ошибка' && h.errorMessage(undefined) === 'Неизвестная ошибка',
    `получено: ${h.errorMessage(null)} / ${h.errorMessage(undefined)}`);
  check('Живой пример из приложения читается целиком',
    h.errorMessage(new Error('Приход старше 30 дней удалять нельзя: этому приходу 50 дн.'))
      === 'Приход старше 30 дней удалять нельзя: этому приходу 50 дн.',
    'получено: ' + h.errorMessage(new Error('Приход старше 30 дней удалять нельзя: этому приходу 50 дн.')));
})();

// ================= Пункт 58: настройка «кластеры прямой поставки» =================
(function () {
  const h = freshHarness();
  const norm = (v) => h.normalizeDirectClustersSetting(v);
  const throws = (v) => {
    try { norm(v); return null; } catch (e) { return String(e && e.message || e); }
  };

  check('Пустая настройка — пустая строка, а не ошибка',
    norm('') === '' && norm('   ') === '' && norm(null) === '' && norm(undefined) === '',
    `получено: "${norm('')}" / "${norm(null)}"`);

  const one = norm('[{"clusterId":"4066","clusterName":"Екатеринбург","warehouseId":"15431806189000","warehouseName":"ЕКАТЕРИНБУРГ_РФЦ_НОВЫЙ"}]');
  const oneParsed = JSON.parse(one);
  check('Один кластер сохраняется целиком',
    oneParsed.length === 1 && oneParsed[0].clusterId === '4066' && oneParsed[0].warehouseName === 'ЕКАТЕРИНБУРГ_РФЦ_НОВЫЙ',
    `получено: ${one}`);

  const numeric = JSON.parse(norm('[{"clusterId":4066,"warehouseId":15431806189000}]'));
  check('Числовые идентификаторы приводятся к строкам',
    numeric[0].clusterId === '4066' && numeric[0].warehouseId === '15431806189000',
    `получено: ${JSON.stringify(numeric[0])}`);

  const noWh = JSON.parse(norm('[{"clusterId":"4066","clusterName":"Екатеринбург"}]'));
  check('Кластер без склада принимается: склад выбирается вторым шагом',
    noWh[0].warehouseId === '' && noWh[0].warehouseName === '',
    `получено: ${JSON.stringify(noWh[0])}`);

  check('Пустой список сводится к пустой строке',
    norm('[]') === '', `получено: "${norm('[]')}"`);

  check('Нечитаемый JSON отвергается',
    (throws('{не json') || '').indexOf('нечитаемое') !== -1, `получено: ${throws('{не json')}`);

  check('Не список отвергается',
    (throws('{"clusterId":"4066"}') || '').indexOf('список') !== -1, `получено: ${throws('{"clusterId":"4066"}')}`);

  check('Кластер без номера отвергается, а не пропускается молча',
    (throws('[{"clusterName":"Екатеринбург"}]') || '').indexOf('КластерID') !== -1,
    `получено: ${throws('[{"clusterName":"Екатеринбург"}]')}`);

  check('Нечисловой КластерID отвергается',
    (throws('[{"clusterId":"ЕКБ"}]') || '').indexOf('КластерID') !== -1, `получено: ${throws('[{"clusterId":"ЕКБ"}]')}`);

  check('Нечисловой ID склада отвергается',
    (throws('[{"clusterId":"4066","warehouseId":"КОЛЬЦОВО"}]') || '').indexOf('склада') !== -1,
    `получено: ${throws('[{"clusterId":"4066","warehouseId":"КОЛЬЦОВО"}]')}`);

  check('Один кластер дважды отвергается',
    (throws('[{"clusterId":"4066"},{"clusterId":"4066"}]') || '').indexOf('дважды') !== -1,
    `получено: ${throws('[{"clusterId":"4066"},{"clusterId":"4066"}]')}`);

  check('Мусор вместо кластера отвергается',
    (throws('[null]') || '').indexOf('не является кластером') !== -1, `получено: ${throws('[null]')}`);

  const two = JSON.parse(norm('[{"clusterId":"4066","clusterName":"Екатеринбург"},{"clusterId":"4051","clusterName":"Казань"}]'));
  check('Несколько прямых кластеров сохраняются в порядке ввода',
    two.length === 2 && two[0].clusterId === '4066' && two[1].clusterId === '4051',
    `получено: ${JSON.stringify(two)}`);
})();

// ================= Speed of commitTransaction: the cost of an operation must not grow with =
// ================= the number of positions in it (27.08.2026) ==============================
//
// Cloud Run logs of 21.08.2026: a receipt from the factory took 29,8 s, and once more than
// the 90 s after which the proxy gives up on the connection, waits 20 s and repeats the write
// — which the server then answered "already recorded", scaring the owner with a duplicate
// that never existed. The cause was not the volume of data but the NUMBER of requests to
// Google Sheets: the SKU sheet was re-read for every position, and every position wrote its
// stock row separately.
//
// These checks measure requests, not seconds. A second is not reproducible; a request is.

const SPEED_SKU_HEADERS = ['SKU', 'ШТ/КОР', 'Мин. остаток', 'ШК Ozon', 'Баркод WB', 'КОР/ПАЛ', 'Литраж (л)', 'Название Ozon'];

function speedHarness(articles) {
  const h = freshHarness();
  h.ensureTransSheet();
  h.setSkuSheet(SPEED_SKU_HEADERS, articles.map(a => buildSkuRow(SPEED_SKU_HEADERS, { SKU: a })));
  const stockSheet = h.setStockSheet(articles.map(a => ({
    article: a, quantity: 10, avgCost: 5, capitalization: 50, sales120: 7, turnover: 3
  })));
  h.getSkuSheet().__resetGetValuesCallCount();
  stockSheet.__resetSetValuesCallCount();
  return { h, stockSheet };
}

(function testSpeed1() {
  // The SKU sheet is read the same number of times for one position and for five.
  const five = ['A1', 'A2', 'A3', 'A4', 'A5'];
  const one = speedHarness(five);
  one.h.commitTransaction([{ article: 'A1', quantity: 2, price: 4 }],
    'Приход', 'Фабрика', '', 'tester', '2026-01-05T09:00:00Z', '');
  const readsForOne = one.h.getSkuSheet().__getGetValuesCallCount();

  const many = speedHarness(five);
  many.h.commitTransaction(five.map(a => ({ article: a, quantity: 2, price: 4 })),
    'Приход', 'Фабрика', '', 'tester', '2026-01-05T09:00:00Z', '');
  const readsForFive = many.h.getSkuSheet().__getGetValuesCallCount();

  check('Скорость 1: лист SKU читается одинаково для 1 и для 5 позиций',
    readsForOne === readsForFive, `1 позиция: ${readsForOne}, 5 позиций: ${readsForFive}`);
  check('Скорость 1: лист SKU читается ровно дважды (шапка + данные), а не 2 раза на позицию',
    readsForFive === 2, `получено чтений: ${readsForFive}`);

  // The same for writes to «Остатки»: one request whatever the number of positions.
  const writesForOne = one.stockSheet.__getSetValuesCallCount();
  const writesForFive = many.stockSheet.__getSetValuesCallCount();
  check('Скорость 1: в «Остатки» пишем одинаково для 1 и для 5 позиций',
    writesForOne === writesForFive, `1 позиция: ${writesForOne}, 5 позиций: ${writesForFive}`);
  check('Скорость 1: в «Остатки» ровно одна запись на всю операцию',
    writesForFive === 1, `получено записей: ${writesForFive}`);
})();

(function testSpeed2() {
  // The one block write must not damage what it passes over: neither the rows between the
  // touched ones, nor the columns «Продажи за 120д» / «Оборачиваемость» of the touched rows.
  const { h, stockSheet } = speedHarness(['B1', 'B2', 'B3', 'B4', 'B5']);
  h.commitTransaction(
    [{ article: 'B1', quantity: 5, price: 6 }, { article: 'B5', quantity: 5, price: 6 }],
    'Приход', 'Фабрика', '', 'tester', '2026-01-05T09:00:00Z', ''
  );
  const dump = h.dumpStockSheet();
  const row = (a) => dump.rows.find(r => String(r[0]) === a);

  check('Скорость 2: непричастная строка внутри блока не изменилась',
    row('B3') && Number(row('B3')[1]) === 10 && Number(row('B3')[2]) === 5 && Number(row('B3')[3]) === 50,
    `получено: ${JSON.stringify(row('B3'))}`);
  check('Скорость 2: у непричастной строки уцелели «Продажи за 120д» и «Оборачиваемость»',
    row('B3') && Number(row('B3')[4]) === 7 && Number(row('B3')[5]) === 3,
    `получено: ${JSON.stringify(row('B3'))}`);
  check('Скорость 2: у изменённой строки уцелели «Продажи за 120д» и «Оборачиваемость»',
    row('B1') && Number(row('B1')[4]) === 7 && Number(row('B1')[5]) === 3,
    `получено: ${JSON.stringify(row('B1'))}`);
  check('Скорость 2: приход посчитан верно (10+5 шт, капитализация 50+30)',
    row('B1') && Number(row('B1')[1]) === 15 && Number(row('B1')[3]) === 80 && Number(row('B1')[2]) === 5.33,
    `получено: ${JSON.stringify(row('B1'))}`);
  check('Скорость 2: вторая изменённая строка на другом краю блока тоже верна',
    row('B5') && Number(row('B5')[1]) === 15 && Number(row('B5')[3]) === 80,
    `получено: ${JSON.stringify(row('B5'))}`);
  check('Скорость 2: запись всё ещё одна', stockSheet.__getSetValuesCallCount() === 1,
    `получено записей: ${stockSheet.__getSetValuesCallCount()}`);
})();

(function testSpeed3() {
  // Articles unknown to the warehouse: created in the SKU sheet and in «Остатки» in one batch,
  // and only in this case is the SKU list re-read for the answer.
  const { h, stockSheet } = speedHarness(['C1']);
  const res = h.commitTransaction(
    [{ article: 'NEW1', quantity: 3, price: 10 }, { article: 'NEW2', quantity: 4, price: 20 }],
    'Приход', 'Фабрика', '', 'tester', '2026-01-05T09:00:00Z', ''
  );
  const dump = h.dumpStockSheet();
  const row = (a) => dump.rows.find(r => String(r[0]) === a);
  const skuDump = h.dumpSkuSheet();
  const skuNames = skuDump.rows.map(r => String(r[0]));

  check('Скорость 3: оба новых артикула появились в «Остатки»',
    row('NEW1') && row('NEW2') && Number(row('NEW1')[1]) === 3 && Number(row('NEW2')[1]) === 4,
    `получено: ${JSON.stringify(dump.rows)}`);
  check('Скорость 3: старый артикул на месте', row('C1') && Number(row('C1')[1]) === 10,
    `получено: ${JSON.stringify(row('C1'))}`);
  check('Скорость 3: оба новых артикула заведены в листе SKU',
    skuNames.indexOf('NEW1') !== -1 && skuNames.indexOf('NEW2') !== -1, `получено: ${skuNames.join(',')}`);
  check('Скорость 3: две новых строки «Остатки» записаны одним обращением',
    stockSheet.__getSetValuesCallCount() === 1, `получено записей: ${stockSheet.__getSetValuesCallCount()}`);
  check('Скорость 3: два новых SKU записаны одним обращением',
    h.getSkuSheet().__getSetValuesCallCount() === 1, `получено записей: ${h.getSkuSheet().__getSetValuesCallCount()}`);
  check('Скорость 3: список SKU возвращён, потому что артикулы заведены',
    Array.isArray(res.skus) && res.skus.some(s => s.sku === 'NEW1'),
    `получено: ${res.skus ? res.skus.length + ' строк' : 'нет поля skus'}`);
})();

(function testSpeed4() {
  // Nothing created — the SKU list is not re-read, and the answer does not carry it.
  const { h } = speedHarness(['D1']);
  const res = h.commitTransaction([{ article: 'D1', quantity: 2, price: 4 }],
    'Приход', 'Фабрика', '', 'tester', '2026-01-05T09:00:00Z', '');
  check('Скорость 4: поля skus в ответе нет, когда артикулы не заводились',
    res.skus === undefined, `получено: ${JSON.stringify(res.skus)}`);
  check('Скорость 4: остаток при этом обновлён', res.stock.find(r => r.article === 'D1').quantity === 12,
    `получено: ${JSON.stringify(res.stock.find(r => r.article === 'D1'))}`);
})();

(function testSpeed5() {
  // One and the same NEW article in two positions of one receipt: it must get ONE row with the
  // two quantities added up, not two rows. This is the branch where a change lands on a row
  // this very operation has just created and has not written out yet.
  const { h, stockSheet } = speedHarness(['E1']);
  h.commitTransaction(
    [{ article: 'NEWDUP', quantity: 3, price: 10 }, { article: 'NEWDUP', quantity: 2, price: 15 }],
    'Приход', 'Фабрика', '', 'tester', '2026-01-05T09:00:00Z', ''
  );
  const dump = h.dumpStockSheet();
  const hits = dump.rows.filter(r => String(r[0]) === 'NEWDUP');
  check('Скорость 5: новый артикул из двух позиций занял одну строку',
    hits.length === 1, `получено строк: ${hits.length}`);
  check('Скорость 5: количество сложилось (3+2), капитализация 30+30',
    hits.length === 1 && Number(hits[0][1]) === 5 && Number(hits[0][3]) === 60,
    `получено: ${JSON.stringify(hits[0])}`);
  check('Скорость 5: запись по-прежнему одна', stockSheet.__getSetValuesCallCount() === 1,
    `получено записей: ${stockSheet.__getSetValuesCallCount()}`);
})();

(function testSpeed6() {
  // Expense of a kit: the components are written in the same single request, and the numbers
  // stay what they were before the batching.
  const h = freshHarness();
  h.ensureTransSheet();
  h.setKitSheet([
    { kitSku: 'KIT', componentSku: 'CMP1', quantity: 2, kitType: 'virtual' },
    { kitSku: 'KIT', componentSku: 'CMP2', quantity: 1, kitType: 'virtual' }
  ]);
  const stockSheet = h.setStockSheet([
    { article: 'CMP1', quantity: 20, avgCost: 3, capitalization: 60 },
    { article: 'CMP2', quantity: 20, avgCost: 7, capitalization: 140 }
  ]);
  stockSheet.__resetSetValuesCallCount();

  h.commitTransaction([{ article: 'KIT', quantity: 4, price: 0 }],
    'Расход', 'Продажа Ozon', '', 'tester', '2026-01-05T09:00:00Z', '');

  const dump = h.dumpStockSheet();
  const row = (a) => dump.rows.find(r => String(r[0]) === a);
  check('Скорость 6: компонент CMP1 списан (20-8=12), капитализация 60-24=36',
    row('CMP1') && Number(row('CMP1')[1]) === 12 && Number(row('CMP1')[3]) === 36,
    `получено: ${JSON.stringify(row('CMP1'))}`);
  check('Скорость 6: компонент CMP2 списан (20-4=16), капитализация 140-28=112',
    row('CMP2') && Number(row('CMP2')[1]) === 16 && Number(row('CMP2')[3]) === 112,
    `получено: ${JSON.stringify(row('CMP2'))}`);
  check('Скорость 6: оба компонента записаны одним обращением',
    stockSheet.__getSetValuesCallCount() === 1, `получено записей: ${stockSheet.__getSetValuesCallCount()}`);
})();

// ================= Дата для КАН — день поставки на Ozon, а не день оформления списания ======
// 03.09.2026, найдено владельцем на боевой базе: в файле для КАН стояла дата, когда он нажал
// «Записать», хотя цена начинает действовать в день поставки. Дата поставки лежала в том же
// вызове commitTransaction, в соседнем аргументе, и просто никогда не передавалась дальше.

(function testKanDay1() {
  const h = freshHarness();
  h.setOzonCostSheet([costRow('2026-08-01', 'MaxiStore', 'ART-A', 500.00, 'НАЧАЛЬНАЯ ТОЧКА')]);
  h.setOzonStocksSheet([{ cabinet: 'MaxiStore', article: 'ART-A', available: 300 }]);

  h.appendOzonCostForShipment(
    [{ article: 'ART-A', quantity: 100, price: 600, status: 'ok' }],
    'Ozon (MaxiStore)', '2026-09-03T09:00:00Z', 'op-day-1', 'tester', '2026-09-10'
  );
  const rows = h.dumpOzonCost();
  const last = rows[rows.length - 1];
  check('КАН-дата: в журнал попала дата поставки, а не дата оформления',
    last['Дата'] === '2026-09-10', `получено: ${last['Дата']}`);
})();

(function testKanDay2() {
  // Дата поставки в русском виде тоже принимается: строку могли вписать в лист руками.
  const h = freshHarness();
  h.setOzonCostSheet([costRow('2026-08-01', 'MaxiStore', 'ART-A', 500.00, 'НАЧАЛЬНАЯ ТОЧКА')]);
  h.setOzonStocksSheet([{ cabinet: 'MaxiStore', article: 'ART-A', available: 300 }]);

  h.appendOzonCostForShipment(
    [{ article: 'ART-A', quantity: 100, price: 600, status: 'ok' }],
    'Ozon (MaxiStore)', '2026-09-03T09:00:00Z', 'op-day-2', 'tester', '10.09.2026'
  );
  const last = h.dumpOzonCost().pop();
  check('КАН-дата: ДД.ММ.ГГГГ разворачивается в ГГГГ-ММ-ДД',
    last['Дата'] === '2026-09-10', `получено: ${last['Дата']}`);
})();

(function testKanDay3() {
  // Гвардия: без даты поставки поведение остаётся прежним. Отгрузку на Ozon без неё
  // подтвердить нельзя, но старые и вписанные руками строки такой гарантии не дают.
  const h = freshHarness();
  h.setOzonCostSheet([costRow('2026-08-01', 'MaxiStore', 'ART-A', 500.00, 'НАЧАЛЬНАЯ ТОЧКА')]);
  h.setOzonStocksSheet([{ cabinet: 'MaxiStore', article: 'ART-A', available: 300 }]);

  h.appendOzonCostForShipment(
    [{ article: 'ART-A', quantity: 100, price: 600, status: 'ok' }],
    'Ozon (MaxiStore)', '2026-09-03T09:00:00Z', 'op-day-3', 'tester', ''
  );
  const empty = h.dumpOzonCost().pop();
  check('КАН-дата: пустая дата поставки оставляет дату операции',
    empty['Дата'] === '2026-09-03', `получено: ${empty['Дата']}`);

  const h2 = freshHarness();
  h2.setOzonCostSheet([costRow('2026-08-01', 'MaxiStore', 'ART-A', 500.00, 'НАЧАЛЬНАЯ ТОЧКА')]);
  h2.setOzonStocksSheet([{ cabinet: 'MaxiStore', article: 'ART-A', available: 300 }]);
  h2.appendOzonCostForShipment(
    [{ article: 'ART-A', quantity: 100, price: 600, status: 'ok' }],
    'Ozon (MaxiStore)', '2026-09-03T09:00:00Z', 'op-day-4', 'tester', 'когда-нибудь'
  );
  const junk = h2.dumpOzonCost().pop();
  check('КАН-дата: мусор вместо даты поставки не угадывается, берётся дата операции',
    junk['Дата'] === '2026-09-03', `получено: ${junk['Дата']}`);
})();

(function testKanDay4() {
  // Дата поставки в будущем — обычный случай: поставка оформляется заранее.
  const h = freshHarness();
  h.setOzonCostSheet([costRow('2026-08-01', 'Mercurius', 'ART-B', 100.00, 'НАЧАЛЬНАЯ ТОЧКА')]);
  h.setOzonStocksSheet([{ cabinet: 'Mercurius', article: 'ART-B', available: 100 }]);

  h.appendOzonCostForShipment(
    [{ article: 'ART-B', quantity: 100, price: 200, status: 'ok' }],
    'Ozon (Mercurius)', '2026-09-03T09:00:00Z', 'op-day-5', 'tester', '2026-12-31'
  );
  const last = h.dumpOzonCost().pop();
  check('КАН-дата: дата поставки в будущем принимается как есть',
    last['Дата'] === '2026-12-31', `получено: ${last['Дата']}`);
  check('КАН-дата: расчёт себестоимости от смены даты не поехал ((100×100 + 100×200)/200 = 150)',
    last['Себестоимость после'] === 150, `получено: ${last['Себестоимость после']}`);
})();

(function testKanDay5() {
  // ГЛАВНАЯ проверка этой правки. Сама функция журнала дату поставки принимала и раньше —
  // сломано было ЗВЕНО: commitTransaction её не передавал. Поэтому проверка идёт через весь
  // путь целиком, от проведения расхода до строки в журнале, а не по функции журнала отдельно.
  const h = freshHarness();
  h.ensureTransSheet();
  h.setStockSheet([{ article: 'ART-A', quantity: 500, avgCost: 400, capitalization: 200000 }]);
  h.setOzonCostSheet([costRow('2026-08-01', 'MaxiStore', 'ART-A', 500.00, 'НАЧАЛЬНАЯ ТОЧКА')]);
  h.setOzonStocksSheet([{ cabinet: 'MaxiStore', article: 'ART-A', available: 300 }]);

  h.commitTransaction(
    [{ article: 'ART-A', quantity: 100, price: 600, status: 'ok' }],
    'Расход', 'Ozon (MaxiStore)', '2026-09-10', 'tester', '2026-09-03T09:00:00Z', 'op-chain-1'
  );

  const last = h.dumpOzonCost().pop();
  check('КАН-дата: проведение расхода доносит дату поставки до журнала',
    last['Дата'] === '2026-09-10', `получено: ${last['Дата']}`);
  check('КАН-дата: строка журнала при этом относится к той же операции',
    last['OpID'] === 'op-chain-1', `получено: ${last['OpID']}`);
})();

// ================= Стоимость остатков своего склада уезжает в платёжный календарь =========
// Задача владельца 10.09.2026. Договор с читающей стороной согласован письменно: лист
// «Капитализация склада», A1 «Дата», B1 «Капитализация, ₽», одна строка на календарный день,
// дата — НАСТОЯЩЕЙ датой, строка описывает день, который закрылся.
{
  const PROP = 'stock_summarySpreadsheetId';
  const SHEET = 'Капитализация склада';

  // Триггер срабатывает ночью 10.09, значит строка обязана описывать 09.09.
  const NIGHT_OF_10 = '2026-09-10T00:30:00Z'; // 03:30 МСК 10 сентября

  function standWithStock(items, nowIso) {
    const h = freshHarness();
    h.setNow(nowIso || NIGHT_OF_10);
    h.setStockSheet(items);
    h.setScriptProperty(PROP, h.targetSpreadsheetId);
    return h;
  }

  // ---- Пустое свойство: выгрузки нет, но и падения нет ----
  {
    const h = freshHarness();
    h.setNow(NIGHT_OF_10);
    h.setStockSheet([{ article: 'A', quantity: 1, avgCost: 10, capitalization: 10 }]);
    const res = h.context.writeStockSummary();
    check('Стоимость остатков: без свойства выгрузка пропускается', res.written === false && res.reason === 'no-property', 'reason=' + res.reason);
    check('Стоимость остатков: без свойства чужая таблица не трогается', h.getTargetSheet(SHEET) === null, 'лист не создан');
  }

  // ---- Обычный день: сумма, лист, заголовки, дата ----
  {
    const h = standWithStock([
      { article: 'A', quantity: 10, avgCost: 100.5, capitalization: 1005 },
      { article: 'B', quantity: 3, avgCost: 200.25, capitalization: 600.75 }
    ]);
    const res = h.context.writeStockSummary();
    check('Стоимость остатков: сумма колонки «Капитализация»', res.written === true && res.total === 1605.75, 'total=' + res.total);

    const dump = h.dumpTargetSheet(SHEET);
    check('Стоимость остатков: лист создан с нужными заголовками',
      dump && dump[0][0] === 'Дата' && dump[0][1] === 'Капитализация, ₽', JSON.stringify(dump && dump[0]));
    check('Стоимость остатков: ровно одна строка данных', dump && dump.length === 2, 'строк=' + (dump ? dump.length : 'нет'));
    check('Стоимость остатков: в колонке B число, а не текст', dump && typeof dump[1][1] === 'number', 'тип=' + (dump ? typeof dump[1][1] : '-'));

    const cell = dump[1][0];
    check('Стоимость остатков: в колонке A НАСТОЯЩАЯ дата (просьба читающей стороны)', cell instanceof Date, 'тип=' + typeof cell);
    const isYesterday = cell instanceof Date && cell.getFullYear() === 2026 && cell.getMonth() === 8 && cell.getDate() === 9;
    check('Стоимость остатков: строка описывает ЗАКРЫВШИЙСЯ день, а не день запуска', isYesterday, 'дата=' + String(cell));
    check('Стоимость остатков: ключ дня возвращается наружу', res.day === '2026-09-09', 'day=' + res.day);
  }

  // ---- Повторный запуск того же дня: строка ЗАМЕНЯЕТСЯ ----
  {
    const h = standWithStock([{ article: 'A', quantity: 10, avgCost: 100, capitalization: 1000 }]);
    h.context.writeStockSummary();
    h.setStockSheet([{ article: 'A', quantity: 12, avgCost: 100, capitalization: 1200 }]);
    const res = h.context.writeStockSummary();
    const dump = h.dumpTargetSheet(SHEET);
    check('Стоимость остатков: повтор в тот же день НЕ задваивает строку', dump.length === 2, 'строк=' + dump.length);
    check('Стоимость остатков: повтор сохраняет первое значение (100.8 R-055)', dump[1][1] === 1000 && res.written !== true, 'B=' + dump[1][1] + ' written=' + res.written);
  }

  // ---- 100.8 R-055: a repeat run keeps the closed day's first value ----
  {
    const h = freshHarness();
    h.setNow('2026-10-19T21:00:00Z'); // 02:00 Ekb on 20.10 -> row for 19.10
    h.setScriptProperty(PROP, h.targetSpreadsheetId);
    h.setStockSheet([{ article: 'A', quantity: 10, avgCost: 100, capitalization: 1000 }]);
    h.context.writeStockSummary();
    h.setNow('2026-10-20T07:00:00Z'); // noon 20.10; a receipt of 5 x 100 raises the stock
    h.setStockSheet([{ article: 'A', quantity: 15, avgCost: 100, capitalization: 1500 }]);
    const res = h.context.writeStockSummary();
    const dump = h.dumpTargetSheet(SHEET);
    check('100.8 R-055: repeat run the same day keeps 19.10 = 1000 after a receipt', dump[1][1] === 1000, 'B=' + dump[1][1]);
    check('100.8 R-055: repeat run adds no second row and reports written !== true', dump.length === 2 && res.written !== true, 'rows=' + (dump.length - 1) + ' written=' + res.written);
  }
  {
    const h = standWithStock([{ article: 'A', quantity: 1, avgCost: 7, capitalization: 7 }]);
    h.setTargetSheet(SHEET, [['Дата', 'Капитализация, ₽'], ['09.09.2026', 999]]);
    const res = h.context.writeStockSummary();
    const dump = h.dumpTargetSheet(SHEET);
    check('100.8 R-055: a hand-typed TEXT date row of that day is kept, no second row', dump.length === 2 && dump[1][1] === 999 && res.written !== true, JSON.stringify(dump));
  }

  // ---- Следующий день: история растёт ----
  {
    const h = standWithStock([{ article: 'A', quantity: 10, avgCost: 100, capitalization: 1000 }]);
    h.context.writeStockSummary();
    h.setNow('2026-09-11T00:30:00Z');
    h.setStockSheet([{ article: 'A', quantity: 20, avgCost: 100, capitalization: 2000 }]);
    const res = h.context.writeStockSummary();
    const dump = h.dumpTargetSheet(SHEET);
    check('Стоимость остатков: новый день ДОБАВЛЯЕТ строку', dump.length === 3 && res.replaced === false, 'строк=' + dump.length);
    check('Стоимость остатков: прежний день не тронут', dump[1][1] === 1000 && dump[2][1] === 2000, JSON.stringify([dump[1][1], dump[2][1]]));
  }

  // ---- Строка того же дня, записанная в другом формате даты, всё равно узнаётся ----
  {
    const h = standWithStock([{ article: 'A', quantity: 1, avgCost: 7, capitalization: 7 }]);
    h.setTargetSheet(SHEET, [['Дата', 'Капитализация, ₽'], ['09.09.2026', 999]]);
    h.context.writeStockSummary();
    const dump = h.dumpTargetSheet(SHEET);
    check('Стоимость остатков: день узнаётся и в формате ДД.ММ.ГГГГ, строка не задваивается и не перезаписывается', dump.length === 2 && dump[1][1] === 999, JSON.stringify(dump));
  }

  // ---- Стёртые заголовки восстанавливаются ----
  {
    const h = standWithStock([{ article: 'A', quantity: 1, avgCost: 5, capitalization: 5 }]);
    h.setTargetSheet(SHEET, [['дата', 'сумма'], []]);
    h.context.writeStockSummary();
    const dump = h.dumpTargetSheet(SHEET);
    check('Стоимость остатков: переименованные заголовки восстанавливаются',
      dump[0][0] === 'Дата' && dump[0][1] === 'Капитализация, ₽', JSON.stringify(dump[0]));
  }

  // ---- Колонка ищется по ЗАГОЛОВКУ, а не по номеру ----
  {
    const h = freshHarness();
    h.setNow(NIGHT_OF_10);
    h.setScriptProperty(PROP, h.targetSpreadsheetId);
    h.setStockSheetRaw([
      ['Артикул', 'Капитализация', 'Количество на складе', 'Средняя себестоимость'],
      ['A', 111.11, 5, 22.22]
    ]);
    const res = h.context.writeStockSummary();
    check('Стоимость остатков: колонка «Капитализация» ищется по заголовку', res.total === 111.11, 'total=' + res.total);
  }

  // ---- Пустой склад — это ноль, а не пропуск ----
  {
    const h = standWithStock([]);
    const res = h.context.writeStockSummary();
    const dump = h.dumpTargetSheet(SHEET);
    check('Стоимость остатков: пустой склад даёт 0, а не пустую ячейку', res.written === true && dump[1][1] === 0, 'B=' + dump[1][1]);
  }

  // ---- Копейки ----
  {
    const h = standWithStock([
      { article: 'A', quantity: 1, avgCost: 0.005, capitalization: 0.005 },
      { article: 'B', quantity: 1, avgCost: 10.111, capitalization: 10.111 }
    ]);
    const res = h.context.writeStockSummary();
    check('Стоимость остатков: сумма округляется до копеек', res.total === 10.12, 'total=' + res.total);
  }

  // ---- Нет листа «Остатки» ----
  {
    const h = freshHarness();
    h.setNow(NIGHT_OF_10);
    h.setScriptProperty(PROP, h.targetSpreadsheetId);
    h.clearStockSheet();
    const res = h.context.writeStockSummary();
    check('Стоимость остатков: без листа «Остатки» не падает', res.written === false && res.reason === 'no-stock-sheet', 'reason=' + res.reason);
  }

  // ---- Таблица недоступна ----
  {
    const h = standWithStock([{ article: 'A', quantity: 1, avgCost: 1, capitalization: 1 }]);
    h.setScriptProperty(PROP, 'нет-такой-таблицы');
    let threw = false;
    let res = null;
    try { res = h.context.writeStockSummary(); } catch (e) { threw = true; }
    check('Стоимость остатков: недоступная таблица не роняет ночной триггер',
      threw === false && res && res.written === false && res.reason === 'target-unavailable', 'threw=' + threw + ' reason=' + (res && res.reason));
  }

  // ---- Лист «Остатки» ЧИТАЕТСЯ, а не изменяется ----
  {
    const h = standWithStock([{ article: 'A', quantity: 10, avgCost: 100, capitalization: 1000 }]);
    const before = JSON.stringify(h.dumpStockSheet());
    h.context.writeStockSummary();
    check('Стоимость остатков: собственный лист «Остатки» не изменяется', JSON.stringify(h.dumpStockSheet()) === before, 'лист остался прежним');
  }
}

// ================= Item 68, stage 2: the unshipped part of a written-off supply returns =================
// The owner's case of 15.09.2026: supply 2000065651020 of order 127380557-1 was written off as
// 36 kits BowlGrayMini_01 (two boxes), one box went to Ozon, the other stayed on the shelf.
// The write-off is one operation for the whole order and is never cut; the difference comes
// back as a receipt of the kit's COMPONENTS at their write-off prices, so the average cost
// does not move, and the receipt is marked «Корректировка» so it never becomes a factory price.
{
  const POSTING = '2000065651020';
  const ORDER_NO = '127380557-1';
  const KIT = 'BowlGrayMini_01';

  /** Stock, a virtual kit of three components, and a write-off of 36 kits linked to one supply row. */
  function standWithWrittenOffSupply(opts) {
    const o = opts || {};
    const h = freshHarness();
    h.ensureTransSheet();
    h.setKitSheet([
      { kitSku: KIT, componentSku: 'Миска серая', quantity: 1, kitType: 'virtual' },
      { kitSku: KIT, componentSku: 'Бутылки', quantity: 1, kitType: 'virtual' },
      { kitSku: KIT, componentSku: 'Пакеты', quantity: 1, kitType: 'virtual' }
    ]);
    h.setStockSheet([
      { article: 'Миска серая', quantity: 100, avgCost: 150, capitalization: 15000 },
      { article: 'Бутылки', quantity: 100, avgCost: 12, capitalization: 1200 },
      { article: 'Пакеты', quantity: 100, avgCost: 5, capitalization: 500 },
      { article: 'ART-PLAIN', quantity: 10, avgCost: 7, capitalization: 70 }
    ]);
    const writeOff = h.commitTransaction(
      [{ article: KIT, quantity: 36, price: 0 }, { article: 'ART-PLAIN', quantity: 10, price: 7 }],
      'Расход', 'Ozon (MaxiStore)', '2026-09-16', 'tester', '2026-09-06T10:00:00Z', ''
    );
    const txIds = writeOff.newTransactions.map(t => String(t.id));
    h.setExternalShipmentsSheet([{
      postingId: POSTING, cabinet: 'MaxiStore', status: o.status || 'processed', ozonStatus: 'REJECTED_AT_SUPPLY_WAREHOUSE',
      items: [{ offerId: KIT, barcode: 'OZN1368918716', quantity: 36 }, { offerId: 'ART-PLAIN', barcode: 'OZN2', quantity: 10 }],
      transGroupInfo: o.noLink ? '' : JSON.stringify(txIds),
      orderNumber: ORDER_NO,
      shippedJSON: o.shippedJSON || ''
    }]);
    return h;
  }
  const oneBox = [{ offerId: KIT, article: KIT, shipped: 18 }, { offerId: 'ART-PLAIN', article: 'ART-PLAIN', shipped: 10 }];
  const receipts = (h) => h.dumpTransSheet().filter(r => String(r['Тип']) === 'Приход');

  // ---- The whole path: write-off → return → stock, history, the row ----
  {
    const h = standWithWrittenOffSupply();
    check('Возврат: до возврата компоненты списаны (100 − 36 = 64)', h.stockOf('Миска серая').quantity === 64, 'получено ' + h.stockOf('Миска серая').quantity);
    const res = h.commitUnshippedReturn(POSTING, oneBox, 'tester', 'op-return-1');
    check('Возврат: компоненты вернулись ровно на разницу (64 + 18 = 82)',
      h.stockOf('Миска серая').quantity === 82 && h.stockOf('Бутылки').quantity === 82 && h.stockOf('Пакеты').quantity === 82,
      [h.stockOf('Миска серая').quantity, h.stockOf('Бутылки').quantity, h.stockOf('Пакеты').quantity].join('/'));
    check('Возврат: средняя себестоимость компонентов не сдвинулась',
      h.stockOf('Миска серая').avgCost === 150 && h.stockOf('Бутылки').avgCost === 12 && h.stockOf('Пакеты').avgCost === 5,
      [h.stockOf('Миска серая').avgCost, h.stockOf('Бутылки').avgCost, h.stockOf('Пакеты').avgCost].join('/'));
    check('Возврат: капитализация выросла ровно на 18 × цену списания', h.stockOf('Миска серая').capitalization === 82 * 150, 'получено ' + h.stockOf('Миска серая').capitalization);
    check('Возврат: артикул без разницы (уехало столько же) не трогается', h.stockOf('ART-PLAIN').quantity === 0, 'получено ' + h.stockOf('ART-PLAIN').quantity);
    const rec = receipts(h);
    check('Возврат: в «Истории» три прихода — по компоненту, а не по комплекту',
      rec.length === 3 && rec.every(r => r['Артикул'] !== KIT), rec.map(r => r['Артикул']).join(', '));
    check('Возврат: приход идёт по цене списания, а не по нулю комплекта',
      rec.every(r => Number(r['Количество']) === 18) && rec.find(r => r['Артикул'] === 'Миска серая')['Цена'] === 150,
      rec.map(r => r['Артикул'] + '@' + r['Цена']).join(', '));
    check('Возврат: объект прихода несёт слово «Корректировка», номер поставки и заявки',
      rec.every(r => String(r['Объект']) === 'Корректировка: возврат неотгруженного, поставка № ' + POSTING + ' (заявка № ' + ORDER_NO + ')'),
      String(rec[0]['Объект']));
    const row = h.dumpExternalShipments()[0];
    let record = null;
    try { record = JSON.parse(String(row['ОтгруженоJSON'])); } catch (e) {}
    check('Возврат: в строку записано, что уехало, и id проводок',
      record && record.lines.length === 2 && record.lines[0].shipped === 18 && record.lines[0].declared === 36
        && record.returnTxIds.length === 3 && record.by === 'tester',
      String(row['ОтгруженоJSON']).slice(0, 160));
    check('Возврат: id проводок в строке — это id приходов из «Истории»',
      record && rec.every(r => record.returnTxIds.indexOf(String(r['ID'])) >= 0), 'ids');
    check('Возврат: ответ несёт список возвращённого', Array.isArray(res.returned) && res.returned.length === 3, 'returned=' + (res.returned && res.returned.length));
    check('Возврат: ответ несёт сами проводки прихода — экран обновляется без перечитывания базы',
      Array.isArray(res.newTransactions) && res.newTransactions.length === 3 && res.newTransactions.every(t => t.type === 'Приход' && Number(t.quantity) === 18),
      'newTransactions=' + (res.newTransactions && res.newTransactions.length));
  }

  // ---- The price of the write-off wins over today's average ----
  {
    const h = standWithWrittenOffSupply();
    // A receipt at another price after the write-off: the average of the bowl moves to 175.
    h.commitTransaction([{ article: 'Миска серая', quantity: 64, price: 200 }], 'Приход', 'Поставка', '', 'tester', '2026-09-10T10:00:00Z', '');
    check('Возврат: подготовка — средняя миски после нового прихода 175', h.stockOf('Миска серая').avgCost === 175, 'получено ' + h.stockOf('Миска серая').avgCost);
    h.commitUnshippedReturn(POSTING, oneBox, 'tester', 'op-return-2');
    const bowl = receipts(h).filter(r => r['Артикул'] === 'Миска серая').pop();
    check('Возврат: цена возврата — цена ТОГО списания (150), а не сегодняшняя средняя (175)', bowl && bowl['Цена'] === 150, 'получено ' + (bowl && bowl['Цена']));
  }

  // ---- Refusals: nothing is written before the checks ----
  {
    const h = standWithWrittenOffSupply();
    let msg = '';
    try { h.commitUnshippedReturn(POSTING, [{ offerId: KIT, article: KIT, shipped: 37 }], 'tester', 'op-x'); } catch (e) { msg = String(e.message || e); }
    check('Возврат: больше заявленного — отказ', msg.indexOf('от 0 до 36') >= 0, msg);
    check('Возврат: после отказа остатки не тронуты', h.stockOf('Миска серая').quantity === 64 && receipts(h).length === 0, 'qty=' + h.stockOf('Миска серая').quantity);
    check('Возврат: после отказа строка не помечена', String(h.dumpExternalShipments()[0]['ОтгруженоJSON']) === '', 'ОтгруженоJSON');
    msg = '';
    try { h.commitUnshippedReturn(POSTING, [{ offerId: KIT, article: KIT, shipped: 36 }], 'tester', 'op-x'); } catch (e) { msg = String(e.message || e); }
    check('Возврат: уехало столько же — возвращать нечего', msg.indexOf('возвращать нечего') >= 0, msg);
    msg = '';
    try { h.commitUnshippedReturn(POSTING, [{ offerId: 'NOPE', article: 'NOPE', shipped: 1 }], 'tester', 'op-x'); } catch (e) { msg = String(e.message || e); }
    check('Возврат: позиция не из поставки — отказ', msg.indexOf('нет в поставке') >= 0, msg);
    msg = '';
    try { h.commitUnshippedReturn(POSTING, [{ offerId: KIT, article: KIT, shipped: 17.5 }], 'tester', 'op-x'); } catch (e) { msg = String(e.message || e); }
    check('Возврат: дробное количество — отказ', msg.indexOf('целым числом') >= 0, msg);
  }
  {
    const h = standWithWrittenOffSupply();
    h.commitUnshippedReturn(POSTING, oneBox, 'tester', 'op-return-3');
    let msg = '';
    try { h.commitUnshippedReturn(POSTING, oneBox, 'tester', 'op-return-4'); } catch (e) { msg = String(e.message || e); }
    check('Возврат: второй раз по той же поставке — отказ', msg.indexOf('уже проведён') >= 0, msg);
    check('Возврат: второй раз ничего не добавил', h.stockOf('Миска серая').quantity === 82 && receipts(h).length === 3, 'qty=' + h.stockOf('Миска серая').quantity);
  }
  {
    const h = standWithWrittenOffSupply({ status: 'new' });
    let msg = '';
    try { h.commitUnshippedReturn(POSTING, oneBox, 'tester', 'op-x'); } catch (e) { msg = String(e.message || e); }
    check('Возврат: неоформленная поставка — отказ', msg.indexOf('не оформлена') >= 0, msg);
  }
  {
    const h = standWithWrittenOffSupply({ noLink: true });
    let msg = '';
    try { h.commitUnshippedReturn(POSTING, oneBox, 'tester', 'op-x'); } catch (e) { msg = String(e.message || e); }
    check('Возврат: оформлена, но без привязки к «Истории» — отказ', msg.indexOf('не привязана') >= 0, msg);
  }

  // ---- A plain article returns as itself ----
  {
    const h = standWithWrittenOffSupply();
    h.commitUnshippedReturn(POSTING, [{ offerId: KIT, article: KIT, shipped: 36 }, { offerId: 'ART-PLAIN', article: 'ART-PLAIN', shipped: 4 }], 'tester', 'op-return-5');
    const rec = receipts(h);
    check('Возврат: обычный артикул возвращается сам, 6 шт по цене списания 7',
      rec.length === 1 && rec[0]['Артикул'] === 'ART-PLAIN' && Number(rec[0]['Количество']) === 6 && rec[0]['Цена'] === 7,
      rec.map(r => r['Артикул'] + ' ' + r['Количество'] + '@' + r['Цена']).join(', '));
    check('Возврат: остаток обычного артикула 0 + 6', h.stockOf('ART-PLAIN').quantity === 6, 'получено ' + h.stockOf('ART-PLAIN').quantity);
    check('Возврат: комплект, уехавший целиком, компоненты не получил', h.stockOf('Миска серая').quantity === 64, 'получено ' + h.stockOf('Миска серая').quantity);
  }

  // ---- The return must never become the «last factory price» (item 35) ----
  {
    const h = standWithWrittenOffSupply();
    h.commitTransaction([{ article: 'Миска серая', quantity: 1, price: 111 }], 'Приход', 'Фабрика', '', 'tester', '2026-09-01T10:00:00Z', '');
    // The return is dated «now», and it must be LATER than the factory receipt — otherwise the
    // check would pass on the date alone and prove nothing about the «Корректировка» skip.
    h.setNow('2026-09-20T10:00:00Z');
    h.commitUnshippedReturn(POSTING, oneBox, 'tester', 'op-return-6');
    const returnRow = receipts(h).filter(r => r['Артикул'] === 'Миска серая').pop();
    check('Возврат: подготовка — возврат датирован позже фабричного прихода', String(returnRow['Дата']).indexOf('2026-09-20') === 0, String(returnRow['Дата']));
    const last = h.context.getLastPurchasePrices();
    check('Возврат: цена последнего поступления миски осталась фабричной (111), возврат пропущен',
      last['Миска серая'] && last['Миска серая'].price === 111, JSON.stringify(last['Миска серая']));
  }
}

// ================= Item 78a: KAN daily rows and warehouse snapshots =================
// A fake KAN MCP server answers list_shops (one Ozon shop, one WB shop), ping, and
// get_shop_analytics in its two shapes: the period summary (product_id → sku_article) and the
// daily rows (product_id + date + metrics), paginated through next_offset.
function fakeKan(opts) {
  const o = Object.assign({ latest: '2026-09-20', products: [{ id: 1, article: 'ART1' }, { id: 2, article: 'ART2' }], pageSize: 1000 }, opts || {});
  return function (url, options) {
    const body = JSON.parse(options.payload);
    const name = body.params.name;
    const args = body.params.arguments || {};
    const answer = (obj) => ({ code: 200, body: { jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: JSON.stringify(obj) }], isError: false } } });
    if (name === 'ping') return answer({ ok: true, date_context: { latest_complete_date: o.latest } });
    if (name === 'list_shops') return answer({ shops: [{ id: 2771, marketplace: 'ozon' }, { id: 3257, marketplace: 'wb' }, { id: 1765, marketplace: 'ozon' }] });
    if (name === 'get_shop_analytics') {
      const span = Math.round((Date.parse(args.date__lte) - Date.parse(args.date__gte)) / 86400000) + 1;
      if (span > 90) return { code: 200, body: { jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: JSON.stringify({ error: { code: 'invalid_params', message: 'Период аналитики слишком большой.', max_days: 90 } }) }], isError: true } } };
      if (args.period_summary) {
        return answer({ items: o.products.map(p => ({ product_id: p.id, sku_article: p.article, ordered_units: 1 })), next_offset: null });
      }
      const days = [];
      for (let d = args.date__gte; d <= args.date__lte; d = new Date(Date.parse(d + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10)) days.push(d);
      const all = [];
      days.forEach(d => o.products.forEach(p => all.push({
        product_id: p.id, date: d, stocks_cost_price: 100 * p.id, stocks_fbo_cnt: 10 * p.id, balance_delivering_cost: 5,
        balance_returning_cost: 1, cost_price: 20, gross_profit: 8, delivered_cnt: 2, ordered_units: 3
      })));
      const offset = Number(args.offset) || 0;
      const page = all.slice(offset, offset + o.pageSize);
      const next = offset + o.pageSize < all.length ? offset + o.pageSize : null;
      return answer({ items: page, next_offset: next });
    }
    return { code: 500, body: 'unknown tool ' + name };
  };
}

(function test78aToken() {
  const h = freshHarness();
  h.clearScriptProperties();
  h.setFetchHandler(fakeKan());
  let err = '';
  try { h.kanCall('ping', {}); } catch (e) { err = String(e.message || e); }
  check('78a: без свойства kan_mcpToken вызов KAN падает с понятным сообщением', /kan_mcpToken/.test(err), err);
  check('78a: без токена запрос в сеть не уходит', h.fetchLog.length === 0, 'запросов: ' + h.fetchLog.length);

  h.setScriptProperty('kan_mcpToken', 'secret-token');
  const r = h.kanCall('ping', {});
  check('78a: ответ KAN распакован из result.content[0].text', r.ok === true && r.date_context.latest_complete_date === '2026-09-20');
  const sent = h.fetchLog[0];
  check('78a: запрос — JSON-RPC tools/call на адрес KAN с Bearer-токеном',
    sent.url === 'https://kultura-analitiki.ru/mcp/' && sent.body.method === 'tools/call' && sent.body.params.name === 'ping'
      && sent.options.headers.Authorization === 'Bearer secret-token' && sent.options.muteHttpExceptions === true,
    JSON.stringify({ url: sent.url, method: sent.body.method, auth: sent.options.headers.Authorization }));

  h.setFetchHandler(() => ({ code: 401, body: { detail: 'Invalid or missing MCP credentials.' } }));
  err = '';
  try { h.kanCall('ping', {}); } catch (e) { err = String(e.message || e); }
  check('78a: HTTP 401 → сообщение про токен, а не про JSON', /токен/.test(err) && /401/.test(err), err);

  h.setFetchHandler(() => ({ code: 200, body: { jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'Rate limit exceeded' }], isError: true } } }));
  err = '';
  try { h.kanCall('ping', {}); } catch (e) { err = String(e.message || e); }
  check('78a: isError от инструмента → ошибка с текстом инструмента', /отказал/.test(err) && /Rate limit/.test(err), err);

  h.setFetchHandler(() => ({ code: 200, body: { jsonrpc: '2.0', id: 1, error: { code: -32602, message: 'bad params' } } }));
  err = '';
  try { h.kanCall('ping', {}); } catch (e) { err = String(e.message || e); }
  check('78a: JSON-RPC error → ошибка с его сообщением', /bad params/.test(err), err);
})();

(function test78aBackfill() {
  const h = freshHarness();
  h.setNow('2026-09-21T02:00:00Z'); // 05:00 МСК
  h.setScriptProperty('kan_mcpToken', 't');
  h.setFetchHandler(fakeKan({ latest: '2026-09-20', pageSize: 100 }));
  const r = h.kanPullDaily();
  check('78a: первый запуск тянет 120 дней до latest_complete_date', r.from === '2026-05-24' && r.to === '2026-09-20', r.from + '..' + r.to);
  check('78a: получено 120 дней × 2 товара = 240 строк', r.fetched === 240, 'строк: ' + r.fetched);
  const dump = h.dumpRegistrySheet('KAN дни');
  check('78a: лист «KAN дни» создан с заголовками', JSON.stringify(dump[0]) === JSON.stringify(h.KAN_DAYS_HEADERS), JSON.stringify(dump[0]));
  check('78a: в листе 240 строк данных', dump.length === 241, 'строк: ' + (dump.length - 1));
  const row = dump[1];
  check('78a: строка — дата, артикул из сводки, ProductID и метрики по порядку заголовков',
    row[0] === '2026-05-24' && row[1] === 'ART1' && row[2] === 1 && row[3] === 100 && row[4] === 10 && row[5] === 5 && row[6] === 1
      && row[7] === 20 && row[8] === 8 && row[9] === 2 && row[10] === 3 && /^2026-09-21 05:00/.test(String(row[11])),
    JSON.stringify(row));
  const analyticsCalls = h.fetchLog.filter(c => c.body.params.name === 'get_shop_analytics');
  const dailyCalls = analyticsCalls.filter(c => !c.body.params.arguments.period_summary);
  check('78a: дневная выборка пролистана по next_offset (240 строк по 100 = 3 страницы)', dailyCalls.length === 3, 'страниц: ' + dailyCalls.length);
  check('78a: в KAN уходят только магазины Ozon (2771, 1765), без WB 3257',
    analyticsCalls.every(c => JSON.stringify(c.body.params.arguments.shop_id) === JSON.stringify([2771, 1765])),
    JSON.stringify(analyticsCalls[0].body.params.arguments.shop_id));
  check('78a: дневная выборка просит именно восемь метрик капитала и продаж',
    JSON.stringify(dailyCalls[0].body.params.arguments.metrics) === JSON.stringify(['stocks_cost_price', 'stocks_fbo_cnt', 'balance_delivering_cost', 'balance_returning_cost', 'cost_price', 'gross_profit', 'delivered_cnt', 'ordered_units']),
    JSON.stringify(dailyCalls[0].body.params.arguments.metrics));
  const seen = new Set();
  const ranges = dailyCalls.map(c => [c.body.params.arguments.date__gte, c.body.params.arguments.date__lte])
    .filter(r => { const k = r.join('..'); if (seen.has(k)) return false; seen.add(k); return true; });
  const spanOf = (r) => Math.round((Date.parse(r[1]) - Date.parse(r[0])) / 86400000) + 1;
  check('78a: 120 дней бэкфилла режутся на куски не длиннее 90 дней (KAN max_days = 90), встык и без дыр',
    ranges.every(r => spanOf(r) <= 90) && ranges[0][0] === '2026-05-24' && ranges[ranges.length - 1][1] === '2026-09-20'
      && ranges.every((r, i) => i === 0 || Date.parse(r[0]) - Date.parse(ranges[i - 1][1]) === 86400000),
    JSON.stringify(ranges));
  check('78a: дневная выборка группируется по дню и товару',
    dailyCalls[0].body.params.arguments.date_group_by === 'day' && dailyCalls[0].body.params.arguments.product_group_by === 'product');

  // Second run the same day: nothing new, no analytics call, no duplicate rows.
  h.setFetchHandler(fakeKan({ latest: '2026-09-20' }));
  const r2 = h.kanPullDaily();
  const calls2 = h.fetchLog.filter(c => c.body.params.name === 'get_shop_analytics');
  check('78a: повтор в тот же день ничего не тянет и не дублирует', r2.fetched === 0 && calls2.length === 0 && h.dumpRegistrySheet('KAN дни').length === 241,
    'fetched ' + r2.fetched + ', analytics calls ' + calls2.length);

  // Next day: exactly one new day.
  h.setNow('2026-09-22T02:00:00Z');
  h.setFetchHandler(fakeKan({ latest: '2026-09-21' }));
  const r3 = h.kanPullDaily();
  check('78a: на следующий день тянется ровно один день (2 строки)', r3.from === '2026-09-21' && r3.to === '2026-09-21' && r3.fetched === 2, JSON.stringify(r3));
})();

(function test78aRetention() {
  const h = freshHarness();
  h.setNow('2026-09-21T02:00:00Z');
  h.setScriptProperty('kan_mcpToken', 't');
  const H = h.KAN_DAYS_HEADERS;
  const old = ['2025-07-01', 'ART1', 1, 1, 1, 1, 1, 1, 1, 1, 1, 'x']; // 447 days back → beyond 400
  const edge = ['2025-08-17', 'ART1', 1, 1, 1, 1, 1, 1, 1, 1, 1, 'x']; // exactly 400 days back → kept
  const fresh = ['2026-09-19', 'ART1', 1, 1, 1, 1, 1, 1, 1, 1, 1, 'x'];
  h.setRegistrySheet('KAN дни', [H.slice(), old, edge, fresh]);
  h.setFetchHandler(fakeKan({ latest: '2026-09-20' }));
  const r = h.kanPullDaily();
  const dump = h.dumpRegistrySheet('KAN дни');
  const days = dump.slice(1).map(x => x[0]);
  check('78a: старт от дня после последнего в листе', r.from === '2026-09-20' && r.fetched === 2, JSON.stringify(r));
  check('78a: строки старше 400 дней удалены, день ровно на границе, свежие и новые остались', !days.includes('2025-07-01') && days.includes('2025-08-17') && days.includes('2026-09-19') && days.filter(d => d === '2026-09-20').length === 2, JSON.stringify(days));
  check('78a: заголовок после перезаписи на месте', JSON.stringify(dump[0]) === JSON.stringify(H));
})();

(function test78aSnapshot() {
  const h = freshHarness();
  h.setNow('2026-09-21T02:00:00Z');
  h.setStockSheet([{ article: 'ART1', quantity: 10, avgCost: 123.456, capitalization: 1234.56 }, { article: 'ART2', quantity: 0, avgCost: 50, capitalization: 0 }]);
  const r = h.snapshotStock();
  const dump = h.dumpRegistrySheet('Снимки склада');
  check('78a: снимок пишет по строке на артикул за сегодня', r.written === 2 && r.day === '2026-09-21' && dump.length === 3, JSON.stringify(r));
  check('78a: капитал = остаток × средняя себестоимость, до копеек', dump[1][0] === '2026-09-21' && dump[1][1] === 'ART1' && dump[1][2] === 10 && dump[1][3] === 123.456 && dump[1][4] === 1234.56, JSON.stringify(dump[1]));
  const r2 = h.snapshotStock();
  check('78a: второй снимок в тот же день не пишется', r2.written === 0 && h.dumpRegistrySheet('Снимки склада').length === 3, JSON.stringify(r2));
})();

(function test78aDailyAndRead() {
  const h = freshHarness();
  h.setNow('2026-09-21T02:00:00Z');
  h.setScriptProperty('kan_mcpToken', 't');
  h.setStockSheet([{ article: 'ART1', quantity: 10, avgCost: 100, capitalization: 1000 }]);
  h.setFetchHandler(fakeKan({ latest: '2026-09-20', products: [{ id: 1, article: 'ART1' }] }));
  const r = h.kanTurnoverDaily();
  check('78a: ночная задача делает снимок и тянет KAN', r.snapshot.written === 1 && r.kan.fetched === 120, JSON.stringify({ s: r.snapshot.written, k: r.kan.fetched }));

  const d = h.getTurnoverData({ days: 7 });
  check('78a: getTurnoverData отдаёт окно по дате включительно', d.cutoff === '2026-09-14' && d.kanRows.length === 7 && d.snapshots.length === 1, 'kan ' + d.kanRows.length + ', snap ' + d.snapshots.length);
  check('78a: последний день KAN в ответе', d.latestKanDay === '2026-09-20', d.latestKanDay);
  const k = d.kanRows[0];
  check('78a: строка KAN — объект с полями капитала и продаж',
    k.date === '2026-09-14' && k.article === 'ART1' && k.productId === 1 && k.stockCost === 100 && k.stockQty === 10 && k.deliveringCost === 5
      && k.returningCost === 1 && k.costOfSales === 20 && k.grossProfit === 8 && k.boughtQty === 2 && k.orderedQty === 3, JSON.stringify(k));
  const sn = d.snapshots[0];
  check('78a: снимок — объект с остатком, себестоимостью и капиталом', sn.date === '2026-09-21' && sn.article === 'ART1' && sn.qty === 10 && sn.avgCost === 100 && sn.capital === 1000, JSON.stringify(sn));
  const dAll = h.getTurnoverData({});
  check('78a: без параметра — 90 дней', dAll.days === 90 && dAll.kanRows.length === 90, 'kan ' + dAll.kanRows.length);

  // A KAN failure must not lose the snapshot already written.
  const h2 = freshHarness();
  h2.setNow('2026-09-21T02:00:00Z');
  h2.setScriptProperty('kan_mcpToken', 't');
  h2.setStockSheet([{ article: 'ART1', quantity: 1, avgCost: 1, capitalization: 1 }]);
  h2.setFetchHandler(() => ({ code: 503, body: 'down' }));
  let err = '';
  try { h2.kanTurnoverDaily(); } catch (e) { err = String(e.message || e); }
  check('78a: при падении KAN снимок склада уже записан, ошибка поднята', /503/.test(err) && h2.dumpRegistrySheet('Снимки склада').length === 2, err);
})();

(function test78aRouting() {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'Code.gs'), 'utf8');
  check('78a: getTurnoverData обслуживается как чтение без замка, до switch', /if \(action === 'getTurnoverData'\) \{[\s\S]*?getTurnoverData\(payload\.data \|\| \{\}\)/.test(src) && src.indexOf("action === 'getTurnoverData'") < src.indexOf("switch (action)"));
  check('78a: runKanPullNow — только администратору', /case 'runKanPullNow': assertAdmin\(currentUser\); result = kanTurnoverDaily\(\); break;/.test(src));
  check('78a: токен читается только из свойства скрипта, в файле его нет', /getProperty\(KAN_TOKEN_PROPERTY\)/.test(src) && !/Bearer [A-Za-z0-9_\-]{20,}/.test(src));
  check('78a: пороги оборачиваемости в настройках Ozon: 90 / 45 / 20', /turnoverPeriodDays',\s*value: 90/.test(src) && /turnoverSlowDays',\s*value: 45/.test(src) && /turnoverFastDays',\s*value: 20/.test(src));
  // Item 89: the proxy's action lists moved from server.ts into src/lib/gasActions.ts.
  const proxy = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'src', 'lib', 'gasActions.ts'), 'utf8');
  check('78a: прокси знает getTurnoverData как чтение с кэшем Ozon', /\n  getTurnoverData: read\('ozon'\),/.test(proxy));
})();

// ================= clasp: what leaves for script.google.com =================
// Since 12.09.2026 Code.gs is deployed by `clasp push` from the repository root. clasp pushes
// every file under rootDir that .claspignore lets through, and the repository root also holds
// server.ts, src/, node_modules/. A broken ignore file would push the whole repository into
// the bound script of the production spreadsheet, and the mistake would sit there unnoticed —
// the script would still run. The manifest and Code.gs are the only two files allowed out.
{
  const fs = require('fs');
  const path = require('path');
  const ignore = fs.readFileSync(path.join(__dirname, '..', '..', '.claspignore'), 'utf8');
  const rules = ignore.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  check('clasp: всё под корнем закрыто правилом **/**', rules[0] === '**/**', 'первое правило: ' + rules[0]);
  check('clasp: наружу выпущены ровно манифест и два файла скрипта',
    JSON.stringify(rules.slice(1).sort()) === JSON.stringify(['!ChinaOrders.gs', '!Code.gs', '!appsscript.json']), 'правила: ' + rules.slice(1).join(' '));
  check('clasp: .clasp.json с идентификатором скрипта не уходит в публичный репозиторий',
    fs.readFileSync(path.join(__dirname, '..', '..', '.gitignore'), 'utf8').split('\n').includes('.clasp.json'), '.gitignore');
}

// ================= Item 80: additional costs of a shipment =================
//
// The fixture is the real shipment «Яндекс» of 22.09.2026 from «БД Склад»: 24 + 16 pieces,
// 240 ₽ of packaging and 636 ₽ of services = 876 ₽, spread as 525,60 and 350,40.

function withShipment() {
  const h = freshHarness();
  h.ensureTransSheet();
  h.ensureArchiveSheet();
  h.setStockSheet([
    { article: 'A', quantity: 100, avgCost: 614, capitalization: 61400 },
    { article: 'B', quantity: 100, avgCost: 582.65, capitalization: 58265 }
  ]);
  h.setOzonCostSheet([]);
  const dest = 'Яндекс [Упаковка: 40 шт. x 6₽ = 240₽ | Услуги: Доставка по городу 1 короб x4 (636₽)]';
  h.commitTransaction([{ article: 'A', quantity: 24, price: 614 }, { article: 'B', quantity: 16, price: 582.65 }],
    'Расход', dest, '2026-09-22', 'tester', '2026-09-22T11:05:47.756Z', 'op-ship', 876);
  const rows = h.getTransactions().rows.filter(t => t.type === 'Расход');
  return { h, dest, rowA: rows.find(t => t.article === 'A'), rowB: rows.find(t => t.article === 'B') };
}

(function test80a1() {
  const { h, rowA, rowB } = withShipment();
  check('80a: доли расходов разнесены по количеству при создании отгрузки',
    rowA.total === 15261.6 && rowB.total === 9672.8 && rowA.price === 635.9 && rowB.price === 604.55,
    `A ${rowA.total}/${rowA.price}, B ${rowB.total}/${rowB.price}`);

  // The defect this fixes: re-saving a row without changing anything used to add the whole
  // 876 ₽ of the shipment to it a second time (15 261,60 → 16 137,60).
  h.updateTransaction(rowA.id, {
    article: 'A', quantity: 24, price: rowA.price, writeOffCost: rowA.writeOffCost,
    type: 'Расход', destination: rowA.destination, deliveryDate: '2026-09-22', date: rowA.date
  }, 'tester');
  const after = h.getTransactions().rows.filter(t => t.type === 'Расход');
  const a2 = after.find(t => t.article === 'A');
  const b2 = after.find(t => t.article === 'B');
  check('80a: правка строки без изменений не двигает деньги отгрузки',
    a2.total === 15261.6 && a2.price === 635.9, `A ${a2.total}/${a2.price}`);
  check('80a: соседняя строка отгрузки правкой не затронута',
    b2.total === 9672.8 && b2.price === 604.55, `B ${b2.total}/${b2.price}`);
  check('80a: доля расходов строки осталась долей, а не всей суммой поставки',
    a2.additionalCosts === 876, `ДопРасходы ${a2.additionalCosts}`);
})();

(function test80a2() {
  const { h, rowA } = withShipment();
  // Quantity changed by the edit: the shipment now carries 30 + 16 pieces and the same 876 ₽.
  h.updateTransaction(rowA.id, {
    article: 'A', quantity: 30, price: rowA.price, writeOffCost: rowA.writeOffCost,
    type: 'Расход', destination: rowA.destination, deliveryDate: '2026-09-22', date: rowA.date
  }, 'tester');
  const a2 = h.getTransactions().rows.find(t => t.type === 'Расход' && t.article === 'A');
  // 876 * 30 / 46 = 571,30; goods 30 * 614 = 18 420 → 18 991,30
  check('80a: изменённое количество разносит расходы по новому итогу поставки',
    a2.total === 18991.3, `A ${a2.total}`);
})();

(function test80b1() {
  const { h, rowA, rowB } = withShipment();
  const res = h.updateShipmentExtras({
    id: rowA.id,
    packagingMode: 'unit', packagingValue: 6,
    otherMode: 'unit', otherValue: 0,
    services: [{ name: 'Доставка по городу 1 короб', quantity: 6, unitCost: 159 }]
  }, 'tester');

  check('80b: новая сумма расходов посчитана от услуг и упаковки',
    res.oldTotal === 876 && res.newTotal === 1194, `${res.oldTotal} → ${res.newTotal}`);
  check('80b: текст объекта пересобран, упаковка сохранила исходную запись',
    res.destination === 'Яндекс [Упаковка: 40 шт. x 6₽ = 240₽ | Услуги: Доставка по городу 1 короб x6 (954₽)]',
    res.destination);

  const rows = h.getTransactions().rows.filter(t => t.type === 'Расход');
  const a2 = rows.find(t => t.article === 'A');
  const b2 = rows.find(t => t.article === 'B');
  // 1194 * 24 / 40 = 716,40 → 14 736 + 716,40 = 15 452,40; 1194 * 16 / 40 = 477,60 → 9 800
  check('80b: обе строки поставки пересчитаны по количеству',
    a2.total === 15452.4 && b2.total === 9800, `A ${a2.total}, B ${b2.total}`);
  check('80b: цена строки пересчитана вместе с суммой',
    a2.price === 643.85 && b2.price === 612.5, `A ${a2.price}, B ${b2.price}`);
  check('80b: колонка ДопРасходы хранит новую сумму расходов поставки',
    a2.additionalCosts === 1194 && b2.additionalCosts === 1194, `${a2.additionalCosts}/${b2.additionalCosts}`);
  check('80b: себестоимость списания и количество не тронуты',
    a2.writeOffCost === rowA.writeOffCost && a2.quantity === 24 && b2.writeOffCost === rowB.writeOffCost,
    `${a2.writeOffCost}/${a2.quantity}`);
  const stock = h.getStock();
  check('80b: склад правкой услуг не двигается',
    stock.find(s => s.article === 'A').quantity === 76 && stock.find(s => s.article === 'A').capitalization === 46664,
    JSON.stringify(stock.find(s => s.article === 'A')));
  check('80b: правка сообщает, сколько строк поставки изменилось', res.changedRows === 2, String(res.changedRows));
})();

(function test80b2() {
  const { h, rowA } = withShipment();
  // Everything removed: the rows fall back to the bare cost of the goods and the tail goes.
  const res = h.updateShipmentExtras({ id: rowA.id, packagingMode: 'unit', packagingValue: 0,
    otherMode: 'unit', otherValue: 0, services: [] }, 'tester');
  check('80b: снятие всех расходов оставляет голый объект', res.destination === 'Яндекс', res.destination);
  const rows = h.getTransactions().rows.filter(t => t.type === 'Расход');
  const a2 = rows.find(t => t.article === 'A');
  const b2 = rows.find(t => t.article === 'B');
  check('80b: без расходов строки равны себестоимости товара',
    a2.total === 14736 && b2.total === 9322.4 && a2.price === 614 && b2.price === 582.65,
    `A ${a2.total}/${a2.price}, B ${b2.total}/${b2.price}`);
  // Empty, not a zero: parseTransactionRow reads an empty cell as null, and «0 ₽ расходов»
  // must look the same as a shipment that never had any.
  check('80b: пустая колонка ДопРасходы после снятия расходов',
    a2.additionalCosts === null && b2.additionalCosts === null, `${a2.additionalCosts}/${b2.additionalCosts}`);
})();

(function test80b3() {
  // A kit: the components carry no share, the whole amount sits on the kit row, and the new
  // text reaches the component rows too — they show the same object in «История».
  const h = freshHarness();
  h.ensureTransSheet();
  h.ensureArchiveSheet();
  h.setStockSheet([
    { article: 'MISKA', quantity: 100, avgCost: 147.85, capitalization: 14785 },
    { article: 'BOTTLE', quantity: 100, avgCost: 12.7, capitalization: 1270 }
  ]);
  h.setOzonCostSheet([]);
  h.setKitSheet([
    { kitSku: 'KIT', componentSku: 'MISKA', quantity: 1, kitType: 'virtual' },
    { kitSku: 'KIT', componentSku: 'BOTTLE', quantity: 1, kitType: 'virtual' }
  ]);
  const dest = 'Ozon (MaxiStore) [Услуги: Стоимость 1 короба ФФ x1 (106₽)]';
  h.commitTransaction([{ article: 'KIT', quantity: 18, price: 160.55 }],
    'Расход', dest, '2026-09-21', 'tester', '2026-09-21T16:38:23.330Z', 'op-kit', 106);
  const kitRow = h.getTransactions().rows.find(t => t.type === 'Расход' && !t.isComponent);
  const res = h.updateShipmentExtras({
    id: kitRow.id, packagingMode: 'unit', packagingValue: 0, otherMode: 'unit', otherValue: 0,
    services: [{ name: 'Стоимость 1 короба ФФ', quantity: 2, unitCost: 106 }]
  }, 'tester');
  check('80b: у комплекта пересчитана одна строка — сама строка комплекта', res.changedRows === 1, String(res.changedRows));
  const rows = h.getTransactions().rows.filter(t => t.type === 'Расход');
  const kit2 = rows.find(t => !t.isComponent);
  const comps = rows.filter(t => t.isComponent);
  // Components 18 x 147,85 + 18 x 12,70 = 2 889,90; services 2 x 106 = 212 → 3 101,90.
  check('80b: вся сумма услуг легла на строку комплекта',
    kit2.total === 3101.9 && kit2.price === 172.33, `комплект ${kit2.total}/${kit2.price}`);
  check('80b: строки комплектующих по деньгам не тронуты',
    comps.every(c => Math.abs(c.total - c.quantity * c.price) < 0.005), comps.map(c => c.total).join('/'));
  check('80b: новый текст объекта проставлен и у комплектующих',
    comps.every(c => c.destination === res.destination), comps.map(c => c.destination).join(' | '));
})();

(function test80b7() {
  // Packaging is priced per unit of goods, the way a supply is priced (owner, 22.09.2026).
  const { h, rowA } = withShipment();
  const res = h.updateShipmentExtras({
    id: rowA.id,
    packagingMode: 'unit', packagingValue: 8,
    otherMode: 'batch', otherValue: 100,
    services: [{ name: 'Доставка по городу 1 короб', quantity: 4, unitCost: 159 }]
  }, 'tester');
  // 40 pieces x 8 ₽ = 320 ₽ packaging, 100 ₽ «Прочее» for the batch, 636 ₽ services = 1 056 ₽.
  check('80c: упаковка на единицу умножается на количество поставки',
    res.newTotal === 1056, String(res.newTotal));
  check('80c: текст упаковки записан как при оформлении поставки',
    res.destination === 'Яндекс [Упаковка: 40 шт. x 8₽ = 320₽ | Прочее: 100₽ | Услуги: Доставка по городу 1 короб x4 (636₽)]',
    res.destination);
  const rows = h.getTransactions().rows.filter(t => t.type === 'Расход');
  // 1056 * 24 / 40 = 633,60 → 14 736 + 633,60 = 15 369,60
  check('80c: деньги строк пересчитаны от новой суммы расходов',
    rows.find(t => t.article === 'A').total === 15369.6, String(rows.find(t => t.article === 'A').total));
})();

(function test80b4() {
  const { h, rowA } = withShipment();
  let message = '';
  try {
    h.updateShipmentExtras({ id: 'нет такой строки', packagingMode: 'unit', packagingValue: 0, otherMode: 'unit', otherValue: 0, services: [] }, 'tester');
  } catch (e) { message = String(e.message || e); }
  check('80b: неизвестная строка истории отвергается', message.indexOf('не найдена') !== -1, message);

  const receipt = h.getTransactions().rows.find(t => t.type === 'Приход');
  message = '';
  if (receipt) {
    try {
      h.updateShipmentExtras({ id: receipt.id, packagingMode: 'unit', packagingValue: 0, otherMode: 'unit', otherValue: 0, services: [] }, 'tester');
    } catch (e) { message = String(e.message || e); }
    check('80b: у прихода доп. расходов нет', message.indexOf('только у отгрузки') !== -1, message);
  }

  // A batch write-off states the share of the whole batch in its text: editing one order of
  // it would move money that belongs to the others.
  h.commitTransaction([{ article: 'A', quantity: 5, price: 614 }], 'Расход',
    'Ozon [Услуги: Стикеровка x1 (100₽)] [Общая поставка: заявки № 1, № 2; доля 5 из 10 шт.]',
    '2026-09-22', 'tester', '2026-09-22T12:00:00.000Z', 'op-batch', 50);
  const batchRow = h.getTransactions().rows.find(t => String(t.destination).indexOf('Общая поставка') !== -1);
  message = '';
  try {
    h.updateShipmentExtras({ id: batchRow.id, packagingMode: 'unit', packagingValue: 0, otherMode: 'unit', otherValue: 0, services: [] }, 'tester');
  } catch (e) { message = String(e.message || e); }
  check('80b: заявка из общей поставки к правке услуг не допускается',
    message.indexOf('общей поставки') !== -1, message);
  check('80b: отвергнутая правка ничего не записала',
    h.getTransactions().rows.find(t => t.id === batchRow.id).total === batchRow.total, 'сумма изменилась');
})();

(function test80b5() {
  // Ozon: the cost that went to KAN included the services, so a correction is appended to the
  // journal «Себестоимость Озон» with the day of the same supply.
  const h = freshHarness();
  h.ensureTransSheet();
  h.ensureArchiveSheet();
  h.setStockSheet([{ article: 'ART', quantity: 100, avgCost: 600, capitalization: 60000 }]);
  h.setOzonCostSheet([]);
  h.setOzonStocksSheet([{ cabinet: 'MaxiStore', article: 'ART', available: 500, sku: '999' }]);
  const dest = 'Ozon (MaxiStore) [Услуги: Стикеровка x1 (100₽)]';
  h.commitTransaction([{ article: 'ART', quantity: 10, price: 600 }],
    'Расход', dest, '2026-09-20', 'tester', '2026-09-19T10:00:00.000Z', 'op-ozon', 100);
  const before = h.dumpOzonCost().length;
  const row = h.getTransactions().rows.find(t => t.type === 'Расход');
  const res = h.updateShipmentExtras({
    id: row.id, packagingMode: 'unit', packagingValue: 0, otherMode: 'unit', otherValue: 0,
    services: [{ name: 'Стикеровка', quantity: 3, unitCost: 100 }]
  }, 'tester');
  check('80b: исправленная себестоимость дописана в журнал для КАН',
    res.costRowsAppended > 0 && h.dumpOzonCost().length > before,
    `дописано ${res.costRowsAppended}, было строк ${before}, стало ${h.dumpOzonCost().length}`);
})();

(function test80b6() {
  // The text is taken apart and put back together without losing anything.
  const h = freshHarness();
  const d = 'Ozon FBO [Упаковка: 500₽ | Прочее: 55₽ | Услуги: Стикеровка x10 (500₽)] [Списание - Брак]';
  const e = h.parseShipmentExtrasGs(d);
  check('80b: разбор текста находит все три суммы и хранит чужие пометки',
    e.main === 'Ozon FBO' && e.packaging === 500 && e.other === 55
      && e.services.length === 1 && e.services[0].quantity === 10 && e.services[0].unitCost === 50
      && e.keptGroups.length === 1 && e.keptGroups[0][0] === 'Списание - Брак',
    JSON.stringify(e));
  check('80b: сумма расходов из текста считается как при записи', h.extrasTotalGs(e) === 1055, String(h.extrasTotalGs(e)));
  // Сумма на партию — это цена партии, а не цена штуки: иначе пересборка текста превратила бы
  // «Упаковка: 500₽» в «Упаковка: N шт. x 500₽».
  check('80c: у суммы на партию цены за единицу нет',
    e.packagingUnit === 0 && e.otherUnit === 0, `${e.packagingUnit}/${e.otherUnit}`);
  const perUnit = h.parseShipmentExtrasGs('Ozon [Упаковка: 18 шт. x 37₽ = 666₽]');
  check('80c: у записи на единицу цена штуки вытащена из текста',
    perUnit.packaging === 666 && perUnit.packagingUnit === 37, `${perUnit.packaging}/${perUnit.packagingUnit}`);
  check('80c: текст на партию пересобирается суммой, а не ценой штуки',
    h.buildDestinationGs({ main: 'Ozon', packaging: 500, packagingUnit: 0, other: 0, otherUnit: 0, services: [], keptGroups: [] }, null, 40)
      === 'Ozon [Упаковка: 500₽]',
    h.buildDestinationGs({ main: 'Ozon', packaging: 500, packagingUnit: 0, other: 0, otherUnit: 0, services: [], keptGroups: [] }, null, 40));
  check('80b: сборка текста возвращает исходную строку', h.buildDestinationGs(e, e) === d, h.buildDestinationGs(e, e));
})();

// ================= Item 90, ticket 03: the whole shipment =================
//
// Combined shipment as ConfirmModal writes it: one commit per order, the order's share of the batch
// total from splitByQuantity, the note «[Общая поставка: …]», OpID «<shipment>-N», the shared
// shipment number. Three Ozon orders of 10 / 20 / 30 pieces (the third holds two articles), batch
// total 1 200 ₽ → shares 200 / 400 / 600; new extras 6 ₽ x 60 pieces + 2 459 ₽ = 2 819 ₽.
// Expected figures were computed with a node snippet using the same roundToTwo and the kopeck
// largest-remainder split:
//   shares  = split(2819, [10, 20, 30]) = 469.83 / 939.67 / 1409.50  (281900 kop: 46983.33 / 93966.67 / 140950;
//             one leftover kopeck goes to the largest remainder — order 2)
//   row     = old row total - round2(oldShare * qty / orderPieces) + round2(newShare * qty / orderPieces)
//   order 1 A x10: 6200 - 200 + 469.83 = 6469.83 (price 646.98); order 2 B x20: 12400 - 400 + 939.67 = 12939.67;
//   order 3 A x20: 12400 - 400 + 939.67 = 12939.67, B x10: 6200 - 200 + 469.83 = 6469.83.

const T90_SHIP = 'op-comb';
const T90_LABELS = ['1300-1', '1301-1', '1302-1'];
const t90Note = (labels, q, Q, share, total) =>
  `[Общая поставка: заявки ${labels.map(l => '№ ' + l).join(', ')}; доля этой заявки ${q} из ${Q} шт., ${share.toFixed(2)} руб. из ${total.toFixed(2)} руб.]`;

function t90Combined(orders, oldShares, base) {
  const h = freshHarness();
  h.ensureTransSheet();
  h.ensureArchiveSheet();
  h.setStockSheet([
    { article: 'A', quantity: 500, avgCost: 600, capitalization: 300000 },
    { article: 'B', quantity: 500, avgCost: 600, capitalization: 300000 }
  ]);
  h.setOzonCostSheet([]);
  h.setOzonStocksSheet([
    { cabinet: 'MaxiStore', article: 'A', available: 900, sku: '111' },
    { cabinet: 'MaxiStore', article: 'B', available: 900, sku: '222' }
  ]);
  const pieces = orders.map(o => o.reduce((s, l) => s + l.quantity, 0));
  const Q = pieces.reduce((s, q) => s + q, 0);
  const total = oldShares.reduce((s, v) => s + v, 0);
  orders.forEach((lines, i) => {
    h.commitTransaction(lines.map(l => ({ ...l, price: 600 })), 'Расход',
      `${base} ${t90Note(T90_LABELS.slice(0, orders.length), pieces[i], Q, oldShares[i], total)}`,
      '2026-09-22', 'tester', '2026-09-22T11:05:47.756Z', `${T90_SHIP}-${i + 1}`, oldShares[i], undefined, '', T90_SHIP);
  });
  return h;
}
const t90Rows = h => h.getTransactions().rows.filter(t => t.type === 'Расход');
const t90Extras = { packagingMode: 'unit', packagingValue: 6, otherMode: 'unit', otherValue: 0,
  services: [{ name: 'Доставка', quantity: 1, unitCost: 2459 }] };
const T90_BASE = 'Ozon (MaxiStore) [Услуги: Паллета x1 (1200₽)]';
const t90ThreeOrders = () => t90Combined(
  [[{ article: 'A', quantity: 10 }], [{ article: 'B', quantity: 20 }], [{ article: 'A', quantity: 20 }, { article: 'B', quantity: 10 }]],
  [200, 400, 600], T90_BASE);

(function test90t03a() {
  const h = t90ThreeOrders();
  const rowsBefore = t90Rows(h);
  const stockBefore = JSON.stringify(h.dumpStockSheet());
  const journalBefore = h.dumpOzonCost().length;
  const res = h.updateShipmentExtras({ id: rowsBefore[0].id, ...t90Extras, comment: 'Паллета 12' }, 'tester');
  const rows = t90Rows(h);
  const byOrder = n => rows.filter(t => t.opId === `${T90_SHIP}-${n}`);

  check('90t03: three orders get shares 469.83 / 939.67 / 1409.50 summing to the new total to the kopeck',
    JSON.stringify(res.orders.map(o => o.newShare)) === '[469.83,939.67,1409.5]'
      && Math.round(res.orders.reduce((s, o) => s + o.newShare, 0) * 100) === 281900 && res.newTotal === 2819,
    JSON.stringify(res.orders));
  check('90t03: the answer carries pieces, old shares and labels per order; oldTotal is the sum of old shares',
    JSON.stringify(res.orders.map(o => [o.opId, o.label, o.pieces, o.oldShare]))
      === JSON.stringify([[`${T90_SHIP}-1`, '1300-1', 10, 200], [`${T90_SHIP}-2`, '1301-1', 20, 400], [`${T90_SHIP}-3`, '1302-1', 30, 600]])
      && res.oldTotal === 1200,
    JSON.stringify(res.orders) + ' ' + res.oldTotal);
  check('90t03: extras per piece are equal across orders within a kopeck',
    res.orders.every(o => Math.abs(o.newShare - 2819 * o.pieces / 60) <= 0.01),
    res.orders.map(o => (o.newShare / o.pieces).toFixed(4)).join(' / '));
  check('90t03: every order row is re-spread by the pieces of its order (money and «ДопРасходы»)',
    byOrder(1)[0].total === 6469.83 && byOrder(1)[0].price === 646.98 && byOrder(1)[0].additionalCosts === 469.83
      && byOrder(2)[0].total === 12939.67 && byOrder(2)[0].additionalCosts === 939.67
      && byOrder(3).find(t => t.article === 'A').total === 12939.67
      && byOrder(3).find(t => t.article === 'B').total === 6469.83
      && byOrder(3).every(t => t.additionalCosts === 1409.5),
    JSON.stringify(rows.map(t => [t.opId, t.article, t.total, t.price, t.additionalCosts])));
  check('90t03: every order gets the new extras text and its own rewritten note, no «₽» in the note',
    [1, 2, 3].every((n, i) => byOrder(n)[0].destination
      === `Ozon (MaxiStore) [Упаковка: 60 шт. x 6₽ = 360₽ | Услуги: Доставка x1 (2459₽)] `
        + t90Note(T90_LABELS, [10, 20, 30][i], 60, [469.83, 939.67, 1409.5][i], 2819))
      && res.destination === rows.find(t => t.id === rowsBefore[0].id).destination,
    byOrder(2)[0].destination);
  check('90t03: quantities, write-off cost and the stock sheet did not move',
    JSON.stringify(rows.map(t => [t.quantity, t.writeOffCost])) === JSON.stringify(rowsBefore.map(t => [t.quantity, t.writeOffCost]))
      && JSON.stringify(h.dumpStockSheet()) === stockBefore,
    JSON.stringify(rows.map(t => [t.quantity, t.writeOffCost])));
  const journal = h.dumpOzonCost();
  check('90t03: the cost journal gains one corrected entry per changed Ozon row (4 rows in 3 orders)',
    res.costRowsAppended === 4 && journal.length === journalBefore + 4,
    `appended ${res.costRowsAppended}, journal ${journalBefore} -> ${journal.length}`);
  check('90t03: the comment is written to every row of every order',
    rows.every(t => t.comment === 'Паллета 12'), JSON.stringify(rows.map(t => t.comment)));

  // A repeat with the same input changes no money and appends nothing.
  const again = h.updateShipmentExtras({ id: rows[0].id, ...t90Extras }, 'tester');
  check('90t03: the same correction twice changes no money and, without a comment field, keeps the comments',
    again.changedRows === 0 && again.costRowsAppended === 0
      && JSON.stringify(t90Rows(h).map(t => [t.total, t.comment])) === JSON.stringify(rows.map(t => [t.total, t.comment])),
    JSON.stringify(again.orders));
  h.updateShipmentExtras({ id: rows[0].id, ...t90Extras, comment: '   ' }, 'tester');
  check('90t03: an empty comment clears the comments of every row',
    t90Rows(h).every(t => t.comment === ''), JSON.stringify(t90Rows(h).map(t => t.comment)));
})();

(function test90t03b() {
  // An order deleted after the write-off: the total goes over the remaining orders (10 and 30
  // pieces). Per-piece packaging is now 6 x 40 = 240, so the total is 240 + 2 459 = 2 699 ₽ and
  // split(2699, [10, 30]) = 674.75 / 2024.25; the shares of the rest come off as stored
  // (200 / 600) and the label of the deleted order drops out of the notes.
  const h = t90ThreeOrders();
  t90Rows(h).filter(t => t.opId === `${T90_SHIP}-2`).forEach(t => h.deleteTransaction(t.id, 'tester'));
  const res = h.updateShipmentExtras({ id: t90Rows(h)[0].id, ...t90Extras }, 'tester');
  const rows = t90Rows(h);
  check('90t03: after an order was deleted the new total is spread over the remaining orders',
    JSON.stringify(res.orders.map(o => [o.pieces, o.oldShare, o.newShare])) === '[[10,200,674.75],[30,600,2024.25]]'
      && res.oldTotal === 800,
    JSON.stringify(res.orders));
  check('90t03: the remaining rows carry the new shares (6674.75 / 13349.50 / 6674.75)',
    JSON.stringify(rows.map(t => [t.article, t.total])) === JSON.stringify([['B', 6674.75], ['A', 13349.5], ['A', 6674.75]]),
    JSON.stringify(rows.map(t => [t.article, t.total])));
  check('90t03: the deleted order drops out of the notes, and the batch is now 40 pieces',
    rows.every(t => t.destination.includes('заявки № 1300-1, № 1302-1;') && !t.destination.includes('1301-1'))
      && rows[1].destination.endsWith('доля этой заявки 30 из 40 шт., 2024.25 руб. из 2699.00 руб.]')
      && res.orders.map(o => o.label).join() === '1300-1,1302-1',
    rows[0].destination);
})();

(function test90t03c() {
  // A quantity edited after the write-off (row edit: the row keeps its OpID, shipment number,
  // «ДопРасходы» and «Объект»): order 3 now holds 25 + 10 = 35 pieces, 65 in all, so the
  // total is 6 x 65 + 2 459 = 2 849 and split(2849, [10, 20, 35]) = 438.31 / 876.61 / 1534.08.
  // The edited row A x25 was re-spread by the edit as 15 000 + round2(600 * 25 / 35) = 15 428.57;
  // the correction takes 428.57 off and puts round2(1534.08 * 25 / 35) = 1095.77 on: 16 095.77.
  // (Its sibling B x10 was NOT re-spread by the edit: 6 200 - 171.43 + 438.31 = 6 466.88.)
  const h = t90ThreeOrders();
  const edited = t90Rows(h).find(t => t.opId === `${T90_SHIP}-3` && t.article === 'A');
  h.updateTransaction(edited.id, {
    article: 'A', quantity: 25, price: edited.price, writeOffCost: edited.writeOffCost,
    type: 'Расход', destination: edited.destination, deliveryDate: '2026-09-22', date: edited.date
  }, 'tester');
  const after = t90Rows(h).find(t => t.article === 'A' && t.quantity === 25);
  check('90t03: the row edit keeps the OpID and the shipment number',
    after.opId === `${T90_SHIP}-3` && after.shipmentId === T90_SHIP && after.total === 15428.57, JSON.stringify(after));
  const res = h.updateShipmentExtras({ id: t90Rows(h)[0].id, ...t90Extras }, 'tester');
  const rows = t90Rows(h);
  check('90t03: shares follow the current pieces and the edited row still resolves to its own order',
    JSON.stringify(res.orders.map(o => [o.pieces, o.newShare])) === '[[10,438.31],[20,876.61],[35,1534.08]]'
      && res.orders.length === 3,
    JSON.stringify(res.orders));
  check('90t03: the edited row and the untouched orders carry the recomputed money',
    rows.find(t => t.quantity === 25).total === 16095.77
      && rows.find(t => t.article === 'B' && t.quantity === 10).total === 6466.88
      && rows.find(t => t.article === 'B' && t.quantity === 20).total === 12876.61
      && rows.find(t => t.article === 'A' && t.quantity === 10).total === 6438.31
      && rows.find(t => t.quantity === 25).additionalCosts === 1534.08,
    JSON.stringify(rows.map(t => [t.article, t.quantity, t.total, t.additionalCosts])));
})();

(function test90t03d() {
  // Combined shipment written before shipment numbers existed: refused, nothing written.
  const h = freshHarness();
  h.ensureTransSheet();
  h.ensureArchiveSheet();
  h.setStockSheet([{ article: 'A', quantity: 500, avgCost: 600, capitalization: 300000 }]);
  h.setOzonCostSheet([]);
  h.commitTransaction([{ article: 'A', quantity: 10, price: 600 }], 'Расход',
    `Яндекс [Услуги: Паллета x1 (1200₽)] ${t90Note(['1', '2'], 10, 30, 400, 1200)}`,
    '2026-09-22', 'tester', '2026-09-22T11:05:47.756Z', 'op-old-1', 400);
  const dumpBefore = JSON.stringify(h.dumpTransSheet()) + JSON.stringify(h.dumpOzonCost());
  let msg = '';
  try { h.updateShipmentExtras({ id: t90Rows(h)[0].id, ...t90Extras, comment: 'x' }, 'tester'); } catch (e) { msg = e.message; }
  check('90t03: an old combined shipment (no shipment number) is refused with a clear reason, nothing written',
    msg.includes('общей поставки') && msg.includes('номеров отгрузки')
      && JSON.stringify(h.dumpTransSheet()) + JSON.stringify(h.dumpOzonCost()) === dumpBefore,
    msg);
})();

(function test90t03e() {
  // A row of the shipment without an OpID (written with a shipment number but no operation id)
  // cannot be placed in any order: the correction is refused and nothing is written.
  const h = t90Combined([[{ article: 'A', quantity: 10 }], [{ article: 'B', quantity: 20 }]], [400, 800], T90_BASE);
  h.commitTransaction([{ article: 'A', quantity: 3, price: 600 }], 'Расход', T90_BASE, '2026-09-22', 'tester',
    '2026-09-22T11:05:47.756Z', '', 0, undefined, '', T90_SHIP);
  const dumpBefore = JSON.stringify(h.dumpTransSheet()) + JSON.stringify(h.dumpOzonCost());
  let msg = '';
  try { h.updateShipmentExtras({ id: t90Rows(h)[0].id, ...t90Extras, comment: 'x' }, 'tester'); } catch (e) { msg = e.message; }
  check('90t03: an OpID-less row inside a shipment is refused naming its article, nothing written',
    msg.includes('«A»') && msg.includes('Ничего не записано') && JSON.stringify(h.dumpTransSheet()) + JSON.stringify(h.dumpOzonCost()) === dumpBefore,
    msg);
})();

(function test90t03f() {
  // A shipment number with one order left is a whole shipment of one order: the whole total is its share
  // (6 x 10 + 2 459 = 2 519).
  const h = t90Combined([[{ article: 'A', quantity: 10 }]], [300], T90_BASE);
  const res = h.updateShipmentExtras({ id: t90Rows(h)[0].id, ...t90Extras }, 'tester');
  check('90t03: one order with a shipment number carries the whole new total',
    JSON.stringify(res.orders.map(o => [o.pieces, o.oldShare, o.newShare])) === '[[10,300,2519]]'
      && t90Rows(h)[0].additionalCosts === 2519 && t90Rows(h)[0].total === 6000 + 2519,
    JSON.stringify(res.orders));
})();

(function test90t03g() {
  // The row edit keeps the OpID of the row it replaces: a plain single operation (item 80 fixture)
  // and a kit (main row + component row, both re-written by the edit).
  const { h, rowA } = withShipment();
  h.updateTransaction(rowA.id, {
    article: 'A', quantity: 24, price: rowA.price, writeOffCost: rowA.writeOffCost,
    type: 'Расход', destination: rowA.destination, deliveryDate: '2026-09-22', date: rowA.date
  }, 'tester');
  check('90t03: a plain single-operation row edit keeps the OpID of the row',
    t90Rows(h).filter(t => t.opId === 'op-ship').length === 2, JSON.stringify(t90Rows(h).map(t => t.opId)));

  const k = freshHarness();
  k.ensureTransSheet();
  k.ensureArchiveSheet();
  k.setStockSheet([{ article: 'COMPK', quantity: 500, avgCost: 100, capitalization: 50000 }]);
  k.setKitSheet([{ kitSku: 'KITK', componentSku: 'COMPK', quantity: 2, kitType: 'virtual' }]);
  k.setOzonCostSheet([]);
  k.commitTransaction([{ article: 'KITK', quantity: 3, price: 300 }], 'Расход', 'Яндекс', '2026-09-22', 'tester',
    '2026-09-22T11:05:47.756Z', 'op-kit');
  const main = t90Rows(k).find(t => t.article === 'KITK');
  k.updateTransaction(main.id, {
    article: 'KITK', quantity: 4, price: main.price, writeOffCost: main.writeOffCost,
    type: 'Расход', destination: 'Яндекс', deliveryDate: '2026-09-22', date: main.date
  }, 'tester');
  const kitRows = t90Rows(k);
  check('90t03: a kit row edit keeps the OpID on the main row and on its component row',
    kitRows.length === 2 && kitRows.some(t => t.isComponent === true) && kitRows.every(t => t.opId === 'op-kit'),
    JSON.stringify(kitRows.map(t => [t.article, t.isComponent, t.opId])));
})();

(function test90t03h() {
  // Mutation-testing additions (item 90, ticket 03).
  // (1) Rounding ties: 1.00 over three equal orders is 100 kop / 3 = 33.33 each, one leftover kopeck
  //     goes to the EARLIEST order on equal remainders: 0.34 / 0.33 / 0.33.
  const tie = t90Combined([[{ article: 'A', quantity: 10 }], [{ article: 'A', quantity: 10 }], [{ article: 'A', quantity: 10 }]],
    [0, 0, 0], 'Ozon (MaxiStore)');
  const tieRes = tie.updateShipmentExtras({ id: t90Rows(tie)[0].id, packagingMode: 'batch', packagingValue: 0, otherMode: 'batch', otherValue: 0,
    services: [{ name: 'Доставка', quantity: 1, unitCost: 1 }] }, 'tester');
  check('90t03: a leftover kopeck on equal remainders goes to the earliest order (0.34 / 0.33 / 0.33)',
    JSON.stringify(tieRes.orders.map(o => o.newShare)) === '[0.34,0.33,0.33]', JSON.stringify(tieRes.orders));

  // (2) A batch note whose order number is outside the list of labels: the list stays as written
  //     (no «undefined» label), and the order is still corrected.
  const odd = t90Combined([[{ article: 'A', quantity: 10 }], [{ article: 'B', quantity: 20 }]], [200, 400], T90_BASE);
  odd.commitTransaction([{ article: 'A', quantity: 5, price: 600 }], 'Расход',
    `${T90_BASE} ${t90Note(T90_LABELS.slice(0, 2), 5, 35, 100, 700)}`,
    '2026-09-22', 'tester', '2026-09-22T11:05:47.756Z', `${T90_SHIP}-7`, 100, undefined, '', T90_SHIP);
  const oddRes = odd.updateShipmentExtras({ id: t90Rows(odd)[0].id, ...t90Extras }, 'tester');
  check('90t03: an order number beyond the label list keeps the note labels as written, no «undefined»',
    oddRes.orders.length === 3 && oddRes.orders.every(o => o.label === '')
      && t90Rows(odd).every(t => t.destination.includes('заявки № 1300-1, № 1301-1;') && !t.destination.includes('undefined')),
    t90Rows(odd)[0].destination);

  // (3) The parsed note: empty labels dropped, decimal piece count read with a comma.
  const parsed = tie.parseBatchNoteGs('Общая поставка: заявки № A, ,№ B; доля этой заявки 5 из 12,5 шт., 1.00 руб. из 2.00 руб.');
  check('90t03: parseBatchNoteGs drops empty labels and reads a decimal piece count',
    JSON.stringify(parsed.labels) === '["A","B"]' && parsed.totalQty === 12.5, JSON.stringify(parsed));

  // (4) The comment is written trimmed into the sheet cell itself, kit component rows included.
  const k = freshHarness();
  k.ensureTransSheet();
  k.ensureArchiveSheet();
  k.setStockSheet([{ article: 'COMPK', quantity: 500, avgCost: 100, capitalization: 50000 }]);
  k.setKitSheet([{ kitSku: 'KITK', componentSku: 'COMPK', quantity: 2, kitType: 'virtual' }]);
  k.setOzonCostSheet([]);
  k.commitTransaction([{ article: 'KITK', quantity: 3, price: 300 }], 'Расход', 'Яндекс', '2026-09-22', 'tester',
    '2026-09-22T11:05:47.756Z', 'op-kit');
  k.updateShipmentExtras({ id: t90Rows(k)[0].id, packagingMode: 'batch', packagingValue: 30, otherMode: 'batch', otherValue: 0,
    services: [], comment: '  Паллета 12  ' }, 'tester');
  const raw = k.dumpTransSheet().filter(r => String(r['Тип']) === 'Расход');
  check('90t03: the comment lands trimmed in the cell of every row of the set, the kit component row too',
    raw.length === 2 && raw.some(r => String(r['isComponent']) === 'true' || r['isComponent'] === true)
      && raw.every(r => r['Комментарий'] === 'Паллета 12'),
    JSON.stringify(raw.map(r => [r['isComponent'], r['Комментарий']])));
  // The extras belong to the main kit row only: 30 ₽ on it, nothing on the component row.
  const kitRows = t90Rows(k);
  check('90t03: a kit shipment carries the extras on the main row only (component row keeps no «ДопРасходы»)',
    kitRows.find(t => t.isComponent !== true).additionalCosts === 30
      && kitRows.filter(t => t.isComponent === true).every(t => t.additionalCosts === null),
    JSON.stringify(kitRows.map(t => [t.article, t.isComponent, t.additionalCosts])));

  // (5) A combined shipment with a kit order: the old share is read off the MAIN row of the order
  //     (the component row holds no «ДопРасходы»), and the kit order stays correctable.
  const kc = freshHarness();
  kc.ensureTransSheet();
  kc.ensureArchiveSheet();
  kc.setStockSheet([{ article: 'COMPK', quantity: 500, avgCost: 100, capitalization: 50000 },
    { article: 'A', quantity: 500, avgCost: 600, capitalization: 300000 }]);
  kc.setKitSheet([{ kitSku: 'KITK', componentSku: 'COMPK', quantity: 2, kitType: 'virtual' }]);
  kc.setOzonCostSheet([]);
  kc.commitTransaction([{ article: 'KITK', quantity: 3, price: 300 }], 'Расход', 'Яндекс', '2026-09-22', 'tester',
    '2026-09-22T11:05:47.756Z', 'op-kc-1', 90, undefined, '', 'op-kc');
  kc.commitTransaction([{ article: 'A', quantity: 3, price: 600 }], 'Расход', 'Яндекс', '2026-09-22', 'tester',
    '2026-09-22T11:05:47.756Z', 'op-kc-2', 90, undefined, '', 'op-kc');
  const kcRes = kc.updateShipmentExtras({ id: t90Rows(kc)[0].id, packagingMode: 'batch', packagingValue: 0, otherMode: 'batch', otherValue: 0,
    services: [{ name: 'Доставка', quantity: 1, unitCost: 60 }] }, 'tester');
  check('90t03: in a combined shipment with a kit order the old share is the main row stored figure (90), new shares 30 / 30',
    JSON.stringify(kcRes.orders.map(o => [o.pieces, o.oldShare, o.newShare])) === '[[3,90,30],[3,90,30]]' && kcRes.oldTotal === 180,
    JSON.stringify(kcRes.orders));
})();

(function test90t03h() {
  // Two orders of one combined Ozon shipment, the same article on the same day: each order's journal
  // row is corrected with ITS OWN unit cost. 9 and 14 pieces of A, old batch 1000 (shares 391.30 /
  // 608.70), new total 1002 (packaging «на партию»). Node, same roundToTwo and kopeck split:
  //   split(1002, [9, 14]) = 392.09 / 609.91; unit = round2((600 * qty + share) / qty) = 643.57 and 643.56.
  const h = t90Combined([[{ article: 'A', quantity: 9 }], [{ article: 'A', quantity: 14 }]], [391.3, 608.7], T90_BASE);
  const before = h.dumpOzonCost().length;
  const res = h.updateShipmentExtras({ id: t90Rows(h)[0].id, packagingMode: 'batch', packagingValue: 1002,
    otherMode: 'unit', otherValue: 0, services: [] }, 'tester');
  const added = h.dumpOzonCost().slice(before);
  const costOf = op => added.filter(r => r['OpID'] === op).map(r => r['Себестоимость отгрузки']);
  check('90t03: two orders with the same article and day get their own corrected journal unit cost',
    JSON.stringify(res.orders.map(o => o.newShare)) === '[392.09,609.91]'
      && JSON.stringify(costOf(`${T90_SHIP}-1`)) === '[643.57]' && JSON.stringify(costOf(`${T90_SHIP}-2`)) === '[643.56]',
    JSON.stringify(added));
})();

(function test90t03i() {
  // The journal write fails: the rows of «История» are still corrected and the result says so.
  const h = t90ThreeOrders();
  h.context.reissueOzonCostRows = function() { throw new Error('журнал недоступен'); };
  const res = h.updateShipmentExtras({ id: t90Rows(h)[0].id, ...t90Extras }, 'tester');
  check('90t03: a failing cost journal does not undo the correction and is reported in the result',
    res.newTotal === 2819 && t90Rows(h).every(t => t.destination.includes('Доставка x1 (2459₽)'))
      && res.costRowsAppended === 0 && res.costJournalError.includes('НЕ записана') && res.costJournalError.includes('журнал недоступен'),
    JSON.stringify(res.costJournalError));
  const h2 = t90ThreeOrders();
  const fine = h2.updateShipmentExtras({ id: t90Rows(h2)[0].id, ...t90Extras }, 'tester');
  check('90t03: a working journal gives an empty costJournalError', fine.costJournalError === '', JSON.stringify(fine.costJournalError));
})();

// ================= Item 81: module «Заказы в Китае» =================
//
// The fixtures are the two real batches the factory shipped: NV-0825-2 (order 28) and
// NV-0716-3 (order 27), taken from the carrier's own files on 22.09.2026. Every expected
// number below was worked out independently from the model, in Python, before the module
// was run: the stand proves the code agrees with the model, not with itself.
//
// NV-0825-2: 3 lines, 2 markings, 60 boxes, 672,5 kg, goods 9 744 ¥, local delivery 700 ¥,
//            freight 1 636,75 $ (672,5 × 2,3 + 90 packing).
// NV-0716-3: 5 lines, 3 markings, 70 boxes on 3 pallets, two tail lines with no weight,
//            1 001,5 kg, goods 13 050 ¥, local delivery 900 ¥, freight 2 438,45 $.

function withChina() {
  const h = freshHarness();
  h.setChinaSpreadsheet();
  h.setupChinaSpreadsheet();
  // Owner, 2026-09-24: deleteChinaBatch now archives to «Удаленное» in the MAIN database —
  // present unconditionally so every existing deletion test still has somewhere to archive to.
  h.ensureArchiveSheet();
  return h;
}

function batch28Lines() {
  return [
    { marking: 'NV-99', name: '收纳盒', boxes: 30, pcsPerBox: 8, qty: 240, priceCny: 20.3, pallet: '1', palletWeightKg: 339 },
    { marking: 'NV-99', name: '收纳盒', boxes: 15, pcsPerBox: 8, qty: 120, priceCny: 20.3 },
    { marking: 'NV-98', name: '收纳盒', boxes: 15, pcsPerBox: 8, qty: 120, priceCny: 20.3, pallet: '2', palletWeightKg: 333.5 }
  ];
}

function batch28() {
  return {
    orderNo: '28', code: 'NV-0825-2', shippedAt: '2026-08-27', arrivedAt: '2026-09-17', status: 'Прибыла',
    chinaDeliveryCny: 700, weightKg: 672.5, volumeM3: 4.92, ratePerKgUsd: 2.3, packingUsd: 90,
    freightUsd: 1636.75, cargoRate: 7, rubRate: 12.4, lines: batch28Lines()
  };
}

function batch27Lines() {
  return [
    { marking: 'NV-96', boxes: 16, pcsPerBox: 10, qty: 160, priceCny: 25, pallet: 'Паллета 1', palletWeightKg: 288.5 },
    { marking: 'NV-97', boxes: 24, pcsPerBox: 4, qty: 96, priceCny: 52, pallet: 'Паллета 2', palletWeightKg: 456 },
    { marking: 'NV-96', boxes: 4, pcsPerBox: 10, qty: 40, priceCny: 25 },
    { marking: 'NV-95', boxes: 25, pcsPerBox: 6, qty: 150, priceCny: 19, pallet: 'Паллета 3', palletWeightKg: 257 },
    { marking: 'NV-97', boxes: 1, pcsPerBox: 4, qty: 4, priceCny: 52 }
  ];
}

function batch27() {
  return {
    orderNo: '27', code: 'NV-0716-3', shippedAt: '2026-07-17', arrivedAt: '2026-08-21', status: 'Прибыла',
    chinaDeliveryCny: 900, weightKg: 1001.5, volumeM3: 7.41, ratePerKgUsd: 2.3, packingUsd: 135,
    freightUsd: 2438.45, cargoRate: 7, rubRate: 12.4, lines: batch27Lines()
  };
}

// ---- 81a: the spreadsheet of the module ----
(function () {
  const h = withChina();
  const names = h.targetSheetNames();
  check('81a: setup creates exactly the sheets of the module (81g-1 adds three: report ledger; item 82 adds two more)',
    JSON.stringify(names) === JSON.stringify(['Партии', 'Строки партий', 'Расходы партии', 'Платежи', 'Справочник',
      'Отчёты', 'Поступления', 'Движения заказов', 'Тарифы карго', 'Прогнозы']),
    names.join(', '));

  const batchHead = h.getTargetSheet('Партии').__dump()[0];
  check('81a: the batches sheet carries its own header row',
    JSON.stringify(batchHead) === JSON.stringify(h.CHINA_BATCH_HEADERS), JSON.stringify(batchHead));
  const lineHead = h.getTargetSheet('Строки партий').__dump()[0];
  check('81a: the lines sheet carries its own header row',
    JSON.stringify(lineHead) === JSON.stringify(h.CHINA_LINE_HEADERS), JSON.stringify(lineHead));

  check('81a: the directory is seeded with the carrier rate',
    h.getChinaSettings().cargoRateCnyPerUsd === 7, JSON.stringify(h.getChinaSettings()));

  // Idempotence: the module is set up on every entry into the tab.
  h.setupChinaSpreadsheet();
  h.setupChinaSpreadsheet();
  check('81a: a repeated setup adds no extra sheet', h.targetSheetNames().length === 10, h.targetSheetNames().join(', '));
  check('81a: a repeated setup adds no second directory row per default (3 defaults: carrier rate, transitDays, rubCostsPerBatch)',
    h.dumpChinaSheet('Справочник').length === 3, JSON.stringify(h.dumpChinaSheet('Справочник')));

  // Somebody clears the directory by hand: the rate must not silently become zero, or the
  // freight of every batch would turn into nothing.
  h.getTargetSheet('Справочник').deleteRow(2);
  check('81a: an emptied directory still answers with the carrier rate',
    h.getChinaSettings().cargoRateCnyPerUsd === 7, JSON.stringify(h.getChinaSettings()));
})();

(function () {
  const h = freshHarness();
  h.setChinaSpreadsheet();
  h.setTargetSheet('Лист1', [[]]);
  h.setupChinaSpreadsheet();
  check('81a: the empty sheet of a brand new spreadsheet is thrown out',
    h.targetSheetNames().indexOf('Лист1') === -1, h.targetSheetNames().join(', '));
})();

(function () {
  const h = freshHarness();
  h.setChinaSpreadsheet();
  h.setTargetSheet('Лист1', [['чужие данные']]);
  h.setupChinaSpreadsheet();
  check('81a: a sheet with data is never deleted, whatever it is called',
    h.getTargetSheet('Лист1') !== null, h.targetSheetNames().join(', '));
})();

(function () {
  const h = freshHarness();
  let msg = '';
  try { h.getChinaBatches(); } catch (e) { msg = e.message; }
  check('81a: without the script property the module says what is missing',
    msg.indexOf('china_spreadsheetId') !== -1, msg);

  h.setChinaSpreadsheet('no-such-spreadsheet');
  msg = '';
  try { h.getChinaBatches(); } catch (e) { msg = e.message; }
  check('81a: an unreachable spreadsheet is reported, not swallowed',
    msg.indexOf('недоступна') !== -1, msg);
})();

(function () {
  const h = freshHarness();
  const ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdE'; // a made-up id: the repository is public
  check('81a: a bare id is taken as it is', h.chinaIdFromSetting(ID) === ID, h.chinaIdFromSetting(ID));
  check('81a: the id is pulled out of a full link',
    h.chinaIdFromSetting('https://docs.google.com/spreadsheets/d/' + ID + '/edit?gid=0#gid=0') === ID,
    h.chinaIdFromSetting('https://docs.google.com/spreadsheets/d/' + ID + '/edit?gid=0#gid=0'));
  check('81a: spaces and line breaks around the id are ignored',
    h.chinaIdFromSetting('  ' + ID + '\n') === ID, '[' + h.chinaIdFromSetting('  ' + ID + '\n') + ']');
  check('81a: an empty property stays empty', h.chinaIdFromSetting('   ') === '', '[' + h.chinaIdFromSetting('   ') + ']');

  // The link taken from the browser's address bar works end to end.
  h.setChinaSpreadsheet('https://docs.google.com/spreadsheets/d/' + h.CHINA_SPREADSHEET_ID + '/edit#gid=0');
  h.setupChinaSpreadsheet();
  check('81a: the module sets itself up from a link pasted whole',
    h.targetSheetNames().length === 10, h.targetSheetNames().join(', '));
})();

// ---- 81a: splitting an amount ----
(function () {
  const h = withChina();
  const shares = h.chinaAllocate(17069.15, [264.44, 417.97, 66.11, 235.57, 17.42]);
  let sum = 0;
  shares.forEach(function (s) { sum = Math.round((sum + s) * 100) / 100; });
  check('81a: the shares of an amount add up to it exactly', sum === 17069.15, sum + ' :: ' + shares.join(' '));

  const withZero = h.chinaAllocate(100, [1, 0, 1]);
  check('81a: a line with a zero base gets nothing',
    withZero[1] === 0 && withZero[0] + withZero[2] === 100, withZero.join(' '));

  const thirds = h.chinaAllocate(100, [1, 1, 1]);
  check('81a: the rounding remainder lands on the largest base, never on a zero one',
    JSON.stringify(thirds) === JSON.stringify([33.34, 33.33, 33.33]), thirds.join(' '));

  // A negative number typed into a box or weight cell must not hand a line a negative share
  // of the freight; it counts as no base at all.
  const negative = h.chinaAllocate(100, [-5, 1, 1]);
  check('81a: a negative base gets nothing instead of a negative share',
    negative[0] === 0 && Math.round((negative[1] + negative[2]) * 100) / 100 === 100, negative.join(' '));

  const nothing = h.chinaAllocate(500, [0, 0]);
  check('81a: an amount with no base anywhere is not spread at all',
    JSON.stringify(nothing) === JSON.stringify([0, 0]), nothing.join(' '));
})();

// ---- 81a: the weight of a line ----
(function () {
  const h = withChina();
  const w = h.chinaLineWeights(batch28Lines(), 672.5);
  check('81a: the estimated weights are normalised to the weight of the waybill',
    Math.round(w.factor * 10000) / 10000 === 0.7987, String(w.factor));
  const kg = w.weights.map(function (x) { return Math.round(x * 100) / 100; });
  check('81a: batch 28 weighs 270,76 + 135,38 + 266,36 kg',
    JSON.stringify(kg) === JSON.stringify([270.76, 135.38, 266.36]), kg.join(' '));
  let sum = 0;
  w.weights.forEach(function (x) { sum += x; });
  check('81a: the normalised weights add up to the waybill', Math.round(sum * 100) / 100 === 672.5, String(sum));
  check('81a: a weight taken from the pallets says so',
    JSON.stringify(w.sources) === JSON.stringify(['паллета', 'паллета', 'паллета']), w.sources.join(' '));

  // A marking nobody weighed falls back to the average kilograms per box of the batch.
  const mixed = [
    { marking: 'NV-99', boxes: 30, qty: 240, palletWeightKg: 339 },
    { marking: 'NV-77', boxes: 10, qty: 80 }
  ];
  const wm = h.chinaLineWeights(mixed, 452);
  check('81a: a marking nobody weighed takes the average of the batch',
    wm.sources[1] === 'среднее по партии' && Math.round(wm.weights[1] * 100) / 100 === 113,
    wm.sources.join(' ') + ' :: ' + wm.weights.join(' '));

  // The file's own estimate can be visibly wrong; the weight of one box, typed by hand, wins.
  const manual = batch28Lines();
  manual[2].boxWeightKg = 10.93;
  const wh = h.chinaLineWeights(manual, 672.5);
  check('81a: a box weight typed by hand beats the estimate from the pallets',
    wh.sources[2] === 'вручную' && wh.weights[2] < wh.weights[0],
    wh.sources.join(' ') + ' :: ' + wh.weights.map(function (x) { return Math.round(x * 100) / 100; }).join(' '));

  // Without a single weight the freight would be split over zeros and vanish from the cost.
  const noWeight = h.chinaLineWeights([{ marking: 'A', boxes: 3, qty: 30 }, { marking: 'B', boxes: 1, qty: 10 }], 0);
  check('81a: with no weight anywhere the boxes become the base',
    JSON.stringify(noWeight.weights) === JSON.stringify([3, 1]) && noWeight.factor === null,
    noWeight.weights.join(' ') + ' factor=' + noWeight.factor);
  const noBoxes = h.chinaLineWeights([{ marking: 'A', qty: 30 }, { marking: 'B', qty: 10 }], 0);
  check('81a: with no boxes either the pieces become the base',
    JSON.stringify(noBoxes.weights) === JSON.stringify([30, 10]), noBoxes.weights.join(' '));
})();

// ---- 81a: the cost of a batch ----
(function () {
  const h = withChina();
  const b = batch28();
  const calc = h.chinaBatchCost(b, b.lines, 0, { cargoRateCnyPerUsd: 7 });

  check('81a: goods of batch 28 are 9 744 ¥ (the file states 10 444 with the local delivery)',
    calc.goodsCny === 9744, String(calc.goodsCny));
  check('81a: the freight of batch 28 is 1 636,75 $ → 11 457,25 ¥',
    calc.freightUsd === 1636.75 && calc.freightCny === 11457.25, calc.freightUsd + ' / ' + calc.freightCny);
  check('81a: the cost of batch 28 is 271 575,49 ₽', calc.totalRub === 271575.49, String(calc.totalRub));
  const units = calc.lines.map(function (l) { return l.unitRub; });
  check('81a: a piece of batch 28 costs 504,61 / 504,61 / 749,30 ₽',
    JSON.stringify(units) === JSON.stringify([504.61, 504.61, 749.30]), units.join(' '));
  let sum = 0;
  calc.lines.forEach(function (l) { sum = Math.round((sum + l.costRub) * 100) / 100; });
  check('81a: the cost of the batch is the sum of its lines, to the kopeck', sum === calc.totalRub, sum + ' vs ' + calc.totalRub);

  // The waybill total and the rate must tell the same story: 672,5 × 2,3 + 90 = 1 636,75.
  const rebuilt = h.chinaBatchCost(
    { chinaDeliveryCny: 700, weightKg: 672.5, ratePerKgUsd: 2.3, packingUsd: 90, cargoRate: 7, rubRate: 12.4 },
    b.lines, 0, { cargoRateCnyPerUsd: 7 });
  check('81a: without the waybill total the freight is rebuilt from the rate and agrees with it',
    rebuilt.freightUsd === 1636.75 && rebuilt.totalRub === calc.totalRub,
    rebuilt.freightUsd + ' / ' + rebuilt.totalRub);

  // When the carrier's own total and its rate disagree, the total on the waybill is the
  // money that was actually billed and it wins.
  const stated = h.chinaBatchCost(
    { chinaDeliveryCny: 700, weightKg: 672.5, ratePerKgUsd: 2.3, packingUsd: 90, freightUsd: 1700, cargoRate: 7, rubRate: 12.4 },
    b.lines, 0, { cargoRateCnyPerUsd: 7 });
  check('81a: the total on the waybill wins over the rate when the two disagree',
    stated.freightUsd === 1700 && stated.freightCny === 11900, stated.freightUsd + ' / ' + stated.freightCny);

  // A batch typed in without boxes still has to carry its Russian costs somewhere.
  const noBoxes = h.chinaBatchCost(
    { weightKg: 0, rubRate: 12.4 },
    [{ marking: 'A', qty: 30, priceCny: 1 }, { marking: 'B', qty: 10, priceCny: 1 }], 400, { cargoRateCnyPerUsd: 7 });
  check('81a: with no boxes at all the Russian costs are split by pieces',
    noBoxes.lines[0].rubShare === 300 && noBoxes.lines[1].rubShare === 100,
    noBoxes.lines[0].rubShare + ' / ' + noBoxes.lines[1].rubShare);

  // The carrier rate comes from the directory when the batch does not carry its own.
  const fromDirectory = h.chinaBatchCost(
    { chinaDeliveryCny: 700, weightKg: 672.5, freightUsd: 1636.75, rubRate: 12.4 },
    b.lines, 0, { cargoRateCnyPerUsd: 7 });
  check('81a: a batch with no rate of its own takes the one from the directory',
    fromDirectory.cargoRate === 7 && fromDirectory.freightCny === 11457.25, String(fromDirectory.freightCny));
})();

(function () {
  const h = withChina();
  const b = batch27();
  const calc = h.chinaBatchCost(b, b.lines, 9000, { cargoRateCnyPerUsd: 7 });

  check('81a: goods of batch 27 are 13 050 ¥ (the file states 13 950 with the local delivery)',
    calc.goodsCny === 13050, String(calc.goodsCny));
  check('81a: the pallets of batch 27 normalise by 0,9166', calc.weightFactor === 0.9166, String(calc.weightFactor));
  check('81a: the cost of batch 27 with 9 000 ₽ of unloading is 393 637,45 ₽',
    calc.totalRub === 393637.45, String(calc.totalRub));

  const rub = calc.lines.map(function (l) { return l.rubShare; });
  check('81a: the Russian costs are split by boxes: 16/24/4/25/1 of 70',
    JSON.stringify(rub) === JSON.stringify([2057.14, 3085.71, 514.29, 3214.29, 128.57]), rub.join(' '));
  let sum = 0;
  rub.forEach(function (x) { sum = Math.round((sum + x) * 100) / 100; });
  check('81a: the Russian costs are spread whole, to the kopeck', sum === 9000, String(sum));

  // The decisive difference between the two bases: line 4 is lighter than line 2 and still
  // carries more of the unloading, because it arrived in more boxes.
  check('81a: unloading follows the boxes, not the weight',
    calc.lines[3].weightKg < calc.lines[1].weightKg && calc.lines[3].rubShare > calc.lines[1].rubShare,
    calc.lines[3].weightKg + ' kg / ' + calc.lines[3].rubShare + ' ₽ against ' +
    calc.lines[1].weightKg + ' kg / ' + calc.lines[1].rubShare + ' ₽');

  // The freight, on the other hand, follows the weight.
  check('81a: the freight follows the weight, not the boxes',
    calc.lines[1].freightShareCny > calc.lines[3].freightShareCny,
    calc.lines[1].freightShareCny + ' vs ' + calc.lines[3].freightShareCny);

  const noCosts = h.chinaBatchCost(b, b.lines, 0, { cargoRateCnyPerUsd: 7 });
  check('81a: 9 000 ₽ of unloading raise the cost of the batch by exactly 9 000 ₽',
    Math.round((calc.totalRub - noCosts.totalRub) * 100) / 100 === 9000,
    calc.totalRub + ' - ' + noCosts.totalRub);
})();

// ---- 81a: one product, one cost ----
//
// Addition from the owner, 2026-09-22: the same goods split over several pallets must end
// with ONE cost, and goods that differ only in colour must be levelled once our own article
// has been written against them. Both are the same rule — the article, not the carrier's
// marking, says what the goods are.
(function () {
  const h = withChina();
  const lines = batch28Lines();
  lines.forEach(function (l) { l.article = 'BOX'; });
  const b = batch28();
  const calc = h.chinaBatchCost(b, lines, 0, { cargoRateCnyPerUsd: 7 });

  check('81a: two markings of one article weigh the same per box',
    calc.lines[0].weightKg === 336.25 && calc.lines[1].weightKg === 168.13 && calc.lines[2].weightKg === 168.13,
    calc.lines.map(function (l) { return l.weightKg; }).join(' '));
  const units = calc.lines.map(function (l) { return l.unitRub; });
  check('81a: one article costs the same per piece on every line',
    JSON.stringify(units) === JSON.stringify([565.78, 565.78, 565.78]), units.join(' '));
  check('81a: levelling does not move the cost of the batch',
    calc.totalRub === 271575.49, String(calc.totalRub));
  let sum = 0;
  calc.lines.forEach(function (l) { sum = Math.round((sum + l.costRub) * 100) / 100; });
  check('81a: the levelled lines still add up to the batch, to the kopeck',
    sum === calc.totalRub, sum + ' vs ' + calc.totalRub);

  // Without the article the carrier's marking still rules, and the estimate by pallets gives
  // the two markings different weights — that is the case the levelling exists for.
  const raw = h.chinaBatchCost(b, batch28Lines(), 0, { cargoRateCnyPerUsd: 7 });
  check('81a: without an article the two markings are costed apart',
    raw.lines[0].unitRub === 504.61 && raw.lines[2].unitRub === 749.3,
    raw.lines[0].unitRub + ' / ' + raw.lines[2].unitRub);
})();

(function () {
  const h = withChina();
  // Two articles of their own must NOT be levelled into one another.
  const lines = batch28Lines();
  lines[0].article = 'BOX-WHITE';
  lines[1].article = 'BOX-WHITE';
  lines[2].article = 'BOX-GREY';
  const calc = h.chinaBatchCost(batch28(), lines, 0, { cargoRateCnyPerUsd: 7 });
  check('81a: two different articles keep two different costs',
    calc.lines[0].unitRub === calc.lines[1].unitRub && calc.lines[0].unitRub !== calc.lines[2].unitRub,
    calc.lines.map(function (l) { return l.unitRub; }).join(' '));

  // The same article bought at two prices is levelled to one cost per piece.
  const twoPrices = [
    { marking: 'NV-96', boxes: 16, qty: 160, priceCny: 25, palletWeightKg: 288.5, article: 'BOX' },
    { marking: 'NV-96', boxes: 4, qty: 40, priceCny: 30, article: 'BOX' }
  ];
  const mixed = h.chinaBatchCost({ weightKg: 360.6, freightUsd: 100, cargoRate: 7, rubRate: 12.4 },
    twoPrices, 0, { cargoRateCnyPerUsd: 7 });
  check('81a: one article bought at two prices ends with one cost per piece',
    mixed.lines[0].unitRub === mixed.lines[1].unitRub, mixed.lines.map(function (l) { return l.unitRub; }).join(' '));
  const groupTotal = Math.round((mixed.lines[0].costRub + mixed.lines[1].costRub) * 100) / 100;
  check('81a: levelling two prices keeps the money of the group whole',
    groupTotal === mixed.totalRub, groupTotal + ' vs ' + mixed.totalRub);
})();

(function () {
  const h = freshHarness();
  h.setChinaSpreadsheet();
  h.setupChinaSpreadsheet();
  check('81a: a spreadsheet left with the default name is named by the module',
    h.targetSpreadsheetName() === 'Заказы в Китае', h.targetSpreadsheetName());

  const own = freshHarness();
  own.setChinaSpreadsheet();
  own.setTargetSpreadsheetName('Китай 2026');
  own.setupChinaSpreadsheet();
  check('81a: a name the owner chose himself is left alone',
    own.targetSpreadsheetName() === 'Китай 2026', own.targetSpreadsheetName());
})();

(function () {
  const h = withChina();
  // The same box in two colours: two articles of ours, tied together by hand because
  // nothing in the data could tell that they are one product (owner, 2026-09-22).
  const lines = batch28Lines();
  lines[0].article = 'BOX-WHITE'; lines[0].group = 'короб 8 шт';
  lines[1].article = 'BOX-WHITE'; lines[1].group = 'короб 8 шт';
  lines[2].article = 'BOX-GREY';  lines[2].group = 'короб 8 шт';
  const calc = h.chinaBatchCost(batch28(), lines, 0, { cargoRateCnyPerUsd: 7 });

  const units = calc.lines.map(function (l) { return l.unitRub; });
  check('81a: two colours marked as one product cost the same per piece',
    JSON.stringify(units) === JSON.stringify([565.78, 565.78, 565.78]), units.join(' '));
  check('81a: marking two colours as one product weighs them the same per box',
    calc.lines[2].weightKg === 168.13, String(calc.lines[2].weightKg));
  check('81a: marking two colours as one product does not move the batch total',
    calc.totalRub === 271575.49, String(calc.totalRub));

  // The marker is stronger than the article: it exists exactly for lines whose articles differ.
  const own = batch28Lines();
  own[0].article = 'BOX-WHITE'; own[1].article = 'BOX-WHITE'; own[2].article = 'BOX-GREY';
  const apart = h.chinaBatchCost(batch28(), own, 0, { cargoRateCnyPerUsd: 7 });
  check('81a: without the marker two articles are still costed apart',
    apart.lines[0].unitRub !== apart.lines[2].unitRub,
    apart.lines.map(function (l) { return l.unitRub; }).join(' '));
})();

(function () {
  const h = withChina();
  const b = batch28();
  b.lines[0].article = 'BOX-WHITE'; b.lines[0].group = 'короб 8 шт';
  b.lines[2].article = 'BOX-GREY';  b.lines[2].group = 'короб 8 шт';
  h.saveChinaBatch(b, 'Николай');
  const rows = h.dumpChinaSheet('Строки партий');
  check('81a: the article and the same-product marker survive a round trip through the sheet',
    rows[0]['Наш артикул'] === 'BOX-WHITE' && rows[2]['Один товар'] === 'короб 8 шт' &&
    Number(rows[0]['Себестоимость ₽/шт']) === Number(rows[2]['Себестоимость ₽/шт']),
    JSON.stringify(rows.map(function (r) { return r['Наш артикул'] + '/' + r['Один товар'] + '/' + r['Себестоимость ₽/шт']; })));

  // A recalculation reads the lines back out of the sheet. The marker has to survive that
  // trip too, or adding a cost would quietly take the levelling away.
  h.saveChinaBatchCost({ batchId: 'CB1', kind: 'Разгрузка', amountRub: 6000 }, 'Николай');
  const after = h.dumpChinaSheet('Строки партий');
  check('81a: the levelling survives a recalculation after an added cost',
    Number(after[0]['Себестоимость ₽/шт']) === Number(after[2]['Себестоимость ₽/шт']),
    after.map(function (r) { return r['Себестоимость ₽/шт']; }).join(' '));
})();

// ---- 81a: the whole path through the sheets ----
(function () {
  const h = withChina();
  const saved = h.saveChinaBatch(batch28(), 'Николай');
  check('81a: a saved batch comes back from the sheet', saved.batches.length === 1, String(saved.batches.length));

  const row = h.dumpChinaSheet('Партии')[0];
  check('81a: the batch row holds the money the script computed',
    row['Себестоимость партии ₽'] === 271575.49 && row['Перевозка ¥'] === 11457.25 && row['Товар ¥'] === 9744,
    JSON.stringify(row));
  check('81a: the batch row keeps who saved it and when',
    String(row['Кто']) === 'Николай' && String(row['Обновлено']).indexOf('2026-01-05') === 0,
    row['Кто'] + ' / ' + row['Обновлено']);

  const lines = h.dumpChinaSheet('Строки партий');
  check('81a: three lines are written, with their own ids', lines.length === 3 && lines[0]['ID'] === 'CB1-1', String(lines.length));
  check('81a: a line row holds its piece of the freight and its cost per piece',
    lines[2]['Перевозка ¥'] === 4538 && lines[2]['Себестоимость ₽/шт'] === 749.3, JSON.stringify(lines[2]));
  let sum = 0;
  lines.forEach(function (l) { sum = Math.round((sum + Number(l['Себестоимость ₽'])) * 100) / 100; });
  check('81a: the batch total in the sheet is the sum of the line costs in the sheet',
    sum === Number(row['Себестоимость партии ₽']), sum + ' vs ' + row['Себестоимость партии ₽']);

  // An edit must replace the lines of the batch, not lay a second set beside them.
  const again = batch28();
  again.id = 'CB1';
  again.lines = batch28Lines().slice(0, 2);
  h.saveChinaBatch(again, 'Николай');
  check('81a: an edited batch replaces its lines instead of doubling them',
    h.dumpChinaSheet('Партии').length === 1 && h.dumpChinaSheet('Строки партий').length === 2,
    h.dumpChinaSheet('Партии').length + ' / ' + h.dumpChinaSheet('Строки партий').length);

  // A second batch must not disturb the first.
  h.saveChinaBatch(batch27(), 'Николай');
  const all = h.dumpChinaSheet('Строки партий');
  check('81a: a second batch leaves the lines of the first alone',
    all.filter(function (l) { return l['ПартияID'] === 'CB1'; }).length === 2 &&
    all.filter(function (l) { return l['ПартияID'] === 'CB2'; }).length === 5, String(all.length));

  // The module lives in its own spreadsheet: the warehouse database must stay untouched.
  check('81a: nothing of the module is written into the warehouse database',
    h.dumpStockSheet() === null && h.dumpTransSheet().length === 0,
    JSON.stringify(h.dumpTransSheet()));
})();

// ---- 81a: the Russian costs of a batch ----
(function () {
  const h = withChina();
  h.saveChinaBatch(batch27(), 'Николай');
  const before = Number(h.dumpChinaSheet('Партии')[0]['Себестоимость партии ₽']);

  h.saveChinaBatchCost({ batchId: 'CB1', date: '2026-08-22', kind: 'Разгрузка', amountRub: 9000 }, 'Николай');
  const after = Number(h.dumpChinaSheet('Партии')[0]['Себестоимость партии ₽']);
  check('81a: an added cost is recomputed into the batch at once',
    after === 393637.45 && Math.round((after - before) * 100) / 100 === 9000, before + ' → ' + after);
  check('81a: the cost row is stored with its kind and its author',
    h.dumpChinaSheet('Расходы партии')[0]['Тип'] === 'Разгрузка' &&
    h.dumpChinaSheet('Расходы партии')[0]['ID'] === 'CC1',
    JSON.stringify(h.dumpChinaSheet('Расходы партии')[0]));

  const shares = h.dumpChinaSheet('Строки партий').map(function (l) { return Number(l['Расходы РФ ₽']); });
  check('81a: the cost reaches the lines split by boxes',
    JSON.stringify(shares) === JSON.stringify([2057.14, 3085.71, 514.29, 3214.29, 128.57]), shares.join(' '));

  h.deleteChinaBatchCost({ id: 'CC1' }, 'Николай');
  check('81a: a deleted cost is taken back out of the batch',
    Number(h.dumpChinaSheet('Партии')[0]['Себестоимость партии ₽']) === before &&
    h.dumpChinaSheet('Расходы партии').length === 0,
    String(h.dumpChinaSheet('Партии')[0]['Себестоимость партии ₽']));
})();

(function () {
  const h = withChina();
  h.saveChinaBatch(batch28(), 'Николай');
  h.saveChinaBatch(batch27(), 'Николай');
  h.saveChinaBatchCost({ batchId: 'CB2', kind: 'Доставка до склада', amountRub: 5000 }, 'Николай');

  h.deleteChinaBatch({ id: 'CB2' }, 'Николай');
  check('81a: a deleted batch takes its lines and its costs with it',
    h.dumpChinaSheet('Партии').length === 1 &&
    h.dumpChinaSheet('Строки партий').filter(function (l) { return l['ПартияID'] === 'CB2'; }).length === 0 &&
    h.dumpChinaSheet('Расходы партии').length === 0,
    JSON.stringify(h.dumpChinaSheet('Партии').map(function (b) { return b['ID']; })));
  check('81a: the batch that was not deleted keeps all of its lines',
    h.dumpChinaSheet('Строки партий').length === 3, String(h.dumpChinaSheet('Строки партий').length));
})();

// ---- 81d: payments and the rate they set ----
//
// The owner buys yuan for rubles in cash and says so in a message; the report of the Chinese
// side confirms how many yuan arrived and against WHICH ORDER they were put. Two of the three
// figures are therefore always known, and the third follows.

function batch28Payload(over) {
  const b = batch28();
  const out = { orderNo: '28', code: b.code, status: b.status, chinaDeliveryCny: 700, weightKg: 672.5,
    ratePerKgUsd: 2.3, packingUsd: 90, freightUsd: 1636.75, cargoRate: 7, rubRate: 12.4, lines: batch28Lines() };
  Object.keys(over || {}).forEach(function (k) { out[k] = over[k]; });
  return out;
}

(function () {
  const h = withChina();
  check('81d: the rate stated in a message gives the yuan it bought',
    JSON.stringify(h.chinaPaymentMoney(100000, 12.4, 0)) === JSON.stringify({ amountRub: 100000, rate: 12.4, amountCny: 8064.52 }),
    JSON.stringify(h.chinaPaymentMoney(100000, 12.4, 0)));
  check('81d: the yuan the report confirms give the rate',
    JSON.stringify(h.chinaPaymentMoney(100000, 0, 8064.52)) === JSON.stringify({ amountRub: 100000, rate: 12.4, amountCny: 8064.52 }),
    JSON.stringify(h.chinaPaymentMoney(100000, 0, 8064.52)));
  check('81d: a rate and a sum that agree are both kept',
    h.chinaPaymentMoney(100000, 12.4, 8064.52).rate === 12.4, JSON.stringify(h.chinaPaymentMoney(100000, 12.4, 8064.52)));

  function refuses(name, fn, fragment) {
    let msg = '';
    try { fn(); } catch (e) { msg = e.message; }
    check(name, msg.indexOf(fragment) !== -1, msg || 'прошло без ошибки');
  }
  refuses('81d: a rate and a sum that disagree are refused, not averaged',
    function () { h.chinaPaymentMoney(100000, 12.4, 9000); }, 'не сходятся');
  refuses('81d: a payment with neither a rate nor a sum in yuan is refused',
    function () { h.chinaPaymentMoney(100000, 0, 0); }, 'Укажите курс');
  refuses('81d: a payment of nothing is refused',
    function () { h.chinaPaymentMoney(0, 12.4, 0); }, 'больше нуля');

  check('81d: two tranches give the weighted rate of the order, not the last one',
    h.chinaRateFromPayments([
      { orderNo: '28', amountRub: 100000, amountCny: 8064.52 },
      { orderNo: '28', amountRub: 50000, amountCny: 3846.15 },
      { orderNo: '29', amountRub: 999999, amountCny: 1 }
    ], '28') === 12.5937,
    String(h.chinaRateFromPayments([
      { orderNo: '28', amountRub: 100000, amountCny: 8064.52 },
      { orderNo: '28', amountRub: 50000, amountCny: 3846.15 },
      { orderNo: '29', amountRub: 999999, amountCny: 1 }
    ], '28')));
  check('81d: an order nobody paid for has no rate of its own',
    h.chinaRateFromPayments([{ orderNo: '29', amountRub: 1000, amountCny: 100 }], '28') === 0 &&
    h.chinaRateFromPayments([{ orderNo: '', amountRub: 1000, amountCny: 100 }], '') === 0, 'нет курса');
})();

(function () {
  const h = withChina();
  h.saveChinaBatch(batch28Payload({ paidCny: 10444, unpaidCny: 0 }), 'Николай');
  let row = h.dumpChinaSheet('Партии')[0];
  check('81d: with no payments the batch is costed at the rate typed by hand',
    Number(row['Курс ₽/¥']) === 12.4 && row['Источник курса'] === 'вручную' &&
    Number(row['Себестоимость партии ₽']) === 271575.49,
    row['Курс ₽/¥'] + ' / ' + row['Источник курса'] + ' / ' + row['Себестоимость партии ₽']);
  check('81d: what the report says about the order is kept beside the batch',
    Number(row['Оплачено по отчёту ¥']) === 10444 && String(row['Долг по отчёту ¥']) === '',
    row['Оплачено по отчёту ¥'] + ' / ' + row['Долг по отчёту ¥']);

  h.saveChinaPayment({ date: '2026-08-27', amountRub: 100000, rate: 12.4, orderNo: '28', purpose: 'Товар', confirmed: true }, 'Николай');
  const payment = h.dumpChinaSheet('Платежи')[0];
  check('81d: the payment is stored with its yuan, its order and its confirmation',
    payment['ID'] === 'CP1' && Number(payment['Куплено ¥']) === 8064.52 &&
    payment['Номер заказа'] === '28' && payment['Подтверждено'] === 'да' && payment['Кто'] === 'Николай',
    JSON.stringify(payment));

  row = h.dumpChinaSheet('Партии')[0];
  check('81d: a payment of the order takes over the rate of the batch',
    row['Источник курса'] === 'оплаты' && Number(row['Курс ₽/¥']) === 12.4,
    row['Источник курса'] + ' / ' + row['Курс ₽/¥']);

  // The second tranche is bought at another rate, as cash always is.
  h.saveChinaPayment({ date: '2026-09-01', amountRub: 50000, rate: 13, orderNo: '28', purpose: 'Товар' }, 'Николай');
  row = h.dumpChinaSheet('Партии')[0];
  check('81d: the second tranche moves the batch to the weighted rate 12,5937',
    Number(row['Курс ₽/¥']) === 12.5937 && Number(row['Себестоимость партии ₽']) === 275817.77,
    row['Курс ₽/¥'] + ' / ' + row['Себестоимость партии ₽']);

  const lines = h.dumpChinaSheet('Строки партий');
  let sum = 0;
  lines.forEach(function (l) { sum = Math.round((sum + Number(l['Себестоимость ₽'])) * 100) / 100; });
  check('81d: the lines of the batch follow the new rate to the kopeck',
    sum === Number(row['Себестоимость партии ₽']), sum + ' vs ' + row['Себестоимость партии ₽']);

  h.deleteChinaPayment({ id: 'CP2' }, 'Николай');
  row = h.dumpChinaSheet('Партии')[0];
  check('81d: deleting a tranche returns the batch to the rate of what is left',
    Number(row['Курс ₽/¥']) === 12.4 && Number(row['Себестоимость партии ₽']) === 271575.49,
    row['Курс ₽/¥'] + ' / ' + row['Себестоимость партии ₽']);

  h.deleteChinaPayment({ id: 'CP1' }, 'Николай');
  row = h.dumpChinaSheet('Партии')[0];
  check('81d: with the last payment gone the rate typed by hand comes back',
    row['Источник курса'] === 'вручную' && Number(row['Курс ₽/¥']) === 12.4 &&
    h.dumpChinaSheet('Платежи').length === 0,
    row['Источник курса'] + ' / ' + row['Курс ₽/¥']);
})();

(function () {
  const h = withChina();
  h.saveChinaBatch(batch28Payload({}), 'Николай');
  h.saveChinaBatch(batch28Payload({ orderNo: '27', code: 'NV-0716-3', lines: batch27Lines(),
    chinaDeliveryCny: 900, weightKg: 1001.5, packingUsd: 135, freightUsd: 2438.45 }), 'Николай');
  h.saveChinaPayment({ amountRub: 100000, rate: 12.4, orderNo: '28' }, 'Николай');

  const before = h.dumpChinaSheet('Партии').map(function (b) { return b['Источник курса']; });
  check('81d: a payment touches only the batches of its own order',
    before[0] === 'оплаты' && before[1] === 'вручную', before.join(' / '));

  // Moving the payment to the other order has to re-cost BOTH of them.
  h.saveChinaPayment({ id: 'CP1', amountRub: 100000, rate: 11, orderNo: '27' }, 'Николай');
  const after = h.dumpChinaSheet('Партии');
  check('81d: a payment moved to another order re-costs the order it left',
    after[0]['Источник курса'] === 'вручную' && Number(after[0]['Курс ₽/¥']) === 12.4,
    after[0]['Источник курса'] + ' / ' + after[0]['Курс ₽/¥']);
  check('81d: and re-costs the order it arrived at',
    after[1]['Источник курса'] === 'оплаты' && Number(after[1]['Курс ₽/¥']) === 11,
    after[1]['Источник курса'] + ' / ' + after[1]['Курс ₽/¥']);

  let msg = '';
  try { h.saveChinaPayment({ amountRub: 1000, rate: 12, purpose: 'Таможня' }, 'Николай'); } catch (e) { msg = e.message; }
  check('81d: a purpose the module does not know is refused', msg.indexOf('Неизвестное назначение') !== -1, msg);
  msg = '';
  try { h.deleteChinaPayment({ id: 'CP404' }, 'Николай'); } catch (e) { msg = e.message; }
  check('81d: deleting a payment that is not there is refused', msg.indexOf('не найдена') !== -1, msg);
  msg = '';
  try { h.saveChinaPayment({ id: 'CP404', amountRub: 1000, rate: 12 }, 'Николай'); } catch (e) { msg = e.message; }
  check('81d: editing a payment that is not there is refused', msg.indexOf('не найдена') !== -1, msg);
})();

(function () {
  const h = withChina();
  h.saveChinaBatch(batch28Payload({}), 'Николай');
  h.saveChinaPayment({ amountRub: 100000, rate: 12.4, orderNo: '28' }, 'Николай');
  const state = h.getChinaBatches();
  check('81d: the module answers with its payments and hangs them on their batch',
    state.payments.length === 1 && state.batches[0].payments.length === 1 &&
    state.batches[0].payments[0].amountCny === 8064.52,
    JSON.stringify(state.payments));
  check('81d: a payment without an order hangs on no batch at all',
    (function () {
      h.saveChinaPayment({ amountRub: 5000, rate: 12.4 }, 'Николай');
      const again = h.getChinaBatches();
      return again.payments.length === 2 && again.batches[0].payments.length === 1;
    })(), 'оплата без заказа');
})();

// ---- 81a: what the module refuses ----
(function () {
  const h = withChina();
  function refuses(name, fn, fragment) {
    let msg = '';
    try { fn(); } catch (e) { msg = e.message; }
    check(name, msg.indexOf(fragment) !== -1, msg || 'прошло без ошибки');
  }

  refuses('81a: a batch with no lines is refused', function () {
    const b = batch28(); b.lines = []; h.saveChinaBatch(b, 'Николай');
  }, 'нет ни одной строки');
  refuses('81a: a line with no marking is refused', function () {
    const b = batch28(); b.lines[0].marking = ''; h.saveChinaBatch(b, 'Николай');
  }, 'не указана маркировка');
  refuses('81a: a line with no quantity is refused', function () {
    const b = batch28(); b.lines[1].qty = 0; h.saveChinaBatch(b, 'Николай');
  }, 'количество должно быть больше нуля');
  refuses('81a: an unknown status is refused', function () {
    const b = batch28(); b.status = 'Прилетела'; h.saveChinaBatch(b, 'Николай');
  }, 'Неизвестный статус');
  refuses('81a: a date in another format is refused', function () {
    const b = batch28(); b.shippedAt = '27.08.2026'; h.saveChinaBatch(b, 'Николай');
  }, 'ГГГГ-ММ-ДД');
  refuses('81a: a date with the right year and the wrong shape is refused', function () {
    const bb = batch28(); bb.arrivedAt = '2026/09/17'; h.saveChinaBatch(bb, 'Николай');
  }, 'ГГГГ-ММ-ДД');
  refuses('81a: an edit of a batch that is not there is refused', function () {
    const b = batch28(); b.id = 'CB404'; h.saveChinaBatch(b, 'Николай');
  }, 'не найдена');
  refuses('81a: a cost of an unknown kind is refused', function () {
    h.saveChinaBatchCost({ batchId: 'CB1', kind: 'Таможня', amountRub: 100 }, 'Николай');
  }, 'Неизвестный тип расхода');
  refuses('81a: a cost of zero is refused', function () {
    h.saveChinaBatchCost({ batchId: 'CB1', kind: 'Прочее', amountRub: 0 }, 'Николай');
  }, 'больше нуля');
})();

// ================= Item 81, review of 2026-09-24 =================
//
// Every check below was written against a defect the review reproduced first. None of them
// could be seen by the checks above, because every one of those starts from a spreadsheet
// the CURRENT code has just created — while the owner's live spreadsheet was set up on
// Code.gs 183 and holds the header rows of item 81a.

const OLD_BATCH_HEADERS = ['ID', 'Номер заказа', 'Код партии', 'Дата отгрузки', 'Дата прибытия', 'Статус',
  'Товар ¥', 'Доставка по Китаю ¥', 'Вес накладной, кг', 'Объём, м³', 'Ставка $/кг', 'Упаковка $',
  'Прочее карго $', 'Перевозка $', 'Курс ¥/$', 'Перевозка ¥', 'Расходы РФ ₽', 'Курс ₽/¥',
  'Себестоимость партии ₽', 'Коэффициент веса', 'Комментарий', 'Кто', 'Обновлено'];
const OLD_PAYMENT_HEADERS = ['ID', 'Дата', 'Сумма ₽', 'Курс ₽/¥', 'Куплено ¥', 'Назначение', 'Комментарий', 'Кто'];

// The live spreadsheet as it stands: set up by the old code, possibly with a batch saved by
// hand on Cloud Run sklad-00080 (item 81b), before any of the columns added since.
function withOldChina(withBatch) {
  const h = freshHarness();
  h.setChinaSpreadsheet();
  const batchRows = [OLD_BATCH_HEADERS.slice()];
  if (withBatch) {
    const row = OLD_BATCH_HEADERS.map(function () { return ''; });
    const put = function (name, value) { row[OLD_BATCH_HEADERS.indexOf(name)] = value; };
    put('ID', 'CB1'); put('Номер заказа', '28'); put('Код партии', 'NV-0825-2'); put('Статус', 'Прибыла');
    put('Доставка по Китаю ¥', 700); put('Вес накладной, кг', 672.5); put('Перевозка $', 1636.75);
    put('Курс ¥/$', 7); put('Курс ₽/¥', 12.4); put('Себестоимость партии ₽', 271575.49);
    put('Комментарий', 'внесена вручную'); put('Кто', 'Николай');
    batchRows.push(row);
  }
  h.setTargetSheet('Партии', batchRows);
  h.setTargetSheet('Платежи', [OLD_PAYMENT_HEADERS.slice()]);
  h.setupChinaSpreadsheet();
  if (withBatch) {
    // The lines of that batch, as 81b wrote them: its header row already had «Один товар».
    const lineHead = h.CHINA_LINE_HEADERS;
    const lineRows = [lineHead.slice()];
    batch28Lines().forEach(function (l, i) {
      const row = lineHead.map(function () { return ''; });
      const put = function (name, value) { row[lineHead.indexOf(name)] = value; };
      put('ID', 'CB1-' + (i + 1)); put('ПартияID', 'CB1'); put('Маркировка', l.marking);
      put('Коробок', l.boxes); put('Шт/коробку', l.pcsPerBox); put('Количество', l.qty);
      put('Цена ¥', l.priceCny); put('Вес паллеты, кг', l.palletWeightKg || '');
      lineRows.push(row);
    });
    h.setTargetSheet('Строки партий', lineRows);
  }
  return h;
}

(function () {
  const h = withOldChina(false);
  const head = h.headerRowOf(h.getTargetSheet('Партии'));
  check('review: the newer columns are added at the END of an old sheet, not in their code order',
    head.indexOf('Себестоимость партии ₽') === 18 && head.indexOf('Курс вручную') > head.indexOf('Обновлено'),
    head.slice(17).join(' | '));

  h.saveChinaBatch(batch28Payload({ paidCny: 10444, comment: 'из файла' }), 'Николай');
  const raw = h.getTargetSheet('Партии').__dump();
  const cell = function (name) { return raw[1][raw[0].indexOf(name)]; };
  check('review: on an old sheet every value lands under its own header',
    cell('Себестоимость партии ₽') === 271575.49 && cell('Кто') === 'Николай' &&
    cell('Комментарий') === 'из файла' && cell('Источник курса') === 'вручную' &&
    cell('Оплачено по отчёту ¥') === 10444 && cell('Коэффициент веса') === 0.7987,
    JSON.stringify(raw[1]));

  const back = h.getChinaBatches().batches[0];
  check('review: and reads back as it was written',
    back.totalRub === 271575.49 && back.user === 'Николай' && back.comment === 'из файла' && back.manualRate === 12.4,
    JSON.stringify({ totalRub: back.totalRub, user: back.user, comment: back.comment, manualRate: back.manualRate }));

  h.saveChinaPayment({ date: '2026-08-27', amountRub: 100000, rate: 12.4, orderNo: '28', comment: 'аванс 30%' }, 'Николай');
  const pay = h.dumpChinaSheet('Платежи')[0];
  check('review: a payment on the old payments sheet keeps its order and its comment apart',
    pay['Номер заказа'] === '28' && pay['Комментарий'] === 'аванс 30%' && pay['Кто'] === 'Николай' &&
    pay['Куплено ¥'] === 8064.52,
    JSON.stringify(pay));
})();

(function () {
  const h = withOldChina(true);
  const before = h.getChinaBatches().batches[0];
  check('review: a batch saved before the typed rate had a column of its own keeps that rate',
    before.manualRate === 12.4 && before.rubRate === 12.4, before.manualRate + ' / ' + before.rubRate);

  // The first thing the new code does to it: a payment that re-costs it, then goes away.
  h.saveChinaPayment({ amountRub: 100000, rate: 11, orderNo: '28' }, 'Николай');
  h.deleteChinaPayment({ id: 'CP1' }, 'Николай');
  const after = h.getChinaBatches().batches[0];
  check('review: an old batch comes back to its own typed rate and cost after a payment comes and goes',
    after.rubRate === 12.4 && after.rubRateSource === 'вручную' && after.totalRub === 271575.49 &&
    after.comment === 'внесена вручную',
    JSON.stringify({ rubRate: after.rubRate, src: after.rubRateSource, totalRub: after.totalRub, comment: after.comment }));
})();

(function () {
  const h = withChina();
  h.saveChinaBatch(batch28Payload({}), 'Николай');
  const rates = function () {
    const r = h.dumpChinaSheet('Партии')[0];
    return [Number(r['Курс ₽/¥']), Number(r['Курс вручную']), r['Источник курса'], Number(r['Себестоимость партии ₽'])];
  };
  // A payment at a rate DIFFERENT from the typed one: the checks of 81d used 12,4 for both,
  // which is exactly why they could not see the typed rate being lost.
  h.saveChinaPayment({ amountRub: 100000, rate: 11, orderNo: '28' }, 'Николай');
  check('review: a payment at another rate costs the batch at the rate of the payment',
    JSON.stringify(rates()) === JSON.stringify([11, 12.4, 'оплаты', 240913.75]), JSON.stringify(rates()));
  check('review: while the payment is on, the window still offers the rate the owner typed',
    h.getChinaBatches().batches[0].manualRate === 12.4, String(h.getChinaBatches().batches[0].manualRate));

  // Saving the batch from the window while the payment is on must not turn 11 into «typed».
  h.saveChinaBatch(batch28Payload({ id: 'CB1', rubRate: h.getChinaBatches().batches[0].manualRate }), 'Николай');
  h.deleteChinaPayment({ id: 'CP1' }, 'Николай');
  check('review: with the payment gone the typed 12,4 and its 271 575,49 ₽ come back',
    JSON.stringify(rates()) === JSON.stringify([12.4, 12.4, 'вручную', 271575.49]), JSON.stringify(rates()));
})();

(function () {
  const h = withChina();
  h.saveChinaBatch(batch28Payload({}), 'Николай');
  h.saveChinaBatch(batch28Payload({ orderNo: '27', code: 'NV-0716-3', lines: batch27Lines(),
    chinaDeliveryCny: 900, weightKg: 1001.5, packingUsd: 135, freightUsd: 2438.45 }), 'Николай');

  // A failure in the middle of rewriting the lines: the write of the new table breaks.
  const sheet = h.getTargetSheet('Строки партий');
  const realGetRange = sheet.getRange;
  sheet.getRange = function (row, col, rows, cols) {
    const range = realGetRange.call(sheet, row, col, rows, cols);
    if (rows > 1) range.setValues = function () { throw new Error('Service invoked too many times'); };
    return range;
  };
  let failed = '';
  try { h.saveChinaBatch(batch28Payload({ id: 'CB1' }), 'Николай'); } catch (e) { failed = e.message; }
  sheet.getRange = realGetRange;
  const left = h.dumpChinaSheet('Строки партий');
  check('review: a write that fails half way leaves the lines of every batch in place',
    failed.indexOf('too many') !== -1 && left.length === 8 &&
    left.filter(function (l) { return l['ПартияID'] === 'CB2'; }).length === 5,
    failed + ' :: ' + left.length);
})();

(function () {
  // The owner typed NO rate: the batch was imported, and payments gave it its rate. When the
  // only payment goes, the batch must be left without a rate — not keep the payment's rate
  // and call it typed.
  const h = withChina();
  h.saveChinaBatch(batch28Payload({ rubRate: 0 }), 'Николай');
  h.saveChinaPayment({ amountRub: 100000, rate: 11, orderNo: '28' }, 'Николай');
  const paid = h.getChinaBatches().batches[0];
  h.deleteChinaPayment({ id: 'CP1' }, 'Николай');
  const after = h.getChinaBatches().batches[0];
  check('review: a batch whose only rate came from a payment has no rate once the payment goes',
    paid.rubRate === 11 && paid.manualRate === 0 && after.rubRate === 0 && after.rubRateSource === '',
    JSON.stringify({ paid: [paid.rubRate, paid.manualRate], after: [after.rubRate, after.rubRateSource] }));
})();

(function () {
  const h = withChina();
  let msg = '';
  try { h.saveChinaBatchCost({ batchId: 'CB404', kind: 'Разгрузка', amountRub: 9000 }, 'Николай'); } catch (e) { msg = e.message; }
  check('review: a cost of a batch that is not there is refused before anything is written',
    msg.indexOf('не найдена') !== -1 && h.dumpChinaSheet('Расходы партии').length === 0,
    msg + ' :: ' + h.dumpChinaSheet('Расходы партии').length);
})();

(function () {
  const h = withChina();
  const b = batch28();
  const units = function (lines) {
    return h.chinaBatchCost(b, lines, 0, { cargoRateCnyPerUsd: 7 }).lines.map(function (l) { return l.unitRub; });
  };
  const partial = batch28Lines();
  partial[0].article = 'BOX-WHITE';
  check('review: an article written against ONE of two NV-99 lines does not split the product',
    JSON.stringify(units(partial)) === JSON.stringify([504.61, 504.61, 749.3]), units(partial).join(' / '));

  const across = batch28Lines();
  across[0].article = 'BOX';
  across[2].article = 'BOX';
  check('review: one article under two markings ties both markings into one product',
    JSON.stringify(units(across)) === JSON.stringify([565.78, 565.78, 565.78]), units(across).join(' / '));

  const clash = batch28Lines();
  clash[0].article = 'BOX-WHITE';
  clash[1].article = 'BOX-GREY';
  check('review: one marking stays one product even when its lines were given two articles',
    units(clash)[0] === units(clash)[1], units(clash).join(' / '));

  // The chain: A and B share a marking, B and C an article, C and D a marker. E stands alone.
  const ids = h.chinaGroupIds([
    { marking: 'NV-1' },
    { marking: 'NV-1', article: 'P' },
    { marking: 'NV-2', article: 'P', group: 'G' },
    { marking: 'NV-3', group: 'G' },
    { marking: 'NV-4' }
  ]);
  check('review: sameness chains from marking to article to marker',
    ids[0] === ids[1] && ids[1] === ids[2] && ids[2] === ids[3] && ids[4] !== ids[0], ids.join(' '));
  check('review: letter case does not make two products of one',
    (function () {
      const x = h.chinaGroupIds([{ marking: 'nv-99' }, { marking: 'NV-99' }]);
      return x[0] === x[1];
    })(), 'nv-99 / NV-99');
})();

(function () {
  const h = withChina();
  // The script runs in one zone, the spreadsheet sits in another; a date in the sheet is
  // midnight of the spreadsheet's own zone.
  h.context.Session = { getScriptTimeZone: function () { return 'UTC'; } };
  h.setTargetSpreadsheetTimeZone('Europe/Moscow');
  h.saveChinaBatch(batch28Payload({}), 'Николай');
  const sheet = h.getTargetSheet('Партии');
  const data = sheet.__dump();
  // The Date has to be the stand's own class: the script runs in a sandbox whose Date it is,
  // exactly as a cell of a real sheet hands the script a Date of its own world.
  data[1][data[0].indexOf('Дата прибытия')] = new h.FakeDate(Date.UTC(2026, 8, 16, 21, 0, 0)); // 17.09 00:00 МСК
  sheet.__setData(data);
  check('review: a date is read in the time zone of the spreadsheet it came from',
    h.getChinaBatches().batches[0].arrivedAt === '2026-09-17', h.getChinaBatches().batches[0].arrivedAt);
})();

// ---- 81e: the carrier's arrival file — box data, priority, packaging analytics ----
//
// Fixture: the owner's real batch NV-0923-4 (order 30), final lines and the arrival file's
// factory-box data. Every expected figure below was worked out independently in Python before
// the code was run (see the coder's report) and only THEN asserted here.

const CHINA_923_FACTORY = {
  'NV-101': [0.32, 0.59, 0.43, 8.4],
  'NV-102': [0.32, 0.59, 0.43, 8.2],
  'NV-103': [0.48, 0.6, 0.43, 15.6],
  'NV-104': [0.48, 0.6, 0.43, 15.6]
};

function china923LineOf(marking, boxes, pcsPerBox, qty, priceCny, palletWeightKg) {
  const f = CHINA_923_FACTORY[marking];
  return {
    marking: marking, boxes: boxes, pcsPerBox: pcsPerBox, qty: qty, priceCny: priceCny, palletWeightKg: palletWeightKg,
    boxLengthM: f[0], boxWidthM: f[1], boxHeightM: f[2], factoryBoxKg: f[3]
  };
}

function china923Lines() {
  return [
    china923LineOf('NV-101', 7, 6, 42, 19, 229),
    china923LineOf('NV-104', 9, 10, 90, 25, 0),
    china923LineOf('NV-103', 15, 10, 150, 25, 278),
    china923LineOf('NV-104', 1, 10, 10, 25, 0),
    china923LineOf('NV-101', 23, 6, 138, 19, 229.5),
    china923LineOf('NV-102', 1, 6, 6, 19, 0),
    china923LineOf('NV-102', 24, 6, 144, 19, 230.5)
  ];
}

function china923Payload(over) {
  const out = {
    orderNo: '30', code: 'NV-0923-4', status: 'Прибыла',
    weightKg: 967, volumeM3: 9.14, ratePerKgUsd: 2.55, packingUsd: 180, otherCargoUsd: 0,
    freightUsd: 2645.85, chinaDeliveryCny: 1000, cargoRate: 7, rubRate: 12.4,
    receivedAt: '2026-09-23', shippedAt: '2026-09-23', arrivedAt: '2026-09-23',
    lines: china923Lines()
  };
  Object.keys(over || {}).forEach(function (k) { out[k] = over[k]; });
  return out;
}

(function () {
  const h = withChina();
  h.saveChinaBatch(china923Payload({}), 'Николай');
  const batch = h.getChinaBatches().batches[0];

  check('81e: the batch is billed per kilogram, not per m³',
    batch.tariffBasis === 'кг', batch.tariffBasis);
  check('81e: goods weight and volume are summed from the boxes, not the waybill',
    batch.goodsKg === 847 && batch.goodsVolumeM3 === 7.5611,
    batch.goodsKg + ' / ' + batch.goodsVolumeM3);
  check('81e: what is left over the goods is the carrier\'s own packaging',
    batch.packagingKg === 120 && batch.packagingM3 === 1.5789,
    batch.packagingKg + ' / ' + batch.packagingM3);
  check('81e: goods density and packed density',
    batch.goodsDensity === 112.02 && batch.packedDensity === 105.8,
    batch.goodsDensity + ' / ' + batch.packedDensity);
  check('81e: packaging in dollars and what is left for the goods',
    batch.packagingUsd === 486 && batch.goodsFreightUsd === 2159.85,
    batch.packagingUsd + ' / ' + batch.goodsFreightUsd);
  check('81e: packaging in rubles, and the two halves of the freight add up exactly',
    batch.packagingRub === 42184.8 && batch.goodsFreightRub === 187474.98,
    batch.packagingRub + ' / ' + batch.goodsFreightRub);
  check('81e: packaging\'s three shares — of freight, and of the cost twice over',
    batch.packagingShareFreight === 18.37 && batch.packagingShareCost === 10.62 &&
    batch.goodsFreightShareCost === 47.19,
    [batch.packagingShareFreight, batch.packagingShareCost, batch.goodsFreightShareCost].join(' / '));
  check('81e: the date of acceptance is kept', batch.receivedAt === '2026-09-23', batch.receivedAt);

  const freightShares = batch.lines.map(function (l) { return l.freightShareCny; });
  const chinaShares = batch.lines.map(function (l) { return l.chinaShareCny; });
  check('81e: freight is split by the EXACT box weight from the arrival file',
    JSON.stringify(freightShares) === JSON.stringify([1285.75, 3070.06, 5116.77, 341.12, 4224.61, 179.31, 4303.33]),
    freightShares.join(', '));
  check('81e: so is the China-delivery share',
    JSON.stringify(chinaShares) === JSON.stringify([69.42, 165.76, 276.27, 18.42, 228.1, 9.68, 232.35]),
    chinaShares.join(', '));

  const goodsKgs = batch.lines.map(function (l) { return l.goodsKg; });
  const densities = batch.lines.map(function (l) { return l.densityKgM3; });
  const kgPerPiece = batch.lines.map(function (l) { return l.kgPerPiece; });
  const boxVolumes = batch.lines.map(function (l) { return l.boxVolumeM3; });
  check('81e: every line has its own box volume, goods weight, density and weight per piece',
    JSON.stringify(boxVolumes) === JSON.stringify([0.081184, 0.12384, 0.12384, 0.12384, 0.081184, 0.081184, 0.081184]) &&
    JSON.stringify(goodsKgs) === JSON.stringify([58.8, 140.4, 234, 15.6, 193.2, 8.2, 196.8]) &&
    JSON.stringify(densities) === JSON.stringify([103.47, 125.97, 125.97, 125.97, 103.47, 101.01, 101.01]) &&
    JSON.stringify(kgPerPiece) === JSON.stringify([1.4, 1.56, 1.56, 1.56, 1.4, 1.367, 1.367]),
    JSON.stringify({ boxVolumes: boxVolumes, goodsKgs: goodsKgs, densities: densities, kgPerPiece: kgPerPiece }));
  check('81e: the box weight from the arrival file wins over the pallet estimate',
    batch.lines.every(function (l) { return l.weightSource === 'приёмка'; }),
    batch.lines.map(function (l) { return l.weightSource; }).join(', '));

  // (5) The analytics is read-only: it must not move a single kopeck of what the lines add up to.
  const sumOfLines = Math.round(batch.lines.reduce(function (s, l) { return s + l.costRub; }, 0) * 100) / 100;
  check('81e: the analytics never moves the total — sum of line costs = cost of the batch',
    sumOfLines === batch.totalRub && batch.totalRub === 397307.79, sumOfLines + ' vs ' + batch.totalRub);
})();

// (1) A batch billed by volume, not weight.
(function () {
  const h = withChina();
  const batch = { weightKg: 500, volumeM3: 10, ratePerKgUsd: 310, packingUsd: 0, otherCargoUsd: 0,
    freightUsd: 3100, cargoRate: 7, rubRate: 12.4, chinaDeliveryCny: 0 };
  const lines = [{ boxes: 10, pcsPerBox: 5, qty: 50, priceCny: 10,
    boxLengthM: 0.3, boxWidthM: 0.3, boxHeightM: 0.3, factoryBoxKg: 5 }];
  const calc = h.chinaBatchCost(batch, lines, 0, { cargoRateCnyPerUsd: 7 });
  check('81e: a batch billed per m³ is recognised as such, not as «кг»',
    calc.tariffBasis === 'м³', calc.tariffBasis);
  check('81e: its packaging in dollars comes from the packaging M³, not the packaging kg',
    calc.packagingM3 === 9.73 && calc.packagingUsd === 3016.3, calc.packagingM3 + ' / ' + calc.packagingUsd);

  // The ±1 $ tolerance itself: exactly 1 $ off is still «кг», a cent further is not.
  function tariffOf(freightUsd) {
    const b = { weightKg: 100, volumeM3: 1, ratePerKgUsd: 10, packingUsd: 0, otherCargoUsd: 0,
      freightUsd: freightUsd, cargoRate: 7, rubRate: 12.4, chinaDeliveryCny: 0 };
    return h.chinaBatchCost(b, [{ boxes: 1, pcsPerBox: 1, qty: 1, priceCny: 1 }], 0, { cargoRateCnyPerUsd: 7 }).tariffBasis;
  }
  check('81e: the ±1 $ tolerance holds exactly at the boundary',
    tariffOf(999) === 'кг' && tariffOf(998.99) !== 'кг', tariffOf(999) + ' / ' + tariffOf(998.99));
})();

// (2) A batch where one line has no factory weight at all.
(function () {
  const h = withChina();
  const lines = china923Lines();
  lines[1].factoryBoxKg = 0;
  h.saveChinaBatch(china923Payload({ lines: lines }), 'Николай');
  const batch = h.getChinaBatches().batches[0];
  check('81e: one line without a factory weight zeroes the batch\'s goods weight, not just that line',
    batch.goodsKg === 0 && batch.packagingKg === 0 && batch.packagingUsd === 0,
    batch.goodsKg + ' / ' + batch.packagingKg + ' / ' + batch.packagingUsd);
  check('81e: that line falls back to the batch average, and the batch still costs the same',
    batch.lines[1].weightSource === 'среднее по партии' && batch.totalRub === 397307.79,
    batch.lines[1].weightSource + ' / ' + batch.totalRub);
})();

// (3) A typed box weight beats the factory weight from the arrival file.
(function () {
  const h = withChina();
  const lines = china923Lines();
  lines[0].boxWeightKg = 9; // the owner overrides 8.4 кг from the file
  h.saveChinaBatch(china923Payload({ lines: lines }), 'Николай');
  const line0 = h.getChinaBatches().batches[0].lines[0];
  check('81e: a typed box weight beats the factory weight, in the freight AND in the box stats',
    line0.weightSource === 'вручную' && line0.goodsKg === 63 && line0.densityKgM3 === 110.86 && line0.kgPerPiece === 1.5,
    line0.weightSource + ' / ' + line0.goodsKg + ' / ' + line0.densityKgM3 + ' / ' + line0.kgPerPiece);
})();

// (4) The new input fields survive a recalc, whichever path triggers it.
(function () {
  const h = withChina();
  h.saveChinaBatch(china923Payload({}), 'Николай');
  const boxCell = function () {
    const line = h.dumpChinaSheet('Строки партий')[0];
    const batch = h.dumpChinaSheet('Партии')[0];
    return [line['Длина коробки, м'], line['Вес коробки фабрики, кг'], batch['Дата приёмки']];
  };
  check('81e: box data is there right after saving', JSON.stringify(boxCell()) === JSON.stringify([0.32, 8.4, '2026-09-23']), JSON.stringify(boxCell()));

  h.saveChinaBatchCost({ batchId: 'CB1', kind: 'Разгрузка', amountRub: 9000 }, 'Николай');
  check('81e: box data and the acceptance date survive a recalc from a Russian-side cost',
    JSON.stringify(boxCell()) === JSON.stringify([0.32, 8.4, '2026-09-23']), JSON.stringify(boxCell()));

  h.saveChinaPayment({ amountRub: 100000, rate: 11, orderNo: '30' }, 'Николай');
  check('81e: and survive a recalc from a payment',
    JSON.stringify(boxCell()) === JSON.stringify([0.32, 8.4, '2026-09-23']), JSON.stringify(boxCell()));
})();

// (6) A live sheet with the OLD headers (no 81e columns at all).
const PRE_81E_BATCH_HEADERS = ['ID', 'Номер заказа', 'Код партии', 'Дата отгрузки', 'Дата прибытия', 'Статус',
  'Товар ¥', 'Доставка по Китаю ¥', 'Вес накладной, кг', 'Объём, м³', 'Ставка $/кг', 'Упаковка $',
  'Прочее карго $', 'Перевозка $', 'Курс ¥/$', 'Перевозка ¥', 'Расходы РФ ₽', 'Курс ₽/¥', 'Курс вручную',
  'Источник курса', 'Себестоимость партии ₽', 'Коэффициент веса', 'Оплачено по отчёту ¥', 'Долг по отчёту ¥',
  'Комментарий', 'Кто', 'Обновлено'];
const PRE_81E_LINE_HEADERS = ['ID', 'ПартияID', 'Маркировка', 'Название', 'Коробок', 'Шт/коробку', 'Количество',
  'Цена ¥', 'Сумма ¥', 'Паллета', 'Вес паллеты, кг', 'Вес коробки, кг', 'Вес расчётный, кг', 'Источник веса',
  'Доставка Китай ¥', 'Перевозка ¥', 'Расходы РФ ₽', 'Себестоимость ₽', 'Себестоимость ₽/шт', 'Наш артикул', 'Один товар'];

(function () {
  const h = freshHarness();
  h.setChinaSpreadsheet();
  h.setTargetSheet('Партии', [PRE_81E_BATCH_HEADERS.slice()]);
  h.setTargetSheet('Строки партий', [PRE_81E_LINE_HEADERS.slice()]);
  h.setupChinaSpreadsheet();

  h.saveChinaBatch(china923Payload({}), 'Николай');

  const batchHead = h.headerRowOf(h.getTargetSheet('Партии'));
  const lineHead = h.headerRowOf(h.getTargetSheet('Строки партий'));
  check('81e: on an old batch sheet the new columns are appended at the end',
    batchHead.slice(0, PRE_81E_BATCH_HEADERS.length).join('|') === PRE_81E_BATCH_HEADERS.join('|') &&
    // Owner, 2026-09-24: the ruble-equivalents block ends at «Курс взят из партии» (followed,
    // 2026-09-25, by «Курс взят из оплаты»), then the freight-per-kilogram block, then (81g-1)
    // the report-driven rate/missing schema.
    batchHead[batchHead.indexOf('Тариф карго ₽') - 5] === 'Курс взят из партии' &&
    batchHead[batchHead.indexOf('Тариф карго ₽') - 4] === 'Курс взят из оплаты' &&
    // Item 84 (stage 1): five more columns append after «Проверка: детали».
    batchHead[batchHead.length - 1] === 'Учёт по артикулам (JSON)',
    batchHead.slice(-12).join(' | '));
  check('81e: same for the lines sheet',
    lineHead.slice(0, PRE_81E_LINE_HEADERS.length).join('|') === PRE_81E_LINE_HEADERS.join('|') &&
    lineHead[lineHead.length - 1] === 'Перевозка ₽',
    lineHead.slice(-3).join(' | '));

  const batch = h.getChinaBatches().batches[0];
  check('81e: on an old sheet everything still lands under its own header and reads back',
    batch.goodsKg === 847 && batch.tariffBasis === 'кг' && batch.receivedAt === '2026-09-23' &&
    batch.lines[0].goodsKg === 58.8,
    JSON.stringify({ goodsKg: batch.goodsKg, tariffBasis: batch.tariffBasis, receivedAt: batch.receivedAt }));
})();

// ---- 81e fixes: ruble equivalents, and the previous-batch fallback rate ----
//
// Owner, 2026-09-24 (after the live check of 81e): the ruble equivalent of every currency
// figure is now returned and stored alongside it, and a batch with no rate of its own — no
// payment against its order, no rate typed by hand — is costed at the rate of the PREVIOUS
// batch, not at zero. Expected figures below were worked out in Python first (see the coder's
// report), against the fixture of the original 81e block: NV-0923-4, rubRate 12.4.

(function () {
  const h = withChina();
  check('81e fixes: the rate-borrowing date is shipping first, then acceptance, then arrival',
    h.chinaRateDateOf({ shippedAt: '2026-01-01', receivedAt: '2026-02-01', arrivedAt: '2026-03-01' }) === '2026-01-01' &&
    h.chinaRateDateOf({ receivedAt: '2026-02-01', arrivedAt: '2026-03-01' }) === '2026-02-01' &&
    h.chinaRateDateOf({ arrivedAt: '2026-03-01' }) === '2026-03-01' &&
    h.chinaRateDateOf({}) === '',
    JSON.stringify([
      h.chinaRateDateOf({ shippedAt: '2026-01-01', receivedAt: '2026-02-01', arrivedAt: '2026-03-01' }),
      h.chinaRateDateOf({ receivedAt: '2026-02-01', arrivedAt: '2026-03-01' }),
      h.chinaRateDateOf({ arrivedAt: '2026-03-01' }),
      h.chinaRateDateOf({})
    ]));
})();

(function () {
  const h = withChina();
  h.saveChinaBatch(china923Payload({}), 'Николай');
  const batch = h.getChinaBatches().batches[0];

  check('81e fixes: batch-level ruble equivalents of goods, China delivery and freight',
    batch.goodsRub === 155248 && batch.chinaDeliveryRub === 12400 && batch.freightRub === 229659.78,
    batch.goodsRub + ' / ' + batch.chinaDeliveryRub + ' / ' + batch.freightRub);

  const goodsRubTargets = [9895.2, 27900.0, 46500.0, 3100.0, 32512.8, 1413.6, 33926.4];
  const chinaShareRubTargets = [860.81, 2055.42, 3425.75, 228.41, 2828.44, 120.03, 2881.14];
  const goodsRubs = batch.lines.map(function (l) { return l.goodsRub; });
  const chinaShareRubs = batch.lines.map(function (l) { return l.chinaShareRub; });
  check('81e fixes: each line\'s own goods-in-rubles and China-delivery-in-rubles are exactly round2(¥ × rate)',
    JSON.stringify(goodsRubs) === JSON.stringify(goodsRubTargets) &&
    JSON.stringify(chinaShareRubs) === JSON.stringify(chinaShareRubTargets),
    goodsRubs.join(', ') + ' | ' + chinaShareRubs.join(', '));

  const targets = [26699.31, 68024.17, 113373.7, 7558.3, 87726.4, 3757.08, 90168.83];
  const sums = batch.lines.map(function (l) { return Math.round((l.goodsRub + l.chinaShareRub + l.freightShareRub) * 100) / 100; });
  check('81e fixes: every line\'s three ruble components sum to round2(costCny × rate) exactly',
    JSON.stringify(sums) === JSON.stringify(targets), sums.join(', '));

  const sumOfLines = Math.round(batch.lines.reduce(function (s, l) { return s + l.costRub; }, 0) * 100) / 100;
  check('81e fixes: the ruble columns are extra — costRub still sums to the batch total',
    sumOfLines === batch.totalRub, sumOfLines + ' vs ' + batch.totalRub);
})();

(function () {
  const h = withChina();
  h.saveChinaBatch(china923Payload({ rubRate: 0 }), 'Николай');
  const batch = h.getChinaBatches().batches[0];
  check('81e fixes: with no rate at all the ruble columns are zero, not stale',
    batch.goodsRub === 0 && batch.chinaDeliveryRub === 0 && batch.freightRub === 0 &&
    batch.lines.every(function (l) { return l.goodsRub === 0 && l.chinaShareRub === 0 && l.freightShareRub === 0; }),
    JSON.stringify({ goodsRub: batch.goodsRub, chinaDeliveryRub: batch.chinaDeliveryRub, freightRub: batch.freightRub }));
})();

// Owner, 2026-09-25 (live check): with a payment SOMEWHERE in the system, a batch with no rate
// of its own is now costed at the LATEST payment's rate ('последняя оплата'), not straight at
// the previous batch's rate — 'предыдущая партия' only ever applies when there is no payment
// anywhere at all (see the dedicated block further below and the borrow-chain test, which never
// saves a single payment). This block used to demonstrate the borrow itself; it now demonstrates
// the new fallback pre-empting it, one payment at a time.
(function () {
  const h = withChina();

  // The older batch: order 29, shipped 2026-08-27, paid for at 12.4 — an own rate.
  // batch28Payload does not carry shippedAt/arrivedAt on its own, so both are given here.
  h.saveChinaBatch(batch28Payload({ orderNo: '29', rubRate: 0, shippedAt: '2026-08-27', arrivedAt: '2026-09-17' }), 'Николай');
  h.saveChinaPayment({ amountRub: 100000, rate: 12.4, orderNo: '29' }, 'Николай');
  let state = h.getChinaBatches();
  let older = state.batches.find(function (b) { return b.orderNo === '29'; });
  check('81e fixes: the older batch is costed at its own payment rate',
    older.rubRateSource === 'оплаты' && older.rubRate === 12.4, older.rubRateSource + ' / ' + older.rubRate);

  // The newer batch: NV-0923-4, order 30, shipped 2026-09-23 — no payment, no typed rate. The
  // only payment in the whole system is order 29's, so THAT is what it is costed at.
  h.saveChinaBatch(china923Payload({ rubRate: 0 }), 'Николай');
  state = h.getChinaBatches();
  let newer = state.batches.find(function (b) { return b.orderNo === '30'; });
  check('81e fixes: a batch with no rate of its own is costed at the latest payment known to the system',
    newer.rubRateSource === 'последняя оплата' && newer.rubRate === 12.4 && newer.rubRateFrom === '',
    newer.rubRateSource + ' / ' + newer.rubRate + ' / ' + newer.rubRateFrom);
  check('81e fixes: costed at that rate exactly as if it had been typed by hand',
    newer.totalRub === 397307.79, String(newer.totalRub));

  // A payment on the newer's own order: its own rate wins over the last-payment fallback.
  h.saveChinaPayment({ amountRub: 50000, rate: 13, orderNo: '30' }, 'Николай');
  state = h.getChinaBatches();
  newer = state.batches.find(function (b) { return b.orderNo === '30'; });
  const newerPayment = state.payments.find(function (p) { return p.orderNo === '30'; });
  check('81e fixes: a payment of the newer\'s own order beats the last-payment fallback',
    newer.rubRateSource === 'оплаты' && newer.rubRate === 13 && newer.rubRateFrom === '',
    newer.rubRateSource + ' / ' + newer.rubRate + ' / ' + newer.rubRateFrom);

  // Drop the payment, then type a rate by hand: it also beats the fallback.
  h.deleteChinaPayment({ id: newerPayment.id }, 'Николай');
  h.saveChinaBatch(china923Payload({ id: newer.id, rubRate: 15 }), 'Николай');
  state = h.getChinaBatches();
  newer = state.batches.find(function (b) { return b.orderNo === '30'; });
  check('81e fixes: a rate typed by hand also beats the last-payment fallback',
    newer.rubRateSource === 'вручную' && newer.rubRate === 15 && newer.rubRateFrom === '',
    newer.rubRateSource + ' / ' + newer.rubRate + ' / ' + newer.rubRateFrom);

  // Back to no rate of its own: the last-payment fallback kicks back in (order 29's payment is
  // still the only one left — order 30's own payment was deleted above).
  h.saveChinaBatch(china923Payload({ id: newer.id, rubRate: 0 }), 'Николай');
  state = h.getChinaBatches();
  newer = state.batches.find(function (b) { return b.orderNo === '30'; });
  check('81e fixes: with the typed rate gone the last-payment fallback applies again',
    newer.rubRateSource === 'последняя оплата' && newer.rubRate === 12.4, newer.rubRateSource + ' / ' + newer.rubRate);

  // Changing the older batch's payment re-costs the newer through the SAME fallback (it is
  // still the only payment in the system).
  const olderPayment = state.payments.find(function (p) { return p.orderNo === '29'; });
  h.saveChinaPayment({ id: olderPayment.id, amountRub: 100000, rate: 14, orderNo: '29' }, 'Николай');
  state = h.getChinaBatches();
  newer = state.batches.find(function (b) { return b.orderNo === '30'; });
  check('81e fixes: changing the payment\'s own rate re-costs the batch that falls back to it',
    newer.rubRateSource === 'последняя оплата' && newer.rubRate === 14, newer.rubRateSource + ' / ' + newer.rubRate);

  // Deleting the older BATCH does not touch the payment row itself — the fallback is unaffected.
  older = state.batches.find(function (b) { return b.orderNo === '29'; });
  h.deleteChinaBatch({ id: older.id }, 'Николай');
  state = h.getChinaBatches();
  newer = state.batches.find(function (b) { return b.orderNo === '30'; });
  check('81e fixes: deleting the SOURCE BATCH leaves the last-payment fallback untouched (the payment itself survives)',
    newer.rubRateSource === 'последняя оплата' && newer.rubRate === 14, newer.rubRateSource + ' / ' + newer.rubRate);

  // Deleting the payment itself is what actually removes the fallback.
  h.deleteChinaPayment({ id: olderPayment.id }, 'Николай');
  state = h.getChinaBatches();
  newer = state.batches.find(function (b) { return b.orderNo === '30'; });
  check('81e fixes: deleting the payment itself drops the batch back to zero (no payment, no source batch)',
    newer.rubRateSource === '' && newer.rubRate === 0 && newer.rubRateFrom === '',
    newer.rubRateSource + ' / ' + newer.rubRate + ' / ' + newer.rubRateFrom);
})();

// Coordinator review, 2026-09-24: a batch saved while NEITHER it nor anyone else had a rate
// (rubRateSource '') must still pick up a rate once a payment somewhere gives it one — not only
// batches that already read a source. Both start with nothing; a payment on the OLDER batch's
// order must re-cost the newer through the last-payment fallback.
(function () {
  const h = withChina();

  // Both batches saved with no rate anywhere: no payments yet, no typed rate on either.
  h.saveChinaBatch(batch28Payload({ orderNo: '29', rubRate: 0, shippedAt: '2026-08-27', arrivedAt: '2026-09-17' }), 'Николай');
  h.saveChinaBatch(china923Payload({ rubRate: 0 }), 'Николай');
  let state = h.getChinaBatches();
  let older = state.batches.find(function (b) { return b.orderNo === '29'; });
  let newer = state.batches.find(function (b) { return b.orderNo === '30'; });
  check('81e fixes: with no rate anywhere yet, both batches sit at zero with no source',
    older.rubRateSource === '' && older.rubRate === 0 && newer.rubRateSource === '' && newer.rubRate === 0,
    JSON.stringify({ older: [older.rubRateSource, older.rubRate], newer: [newer.rubRateSource, newer.rubRate] }));

  // A payment on the OLDER batch's order gives it an own rate — the newer, which had NO
  // source at all, must now be re-costed through the last-payment fallback.
  h.saveChinaPayment({ amountRub: 100000, rate: 12.4, orderNo: '29' }, 'Николай');
  state = h.getChinaBatches();
  newer = state.batches.find(function (b) { return b.orderNo === '30'; });
  check('81e fixes: a batch that had no source at all is re-costed once a payment gives the system a rate',
    newer.rubRateSource === 'последняя оплата' && newer.rubRate === 12.4,
    newer.rubRateSource + ' / ' + newer.rubRate);
})();

// Owner, 2026-09-25 (live check): the exact defect reported live — an UNALLOCATED payment (no
// receipt matched to it) contributed nothing anywhere, so a current-era batch with no earlier
// batch to borrow from stayed at 0 ₽ outright, even though the system plainly knew a rate.
(function () {
  const h = withChina();

  // Reproduce first: one unallocated payment, dated 2026-08-20 at 12.4, and NV-0923-4 with no
  // other rate anywhere — before the fix this batch priced at 0 ₽.
  h.saveChinaPayment({ date: '2026-08-20', amountRub: 100000, rate: 12.4, comment: 'not matched to anything' }, 'Николай');
  h.saveChinaBatch(china923Payload({ rubRate: 0 }), 'Николай');
  let batch = h.getChinaBatches().batches[0];
  const payment = h.getChinaBatches().payments[0];
  check('81g fix: an unallocated payment now costs the batch, not zero',
    batch.goodsRateSource === 'последняя оплата' && batch.goodsRate === 12.4 && batch.totalRub === 397307.79,
    JSON.stringify({ source: batch.goodsRateSource, rate: batch.goodsRate, total: batch.totalRub }));
  check('81g fix: freight is costed at the same fallback rate',
    batch.freightRateSource === 'последняя оплата' && batch.freightRate === 12.4,
    JSON.stringify({ source: batch.freightRateSource, rate: batch.freightRate }));
  check('81g fix: the sheet records WHICH payment the rate came from — date and ID',
    batch.rateFromPayment === '2026-08-20 ' + payment.id, batch.rateFromPayment);
  check('81g fix: «Чего не хватает» says the rate is provisional, with the payment\'s date',
    batch.missing.indexOf('курс предварительный — по последней оплате от 20.08') !== -1,
    JSON.stringify(batch.missing));

  // A NEWER payment (2026-08-22, later date) takes over.
  h.saveChinaPayment({ date: '2026-08-22', amountRub: 100800, rate: 12.6, comment: 'newer' }, 'Николай');
  batch = h.getChinaBatches().batches[0];
  check('81g fix: a newer payment by date wins over the earlier one',
    batch.goodsRateSource === 'последняя оплата' && batch.goodsRate === 12.6, JSON.stringify(batch.goodsRateSource) + ' / ' + batch.goodsRate);

  // Matching the newer payment to a receipt gives it an ACTUAL rate — that beats the typed one.
  // The receipt is dated well outside the payment's auto-match window (+3 days) so the match
  // stays manual, and its ¥ total is chosen to imply a DIFFERENT rate than the typed 12.6.
  h.saveChinaReport({
    reportDate: '2026-08-22', source: 'скрипт', orders: [],
    receipts: [{ date: '2026-08-30', goodsCny: 10080 }]
  }, 'Николай');
  const newPayment = h.getChinaBatches().payments.find(function (p) { return p.date === '2026-08-22'; });
  const receipt = h.getChinaMoney().receipts.find(function (r) { return r.date === '2026-08-30'; });
  h.matchChinaPayment({ paymentId: newPayment.id, receiptId: receipt.id }, 'Николай');
  batch = h.getChinaBatches().batches[0];
  const matchedPayment = h.getChinaBatches().payments.find(function (p) { return p.id === newPayment.id; });
  check('81g fix: once matched, the fallback uses the ACTUAL rate (100800/10080=10), not the typed 12.6',
    matchedPayment.actualRate === 10 && batch.goodsRateSource === 'последняя оплата' && batch.goodsRate === 10,
    JSON.stringify({ actualRate: matchedPayment.actualRate, batchRate: batch.goodsRate }));

  // Deleting the newer payment falls back to the earlier one again.
  h.deleteChinaPayment({ id: newPayment.id }, 'Николай');
  batch = h.getChinaBatches().batches[0];
  check('81g fix: deleting the latest payment falls back to the next latest',
    batch.goodsRateSource === 'последняя оплата' && batch.goodsRate === 12.4, String(batch.goodsRate));

  // A typed manual rate beats the last-payment fallback outright.
  h.saveChinaBatch(china923Payload({ id: batch.id, rubRate: 20 }), 'Николай');
  batch = h.getChinaBatches().batches[0];
  check('81g fix: a typed manual rate beats the last-payment fallback',
    batch.goodsRateSource === 'вручную' && batch.goodsRate === 20, batch.goodsRateSource + ' / ' + batch.goodsRate);

  // An order with its OWN known money (via the ledger) beats the fallback outright.
  h.saveChinaBatch(china923Payload({ id: batch.id, rubRate: 0 }), 'Николай');
  h.saveChinaReport({
    reportDate: '2026-09-01', source: 'скрипт',
    orders: [{ orderNo: '30', date: '2026-09-01', receivedCny: 8000 }],
    receipts: [{ date: '2026-09-01', goodsCny: 8000 }]
  }, 'Николай');
  h.saveChinaPayment({ date: '2026-09-01', amountRub: 88000, rate: 11, comment: 'order 30 own money' }, 'Николай');
  batch = h.getChinaBatches().batches[0];
  check('81g fix: an order with its own known money beats the last-payment fallback',
    batch.goodsRateSource === 'оплаты' && batch.goodsRate === 11, batch.goodsRateSource + ' / ' + batch.goodsRate);
})();

// Owner, 2026-09-25: a history batch (shipped before tracking, no money of its own anywhere) is
// NEVER given a provisional last-payment rate — that fallback is for a CURRENT supply only.
(function () {
  const h = withChina();
  h.saveChinaPayment({ date: '2026-08-20', amountRub: 100000, rate: 12.4 }, 'Николай');
  h.saveChinaBatch({
    orderNo: '77', code: 'OLDBATCH2', status: 'Черновик', shippedAt: '2026-05-01',
    lines: [{ marking: 'M1', name: 'x', boxes: 1, pcsPerBox: 1, qty: 1, priceCny: 10 }]
  }, 'Николай');
  const batch = h.getChinaBatches().batches[0];
  check('81g fix: a history batch stays «история» even with a payment elsewhere in the system',
    batch.history === true && batch.goodsRateSource === '' && batch.freightRateSource === '' && batch.rubRate === 0,
    JSON.stringify({ history: batch.history, source: batch.goodsRateSource, rate: batch.rubRate }));
})();

// A borrowed rate is never used as a source itself — otherwise a chain could walk arbitrarily
// far from the batch that actually has a rate. A, B and C, each dated a month after the last:
// B borrows straight from A; C must ALSO reach A directly, not through B.
(function () {
  const h = withChina();
  function chainPayload(over) {
    return { orderNo: over.orderNo, code: over.code, status: 'Прибыла', shippedAt: over.shippedAt,
      chinaDeliveryCny: 100, weightKg: 50, volumeM3: 1, ratePerKgUsd: 2, packingUsd: 0, otherCargoUsd: 0,
      freightUsd: 100, cargoRate: 7, rubRate: over.rubRate || 0,
      lines: [{ marking: 'X', boxes: 1, pcsPerBox: 1, qty: 1, priceCny: 10 }] };
  }

  h.saveChinaBatch(chainPayload({ orderNo: 'A', code: 'NV-A', shippedAt: '2026-07-01', rubRate: 10 }), 'Николай');
  h.saveChinaBatch(chainPayload({ orderNo: 'B', code: 'NV-B', shippedAt: '2026-08-01', rubRate: 0 }), 'Николай');
  h.saveChinaBatch(chainPayload({ orderNo: 'C', code: 'NV-C', shippedAt: '2026-09-01', rubRate: 0 }), 'Николай');

  const state = h.getChinaBatches();
  const b = state.batches.find(function (x) { return x.orderNo === 'B'; });
  const c = state.batches.find(function (x) { return x.orderNo === 'C'; });
  check('81e fixes: B borrows the rate straight from A',
    b.rubRateSource === 'предыдущая партия' && b.rubRateFrom === 'NV-A' && b.rubRate === 10,
    b.rubRateSource + ' / ' + b.rubRateFrom);
  check('81e fixes: a borrowed rate is never lent again — C skips B and reaches A directly',
    c.rubRateSource === 'предыдущая партия' && c.rubRateFrom === 'NV-A' && c.rubRate === 10,
    c.rubRateSource + ' / ' + c.rubRateFrom);

  // D is dated the SAME day as A: still «not after», so it counts.
  h.saveChinaBatch(chainPayload({ orderNo: 'D', code: 'NV-D', shippedAt: '2026-07-01', rubRate: 0 }), 'Николай');
  const d = h.getChinaBatches().batches.find(function (x) { return x.orderNo === 'D'; });
  check('81e fixes: a source dated the same day as the borrower still counts as "not after"',
    d.rubRateSource === 'предыдущая партия' && d.rubRateFrom === 'NV-A' && d.rubRate === 10,
    d.rubRateSource + ' / ' + d.rubRateFrom);

  // F is a second own-rate source, dated AFTER A. G has no date of its own at all, so it
  // simply takes the latest dated source there is — F, not A.
  h.saveChinaBatch(chainPayload({ orderNo: 'F', code: 'NV-F', shippedAt: '2026-10-01', rubRate: 20 }), 'Николай');
  h.saveChinaBatch(chainPayload({ orderNo: 'G', code: 'NV-G', shippedAt: '', rubRate: 0 }), 'Николай');
  const g = h.getChinaBatches().batches.find(function (x) { return x.orderNo === 'G'; });
  check('81e fixes: a batch with no date of its own takes the latest dated source there is',
    g.rubRateSource === 'предыдущая партия' && g.rubRateFrom === 'NV-F' && g.rubRate === 20,
    g.rubRateSource + ' / ' + g.rubRateFrom);
})();

// ================= Owner, 2026-09-24: freight per kilogram, and the carrier's own tariff =================
//
// freightPerKgUsd/Rub are the REAL cost of moving the goods, per kilogram of GOODS when the
// arrival file made that known, else per kilogram of the waybill's own total weight.
// tariffRub is a different number entirely: the carrier's own quoted tariff (Ставка $/кг, off
// the waybill) simply converted to rubles — what the carrier bills, not what it works out to.
// NV-0923-4 (real batch, same fixture as item 81e): freightUsd 2645,85 / goodsKg 847 = 3,12 $;
// at rubRate 12,4 the ₽ figure is freightRub 229 659,78 / 847 = 271,14 ₽. Its own tariff was
// 2,55 $/кг: 2,55 × 7 (cargoRate) × 12,4 = 221,34 ₽.

(function () {
  const h = withChina();
  h.saveChinaBatch(china923Payload({}), 'Николай');
  const batch = h.getChinaBatches().batches[0];
  check('freight/kg: real batch NV-0923-4, base is the goods weight from the arrival file',
    batch.freightPerKgUsd === 3.12 && batch.freightPerKgRub === 271.14 && batch.freightPerKgBase === 'товара',
    batch.freightPerKgUsd + ' / ' + batch.freightPerKgRub + ' / ' + batch.freightPerKgBase);
  check('freight/kg: the carrier\'s own tariff sits next to it, in rubles',
    batch.tariffRub === 221.34, String(batch.tariffRub));
})();

(function () {
  const h = withChina();
  h.saveChinaBatch(batch28Payload({}), 'Николай');
  const batch = h.getChinaBatches().batches[0];
  check('freight/kg: a batch with no box data falls back to the waybill weight',
    batch.freightPerKgUsd === 2.43 && batch.freightPerKgRub === 211.26 && batch.freightPerKgBase === 'накладной',
    batch.freightPerKgUsd + ' / ' + batch.freightPerKgRub + ' / ' + batch.freightPerKgBase);
  check('freight/kg: the carrier\'s tariff, converted at the same rate',
    batch.tariffRub === 199.64, String(batch.tariffRub)); // 2,3 × 7 × 12,4

  h.saveChinaBatch(batch28Payload({ id: batch.id, rubRate: 0 }), 'Николай');
  const noRate = h.getChinaBatches().batches[0];
  check('freight/kg: without a rate the ruble figures are 0 but the dollar figure and base survive',
    noRate.freightPerKgRub === 0 && noRate.freightPerKgUsd === 2.43 && noRate.freightPerKgBase === 'накладной' &&
    noRate.tariffRub === 0,
    noRate.freightPerKgUsd + ' / ' + noRate.freightPerKgRub + ' / ' + noRate.freightPerKgBase + ' / ' + noRate.tariffRub);
})();

(function () {
  const h = withChina();
  const batch = { weightKg: 0, volumeM3: 0, ratePerKgUsd: 0, packingUsd: 0, otherCargoUsd: 0,
    freightUsd: 100, cargoRate: 7, rubRate: 12.4, chinaDeliveryCny: 0 };
  const calc = h.chinaBatchCost(batch, [{ boxes: 1, pcsPerBox: 1, qty: 1, priceCny: 1 }], 0, { cargoRateCnyPerUsd: 7 });
  check('freight/kg: no base at all (no goods weight, no waybill weight) leaves both figures at 0 and the label empty',
    calc.freightPerKgUsd === 0 && calc.freightPerKgRub === 0 && calc.freightPerKgBase === '',
    calc.freightPerKgUsd + ' / ' + calc.freightPerKgRub + ' / ' + calc.freightPerKgBase);
  check('freight/kg: a batch with no rate of its own at all has a zero tariff too — nothing to convert with',
    calc.tariffRub === 0, String(calc.tariffRub));
})();

// ================= Owner, 2026-09-24: the trash of «Заказы в Китае» =================
//
// A deleted batch no longer vanishes: it is archived whole (its own row, lines and Russian-
// side costs — payments stay where they are, they are per ORDER) to «Удаленное» in the MAIN
// database, Type 'ChinaBatch', and the China spreadsheet loses the rows exactly as before. The
// trash itself shows only the batch's own code (owner, 2026-09-24) — see `rec.data.code` below.

// withChina() already ensures the archive sheet — kept as a separate name here only to mark
// which tests below are specifically about the trash.
function withChinaArchive() {
  return withChina();
}

// 1) Archiving on delete: shape of DataJSON, and the China sheets are actually emptied.
(function () {
  const h = withChinaArchive();
  h.saveChinaBatch(batch28Payload({}), 'Николай');
  h.saveChinaBatchCost({ batchId: 'CB1', kind: 'Разгрузка', amountRub: 6000, comment: 'выгрузка' }, 'Николай');
  const before = h.getChinaBatches().batches[0];

  h.deleteChinaBatch({ id: 'CB1' }, 'Николай');

  check('trash: the China sheets no longer hold the batch, its lines or its costs',
    h.getChinaBatches().batches.length === 0 &&
    h.dumpChinaSheet('Строки партий').length === 0 &&
    h.dumpChinaSheet('Расходы партии').length === 0,
    String(h.getChinaBatches().batches.length));

  const archive = h.dumpArchive();
  check('trash: exactly one archive row, of Type ChinaBatch',
    archive.length === 1 && archive[0].type === 'ChinaBatch', JSON.stringify(archive.map(function (a) { return a.type; })));

  const rec = archive[0];
  check('trash: the archive row carries the batch\'s own code — what lights up the trash list',
    rec.data.code === 'NV-0825-2', rec.data.code);
  check('trash: the batch object is the sheet\'s own header row, ID and cost both intact',
    rec.data.batch['ID'] === 'CB1' && rec.data.batch['Код партии'] === 'NV-0825-2' &&
    rec.data.batch['Себестоимость партии ₽'] === before.totalRub,
    JSON.stringify(rec.data.batch));
  check('trash: all three lines are archived, keyed by the sheet\'s own headers',
    rec.data.lines.length === 3 && rec.data.lines[0]['ID'] === 'CB1-1' && rec.data.lines[0]['Маркировка'] === 'NV-99',
    JSON.stringify(rec.data.lines.map(function (l) { return l['ID']; })));
  check('trash: the Russian-side cost is archived too',
    rec.data.costs.length === 1 && rec.data.costs[0]['Тип'] === 'Разгрузка' && rec.data.costs[0]['Сумма ₽'] === 6000,
    JSON.stringify(rec.data.costs));
  check('trash: payments are per ORDER, not archived with the batch — none of this JSON is a payment',
    rec.data.payments === undefined, JSON.stringify(Object.keys(rec.data)));
})();

// 2) Restore: identical rows back, totals re-costed.
(function () {
  const h = withChinaArchive();
  h.saveChinaBatch(batch28Payload({}), 'Николай');
  h.saveChinaBatchCost({ batchId: 'CB1', kind: 'Разгрузка', amountRub: 6000 }, 'Николай');
  const before = h.getChinaBatches().batches[0];
  h.deleteChinaBatch({ id: 'CB1' }, 'Николай');

  const archiveId = h.dumpArchive()[0].archiveId;
  const res = h.restoreArchivedItem(archiveId, 'Николай');
  check('trash: restore reports ok', res.status === 'ok', JSON.stringify(res));
  check('trash: the archive is emptied by a successful restore', h.dumpArchive().length === 0, String(h.dumpArchive().length));

  const state = h.getChinaBatches();
  check('trash: exactly one batch is back', state.batches.length === 1, String(state.batches.length));
  const after = state.batches[0];
  check('trash: the batch keeps its original ID and code',
    after.id === 'CB1' && after.code === 'NV-0825-2', after.id + ' / ' + after.code);
  check('trash: the total is re-costed, matching what it was before deletion',
    after.totalRub === before.totalRub && after.totalRub > 0, after.totalRub + ' vs ' + before.totalRub);
  check('trash: every line round-trips exactly, in its original order',
    JSON.stringify(after.lines.map(function (l) { return { id: l.id, marking: l.marking, qty: l.qty, costRub: l.costRub }; })) ===
    JSON.stringify(before.lines.map(function (l) { return { id: l.id, marking: l.marking, qty: l.qty, costRub: l.costRub }; })),
    JSON.stringify(after.lines.map(function (l) { return l.id; })));
  check('trash: the Russian-side cost is back and still costed into the total',
    after.costs.length === 1 && after.costs[0].amountRub === 6000, JSON.stringify(after.costs));
})();

// 3) Restore when the original ID is taken by then: a fresh ID, lines AND costs re-keyed.
(function () {
  const h = withChinaArchive();
  h.saveChinaBatch(batch28Payload({}), 'Николай'); // CB1, NV-0825-2
  h.saveChinaBatchCost({ batchId: 'CB1', kind: 'Разгрузка', amountRub: 1000 }, 'Николай'); // CC1
  h.deleteChinaBatch({ id: 'CB1' }, 'Николай');

  // The id counter resets once CB1 is gone: an unrelated new batch is handed the very same id.
  h.saveChinaBatch({ orderNo: '27', code: 'NV-0716-3', status: 'Прибыла', shippedAt: '2026-07-17',
    chinaDeliveryCny: 900, weightKg: 1001.5, volumeM3: 7.41, ratePerKgUsd: 2.3, packingUsd: 135,
    freightUsd: 2438.45, cargoRate: 7, rubRate: 12.4, lines: batch27Lines() }, 'Николай'); // CB1 again
  h.saveChinaBatchCost({ batchId: 'CB1', kind: 'Прочее', amountRub: 500 }, 'Николай'); // CC1 again

  const archiveId = h.dumpArchive().find(function (a) { return a.data.code === 'NV-0825-2'; }).archiveId;
  const res = h.restoreArchivedItem(archiveId, 'Николай');
  check('trash: restore succeeds even when its own id is taken', res.status === 'ok', JSON.stringify(res));

  const state = h.getChinaBatches();
  const restored = state.batches.find(function (b) { return b.code === 'NV-0825-2'; });
  const stayed = state.batches.find(function (b) { return b.code === 'NV-0716-3'; });
  check('trash: the id stays with the batch that is actually there; the restored one got a fresh id',
    stayed.id === 'CB1' && restored.id !== 'CB1' && restored.id === 'CB2',
    'stayed=' + stayed.id + ' restored=' + restored.id);
  check('trash: its lines are re-keyed under the new id',
    restored.lines.length === 3 && restored.lines.every(function (l) { return l.id.indexOf(restored.id + '-') === 0; }),
    JSON.stringify(restored.lines.map(function (l) { return l.id; })));
  check('trash: its cost is re-keyed too — the live batch already holds a cost of the same original id',
    restored.costs.length === 1 && stayed.costs.length === 1 &&
    restored.costs[0].id !== stayed.costs[0].id && restored.costs[0].id === 'CC2',
    JSON.stringify({ restored: restored.costs.map(function (c) { return c.id; }), stayed: stayed.costs.map(function (c) { return c.id; }) }));
  check('trash: both batches keep the totals they are supposed to have',
    restored.totalRub > 0 && stayed.totalRub > 0, restored.totalRub + ' / ' + stayed.totalRub);
})();

// 3b) A cost id can collide on its OWN, even when the batch's own id is free: 'CC' is one
// series shared by every batch, so a cost belonging to a DIFFERENT batch can take the exact id
// an archived cost is trying to come back under.
(function () {
  const h = withChinaArchive();
  h.saveChinaBatch({ orderNo: '27', code: 'NV-0716-3', status: 'Прибыла', shippedAt: '2026-07-17',
    chinaDeliveryCny: 900, weightKg: 1001.5, volumeM3: 7.41, ratePerKgUsd: 2.3, packingUsd: 135,
    freightUsd: 2438.45, cargoRate: 7, rubRate: 12.4, lines: batch27Lines() }, 'Николай'); // CB1, stays put throughout
  h.saveChinaBatch(batch28Payload({}), 'Николай'); // CB2, NV-0825-2, to be deleted and restored
  h.saveChinaBatchCost({ batchId: 'CB2', kind: 'Разгрузка', amountRub: 1000 }, 'Николай'); // CC1
  h.deleteChinaBatch({ id: 'CB2' }, 'Николай'); // CB2 and its CC1 both leave the live sheets

  // CB1 (unrelated, never deleted) is given a cost of its own — the freed id CC1 is reused.
  h.saveChinaBatchCost({ batchId: 'CB1', kind: 'Прочее', amountRub: 300 }, 'Николай'); // CC1 again

  const archiveId = h.dumpArchive()[0].archiveId;
  const res = h.restoreArchivedItem(archiveId, 'Николай');
  check('trash: restore succeeds even when only a COST id, not the batch id, collides', res.status === 'ok', JSON.stringify(res));

  const state = h.getChinaBatches();
  const restored = state.batches.find(function (b) { return b.code === 'NV-0825-2'; });
  const stayed = state.batches.find(function (b) { return b.code === 'NV-0716-3'; });
  check('trash: the batch keeps its original id — nothing forced it to change',
    restored.id === 'CB2', restored.id);
  check('trash: its cost is NOT CC1 — that id belongs to the other batch\'s cost now',
    restored.costs.length === 1 && stayed.costs.length === 1 &&
    stayed.costs[0].id === 'CC1' && restored.costs[0].id !== 'CC1' && restored.costs[0].id === 'CC2',
    JSON.stringify({ restored: restored.costs.map(function (c) { return c.id; }), stayed: stayed.costs.map(function (c) { return c.id; }) }));
})();

// 4) Restore refused when a batch of the same CODE exists now — the archive row stays.
(function () {
  const h = withChinaArchive();
  h.saveChinaBatch(batch28Payload({}), 'Николай'); // CB1, NV-0825-2
  h.deleteChinaBatch({ id: 'CB1' }, 'Николай');

  // A batch of the SAME code exists again by the time somebody tries to restore it.
  h.saveChinaBatch(batch28Payload({}), 'Николай');

  const archiveId = h.dumpArchive()[0].archiveId;
  let msg = '';
  try { h.restoreArchivedItem(archiveId, 'Николай'); } catch (e) { msg = e.message; }
  check('trash: restore is refused when a batch of the same code exists now',
    msg.indexOf('NV-0825-2') !== -1 && msg.indexOf('существует') !== -1, msg);
  check('trash: a refused restore leaves the archive row in place',
    h.dumpArchive().length === 1, String(h.dumpArchive().length));
  check('trash: a refused restore does not touch the live batch that IS there',
    h.getChinaBatches().batches.length === 1, String(h.getChinaBatches().batches.length));
})();

// 5) Multiple restore, through restoreMultipleArchivedItems.
(function () {
  const h = withChinaArchive();
  // restoreMultipleArchivedItems always touches the warehouse's own «Остатки» sheet, even when
  // every id restored is a ChinaBatch and not a single transaction moves stock.
  h.setStockSheet([]);
  h.saveChinaBatch(batch28Payload({}), 'Николай'); // CB1
  h.saveChinaBatch({ orderNo: '27', code: 'NV-0716-3', status: 'Прибыла', shippedAt: '2026-07-17',
    chinaDeliveryCny: 900, weightKg: 1001.5, volumeM3: 7.41, ratePerKgUsd: 2.3, packingUsd: 135,
    freightUsd: 2438.45, cargoRate: 7, rubRate: 12.4, lines: batch27Lines() }, 'Николай'); // CB2
  h.deleteChinaBatch({ id: 'CB1' }, 'Николай');
  h.deleteChinaBatch({ id: 'CB2' }, 'Николай');
  check('trash: two batches deleted, two archive rows', h.dumpArchive().length === 2, String(h.dumpArchive().length));

  const ids = h.dumpArchive().map(function (a) { return a.archiveId; });
  const res = h.restoreMultipleArchivedItems(ids, 'Николай');
  // partial/message is expected here — it is how a restore REPORTS what happened, not an
  // error flag; what matters is that no error text made it into the message.
  check('trash: multiple restore reports success, no errors',
    (res.message || '').indexOf('Ошиб') === -1, JSON.stringify(res.message || ''));
  check('trash: both batches are back', h.getChinaBatches().batches.length === 2, String(h.getChinaBatches().batches.length));
  check('trash: the archive is empty after a full multiple restore', h.dumpArchive().length === 0, String(h.dumpArchive().length));
})();

// 6) A multiple restore that mixes an ordinary transaction WITH a ChinaBatch — the transaction
// loop below must never see the batch's row, and vice versa.
(function () {
  const h = withChinaArchive();
  h.ensureTransSheet();
  h.setStockSheet([{ article: 'A', quantity: 10, avgCost: 100, capitalization: 1000 }]);
  h.commitTransaction([{ article: 'A', quantity: 2, price: 100 }], 'Приход', '', '', 'tester', null, 'op-mix', 0);
  const trRow = h.getTransactions().rows[0];
  h.deleteTransaction(trRow.id, 'tester');

  h.saveChinaBatch(batch28Payload({}), 'Николай');
  h.deleteChinaBatch({ id: 'CB1' }, 'Николай');

  check('trash: one transaction archived, one batch archived', h.dumpArchive().length === 2, String(h.dumpArchive().length));
  const ids = h.dumpArchive().map(function (a) { return a.archiveId; });
  const res = h.restoreMultipleArchivedItems(ids, 'Николай');
  check('trash: a mixed multiple restore brings back both kinds, untangled',
    h.getChinaBatches().batches.length === 1 && h.getTransactions().rows.some(function (t) { return t.id === trRow.id; }),
    JSON.stringify(res));
  check('trash: the archive is empty after the mixed restore', h.dumpArchive().length === 0, String(h.dumpArchive().length));
})();

// 7) Hard delete from the trash — the existing generic path, proven for the new type too.
(function () {
  const h = withChinaArchive();
  h.saveChinaBatch(batch28Payload({}), 'Николай');
  h.deleteChinaBatch({ id: 'CB1' }, 'Николай');
  const archiveId = h.dumpArchive()[0].archiveId;
  h.hardDeleteArchivedItems([archiveId]);
  check('trash: hard delete removes the archive row of a ChinaBatch', h.dumpArchive().length === 0, String(h.dumpArchive().length));
  check('trash: hard delete does not resurrect the batch', h.getChinaBatches().batches.length === 0,
    String(h.getChinaBatches().batches.length));
})();

// 8) A borrower is re-costed after the source is deleted AND again after it is restored.
(function () {
  const h = withChinaArchive();
  h.saveChinaBatch(batch28Payload({ shippedAt: '2026-08-27' }), 'Николай'); // CB1, source: rate 12.4
  h.saveChinaBatch({ orderNo: '99', code: 'NV-borrower', status: 'Черновик', shippedAt: '2026-09-01',
    chinaDeliveryCny: 100, weightKg: 50, volumeM3: 1, ratePerKgUsd: 2, packingUsd: 0, otherCargoUsd: 0,
    freightUsd: 100, cargoRate: 7, rubRate: 0,
    lines: [{ marking: 'X', boxes: 1, pcsPerBox: 1, qty: 1, priceCny: 10 }] }, 'Николай'); // CB2, borrower

  let borrower = h.getChinaBatches().batches.find(function (b) { return b.code === 'NV-borrower'; });
  check('trash/borrower: before deletion the borrower borrows the source\'s rate',
    borrower.rubRateSource === 'предыдущая партия' && borrower.rubRate === 12.4,
    borrower.rubRateSource + ' ' + borrower.rubRate);

  h.deleteChinaBatch({ id: 'CB1' }, 'Николай');
  borrower = h.getChinaBatches().batches.find(function (b) { return b.code === 'NV-borrower'; });
  check('trash/borrower: once the source is deleted, the borrower has nothing left to borrow',
    borrower.rubRateSource === '' && borrower.rubRate === 0, borrower.rubRateSource + ' ' + borrower.rubRate);

  const archiveId = h.dumpArchive()[0].archiveId;
  h.restoreArchivedItem(archiveId, 'Николай');
  borrower = h.getChinaBatches().batches.find(function (b) { return b.code === 'NV-borrower'; });
  check('trash/borrower: restoring the source gives the borrower its rate back',
    borrower.rubRateSource === 'предыдущая партия' && borrower.rubRate === 12.4 && borrower.rubRateFrom === 'NV-0825-2',
    borrower.rubRateSource + ' ' + borrower.rubRate + ' ' + borrower.rubRateFrom);
})();

// 9) An old-header live sheet — made by a version of the module before this task — still
// restores fine: the missing columns are appended, same as every other write in this module.
(function () {
  const h = withChinaArchive();
  h.saveChinaBatch(batch28Payload({}), 'Николай');
  h.deleteChinaBatch({ id: 'CB1' }, 'Николай');
  const archiveId = h.dumpArchive()[0].archiveId;

  const oldHeaders = h.CHINA_BATCH_HEADERS.slice(0, h.CHINA_BATCH_HEADERS.length - 4);
  h.setTargetSheet('Партии', [oldHeaders]);

  const res = h.restoreArchivedItem(archiveId, 'Николай');
  check('trash: an old-header live sheet still restores', res.status === 'ok', JSON.stringify(res));
  const after = h.getChinaBatches().batches[0];
  check('trash: the columns missing from the old header row are appended and filled in by the recost',
    after.freightPerKgUsd === 2.43 && after.freightPerKgBase === 'накладной' && after.tariffRub === 199.64,
    after.freightPerKgUsd + ' / ' + after.freightPerKgBase + ' / ' + after.tariffRub);
})();

// ================= Item 81g-1: the Chinese financial report — ingestion + goods pool =========
//
// The scenario below uses REAL numbers from the owner's own report (docs/OZON_PLAN.md, 81g
// dossier): the 结转 carry-over 17 402 ¥ and the goods transfers dated 2026-01-15 (34 304 ¥),
// 2026-01-29 (6 300 ¥), 2026-03-05 (6 955 ¥), 2026-06-08 (11 559 ¥), 2026-06-19 (7 359 ¥). Every
// expected figure below was derived independently in Python first (chinaAllocate's own rounding
// rule ported line for line) — see the report for the script and its output.

function chinaReportOf(id, reportDate, orders) {
  return { id: id, reportDate: reportDate, orders: orders };
}
function chinaReceiptOf(id, date, goodsCny, status, reportId) {
  return { id: id, date: date, goodsCny: goodsCny, status: status || 'ждёт оплату', reportId: reportId };
}

// ---- pure function: baseline consumes FIFO exactly, no shortfall ----
(function () {
  const h = withChina();
  const receipts = [
    chinaReceiptOf('R0', h.CHINA_CARRYOVER_RECEIPT_DATE, 17402, 'история', 'CR1'),
    chinaReceiptOf('R1', '2026-01-15', 34304, 'история', 'CR1'),
    chinaReceiptOf('R2', '2026-01-29', 6300, 'история', 'CR1'),
    chinaReceiptOf('R3', '2026-03-05', 6955, 'история', 'CR1')
  ];
  const report1 = chinaReportOf('CR1', '2026-08-20', [
    { orderNo: '28', date: '2026-01-01', receivedCny: 51706 },
    { orderNo: '29', date: '2026-01-25', receivedCny: 6300 },
    { orderNo: '30', date: '2026-03-01', receivedCny: 6955 }
  ]);
  const result = h.chinaAllocateGoodsLedger([report1], receipts);
  check('81g-1: baseline order 28 takes 结转+R1 exactly (carry-over + first receipt)',
    result.orders['28'].totalCny === 51706 && result.orders['28'].historyCny === 51706 &&
    JSON.stringify(result.orders['28'].lots) === JSON.stringify([{ receiptId: 'R0', cny: 17402 }, { receiptId: 'R1', cny: 34304 }]),
    JSON.stringify(result.orders['28']));
  check('81g-1: baseline order 29 takes exactly R2, order 30 exactly R3',
    result.orders['29'].totalCny === 6300 && JSON.stringify(result.orders['29'].lots) === JSON.stringify([{ receiptId: 'R2', cny: 6300 }]) &&
    result.orders['30'].totalCny === 6955 && JSON.stringify(result.orders['30'].lots) === JSON.stringify([{ receiptId: 'R3', cny: 6955 }]),
    JSON.stringify(result.orders['29']) + ' / ' + JSON.stringify(result.orders['30']));
  check('81g-1: nothing left in the pool and no warnings — an exact baseline',
    result.pool.totalCny === 0 && result.warnings.length === 0, result.pool.totalCny + ' / ' + JSON.stringify(result.warnings));

  // ---- second report: order 29 loses 1000 ¥ to order 30 (owner's own example), two new
  // receipts join the pool the same report. Python: shares taken by order30 from the pool
  // {r2:1000, rJun08:11559, rJun19:7359} for 1000 ¥ = [50.21, 580.33, 369.46] (remainder on the
  // largest lot, rJun08), pool left with [949.79, 10978.67, 6989.54] = 18918 ¥ total.
  const receipts2 = receipts.concat([
    chinaReceiptOf('R4', '2026-06-08', 11559, 'ждёт оплату', 'CR2'),
    chinaReceiptOf('R5', '2026-06-19', 7359, 'ждёт оплату', 'CR2')
  ]);
  const report2 = chinaReportOf('CR2', '2026-09-16', [
    { orderNo: '28', date: '2026-01-01', receivedCny: 51706 }, // unchanged
    { orderNo: '29', date: '2026-01-25', receivedCny: 5300 },  // Δ = -1000
    { orderNo: '30', date: '2026-03-01', receivedCny: 7955 }   // Δ = +1000
  ]);
  const result2 = h.chinaAllocateGoodsLedger([report1, report2], receipts2);
  check('81g-1: order 29 keeps its own lot, reduced by the 1000 ¥ that moved',
    result2.orders['29'].totalCny === 5300 &&
    JSON.stringify(result2.orders['29'].lots) === JSON.stringify([{ receiptId: 'R2', cny: 5300 }]),
    JSON.stringify(result2.orders['29']));
  check('81g-1: order 30 takes the 1000 ¥ at the pool\'s AVERAGE composition — three lots, not one',
    result2.orders['30'].totalCny === 7955 &&
    JSON.stringify(result2.orders['30'].lots) === JSON.stringify([
      { receiptId: 'R3', cny: 6955 }, { receiptId: 'R2', cny: 50.21 }, { receiptId: 'R4', cny: 580.33 }, { receiptId: 'R5', cny: 369.46 }
    ]),
    JSON.stringify(result2.orders['30']));
  check('81g-1: the pool keeps exactly what neither order took, split the same way',
    result2.pool.totalCny === 18918 &&
    JSON.stringify(result2.pool.lots) === JSON.stringify([{ receiptId: 'R2', cny: 949.79 }, { receiptId: 'R4', cny: 10978.67 }, { receiptId: 'R5', cny: 6989.54 }]),
    JSON.stringify(result2.pool));
  check('81g-1: a receipt matched LATER retroactively moves every order and the pool that hold it',
    (function () {
      const matched = receipts2.map(function (r) { return r.id === 'R4' ? Object.assign({}, r, { status: 'сопоставлено' }) : r; });
      const again = h.chinaAllocateGoodsLedger([report1, report2], matched);
      // R4's 11559 ¥ is split between order 30 (580.33) and the pool (10978.67) — both must
      // move from pendingCny to knownCny, and NOTHING else (order 28/29 untouched, and R2/R3
      // are dated before tracking so they stay «история», not «pending», either way).
      return again.orders['30'].knownCny === 580.33 && again.orders['30'].pendingCny === 369.46 &&
        again.orders['30'].historyCny === 6955 + 50.21 &&
        again.pool.knownCny === 10978.67 && again.orders['28'].historyCny === 51706;
    })(), JSON.stringify(h.chinaAllocateGoodsLedger([report1, report2], receipts2.map(function (r) { return r.id === 'R4' ? Object.assign({}, r, { status: 'сопоставлено' }) : r; })).orders['30']));
})();

// ---- pure function: shortfalls are capped and reported, never silently swallowed ----
(function () {
  const h = withChina();
  // Order X releases more than it has: its own lots (500 ¥) cannot cover a Δ of -800.
  const reportA = chinaReportOf('CR1', '2026-01-01', [{ orderNo: 'X', date: '2026-01-01', receivedCny: 500 }]);
  const reportB = chinaReportOf('CR2', '2026-01-02', [{ orderNo: 'X', date: '2026-01-01', receivedCny: -300 }]);
  const receiptsA = [chinaReceiptOf('RX', '2026-01-01', 500, 'история', 'CR1')];
  const shortRelease = h.chinaAllocateGoodsLedger([reportA, reportB], receiptsA);
  check('81g-1: an order releasing more than its own composition is capped, not negative, and warned',
    shortRelease.orders['X'].lots.length === 0 &&
    shortRelease.warnings.some(function (w) { return w.indexOf('больше известного состава') !== -1; }),
    JSON.stringify(shortRelease.orders['X']) + ' / ' + JSON.stringify(shortRelease.warnings));

  // Order Y wants more than the pool holds: the pool has only 2000 ¥, order Y's Δ is +5000.
  const reportC = chinaReportOf('CR1', '2026-01-01', [
    { orderNo: 'A', date: '2026-01-01', receivedCny: 2000 }, { orderNo: 'Y', date: '2026-01-02', receivedCny: 0 }
  ]);
  const reportD = chinaReportOf('CR2', '2026-01-02', [
    { orderNo: 'A', date: '2026-01-01', receivedCny: 0 }, { orderNo: 'Y', date: '2026-01-02', receivedCny: 5000 }
  ]);
  const receiptsC = [chinaReceiptOf('RA', '2026-01-01', 2000, 'история', 'CR1')];
  const shortTake = h.chinaAllocateGoodsLedger([reportC, reportD], receiptsC);
  check('81g-1: an order wanting more than the whole pool holds gets an UNKNOWN lot for the rest, and a warning',
    JSON.stringify(shortTake.orders['Y'].lots) === JSON.stringify([{ receiptId: 'RA', cny: 2000 }, { receiptId: 'UNKNOWN', cny: 3000 }]) &&
    shortTake.orders['Y'].unknownCny === 3000 && shortTake.pool.totalCny === 0 &&
    shortTake.warnings.some(function (w) { return w.indexOf('не хватает') !== -1; }),
    JSON.stringify(shortTake.orders['Y']) + ' / ' + JSON.stringify(shortTake.warnings));
})();

// ---- pure function: a receipt whose introducing report has since been pruned is not lost ----
(function () {
  const h = withChina();
  // Only report2 is handed in (report1 was pruned away) but R0/R1 still say reportId 'CR1' —
  // they must be treated as introduced by the OLDEST report still given, not dropped.
  const receipts = [
    chinaReceiptOf('R0', '2026-01-01', 1000, 'история', 'CR1'),
    chinaReceiptOf('R1', '2026-01-05', 2000, 'ждёт оплату', 'CR2')
  ];
  const report2Only = chinaReportOf('CR2', '2026-02-01', [{ orderNo: 'Z', date: '2026-01-01', receivedCny: 3000 }]);
  const result = h.chinaAllocateGoodsLedger([report2Only], receipts);
  check('81g-1: a receipt orphaned by pruning still feeds the baseline of the oldest report kept',
    result.orders['Z'].totalCny === 3000 &&
    JSON.stringify(result.orders['Z'].lots) === JSON.stringify([{ receiptId: 'R0', cny: 1000 }, { receiptId: 'R1', cny: 2000 }]),
    JSON.stringify(result.orders['Z']));
})();

// ---- saveChinaReport: validation, refusal, no-op, upsert, movements, pruning ----
(function () {
  const h = withChina();
  let msg = '';
  try { h.saveChinaReport({ reportDate: '2026-08-20', source: 'скрипт', orders: [{ orderNo: '' }], receipts: [] }, 'Николай'); }
  catch (e) { msg = e.message; }
  check('81g-1: a report with an order missing its number is refused',
    msg.indexOf('номер заказа') !== -1, msg);

  msg = '';
  try {
    h.saveChinaReport({
      reportDate: '2026-08-20', source: 'скрипт', orders: [],
      receipts: [{ date: '2026-01-01', goodsCny: 10 }, { date: '2026-01-01', goodsCny: 20 }]
    }, 'Николай');
  } catch (e) { msg = e.message; }
  check('81g-1: two receipts on the same date in one report is refused (the browser must group them)',
    msg.indexOf('одну дату') !== -1, msg);

  const firstPayload = {
    reportDate: '2026-08-20', source: 'скрипт', carriedOverCny: 17402,
    orders: [
      { orderNo: '28', date: '2026-01-01', receivedCny: 51706 },
      { orderNo: '29', date: '2026-01-25', receivedCny: 6300 },
      { orderNo: '30', date: '2026-03-01', receivedCny: 6955 }
    ],
    receipts: [
      { date: '2026-01-15', goodsCny: 34304 }, { date: '2026-01-29', goodsCny: 6300 }, { date: '2026-03-05', goodsCny: 6955 }
    ]
  };
  const first = h.saveChinaReport(firstPayload, 'Николай');
  check('81g-1: the first report warns nothing (an exact baseline)', first.warnings.length === 0, JSON.stringify(first.warnings));

  const reports = h.dumpChinaSheet('Отчёты');
  check('81g-1: the report itself is stored, one row', reports.length === 1, JSON.stringify(reports));
  const receiptRows = h.dumpChinaSheet('Поступления');
  check('81g-1: 结转 plus the three grouped receipts, four rows total, история before tracking',
    receiptRows.length === 4 && receiptRows.every(function (r) { return r['Статус'] === 'история'; }),
    JSON.stringify(receiptRows));
  check('81g-1: chinaReceiptStatus() at the exact boundary — 2026-08-01 itself already counts as tracked',
    h.context.chinaReceiptStatus('2026-08-01') === 'ждёт оплату' && h.context.chinaReceiptStatus('2026-07-31') === 'история',
    h.context.chinaReceiptStatus('2026-08-01') + ' / ' + h.context.chinaReceiptStatus('2026-07-31'));
  const movementRows = h.dumpChinaSheet('Движения заказов');
  check('81g-1: the first report\'s movements are its orders\' own baselines, from 0',
    movementRows.length === 3 && movementRows.every(function (r) { return String(r['Отчёт']) === reports[0]['ID']; }),
    JSON.stringify(movementRows));

  // Refusal of an older report.
  msg = '';
  try { h.saveChinaReport({ reportDate: '2026-08-19', source: 'скрипт', orders: [], receipts: [] }, 'Николай'); }
  catch (e) { msg = e.message; }
  check('81g-1: a report older than the newest stored one is refused', msg.indexOf('старше') !== -1, msg);

  // No-op on the TRULY identical report (same date AND same content).
  const before = h.dumpChinaSheet('Поступления').length;
  const again = h.saveChinaReport(firstPayload, 'Николай');
  check('81g-1: a report identical in content to the newest is a no-op, no warnings',
    h.dumpChinaSheet('Поступления').length === before && again.warnings.length === 0 &&
    h.dumpChinaSheet('Отчёты').length === 1,
    JSON.stringify(again.warnings));
  // A true no-op must not touch the sheet AT ALL — proven by advancing the fake clock and
  // checking the report's own «Загружен» stamp stayed put, not merely that the row count did.
  const loadedBefore = h.dumpChinaSheet('Отчёты')[0]['Загружен'];
  h.setNow('2026-01-06T09:00:00Z');
  h.saveChinaReport(firstPayload, 'Николай');
  check('81g-1: a true no-op does not even rewrite the report row (its «Загружен» stays put)',
    h.dumpChinaSheet('Отчёты')[0]['Загружен'] === loadedBefore, h.dumpChinaSheet('Отчёты')[0]['Загружен']);
  h.setNow('2026-01-05T09:00:00Z');

  // Coordinator review, 2026-09-25: the SAME reportDate with DIFFERENT content — the Chinese
  // side moved 1000 ¥ from order 29 to order 30 with NO new report date at all, exactly the
  // owner's own case — must be APPLIED (a revision), not dropped as a no-op.
  const revised = h.saveChinaReport({
    reportDate: '2026-08-20', source: 'скрипт', carriedOverCny: 17402,
    orders: [
      { orderNo: '28', date: '2026-01-01', receivedCny: 51706 },
      { orderNo: '29', date: '2026-01-25', receivedCny: 5300 },  // Δ = -1000
      { orderNo: '30', date: '2026-03-01', receivedCny: 7955 }   // Δ = +1000
    ],
    receipts: [
      { date: '2026-01-15', goodsCny: 34304 }, { date: '2026-01-29', goodsCny: 6300 }, { date: '2026-03-05', goodsCny: 6955 }
    ]
  }, 'Николай');
  check('81g-1: same-date content change is APPLIED, not dropped as a no-op',
    h.dumpChinaSheet('Отчёты').length === 1 && revised.warnings.length === 0, JSON.stringify(revised));
  const revisedMovements = h.dumpChinaSheet('Движения заказов');
  // The movement journal is append-only: the 3 baseline rows stay, the revision appends only its delta vs the pre-revision content.
  check('81g-1: the revision appends the 1000 yuan that moved (-1000 for 29, +1000 for 30) after the 3 untouched baseline rows',
    revisedMovements.length === 5 &&
    revisedMovements.filter(function (r) { return r['Номер заказа'] === '29' && r['Изменение ¥'] === -1000; }).length === 1 &&
    revisedMovements.filter(function (r) { return r['Номер заказа'] === '30' && r['Изменение ¥'] === 1000; }).length === 1,
    JSON.stringify(revisedMovements));
  check('81g-1: per order the journal rows sum to the revised receivedCny (28: 51706, 29: 5300, 30: 7955)',
    [['28', 51706], ['29', 5300], ['30', 7955]].every(function (e) {
      return revisedMovements.filter(function (r) { return r['Номер заказа'] === e[0]; })
        .reduce(function (a, r) { return a + Number(r['Изменение ¥']); }, 0) === e[1];
    }), JSON.stringify(revisedMovements));
  check('81g-1: the goods pool allocation reflects the revised content immediately',
    (function () {
      const ar = h.dumpChinaSheet('Отчёты').map(function (r) {
        const parsed = JSON.parse(r['Данные (JSON)']);
        return { id: r['ID'], reportDate: r['Дата отчёта'], orders: parsed.orders };
      });
      const rc = h.dumpChinaSheet('Поступления').map(function (r) {
        return { id: r['ID'], date: r['Дата'], goodsCny: r['Товар ¥'], status: r['Статус'], reportId: r['Отчёт'] };
      });
      const alloc = h.chinaAllocateGoodsLedger(ar, rc);
      return alloc.orders['29'].totalCny === 5300 && alloc.orders['30'].totalCny === 7955;
    })(), JSON.stringify(h.dumpChinaSheet('Отчёты')));

  // Second report (a genuinely NEW date, after the same-date revision above already settled
  // 29/30 at 5300/7955): a changed amount on a known date warns; a new grouped date joins the
  // pool; a FURTHER 500 ¥ moves from order 30 back to order 29.
  const second = h.saveChinaReport({
    reportDate: '2026-09-16', source: 'ИИ', aiReason: 'файл не читался парсером',
    orders: [
      { orderNo: '28', date: '2026-01-01', receivedCny: 51706 },
      { orderNo: '29', date: '2026-01-25', receivedCny: 5800 },
      { orderNo: '30', date: '2026-03-01', receivedCny: 7455 }
    ],
    receipts: [
      { date: '2026-01-15', goodsCny: 34305 }, // changed by 1 ¥ from the first report
      { date: '2026-01-29', goodsCny: 6300 }, { date: '2026-03-05', goodsCny: 6955 },
      { date: '2026-06-08', goodsCny: 11559 }, { date: '2026-06-19', goodsCny: 7359 }
    ]
  }, 'Николай');
  check('81g-1: a receipt whose amount changed since the last report warns, by name',
    second.warnings.some(function (w) { return w.indexOf('2026-01-15') !== -1 && w.indexOf('изменилось') !== -1; }),
    JSON.stringify(second.warnings));
  check('81g-1: the source and the AI reason of a report are stored',
    h.dumpChinaSheet('Отчёты')[1]['Источник'] === 'ИИ' && h.dumpChinaSheet('Отчёты')[1]['Причина ИИ'] === 'файл не читался парсером',
    JSON.stringify(h.dumpChinaSheet('Отчёты')[1]));
  check('81g-1: a changed receipt keeps its date and status, only the money moves',
    h.dumpChinaSheet('Поступления').filter(function (r) { return r['Дата'] === '2026-01-15'; })[0]['Товар ¥'] === 34305,
    JSON.stringify(h.dumpChinaSheet('Поступления')));

  const movementRows2 = h.dumpChinaSheet('Движения заказов').filter(function (r) { return r['Дата отчёта'] === '2026-09-16'; });
  check('81g-1: the second report records only orders that actually moved (28 stayed put)',
    movementRows2.length === 2 &&
    movementRows2.some(function (r) { return r['Номер заказа'] === '29' && r['Изменение ¥'] === 500; }) &&
    movementRows2.some(function (r) { return r['Номер заказа'] === '30' && r['Изменение ¥'] === -500; }),
    JSON.stringify(movementRows2));

  // Keep-3 pruning: two more reports push the total to 4 stored — only the 3 newest survive.
  h.saveChinaReport({ reportDate: '2026-09-20', source: 'скрипт', orders: [], receipts: [] }, 'Николай');
  h.saveChinaReport({ reportDate: '2026-09-24', source: 'скрипт', orders: [], receipts: [] }, 'Николай');
  const kept = h.dumpChinaSheet('Отчёты').map(function (r) { return r['Дата отчёта']; }).sort();
  check('81g-1: only the 3 newest reports are kept',
    JSON.stringify(kept) === JSON.stringify(['2026-09-16', '2026-09-20', '2026-09-24']), JSON.stringify(kept));

  // The receipts sheet, unlike the reports sheet, is NEVER pruned — the ledger the allocation
  // depends on has to survive even after its introducing report is gone.
  check('81g-1: pruning the reports sheet never touches the receipts ledger',
    h.dumpChinaSheet('Поступления').length === 6, JSON.stringify(h.dumpChinaSheet('Поступления')));
})();

// ---- new columns of «Партии»/«Платежи» are schema-only: an unrelated save preserves them ----
(function () {
  const h = withChina();
  h.saveChinaBatch(batch28Payload({}), 'Николай');
  // Poking the raw cell is the only way to give it a value in 81g-1 — no action writes
  // «Проверка» yet (that is 81g-3); this proves the schema survives until it does.
  const batchSheet = h.getTargetSheet('Партии');
  const batchHead = h.headerRowOf(batchSheet);
  const checkCol = batchHead.indexOf('Проверка') + 1;
  batchSheet.getRange(2, checkCol, 1, 1).setValues([['скрипт']]);
  h.saveChinaBatchCost({ batchId: 'CB1', kind: 'Разгрузка', amountRub: 500, date: '2026-09-20' }, 'Николай');
  check('81g-1: a Russian-side cost recost does not blank «Проверка» set by hand',
    h.getChinaBatches().batches[0].checkMark === 'скрипт', JSON.stringify(h.getChinaBatches().batches[0].checkMark));

  h.saveChinaPayment({ date: '2026-09-01', amountRub: 10000, rate: 12.4, orderNo: '28' }, 'Николай');
  const paySheet = h.getTargetSheet('Платежи');
  const payHead = h.headerRowOf(paySheet);
  const statusCol = payHead.indexOf('Статус') + 1;
  paySheet.getRange(2, statusCol, 1, 1).setValues([['распределена']]);
  h.saveChinaPayment({ id: 'CP1', date: '2026-09-01', amountRub: 10000, rate: 12.4, orderNo: '28', comment: 'правка' }, 'Николай');
  const payments = h.getChinaBatches().payments;
  check('81g-1: editing an existing payment does not blank «Статус» set by hand',
    payments[0].status === 'распределена' && payments[0].comment === 'правка',
    JSON.stringify(payments[0]));
})();

// ================= Item 81g-2: payment matching, freight FIFO, getChinaMoney() =================
//
// Real numbers from the owner's own report (2026-09-24, docs/OZON_PLAN.md 81g dossier): goods
// and freight ¥ grouped by date, the 结转 carry-over 17 402 ¥, and the two real batches'
// freight bills (NV-0825-2 order 28: 1 636,75 $ at 7; NV-0923-4 order 30: 2 645,85 $ at 7).
// Every figure below was derived independently in Python first (china81g2.py) — see the report.
// Order dates/receivedCny groupings are this test's OWN construction (the FIFO baseline that
// exactly exhausts every real receipt with 0 shortfall — proof the money in and the money out
// of the pool conserve exactly), not lifted verbatim from the fixture.

(function () {
  const h = withChina();
  const report = h.saveChinaReport({
    reportDate: '2026-09-24', source: 'скрипт', carriedOverCny: 17402,
    orders: [
      { orderNo: '28', date: '2026-01-01', receivedCny: 51706, totalCny: 51706 },
      { orderNo: '29', date: '2026-01-20', receivedCny: 6300, totalCny: 25000 },
      { orderNo: '30', date: '2026-02-01', receivedCny: 31291, totalCny: 31291 },
      { orderNo: '31', date: '2026-04-10', receivedCny: 97841, totalCny: 97841 }
    ],
    receipts: [
      { date: '2026-01-15', goodsCny: 34304, freightCny: 37491 },
      { date: '2026-01-29', goodsCny: 6300, freightCny: 11321 },
      { date: '2026-03-05', goodsCny: 6955 },
      { date: '2026-04-02', goodsCny: 24336, freightCny: 20601 },
      { date: '2026-05-22', goodsCny: 37468, freightCny: 16103 },
      { date: '2026-06-08', goodsCny: 11559, freightCny: 17262 },
      { date: '2026-06-19', goodsCny: 7359 },
      { date: '2026-07-21', goodsCny: 5668 },
      { date: '2026-07-24', goodsCny: 352, freightCny: 8606 },
      { date: '2026-08-04', goodsCny: 4819 },
      { date: '2026-08-20', goodsCny: 10415, freightCny: 16303 },
      { date: '2026-08-27', goodsCny: 12226, freightCny: 10416 },
      { date: '2026-09-03', goodsCny: 2974 },
      { date: '2026-09-16', goodsCny: 5001, freightCny: 2462 },
      { date: '2026-09-18', freightCny: 9328 }
    ],
    freights: [
      { code: 'NV-0825-2', orderNo: '28', amountUsd: 1636.75, cargoRate: 7 },
      { code: 'NV-0923-4', orderNo: '30', amountUsd: 2645.85, cargoRate: 7 }
    ]
  }, 'Николай');
  check('81g-2: the whole real receipt set is consumed with 0 shortfall — a clean baseline',
    report.warnings.length === 0, JSON.stringify(report.warnings));

  // Three payments that match a real receipt EXACTLY (the report's own text even shows the
  // arithmetic: 08-20 26 718 ¥, 09-16 7 463 ¥, 09-18 9 328 ¥), and one 1 ¥ rounding case
  // (08-27's receipt totals 22 642 ¥; the payment implies 22 641 ¥, 12,4 typed).
  h.saveChinaPayment({ id: '', date: '2026-08-20', amountRub: 331303.20, rate: 12.4, comment: 'P1' }, 'Николай');
  h.saveChinaPayment({ date: '2026-09-16', amountRub: 92541.20, rate: 12.4, comment: 'P2' }, 'Николай');
  h.saveChinaPayment({ date: '2026-08-27', amountRub: 280748.40, rate: 12.4, comment: 'P4 rounding' }, 'Николай');
  h.saveChinaPayment({ date: '2026-09-18', amountRub: 116600, rate: 12.5, comment: 'P3' }, 'Николай');

  const money = h.getChinaMoney();
  check('81g-2: all four payments auto-matched, none left «не распределена»',
    money.payments.every(function (p) { return p.status === 'распределена'; }),
    JSON.stringify(money.payments.map(function (p) { return p.status; })));

  const p1 = money.payments.filter(function (p) { return p.comment === 'P1'; })[0];
  check('81g-2: P1 — actual rate and the exact ₽ split (goods/freight sum to amountRub)',
    p1.actualRate === 12.4 && p1.reportCny === 26718 &&
    money.receipts.filter(function (r) { return r.id === p1.receiptId; })[0].rubGoods === 129146 &&
    money.receipts.filter(function (r) { return r.id === p1.receiptId; })[0].rubFreight === 202157.2,
    JSON.stringify(p1) + ' / ' + JSON.stringify(money.receipts.filter(function (r) { return r.id === p1.receiptId; })[0]));

  const p4 = money.payments.filter(function (p) { return p.comment === 'P4 rounding'; })[0];
  check('81g-2: P4 — the 1 ¥ rounding case matches anyway, actual rate reflects the real ¥',
    p4.actualRate === 12.3995 && p4.reportCny === 22642,
    JSON.stringify(p4));

  const p3 = money.payments.filter(function (p) { return p.comment === 'P3'; })[0];
  check('81g-2: P3 — an all-freight receipt (no goods that day) puts everything into rubFreight',
    p3.actualRate === 12.5 &&
    money.receipts.filter(function (r) { return r.id === p3.receiptId; })[0].rubGoods === 0 &&
    money.receipts.filter(function (r) { return r.id === p3.receiptId; })[0].rubFreight === 116600,
    JSON.stringify(money.receipts.filter(function (r) { return r.id === p3.receiptId; })[0]));

  const order31 = money.orders.filter(function (o) { return o.orderNo === '31'; })[0];
  check('81g-2: order 31 — known/pending/history sum to its own receivedCny, rate 12,3998',
    order31.knownCny === 27642 && order31.knownRub === 342754.1 && order31.rate === 12.3998 &&
    // history = 05-22..07-24 (before 2026-08-01 tracking start); pending = 08-04 + 09-03
    // (after tracking start, no payment matched them) — 08-04 is easy to place in the wrong
    // bucket by eye since it LOOKS like the others, but the boundary is the date, not the group.
    order31.historyCny === 62406 && order31.pendingCny === 7793 &&
    order31.knownCny + order31.historyCny + order31.pendingCny === order31.receivedCny,
    JSON.stringify(order31));
  check('81g-2: orders 28/29/30 touch none of the matched receipts — pure history, rate 0',
    money.orders.filter(function (o) { return ['28', '29', '30'].indexOf(o.orderNo) !== -1; })
      .every(function (o) { return o.knownCny === 0 && o.rate === 0 && o.historyCny === o.receivedCny; }),
    JSON.stringify(money.orders));
  check('81g-2: order 29 (no bill, 6 300 of 25 000 = 25,2 %) is flagged below the 30 % advance',
    order31.advanceWarning === false &&
    money.orders.filter(function (o) { return o.orderNo === '29'; })[0].advanceWarning === true &&
    money.orders.filter(function (o) { return o.orderNo === '28'; })[0].advanceWarning === false,
    JSON.stringify(money.orders.map(function (o) { return o.orderNo + ':' + o.advanceWarning; })));

  check('81g-2: the goods pool is empty — every ¥ landed on an order, nothing left «у китайцев»',
    money.pool.cny === 0, JSON.stringify(money.pool));

  // Freight FIFO is tested separately below, in $ — see «Item 81g-2 review» further down: the
  // coordinator found the ¥-based FIFO here wrong (bills are billed in $, and the report's own
  // per-transfer $ credits do not reduce to one batch-wide cargo rate).
})();

// ================= Item 81g-2 review (2026-09-25): freight FIFO runs in DOLLARS =============
//
// Root cause the coordinator found: bills are billed in $ (amountUsd) and every freight
// payment ROW of the report credits an EXPLICIT $ amount of its own (not `freightCny / one
// cargo rate` — the carrier's own notes divide by DIFFERENT rates row to row, e.g.
// "37491/7.25=5171", "2466*7=17262"). The FIFO must consume $ against $, in report list order
// for bills and receipt DATE order for payments; a slice's ¥ (and, once matched, ₽) is that
// receipt's OWN freight ¥/₽ pro rata to the $ share taken. The opening balance's SIGN decides
// what it is: negative = a CREDIT (an extra payment before everything, always history);
// positive = a DEBT (an unresolved bill from before tracking, paid off first, ahead of every
// real bill). Reproduced first with a failing check on the OLD (¥, one rate) behavior, then
// fixed; independent numbers below are the coordinator's own (not re-derivable by me from the
// dossier's paraphrased carrier notes, which is why this scenario states its $ figures as
// GIVEN rather than parsed from ¥ figures — china81g2_freight_fix.py, scratchpad).
(function () {
  const h = withChina();
  const receipts = [
    { date: '2026-07-24', goodsCny: 0, freightCny: 8606, freightUsd: 109 },
    { date: '2026-08-20', goodsCny: 0, freightCny: 16303, freightUsd: 2329 },
    { date: '2026-08-27', goodsCny: 0, freightCny: 10416, freightUsd: 1488 },
    { date: '2026-09-16', goodsCny: 0, freightCny: 2462, freightUsd: 351 },
    { date: '2026-09-18', goodsCny: 0, freightCny: 9328, freightUsd: 1332 }
  ];
  const freights = [
    { code: 'NV-0716-3', orderNo: '27', amountUsd: 2438, cargoRate: 7 },
    { code: 'NV-0703-23', orderNo: '26', amountUsd: 1488, cargoRate: 7 },
    { code: 'NV-0825-2', orderNo: '28', amountUsd: 1637, cargoRate: 7 },
    { code: 'NV-0916-24', orderNo: '29', amountUsd: 1109, cargoRate: 7 },
    { code: 'NV-0923-4', orderNo: '30', amountUsd: 2646, cargoRate: 7 }
  ];
  h.saveChinaReport({
    reportDate: '2026-09-24', source: 'скрипт',
    orders: [{ orderNo: '27', date: '2026-01-01', receivedCny: 1 }],
    receipts: receipts, freights: freights
  }, 'Николай');
  const reportRow = h.dumpChinaSheet('Отчёты')[0];
  const parsed = JSON.parse(reportRow['Данные (JSON)']);
  const receiptRows = h.dumpChinaSheet('Поступления').map(function (r) {
    return {
      id: r['ID'], date: r['Дата'], goodsCny: r['Товар ¥'], freightCny: r['Доставка ¥'],
      freightUsd: r['Доставка $'], status: r['Статус'], rubFreight: r['₽ доставка']
    };
  });

  const alloc = h.chinaAllocateFreightLedger(parsed.freights, receiptRows, 0);
  check('81g-2 review: every $ bill is accounted for — 3 709 $ unpaid in total, matching the report\'s own 总计',
    Object.keys(alloc.bills).length === 5 &&
    roundToTwoLocal(Object.keys(alloc.bills).reduce(function (s, c) { return s + alloc.bills[c].unpaidUsd; }, 0)) === 3709,
    JSON.stringify(Object.keys(alloc.bills).map(function (c) { return c + ':' + alloc.bills[c].unpaidUsd; })));
  check('81g-2 review: NV-0716-3 and NV-0703-23 are fully paid, 0 $ left owing',
    alloc.bills['NV-0716-3'].unpaidUsd === 0 && alloc.bills['NV-0703-23'].unpaidUsd === 0,
    JSON.stringify([alloc.bills['NV-0716-3'], alloc.bills['NV-0703-23']]));
  check('81g-2 review: NV-0825-2 closes from TWO payments (09-16 + part of 09-18), 0 $ left owing',
    alloc.bills['NV-0825-2'].unpaidUsd === 0 && alloc.bills['NV-0825-2'].paidUsd === 1637 &&
    alloc.bills['NV-0825-2'].slices.length === 2,
    JSON.stringify(alloc.bills['NV-0825-2']));
  check('81g-2 review: NV-0916-24 gets only the 46 $ left over from 09-18, 1 063 $ still unpaid',
    alloc.bills['NV-0916-24'].paidUsd === 46 && alloc.bills['NV-0916-24'].unpaidUsd === 1063,
    JSON.stringify(alloc.bills['NV-0916-24']));
  check('81g-2 review: NV-0923-4 gets NOTHING — the exact defect the coordinator caught',
    alloc.bills['NV-0923-4'].paidUsd === 0 && alloc.bills['NV-0923-4'].unpaidUsd === 2646,
    JSON.stringify(alloc.bills['NV-0923-4']));

  // ¥ of a slice is that receipt's OWN freight ¥ pro rata to the $ taken: 09-18 gives NV-0825-2
  // 1 286 of its 1 332 $ (9 328 ¥) → round2(9328 × 1286/1332) = 9 005,86 ¥; the rest (46 $) goes
  // to NV-0916-24 → round2(9328 × 46/1332) = 322,14 ¥ — the two happen to sum to exactly 9 328
  // here (no rounding drift this time, unlike the goods-side example elsewhere in this module).
  const nv0825slice0918 = alloc.bills['NV-0825-2'].slices.filter(function (s) { return s.receiptId === receiptRows[4].id; })[0];
  const nv0916slice = alloc.bills['NV-0916-24'].slices[0];
  check('81g-2 review: a slice\'s ¥ is pro rata to its $ share of the RECEIPT, not the bill',
    nv0825slice0918.usd === 1286 && nv0825slice0918.cny === 9005.86 &&
    nv0916slice.usd === 46 && nv0916slice.cny === 322.14,
    JSON.stringify({ nv0825slice0918: nv0825slice0918, nv0916slice: nv0916slice }));
})();

// ---- opening balance sign: negative = credit (extra payment, history); positive = debt ----
(function () {
  const h = withChina();
  h.saveChinaReport({
    reportDate: '2026-01-01', source: 'скрипт', openingFreightUsd: -85,
    orders: [{ orderNo: 'A', date: '2026-01-01', receivedCny: 1 }],
    freights: [{ code: 'B1', orderNo: 'A', amountUsd: 85, cargoRate: 7 }]
  }, 'Николай');
  const alloc = h.chinaAllocateFreightLedger([{ code: 'B1', orderNo: 'A', amountUsd: 85, cargoRate: 7 }], [], -85);
  check('81g-2 review: a NEGATIVE opening balance is a credit that pays a bill with no receipts at all',
    alloc.bills['B1'].paidUsd === 85 && alloc.bills['B1'].unpaidUsd === 0 && alloc.bills['B1'].historyCny === 0,
    JSON.stringify(alloc.bills['B1']));

  const allocDebt = h.chinaAllocateFreightLedger(
    [{ code: 'B2', orderNo: 'A', amountUsd: 50, cargoRate: 7 }],
    [{ id: 'RX', date: '2026-01-01', freightCny: 700, freightUsd: 100, status: 'история' }],
    30 // POSITIVE — a debt, consumed before bill B2
  );
  check('81g-2 review: a POSITIVE opening balance is a debt, paid off BEFORE the real bill',
    // The receipt provides 100 $; 30 $ pays the opening debt FIRST, leaving 70 $ for bill B2 —
    // which only wants 50 $, so it is fully paid with 20 $ left over, never touched here.
    allocDebt.bills['B2'].paidUsd === 50 && allocDebt.bills['B2'].unpaidUsd === 0,
    JSON.stringify(allocDebt.bills['B2']));
})();

// ---- advanceWarning: exactly 30 %, not 50 % — and only while no carrier bill exists yet ----
(function () {
  const h = withChina();
  h.saveChinaReport({
    reportDate: '2026-01-01', source: 'скрипт',
    orders: [
      { orderNo: 'U', date: '2026-01-01', receivedCny: 4000, totalCny: 10000 }, // 40 %: unbilled, 30–50 % gap
      { orderNo: 'B', date: '2026-01-01', receivedCny: 1000, totalCny: 10000 }  // 10 %, but BILLED already
    ],
    receipts: [{ date: '2026-01-01', goodsCny: 5000 }],
    freights: [{ code: 'NVX', orderNo: 'B', amountUsd: 100, cargoRate: 7 }]
  }, 'Николай');
  const money = h.getChinaMoney();
  const u = money.orders.filter(function (o) { return o.orderNo === 'U'; })[0];
  const b = money.orders.filter(function (o) { return o.orderNo === 'B'; })[0];
  check('81g-2: 40 % of goods paid is ABOVE the 30 % advance floor — no warning',
    u.advanceWarning === false, JSON.stringify(u));
  check('81g-2: 10 % of goods paid would warn, but a carrier bill already exists for this order',
    b.advanceWarning === false, JSON.stringify(b));
})();

// ---- chinaAutoMatchPending processes payments oldest-first: an earlier payment claims a
// contested receipt before a later, equally valid, payment gets to compete for it ----
(function () {
  const h = withChina();
  // Both payments are created BEFORE any receipt exists at all — each auto-match on its own
  // creation finds 0 candidates and stays pending. Only saveChinaReport's OWN sweep (below),
  // which considers BOTH of them together, can put the "process oldest first" rule to the test.
  h.saveChinaPayment({ date: '2026-01-01', amountRub: 12400, rate: 12.4, comment: 'later' }, 'Николай');
  h.saveChinaPayment({ date: '2025-12-30', amountRub: 12400, rate: 12.4, comment: 'earlier' }, 'Николай');
  const result = h.saveChinaReport({
    reportDate: '2026-01-01', source: 'скрипт',
    orders: [{ orderNo: 'Z', date: '2026-01-01', receivedCny: 1000 }],
    receipts: [{ date: '2026-01-01', goodsCny: 1000 }]
  }, 'Николай');
  const earlier = result.payments.filter(function (p) { return p.comment === 'earlier'; })[0];
  const later = result.payments.filter(function (p) { return p.comment === 'later'; })[0];
  check('81g-2: the OLDER payment claims the contested receipt, the newer stays pending',
    earlier.status === 'распределена' && later.status === 'не распределена',
    JSON.stringify({ earlier: earlier.status, later: later.status }));
})();

// ---- getChinaMoney lists reports NEWEST first ----
(function () {
  const h = withChina();
  h.saveChinaReport({ reportDate: '2026-01-01', source: 'скрипт', orders: [], receipts: [] }, 'Николай');
  h.saveChinaReport({ reportDate: '2026-02-01', source: 'скрипт', orders: [], receipts: [] }, 'Николай');
  const reports = h.getChinaMoney().reports;
  check('81g-2: getChinaMoney lists reports newest-first',
    reports.length === 2 && reports[0].reportDate === '2026-02-01' && reports[1].reportDate === '2026-01-01',
    JSON.stringify(reports));
})();

// ---- chinaMatchInternal: rubFreight is the REMAINDER, never a second independent rounding —
// found by search (china81g2.py): 8 631 ₽ over 7 116,78/836,34 ¥ rounds rubGoods and an
// independent freight rounding to 907,63 while the true remainder is 907,62; the two must
// always sum to amountRub exactly, whichever direction the kopeck falls. ----
(function () {
  const h = withChina();
  h.saveChinaReport({
    reportDate: '2026-01-01', source: 'скрипт',
    orders: [{ orderNo: 'X', date: '2026-01-01', receivedCny: 7953.12 }],
    receipts: [{ date: '2026-01-01', goodsCny: 7116.78, freightCny: 836.34 }]
  }, 'Николай');
  h.saveChinaPayment({ date: '2026-01-01', amountRub: 8631, rate: 1.0855054, comment: 'split' }, 'Николай');
  const r = h.dumpChinaSheet('Поступления')[0];
  check('81g-2: rubGoods + rubFreight sum to amountRub EXACTLY, even where independent rounding would not',
    Number(r['₽ товар']) === 7723.38 && Number(r['₽ доставка']) === 907.62 &&
    roundToTwoLocal(Number(r['₽ товар']) + Number(r['₽ доставка'])) === 8631,
    JSON.stringify(r));
})();
function roundToTwoLocal(x) { return Math.round(x * 100) / 100; }

// ---- tolerance is max(1 ¥, 1 %), not just 1 % — a small receipt needs the floor ----
(function () {
  const h = withChina();
  h.saveChinaReport({
    reportDate: '2026-01-01', source: 'скрипт',
    orders: [{ orderNo: 'S', date: '2026-01-01', receivedCny: 50 }],
    receipts: [{ date: '2026-01-01', goodsCny: 50 }] // 1 % of 50 ¥ is 0,5 — the floor of 1 ¥ is what actually matters
  }, 'Николай');
  // implies 50,8 ¥ against a 50 ¥ receipt — 0,8 ¥ off, inside max(1, 0.5)=1 but outside 0,5 alone
  const result = h.saveChinaPayment({ date: '2026-01-01', amountRub: 630, rate: 12.4, comment: 'floor' }, 'Николай');
  check('81g-2: the 1 ¥ FLOOR of the tolerance lets a small receipt match despite exceeding its own 1 %',
    result.payments[0].status === 'распределена', JSON.stringify(result.payments[0]));
})();

// ---- the matching window is [date, +3 DAYS] inclusive, not +2 ----
(function () {
  const h = withChina();
  h.saveChinaReport({
    reportDate: '2026-01-01', source: 'скрипт',
    orders: [{ orderNo: 'W', date: '2026-01-01', receivedCny: 1000 }],
    receipts: [{ date: '2026-01-04', goodsCny: 1000 }] // exactly +3 days from the payment
  }, 'Николай');
  const result = h.saveChinaPayment({ date: '2026-01-01', amountRub: 12400, rate: 12.4, comment: 'window' }, 'Николай');
  check('81g-2: a receipt dated exactly payment date + 3 days still matches',
    result.payments[0].status === 'распределена', JSON.stringify(result.payments[0]));
})();

// ---- chinaPaymentCandidates itself excludes an already-matched receipt, not just its callers ----
(function () {
  const h = withChina();
  const payment = { date: '2026-01-01', amountRub: 12400, rate: 12.4 };
  const receipts = [{ id: 'R1', date: '2026-01-01', goodsCny: 1000, status: 'сопоставлено' }];
  check('81g-2: chinaPaymentCandidates itself refuses a receipt already «сопоставлено» — not merely its callers',
    h.chinaPaymentCandidates(payment, receipts).length === 0,
    JSON.stringify(h.chinaPaymentCandidates(payment, receipts)));
})();

// ---- a payment never dangles on an already-matched receipt as a "candidate" ----
(function () {
  const h = withChina();
  h.saveChinaReport({
    reportDate: '2026-01-01', source: 'скрипт',
    orders: [{ orderNo: 'M', date: '2026-01-01', receivedCny: 1000 }],
    receipts: [{ date: '2026-01-01', goodsCny: 1000 }]
  }, 'Николай');
  // The first payment claims the only receipt outright.
  h.saveChinaPayment({ date: '2026-01-01', amountRub: 12400, rate: 12.4, comment: 'first' }, 'Николай');
  // A second payment that would ALSO fit that same receipt must NOT list it as a candidate —
  // it is already spoken for — and so must stay pending with an EMPTY candidate list.
  const money = h.saveChinaPayment({ date: '2026-01-01', amountRub: 12400, rate: 12.4, comment: 'second' }, 'Николай');
  const second = money.payments.filter(function (p) { return p.comment === 'second'; })[0];
  check('81g-2: a payment competing for an ALREADY MATCHED receipt gets no candidates at all',
    second.status === 'не распределена' && h.getChinaMoney().payments.filter(function (p) { return p.comment === 'second'; })[0].candidates.length === 0,
    JSON.stringify(second));
})();

// ---- two candidates for one payment stays pending (the contract's own tie-break rule) ----
(function () {
  const h = withChina();
  h.saveChinaReport({
    reportDate: '2026-01-01', source: 'скрипт',
    orders: [{ orderNo: 'A', date: '2026-01-01', receivedCny: 20000 }],
    receipts: [{ date: '2026-08-05', goodsCny: 10000 }, { date: '2026-08-07', goodsCny: 10010 }]
  }, 'Николай');
  // Both receipts (¥ 10 000 and 10 010) fall inside the payment's [date, +3 days] window and
  // both are within 1 % of the implied ¥ (10 005) — genuinely ambiguous.
  const result = h.saveChinaPayment({ date: '2026-08-05', amountRub: 124062, rate: 12.4, comment: 'ambiguous' }, 'Николай');
  const payment = result.payments[0];
  check('81g-2: a payment with two equally good candidates stays «не распределена»',
    payment.status === 'не распределена', JSON.stringify(payment));
  const money = h.getChinaMoney();
  check('81g-2: getChinaMoney lists both candidates for the still-pending payment',
    money.payments[0].candidates.length === 2, JSON.stringify(money.payments[0].candidates));

  // The owner resolves it by hand.
  const matched = h.matchChinaPayment({ paymentId: payment.id, receiptId: money.payments[0].candidates[0] }, 'Николай');
  check('81g-2: matchChinaPayment resolves the ambiguity by hand',
    matched.payments[0].status === 'распределена', JSON.stringify(matched.payments[0]));
  const unmatched = h.unmatchChinaPayment({ paymentId: payment.id }, 'Николай');
  check('81g-2: unmatchChinaPayment puts it right back to pending, with both candidates again',
    unmatched.payments[0].status === 'не распределена' &&
    h.getChinaMoney().payments[0].candidates.length === 2,
    JSON.stringify(unmatched.payments[0]));
})();

// ---- deleteChinaPayment unmatches first; old orderNo/purpose rows still load ----
(function () {
  const h = withChina();
  h.saveChinaReport({
    reportDate: '2026-01-01', source: 'скрипт',
    orders: [{ orderNo: 'A', date: '2026-01-01', receivedCny: 5000 }],
    receipts: [{ date: '2026-01-01', goodsCny: 5000 }]
  }, 'Николай');
  h.saveChinaPayment({ date: '2026-01-01', amountRub: 62000, rate: 12.4, comment: 'exact' }, 'Николай');
  const before = h.getChinaMoney();
  check('81g-2: setup — the payment matched the only receipt', before.payments[0].status === 'распределена', JSON.stringify(before.payments[0]));

  h.deleteChinaPayment({ id: before.payments[0].id }, 'Николай');
  const after = h.getChinaMoney();
  check('81g-2: deleteChinaPayment unmatches first — the receipt is free again, not orphaned',
    after.payments.length === 0 && after.receipts[0].status !== 'сопоставлено' && after.receipts[0].paymentId === '',
    JSON.stringify(after.receipts[0]));

  // An OLD payment row (orderNo/purpose, no matching columns at all) must still load.
  h.getTargetSheet('Платежи').appendRow(['CPOLD', '2026-01-01', 1000, 12.4, 80.65, 'Товар', 'A', '', '', 'Николай']);
  const withOld = h.getChinaMoney();
  check('81g-2: an old orderNo/purpose payment row (no 81g-2 columns at all) still loads',
    withOld.payments.some(function (p) { return p.id === 'CPOLD' && p.orderNo === 'A' && p.status === ''; }),
    JSON.stringify(withOld.payments));
})();

// ================= Item 81g-3: rates into chinaBatchCost, missing/closed/history ===============
//
// One order (40), one receipt (2026-09-05, 8 000 ¥ goods + 2 000 ¥ freight = 10 000 ¥ total),
// one payment (124 000 ₽ at 12.4 implies exactly 10 000 ¥ — an exact match), one freight bill
// (BATCH40, wants exactly the 200 $ that receipt's freightUsd provides — fully paid). Python:
// rubGoods = round2(124000×8000/10000) = 99 200, rubFreight = 24 800; order 40's known rate =
// 99200/8000 = 12.4; the bill's known rate = 24800/2000 = 12.4 (both rates equal on purpose —
// the SAME-rate code path is what most real batches hit). The batch itself: goods 1 000 ¥
// (12 400 ₽), freight 200 $ ×7 = 1 400 ¥ (17 360 ₽) → 29 760 ₽ total.
(function () {
  const h = withChina();
  h.saveChinaReport({
    reportDate: '2026-09-24', source: 'скрипт',
    // receivedCny is the order's GOODS ¥ only (8 000) — the goods pool allocation never sees
    // the receipt's freight ¥ part at all, that is a separate ledger (chinaAllocateFreightLedger).
    orders: [{ orderNo: '40', date: '2026-01-01', receivedCny: 8000, totalCny: 8000, unpaidCny: 0 }],
    receipts: [{ date: '2026-09-05', goodsCny: 8000, freightCny: 2000, freightUsd: 200 }],
    freights: [{ code: 'BATCH40', orderNo: '40', amountUsd: 200, cargoRate: 7 }]
  }, 'Николай');
  h.saveChinaPayment({ date: '2026-09-05', amountRub: 124000, rate: 12.4, comment: 'order 40' }, 'Николай');

  h.saveChinaBatch({
    orderNo: '40', code: 'BATCH40', status: 'Прибыла', shippedAt: '2026-09-01', arrivedAt: '2026-09-20',
    weightKg: 100, freightUsd: 200, cargoRate: 7, ratePerKgUsd: 2,
    lines: [{ marking: 'M1', name: 'x', boxes: 10, pcsPerBox: 5, qty: 50, priceCny: 20 }]
  }, 'Николай');

  const batch = h.getChinaBatches().batches.filter(function (b) { return b.code === 'BATCH40'; })[0];
  check('81g-3: goods rate resolved from the order\'s known ¥/₽ (ledger), source «оплаты»',
    batch.goodsRate === 12.4 && batch.goodsRateSource === 'оплаты', JSON.stringify({ goodsRate: batch.goodsRate, src: batch.goodsRateSource }));
  check('81g-3: freight rate resolved from the BILL\'s known ¥/₽ (ledger), source «оплаты»',
    batch.freightRate === 12.4 && batch.freightRateSource === 'оплаты', JSON.stringify({ freightRate: batch.freightRate, src: batch.freightRateSource }));
  check('81g-3: rubRate/rubRateSource stay the goods rate/source (backward compatibility)',
    batch.rubRate === 12.4 && batch.rubRateSource === 'оплаты', JSON.stringify({ rubRate: batch.rubRate, src: batch.rubRateSource }));
  check('81g-3: the batch itself costs 29 760 ₽ (goods 12 400 + freight 17 360)',
    batch.goodsRub === 12400 && batch.freightRub === 17360 && batch.totalRub === 29760,
    JSON.stringify({ goodsRub: batch.goodsRub, freightRub: batch.freightRub, totalRub: batch.totalRub }));
  check('81g-3: not history — the order/bill actually have known money',
    batch.history === false, JSON.stringify(batch.history));
  check('81g-3: not closed yet — Russian costs are not confirmed',
    batch.closed === false && batch.missing.indexOf('расходы РФ не подтверждены') !== -1,
    JSON.stringify(batch.missing));

  const after = h.setChinaRubCostsDone({ batchId: batch.id, done: true }, 'Николай');
  const batch2 = after.batches.filter(function (b) { return b.code === 'BATCH40'; })[0];
  check('81g-3: setChinaRubCostsDone closes the batch once nothing else is missing',
    batch2.rubCostsDone === true && batch2.closed === true && batch2.missing.length === 0,
    JSON.stringify({ rubCostsDone: batch2.rubCostsDone, closed: batch2.closed, missing: batch2.missing }));

  // checkMark/checkNote round trip through saveChinaBatch, and survive an unrelated recost.
  h.saveChinaBatch({ id: batch.id, orderNo: '40', code: 'BATCH40', status: 'Прибыла',
    shippedAt: '2026-09-01', arrivedAt: '2026-09-20', weightKg: 100, freightUsd: 200, cargoRate: 7,
    ratePerKgUsd: 2, lines: [{ marking: 'M1', name: 'x', boxes: 10, pcsPerBox: 5, qty: 50, priceCny: 20 }],
    checkMark: 'скрипт+ИИ', checkNote: 'проверено ИИ, расхождений нет' }, 'Николай');
  const marked = h.getChinaBatches().batches.filter(function (b) { return b.code === 'BATCH40'; })[0];
  check('81g-3: checkMark/checkNote round-trip through saveChinaBatch',
    marked.checkMark === 'скрипт+ИИ' && marked.checkNote === 'проверено ИИ, расхождений нет', JSON.stringify(marked));

  let badMark = '';
  try { h.saveChinaBatch({ id: batch.id, orderNo: '40', code: 'BATCH40', checkMark: 'ерунда', lines: [{ marking: 'M1', qty: 1, priceCny: 1 }] }, 'Николай'); }
  catch (e) { badMark = e.message; }
  check('81g-3: an unknown checkMark value is refused',
    badMark.indexOf('Неизвестная отметка') !== -1, badMark);

  // Editing the SAME batch WITHOUT sending checkMark at all must preserve it — the key must be
  // absent from the write, not sent as an empty/undefined value that would overwrite it.
  h.saveChinaBatch({ id: batch.id, orderNo: '40', code: 'BATCH40', status: 'Прибыла',
    shippedAt: '2026-09-01', arrivedAt: '2026-09-20', weightKg: 100, freightUsd: 200, cargoRate: 7,
    ratePerKgUsd: 2, lines: [{ marking: 'M1', name: 'x', boxes: 10, pcsPerBox: 5, qty: 50, priceCny: 20 }] }, 'Николай');
  const stillMarked = h.getChinaBatches().batches.filter(function (b) { return b.code === 'BATCH40'; })[0];
  check('81g-3: an edit that never mentions checkMark leaves it exactly as it was',
    stillMarked.checkMark === 'скрипт+ИИ' && stillMarked.checkNote === 'проверено ИИ, расхождений нет',
    JSON.stringify(stillMarked));

  h.saveChinaReport({ reportDate: '2026-09-25', source: 'скрипт', orders: [], receipts: [] }, 'Николай');
  const afterReport = h.getChinaBatches().batches.filter(function (b) { return b.code === 'BATCH40'; })[0];
  check('81g-3: an unrelated saveChinaReport recost preserves checkMark/checkNote and rubCostsDone',
    afterReport.checkMark === 'скрипт+ИИ' && afterReport.checkNote === 'проверено ИИ, расхождений нет' && afterReport.rubCostsDone === true,
    JSON.stringify(afterReport));
  // chinaRecostAll actually RAN: BATCH40 has no bill in the empty report above, so its freight
  // rate is no longer «оплаты» from the bill — owner, 2026-09-25: it now falls to the
  // last-payment fallback instead of straight to 0 (the order-40 payment from earlier in this
  // very test is the only payment in the system) — the SOURCE changing at all proves this batch,
  // which no OTHER mechanism (chinaRecostBorrowers) would have touched, was genuinely re-costed.
  check('81g-3: saveChinaReport genuinely re-costs EVERY batch, not just the borrowers',
    afterReport.freightRate === 12.4 && afterReport.freightRateSource === 'последняя оплата' && afterReport.totalRub === 29760,
    JSON.stringify({ freightRate: afterReport.freightRate, freightRateSource: afterReport.freightRateSource, totalRub: afterReport.totalRub }));
})();

// ---- history: a batch shipped before tracking, with no money anywhere, is exempt from «missing» ----
(function () {
  const h = withChina();
  h.saveChinaBatch({
    orderNo: '99', code: 'OLDBATCH', status: 'Черновик', shippedAt: '2026-05-01',
    lines: [{ marking: 'M1', name: 'x', boxes: 1, pcsPerBox: 1, qty: 1, priceCny: 10 }]
  }, 'Николай');
  const batch = h.getChinaBatches().batches[0];
  check('81g-3: a batch with no rate anywhere, shipped long before tracking, is «история»',
    batch.history === true && batch.missing.length === 0 && batch.closed === true,
    JSON.stringify({ history: batch.history, missing: batch.missing, closed: batch.closed }));

  // The SAME "no rate anywhere" batch, but shipped AFTER tracking started — this is NOT
  // history (there is no excuse for having no money on a batch that shipped in-era), and it
  // must show up in `missing`, not be silently waved through.
  h.saveChinaBatch({
    orderNo: '98', code: 'NEWBATCH', status: 'Черновик', shippedAt: '2026-08-15',
    lines: [{ marking: 'M1', name: 'x', boxes: 1, pcsPerBox: 1, qty: 1, priceCny: 10 }]
  }, 'Николай');
  const newBatch = h.getChinaBatches().batches.filter(function (b) { return b.code === 'NEWBATCH'; })[0];
  check('81g-3: the SAME "no rate anywhere" but shipped AFTER tracking is NOT history',
    newBatch.history === false && newBatch.closed === false && newBatch.missing.length > 0,
    JSON.stringify({ history: newBatch.history, missing: newBatch.missing }));
})();

// ---- freight/goods at genuinely DIFFERENT rates: each line component uses its OWN rate ----
(function () {
  const h = withChina();
  h.saveChinaBatch({
    orderNo: '41', code: 'DIFFRATE', status: 'Прибыла', shippedAt: '2026-09-01',
    weightKg: 100, freightUsd: 100, cargoRate: 7, ratePerKgUsd: 1, rubRate: 10,
    lines: [{ marking: 'M1', name: 'x', boxes: 10, pcsPerBox: 5, qty: 50, priceCny: 20 }]
  }, 'Николай');
  // Manually poke a DIFFERENT freight rate directly onto the row (no ledger bill exists for
  // this code, and the typed rate would otherwise apply to both — this proves the SPLIT
  // computation, not just that a fallback rate happens to match).
  const h2 = h; // same instance, direct sheet poke to simulate a resolved freight-only rate
  const calc = h2.chinaBatchCost(
    { goodsRate: 10, freightRate: 15, weightKg: 100, freightUsd: 100, cargoRate: 7, ratePerKgUsd: 1 },
    [{ marking: 'M1', qty: 50, priceCny: 20, boxes: 10 }], 0, { cargoRateCnyPerUsd: 7 });
  // goods 1 000 ¥ × 10 = 10 000 ₽; freight 700 ¥ (100$×7) × 15 = 10 500 ₽ → 20 500 ₽ total.
  check('81g-3: goods and freight at DIFFERENT rates are each costed directly, summing exactly',
    calc.goodsRub === 10000 && calc.freightRub === 10500 && calc.totalRub === 20500,
    JSON.stringify({ goodsRub: calc.goodsRub, freightRub: calc.freightRub, totalRub: calc.totalRub }));
})();

// ================= Coordinator, 2026-09-25: name the pending RECEIPTS, not a bare ¥ total =====
//
// Live sheet: NV-0923-4's «Чего не хватает» said «оплата от заказа на 4056 ¥ ещё не внесена» —
// unclear which receipts that was. It now names them by date and ¥, with «из <receipt total> ¥»
// when a receipt is split between several orders. Unit tests first (chinaLotsMissingMessages is
// pure), then one end-to-end batch reproducing the coordinator's own example numbers.

(function () {
  const receiptsById = {
    CG1: { date: '2026-09-03', goodsCny: 2974, status: 'ждёт оплату' },
    CG2: { date: '2026-09-16', goodsCny: 5001, status: 'ждёт оплату' },
    CG3: { date: '2026-07-15', goodsCny: 300, status: 'история' }
  };
  const lots = [
    { receiptId: 'CG1', cny: 2974 },
    { receiptId: 'CG2', cny: 1082 },
    { receiptId: 'CG3', cny: 300 }
  ];
  const messages = h_chinaLotsMissingMessages(lots, receiptsById, 'goodsCny', 'на этот заказ', 300);
  check('81g fix: the coordinator\'s exact example text, receipt dates and ¥ (full and partial)',
    messages[0] === 'в отчёте есть поступления 03.09 (2974 ¥) и 16.09 (1082 ¥ из 5001 ¥) на этот заказ, а оплат в приложении нет — внесите их',
    JSON.stringify(messages));
  check('81g fix: a separate line for money that came in before tracking, with no course',
    messages[1] === '300 ¥ пришли до августа 2026 — история без курса', JSON.stringify(messages));
})();

// Helper: harness exposes chinaLotsMissingMessages directly; a short local alias keeps the block
// above readable (the function itself takes no `h` at all — it is pure).
function h_chinaLotsMissingMessages() {
  return withChina().chinaLotsMissingMessages.apply(null, arguments);
}

// chinaLatestPaymentRate itself (pure, no sheet) — the tie-break and the actual-vs-typed rate.
(function () {
  const h = withChina();
  check('81g fix: chinaLatestPaymentRate picks the LATER date',
    h.chinaLatestPaymentRate([
      { id: 'CP1', date: '2026-08-20', rate: 12.4 },
      { id: 'CP2', date: '2026-08-22', rate: 12.6 }
    ]).id === 'CP2',
    JSON.stringify(h.chinaLatestPaymentRate([{ id: 'CP1', date: '2026-08-20', rate: 12.4 }, { id: 'CP2', date: '2026-08-22', rate: 12.6 }])));
  check('81g fix: a TIE on the same date goes to the LATER row (array order)',
    h.chinaLatestPaymentRate([
      { id: 'CP1', date: '2026-08-20', rate: 12.4 },
      { id: 'CP2', date: '2026-08-20', rate: 12.6 }
    ]).id === 'CP2',
    JSON.stringify(h.chinaLatestPaymentRate([{ id: 'CP1', date: '2026-08-20', rate: 12.4 }, { id: 'CP2', date: '2026-08-20', rate: 12.6 }])));
  check('81g fix: an ACTUAL rate beats the typed one for the SAME payment',
    h.chinaLatestPaymentRate([{ id: 'CP1', date: '2026-08-20', rate: 12.4, actualRate: 12.55 }]).rate === 12.55,
    JSON.stringify(h.chinaLatestPaymentRate([{ id: 'CP1', date: '2026-08-20', rate: 12.4, actualRate: 12.55 }])));
  check('81g fix: a payment with no date or no positive rate is ignored',
    h.chinaLatestPaymentRate([{ id: 'CP1', date: '', rate: 12.4 }, { id: 'CP2', date: '2026-08-20', rate: 0 }]) === null,
    JSON.stringify(h.chinaLatestPaymentRate([{ id: 'CP1', date: '', rate: 12.4 }, { id: 'CP2', date: '2026-08-20', rate: 0 }])));
})();

(function () {
  const h = withChina();
  check('81g fix: chinaShortDate turns a stored date into DD.MM',
    h.chinaShortDate('2026-09-03') === '03.09' && h.chinaShortDate('2026-01-01') === '01.01',
    h.chinaShortDate('2026-09-03') + ' / ' + h.chinaShortDate('2026-01-01'));
  check('81g fix: chinaJoinAnd lists two or more things the owner\'s own way',
    h.chinaJoinAnd(['a']) === 'a' && h.chinaJoinAnd(['a', 'b']) === 'a и b' &&
    h.chinaJoinAnd(['a', 'b', 'c']) === 'a, b и c',
    JSON.stringify([h.chinaJoinAnd(['a']), h.chinaJoinAnd(['a', 'b']), h.chinaJoinAnd(['a', 'b', 'c'])]));
  check('81g fix: chinaTrackingStartLabel reads the tracking-start constant as prose',
    h.chinaTrackingStartLabel() === 'августа 2026', h.chinaTrackingStartLabel());
})();

// End-to-end: a real batch whose order has exactly the coordinator's own numbers (2 974 ¥ fully
// pending on 03.09, 1 082 ¥ of a 5 001 ¥ receipt pending on 16.09 — 4 056 ¥ total, same as the
// live batch NV-0923-4) shows the named-receipts message, not a bare ¥ total.
(function () {
  const h = withChina();
  h.saveChinaReport({
    reportDate: '2026-09-01', source: 'скрипт',
    orders: [{ orderNo: '30', date: '2026-09-01', receivedCny: 4056 }],
    receipts: [{ date: '2026-09-03', goodsCny: 2974 }, { date: '2026-09-16', goodsCny: 5001 }]
  }, 'Николай');
  h.saveChinaBatch({
    orderNo: '30', code: 'NV-PENDING', status: 'Прибыла', shippedAt: '2026-09-01', arrivedAt: '2026-09-20',
    weightKg: 100, freightUsd: 100, cargoRate: 7, ratePerKgUsd: 1,
    lines: [{ marking: 'M1', name: 'x', boxes: 10, pcsPerBox: 5, qty: 50, priceCny: 20 }]
  }, 'Николай');
  const batch = h.getChinaBatches().batches.filter(function (b) { return b.code === 'NV-PENDING'; })[0];
  check('81g fix: a real batch\'s «Чего не хватает» names the pending receipts by date and ¥',
    batch.missing.indexOf('в отчёте есть поступления 03.09 (2974 ¥) и 16.09 (1082 ¥ из 5001 ¥) на этот заказ, а оплат в приложении нет — внесите их') !== -1,
    JSON.stringify(batch.missing));
})();

// Same for freight — the wording says «на эту перевозку» instead of «на этот заказ».
(function () {
  const h = withChina();
  h.saveChinaReport({
    reportDate: '2026-09-01', source: 'скрипт',
    orders: [], receipts: [{ date: '2026-09-05', goodsCny: 0, freightCny: 700, freightUsd: 100 }],
    freights: [{ code: 'NV-FREIGHT', orderNo: '31', amountUsd: 100, cargoRate: 7 }]
  }, 'Николай');
  h.saveChinaBatch({
    orderNo: '31', code: 'NV-FREIGHT', status: 'Прибыла', shippedAt: '2026-09-01', arrivedAt: '2026-09-20',
    weightKg: 100, freightUsd: 100, cargoRate: 7, ratePerKgUsd: 1,
    lines: [{ marking: 'M1', name: 'x', boxes: 10, pcsPerBox: 5, qty: 50, priceCny: 20 }]
  }, 'Николай');
  const batch = h.getChinaBatches().batches.filter(function (b) { return b.code === 'NV-FREIGHT'; })[0];
  check('81g fix: the freight side of the same message says «на эту перевозку»',
    batch.missing.indexOf('в отчёте есть поступления 05.09 (700 ¥) на эту перевозку, а оплат в приложении нет — внесите их') !== -1,
    JSON.stringify(batch.missing));
})();

// ================= Owner, 2026-09-25: remaining money on a batch (collapsed row) =============
//
// Live example (NV-0923-4, order 30): unpaid goods 9 464 ¥ in the newest report, an unpaid
// freight bill of 2 646 $, goodsRate 13.3994, freightRate 13.3976, cargoRate 7. Python:
// round2(9464*13.3994) = 126 811.92 ₽; round2(2646*7*13.3976) = 248 150.35 ₽; sum = 374 962.27 ₽.
(function () {
  const h = withChina();
  const ledger = {
    newest: { orders: [{ orderNo: '30', unpaidCny: 9464 }] },
    freightAlloc: { bills: { 'NV-0923-4': { unpaidUsd: 2646 } } }
  };
  const batch = { orderNo: '30', code: 'NV-0923-4', goodsRate: 13.3994, freightRate: 13.3976, cargoRate: 7 };
  const out = h.chinaRemainingOf(ledger, batch);
  check('81g-4: chinaRemainingOf reproduces the owner\'s own live example exactly',
    out.remainingGoodsCny === 9464 && out.remainingFreightUsd === 2646 && out.remainingRub === 374962.27,
    JSON.stringify(out));
})();

// Zero-rate parts drop to 0 ₽ without turning the whole figure into 0 or NaN.
(function () {
  const h = withChina();
  const ledger = {
    newest: { orders: [{ orderNo: '1', unpaidCny: 1000 }] },
    freightAlloc: { bills: { A: { unpaidUsd: 100 } } }
  };
  const noGoodsRate = h.chinaRemainingOf(ledger, { orderNo: '1', code: 'A', goodsRate: 0, freightRate: 10, cargoRate: 7 });
  check('81g-4: a zero goods rate drops only the goods ₽ part to 0',
    noGoodsRate.remainingGoodsCny === 1000 && noGoodsRate.remainingRub === roundToTwoTest(100 * 7 * 10),
    JSON.stringify(noGoodsRate));
  const noFreightRate = h.chinaRemainingOf(ledger, { orderNo: '1', code: 'A', goodsRate: 5, freightRate: 0, cargoRate: 7 });
  check('81g-4: a zero freight rate drops only the freight ₽ part to 0',
    noFreightRate.remainingRub === roundToTwoTest(1000 * 5), JSON.stringify(noFreightRate));
  const noCargoRate = h.chinaRemainingOf(ledger, { orderNo: '1', code: 'A', goodsRate: 5, freightRate: 10, cargoRate: 0 });
  check('81g-4: a zero cargo rate also drops the freight ₽ part to 0 (freight $ never converts)',
    noCargoRate.remainingRub === roundToTwoTest(1000 * 5), JSON.stringify(noCargoRate));
})();

// No bill at all for the batch's code: remainingFreightUsd is 0, not an error.
(function () {
  const h = withChina();
  const ledger = { newest: { orders: [] }, freightAlloc: { bills: {} } };
  const out = h.chinaRemainingOf(ledger, { orderNo: '9', code: 'NOBILL', goodsRate: 10, freightRate: 10, cargoRate: 7 });
  check('81g-4: an order the newest report never mentions, and a code with no bill, both read 0',
    out.remainingGoodsCny === 0 && out.remainingFreightUsd === 0 && out.remainingRub === 0, JSON.stringify(out));
})();

function roundToTwoTest(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

// End-to-end through getChinaBatches: a real report/freight ledger, a real batch, a manually
// typed rate (goods and freight both 10 ₽/¥ — chinaWithPaymentRate's own «вручную» path).
(function () {
  const h = withChina();
  h.saveChinaReport({
    reportDate: '2026-09-01', source: 'скрипт',
    orders: [{ orderNo: '50', date: '2026-01-01', receivedCny: 1000, totalCny: 1500, unpaidCny: 500 }],
    receipts: [], freights: [{ code: 'BATCHREM', orderNo: '50', amountUsd: 300, cargoRate: 7 }]
  }, 'Николай');
  h.saveChinaBatch({
    orderNo: '50', code: 'BATCHREM', status: 'Прибыла', shippedAt: '2026-09-01', arrivedAt: '2026-09-20',
    weightKg: 100, freightUsd: 300, cargoRate: 7, ratePerKgUsd: 3, rubRate: 10,
    lines: [{ marking: 'M1', name: 'x', boxes: 10, pcsPerBox: 5, qty: 50, priceCny: 20 }]
  }, 'Николай');
  const batch = h.getChinaBatches().batches.filter(function (b) { return b.code === 'BATCHREM'; })[0];
  // goods 500 ¥ × 10 = 5 000 ₽; freight 300 $ (no payment matched — the whole bill is unpaid) ×
  // 7 ¥/$ × 10 ₽/¥ = 21 000 ₽ → 26 000 ₽.
  check('81g-4: getChinaBatches wires remainingGoodsCny/remainingFreightUsd/remainingRub through',
    batch.remainingGoodsCny === 500 && batch.remainingFreightUsd === 300 && batch.remainingRub === 26000,
    JSON.stringify({ g: batch.remainingGoodsCny, f: batch.remainingFreightUsd, r: batch.remainingRub }));
})();

// ================= Owner, 2026-09-25: marking a receipt «история» by hand ======================
//
// Live case: a 'ждёт оплату' receipt from 2026-08-04 (4 819 ¥) is highlighted forever since it
// will never be matched — setChinaReceiptHistory lets the owner mark it history for good.
(function () {
  const h = withChina();
  h.saveChinaReport({
    reportDate: '2026-08-05', source: 'скрипт',
    orders: [], receipts: [{ date: '2026-08-04', goodsCny: 4819 }]
  }, 'Николай');
  const before = h.getChinaMoney();
  const receiptId = before.receipts[0].id;
  check('81g-4: setup — a receipt in the tracked era starts «ждёт оплату», not manually marked',
    before.receipts[0].status === 'ждёт оплату' && before.receipts[0].historyManual === false,
    JSON.stringify(before.receipts[0]));

  const marked = h.setChinaReceiptHistory({ receiptId: receiptId, history: true }, 'Николай');
  check('setChinaReceiptHistory: marks the receipt «история» with the manual flag set',
    marked !== undefined, 'returns getChinaBatches()');
  const afterMark = h.getChinaMoney().receipts[0];
  check('setChinaReceiptHistory: status is «история», «История вручную» = «да»',
    afterMark.status === 'история' && afterMark.historyManual === true, JSON.stringify(afterMark));

  // A later report re-upload of a DIFFERENT date, repeating the SAME receipt with an UNCHANGED
  // total, must not touch the manual mark at all (the "already known" branch of saveChinaReport).
  h.saveChinaReport({
    reportDate: '2026-08-10', source: 'скрипт',
    orders: [], receipts: [{ date: '2026-08-04', goodsCny: 4819 }, { date: '2026-08-10', goodsCny: 100 }]
  }, 'Николай');
  const afterSameReport = h.getChinaMoney().receipts.filter(function (r) { return r.id === receiptId; })[0];
  check('setChinaReceiptHistory: an unchanged re-upload of the same receipt keeps the manual mark',
    afterSameReport.status === 'история' && afterSameReport.historyManual === true,
    JSON.stringify(afterSameReport));

  // Even when the report REVISES that receipt's own total (the mismatch/warning branch), the
  // manual mark and status survive — the merge is against the PREVIOUS row, not a fresh default.
  h.saveChinaReport({
    reportDate: '2026-08-15', source: 'скрипт',
    orders: [], receipts: [{ date: '2026-08-04', goodsCny: 5000 }, { date: '2026-08-10', goodsCny: 100 }]
  }, 'Николай');
  const afterRevisedTotal = h.getChinaMoney().receipts.filter(function (r) { return r.id === receiptId; })[0];
  check('setChinaReceiptHistory: even a revised ¥ total for the SAME receipt keeps the manual mark',
    afterRevisedTotal.status === 'история' && afterRevisedTotal.historyManual === true,
    JSON.stringify(afterRevisedTotal));

  // Unmark: back to 'ждёт оплату', flag cleared — the receipt's date (2026-08-04) is in era.
  const unmarked = h.setChinaReceiptHistory({ receiptId: receiptId, history: false }, 'Николай');
  const afterUnmark = h.getChinaMoney().receipts.filter(function (r) { return r.id === receiptId; })[0];
  check('setChinaReceiptHistory: unmarking restores «ждёт оплату» and clears the manual flag',
    afterUnmark.status === 'ждёт оплату' && afterUnmark.historyManual === false, JSON.stringify(afterUnmark));
})();

// Refusals: a receipt before tracking cannot be unmarked, and a matched receipt cannot be
// touched in either direction.
(function () {
  const h = withChina();
  h.saveChinaReport({
    reportDate: '2026-07-20', source: 'скрипт',
    orders: [], receipts: [{ date: '2026-07-15', goodsCny: 300 }]
  }, 'Николай');
  const oldReceipt = h.getChinaMoney().receipts[0];
  check('setChinaReceiptHistory: setup — a receipt before tracking starts «история» on its own',
    oldReceipt.status === 'история' && oldReceipt.historyManual === false, JSON.stringify(oldReceipt));

  let refusedUnmark = '';
  try { h.setChinaReceiptHistory({ receiptId: oldReceipt.id, history: false }, 'Николай'); }
  catch (e) { refusedUnmark = e.message; }
  check('setChinaReceiptHistory: unmarking a before-tracking receipt is refused (Russian message)',
    refusedUnmark.indexOf('раньше начала учёта') !== -1, refusedUnmark);

  h.saveChinaReport({
    reportDate: '2026-09-01', source: 'скрипт',
    orders: [{ orderNo: '60', date: '2026-01-01', receivedCny: 1000 }],
    receipts: [{ date: '2026-08-20', goodsCny: 1000 }]
  }, 'Николай');
  h.saveChinaPayment({ date: '2026-08-20', amountRub: 12400, rate: 12.4, comment: 'order 60' }, 'Николай');
  const matched = h.getChinaMoney().receipts.filter(function (r) { return r.date === '2026-08-20'; })[0];
  check('setChinaReceiptHistory: setup — the payment matched the receipt',
    matched.status === 'сопоставлено', JSON.stringify(matched));

  let refusedMark = '';
  try { h.setChinaReceiptHistory({ receiptId: matched.id, history: true }, 'Николай'); }
  catch (e) { refusedMark = e.message; }
  check('setChinaReceiptHistory: marking a «сопоставлено» receipt as history is refused (Russian message)',
    refusedMark.indexOf('сопоставлено') !== -1, refusedMark);
})();

// Marking history changes the receipt's bucket, and chinaRecostAll actually re-costs every
// batch on it — the pending-receipts message drops a receipt once it is marked history.
(function () {
  const h = withChina();
  h.saveChinaReport({
    reportDate: '2026-09-01', source: 'скрипт',
    orders: [{ orderNo: '30', date: '2026-09-01', receivedCny: 4056 }],
    receipts: [{ date: '2026-09-03', goodsCny: 2974 }, { date: '2026-09-16', goodsCny: 5001 }]
  }, 'Николай');
  h.saveChinaBatch({
    orderNo: '30', code: 'NV-PENDING', status: 'Прибыла', shippedAt: '2026-09-01', arrivedAt: '2026-09-20',
    weightKg: 100, freightUsd: 100, cargoRate: 7, ratePerKgUsd: 1,
    lines: [{ marking: 'M1', name: 'x', boxes: 10, pcsPerBox: 5, qty: 50, priceCny: 20 }]
  }, 'Николай');
  const before = h.getChinaBatches().batches.filter(function (b) { return b.code === 'NV-PENDING'; })[0];
  check('setChinaReceiptHistory: setup — both pending receipts are named in «Чего не хватает»',
    before.missing.some(function (m) { return m.indexOf('03.09') !== -1 && m.indexOf('16.09') !== -1; }),
    JSON.stringify(before.missing));

  const cg1 = h.getChinaMoney().receipts.filter(function (r) { return r.date === '2026-09-03'; })[0];
  h.setChinaReceiptHistory({ receiptId: cg1.id, history: true }, 'Николай');
  const after = h.getChinaBatches().batches.filter(function (b) { return b.code === 'NV-PENDING'; })[0];
  check('setChinaReceiptHistory: re-costs every batch — the marked receipt drops out of the pending message',
    after.missing.some(function (m) { return m.indexOf('16.09') !== -1 && m.indexOf('03.09') === -1; }),
    JSON.stringify(after.missing));
})();

// ================= Owner, 2026-09-25: transitDays directory setting ============================
(function () {
  const h = withChina();
  check('transitDays: a freshly set up spreadsheet seeds 30 days',
    h.getChinaSettings().transitDays === 30, JSON.stringify(h.getChinaSettings()));

  // An existing live sheet made before this item never got the row at all — getChinaSettings
  // must still answer 30 via the defaults merge, exactly as it already does for cargoRateCnyPerUsd.
  h.getTargetSheet('Справочник').deleteRow(3);
  check('transitDays: a directory row missing entirely still answers with the default (30)',
    h.getChinaSettings().transitDays === 30, JSON.stringify(h.getChinaSettings()));

  // An owner override in the sheet wins over the default.
  h.getTargetSheet('Справочник').appendRow(['transitDays', 45, 'испытание']);
  check('transitDays: an owner-typed value in the sheet overrides the default',
    h.getChinaSettings().transitDays === 45, JSON.stringify(h.getChinaSettings()));
})();

// ================= Item 82: forecast of a future China shipment ==============================
//
// The 12 bills below are the owner's own report of 25.09.2026 (docs/OZON_PLAN.md, item 82
// brief) — code;order;shipped;arrived;rate;kg;m3;usd, exactly as given. Every expected number
// (basis, density, extras, switch density, the nearest-5 pick, the extras/transit medians) was
// derived independently in Python first (see the scratchpad script of this session) — never
// mental arithmetic.
function chinaRealFreights() {
  return [
    { code: 'NV-1209-7', orderNo: '', shippedAt: '2025-12-10', arrivedAt: '2026-01-10', ratePerKgUsd: 2.6, weightKg: 3115, volumeM3: 23.8, amountUsd: 8468 },
    { code: 'NV-1217-15', orderNo: '20', shippedAt: '2025-12-17', arrivedAt: '2026-01-25', ratePerKgUsd: 2.45, weightKg: 381, volumeM3: 3.46, amountUsd: 948 },
    { code: 'NV-0118-15', orderNo: '21', shippedAt: '2026-01-19', arrivedAt: '2026-03-05', ratePerKgUsd: 2.9, weightKg: 386.25, volumeM3: 3.34, amountUsd: 1243 },
    { code: 'NV-0310-10', orderNo: '22', shippedAt: '2026-03-11', arrivedAt: '2026-03-29', ratePerKgUsd: 1.75, weightKg: 3040, volumeM3: 22.3, amountUsd: 5788 },
    { code: 'NV-0424-12', orderNo: '23', shippedAt: '2026-04-25', arrivedAt: '2026-05-22', ratePerKgUsd: 2.15, weightKg: 3742, volumeM3: 27.47, amountUsd: 8606 },
    { code: 'NV-0401-23', orderNo: '24', shippedAt: '2026-04-03', arrivedAt: '2026-05-30', ratePerKgUsd: 2.05, weightKg: 514.4, volumeM3: 4.93, amountUsd: 1251 },
    { code: 'NV-0617-3', orderNo: '25', shippedAt: '2026-06-18', arrivedAt: '2026-07-19', ratePerKgUsd: 310, weightKg: 206.7, volumeM3: 3.07, amountUsd: 1120 },
    { code: 'NV-0716-3', orderNo: '27', shippedAt: '2026-07-17', arrivedAt: '2026-08-21', ratePerKgUsd: 2.3, weightKg: 1001.5, volumeM3: 7.41, amountUsd: 2438 },
    { code: 'NV-0703-23', orderNo: '26', shippedAt: '2026-07-04', arrivedAt: '2026-08-22', ratePerKgUsd: 2.55, weightKg: 500.8, volumeM3: 4.81, amountUsd: 1488 },
    { code: 'NV-0825-2', orderNo: '28', shippedAt: '2026-08-27', arrivedAt: '2026-09-17', ratePerKgUsd: 2.3, weightKg: 672.5, volumeM3: 4.92, amountUsd: 1637 },
    { code: 'NV-0916-24', orderNo: '29', shippedAt: '2026-09-17', arrivedAt: '', ratePerKgUsd: 2.6, weightKg: 408, volumeM3: 4.04, amountUsd: 1109 },
    { code: 'NV-0923-4', orderNo: '30', shippedAt: '2026-09-24', arrivedAt: '', ratePerKgUsd: 2.55, weightKg: 967, volumeM3: 9.14, amountUsd: 2646 }
  ];
}

// ---- chinaTariffFromFreight: basis, density, extras of a few real bills ----
(function () {
  const h = withChina();
  const freights = chinaRealFreights();
  const byCode = {};
  freights.forEach(function (f) { byCode[f.code] = h.chinaTariffFromFreight(f, 'CR1'); });

  check('82a: NV-0617-3 (310 $/m³) is billed per м³, every other bill per кг',
    byCode['NV-0617-3'].basis === 'м³' &&
    ['NV-1209-7', 'NV-1217-15', 'NV-0118-15', 'NV-0310-10', 'NV-0424-12', 'NV-0401-23', 'NV-0716-3', 'NV-0703-23', 'NV-0825-2', 'NV-0916-24', 'NV-0923-4']
      .every(function (c) { return byCode[c].basis === 'кг'; }),
    JSON.stringify(freights.map(function (f) { return byCode[f.code].basis; })));

  check('82a: NV-0310-10 density/billed/extras/extrasPct — Python: 136.32 / 5320.0 / 468.0 / 8.8',
    byCode['NV-0310-10'].densityKgM3 === 136.32 && byCode['NV-0310-10'].billedUsd === 5320 &&
    byCode['NV-0310-10'].extrasUsd === 468 && byCode['NV-0310-10'].extrasPct === 8.8,
    JSON.stringify(byCode['NV-0310-10']));

  check('82a: NV-0617-3 (м³ basis) density/billed/extras — Python: 67.33 / 951.7 / 168.3 / 17.68',
    byCode['NV-0617-3'].densityKgM3 === 67.33 && byCode['NV-0617-3'].billedUsd === 951.7 &&
    byCode['NV-0617-3'].extrasUsd === 168.3 && byCode['NV-0617-3'].extrasPct === 17.68,
    JSON.stringify(byCode['NV-0617-3']));

  check('82a: real $/kg of NV-1209-7 — Python: 8468/3115 = 2.72',
    byCode['NV-1209-7'].realPerKgUsd === 2.72, JSON.stringify(byCode['NV-1209-7']));

  check('82a: transit days of NV-0825-2 (2026-08-27 -> 2026-09-17) is 21, and an unarrived bill reads null',
    byCode['NV-0825-2'].transitDays === 21 && byCode['NV-0923-4'].transitDays === null,
    byCode['NV-0825-2'].transitDays + ' / ' + byCode['NV-0923-4'].transitDays);
})();

// ---- saveChinaReport upserts every freight into «Тарифы карго» by code ----
(function () {
  const h = withChina();
  h.saveChinaReport({ reportDate: '2026-08-20', source: 'скрипт', orders: [], receipts: [], freights: chinaRealFreights() }, 'Николай');
  const rows1 = h.dumpChinaTariffs();
  check('82a: the first report writes exactly 12 tariff rows, one per bill',
    rows1.length === 12, rows1.length);
  check('82a: a bill with no arrival yet reads «Дней в пути» empty',
    rows1.filter(function (r) { return r['Код партии'] === 'NV-0923-4'; })[0]['Дней в пути'] === '',
    JSON.stringify(rows1.filter(function (r) { return r['Код партии'] === 'NV-0923-4'; })[0]));

  // A later report confirms the arrival of NV-0923-4 — same code, must OVERWRITE, not duplicate.
  const revisedFreights = chinaRealFreights().map(function (f) {
    return f.code === 'NV-0923-4' ? Object.assign({}, f, { arrivedAt: '2026-10-25' }) : f;
  });
  h.saveChinaReport({ reportDate: '2026-09-25', source: 'скрипт', orders: [], receipts: [], freights: revisedFreights }, 'Николай');
  const rows2 = h.dumpChinaTariffs();
  check('82a: the second report upserts by code — still exactly 12 rows, not 24',
    rows2.length === 12, rows2.length);
  const revised = rows2.filter(function (r) { return r['Код партии'] === 'NV-0923-4'; })[0];
  check('82a: the arrival date landed on the SAME row, transit days now filled',
    revised['Дата прибытия'] === '2026-10-25' && Number(revised['Дней в пути']) === 31,
    JSON.stringify(revised));

  // An identical re-upload of the newest report's own content is a no-op — the tariff sheet
  // must not be touched a third time either.
  const before = JSON.stringify(h.dumpChinaTariffs());
  h.saveChinaReport({ reportDate: '2026-09-25', source: 'скрипт', orders: [], receipts: [], freights: revisedFreights }, 'Николай');
  check('82a: an identical re-upload leaves the tariff sheet untouched (no-op)',
    JSON.stringify(h.dumpChinaTariffs()) === before, 'unchanged');
})();

// ---- chinaTariffList merges the sheet with freights of still-stored reports ----
(function () {
  const h = withChina();
  // Four reports in a row, each with ONE new bill — chinaPruneReports keeps only the 3 newest,
  // so by the time the fourth is saved the FIRST report is gone from «Отчёты» entirely; its
  // bill must still show up because chinaUpsertTariffs already wrote it to the durable sheet.
  h.saveChinaReport({ reportDate: '2026-01-01', source: 'скрипт', orders: [], receipts: [],
    freights: [{ code: 'A1', orderNo: '1', shippedAt: '2026-01-01', arrivedAt: '2026-02-01', ratePerKgUsd: 2, weightKg: 100, volumeM3: 1, amountUsd: 200 }] }, 'Николай');
  h.saveChinaReport({ reportDate: '2026-02-01', source: 'скрипт', orders: [], receipts: [],
    freights: [{ code: 'A2', orderNo: '2', shippedAt: '2026-02-01', arrivedAt: '2026-03-01', ratePerKgUsd: 2, weightKg: 100, volumeM3: 1, amountUsd: 200 }] }, 'Николай');
  h.saveChinaReport({ reportDate: '2026-03-01', source: 'скрипт', orders: [], receipts: [],
    freights: [{ code: 'A3', orderNo: '3', shippedAt: '2026-03-01', arrivedAt: '2026-04-01', ratePerKgUsd: 2, weightKg: 100, volumeM3: 1, amountUsd: 200 }] }, 'Николай');
  h.saveChinaReport({ reportDate: '2026-04-01', source: 'скрипт', orders: [], receipts: [],
    freights: [{ code: 'A4', orderNo: '4', shippedAt: '2026-04-01', arrivedAt: '2026-05-01', ratePerKgUsd: 2, weightKg: 100, volumeM3: 1, amountUsd: 200 }] }, 'Николай');

  const reportDates = h.dumpChinaReports().map(function (r) { return r['Дата отчёта']; });
  check('82a: only the 3 newest reports survive pruning', reportDates.length === 3, JSON.stringify(reportDates));

  // getChinaForecastData reads chinaTariffList through the module's own spreadsheet — A1's bill
  // is gone from «Отчёты» by now, but must still show, from the durable «Тарифы карго» sheet.
  const codes = h.getChinaForecastData().tariffs.map(function (t) { return t.code; });
  check('82a: a bill whose introducing report has been pruned still shows, from the sheet',
    codes.indexOf('A1') !== -1 && codes.length === 4, JSON.stringify(codes));
})();

// ---- chinaTariffPick on the real 12-bill data ----
(function () {
  const h = withChina();
  h.saveChinaReport({ reportDate: '2026-09-25', source: 'скрипт', orders: [], receipts: [], freights: chinaRealFreights() }, 'Николай');
  const tariffs = h.getChinaForecastData().tariffs;
  check('82a: all 12 bills are read back', tariffs.length === 12, tariffs.length);

  // Python: switch density = (67.33 м³-max + 100.99 кг-min) / 2 = 84.16.
  const pick = h.chinaTariffPick(tariffs, 700, 140);
  check('82a: switch density is the midpoint of the м³-max and кг-min densities (84.16)',
    pick.switchDensity === 84.16, JSON.stringify(pick));
  check('82a: a shipment at 140 kg/m³ (above the switch) is billed кг, not м³',
    pick.basis === 'кг', pick.basis);
  // Python nearest-5 by log-distance: NV-0825-2, NV-0716-3, NV-0401-23, NV-0923-4, NV-0703-23 —
  // rates [2.3, 2.3, 2.05, 2.55, 2.55], median 2.3, min 2.05, max 2.55.
  check('82a: the 5 nearest кг bills are exactly the ones Python picked',
    JSON.stringify(pick.codes.slice().sort()) === JSON.stringify(['NV-0401-23', 'NV-0703-23', 'NV-0716-3', 'NV-0825-2', 'NV-0923-4'].sort()),
    JSON.stringify(pick.codes));
  check('82a: typical/low/high $ of the pick — Python: 2.3 / 2.05 / 2.55',
    pick.typicalUsd === 2.3 && pick.lowUsd === 2.05 && pick.highUsd === 2.55, JSON.stringify(pick));
  check('82a: extras % is the median over ALL 12 bills, not just the picked 5 — Python: 7.14',
    pick.extrasPct === 7.14, pick.extrasPct);
  check('82a: transit days is the median over every bill with an arrival — Python: 33',
    pick.transitDays === 33, pick.transitDays);

  // A shipment dense enough to fall BELOW the switch is billed м³ — with only one м³ bill ever
  // seen, that single bill is both the pick and its own typical/low/high.
  const m3Pick = h.chinaTariffPick(tariffs, 200, 60);
  check('82a: a shipment at 60 kg/m³ (below the switch) is billed м³',
    m3Pick.basis === 'м³' && m3Pick.n === 1 && m3Pick.codes[0] === 'NV-0617-3' &&
    m3Pick.typicalUsd === 310 && m3Pick.lowUsd === 310 && m3Pick.highUsd === 310,
    JSON.stringify(m3Pick));

  check('82a: no history at all reads an explicit «нет истории тарифов»',
    h.chinaTariffPick([], 100, 100).empty === true && h.chinaTariffPick([], 100, 100).message === 'нет истории тарифов',
    JSON.stringify(h.chinaTariffPick([], 100, 100)));

  // Coordinator fix, 2026-09-25: chinaTariffSummary must reuse chinaTariffPick's own formula
  // for switchDensity/extrasPct/transitDays (identical regardless of the weight/density it is
  // asked to price) — same Python numbers as the pick test above: 84.16 / 33 / 7.14, over all 12.
  const summary = h.chinaTariffSummary(tariffs);
  check('82a fix: tariffSummary reuses chinaTariffPick\'s own switchDensity/transitDays/extrasPct — 84.16/33/7.14, n=12',
    summary.switchDensity === 84.16 && summary.transitDays === 33 && summary.extrasPct === 7.14 && summary.n === 12,
    JSON.stringify(summary));
  check('82a fix: an empty tariff list reads an empty summary, not a crash',
    JSON.stringify(h.chinaTariffSummary([])) === JSON.stringify({ switchDensity: null, transitDays: null, extrasPct: 0, n: 0 }),
    JSON.stringify(h.chinaTariffSummary([])));
})();

// ---- chinaBoxDirectory: latest box per article, «changed», batch count ----
(function () {
  const h = withChina();
  const batches = [
    { id: 'CB1', code: 'NV-A', shippedAt: '2026-01-01' },
    { id: 'CB2', code: 'NV-B', shippedAt: '2026-03-01' }
  ];
  const lines = [
    // Article ART1: same box both times — not changed, seen in 2 batches.
    { batchId: 'CB1', article: 'ART1', marking: 'M1', boxLengthM: 0.3, boxWidthM: 0.2, boxHeightM: 0.1,
      factoryBoxKg: 5, pcsPerBox: 10, priceCny: 20, name: 'Товар 1' },
    { batchId: 'CB2', article: 'ART1', marking: 'M1', boxLengthM: 0.3, boxWidthM: 0.2, boxHeightM: 0.1,
      factoryBoxKg: 5, pcsPerBox: 10, priceCny: 22, name: 'Товар 1' },
    // Article ART2: the box changed between batches (weight 4 -> 6 kg) — latest (CB2) wins.
    { batchId: 'CB1', article: 'ART2', marking: 'M2', boxLengthM: 0.2, boxWidthM: 0.2, boxHeightM: 0.2,
      factoryBoxKg: 4, pcsPerBox: 8, priceCny: 15, name: 'Товар 2' },
    { batchId: 'CB2', article: 'ART2', marking: 'M2', boxLengthM: 0.2, boxWidthM: 0.2, boxHeightM: 0.2,
      factoryBoxKg: 6, pcsPerBox: 8, priceCny: 16, name: 'Товар 2' },
    // No article: falls back to marking M3, and has no box data at all — excluded outright.
    { batchId: 'CB1', article: '', marking: 'M3', boxLengthM: 0, boxWidthM: 0, boxHeightM: 0, factoryBoxKg: 0, pcsPerBox: 5, priceCny: 10, name: 'Без коробки' }
  ];
  const dir = h.chinaBoxDirectory(batches, lines);
  check('82b: only ART1 and ART2 make it into the directory (M3 has no box data)',
    JSON.stringify(Object.keys(dir).sort()) === JSON.stringify(['ART1', 'ART2']), JSON.stringify(Object.keys(dir)));
  check('82b: ART1 is unchanged and seen in 2 batches',
    dir.ART1.changed === false && dir.ART1.batches === 2 && dir.ART1.boxKg === 5 && dir.ART1.priceCny === 22,
    JSON.stringify(dir.ART1));
  check('82b: ART2 is marked changed and its latest (by shippedAt) box wins — 6 kg, not 4',
    dir.ART2.changed === true && dir.ART2.boxKg === 6 && dir.ART2.priceCny === 16,
    JSON.stringify(dir.ART2));
})();

// ---- chinaForecastCalc: missing box warning, exact splits, the settings default ----
(function () {
  const h = withChina();
  check('82c: rubCostsPerBatch defaults to 5000 ₽',
    h.getChinaSettings().rubCostsPerBatch === 5000, JSON.stringify(h.getChinaSettings()));

  const ctx = {
    directory: {
      ART1: { pcsPerBox: 10, boxKg: 5, boxVolumeM3: 0.01, priceCny: 20 },
      ART2: { pcsPerBox: 8, boxKg: 6, boxVolumeM3: 0.02, priceCny: 15 }
    },
    tariffs: chinaRealFreights().map(function (f) { return h.chinaTariffFromFreight(f, 'CR1'); }),
    settings: { cargoRateCnyPerUsd: 7, rubCostsPerBatch: 5000, transitDays: 30 },
    payments: [{ id: 'CP1', date: '2026-09-20', rate: 12.5, actualRate: 0 }],
    batches: [{ goodsCny: 10000, chinaDeliveryCny: 500 }, { goodsCny: 20000, chinaDeliveryCny: 1000 }]
  };
  const result = h.chinaForecastCalc({
    lines: [{ article: 'ART1', pieces: 105 }, { article: 'ART2', pieces: 40 }, { article: 'NOPE', pieces: 5 }]
  }, ctx);

  check('82c: an article with no box directory entry is returned with a warning, no totals',
    result.lines[2].warning === 'нет данных о коробке' && result.lines[2].boxes === undefined,
    JSON.stringify(result.lines[2]));
  check('82c: boxes = ceil(pieces / pcsPerBox); missingToFullBox fills the last box',
    result.lines[0].boxes === 11 && result.lines[0].missingToFullBox === 5 &&
    result.lines[1].boxes === 5 && result.lines[1].missingToFullBox === 0,
    JSON.stringify(result.lines));
  check('82c: kg/m³ of each line = boxes × the box\'s own kg/m³',
    result.lines[0].kg === 55 && result.lines[1].kg === 30, JSON.stringify(result.lines));

  check('82c: the ruble rate is the LATEST payment\'s own — 12.5, sourced «2026-09-20 CP1»',
    result.rubRate === 12.5 && result.rubRateSource === '2026-09-20 CP1', result.rubRate + ' / ' + result.rubRateSource);
  check('82c: China-domestic-delivery share is historic (500+1000)/(10000+20000)×100 = 5 %',
    result.domesticShare === 5, result.domesticShare);

  const totals = result.totals;
  const sumFreightTypical = roundTest(result.lines[0].freightUsdTypical + result.lines[1].freightUsdTypical);
  check('82c: the freight split sums EXACTLY to the total (typical)',
    sumFreightTypical === totals.freightUsdTypical, sumFreightTypical + ' vs ' + totals.freightUsdTypical);
  // The pick's basis here is кг (density ~531 kg/m³ against a switch of 84.16) — the split MUST
  // follow kg, not m³: $/kg is the same for both lines only when split by kg.
  check('82c: the freight split follows the pick\'s own basis (кг here), not the other one',
    result.pick.basis === 'кг' &&
    Math.abs(result.lines[0].freightUsdTypical / result.lines[0].kg - result.lines[1].freightUsdTypical / result.lines[1].kg) < 0.01,
    (result.lines[0].freightUsdTypical / result.lines[0].kg) + ' vs ' + (result.lines[1].freightUsdTypical / result.lines[1].kg));
  const sumDomestic = roundTest(result.lines[0].domesticCny + result.lines[1].domesticCny);
  check('82c: the domestic-delivery split sums exactly to the total',
    sumDomestic === totals.domesticCny, sumDomestic + ' vs ' + totals.domesticCny);
  const sumRub = roundTest(result.lines[0].rubShare + result.lines[1].rubShare);
  check('82c: the Russian-costs split (by boxes) sums exactly to the settings figure',
    sumRub === totals.russianCosts, sumRub + ' vs ' + totals.russianCosts);
  const sumCostTypical = roundTest(result.lines[0].costRubTypical + result.lines[1].costRubTypical);
  check('82c: the per-line total cost (typical) sums exactly to the batch total',
    sumCostTypical === totals.costRubTypical, sumCostTypical + ' vs ' + totals.costRubTypical);

  // Coordinator fix, 2026-09-25: ₽ equivalents next to every ¥/$ figure — Python: goodsCny×12.5 =
  // 2100×12.5 = 26250 / 600×12.5 = 7500, sum 33750.
  check('82c fix: goodsRub = goodsCny × rubRate, per line — Python: 26250 / 7500',
    result.lines[0].goodsRub === 26250 && result.lines[1].goodsRub === 7500, JSON.stringify([result.lines[0].goodsRub, result.lines[1].goodsRub]));
  check('82c fix: goodsRub sums exactly to totals.goodsRub',
    roundTest(result.lines[0].goodsRub + result.lines[1].goodsRub) === totals.goodsRub, totals.goodsRub);
  check('82c fix: domesticRub = domesticCny × rubRate, per line, and sums exactly',
    result.lines[0].domesticRub === roundTest(result.lines[0].domesticCny * 12.5) &&
    result.lines[1].domesticRub === roundTest(result.lines[1].domesticCny * 12.5) &&
    roundTest(result.lines[0].domesticRub + result.lines[1].domesticRub) === totals.domesticRub,
    JSON.stringify([result.lines[0].domesticRub, result.lines[1].domesticRub, totals.domesticRub]));
  check('82c fix: freightRubTypical/Low/High = freightUsd × cargoRate × rubRate, per line, and sum exactly',
    result.lines[0].freightRubTypical === roundTest(result.lines[0].freightUsdTypical * 7 * 12.5) &&
    roundTest(result.lines[0].freightRubTypical + result.lines[1].freightRubTypical) === totals.freightRubTypical &&
    roundTest(result.lines[0].freightRubLow + result.lines[1].freightRubLow) === totals.freightRubLow &&
    roundTest(result.lines[0].freightRubHigh + result.lines[1].freightRubHigh) === totals.freightRubHigh,
    JSON.stringify({ typical: totals.freightRubTypical, low: totals.freightRubLow, high: totals.freightRubHigh }));

  check('82c: estimated arrival = today + the pick\'s own transit median, not the settings fallback',
    result.estimatedArrival === h.chinaAddDaysText(h.chinaTodayText(), result.pick.transitDays),
    result.estimatedArrival);

  // Every line missing its box: totals must be null, not a division-by-zero mess.
  const empty = h.chinaForecastCalc({ lines: [{ article: 'NOPE', pieces: 1 }] }, ctx);
  check('82c: every line missing its box leaves totals null',
    empty.totals === null, JSON.stringify(empty.totals));
})();
function roundTest(x) { return Math.round((x + Number.EPSILON) * 100) / 100; }

// ---- coordinator fix, 2026-09-25: the forecast must price the CHARGEABLE (waybill) weight,
// not the goods weight — NV-0923-4's own waybill/goods gap (967/847 kg, 9.14/7.5611 m³) ----
(function () {
  const h = withChina();

  // chinaPackagingFactors is pure — no forecast context needed at all.
  const factors = h.chinaPackagingFactors([
    { weightKg: 967, goodsKg: 847, volumeM3: 9.14, goodsVolumeM3: 7.5611 }
  ]);
  check('82c fix: weightFactor/volumeFactor — Python: 967/847 = 1.14, 9.14/7.5611 = 1.21',
    factors.weightFactor === 1.14 && factors.volumeFactor === 1.21 &&
    factors.weightFactorN === 1 && factors.volumeFactorN === 1, JSON.stringify(factors));

  check('82c fix: a batch missing either figure contributes to NEITHER ratio',
    JSON.stringify(h.chinaPackagingFactors([{ weightKg: 967, goodsKg: 0, volumeM3: 9.14, goodsVolumeM3: 0 }])) ===
    JSON.stringify({ weightFactor: 1, weightFactorN: 0, volumeFactor: 1, volumeFactorN: 0 }),
    JSON.stringify(h.chinaPackagingFactors([{ weightKg: 967, goodsKg: 0, volumeM3: 9.14, goodsVolumeM3: 0 }])));

  check('82c fix: no batch with box data at all reads factors of 1 (no scaling)',
    JSON.stringify(h.chinaPackagingFactors([])) === JSON.stringify({ weightFactor: 1, weightFactorN: 0, volumeFactor: 1, volumeFactorN: 0 }),
    JSON.stringify(h.chinaPackagingFactors([])));

  // The full path: a forecast whose only batch with box data is an NV-0923-4-like one. The
  // forecast line itself is built so its GOODS kg/m³ are round numbers (100 kg / 1 m³) —
  // Python: chargeableKg = 100 × 1.14 = 114, chargeableM³ = 1 × 1.21 = 1.21, density = 94.21.
  const ctxFix = {
    directory: { ART1: { pcsPerBox: 1, boxKg: 100, boxVolumeM3: 1, priceCny: 50 } },
    tariffs: chinaRealFreights().map(function (f) { return h.chinaTariffFromFreight(f, 'CR1'); }),
    settings: { cargoRateCnyPerUsd: 7, rubCostsPerBatch: 5000, transitDays: 30 },
    payments: [{ id: 'CP1', date: '2026-09-20', rate: 12.5, actualRate: 0 }],
    batches: [{ goodsCny: 0, chinaDeliveryCny: 0, weightKg: 967, goodsKg: 847, volumeM3: 9.14, goodsVolumeM3: 7.5611 }]
  };
  const resultFix = h.chinaForecastCalc({ lines: [{ article: 'ART1', pieces: 1 }] }, ctxFix);
  check('82c fix: totals keep the GOODS figures untouched (100 kg / 1 m³)',
    resultFix.totals.goodsKg === 100 && resultFix.totals.goodsM3 === 1, JSON.stringify(resultFix.totals));
  check('82c fix: totals also carry the CHARGEABLE figures — Python: 114 kg / 1.21 m³ / 94.21 kg/m³',
    resultFix.totals.chargeableKg === 114 && resultFix.totals.chargeableM3 === 1.21 &&
    resultFix.totals.chargeableDensityKgM3 === 94.21, JSON.stringify(resultFix.totals));

  const pick = resultFix.pick;
  const perUnit = pick.basis === 'м³' ? resultFix.totals.chargeableM3 : resultFix.totals.chargeableKg;
  const expectedFreightTypical = Math.round((pick.typicalUsd * perUnit * (1 + pick.extrasPct / 100) + Number.EPSILON) * 100) / 100;
  check('82c fix: freight is tariff × CHARGEABLE kg/m³ (per the pick\'s own basis), not goods',
    resultFix.totals.freightUsdTypical === expectedFreightTypical, resultFix.totals.freightUsdTypical + ' vs ' + expectedFreightTypical);
  // The same tariff priced off the GOODS figure instead would give a materially different
  // number — proves the fix actually moved the pricing base, not just added extra fields.
  const perUnitGoods = pick.basis === 'м³' ? resultFix.totals.goodsM3 : resultFix.totals.goodsKg;
  const freightIfGoods = Math.round((pick.typicalUsd * perUnitGoods * (1 + pick.extrasPct / 100) + Number.EPSILON) * 100) / 100;
  check('82c fix: freight priced off chargeable is NOT the same as if it were priced off goods',
    resultFix.totals.freightUsdTypical !== freightIfGoods, resultFix.totals.freightUsdTypical + ' vs ' + freightIfGoods);

  // No payment at all: the rate must read 0 loud, not silent — a warning, not a 0 ₽ cost nobody notices.
  const ctxNoPayment = Object.assign({}, ctxFix, { payments: [] });
  const noPaymentResult = h.chinaForecastCalc({ lines: [{ article: 'ART1', pieces: 1 }] }, ctxNoPayment);
  check('82c fix: with no payment the rate reads 0 and a warning is raised, not a silent 0 ₽',
    noPaymentResult.rubRate === 0 && noPaymentResult.warnings.indexOf('нет курса: ни одной оплаты') !== -1,
    JSON.stringify(noPaymentResult.warnings));
  check('82c fix: a known payment raises no such warning',
    resultFix.warnings.indexOf('нет курса: ни одной оплаты') === -1, JSON.stringify(resultFix.warnings));

  // A second fixture where goods density (85) and chargeable density (80.08) fall on OPPOSITE
  // sides of the switch (84.16) — Python: chargeableKg = 85×1.14 = 96.9, chargeableM³ = 1.21,
  // chargeableDensity = 80.08. If the pick were still made off the GOODS figure (as before this
  // fix), basis would read кг; made off chargeable, as it must, it reads м³ — the strongest
  // possible proof the pick itself moved to chargeable, not just the final multiplication.
  const ctxFlip = Object.assign({}, ctxFix, {
    directory: { ART1: { pcsPerBox: 1, boxKg: 85, boxVolumeM3: 1, priceCny: 50 } }
  });
  const resultFlip = h.chinaForecastCalc({ lines: [{ article: 'ART1', pieces: 1 }] }, ctxFlip);
  check('82c fix: chargeable density (80.08, below the 84.16 switch) picks м³, not кг as the goods density (85) would',
    resultFlip.totals.goodsDensityKgM3 === 85 && resultFlip.totals.chargeableDensityKgM3 === 80.08 &&
    resultFlip.pick.basis === 'м³', JSON.stringify(resultFlip.totals) + ' / basis ' + resultFlip.pick.basis);
})();

// ---- calcChinaForecast / saveChinaForecast: the whole path, server recomputes always ----
(function () {
  const h = withChina();
  h.saveChinaReport({ reportDate: '2026-09-25', source: 'скрипт', orders: [], receipts: [], freights: chinaRealFreights() }, 'Николай');
  h.saveChinaPayment({ date: '2026-09-20', amountRub: 62500, rate: 12.5, comment: '' }, 'Николай');

  const article = 'FORECAST-ART';
  h.saveChinaBatch({
    orderNo: '77', code: 'NV-TEST-1', status: 'Прибыла', shippedAt: '2026-01-01', arrivedAt: '2026-02-01',
    lines: [{ marking: 'NVX', name: 'x', boxes: 10, pcsPerBox: 10, qty: 100, priceCny: 20,
      boxLengthM: 0.3, boxWidthM: 0.2, boxHeightM: 0.1, factoryBoxKg: 5, article: article }]
  }, 'Николай');

  const calc = h.calcChinaForecast({ lines: [{ article: article, pieces: 55 }] });
  check('82c: calcChinaForecast finds the box the batch above just gave the directory',
    calc.lines[0].boxes === 6 && !calc.lines[0].warning, JSON.stringify(calc.lines[0]));

  const saved = h.saveChinaForecast({
    orderNo: '77', comment: 'испытание', lines: [{ article: article, pieces: 55 }],
    // A browser-sent result — must be ignored outright, the server recomputes its own.
    result: { totals: { costRubTypical: 999999999 } }
  }, 'Николай');
  const forecastRow = saved.forecasts[0];
  check('82c: saveChinaForecast recomputes on the server — the bogus browser result never lands',
    forecastRow.result.totals.costRubTypical !== 999999999 &&
    forecastRow.result.totals.costRubTypical === calc.totals.costRubTypical,
    JSON.stringify(forecastRow.result.totals));
  check('82c: the forecast is stored under its own order number and comment',
    forecastRow.orderNo === '77' && forecastRow.comment === 'испытание', JSON.stringify(forecastRow));
  check('82c fix: getChinaForecastData carries tariffSummary through the whole path — 12 bills, switch 84.16',
    saved.tariffSummary.n === 12 && saved.tariffSummary.switchDensity === 84.16, JSON.stringify(saved.tariffSummary));

  // vs-fact: the batch of order 77 above already has a cost (saveChinaBatch costs on save via
  // recalc elsewhere, or at least ships the box/weight the forecast can compare against).
  const fact = forecastRow.fact[0];
  check('82c: vs-fact matches by orderNo and reads the actual pieces back',
    fact && fact.article === article && fact.pieces.fact === 100, JSON.stringify(fact));

  // A forecast under an order number NOTHING was ever shipped against reads an empty fact list.
  const noOrder = h.saveChinaForecast({ orderNo: 'NO-SUCH-ORDER', lines: [{ article: article, pieces: 10 }] }, 'Николай');
  const noOrderForecast = noOrder.forecasts.filter(function (f) { return f.orderNo === 'NO-SUCH-ORDER'; })[0];
  check('82c: an order nothing was ever shipped against reads an empty fact list',
    noOrderForecast.fact.length === 0, JSON.stringify(noOrderForecast.fact));

  // Edit an existing forecast (send its id back) — must UPDATE the row, not add a second one.
  const before = h.getChinaForecastData().forecasts.length;
  h.saveChinaForecast({ id: forecastRow.id, orderNo: '77', comment: 'изменено', lines: [{ article: article, pieces: 55 }] }, 'Николай');
  const afterEdit = h.getChinaForecastData();
  check('82c: editing an existing forecast (its own id) updates the row, does not add one',
    afterEdit.forecasts.length === before &&
    afterEdit.forecasts.filter(function (f) { return f.id === forecastRow.id; })[0].comment === 'изменено',
    afterEdit.forecasts.length + ' vs ' + before);

  const idToDelete = forecastRow.id;
  const afterDelete = h.deleteChinaForecast({ id: idToDelete }, 'Николай');
  check('82c: deleteChinaForecast removes exactly that forecast',
    afterDelete.forecasts.filter(function (f) { return f.id === idToDelete; }).length === 0, JSON.stringify(afterDelete.forecasts.map(function (f) { return f.id; })));

  let msg = '';
  try { h.deleteChinaForecast({ id: idToDelete }, 'Николай'); } catch (e) { msg = e.message; }
  check('82c: deleting an already-gone forecast is refused, not silently ok',
    msg.indexOf('не найден') !== -1, msg);
})();

// ================= Item 83: China batches/forecasts become «Заказы на фабрике» rows =========
//
// «Заказы на фабрике» lives in the MAIN spreadsheet (sheetRegistry, getRegistrySheet/
// dumpFactoryOrders), a DIFFERENT fake spreadsheet from the China module's own (targetSheets) —
// syncChinaFactoryOrders crosses between the two exactly as the live app does.

function byKeySuffix(rows, needle) {
  return rows.filter(function (r) { return String(r['Ключ Китай'] || '').indexOf(needle) !== -1; });
}

// ---- 83a: batch save -> rows, split lines summed, skip rules, expected date ----
(function () {
  const h = withChina();
  const article = 'ART-83A';

  // History batch (shipped before 2026-08-01): must give NO row at all.
  h.saveChinaBatch({
    orderNo: '39', code: 'NV-0701-1', status: 'В пути', shippedAt: '2026-07-01',
    lines: [{ marking: 'H1', boxes: 1, pcsPerBox: 5, qty: 5, priceCny: 5, article: article }]
  }, 'Николай');
  check('83a: a history batch (shipped before tracking start) gives no factory row',
    byKeySuffix(h.dumpFactoryOrders(), ':' + article).length === 0, JSON.stringify(h.dumpFactoryOrders()));

  // Order 40: two split lines of the SAME article (summed to 15) plus one line with no our
  // article (skipped outright). No arrival date -> expected = shipped + transitDays (30).
  h.saveChinaBatch({
    orderNo: '40', code: 'NV-0901-1', status: 'В пути', shippedAt: '2026-09-01',
    lines: [
      { marking: 'M1', boxes: 1, pcsPerBox: 10, qty: 10, priceCny: 5, article: article },
      { marking: 'M2', boxes: 1, pcsPerBox: 5, qty: 5, priceCny: 5, article: article },
      { marking: 'M3', boxes: 1, pcsPerBox: 7, qty: 7, priceCny: 5, article: '' }
    ]
  }, 'Николай');
  let rows = h.dumpFactoryOrders();
  const row40 = byKeySuffix(rows, ':' + article).filter(function (r) { return r['Заказ Китай'] === '40'; })[0];
  check('83a: split lines of the same article are summed into ONE row (10+5=15), the line without our article skipped',
    !!row40 && Number(row40['Количество']) === 15, JSON.stringify(row40));
  check('83a: no arrival date -> expected = shipped + transitDays (2026-09-01 + 30 = 2026-10-01)',
    row40 && row40['Ожидаемое прибытие'] === '2026-10-01', JSON.stringify(row40));
  check('83a: the row carries the batch code, order number, source and a stable key',
    row40 && row40['Партия Китай'] === 'NV-0901-1' && row40['Источник'] === 'Китай' && row40['Статус'] === 'active',
    JSON.stringify(row40));

  // Order 41, SAME article, a DIFFERENT batch -> a SECOND row (two batches, two rows).
  h.saveChinaBatch({
    orderNo: '41', code: 'NV-0905-1', status: 'Черновик', shippedAt: '2026-09-05',
    lines: [{ marking: 'M4', boxes: 1, pcsPerBox: 20, qty: 20, priceCny: 5, article: article }]
  }, 'Николай');
  rows = byKeySuffix(h.dumpFactoryOrders(), ':' + article);
  check('83a: the same article in two different batches gives TWO rows',
    rows.length === 2 && rows.some(function (r) { return r['Заказ Китай'] === '40'; }) && rows.some(function (r) { return r['Заказ Китай'] === '41'; }),
    JSON.stringify(rows));

  // An arrival date on the batch overrides the shipped+transitDays estimate.
  h.saveChinaBatch({
    id: h.getChinaBatches().batches.filter(function (b) { return b.orderNo === '40'; })[0].id,
    orderNo: '40', code: 'NV-0901-1', status: 'В пути', shippedAt: '2026-09-01', arrivedAt: '2026-09-20',
    lines: [{ marking: 'M1', boxes: 1, pcsPerBox: 10, qty: 10, priceCny: 5, article: article },
      { marking: 'M2', boxes: 1, pcsPerBox: 5, qty: 5, priceCny: 5, article: article }]
  }, 'Николай');
  const row40b = byKeySuffix(h.dumpFactoryOrders(), ':' + article).filter(function (r) { return r['Заказ Китай'] === '40'; })[0];
  check('83a: a known arrival date wins over the shipped+transitDays estimate',
    row40b['Ожидаемое прибытие'] === '2026-09-20', JSON.stringify(row40b));
})();

// ---- 83d: status «Прибыла» alone does NOT mark the row received (item 84: only POSTING
// does), and a status taken back still reopens a row that never left active in the first place ----
(function () {
  const h = withChina();
  const article = 'ART-83D';
  const saved = h.saveChinaBatch({
    orderNo: '42', code: 'NV-0902-1', status: 'В пути', shippedAt: '2026-09-01',
    lines: [{ marking: 'M1', boxes: 1, pcsPerBox: 10, qty: 10, priceCny: 5, article: article }]
  }, 'Николай');
  const batchId = saved.batches[0].id;

  h.saveChinaBatch({ id: batchId, orderNo: '42', code: 'NV-0902-1', status: 'Прибыла',
    shippedAt: '2026-09-01', arrivedAt: '2026-09-25',
    lines: [{ marking: 'M1', boxes: 1, pcsPerBox: 10, qty: 10, priceCny: 5, article: article }]
  }, 'Николай');
  let row = byKeySuffix(h.dumpFactoryOrders(), ':' + article)[0];
  check('83d (item 84): «Прибыла» alone keeps the row ACTIVE — it becomes received only at posting',
    row['Статус'] === 'active' && row['Дата получения'] === '', JSON.stringify(row));

  // Status taken back (owner corrects a mistaken «Прибыла») -> the row stays active, as before.
  h.saveChinaBatch({ id: batchId, orderNo: '42', code: 'NV-0902-1', status: 'В пути',
    shippedAt: '2026-09-01',
    lines: [{ marking: 'M1', boxes: 1, pcsPerBox: 10, qty: 10, priceCny: 5, article: article }]
  }, 'Николай');
  row = byKeySuffix(h.dumpFactoryOrders(), ':' + article)[0];
  check('83d: a status taken back leaves the row active, no received date',
    row['Статус'] === 'active' && row['Дата получения'] === '', JSON.stringify(row));
})();

// ---- 83c: delete/restore a batch ----
(function () {
  const h = withChina();
  const article = 'ART-83C';
  const saved = h.saveChinaBatch({
    orderNo: '43', code: 'NV-0903-1', status: 'В пути', shippedAt: '2026-09-01',
    lines: [{ marking: 'M1', boxes: 1, pcsPerBox: 10, qty: 10, priceCny: 5, article: article }]
  }, 'Николай');
  const batchId = saved.batches[0].id;
  check('83c: an active batch gives exactly one row before deletion',
    byKeySuffix(h.dumpFactoryOrders(), ':' + article).length === 1, '');

  h.deleteChinaBatch({ id: batchId }, 'Николай');
  check('83c: deleting an active batch removes its factory row',
    byKeySuffix(h.dumpFactoryOrders(), ':' + article).length === 0, JSON.stringify(h.dumpFactoryOrders()));

  const archived = h.getArchivedItems().filter(function (a) { return a.type === 'ChinaBatch'; })[0];
  h.restoreArchivedItem(archived.archiveId, 'Николай');
  check('83c: restoring the batch brings its factory row back',
    byKeySuffix(h.dumpFactoryOrders(), ':' + article).length === 1, JSON.stringify(h.dumpFactoryOrders()));
})();

// ---- 83b: forecast rows — appear with expectedShipAt, vanish once a real batch exists ----
(function () {
  const h = withChina();
  const article = 'ART-83B';
  h.saveChinaBatch({
    orderNo: '44', code: 'NV-BOX-1', status: 'Прибыла', shippedAt: '2026-01-01', arrivedAt: '2026-02-01',
    lines: [{ marking: 'NVX', name: 'x', boxes: 10, pcsPerBox: 10, qty: 100, priceCny: 20,
      boxLengthM: 0.3, boxWidthM: 0.2, boxHeightM: 0.1, factoryBoxKg: 5, article: article }]
  }, 'Николай'); // gives the box directory an entry for `article`, history batch (2026-01)

  h.saveChinaForecast({
    orderNo: '45', lines: [{ article: article, pieces: 55 }], expectedShipAt: '2026-09-01'
  }, 'Николай');
  let rows = byKeySuffix(h.dumpFactoryOrders(), ':' + article).filter(function (r) { return r['Заказ Китай'] === '45'; });
  check('83b: a forecast with an order number and a shipping date gives a factory row (55 pcs)',
    rows.length === 1 && Number(rows[0]['Количество']) === 55 && rows[0]['Источник'] === 'Китай прогноз',
    JSON.stringify(rows));
  check('83b: the forecast row\'s expected date is expectedShipAt + transitDays (30)',
    rows[0]['Ожидаемое прибытие'] === '2026-10-01', JSON.stringify(rows[0]));

  // A real batch of the SAME order number appears -> the forecast row must vanish.
  h.saveChinaBatch({
    orderNo: '45', code: 'NV-0905-2', status: 'В пути', shippedAt: '2026-09-01',
    lines: [{ marking: 'M1', boxes: 1, pcsPerBox: 10, qty: 10, priceCny: 5, article: article }]
  }, 'Николай');
  rows = byKeySuffix(h.dumpFactoryOrders(), ':' + article).filter(function (r) { return r['Заказ Китай'] === '45'; });
  check('83b: once a real batch of the same order exists, the forecast row is gone (one row, the batch\'s)',
    rows.length === 1 && rows[0]['Источник'] === 'Китай', JSON.stringify(rows));

  // A forecast with no expectedShipAt gives no row at all.
  h.saveChinaForecast({ orderNo: '46', lines: [{ article: article, pieces: 10 }] }, 'Николай');
  check('83b: a forecast with no expectedShipAt gives no factory row',
    byKeySuffix(h.dumpFactoryOrders(), ':' + article).filter(function (r) { return r['Заказ Китай'] === '46'; }).length === 0, '');
})();

// ---- 83c: idempotence — a second sync in a row changes nothing ----
(function () {
  const h = withChina();
  const article = 'ART-83IDEM';
  h.saveChinaBatch({
    orderNo: '47', code: 'NV-0906-1', status: 'В пути', shippedAt: '2026-09-01',
    lines: [{ marking: 'M1', boxes: 1, pcsPerBox: 10, qty: 10, priceCny: 5, article: article }]
  }, 'Николай'); // already synced once, by the save itself
  const again = h.syncChinaFactoryOrders('Николай');
  check('83c: a second sync right after the first writes nothing (idempotent)',
    again.added === 0 && again.updated === 0 && again.removed === 0, JSON.stringify(again));
})();

// ---- Item 92: real Sheets turns the written 'yyyy-MM-dd' of a factory row into a Date cell; the
// stand does not auto-convert, so the conversion is staged by hand. A sync over such cells used to
// compare String(Date) with the text, rewrite every date and report them as «updated». ----
(function () {
  const h = withChina();
  h.saveChinaBatch({
    orderNo: '92', code: 'NV-0910-1', status: 'В пути', shippedAt: '2026-09-01',
    lines: [{ marking: 'M1', boxes: 1, pcsPerBox: 10, qty: 10, priceCny: 5, article: 'ART-92DATE' }]
  }, 'Николай');
  const fo = h.getRegistrySheet('Заказы на фабрике');
  const dump = fo.__dump();
  const headers = dump[0].map(function (x) { return String(x).trim(); });
  const dateCols = ['Дата заказа', 'Ожидаемое прибытие'].map(function (n) { return headers.indexOf(n); });
  const keyCol = headers.indexOf('Ключ Китай');
  const want = {};
  dump.forEach(function (r, i) {
    if (i === 0 || String(r[keyCol]).indexOf('ART-92DATE') === -1) return;
    dateCols.forEach(function (c) {
      want[c] = r[c];
      r[c] = new h.FakeDate(String(r[c]) + 'T00:00:00+03:00');
    });
  });
  fo.__setData(dump);
  check('92: (setup) both date cells of the batch row are staged as Date cells',
    dateCols.every(function (c) { return /^\d{4}-\d{2}-\d{2}$/.test(String(want[c])); }), JSON.stringify(want));

  const again = h.syncChinaFactoryOrders('Николай');
  check('92: a sync over Date cells holding the same dates reports nothing updated',
    again.added === 0 && again.updated === 0 && again.removed === 0, JSON.stringify(again));
  const after = fo.__dump().filter(function (r, i) { return i > 0 && String(r[keyCol]).indexOf('ART-92DATE') !== -1; })[0];
  check('92: and leaves those cells as they were — no rewrite to text',
    dateCols.every(function (c) { return typeof after[c] !== 'string'; }), JSON.stringify(after));

  // A genuinely different date still gets written.
  const dump2 = fo.__dump();
  dump2.forEach(function (r, i) {
    if (i > 0 && String(r[keyCol]).indexOf('ART-92DATE') !== -1) r[dateCols[1]] = new h.FakeDate('2026-05-05T00:00:00+03:00');
  });
  fo.__setData(dump2);
  const fixed = h.syncChinaFactoryOrders('Николай');
  const row = h.dumpFactoryOrders().filter(function (r) { return String(r['Ключ Китай']).indexOf('ART-92DATE') !== -1; })[0];
  check('92: a Date cell holding a different date is still corrected and counted',
    fixed.updated === 1 && row && row['Ожидаемое прибытие'] === want[dateCols[1]], JSON.stringify(fixed) + JSON.stringify(row));
})();

// ---- 83f: manual rows are byte-for-byte untouched by China writes ----
(function () {
  const h = withChina();
  h.saveFactoryOrder({ article: 'ART-MANUAL', qty: 7, expectedAt: '2026-12-01', comment: 'ручной' }, 'Николай');
  const before = h.dumpRegistrySheet('Заказы на фабрике');

  h.saveChinaBatch({
    orderNo: '48', code: 'NV-0907-1', status: 'В пути', shippedAt: '2026-09-01',
    lines: [{ marking: 'M1', boxes: 1, pcsPerBox: 10, qty: 10, priceCny: 5, article: 'ART-83OTHER' }]
  }, 'Николай');
  h.syncChinaFactoryOrders('Николай');
  const after = h.dumpRegistrySheet('Заказы на фабрике');
  const manualRowBefore = before.filter(function (r) { return r[1] === 'ART-MANUAL'; })[0];
  const manualRowAfter = after.filter(function (r) { return r[1] === 'ART-MANUAL'; })[0];
  check('83f: a manual row is byte-for-byte untouched by an unrelated China write and a manual sync',
    JSON.stringify(manualRowBefore) === JSON.stringify(manualRowAfter), JSON.stringify(manualRowBefore) + ' vs ' + JSON.stringify(manualRowAfter));
})();

// ---- 83f: guards — a China row cannot be edited/cancelled/received from the warehouse side ----
(function () {
  const h = withChina();
  const article = 'ART-83GUARD';
  h.saveChinaBatch({
    orderNo: '49', code: 'NV-0908-1', status: 'В пути', shippedAt: '2026-09-01',
    lines: [{ marking: 'M1', boxes: 1, pcsPerBox: 10, qty: 10, priceCny: 5, article: article }]
  }, 'Николай');
  const chinaRow = h.getFactoryOrders().filter(function (o) { return o.article === article; })[0];

  let msg = '';
  try { h.saveFactoryOrder({ id: chinaRow.id, article: article, qty: 99, expectedAt: '' }, 'Николай'); } catch (e) { msg = e.message; }
  check('83f: saveFactoryOrder with the id of a China row is refused',
    msg.indexOf('Заказы в Китае') !== -1, msg);

  msg = '';
  try { h.cancelFactoryOrder({ id: chinaRow.id }, 'Николай'); } catch (e) { msg = e.message; }
  check('83f: cancelFactoryOrder on a China row is refused',
    msg.indexOf('Заказы в Китае') !== -1, msg);

  msg = '';
  try { h.setFactoryOrderReceived({ id: chinaRow.id }, 'Николай'); } catch (e) { msg = e.message; }
  check('83f: setFactoryOrderReceived on a China row is refused',
    msg.indexOf('Заказы в Китае') !== -1, msg);

  // A manual save WITHOUT an id must never merge into the China row of the same article —
  // it creates a NEW manual row instead.
  const beforeCount = h.getFactoryOrders().length;
  h.saveFactoryOrder({ article: article, qty: 3, expectedAt: '' }, 'Николай');
  const afterOrders = h.getFactoryOrders();
  check('83f: a merge without an id skips a China row of the same article and creates a new manual one',
    afterOrders.length === beforeCount + 1 &&
    afterOrders.filter(function (o) { return o.article === article && o.source === ''; }).length === 1,
    JSON.stringify(afterOrders));
})();

// ---- 83e: conflict resolution — 'это тот же заказ' / 'это разные заказы' ----
(function () {
  const h = withChina();
  const article = 'ART-83E';
  h.saveChinaBatch({
    orderNo: '50', code: 'NV-0909-1', status: 'В пути', shippedAt: '2026-09-01',
    lines: [{ marking: 'M1', boxes: 1, pcsPerBox: 10, qty: 10, priceCny: 5, article: article }]
  }, 'Николай');

  // same = true: the manual row is closed as 'replaced'.
  const manual1 = h.saveFactoryOrder({ article: article, qty: 5, expectedAt: '' }, 'Николай')
    .filter(function (o) { return o.source === ''; })[0];
  h.resolveFactoryOrderConflict({ id: manual1.id, same: true }, 'Николай');
  let after = h.getFactoryOrders().filter(function (o) { return o.id === manual1.id; })[0];
  check("83e: same=true closes the manual row as 'replaced', noting the China order",
    after.status === 'replaced' && after.comment.indexOf('50') !== -1, JSON.stringify(after));

  // same = false: the manual row is kept active, marked 'Проверено' — a different order.
  const manual2 = h.saveFactoryOrder({ article: article, qty: 8, expectedAt: '' }, 'Николай')
    .filter(function (o) { return o.source === '' && o.status === 'active'; })[0];
  h.resolveFactoryOrderConflict({ id: manual2.id, same: false }, 'Николай');
  after = h.getFactoryOrders().filter(function (o) { return o.id === manual2.id; })[0];
  check("83e: same=false keeps the manual row active and marks it 'Проверено'",
    after.status === 'active' && after.checked === true, JSON.stringify(after));

  let msg = '';
  try { h.resolveFactoryOrderConflict({ id: 'no-such-id', same: true }, 'Николай'); } catch (e) { msg = e.message; }
  check('83e: resolving a non-existent order is refused, not silently ok',
    msg.indexOf('не найден') !== -1, msg);
})();

// ---- 83i: the admin sync action reports the pipeline qty per article before/after ----
(function () {
  const h = withChina();
  const article = 'ART-83I';
  h.saveFactoryOrder({ article: article, qty: 5, expectedAt: '' }, 'Николай');
  const report = h.syncChinaFactoryOrdersReport('Николай');
  check('83i: the report carries a summary and a before/after qty per article',
    report.summary && typeof report.summary.added === 'number' &&
    report.before[article] === 5 && report.after[article] === 5,
    JSON.stringify(report));

  h.saveChinaBatch({
    orderNo: '51', code: 'NV-0910-1', status: 'В пути', shippedAt: '2026-09-01',
    lines: [{ marking: 'M1', boxes: 1, pcsPerBox: 10, qty: 30, priceCny: 5, article: article }]
  }, 'Николай'); // saveChinaBatch already synced once — the manual row is now hidden
  const report2 = h.syncChinaFactoryOrdersReport('Николай');
  check('83i: after a China batch shadows the manual row, before/after both read the China qty only',
    report2.before[article] === 30 && report2.after[article] === 30, JSON.stringify(report2));
})();

// ---- The owner's real case: «Миска_двойная» / order 29 must not double-count, and 0 on arrival ----
(function () {
  const h = withChina();
  const article = 'Миска_двойная';
  h.setNow('2026-09-25T09:00:00Z');
  // The manual row was recorded BEFORE the China shipment went out — exactly the real timeline
  // (owner entered «Миска_двойная» by hand, then the China batch of order 29 followed later).
  const manual = h.saveFactoryOrder({ article: article, qty: 50, orderedAt: '2026-09-10', expectedAt: '' }, 'Николай')[0];
  h.saveChinaBatch({
    orderNo: '29', code: 'NV-0916-24', status: 'В пути', shippedAt: '2026-09-16',
    lines: [{ marking: 'MD1', boxes: 1, pcsPerBox: 80, qty: 80, priceCny: 5, article: article }]
  }, 'Николай');

  let today = h.factoryPipelineQtyByArticleGs(h.getFactoryOrders(), '2026-09-25');
  check("owner's case: an active manual order is hidden by a China batch shipped later — pipeline reads only 80, not 130",
    today[article] === 80, JSON.stringify(today));

  // The batch arrives («Прибыла») — the owner has NOT resolved the conflict (the manual row is
  // still 'active', not 'checked'). Item 84: the China row stays ACTIVE until POSTED (the goods
  // are not really on stock yet), so the pipeline still reads 80 — not 50 (no double count with
  // the still-hidden manual row) and not 0 either (the goods are not on the shelf yet).
  const batchId = h.getChinaBatches().batches.filter(function (b) { return b.orderNo === '29'; })[0].id;
  h.saveChinaBatch({
    id: batchId, orderNo: '29', code: 'NV-0916-24', status: 'Прибыла',
    shippedAt: '2026-09-16', arrivedAt: '2026-09-24',
    lines: [{ marking: 'MD1', boxes: 1, pcsPerBox: 80, qty: 80, priceCny: 5, article: article }]
  }, 'Николай');
  today = h.factoryPipelineQtyByArticleGs(h.getFactoryOrders(), '2026-09-25');
  check("owner's case, conflict NOT resolved: after «Прибыла» (still unposted) the pipeline reads 80, not 130 — no double count, but not zeroed either",
    today[article] === 80, JSON.stringify(today));

  // The owner can still close the manual row as the same order even after arrival — the China
  // row itself still stays active/80 until it is actually posted (item 84).
  h.resolveFactoryOrderConflict({ id: manual.id, same: true }, 'Николай');
  today = h.factoryPipelineQtyByArticleGs(h.getFactoryOrders(), '2026-09-25');
  check("owner's case: resolving the conflict after arrival still reads 80 (the manual row is now 'replaced', China row still unposted)",
    today[article] === 80, JSON.stringify(today));
})();

// ---- 83e fix: a manual order placed AFTER the China shipment is a DIFFERENT order, counted ----
(function () {
  const h = withChina();
  const article = 'ART-83E-LATER';
  h.saveChinaBatch({
    orderNo: '52', code: 'NV-0911-1', status: 'В пути', shippedAt: '2026-09-01',
    lines: [{ marking: 'M1', boxes: 1, pcsPerBox: 10, qty: 80, priceCny: 5, article: article }]
  }, 'Николай');
  h.saveFactoryOrder({ article: article, qty: 20, orderedAt: '2026-09-10', expectedAt: '' }, 'Николай');
  const today = h.factoryPipelineQtyByArticleGs(h.getFactoryOrders(), '2026-09-25');
  check('a manual order dated AFTER the China shipment is a separate order, not hidden — pipeline reads 100 (80+20)',
    today[article] === 100, JSON.stringify(today));
})();

// ---- 83e fix: SAME-DAY boundary — a China shipment dated exactly on the manual order's own date still hides it ----
(function () {
  const h = withChina();
  const article = 'ART-83E-SAMEDAY';
  h.saveFactoryOrder({ article: article, qty: 20, orderedAt: '2026-09-10', expectedAt: '' }, 'Николай');
  h.saveChinaBatch({
    orderNo: '53', code: 'NV-0910-1', status: 'В пути', shippedAt: '2026-09-10',
    lines: [{ marking: 'M1', boxes: 1, pcsPerBox: 10, qty: 80, priceCny: 5, article: article }]
  }, 'Николай');
  const today = h.factoryPipelineQtyByArticleGs(h.getFactoryOrders(), '2026-09-25');
  check("a China shipment dated the SAME day as the manual order (>=, not just >) still hides it — pipeline reads 80, not 100",
    today[article] === 80, JSON.stringify(today));
})();

// ================= Owner, 2026-09-25 (live check): items 1/2/3 =================
//
// Item 1: saveChinaBatch's `costs` field replaces the whole Russian-side cost list in one call,
// dropping an empty/zero row and auto-ticking «Расходы РФ внесены» once a positive one lands.
(function () {
  const h = withChina();
  const saved = h.saveChinaBatch({
    orderNo: '60', code: 'NV-0925-1', status: 'В пути', shippedAt: '2026-09-01',
    lines: [{ marking: 'M1', boxes: 1, pcsPerBox: 10, qty: 10, priceCny: 5 }],
    costs: [{ type: 'Разгрузка', amountRub: 1000 }, { type: 'Прочее', amountRub: 0 }]
  }, 'Николай');
  const batch = saved.batches[0];
  check('Item 1: a zero-amount cost row is dropped — only the positive one is saved',
    batch.costs.length === 1 && batch.costs[0].amountRub === 1000 && batch.costs[0].kind === 'Разгрузка',
    JSON.stringify(batch.costs));
  check('Item 1: rubCostsDone auto-ticks once a positive cost row is saved in the same call',
    batch.rubCostsDone === true, JSON.stringify(batch.rubCostsDone));
  check('Item 1: the batch recosts once, in this same call — «Расходы РФ ₽» reflects the new row',
    batch.rubCosts === 1000, JSON.stringify(batch.rubCosts));

  // Resaving with only an empty row replaces (does not add to) the cost list — it drops the
  // previous positive row entirely — but never resets the flag it already set.
  const saved2 = h.saveChinaBatch({
    id: batch.id, orderNo: '60', code: 'NV-0925-1', status: 'В пути', shippedAt: '2026-09-01',
    lines: [{ marking: 'M1', boxes: 1, pcsPerBox: 10, qty: 10, priceCny: 5 }],
    costs: [{ type: 'Прочее', amountRub: 0 }]
  }, 'Николай');
  const batch2 = saved2.batches[0];
  check('Item 1: resaving with no positive rows drops the old cost — the list is REPLACED, not appended to',
    batch2.costs.length === 0 && batch2.rubCosts === 0, JSON.stringify(batch2.costs));
  check('Item 1: a save with no positive cost rows leaves «Расходы РФ внесены» untouched (still «да»)',
    batch2.rubCostsDone === true, JSON.stringify(batch2.rubCostsDone));

  // A plain label/edit save with NO `costs` key at all must not touch the cost list.
  const saved3 = h.saveChinaBatch({
    id: batch.id, orderNo: '60', code: 'NV-0925-1', status: 'В пути', shippedAt: '2026-09-01',
    lines: [{ marking: 'M1', boxes: 1, pcsPerBox: 10, qty: 10, priceCny: 5, article: 'ART-60' }]
  }, 'Николай');
  check('Item 1: a save with no `costs` key at all leaves the (now empty) cost list untouched',
    saved3.batches[0].costs.length === 0, JSON.stringify(saved3.batches[0].costs));

  // Editing an existing row in place (its own id sent back) keeps the SAME id and date, rather
  // than deleting and re-creating it — the row's history in the sheet is not a fresh row.
  const saved4 = h.saveChinaBatch({
    id: batch.id, orderNo: '60', code: 'NV-0925-1', status: 'В пути', shippedAt: '2026-09-01',
    lines: [{ marking: 'M1', boxes: 1, pcsPerBox: 10, qty: 10, priceCny: 5 }],
    costs: [{ type: 'Разгрузка', amountRub: 500 }]
  }, 'Николай');
  const firstId = saved4.batches[0].costs[0].id;
  const saved5 = h.saveChinaBatch({
    id: batch.id, orderNo: '60', code: 'NV-0925-1', status: 'В пути', shippedAt: '2026-09-01',
    lines: [{ marking: 'M1', boxes: 1, pcsPerBox: 10, qty: 10, priceCny: 5 }],
    costs: [{ id: firstId, type: 'Разгрузка', amountRub: 700 }]
  }, 'Николай');
  check('Item 1: editing a row by its own id keeps the same id and only its amount changes',
    saved5.batches[0].costs.length === 1 && saved5.batches[0].costs[0].id === firstId &&
    saved5.batches[0].costs[0].amountRub === 700, JSON.stringify(saved5.batches[0].costs));

  // Isolation: a second batch's costs are never touched by the first batch's save.
  h.saveChinaBatch({
    orderNo: '61', code: 'NV-0925-2', status: 'В пути', shippedAt: '2026-09-01',
    lines: [{ marking: 'M1', boxes: 1, pcsPerBox: 10, qty: 10, priceCny: 5 }],
    costs: [{ type: 'Прочее', amountRub: 300 }]
  }, 'Николай');
  const other = h.saveChinaBatch({
    id: batch.id, orderNo: '60', code: 'NV-0925-1', status: 'В пути', shippedAt: '2026-09-01',
    lines: [{ marking: 'M1', boxes: 1, pcsPerBox: 10, qty: 10, priceCny: 5 }],
    costs: [{ type: 'Прочее', amountRub: 999 }]
  }, 'Николай');
  const untouched = other.batches.filter(function (b) { return b.code === 'NV-0925-2'; })[0];
  check('Item 1: another batch\'s cost list is not touched by this batch\'s cost save',
    untouched.costs.length === 1 && untouched.costs[0].amountRub === 300, JSON.stringify(untouched.costs));

  let badKind = '';
  try {
    h.saveChinaBatch({
      id: batch.id, orderNo: '60', code: 'NV-0925-1', status: 'В пути', shippedAt: '2026-09-01',
      lines: [{ marking: 'M1', boxes: 1, pcsPerBox: 10, qty: 10, priceCny: 5 }],
      costs: [{ type: 'Таможня', amountRub: 100 }]
    }, 'Николай');
  } catch (e) { badKind = e.message; }
  check('Item 1: an unknown cost type is refused',
    /Неизвестный тип расхода/.test(badKind), badKind);
})();

// Item A (owner, 2026-09-25 live check): a re-save without costs must never make «Чего не
// хватает» disagree with the already-set «Расходы РФ внесены» flag — the flag used to stay
// 'да' (the merge always preserved the CELL) while the missing list drifted to «не
// подтверждены» because it read the call's own (empty) batch.rubCostsDone instead of the row's.
(function () {
  const h = withChina();
  const saved = h.saveChinaBatch({
    orderNo: '62', code: 'NV-0925-3', status: 'Прибыла', shippedAt: '2026-09-01', arrivedAt: '2026-09-10',
    weightKg: 100, ratePerKgUsd: 2, rubRate: 12,
    lines: [{ marking: 'M1', boxes: 1, pcsPerBox: 10, qty: 10, priceCny: 5 }],
    costs: [{ type: 'Разгрузка', amountRub: 1000 }]
  }, 'Николай');
  const batch = saved.batches[0];
  check('Item A: the flag is «да» and the missing list has no «не подтверждены» right after the cost save',
    batch.rubCostsDone === true && batch.missing.indexOf('расходы РФ не подтверждены') === -1,
    JSON.stringify({ rubCostsDone: batch.rubCostsDone, missing: batch.missing }));

  // Re-save WITHOUT costs (a plain label edit) — the flag stays 'да' from the sheet, and the
  // missing list must agree with it.
  const resaved = h.saveChinaBatch({
    id: batch.id, orderNo: '62', code: 'NV-0925-3', status: 'Прибыла', shippedAt: '2026-09-01', arrivedAt: '2026-09-10',
    weightKg: 100, ratePerKgUsd: 2, rubRate: 12,
    lines: [{ marking: 'M1', boxes: 1, pcsPerBox: 10, qty: 10, priceCny: 5, article: 'ART-62' }]
  }, 'Николай');
  const resavedBatch = resaved.batches[0];
  check('Item A: a re-save with no `costs` key keeps the flag «да» and drops the false «не подтверждены»',
    resavedBatch.rubCostsDone === true && resavedBatch.missing.indexOf('расходы РФ не подтверждены') === -1,
    JSON.stringify({ rubCostsDone: resavedBatch.rubCostsDone, missing: resavedBatch.missing }));

  // A report upload recosts every batch (chinaRecostAll → recalcChinaBatch, which reads the
  // flag straight off the row) — the agreement must survive that too.
  h.saveChinaReport({ reportDate: '2026-09-25', source: 'скрипт', orders: [], receipts: [], freights: [] }, 'Николай');
  const afterReport = h.getChinaBatches().batches.filter(function (b) { return b.id === batch.id; })[0];
  check('Item A: a report-triggered recost also keeps the flag/missing agreement',
    afterReport.rubCostsDone === true && afterReport.missing.indexOf('расходы РФ не подтверждены') === -1,
    JSON.stringify({ rubCostsDone: afterReport.rubCostsDone, missing: afterReport.missing }));

  // A payment recost (saveChinaPayment → chinaRecostAll) too.
  h.saveChinaPayment({ date: '2026-09-11', amountRub: 100, rate: 12, purpose: 'Товар', orderNo: '62' }, 'Николай');
  const afterPayment = h.getChinaBatches().batches.filter(function (b) { return b.id === batch.id; })[0];
  check('Item A: a payment-triggered recost also keeps the flag/missing agreement',
    afterPayment.rubCostsDone === true && afterPayment.missing.indexOf('расходы РФ не подтверждены') === -1,
    JSON.stringify({ rubCostsDone: afterPayment.rubCostsDone, missing: afterPayment.missing }));
})();

// Item 2: «оплачено полностью» must not show up for a batch with nothing to compare a payment
// against — chinaRemainingOf now says explicitly whether each side (goods/freight) is known.
(function () {
  const h = withChina();
  const saved = h.saveChinaBatch({
    code: 'NV-0825-2', status: 'В пути', shippedAt: '2026-08-27',
    lines: [{ marking: 'NV-99', boxes: 1, pcsPerBox: 10, qty: 10, priceCny: 5, article: 'ART-0825' }]
  }, 'Николай');
  const before = saved.batches[0];
  check('Item 2: no order number at all — remainingGoodsKnown is false («не с чем сверить»)',
    before.remainingGoodsKnown === false, JSON.stringify(before.remainingGoodsKnown));
  check('Item 2: no bill for this code in any report — remainingFreightKnown is false',
    before.remainingFreightKnown === false, JSON.stringify(before.remainingFreightKnown));

  // Item 3: the owner's live case — the report's bill for the SAME code carries the order and
  // the arrival the batch itself does not have yet.
  h.saveChinaReport({
    reportDate: '2026-09-25', source: 'скрипт',
    orders: [{ orderNo: '28', date: '2026-08-01', receivedCny: 5000, totalCny: 5000, unpaidCny: 0 }],
    receipts: [{ date: '2026-09-05', goodsCny: 5000, freightCny: 0, freightUsd: 0 }],
    freights: [{ code: 'NV-0825-2', orderNo: '28', arrivedAt: '2026-09-17', amountUsd: 100, cargoRate: 7 }]
  }, 'Николай');
  const batches = h.getChinaBatches().batches;
  const after = batches.filter(function (b) { return b.code === 'NV-0825-2'; })[0];
  check('Item 3: the empty order number is filled from the report\'s own bill (28)',
    after.orderNo === '28', JSON.stringify(after.orderNo));
  check('Item 3: the arrival date/status are filled once the bill states an arrival',
    after.arrivedAt === '2026-09-17' && after.status === 'Прибыла',
    JSON.stringify({ arrivedAt: after.arrivedAt, status: after.status }));
  check('Item 3: the goods rate source is no longer «последняя оплата» once order 28 has real money',
    after.goodsRateSource !== 'последняя оплата', JSON.stringify(after.goodsRateSource));
  check('Item 2: both sides are known now — remainingGoodsKnown/remainingFreightKnown are true',
    after.remainingGoodsKnown === true && after.remainingFreightKnown === true,
    JSON.stringify({ g: after.remainingGoodsKnown, f: after.remainingFreightKnown }));

  const row = byKeySuffix(h.dumpFactoryOrders(), ':ART-0825')[0];
  check('Item 3 (item 84): the filled-in arrival alone keeps the row active — only posting marks it received',
    !!row && row['Статус'] === 'active' && row['Дата получения'] === '', JSON.stringify(row));
})();

// Item 3: a draft matched to the bill by its code minus the trailing «-N» — order filled, stays
// not arrived (the owner's live NV-0916 / NV-0916-24 case).
// Item C (owner, 2026-09-25 live check): the SAME upload also renames the draft to the bill's own
// full code and moves it to «В пути» — no arrival in the bill leaves it not-arrived either way.
(function () {
  const h = withChina();
  h.saveChinaBatch({
    code: 'NV-0916', status: 'Черновик',
    lines: [{ marking: 'Миска_двойная', boxes: 1, pcsPerBox: 1, qty: 1, priceCny: 1 }]
  }, 'Николай');
  h.saveChinaReport({
    reportDate: '2026-09-25', source: 'скрипт',
    orders: [{ orderNo: '29', date: '2026-09-01', receivedCny: 0, totalCny: 0, unpaidCny: 0 }],
    receipts: [],
    freights: [{ code: 'NV-0916-24', orderNo: '29', amountUsd: 20, cargoRate: 7 }]
  }, 'Николай');
  const batch = h.getChinaBatches().batches.filter(function (b) { return b.code === 'NV-0916-24'; })[0];
  check('Item C: a draft matched by prefix takes the bill\'s own full code',
    !!batch, JSON.stringify(h.getChinaBatches().batches.map(function (b) { return b.code; })));
  check('Item 3: a draft\'s code = the bill\'s code minus its trailing -N — order 29 filled',
    batch.orderNo === '29', JSON.stringify(batch.orderNo));
  check('Item C: no arrival in the bill, but the rename moves a Черновик on to «В пути»',
    batch.arrivedAt === '' && batch.status === 'В пути',
    JSON.stringify({ arrivedAt: batch.arrivedAt, status: batch.status }));
})();

// Item 3: an ambiguous prefix match (two bills agree) is refused outright — no fill at all.
(function () {
  const h = withChina();
  h.saveChinaBatch({
    code: 'NV-0917', status: 'Черновик',
    lines: [{ marking: 'M1', boxes: 1, pcsPerBox: 1, qty: 1, priceCny: 1 }]
  }, 'Николай');
  h.saveChinaReport({
    reportDate: '2026-09-25', source: 'скрипт',
    orders: [], receipts: [],
    freights: [
      { code: 'NV-0917-1', orderNo: '30', amountUsd: 10, cargoRate: 7 },
      { code: 'NV-0917-2', orderNo: '31', amountUsd: 10, cargoRate: 7 }
    ]
  }, 'Николай');
  const batch = h.getChinaBatches().batches.filter(function (b) { return b.code === 'NV-0917'; })[0];
  check('Item 3: an ambiguous prefix match (two bills agree) is refused — order number stays empty',
    batch.orderNo === '', JSON.stringify(batch.orderNo));
})();

// Item 3: an order number already on the batch, disagreeing with the report's bill, is KEPT —
// the disagreement is reported in «Чего не хватает» instead of being silently resolved.
(function () {
  const h = withChina();
  h.saveChinaBatch({
    orderNo: '99', code: 'NV-0930-1', status: 'В пути', shippedAt: '2026-09-01',
    lines: [{ marking: 'M1', boxes: 1, pcsPerBox: 10, qty: 10, priceCny: 5 }]
  }, 'Николай');
  h.saveChinaReport({
    reportDate: '2026-09-25', source: 'скрипт',
    orders: [{ orderNo: '28', date: '2026-08-01', receivedCny: 100, totalCny: 100, unpaidCny: 0 }],
    receipts: [{ date: '2026-09-05', goodsCny: 100, freightCny: 0, freightUsd: 0 }],
    freights: [{ code: 'NV-0930-1', orderNo: '28', amountUsd: 50, cargoRate: 7 }]
  }, 'Николай');
  const batch = h.getChinaBatches().batches.filter(function (b) { return b.code === 'NV-0930-1'; })[0];
  check('Item 3: a differing order number already on the batch is kept, not overwritten',
    batch.orderNo === '99', JSON.stringify(batch.orderNo));
  check('Item 3: the mismatch is reported in «Чего не хватает»',
    batch.missing.indexOf('номер заказа в отчёте: 28') !== -1, JSON.stringify(batch.missing));
})();

// Item 3b: saveChinaBatch itself fills the order/arrival from an ALREADY uploaded report — the
// fill is not only run from saveChinaReport.
(function () {
  const h = withChina();
  h.saveChinaReport({
    reportDate: '2026-09-01', source: 'скрипт',
    orders: [{ orderNo: '32', date: '2026-08-01', receivedCny: 10, totalCny: 10, unpaidCny: 0 }],
    receipts: [{ date: '2026-08-05', goodsCny: 10, freightCny: 0, freightUsd: 0 }],
    freights: [{ code: 'NV-0801-1', orderNo: '32', amountUsd: 10, cargoRate: 7 }]
  }, 'Николай');
  const saved = h.saveChinaBatch({
    code: 'NV-0801-1', status: 'В пути', shippedAt: '2026-08-01',
    lines: [{ marking: 'M1', boxes: 1, pcsPerBox: 1, qty: 1, priceCny: 1 }]
  }, 'Николай');
  check('Item 3b: saveChinaBatch itself fills the order number from an already-uploaded report',
    saved.batches[0].orderNo === '32', JSON.stringify(saved.batches[0].orderNo));
})();

// chinaMatchReportBill / chinaFillOrderFromBill — pure unit checks of the matching/fill rules.
(function () {
  const h = freshHarness();
  const freights = [
    { code: 'NV-01', orderNo: '1' },
    { code: 'NV-02-3', orderNo: '2', arrivedAt: '2026-09-10' }
  ];
  check('chinaMatchReportBill: an exact code match wins, any status',
    h.chinaMatchReportBill(freights, { code: 'NV-01', status: 'В пути' }).orderNo === '1', '');
  // Item B (owner, 2026-09-25): the prefix match is no longer limited to a Черновик — the SAME
  // matcher is used everywhere, «Not only for drafts».
  check('chinaMatchReportBill: a prefix match applies to ANY status, not only a Черновик',
    h.chinaMatchReportBill(freights, { code: 'NV-02', status: 'В пути' }).orderNo === '2', '');
  check('chinaMatchReportBill: matches the bill\'s code minus its trailing -N',
    h.chinaMatchReportBill(freights, { code: 'NV-02', status: 'Черновик' }).orderNo === '2', '');
  // Item B: an exact match wins even when a DIFFERENT bill would also prefix-match.
  const withBoth = freights.concat([{ code: 'NV-02', orderNo: '9' }]);
  check('chinaMatchReportBill: an exact match is preferred over a prefix match',
    h.chinaMatchReportBill(withBoth, { code: 'NV-02', status: 'Черновик' }).orderNo === '9', '');

  const fill = h.chinaFillOrderFromBill(freights, { code: 'NV-02', status: 'Черновик', orderNo: '', arrivedAt: '' });
  check('chinaFillOrderFromBill: fills order + arrival + status when the batch has none of its own',
    fill.orderNo === '2' && fill.arrivedAt === '2026-09-10' && fill.status === 'Прибыла' && fill.changed === true,
    JSON.stringify(fill));

  const kept = h.chinaFillOrderFromBill(freights, { code: 'NV-01', status: 'В пути', orderNo: '999', arrivedAt: '' });
  check('chinaFillOrderFromBill: never overwrites an order number the batch already has',
    kept.orderNo === '999' && kept.changed === false, JSON.stringify(kept));
})();

// Item B (owner, 2026-09-25 live check): the batch's own freight fields, filled from its matched
// bill — the owner's live NV-0916 / NV-0916-24 case, priced per kg (not m³).
(function () {
  const h = freshHarness();
  const freights = [{ code: 'NV-0916-24', orderNo: '29', ratePerKgUsd: 2.6, weightKg: 408, volumeM3: 4.04, amountUsd: 1109 }];
  const fill = h.chinaFillOrderFromBill(freights, { code: 'NV-0916', status: 'Черновик' });
  check('Item B: the bill\'s $/кг, $, weight and volume are filled onto the empty batch',
    fill.ratePerKgUsd === 2.6 && fill.freightUsd === 1109 && fill.weightKg === 408 && fill.volumeM3 === 4.04,
    JSON.stringify(fill));

  // A bill priced per m³ (chinaTariffFromFreight's own basis rule) leaves the $/кг rate empty —
  // only the bill's total «Перевозка $» is filled.
  const m3Freights = [{ code: 'NV-0920', ratePerKgUsd: 3, weightKg: 50, volumeM3: 10, amountUsd: 30 }];
  const m3Fill = h.chinaFillOrderFromBill(m3Freights, { code: 'NV-0920', status: 'Черновик' });
  check('Item B: a bill priced per m³ fills only «Перевозка $», never the $/кг rate',
    m3Fill.ratePerKgUsd === 0 && m3Fill.freightUsd === 30, JSON.stringify(m3Fill));

  // An owner-typed (or batch-file) non-empty rate is never overwritten.
  const owned = h.chinaFillOrderFromBill(freights, { code: 'NV-0916', status: 'Черновик', ratePerKgUsd: 9.9 });
  check('Item B: a non-empty owner rate is never overwritten by the bill\'s own',
    owned.ratePerKgUsd === 9.9, JSON.stringify(owned));

  // Same for the batch's own non-empty «Перевозка $» and «Вес накладной, кг».
  const ownedFreight = h.chinaFillOrderFromBill(freights, { code: 'NV-0916', status: 'Черновик', freightUsd: 555 });
  check('Item B: a non-empty owner freight $ is never overwritten by the bill\'s own',
    ownedFreight.freightUsd === 555, JSON.stringify(ownedFreight));
  const ownedWeight = h.chinaFillOrderFromBill(freights, { code: 'NV-0916', status: 'Черновик', weightKg: 111 });
  check('Item B: a non-empty owner weight is never overwritten by the bill\'s own',
    ownedWeight.weightKg === 111, JSON.stringify(ownedWeight));
})();

// Item C (owner, 2026-09-25 live check): «почему поставка nv-0916 в статусе черновик и почему не
// подтянулся её полный номер» — a Черновик's rename to its bill's own full code, pure unit checks.
(function () {
  const h = freshHarness();
  const freights = [{ code: 'NV-0916-24', orderNo: '29', shippedAt: '2026-09-16' }];

  const renamed = h.chinaFillOrderFromBill(freights, { code: 'NV-0916', status: 'Черновик' }, []);
  check('Item C: a Черновик takes the bill\'s own full code and moves to «В пути»',
    renamed.code === 'NV-0916-24' && renamed.status === 'В пути' && renamed.shippedAt === '2026-09-16' &&
    renamed.changed === true, JSON.stringify(renamed));

  // Own shippedAt is only ARRIVAL-file data (receivedAt), same value under the wrong field — the
  // bill's real shipping date still replaces it.
  const wrongShipped = h.chinaFillOrderFromBill(freights,
    { code: 'NV-0916', status: 'Черновик', shippedAt: '2026-09-15', receivedAt: '2026-09-15' }, []);
  check('Item C: shippedAt that is really the arrival-file date is replaced by the bill\'s own',
    wrongShipped.shippedAt === '2026-09-16', JSON.stringify(wrongShipped));

  // A real, typed shipping date is never touched.
  const realShipped = h.chinaFillOrderFromBill(freights,
    { code: 'NV-0916', status: 'Черновик', shippedAt: '2026-09-14', receivedAt: '2026-09-15' }, []);
  check('Item C: a shippedAt that differs from receivedAt is the batch\'s own — kept as is',
    realShipped.shippedAt === '2026-09-14', JSON.stringify(realShipped));

  // Another batch already carries the bill's exact code: the rename is refused, the status stays
  // «Черновик» — `chinaWithPaymentRate`'s own collision re-check is what reports it, not this fill.
  const clashed = h.chinaFillOrderFromBill(freights, { code: 'NV-0916', status: 'Черновик' }, ['NV-0916-24']);
  check('Item C: the rename is refused when another batch already carries the bill\'s code',
    clashed.code === 'NV-0916' && clashed.status === 'Черновик', JSON.stringify(clashed));

  // A batch that is NOT a draft keeps its own code — the rename rule is a Черновик-only thing.
  const notDraft = h.chinaFillOrderFromBill(freights, { code: 'NV-0916', status: 'В пути' }, []);
  check('Item C: a non-draft batch is never renamed even when a fuller bill code matches',
    notDraft.code === 'NV-0916' && notDraft.status === 'В пути', JSON.stringify(notDraft));
})();

// Item C: end to end — saveChinaBatch (a draft) then saveChinaReport (its bill) renames the draft
// and syncs «Заказы на фабрике» under the new code, keyed by the SAME batch id.
(function () {
  const h = withChina();
  h.saveChinaBatch({
    code: 'NV-0916', status: 'Черновик',
    lines: [{ marking: 'M1', boxes: 1, pcsPerBox: 10, qty: 10, priceCny: 5, article: 'ART-1' }]
  }, 'Николай');
  h.saveChinaReport({
    reportDate: '2026-09-25', source: 'скрипт', orders: [], receipts: [],
    freights: [{ code: 'NV-0916-24', orderNo: '29', shippedAt: '2026-09-16', amountUsd: 20, cargoRate: 7 }]
  }, 'Николай');
  const batches = h.getChinaBatches().batches;
  check('Item C: saveChinaReport renames the draft to the bill\'s own full code, «В пути»',
    batches.length === 1 && batches[0].code === 'NV-0916-24' && batches[0].status === 'В пути',
    JSON.stringify(batches.map(function (b) { return { code: b.code, status: b.status }; })));
  const factoryRow = byKeySuffix(h.dumpFactoryOrders(), ':ART-1')[0];
  check('Item C: «Заказы на фабрике» shows the batch\'s NEW code, keyed by the same batch id',
    !!factoryRow && factoryRow['Партия Китай'] === 'NV-0916-24', JSON.stringify(factoryRow));
})();

// Item C: two drafts that would both take the SAME bill code — the second's rename is refused,
// with a note in its own «Чего не хватает», never a silent clash of two batches under one code.
(function () {
  const h = withChina();
  h.saveChinaBatch({
    code: 'NV-0916', status: 'Черновик',
    lines: [{ marking: 'M1', boxes: 1, pcsPerBox: 10, qty: 10, priceCny: 5 }]
  }, 'Николай');
  h.saveChinaBatch({
    code: 'NV-0916-24', status: 'Черновик',
    lines: [{ marking: 'M2', boxes: 1, pcsPerBox: 10, qty: 10, priceCny: 5 }]
  }, 'Николай');
  h.saveChinaReport({
    reportDate: '2026-09-25', source: 'скрипт', orders: [], receipts: [],
    freights: [{ code: 'NV-0916-24', orderNo: '29', amountUsd: 20, cargoRate: 7 }]
  }, 'Николай');
  const batches = h.getChinaBatches().batches;
  const stillDraft = batches.filter(function (b) { return b.code === 'NV-0916'; })[0];
  check('Item C: the exact-code batch keeps NV-0916-24, the prefix-matched draft is not renamed',
    !!stillDraft && stillDraft.status === 'Черновик', JSON.stringify(batches.map(function (b) { return b.code; })));
  check('Item C: the refused rename is explained in «Чего не хватает»',
    stillDraft.missing.indexOf('накладная NV-0916-24 уже присвоена другой партии — код черновика не изменён') !== -1,
    JSON.stringify(stillDraft.missing));
})();

// Item B: an ambiguous prefix (two bills, e.g. NV-0916-2 and NV-0916-3) gets its own message in
// «Чего не хватает», on a batch of ANY status — not only a Черновик.
(function () {
  const h = withChina();
  h.saveChinaBatch({
    orderNo: '29', code: 'NV-0916', status: 'В пути', shippedAt: '2026-09-16',
    lines: [{ marking: 'M1', boxes: 1, pcsPerBox: 10, qty: 10, priceCny: 5 }]
  }, 'Николай');
  h.saveChinaReport({
    reportDate: '2026-09-25', source: 'скрипт', orders: [], receipts: [],
    freights: [
      { code: 'NV-0916-2', orderNo: '29', amountUsd: 10, cargoRate: 7 },
      { code: 'NV-0916-3', orderNo: '29', amountUsd: 10, cargoRate: 7 }
    ]
  }, 'Николай');
  const batch = h.getChinaBatches().batches.filter(function (b) { return b.code === 'NV-0916'; })[0];
  check('Item B: an ambiguous prefix match names the reason instead of the plain «no bill» message',
    batch.missing.indexOf('в отчёте несколько накладных NV-0916-…: уточните код партии') !== -1,
    JSON.stringify(batch.missing));
})();

// Item C (owner, 2026-09-25 live check): a single-product, un-priced batch (the owner's live
// NV-0916 / order 29 case) is priced from its own order's total in the newest report.
(function () {
  const h = withChina();
  const saved = h.saveChinaBatch({
    orderNo: '29', code: 'NV-0916', status: 'В пути', shippedAt: '2026-09-16',
    lines: [{ marking: 'Миска_двойная', boxes: 24, pcsPerBox: 42, qty: 1008, priceCny: 0, article: 'ART-МД' }]
  }, 'Николай');
  h.saveChinaReport({
    reportDate: '2026-09-25', source: 'скрипт',
    orders: [{ orderNo: '29', date: '2026-09-01', receivedCny: 0, totalCny: 5000, unpaidCny: 5000 }],
    receipts: [], freights: []
  }, 'Николай');
  // A manual rate stands in for the order's own known payments (which this fixture never
  // supplies) purely so the batch's own cost is non-zero — the price fill itself, the actual
  // thing under test, needs no payments at all.
  const resaved = h.saveChinaBatch({
    id: saved.batches[0].id, orderNo: '29', code: 'NV-0916', status: 'В пути', shippedAt: '2026-09-16',
    rubRate: 12,
    lines: [{ marking: 'Миска_двойная', boxes: 24, pcsPerBox: 42, qty: 1008, priceCny: 0, article: 'ART-МД' }]
  }, 'Николай');
  const batch = resaved.batches[0];
  check('Item C: the batch\'s goods ¥ equals the order\'s total exactly, to the fen',
    Math.abs(batch.goodsCny - 5000) < 0.005, JSON.stringify(batch.goodsCny));
  check('Item C: the missing list names WHY the price was filled',
    batch.missing.indexOf('цена товара взята из отчёта: сумма заказа 29 ÷ штук') !== -1,
    JSON.stringify(batch.missing));
  check('Item C: the batch\'s cost is no longer zero',
    batch.totalRub > 0, JSON.stringify(batch.totalRub));
})();

// Item C: two batches of the same order — neither gets the order's total, and the plain
// «no price» message shows instead.
(function () {
  const h = withChina();
  h.saveChinaBatch({
    orderNo: '40', code: 'NV-A', status: 'В пути', shippedAt: '2026-09-01',
    lines: [{ marking: 'M1', boxes: 1, pcsPerBox: 1, qty: 1, priceCny: 0, article: 'ART-A' }]
  }, 'Николай');
  const saved = h.saveChinaBatch({
    orderNo: '40', code: 'NV-B', status: 'В пути', shippedAt: '2026-09-02',
    lines: [{ marking: 'M2', boxes: 1, pcsPerBox: 1, qty: 1, priceCny: 0, article: 'ART-B' }]
  }, 'Николай');
  h.saveChinaReport({
    reportDate: '2026-09-25', source: 'скрипт',
    orders: [{ orderNo: '40', date: '2026-09-01', receivedCny: 0, totalCny: 1000, unpaidCny: 1000 }],
    receipts: [], freights: []
  }, 'Николай');
  const savedBId = saved.batches.filter(function (b) { return b.code === 'NV-B'; })[0].id;
  const batchB = h.saveChinaBatch({
    id: savedBId, orderNo: '40', code: 'NV-B', status: 'В пути', shippedAt: '2026-09-02',
    lines: [{ marking: 'M2', boxes: 1, pcsPerBox: 1, qty: 1, priceCny: 0, article: 'ART-B' }]
  }, 'Николай').batches.filter(function (b) { return b.code === 'NV-B'; })[0];
  check('Item C: an order shared by two batches is never split blindly — goods ¥ stays 0',
    batchB.goodsCny === 0, JSON.stringify(batchB.goodsCny));
  check('Item C: the plain «upload the batch file» message shows instead',
    batchB.missing.indexOf('нет цены товара — загрузите файл партии') !== -1, JSON.stringify(batchB.missing));
})();

// Item C: a batch with more than one PRODUCT (different articles) is never priced off an
// order's total — there is no way to split it correctly between the products.
(function () {
  const h = withChina();
  const saved = h.saveChinaBatch({
    orderNo: '41', code: 'NV-0902-1', status: 'В пути', shippedAt: '2026-09-02',
    lines: [
      { marking: 'M1', boxes: 1, pcsPerBox: 1, qty: 1, priceCny: 0, article: 'ART-C1' },
      { marking: 'M2', boxes: 1, pcsPerBox: 1, qty: 1, priceCny: 0, article: 'ART-C2' }
    ]
  }, 'Николай');
  h.saveChinaReport({
    reportDate: '2026-09-25', source: 'скрипт',
    orders: [{ orderNo: '41', date: '2026-09-01', receivedCny: 0, totalCny: 200, unpaidCny: 200 }],
    receipts: [], freights: []
  }, 'Николай');
  const batch = h.saveChinaBatch({
    id: saved.batches[0].id, orderNo: '41', code: 'NV-0902-1', status: 'В пути', shippedAt: '2026-09-02',
    lines: [
      { marking: 'M1', boxes: 1, pcsPerBox: 1, qty: 1, priceCny: 0, article: 'ART-C1' },
      { marking: 'M2', boxes: 1, pcsPerBox: 1, qty: 1, priceCny: 0, article: 'ART-C2' }
    ]
  }, 'Николай').batches[0];
  check('Item C: two different products in the same batch are never priced off the order total',
    batch.goodsCny === 0, JSON.stringify(batch.goodsCny));
  check('Item C: the plain «no price» message shows, not the order-total note',
    batch.missing.indexOf('нет цены товара — загрузите файл партии') !== -1 &&
    batch.missing.every(function (m) { return m.indexOf('цена товара взята из отчёта') === -1; }),
    JSON.stringify(batch.missing));
})();

// Item C: the batch's order is not in the newest report at all (or its total is 0 ¥) —
// nothing gets filled, and no note is added.
(function () {
  const h = withChina();
  const saved = h.saveChinaBatch({
    orderNo: '42', code: 'NV-0903-1', status: 'В пути', shippedAt: '2026-09-03',
    lines: [{ marking: 'M1', boxes: 1, pcsPerBox: 1, qty: 1, priceCny: 0, article: 'ART-C3' }]
  }, 'Николай');
  const batch = h.saveChinaBatch({
    id: saved.batches[0].id, orderNo: '42', code: 'NV-0903-1', status: 'В пути', shippedAt: '2026-09-03',
    lines: [{ marking: 'M1', boxes: 1, pcsPerBox: 1, qty: 1, priceCny: 0, article: 'ART-C3' }]
  }, 'Николай').batches[0];
  check('Item C: no report order at all — goods ¥ stays 0, no order-total note added',
    batch.goodsCny === 0 && batch.missing.every(function (m) { return m.indexOf('цена товара взята из отчёта') === -1; }),
    JSON.stringify({ goodsCny: batch.goodsCny, missing: batch.missing }));
})();

// ================= Owner, 2026-09-25: faster saveChinaBatch (per-execution read cache) ========
//
// Real Apps Script bills time for every Spreadsheet service call; one saveChinaBatch used to
// cost 18-21 s because the same sheets were read several times over as the module recomputed
// rates and synced «Заказы на фабрике». These three checks prove the fix without touching the
// costing logic itself: a ceiling on how many Spreadsheet calls one save may cost (so a
// regression that brings back a duplicate read is caught), that a write always invalidates the
// cache of ITS OWN sheet (a read right after a write must see the new value, never a stale one),
// and that the answer already carries the same money picture getChinaMoney() would.
(function () {
  const h = withChina();
  h.saveChinaBatch(batch28Payload({}), 'Николай');
  h.saveChinaPayment({ date: '2026-08-27', amountRub: 100000, rate: 12.4, orderNo: '28' }, 'Николай');
  h.saveChinaReport({
    reportDate: '2026-09-10', source: 'скрипт',
    orders: [{ orderNo: '28', date: '2026-08-27', receivedCny: 5000, totalCny: 5000 }],
    receipts: [{ date: '2026-08-27', goodsCny: 5000 }]
  }, 'Николай');

  h.resetApiCallCounts();
  const answer = h.saveChinaBatch(batch28Payload({ weightKg: 700 }), 'Николай');
  const total = h.totalApiCalls();
  check('faster saveChinaBatch: one save (existing batch, report and payment already present) ' +
    'costs well under half of the pre-cache baseline\'s ~96 Spreadsheet calls',
    total > 0 && total <= 55, 'total Spreadsheet calls: ' + total + ' -- ' + JSON.stringify(h.apiCallCounts()));

  check('faster saveChinaBatch: the answer already carries the money picture, equal to a separate getChinaMoney()',
    answer.money && JSON.stringify(answer.money) === JSON.stringify(h.getChinaMoney()),
    JSON.stringify(answer.money));
})();

(function () {
  // Read-after-write, inside ONE execution: chinaBatchesPicture(ss) is called straight after
  // writeChinaBatch() writes the very sheet it is about to re-read — if the write did not
  // invalidate this execution's cache, the answer would show the batch's PREVIOUS weight.
  const h = withChina();
  const first = h.saveChinaBatch(batch28Payload({ comment: 'первая версия' }), 'Николай').batches[0];
  const answer = h.saveChinaBatch(batch28Payload({ id: first.id, comment: 'вторая версия' }), 'Николай');
  check('faster saveChinaBatch: a write invalidates this sheet\'s cache — the very next read sees the new value',
    answer.batches[0].comment === 'вторая версия', JSON.stringify(answer.batches[0].comment));
})();

(function () {
  // The per-execution reset (chinaResetCache() as the first statement of every top-level
  // action) matters separately from write-invalidation: it is what protects a sheet a write
  // action READS but does not itself WRITE. saveChinaBatch reads «Платежи» (for the
  // «последняя оплата» rate fallback) without writing it — so a rate change made by something
  // OTHER than this execution's own writes (here: a raw poke of the sheet, standing in for the
  // Apps Script container-reuse trap the reset guards against) must still be picked up by the
  // NEXT saveChinaBatch call, not served from a cache an earlier action in this same session
  // left warm.
  const h = withChina();
  h.saveChinaPayment({ date: '2026-08-20', amountRub: 100000, rate: 12.4, comment: 'unmatched' }, 'Николай');
  const first = h.saveChinaBatch(china923Payload({ rubRate: 0 }), 'Николай').batches[0];
  check('faster saveChinaBatch: sets up with the last-payment rate as expected (12.4)',
    first.goodsRateSource === 'последняя оплата' && first.goodsRate === 12.4,
    JSON.stringify({ source: first.goodsRateSource, rate: first.goodsRate }));

  // Raw poke of «Платежи» — bypasses every write helper in ChinaOrders.gs, so only the
  // PER-ACTION RESET (not the write-time invalidation) can make the next read see it.
  const payCtxSheet = h.getTargetSheet('Платежи');
  const dump = payCtxSheet.__dump();
  dump[1][3] = 20; // 'Курс ₽/¥' column of the one payment row
  payCtxSheet.__setData(dump);

  const again = h.saveChinaBatch(china923Payload({ id: first.id, rubRate: 0, weightKg: 968 }), 'Николай').batches[0];
  check('faster saveChinaBatch: the per-action reset picks up a rate changed since the last action, not a stale cache',
    again.goodsRateSource === 'последняя оплата' && again.goodsRate === 20,
    JSON.stringify({ source: again.goodsRateSource, rate: again.goodsRate }));
})();

// ================= Item 84 (stage 1): posting an arrived China batch onto «Мой склад» =========
//
// Money-critical (posting/correction move real stock and capitalization) — full check, whole
// path through the top-level actions (postChinaBatch/cancelChinaBatchPosting/saveChinaBatch/
// saveChinaReport/getChinaBatches), not just the inner helpers.

// A batch whose carrier bill is matched (a freight entry in the report), goods priced in ¥,
// «Расходы РФ внесены» set and a manual rate — enough to be POSTABLE, but its freight bill is
// left unpaid on purpose (chinaMissingListOf's own «Расчёт закрыт» stays false), because
// posting must work BEFORE the final payment (decision 1).
function china84PostableFixture(h, over) {
  h.setSkuSheet(['SKU', 'ШТ/КОР'], [['ART-POST-1', 10], ['ART-POST-2', 10]]);
  h.setStockSheet([]);
  h.ensureTransSheet();
  h.saveChinaReport({
    reportDate: '2026-09-01', source: 'скрипт', orders: [], receipts: [],
    freights: [{ code: 'NV-POST-1', orderNo: 'P1', amountUsd: 50, cargoRate: 7 }]
  }, 'Николай');
  const payload = Object.assign({
    orderNo: 'P1', code: 'NV-POST-1', status: 'Прибыла', shippedAt: '2026-08-01', arrivedAt: '2026-08-25',
    weightKg: 100, ratePerKgUsd: 1, rubRate: 12,
    lines: [{ marking: 'M1', boxes: 10, pcsPerBox: 10, qty: 100, priceCny: 10, article: 'ART-POST-1' }],
    costs: [{ type: 'Прочее', amountRub: 500, comment: 'разгрузка' }]
  }, over || {});
  return h.saveChinaBatch(payload, 'Николай').batches[0];
}

// Same as above, but the freight bill is fully credited by a negative opening balance and no
// order is reported for 'P1' (chinaOrderKnown then defaults every goods figure to 0) — so
// chinaMissingListOf finds nothing outstanding and calc.closed is TRUE right away. Needed for
// the automatic-correction scenarios, which only fire on a CLOSED calc.
function china84ClosableFixture(h, over) {
  h.setSkuSheet(['SKU', 'ШТ/КОР'], [['ART-POST-1', 10]]);
  h.setStockSheet([]);
  h.ensureTransSheet();
  h.saveChinaReport({
    reportDate: '2026-09-01', source: 'скрипт', orders: [], receipts: [], openingFreightUsd: -50,
    freights: [{ code: 'NV-POST-1', orderNo: 'P1', amountUsd: 50, cargoRate: 7 }]
  }, 'Николай');
  const payload = Object.assign({
    orderNo: 'P1', code: 'NV-POST-1', status: 'Прибыла', shippedAt: '2026-08-01', arrivedAt: '2026-08-25',
    weightKg: 100, ratePerKgUsd: 1, rubRate: 12,
    lines: [{ marking: 'M1', boxes: 10, pcsPerBox: 10, qty: 100, priceCny: 10, article: 'ART-POST-1' }],
    costs: [{ type: 'Прочее', amountRub: 500, comment: 'разгрузка' }]
  }, over || {});
  return h.saveChinaBatch(payload, 'Николай').batches[0];
}

function china84Refuses(fn, fragment) {
  let msg = '';
  try { fn(); } catch (e) { msg = String(e && e.message || e); }
  return { threw: !!msg, msg: msg, matches: fragment ? msg.indexOf(fragment) !== -1 : true };
}

// ---- posting preview (getChinaBatches/chinaBatchesPicture) and the happy path ----
(function () {
  const h = withChina();
  const batch = china84PostableFixture(h);
  check('84: preview says canPost=true for an arrived, unposted, fully-blocked-free batch',
    batch.canPost === true, JSON.stringify({ canPost: batch.canPost, blockers: batch.postingBlockers }));
  check('84: preview lists ONE article with the ordered qty and the batch\'s own cost',
    batch.postingPreview.length === 1 && batch.postingPreview[0].article === 'ART-POST-1'
    && batch.postingPreview[0].qty === 100 && batch.postingPreview[0].costRub === batch.totalRub,
    JSON.stringify(batch.postingPreview));

  const opId = 'op-84-1';
  const posted = h.postChinaBatch({ id: batch.id, opId: opId, lines: [{ article: 'ART-POST-1', qty: 100 }] }, 'Николай');
  const postedBatch = posted.batches.filter(function (b) { return b.id === batch.id; })[0];
  check('84: posting sets the state to «предварительно» with who/when/opId',
    postedBatch.postingState === 'предварительно' && postedBatch.postedBy === 'Николай' && postedBatch.postingOpId === opId,
    JSON.stringify({ state: postedBatch.postingState, by: postedBatch.postedBy, op: postedBatch.postingOpId }));

  const stock = h.stockOf('ART-POST-1');
  check('84: «Мой склад» gets exactly the ordered quantity, capitalised at the batch\'s own cost',
    stock && stock.quantity === 100 && Math.abs(stock.capitalization - batch.totalRub) < 0.01,
    JSON.stringify({ stock: stock, totalRub: batch.totalRub }));

  const rows = h.dumpTransSheet().filter(function (r) { return String(r['Объект'] || '').indexOf('NV-POST-1') !== -1; });
  check('84: exactly one «Приход» row is written, object names the batch\'s own code',
    rows.length === 1 && rows[0]['Тип'] === 'Приход' && String(rows[0]['Объект']).indexOf('Китай: партия NV-POST-1') !== -1,
    JSON.stringify(rows));

  check('84: double click with the SAME opId is a no-op — no second receipt',
    (function () {
      h.postChinaBatch({ id: batch.id, opId: opId, lines: [{ article: 'ART-POST-1', qty: 100 }] }, 'Николай');
      return h.dumpTransSheet().filter(function (r) { return String(r['Объект'] || '').indexOf('NV-POST-1') !== -1; }).length;
    })() === 1, 'rows after a second click: ' + h.dumpTransSheet().length);

  check('84: posting an already-posted batch with a DIFFERENT opId is refused',
    china84Refuses(function () { h.postChinaBatch({ id: batch.id, opId: 'op-84-2', lines: [{ article: 'ART-POST-1', qty: 100 }] }, 'Николай'); }, 'уже оприходована').threw,
    'expected a refusal');
})();

// ---- retry after a crash between the stock write and the China-side mark ----
(function () {
  const h = withChina();
  const batch = china84PostableFixture(h);
  const opId = 'op-84-retry';
  h.postChinaBatch({ id: batch.id, opId: opId, lines: [{ article: 'ART-POST-1', qty: 100 }] }, 'Николай');
  // Simulate the crash: the stock write (commitTransaction, keyed by opId) already happened,
  // but the batch's own posting mark did not — poke «Оприходование» back to '' directly.
  const sheet = h.getTargetSheet('Партии');
  const dump = sheet.__dump();
  const headers = dump[0].map(function (x) { return String(x).trim(); });
  const postingCol = headers.indexOf('Оприходование');
  dump[1][postingCol] = '';
  sheet.__setData(dump);

  const retried = h.postChinaBatch({ id: batch.id, opId: opId, lines: [{ article: 'ART-POST-1', qty: 100 }] }, 'Николай');
  const retriedBatch = retried.batches.filter(function (b) { return b.id === batch.id; })[0];
  check('84: a retry with the same opId completes the China-side mark without re-posting the stock',
    retriedBatch.postingState === 'предварительно',
    JSON.stringify(retriedBatch.postingState));
  const stock = h.stockOf('ART-POST-1');
  const rows = h.dumpTransSheet().filter(function (r) { return String(r['Объект'] || '').indexOf('NV-POST-1') !== -1; });
  check('84: the retry does not double the stock or the transaction rows',
    stock.quantity === 100 && rows.length === 1,
    JSON.stringify({ stock: stock, rows: rows.length }));
})();

// ---- shortfall price (decision A) and one Приход per article across several lines (decision B) ----
(function () {
  const h = withChina();
  const batch = china84PostableFixture(h, {
    lines: [
      { marking: 'M1', boxes: 5, pcsPerBox: 10, qty: 50, priceCny: 10, article: 'ART-POST-1' },
      { marking: 'M2', boxes: 5, pcsPerBox: 10, qty: 50, priceCny: 10, article: 'ART-POST-1' }
    ]
  });
  const totalCost = batch.totalRub;
  const posted = h.postChinaBatch({ id: batch.id, opId: 'op-84-3', lines: [{ article: 'ART-POST-1', qty: 90 }] }, 'Николай');
  const rows = h.dumpTransSheet().filter(function (r) { return String(r['Объект'] || '').indexOf('NV-POST-1') !== -1; });
  check('84: two lines of the same article post as ONE «Приход» row',
    rows.length === 1 && Number(rows[0]['Количество']) === 90,
    JSON.stringify(rows));
  // Decision A: price = batch cost ÷ actual qty, rounded to the kopeck — «Сумма» is qty × that
  // rounded price, same as any other commitTransaction receipt, so it can differ from the
  // batch's own totalCost by at most a kopeck's worth of rounding (here 90 × 0.0044 = 0.40 ₽);
  // that residual is exactly what postingRecords.receiptRub captures for the correction step.
  const expectedPrice = roundToTwoTest(totalCost / 90);
  check('84: a shortfall (90 of 100) divides the FULL batch cost over the actual quantity, decision A',
    Number(rows[0]['Цена']) === expectedPrice
    && Math.abs(Number(rows[0]['Сумма']) - roundToTwoTest(90 * expectedPrice)) < 0.001
    && Math.abs(Number(rows[0]['Сумма']) - totalCost) < 0.5,
    JSON.stringify({ row: rows[0], totalCost: totalCost, expectedPrice: expectedPrice }));
  const postedBatch = posted.batches.filter(function (b) { return b.id === batch.id; })[0];
  check('84: postingRecords remembers the ACTUAL posted quantity, not the ordered one',
    postedBatch.postingState === 'предварительно', JSON.stringify(postedBatch.postingState));
})();

function roundToTwoTest(n) { return Math.round(n * 100) / 100; }

// ---- blockers (decision 1/9) ----
(function () {
  const h = withChina();
  const noBill = china84PostableFixture(h, { code: 'NV-OTHERCODE' }); // no freight entry for THIS code
  check('84: no matching carrier bill blocks posting',
    noBill.canPost === false && noBill.postingBlockers.some(function (m) { return m.indexOf('накладная') !== -1; }),
    JSON.stringify(noBill.postingBlockers));
  check('84: postChinaBatch itself refuses the same way',
    china84Refuses(function () { h.postChinaBatch({ id: noBill.id, opId: 'op-84-4', lines: [{ article: 'ART-POST-1', qty: 100 }] }, 'Николай'); }, 'накладная').threw,
    'expected a refusal');
})();

(function () {
  const h = withChina();
  const noCosts = china84PostableFixture(h, { costs: [] });
  check('84: «Расходы РФ» not confirmed blocks posting',
    noCosts.canPost === false && noCosts.postingBlockers.some(function (m) { return m.indexOf('Расходы РФ') !== -1; }),
    JSON.stringify(noCosts.postingBlockers));
})();

(function () {
  const h = withChina();
  const noRate = china84PostableFixture(h, { rubRate: 0 });
  check('84: no rate at all (no payments, no manual, no borrow) blocks posting',
    noRate.canPost === false && noRate.postingBlockers.some(function (m) { return m.indexOf('курс') !== -1; }),
    JSON.stringify(noRate.postingBlockers));
})();

(function () {
  const h = withChina();
  const noArticle = china84PostableFixture(h, {
    lines: [{ marking: 'M1', boxes: 10, pcsPerBox: 10, qty: 100, priceCny: 10, article: '' }]
  });
  check('84: a line with no «Наш артикул» blocks posting and names the marking',
    noArticle.canPost === false && noArticle.postingBlockers.some(function (m) { return m.indexOf('M1') !== -1 && m.indexOf('артикул') !== -1; }),
    JSON.stringify(noArticle.postingBlockers));
})();

(function () {
  const h = withChina();
  h.setSkuSheet(['SKU', 'ШТ/КОР'], []); // SKU base deliberately empty
  h.setStockSheet([]);
  h.ensureTransSheet();
  h.saveChinaReport({ reportDate: '2026-09-01', source: 'скрипт', orders: [], receipts: [],
    freights: [{ code: 'NV-POST-1', orderNo: 'P1', amountUsd: 50, cargoRate: 7 }] }, 'Николай');
  const unknownArticle = h.saveChinaBatch({
    orderNo: 'P1', code: 'NV-POST-1', status: 'Прибыла', shippedAt: '2026-08-01', arrivedAt: '2026-08-25',
    weightKg: 100, ratePerKgUsd: 1, rubRate: 12,
    lines: [{ marking: 'M1', boxes: 10, pcsPerBox: 10, qty: 100, priceCny: 10, article: 'ART-GHOST' }],
    costs: [{ type: 'Прочее', amountRub: 500, comment: 'разгрузка' }]
  }, 'Николай').batches[0];
  check('84: an article missing from the SKU base blocks posting',
    unknownArticle.canPost === false && unknownArticle.postingBlockers.some(function (m) { return m.indexOf('ART-GHOST') !== -1; }),
    JSON.stringify(unknownArticle.postingBlockers));
})();

(function () {
  const h = withChina();
  h.setSkuSheet(['SKU', 'ШТ/КОР'], [['KIT-1', 10]]);
  h.setKitSheet([{ kitSku: 'KIT-1', componentSku: 'ART-POST-1', quantity: 2, kitType: 'legacy' }]);
  h.setStockSheet([]);
  h.ensureTransSheet();
  h.saveChinaReport({ reportDate: '2026-09-01', source: 'скрипт', orders: [], receipts: [],
    freights: [{ code: 'NV-POST-1', orderNo: 'P1', amountUsd: 50, cargoRate: 7 }] }, 'Николай');
  const kitBatch = h.saveChinaBatch({
    orderNo: 'P1', code: 'NV-POST-1', status: 'Прибыла', shippedAt: '2026-08-01', arrivedAt: '2026-08-25',
    weightKg: 100, ratePerKgUsd: 1, rubRate: 12,
    lines: [{ marking: 'M1', boxes: 10, pcsPerBox: 10, qty: 100, priceCny: 10, article: 'KIT-1' }],
    costs: [{ type: 'Прочее', amountRub: 500, comment: 'разгрузка' }]
  }, 'Николай').batches[0];
  check('84: a kit article blocks posting',
    kitBatch.canPost === false && kitBatch.postingBlockers.some(function (m) { return m.indexOf('комплект') !== -1; }),
    JSON.stringify(kitBatch.postingBlockers));
})();

(function () {
  const h = withChina();
  const batch = china84PostableFixture(h);
  check('84: quantity 0 is refused (money would vanish)',
    china84Refuses(function () { h.postChinaBatch({ id: batch.id, opId: 'op-84-5', lines: [{ article: 'ART-POST-1', qty: 0 }] }, 'Николай'); }).threw,
    'expected a refusal');
  check('84: a non-integer quantity is refused',
    china84Refuses(function () { h.postChinaBatch({ id: batch.id, opId: 'op-84-6', lines: [{ article: 'ART-POST-1', qty: 1.5 }] }, 'Николай'); }).threw,
    'expected a refusal');
})();

// ---- pipeline (decision 4): active while arrived-unposted, received after posting, back after cancel ----
(function () {
  const h = withChina();
  const batch = china84PostableFixture(h);
  h.syncChinaFactoryOrdersReport('Николай');
  let row = h.dumpFactoryOrders().filter(function (r) { return String(r['Партия Китай']) === 'NV-POST-1'; })[0];
  check('84: an arrived, UNPOSTED batch keeps its factory-order row active',
    row && row['Статус'] === 'active', JSON.stringify(row));

  h.postChinaBatch({ id: batch.id, opId: 'op-84-7', lines: [{ article: 'ART-POST-1', qty: 100 }] }, 'Николай');
  row = h.dumpFactoryOrders().filter(function (r) { return String(r['Партия Китай']) === 'NV-POST-1'; })[0];
  check('84: posting turns the factory-order row «received» with the posting date',
    row && row['Статус'] === 'received' && String(row['Дата получения']).length > 0,
    JSON.stringify(row));

  h.cancelChinaBatchPosting({ id: batch.id }, 'Николай');
  row = h.dumpFactoryOrders().filter(function (r) { return String(r['Партия Китай']) === 'NV-POST-1'; })[0];
  check('84: cancelling posting returns the factory-order row to active',
    row && row['Статус'] === 'active', JSON.stringify(row));
})();

// ---- Item 91: the live defect of 2026-10-09. Google Sheets turned the written posting stamp
// into a Date cell; read back with String() it became 'Fri Oct 09 2026 …', split(' ')[0] gave
// «Fri», and that landed in «Дата получения», after which getFactoryOrders threw and the whole
// «Остатки Озон» load (getOzonInitialData) failed. The stand does not auto-convert, so the
// conversion is staged by hand: the cell is replaced with a Date of the SAME moment. ----
function item91DateCellBatch(h) {
  const batch = china84PostableFixture(h);
  h.postChinaBatch({ id: batch.id, opId: 'op-91', lines: [{ article: 'ART-POST-1', qty: 100 }] }, 'Николай');
  const sheet = h.getTargetSheet('Партии');
  const dump = sheet.__dump();
  const col = dump[0].map(function (x) { return String(x).trim(); }).indexOf('Дата оприходования');
  // 2026-10-09 14:36 Yekaterinburg = 12:36 МСК (the stand's zone) = 09:36 UTC — the live posting.
  dump[1][col] = new h.FakeDate('2026-10-09T09:36:00Z');
  sheet.__setData(dump);
  return batch;
}

(function () {
  const h = withChina();
  const batch = item91DateCellBatch(h);
  // The live state: the bad sync already wrote «Fri» into the factory row.
  const fo = h.getRegistrySheet('Заказы на фабрике');
  const foDump = fo.__dump();
  const recCol = foDump[0].map(function (x) { return String(x).trim(); }).indexOf('Дата получения');
  const keyCol = foDump[0].map(function (x) { return String(x).trim(); }).indexOf('Ключ Китай');
  let staged = 0;
  foDump.forEach(function (r, i) {
    if (i > 0 && String(r[keyCol]).indexOf(batch.id) !== -1) { r[recCol] = 'Fri'; staged++; }
  });
  fo.__setData(foDump);
  check('91: (setup) the live «Fri» is staged on the batch\'s factory row', staged === 1, String(staged));

  const posted = h.getChinaBatches().batches.filter(function (b) { return b.id === batch.id; })[0];
  check('91: a Date cell in «Дата оприходования» reads back as the stamp, not «Fri Oct 09…»',
    posted.postedAt === '2026-10-09 12:36:00', JSON.stringify(posted.postedAt));

  h.syncChinaFactoryOrdersReport('Николай');
  const row = h.dumpFactoryOrders().filter(function (r) { return String(r['Ключ Китай']).indexOf(batch.id) !== -1; })[0];
  check('91: the next sync heals «Fri» in «Дата получения» to the posting date',
    row && row['Дата получения'] === '2026-10-09', JSON.stringify(row && row['Дата получения']));
})();

(function () {
  const h = withChina();
  item91DateCellBatch(h);
  const fo = h.getRegistrySheet('Заказы на фабрике');
  const foDump = fo.__dump();
  const headers = foDump[0].map(function (x) { return String(x).trim(); });
  const blank = headers.map(function () { return ''; });
  const bad = blank.slice(); bad[headers.indexOf('ID')] = 'BAD-91'; bad[headers.indexOf('Артикул')] = 'ART-BAD';
  bad[headers.indexOf('Дата заказа')] = 'Thu'; bad[headers.indexOf('Количество')] = 5;
  bad[headers.indexOf('Ожидаемое прибытие')] = 'Sat'; bad[headers.indexOf('Статус')] = 'received';
  bad[headers.indexOf('Дата получения')] = 'Fri';
  const good = blank.slice(); good[headers.indexOf('ID')] = 'GOOD-91'; good[headers.indexOf('Артикул')] = 'ART-GOOD';
  good[headers.indexOf('Дата заказа')] = '2026-10-01'; good[headers.indexOf('Количество')] = 7;
  good[headers.indexOf('Ожидаемое прибытие')] = '2026-10-20'; good[headers.indexOf('Статус')] = 'active';
  foDump.push(bad, good);
  fo.__setData(foDump);
  h.logs.length = 0;

  let orders = null, threw = '';
  try { orders = h.getFactoryOrders(); } catch (e) { threw = e.message; }
  check('91: one unreadable date no longer makes getFactoryOrders throw', threw === '', threw);
  const badOut = (orders || []).filter(function (o) { return o.id === 'BAD-91'; })[0];
  check('91: every unreadable date of the row is dropped to empty, the rest of the row kept',
    badOut && badOut.orderedAt === '' && badOut.expectedAt === '' && badOut.receivedAt === ''
      && badOut.qty === 5 && badOut.status === 'received', JSON.stringify(badOut));
  const goodOut = (orders || []).filter(function (o) { return o.id === 'GOOD-91'; })[0];
  check('91: the other rows read as before',
    goodOut && goodOut.orderedAt === '2026-10-01' && goodOut.expectedAt === '2026-10-20' && goodOut.qty === 7,
    JSON.stringify(goodOut));
  check('91: each dropped date is logged with its row and column',
    h.logs.filter(function (l) { return l.indexOf('«Дата получения»') !== -1 && l.indexOf('"Fri"') !== -1; }).length === 1
      && h.logs.filter(function (l) { return l.indexOf('«Дата заказа»') !== -1 && l.indexOf('"Thu"') !== -1; }).length === 1
      && h.logs.filter(function (l) { return l.indexOf('«Ожидаемое прибытие»') !== -1 && l.indexOf('"Sat"') !== -1; }).length === 1,
    JSON.stringify(h.logs));
  let refused = '';
  try { h.context.normalizeFactoryDate('Fri'); } catch (e) { refused = e.message; }
  check('91: writes still validate strictly — normalizeFactoryDate refuses «Fri»',
    refused.indexOf('ГГГГ-ММ-ДД') !== -1, refused);
})();

(function () {
  const h = withChina();
  const sheet = h.getTargetSheet('Тарифы карго');
  const dump = sheet.__dump();
  const headers = dump[0].map(function (x) { return String(x).trim(); });
  const row = headers.map(function () { return ''; });
  row[headers.indexOf('Код партии')] = 'NV-T91';
  row[headers.indexOf('Дата отгрузки')] = new h.FakeDate('2026-09-01T00:00:00+03:00');
  row[headers.indexOf('Дата прибытия')] = new h.FakeDate('2026-09-20T00:00:00+03:00');
  row[headers.indexOf('Обновлено')] = new h.FakeDate('2026-09-21T10:15:00+03:00');
  sheet.__setData([dump[0], row]);
  const t = h.chinaTariffList(h.context.chinaSpreadsheet()).filter(function (x) { return x.code === 'NV-T91'; })[0];
  check('91: «Тарифы карго» Date cells read back as dates, not «Tue Sep 01…»',
    t && t.shippedAt === '2026-09-01' && t.arrivedAt === '2026-09-20' && t.updatedAt === '2026-09-21 10:15:00',
    JSON.stringify(t));
})();

// ---- cancel posting: happy path and all-or-nothing refusal ----
(function () {
  const h = withChina();
  const batch = china84PostableFixture(h);
  h.postChinaBatch({ id: batch.id, opId: 'op-84-8', lines: [{ article: 'ART-POST-1', qty: 100 }] }, 'Николай');
  const cancelled = h.cancelChinaBatchPosting({ id: batch.id }, 'Николай');
  const cancelledBatch = cancelled.batches.filter(function (b) { return b.id === batch.id; })[0];
  check('84: cancelling posting clears the batch\'s posting state',
    cancelledBatch.postingState === '', JSON.stringify(cancelledBatch.postingState));
  const stock = h.stockOf('ART-POST-1');
  check('84: cancelling posting rolls the stock all the way back',
    stock.quantity === 0 && stock.capitalization === 0, JSON.stringify(stock));
  const archived = h.dumpArchive().filter(function (a) { return a.type === 'Transaction'; });
  check('84: the removed receipt is archived to «Удаленное», same as any other deleted «Приход»',
    archived.length === 1, JSON.stringify(archived.length));
})();

(function () {
  const h = withChina();
  const batch = china84PostableFixture(h);
  h.postChinaBatch({ id: batch.id, opId: 'op-84-9', lines: [{ article: 'ART-POST-1', qty: 100 }] }, 'Николай');
  // Part of the posted quantity is already shipped out — an ordinary «Расход», nothing to do
  // with China at all.
  h.commitTransaction([{ article: 'ART-POST-1', quantity: 60, price: 0 }], 'Расход', 'Склад [Заказ №1]', '', 'Николай');
  const before = h.stockOf('ART-POST-1');
  const refusal = china84Refuses(function () { h.cancelChinaBatchPosting({ id: batch.id }, 'Николай'); }, 'артикул ART-POST-1');
  check('84: cancelling is refused when part of the posted quantity is already shipped',
    refusal.threw && refusal.msg.indexOf('40') !== -1 && refusal.msg.indexOf('100') !== -1,
    refusal.msg);
  const after = h.stockOf('ART-POST-1');
  check('84: a refused cancellation deletes NOTHING (all-or-nothing)',
    after.quantity === before.quantity && after.capitalization === before.capitalization,
    JSON.stringify({ before: before, after: after }));
})();

(function () {
  // All-or-nothing across TWO articles: the FIRST article is fully available (nothing shipped),
  // the SECOND is short. The pre-check must refuse before touching EITHER article's receipt —
  // without it, cancelChinaBatchPosting would delete the first article's receipt and only then
  // hit deleteTransaction's own guard on the second, leaving a half-cancelled batch.
  const h = withChina();
  const batch = china84PostableFixture(h, {
    lines: [
      { marking: 'M1', boxes: 10, pcsPerBox: 10, qty: 100, priceCny: 10, article: 'ART-POST-1' },
      { marking: 'M2', boxes: 5, pcsPerBox: 10, qty: 50, priceCny: 10, article: 'ART-POST-2' }
    ]
  });
  h.postChinaBatch({ id: batch.id, opId: 'op-84-9b',
    lines: [{ article: 'ART-POST-1', qty: 100 }, { article: 'ART-POST-2', qty: 50 }] }, 'Николай');
  h.commitTransaction([{ article: 'ART-POST-2', quantity: 30, price: 0 }], 'Расход', 'Склад [Заказ №9]', '', 'Николай');
  const before1 = h.stockOf('ART-POST-1');
  const before2 = h.stockOf('ART-POST-2');
  const refusal = china84Refuses(function () { h.cancelChinaBatchPosting({ id: batch.id }, 'Николай'); }, 'ART-POST-2');
  check('84: a shortfall on the SECOND article refuses before touching the FIRST',
    refusal.threw, refusal.msg);
  check('84: the first article\'s receipt is untouched when the second blocks the whole cancellation',
    JSON.stringify(h.stockOf('ART-POST-1')) === JSON.stringify(before1)
    && JSON.stringify(h.stockOf('ART-POST-2')) === JSON.stringify(before2),
    JSON.stringify({ before1: before1, after1: h.stockOf('ART-POST-1'), before2: before2, after2: h.stockOf('ART-POST-2') }));
})();

// ---- automatic cost correction (decision 5) ----
(function () {
  const h = withChina();
  const batch = china84ClosableFixture(h);
  check('84: the closable fixture is actually closed (calc.closed / «Расчёт закрыт»)',
    batch.closed === true, JSON.stringify(batch.missing));
  const posted = h.postChinaBatch({ id: batch.id, opId: 'op-84-10', lines: [{ article: 'ART-POST-1', qty: 100 }] }, 'Николай');
  const firstCap = h.stockOf('ART-POST-1').capitalization;

  // Raise the RF cost — the batch's total (and so ART-POST-1's cost) goes up by exactly the
  // RF delta, since it is the batch's only line/article.
  const raised = h.saveChinaBatch({
    id: batch.id, orderNo: batch.orderNo, code: batch.code, status: batch.status,
    shippedAt: batch.shippedAt, arrivedAt: batch.arrivedAt,
    weightKg: batch.weightKg, ratePerKgUsd: batch.ratePerKgUsd, rubRate: batch.rubRate,
    lines: [{ marking: 'M1', boxes: 10, pcsPerBox: 10, qty: 100, priceCny: 10, article: 'ART-POST-1' }],
    costs: [{ type: 'Прочее', amountRub: 800, comment: 'разгрузка' }]
  }, 'Николай').batches.filter(function (b) { return b.id === batch.id; })[0];
  check('84: a save of a posted, closed batch turns it «окончательно»',
    raised.postingState === 'окончательно', JSON.stringify(raised.postingState));
  const capAfterRaise = h.stockOf('ART-POST-1').capitalization;
  check('84: correction UP — capitalization grows by exactly the batch cost delta (300 ₽ of RF costs)',
    Math.abs((capAfterRaise - firstCap) - 300) < 0.01,
    JSON.stringify({ firstCap: firstCap, capAfterRaise: capAfterRaise }));

  // Lower it back — correction DOWN.
  h.saveChinaBatch({
    id: batch.id, orderNo: batch.orderNo, code: batch.code, status: batch.status,
    shippedAt: batch.shippedAt, arrivedAt: batch.arrivedAt,
    weightKg: batch.weightKg, ratePerKgUsd: batch.ratePerKgUsd, rubRate: batch.rubRate,
    lines: [{ marking: 'M1', boxes: 10, pcsPerBox: 10, qty: 100, priceCny: 10, article: 'ART-POST-1' }],
    costs: [{ type: 'Прочее', amountRub: 500, comment: 'разгрузка' }]
  }, 'Николай');
  const capAfterLower = h.stockOf('ART-POST-1').capitalization;
  check('84: correction DOWN — capitalization drops back to the original',
    Math.abs(capAfterLower - firstCap) < 0.01, JSON.stringify({ firstCap: firstCap, capAfterLower: capAfterLower }));

  const rowsBefore = h.dumpTransSheet().length;
  // A repeated save with the SAME money must not correct a third time.
  h.saveChinaBatch({
    id: batch.id, orderNo: batch.orderNo, code: batch.code, status: batch.status,
    shippedAt: batch.shippedAt, arrivedAt: batch.arrivedAt,
    weightKg: batch.weightKg, ratePerKgUsd: batch.ratePerKgUsd, rubRate: batch.rubRate,
    lines: [{ marking: 'M1', boxes: 10, pcsPerBox: 10, qty: 100, priceCny: 10, article: 'ART-POST-1' }],
    costs: [{ type: 'Прочее', amountRub: 500, comment: 'разгрузка' }]
  }, 'Николай');
  check('84: a repeated save with nothing new does not correct twice',
    h.dumpTransSheet().length === rowsBefore, 'rows before/after: ' + rowsBefore + '/' + h.dumpTransSheet().length);

  const replayed = h.replayArticle('ART-POST-1', 0);
  check('84: the stock verifier/replay still agrees after posting + two corrections',
    h.replayMatchesFacts(replayed).ok, JSON.stringify(h.replayMatchesFacts(replayed)));
})();

// ---- a repeated report upload does not correct twice ----
(function () {
  const h = withChina();
  const batch = china84ClosableFixture(h);
  h.postChinaBatch({ id: batch.id, opId: 'op-84-11', lines: [{ article: 'ART-POST-1', qty: 100 }] }, 'Николай');
  const reportPayload = {
    reportDate: '2026-09-05', source: 'скрипт', orders: [], receipts: [], openingFreightUsd: -50,
    freights: [{ code: 'NV-POST-1', orderNo: 'P1', amountUsd: 50, cargoRate: 7 }]
  };
  h.saveChinaReport(reportPayload, 'Николай');
  const capAfterFirst = h.stockOf('ART-POST-1').capitalization;
  const rowsAfterFirst = h.dumpTransSheet().length;
  h.saveChinaReport(Object.assign({}, reportPayload, { reportDate: '2026-09-06' }), 'Николай');
  check('84: a repeated report upload (nothing new to correct) writes no new correction row',
    h.dumpTransSheet().length === rowsAfterFirst && h.stockOf('ART-POST-1').capitalization === capAfterFirst,
    JSON.stringify({ rows: h.dumpTransSheet().length, cap: h.stockOf('ART-POST-1').capitalization }));
})();

// ---- correction with 0 pcs on stock: the existing «долг себестоимости» mechanism (item 40) ----
(function () {
  const h = withChina();
  const batch = china84ClosableFixture(h);
  h.postChinaBatch({ id: batch.id, opId: 'op-84-12', lines: [{ article: 'ART-POST-1', qty: 100 }] }, 'Николай');
  // Ship every posted piece out — the article sits at 0 on stock.
  h.commitTransaction([{ article: 'ART-POST-1', quantity: 100, price: 0 }], 'Расход', 'Склад [Заказ №2]', '', 'Николай');
  check('84: the article is at 0 pcs before the correction',
    h.stockOf('ART-POST-1').quantity === 0, JSON.stringify(h.stockOf('ART-POST-1')));

  h.saveChinaBatch({
    id: batch.id, orderNo: batch.orderNo, code: batch.code, status: batch.status,
    shippedAt: batch.shippedAt, arrivedAt: batch.arrivedAt,
    weightKg: batch.weightKg, ratePerKgUsd: batch.ratePerKgUsd, rubRate: batch.rubRate,
    lines: [{ marking: 'M1', boxes: 10, pcsPerBox: 10, qty: 100, priceCny: 10, article: 'ART-POST-1' }],
    costs: [{ type: 'Прочее', amountRub: 800, comment: 'разгрузка' }]
  }, 'Николай');
  const debtStock = h.stockOf('ART-POST-1');
  check('84: with 0 pcs on stock the correction still lands on capitalization (the долг себестоимости) — quantity stays 0',
    debtStock.quantity === 0 && Math.abs(debtStock.capitalization - 300) < 0.01,
    JSON.stringify(debtStock));

  h.commitTransaction([{ article: 'ART-POST-1', quantity: 50, price: 20 }], 'Приход', 'Склад [Обычный приход]', '', 'Николай');
  const absorbed = h.stockOf('ART-POST-1');
  check('84: the next ordinary receipt absorbs the debt — avgCost = (debt + new cost) / new qty',
    Math.abs(absorbed.avgCost - roundToTwoTest((300 + 50 * 20) / 50)) < 0.01,
    JSON.stringify(absorbed));
})();

// ---- report upload: arrived batches are never touched, posted 'окончательно'/'уже на остатке' either ----
(function () {
  const h = withChina();
  // volumeM3 is deliberately left UNSET (0) by the fixture — chinaFillOrderFromBill's own
  // per-field guard only skips a field that is already > 0, so a still-empty field on an
  // ARRIVED batch is exactly the case that needs the batch.status === 'Прибыла' guard in
  // chinaFillBatchesFromReport, not the field-level guard (which would otherwise happily fill it).
  const batch = china84ClosableFixture(h);
  check('84: sanity — the fixture batch has no volumeM3 of its own yet', batch.volumeM3 === 0, String(batch.volumeM3));
  h.saveChinaReport({
    reportDate: '2026-09-10', source: 'скрипт', orders: [], receipts: [], openingFreightUsd: -50,
    freights: [{ code: 'NV-POST-1', orderNo: 'P1', amountUsd: 999, cargoRate: 7, volumeM3: 77 }]
  }, 'Николай');
  const after = h.getChinaBatches().batches.filter(function (b) { return b.id === batch.id; })[0];
  check('84: an already-«Прибыла» batch\'s still-empty field is never touched by a report\'s status/field fill',
    after.volumeM3 === 0, JSON.stringify({ before: batch.volumeM3, after: after.volumeM3 }));
})();

(function () {
  const h = withChina();
  const batch = china84ClosableFixture(h);
  h.postChinaBatch({ id: batch.id, opId: 'op-84-13', lines: [{ article: 'ART-POST-1', qty: 100 }] }, 'Николай');
  const closed = h.getChinaBatches().batches.filter(function (b) { return b.id === batch.id; })[0];
  check('84: posting a CLOSED batch is promoted to «окончательно» by the next report/save (already verified above); here it starts «предварительно»',
    closed.postingState === 'предварительно', JSON.stringify(closed.postingState));
  // Force it to «окончательно» via one report upload, then upload ANOTHER report with a wildly
  // different bill for the SAME code — an окончательно batch must not be recosted at all.
  h.saveChinaReport({ reportDate: '2026-09-05', source: 'скрипт', orders: [], receipts: [], openingFreightUsd: -50,
    freights: [{ code: 'NV-POST-1', orderNo: 'P1', amountUsd: 50, cargoRate: 7 }] }, 'Николай');
  const finalBatch = h.getChinaBatches().batches.filter(function (b) { return b.id === batch.id; })[0];
  check('84: it is now «окончательно»', finalBatch.postingState === 'окончательно', JSON.stringify(finalBatch.postingState));
  const totalBefore = finalBatch.totalRub;
  const capBefore = h.stockOf('ART-POST-1').capitalization;
  check('84: sanity — the batch is CLOSED before the next report', finalBatch.closed === true, JSON.stringify(finalBatch.missing));
  // The credit that fully paid the freight bill is gone — recosting would reopen «Расчёт
  // закрыт» (the bill goes unpaid again). If chinaRecostAndCorrectForReport skips 'окончательно'
  // batches as it must, `closed`/`missing`/totalRub/capitalization all stay exactly as they were.
  h.saveChinaReport({ reportDate: '2026-09-06', source: 'скрипт', orders: [], receipts: [], openingFreightUsd: 0,
    freights: [{ code: 'NV-POST-1', orderNo: 'P1', amountUsd: 999, cargoRate: 20 }] }, 'Николай');
  const afterFinal = h.getChinaBatches().batches.filter(function (b) { return b.id === batch.id; })[0];
  check('84: an «окончательно» batch is not recosted by a report upload at all — closed/missing/money unchanged',
    afterFinal.closed === true && afterFinal.missing.length === finalBatch.missing.length
    && afterFinal.totalRub === totalBefore && h.stockOf('ART-POST-1').capitalization === capBefore,
    JSON.stringify({ before: { closed: finalBatch.closed, total: totalBefore }, after: { closed: afterFinal.closed, total: afterFinal.totalRub, missing: afterFinal.missing } }));
})();

// ---- R-016 (plan item 100.1): a posted batch whose goods order still has debt in the report is NOT closed ----
function china100R016Scenario(h, unpaid1) {
  h.setSkuSheet(['SKU', 'ШТ/КОР'], [['ART-POST-1', 10]]); h.setStockSheet([]); h.ensureTransSheet();
  const frt = { code: 'NV-R16', orderNo: '1', amountUsd: 10, cargoRate: 7 };
  h.saveChinaReport({ reportDate: '2026-09-01', source: 'скрипт',
    orders: [{ orderNo: '1', date: '2026-08-20', receivedCny: 100, totalCny: 1000, unpaidCny: unpaid1 }],
    receipts: [{ date: '2026-09-01', goodsCny: 100, freightCny: 70, freightUsd: 10 }], freights: [frt] }, 'Николай');
  h.saveChinaPayment({ date: '2026-09-01', amountRub: 1700, rate: 10, comment: 'P1' }, 'Николай');
  const pl = function (id) {
    return Object.assign(id ? { id: id } : {}, { orderNo: '1', code: 'NV-R16', status: 'Прибыла', shippedAt: '2026-08-01', arrivedAt: '2026-08-25',
      weightKg: 100, ratePerKgUsd: 1, cargoRate: 7,
      lines: [{ marking: 'M1', boxes: 1, pcsPerBox: 10, qty: 10, priceCny: 100, article: 'ART-POST-1' }],
      costs: [{ type: 'Прочее', amountRub: 100, comment: 'разгрузка' }] });
  };
  const b = h.saveChinaBatch(pl(), 'Николай').batches[0];
  h.postChinaBatch({ id: b.id, opId: 'op-r16', lines: [{ article: 'ART-POST-1', qty: 10 }] }, 'Николай');
  const saved = h.saveChinaBatch(pl(b.id), 'Николай').batches.filter(function (x) { return x.id === b.id; })[0];
  return { id: b.id, saved: saved, frt: frt };
}
(function () {
  const h = withChina();
  const s = china100R016Scenario(h, 900);
  check('100.1 R-016: a posted batch with goods debt 900 ¥ in the report stays «предварительно», not closed, missing = «товар не оплачен полностью (900 ¥)»',
    s.saved.postingState === 'предварительно' && s.saved.closed === false
    && s.saved.missing.length === 1 && s.saved.missing[0] === 'товар не оплачен полностью (900 ¥)',
    JSON.stringify({ state: s.saved.postingState, closed: s.saved.closed, missing: s.saved.missing }));
  h.saveChinaPayment({ date: '2026-09-10', amountRub: 18000, rate: 20, comment: 'P2' }, 'Николай');
  h.saveChinaReport({ reportDate: '2026-09-10', source: 'скрипт',
    orders: [{ orderNo: '1', date: '2026-08-20', receivedCny: 1000, totalCny: 1000, unpaidCny: 0 }],
    receipts: [{ date: '2026-09-01', goodsCny: 100, freightCny: 70, freightUsd: 10 }, { date: '2026-09-10', goodsCny: 900 }], freights: [s.frt] }, 'Николай');
  const fin = h.getChinaBatches().batches.filter(function (x) { return x.id === s.id; })[0];
  const cap = h.stockOf('ART-POST-1').capitalization;
  check('100.1 R-016: after P2 (18000 ₽ at 20) and a zero-debt report the paid remainder reaches stock: capitalization 19800 and «окончательно»',
    cap === 19800 && fin.postingState === 'окончательно',
    JSON.stringify({ cap: cap, state: fin.postingState, total: fin.totalRub }));
})();
(function () {
  const h = withChina();
  const s = china100R016Scenario(h, 0);
  check('100.1 R-016 control: with report debt 0 there is no «товар не оплачен» message',
    !s.saved.missing.some(function (m) { return m.indexOf('товар не оплачен') !== -1; }),
    JSON.stringify(s.saved.missing));
})();
(function () {
  const h = withChina();
  const s = china100R016Scenario(h, 900);
  h.saveChinaReport({ reportDate: '2026-09-10', source: 'скрипт',
    orders: [{ orderNo: '2', date: '2026-09-05', receivedCny: 0, totalCny: 500, unpaidCny: 500 }],
    receipts: [{ date: '2026-09-01', goodsCny: 100, freightCny: 70, freightUsd: 10 }], freights: [s.frt] }, 'Николай');
  const after = h.getChinaBatches().batches.filter(function (x) { return x.id === s.id; })[0];
  check('100.1 R-016 control: an order absent from the newest report keeps the old behaviour (no «товар не оплачен» message)',
    !after.missing.some(function (m) { return m.indexOf('товар не оплачен') !== -1; }),
    JSON.stringify(after.missing));
})();

// ---- migration (decision 8): marks only current «Прибыла» batches, once, a later arrival stays untouched ----
(function () {
  const h = freshHarness();
  h.setChinaSpreadsheet();
  const headers = h.CHINA_BATCH_HEADERS;
  const row = headers.map(function (hd) {
    if (hd === 'ID') return 'CB-OLD-1';
    if (hd === 'Код партии') return 'OLD-1';
    if (hd === 'Статус') return 'Прибыла';
    return '';
  });
  h.setTargetSheet('Партии', [headers, row]);
  const picture = h.getChinaBatches();
  const migrated = picture.batches.filter(function (b) { return b.id === 'CB-OLD-1'; })[0];
  check('84: a batch already «Прибыла» at deployment is marked «уже на остатке»',
    migrated.postingState === 'уже на остатке', JSON.stringify(migrated.postingState));

  check('84: it is never touched again by a second read (runs once)',
    h.getChinaBatches().batches.filter(function (b) { return b.id === 'CB-OLD-1'; })[0].postingState === 'уже на остатке',
    'expected the mark to stay');

  h.setSkuSheet(['SKU', 'ШТ/КОР'], [['ART-POST-1', 10]]);
  h.setStockSheet([]);
  h.ensureTransSheet();
  const later = h.saveChinaBatch({
    orderNo: 'LATE', code: 'NV-LATE-1', status: 'В пути', shippedAt: '2026-09-01',
    lines: [{ marking: 'ML', boxes: 1, pcsPerBox: 1, qty: 1, priceCny: 1, article: 'ART-POST-1' }]
  }, 'Николай').batches.filter(function (b) { return b.code === 'NV-LATE-1'; })[0];
  const arrived = h.saveChinaBatch({
    id: later.id, orderNo: 'LATE', code: 'NV-LATE-1', status: 'Прибыла', shippedAt: '2026-09-01', arrivedAt: '2026-09-20',
    lines: [{ marking: 'ML', boxes: 1, pcsPerBox: 1, qty: 1, priceCny: 1, article: 'ART-POST-1' }]
  }, 'Николай').batches.filter(function (b) { return b.code === 'NV-LATE-1'; })[0];
  check('84: a batch arriving AFTER the migration ran is never marked «уже на остатке»',
    arrived.postingState === '', JSON.stringify(arrived.postingState));
  check('84: «уже на остатке» blocks cancellation — nothing to roll back through the app',
    china84Refuses(function () { h.cancelChinaBatchPosting({ id: migrated.id }, 'Николай'); }).threw,
    'expected a refusal');
})();

(function () {
  // Item 9: a posted batch keeps its articles/quantities fixed — only money fields are editable.
  const h = withChina();
  const batch = china84PostableFixture(h);
  h.postChinaBatch({ id: batch.id, opId: 'op-84-14', lines: [{ article: 'ART-POST-1', qty: 100 }] }, 'Николай');
  const refusal = china84Refuses(function () {
    h.saveChinaBatch({
      id: batch.id, orderNo: batch.orderNo, code: batch.code, status: batch.status,
      shippedAt: batch.shippedAt, arrivedAt: batch.arrivedAt,
      weightKg: batch.weightKg, ratePerKgUsd: batch.ratePerKgUsd, rubRate: batch.rubRate,
      lines: [{ marking: 'M1', boxes: 10, pcsPerBox: 10, qty: 55, priceCny: 10, article: 'ART-POST-1' }],
      costs: [{ type: 'Прочее', amountRub: 500, comment: 'разгрузка' }]
    }, 'Николай');
  }, 'нельзя');
  check('84: editing the quantity of a posted batch\'s line is refused',
    refusal.threw, refusal.msg);
})();

// ================= Item 84 follow-up: China-posting-owned rows are locked to cancelChinaBatchPosting =========
//
// Money-critical (a bypass would silently drift the batch's own bookkeeping away from the
// stock) — whole path through the top-level actions, ≈6 checks, 3 mutations.
(function () {
  const h = withChina();
  const batch = china84PostableFixture(h);
  h.postChinaBatch({ id: batch.id, opId: 'op-84f-1', lines: [{ article: 'ART-POST-1', qty: 100 }] }, 'Николай');
  const txnId = h.dumpTransSheet().filter(function (r) { return String(r['Объект'] || '').indexOf('NV-POST-1') !== -1; })[0].ID;

  check('84 follow-up: plain deleteTransaction on a China-posting-owned row is refused, names the batch code',
    china84Refuses(function () { h.deleteTransaction(txnId, 'Николай'); }, 'NV-POST-1').threw
    && china84Refuses(function () { h.deleteTransaction(txnId, 'Николай'); }, 'NV-POST-1').msg.indexOf('Заказов в Китае') !== -1,
    china84Refuses(function () { h.deleteTransaction(txnId, 'Николай'); }).msg);

  check('84 follow-up: updateTransaction (edit) on the same row is refused the same way',
    china84Refuses(function () {
      h.updateTransaction(txnId, { type: 'Приход', article: 'ART-POST-1', quantity: 100, price: 1, destination: 'Склад [где угодно]', date: '2026-01-05T00:00:00.000Z' }, 'Николай');
    }, 'Отмените оприходование').threw, 'expected a refusal');

  check('84 follow-up: an ordinary (non-China) row is unaffected — deleteTransaction still works',
    (function () {
      h.commitTransaction([{ article: 'ART-PLAIN', quantity: 5, price: 10 }], 'Приход', 'Склад [обычный]', '', 'Николай');
      const plainId = h.dumpTransSheet().filter(function (r) { return r['Артикул'] === 'ART-PLAIN'; })[0].ID;
      h.deleteTransaction(plainId, 'Николай');
      return h.dumpTransSheet().filter(function (r) { return r['Артикул'] === 'ART-PLAIN'; }).length === 0;
    })(), 'plain row should delete cleanly');

  // Bulk delete: one China-owned row mixed with an ordinary one — the WHOLE batch is refused,
  // nothing deleted (same all-or-nothing spirit as cancelChinaBatchPosting itself).
  h.commitTransaction([{ article: 'ART-PLAIN-2', quantity: 3, price: 10 }], 'Приход', 'Склад [обычный 2]', '', 'Николай');
  const plainId2 = h.dumpTransSheet().filter(function (r) { return r['Артикул'] === 'ART-PLAIN-2'; })[0].ID;
  const rowsBeforeBulk = h.dumpTransSheet().length;
  check('84 follow-up: deleteMultipleTransactions refuses the WHOLE batch when one row is China-owned',
    china84Refuses(function () { h.deleteMultipleTransactions([txnId, plainId2], 'Николай'); }, 'Заказов в Китае').threw
    && h.dumpTransSheet().length === rowsBeforeBulk,
    'rows before/after: ' + rowsBeforeBulk + '/' + h.dumpTransSheet().length);

  // Restore from «Удалённые»: cancelChinaBatchPosting is the ONLY caller allowed to actually
  // delete/archive the row — a restore of that archived copy must still be refused.
  h.cancelChinaBatchPosting({ id: batch.id }, 'Николай');
  const archived = h.dumpArchive().filter(function (a) { return a.type === 'Transaction' && a.data.destination && a.data.destination.indexOf('NV-POST-1') !== -1; })[0];
  check('84 follow-up: restoring the archived China-owned row is refused',
    china84Refuses(function () { h.restoreArchivedItem(archived.archiveId, 'Николай'); }, 'Заказов в Китае').threw,
    'expected a refusal');

  check('84 follow-up: cancelChinaBatchPosting itself is unaffected — regression check',
    h.stockOf('ART-POST-1').quantity === 0 && h.stockOf('ART-POST-1').capitalization === 0,
    JSON.stringify(h.stockOf('ART-POST-1')));
})();

// ================= Item 86 step A: auto-poll moved to 11:00/20:00 МСК =================
// setupOzonSyncTriggers is not runnable on the stand (ScriptApp is not stubbed), so this is a
// source check like «78a: getTurnoverData обслуживается…» above — it reads the function body
// literally rather than executing it.
(function test86Triggers() {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'Code.gs'), 'utf8');
  const fnMatch = src.match(/function setupOzonSyncTriggers\(\) \{[\s\S]*?\n\}/);
  const fnBody = fnMatch ? fnMatch[0] : '';
  check('86: setupOzonSyncTriggers создаёт триггер в 11:00', /\.atHour\(11\)/.test(fnBody), fnBody);
  check('86: setupOzonSyncTriggers создаёт триггер в 20:00', /\.atHour\(20\)/.test(fnBody), fnBody);
  check('86: старые часы 5 и 17 нигде не остались в этой функции', !/\.atHour\(5\)/.test(fnBody) && !/\.atHour\(17\)/.test(fnBody), fnBody);
  check('86: оба триггера — Europe/Moscow', (fnBody.match(/inTimezone\('Europe\/Moscow'\)/g) || []).length === 2, fnBody);
})();

// ================= Item 86 step A: getOzonStockHistory =================
(function test86StockHistory() {
  // 1. Пустой лист -> [].
  const h1 = freshHarness();
  const Hh = h1.OZON_STOCK_HISTORY_HEADERS;
  h1.resetHistorySheet();
  const empty = h1.getOzonStockHistory();
  check('86: getOzonStockHistory на пустом листе возвращает []', Array.isArray(empty) && empty.length === 0, JSON.stringify(empty));

  // 2. Дата-ячейки (Неделя, Последний учтённый день, Обновлено) и строковые ячейки в одном листе.
  const h2 = freshHarness();
  function makeRow(vals) {
    const row = new Array(Hh.length).fill('');
    Object.keys(vals).forEach(k => { row[Hh.indexOf(k)] = vals[k]; });
    return row;
  }
  const dateRow = makeRow({
    'Неделя': new h2.context.Date('2026-01-05T00:00:00Z'),
    'Кабинет': 'Cab1',
    'Артикул': 'ART1',
    'КластерID': 'CL1',
    'Кластер': 'Центр',
    'Дней в наличии': 5,
    'Дней наблюдений': 7,
    'Последний учтённый день': new h2.context.Date('2026-01-11T00:00:00Z'),
    'Обновлено': new h2.context.Date('2026-01-11T10:00:00Z')
  });
  const stringRow = makeRow({
    'Неделя': '2025-12-29',
    'Кабинет': 'Cab2',
    'Артикул': 'ART2',
    'КластерID': 'CL2',
    'Кластер': 'Юг',
    'Дней в наличии': 3,
    'Дней наблюдений': 4,
    'Последний учтённый день': '2026-01-01',
    'Обновлено': '2026-01-01 09:00:00'
  });
  h2.setHistoryRaw([dateRow, stringRow]);
  const rows = h2.getOzonStockHistory();
  const r1 = rows.find(r => r.offerId === 'ART1');
  const r2 = rows.find(r => r.offerId === 'ART2');

  check('86: строка с Date-ячейками — «Неделя» приведена к yyyy-MM-dd (МСК)', r1 && r1.week === '2026-01-05', JSON.stringify(r1));
  check('86: строка с Date-ячейками — «Последний учтённый день» приведён к yyyy-MM-dd', r1 && r1.lastDay === '2026-01-11', JSON.stringify(r1));
  check('86: строка с Date-ячейками — остальные поля на месте', r1 && r1.cabinet === 'Cab1' && r1.clusterId === 'CL1'
    && r1.clusterName === 'Центр' && r1.daysInStock === 5 && r1.daysObserved === 7, JSON.stringify(r1));
  check('86: строка со строковыми ячейками читается без изменений', r2 && r2.week === '2025-12-29' && r2.lastDay === '2026-01-01'
    && r2.cabinet === 'Cab2' && r2.clusterId === 'CL2' && r2.daysInStock === 3 && r2.daysObserved === 4, JSON.stringify(r2));

  // 3. Отсутствует обязательная колонка -- ошибка в стиле соседних чтений (getOzonSales/getOzonStocks).
  const h3 = freshHarness();
  const shortHeaders = Hh.filter(x => x !== 'КластерID');
  const shortDataRow = shortHeaders.map(() => '');
  shortDataRow[shortHeaders.indexOf('Артикул')] = 'ARTX'; // непустая строка -- иначе getLastRow() сочтёт лист пустым
  h3.getHistorySheet().__setData([shortHeaders, shortDataRow]);
  let missingColErr = '';
  try { h3.getOzonStockHistory(); } catch (e) { missingColErr = String(e.message || e); }
  check('86: отсутствующая колонка -- понятная ошибка (без падения стенда)',
    /Некоторые обязательные колонки не найдены в листе "История остатков Ozon"/.test(missingColErr), missingColErr);

  // 4. Перемешанный порядок колонок -- чтение по имени заголовка, а не по позиции.
  const h4 = freshHarness();
  const shuffled = Hh.slice().reverse();
  const shuffledRow = new Array(shuffled.length).fill('');
  shuffledRow[shuffled.indexOf('Артикул')] = 'ART3';
  shuffledRow[shuffled.indexOf('Кабинет')] = 'Cab3';
  shuffledRow[shuffled.indexOf('Неделя')] = '2026-01-05';
  shuffledRow[shuffled.indexOf('КластерID')] = 'CL3';
  shuffledRow[shuffled.indexOf('Кластер')] = 'Восток';
  shuffledRow[shuffled.indexOf('Дней в наличии')] = 6;
  shuffledRow[shuffled.indexOf('Дней наблюдений')] = 6;
  shuffledRow[shuffled.indexOf('Последний учтённый день')] = '2026-01-05';
  shuffledRow[shuffled.indexOf('Обновлено')] = '2026-01-05 09:00:00';
  h4.getHistorySheet().__setData([shuffled, shuffledRow]);
  const shuffledRows = h4.getOzonStockHistory();
  const r3 = shuffledRows.find(r => r.offerId === 'ART3');
  check('86: перемешанный порядок колонок читается корректно по имени заголовка',
    r3 && r3.cabinet === 'Cab3' && r3.clusterId === 'CL3' && r3.clusterName === 'Восток' && r3.daysInStock === 6,
    JSON.stringify(r3));
})();

// ================= Item 86 step A: routing (getOzonInitialData, LOCK_FREE_ACTIONS, switch) =================
(function test86Routing() {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'Code.gs'), 'utf8');
  check('86: getOzonInitialData отдаёт stockHistory', /stockHistory: getOzonStockHistory\(\)/.test(src));
  check('86: getOzonStockHistory — в списке действий без замка (быстрый путь getOzonStocks/getOzonSales)',
    /action === 'getOzonStocks'[\s\S]{0,300}action === 'getOzonStockHistory'/.test(src));
  check('86: getOzonStockHistory — в LOCK_FREE_ACTIONS', /'getOzonSyncStatus',\s*\/\/[^\n]*\n\s*'getOzonStockHistory',/.test(src));
  check('86: getOzonStockHistory — есть ветка в switch', /case 'getOzonStockHistory': result = getOzonStockHistory\(\); break;/.test(src));
})();

// ================= Item 86 step C: deliveryToOzonDays settings plumbing =================
(function test86StepCSettings() {
  // 1. Отсутствующая настройка — дефолт 7, и дефолт дописывается в лист (как любая другая).
  const h = freshHarness();
  h.clearOzonSettingsSheet();
  const settings1 = h.getOzonSettings();
  check('86C: deliveryToOzonDays отсутствует в листе -> дефолт 7', settings1.deliveryToOzonDays === 7, String(settings1.deliveryToOzonDays));
  const sheetRows1 = h.dumpRegistrySheet('Настройки Ozon');
  const hasRow = sheetRows1.some(r => String(r[0]) === 'deliveryToOzonDays' && Number(r[1]) === 7);
  check('86C: дефолт дописан строкой в лист «Настройки Ozon»', hasRow, JSON.stringify(sheetRows1));

  // 2. saveOzonSettings: '0' сохраняется как 0 (выключено планирование срока доставки).
  const h2 = freshHarness();
  h2.clearOzonSettingsSheet();
  h2.getOzonSettings(); // создаёт лист с дефолтами
  h2.saveOzonSettings({ deliveryToOzonDays: '0' });
  const settings2 = h2.getOzonSettings();
  check('86C: saveOzonSettings(\'0\') -> 0', settings2.deliveryToOzonDays === 0, String(settings2.deliveryToOzonDays));

  // 3. saveOzonSettings: мусорная строка -> отказ (item 87: больше не подменяется дефолтом
  // молча), значение в листе не тронуто.
  const h3 = freshHarness();
  h3.clearOzonSettingsSheet();
  h3.getOzonSettings();
  let threw3 = false;
  try { h3.saveOzonSettings({ deliveryToOzonDays: 'abc' }); } catch (e) { threw3 = true; }
  check('87: saveOzonSettings(\'abc\') -> отказ', threw3);
  const settings3 = h3.getOzonSettings();
  check('87: отказ на \'abc\' не тронул значение в листе (осталось 7)', settings3.deliveryToOzonDays === 7, String(settings3.deliveryToOzonDays));

  // 4. saveOzonSettings: отрицательное значение -> отказ (item 87), значение в листе не тронуто.
  const h4 = freshHarness();
  h4.clearOzonSettingsSheet();
  h4.getOzonSettings();
  let threw4 = false;
  try { h4.saveOzonSettings({ deliveryToOzonDays: -3 }); } catch (e) { threw4 = true; }
  check('87: saveOzonSettings(-3) -> отказ', threw4);
  const settings4 = h4.getOzonSettings();
  check('87: отказ на -3 не тронул значение в листе (осталось 7)', settings4.deliveryToOzonDays === 7, String(settings4.deliveryToOzonDays));

  // 5. saveOzonSettings: обычное положительное значение сохраняется как есть.
  const h5 = freshHarness();
  h5.clearOzonSettingsSheet();
  h5.getOzonSettings();
  h5.saveOzonSettings({ deliveryToOzonDays: 10 });
  const settings5 = h5.getOzonSettings();
  check('86C: saveOzonSettings(10) -> 10', settings5.deliveryToOzonDays === 10, String(settings5.deliveryToOzonDays));

  // 6. Прямая запись отрицательного значения в лист (не через сохранение) -> getOzonSettings
  // подменяет его дефолтом, а не отдаёт наверх отрицательный срок доставки.
  const h6 = freshHarness();
  h6.clearOzonSettingsSheet();
  h6.getOzonSettings(); // создаёт лист с полным набором дефолтов
  const rows6 = h6.dumpRegistrySheet('Настройки Ozon');
  const rowIdx = rows6.findIndex(r => String(r[0]) === 'deliveryToOzonDays');
  const sheet6 = h6.getRegistrySheet('Настройки Ozon');
  const raw6 = sheet6.__dump();
  raw6[rowIdx][1] = -5;
  sheet6.__setData(raw6);
  const settings6 = h6.getOzonSettings();
  check('86C: отрицательное значение в листе читается как дефолт 7', settings6.deliveryToOzonDays === 7, String(settings6.deliveryToOzonDays));
})();

// ================= Item 87 step 1: settings validation rules and change journal =================
(function test87Step1() {
  // A fresh stand with the sheet already holding the full set of OZON_SETTINGS_DEFAULTS.
  function freshWithDefaults() {
    const h = freshHarness();
    h.clearOzonSettingsSheet();
    h.getOzonSettings();
    return h;
  }
  function expectThrow(h, payload, name) {
    let threw = false;
    try { h.saveOzonSettings(payload, 'tester'); } catch (e) { threw = true; }
    check(name, threw);
  }
  function expectPass(h, payload, name) {
    let threw = false;
    try { h.saveOzonSettings(payload, 'tester'); } catch (e) { threw = true; }
    check(name, !threw);
  }

  // ---- Boundary checks, two sides of every rule ----
  expectPass(freshWithDefaults(), { speedWeeks: 1 }, '87: speedWeeks=1 (граница) -> ок');
  expectThrow(freshWithDefaults(), { speedWeeks: 0 }, '87: speedWeeks=0 -> отказ');

  expectPass(freshWithDefaults(), { speedWeeks: 2, trendWeeks: 2 }, '87: trendWeeks = speedWeeks -> ок');
  expectThrow(freshWithDefaults(), { speedWeeks: 2, trendWeeks: 1 }, '87: trendWeeks < speedWeeks -> отказ');

  expectPass(freshWithDefaults(), { minStockDays: 10, targetStockDays: 10 }, '87: targetStockDays = minStockDays -> ок');
  expectThrow(freshWithDefaults(), { minStockDays: 10, targetStockDays: 9 }, '87: targetStockDays < minStockDays -> отказ');

  expectPass(freshWithDefaults(), { targetStockDays: 30, maxClusterDays: 0 }, '87: maxClusterDays=0 (выключен) -> ок');
  expectPass(freshWithDefaults(), { targetStockDays: 30, maxClusterDays: 30 }, '87: maxClusterDays = targetStockDays -> ок');
  expectThrow(freshWithDefaults(), { targetStockDays: 30, maxClusterDays: 29 }, '87: maxClusterDays < targetStockDays (и не 0) -> отказ');

  expectPass(freshWithDefaults(), { deliveryToOzonDays: 0 }, '87: deliveryToOzonDays=0 (граница) -> ок');
  expectPass(freshWithDefaults(), { deliveryToOzonDays: 60 }, '87: deliveryToOzonDays=60 (граница) -> ок');
  expectThrow(freshWithDefaults(), { deliveryToOzonDays: -1 }, '87: deliveryToOzonDays=-1 -> отказ');
  expectThrow(freshWithDefaults(), { deliveryToOzonDays: 61 }, '87: deliveryToOzonDays=61 -> отказ');
  expectThrow(freshWithDefaults(), { deliveryToOzonDays: 'abc' }, '87: deliveryToOzonDays=\'abc\' -> отказ');
  expectThrow(freshWithDefaults(), { deliveryToOzonDays: '' }, '87: deliveryToOzonDays=\'\' -> отказ');

  expectPass(freshWithDefaults(), { salesRetentionWeeks: 27 }, '87: salesRetentionWeeks=27 (граница) -> ок');
  expectThrow(freshWithDefaults(), { salesRetentionWeeks: 26 }, '87: salesRetentionWeeks=26 -> отказ');

  expectPass(freshWithDefaults(), { returnsToSalePct: 0 }, '87: returnsToSalePct=0 (граница) -> ок');
  expectPass(freshWithDefaults(), { returnsToSalePct: 100 }, '87: returnsToSalePct=100 (граница) -> ок');
  expectThrow(freshWithDefaults(), { returnsToSalePct: -1 }, '87: returnsToSalePct=-1 -> отказ');
  expectThrow(freshWithDefaults(), { returnsToSalePct: 101 }, '87: returnsToSalePct=101 -> отказ');

  expectThrow(freshWithDefaults(), { turnoverSlowDays: 20, turnoverFastDays: 20 }, '87: turnoverSlowDays = turnoverFastDays -> отказ');
  expectPass(freshWithDefaults(), { turnoverSlowDays: 21, turnoverFastDays: 20 }, '87: turnoverSlowDays = turnoverFastDays+1 -> ок');

  expectThrow(freshWithDefaults(), { gmroiGreenPct: 30, gmroiRedPct: 30 }, '87: gmroiGreenPct = gmroiRedPct -> отказ');
  expectPass(freshWithDefaults(), { gmroiGreenPct: 31, gmroiRedPct: 30 }, '87: gmroiGreenPct = gmroiRedPct+1 -> ок');

  expectPass(freshWithDefaults(), { maxBoxesPerCluster: 1 }, '87: maxBoxesPerCluster=1 (граница) -> ок');
  expectThrow(freshWithDefaults(), { maxBoxesPerCluster: 0 }, '87: maxBoxesPerCluster=0 -> отказ');
  expectThrow(freshWithDefaults(), { maxBoxesPerCluster: 1.5 }, '87: maxBoxesPerCluster=1.5 -> отказ');

  // ---- Cross-field against the SHEET, not just the payload ----
  (function crossFieldAgainstSheet() {
    const h = freshWithDefaults();
    h.saveOzonSettings({ speedWeeks: 2 }, 'tester'); // sheet now holds speedWeeks=2
    expectThrow(h, { trendWeeks: 1 }, '87: только trendWeeks=1 при speedWeeks=2 в листе -> отказ');
    expectPass(h, { speedWeeks: 1, trendWeeks: 1 }, '87: speedWeeks=1 и trendWeeks=1 вместе -> ок');
  })();

  // ---- A refused save leaves the sheet AND the journal untouched ----
  (function refusedSaveUntouched() {
    const h = freshWithDefaults();
    const before = h.dumpRegistrySheet('Настройки Ozon');
    let threw = false;
    try { h.saveOzonSettings({ trendWeeks: 1, speedWeeks: 4 }, 'tester'); } catch (e) { threw = true; } // trend(1) < speed(4)
    check('87: отказ на кросс-правило действительно бросает', threw);
    const after = h.dumpRegistrySheet('Настройки Ozon');
    check('87: отказ не изменил ни одну строку листа', JSON.stringify(before) === JSON.stringify(after));
    const journal = h.getOzonSettingsJournal();
    check('87: отказ не записал ни одной строки в журнал', journal.length === 0, String(journal.length));
  })();

  // ---- Journal: only changed keys, numeric vs string-numeric is not a change, who/field ----
  (function journalContents() {
    const h = freshWithDefaults();
    // targetStockDays sent as the STRING '30' while the sheet already holds 30 — not a change.
    // trendWeeks sent as 20, different from the default 13 — a real change.
    h.saveOzonSettings({ targetStockDays: '30', trendWeeks: 20 }, 'nikolay');
    const journal1 = h.getOzonSettingsJournal();
    check('87: журнал: неизменённый ключ (\'30\' vs 30) не записан', !journal1.some(r => r.key === 'targetStockDays'), JSON.stringify(journal1));
    check('87: журнал: изменённый ключ записан ровно один раз', journal1.filter(r => r.key === 'trendWeeks').length === 1, JSON.stringify(journal1));
    const row = journal1.find(r => r.key === 'trendWeeks');
    check('87: журнал: who = переданный пользователь', row && row.who === 'nikolay', row && row.who);
    check('87: журнал: поле — человеческое имя из карты', row && row.field === h.OZON_SETTINGS_FIELD_NAMES.trendWeeks, row && row.field);
    check('87: журнал: было = прежнее значение', row && String(row.was) === '13', row && row.was);
    check('87: журнал: стало = новое значение', row && String(row.became) === '20', row && row.became);

    // Second save — rows must come after the first, in order.
    h.saveOzonSettings({ trendWeeks: 21 }, 'nikolay');
    const journal2 = h.getOzonSettingsJournal();
    const trendRows = journal2.filter(r => r.key === 'trendWeeks');
    check('87: журнал: два сохранения -> две строки по ключу trendWeeks', trendRows.length === 2, String(trendRows.length));

    // Appended key: remove a row from the sheet, then save it — 'Было' must be ''.
    const sheet = h.getRegistrySheet('Настройки Ozon');
    const raw = sheet.__dump();
    const rowIdx = raw.findIndex(r => String(r[0]) === 'salesGrowthPct');
    raw.splice(rowIdx, 1);
    sheet.__setData(raw);
    h.saveOzonSettings({ salesGrowthPct: 5 }, 'nikolay');
    const journal3 = h.getOzonSettingsJournal();
    const appendedRow = journal3.find(r => r.key === 'salesGrowthPct');
    check('87: журнал: дописанный ключ -> Было = \'\'', appendedRow && appendedRow.was === '', appendedRow && JSON.stringify(appendedRow));
  })();

  // ---- getOzonSettingsJournal: newest first, limit, default, missing/empty sheet ----
  (function journalReading() {
    const hEmpty = freshWithDefaults();
    check('87: getOzonSettingsJournal на пустой лист -> []', Array.isArray(hEmpty.getOzonSettingsJournal()) && hEmpty.getOzonSettingsJournal().length === 0);

    const hMissing = freshHarness();
    hMissing.clearOzonSettingsSheet();
    check('87: getOzonSettingsJournal без листа -> []', Array.isArray(hMissing.getOzonSettingsJournal()) && hMissing.getOzonSettingsJournal().length === 0);

    const h = freshWithDefaults();
    h.saveOzonSettings({ speedWeeks: 2 }, 'u1');
    h.saveOzonSettings({ speedWeeks: 3 }, 'u2');
    h.saveOzonSettings({ speedWeeks: 4 }, 'u3');
    const journal = h.getOzonSettingsJournal();
    check('87: журнал: новые сверху', journal[0].who === 'u3' && journal[journal.length - 1].who === 'u1', JSON.stringify(journal.map(r => r.who)));
    const limited = h.getOzonSettingsJournal(2);
    check('87: журнал: лимит соблюдён', limited.length === 2, String(limited.length));
    check('87: журнал: лимит вернул самые свежие', limited[0].who === 'u3' && limited[1].who === 'u2', JSON.stringify(limited.map(r => r.who)));
    const overLimit = h.getOzonSettingsJournal(500);
    check('87: журнал: лимит не выше 200 (тут просто все 3 строки, лимита не хватает)', overLimit.length === 3, String(overLimit.length));
  })();

  // ---- The live value set and the defaults both pass validateOzonSettingsRules ----
  const liveValues = {
    speedWeeks: 2, trendWeeks: 8, minStockDays: 10, targetStockDays: 20,
    maxClusterDays: 60, deliveryToOzonDays: 7, salesRetentionWeeks: 78,
    returnsToSalePct: 95, turnoverSlowDays: 60, turnoverFastDays: 20,
    gmroiGreenPct: 80, gmroiRedPct: 30, maxBoxesPerCluster: 30
  };
  const hRules = freshHarness();
  check('87: боевые значения (maxClusterDays=60) проходят validateOzonSettingsRules',
    hRules.validateOzonSettingsRules(liveValues).length === 0, JSON.stringify(hRules.validateOzonSettingsRules(liveValues)));
  check('87: боевые значения (maxClusterDays=100) проходят validateOzonSettingsRules',
    hRules.validateOzonSettingsRules(Object.assign({}, liveValues, { maxClusterDays: 100 })).length === 0);

  const hDefaults = freshWithDefaults();
  const defaults = hDefaults.getOzonSettings();
  check('87: дефолты OZON_SETTINGS_DEFAULTS проходят validateOzonSettingsRules',
    hDefaults.validateOzonSettingsRules(defaults).length === 0, JSON.stringify(hDefaults.validateOzonSettingsRules(defaults)));

  // ---- assertAdmin: role matrix (saveOzonSettings/getOzonSettingsJournal are router-guarded
  // with assertAdmin(currentUser) — the harness has no doPost, so the role logic itself is
  // exercised directly and the wiring is confirmed by the router-source checks below). ----
  const hRole = freshHarness();
  let threwUser = false;
  try { hRole.assertAdmin({ username: 'someone', role: 'user' }); } catch (e) { threwUser = true; }
  check('87: assertAdmin отказывает роли \'user\'', threwUser);

  let threwEmptyRole = false;
  try { hRole.assertAdmin({ username: 'someone', role: '' }); } catch (e) { threwEmptyRole = true; }
  check('87: assertAdmin отказывает пустой роли', threwEmptyRole);

  let threwAdminUsername = false;
  try { hRole.assertAdmin({ username: 'admin', role: 'user' }); } catch (e) { threwAdminUsername = true; }
  check('87: assertAdmin смотрит на role, а не на username (\'admin\' с role \'user\' -> отказ)', threwAdminUsername);

  let threwAdminRole = false;
  try { hRole.assertAdmin({ username: 'someone', role: 'admin' }); } catch (e) { threwAdminRole = true; }
  check('87: assertAdmin принимает role \'admin\'', !threwAdminRole);

  let threwRuRole = false;
  try { hRole.assertAdmin({ username: 'someone', role: 'Администратор' }); } catch (e) { threwRuRole = true; }
  check('87: assertAdmin принимает role \'Администратор\'', !threwRuRole);

  // ---- Router wiring: both actions admin-guarded (same convention as test86Routing above) ----
  const routerSrc = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'Code.gs'), 'utf8');
  check('87: router — saveOzonSettings под assertAdmin и передаёт currentUser.username',
    /case 'saveOzonSettings': assertAdmin\(currentUser\); result = saveOzonSettings\(data, currentUser\.username\); break;/.test(routerSrc));
  check('87: router — getOzonSettingsJournal под assertAdmin',
    /case 'getOzonSettingsJournal': assertAdmin\(currentUser\); result = getOzonSettingsJournal\(data && data\.limit\); break;/.test(routerSrc));
})();

// ================= Item 90, ticket 01: operation comment =================
// The comment lives in its own «Комментарий» column of «История», never in «Объект», never as money.
(function testItem90Comment() {
  const D = '2026-01-05T09:00:00Z';
  const commentsOf = (h) => h.dumpTransSheet().map(r => String(r['Комментарий'] === undefined ? '' : r['Комментарий']));

  // --- commit: every row incl. kit components; without comment the cell is empty; column appended last ---
  const h1 = freshHarness();
  h1.ensureTransSheet();
  h1.setKitSheet([{ kitSku: 'KIT90', componentSku: 'COMP90', quantity: 2, kitType: 'virtual' }]);
  h1.setStockSheet([{ article: 'COMP90', quantity: 20, avgCost: 5, capitalization: 100 },
                    { article: 'ART90', quantity: 50, avgCost: 10, capitalization: 500 }]);
  h1.commitTransaction([{ article: 'KIT90', quantity: 3, price: 0 }, { article: 'ART90', quantity: 2, price: 10 }],
    'Расход', 'Склад', '', 'tester', D, '', undefined, undefined, '  для Иванова  ');
  const rows1 = h1.dumpTransSheet();
  check('Item 90: every row of the operation (incl. kit component rows) carries the comment, trimmed',
    rows1.length >= 3 && rows1.every(r => r['Комментарий'] === 'для Иванова'), JSON.stringify(rows1.map(r => r['Комментарий'])));
  // Ticket 02 appends «Отгрузка» after it, so «Комментарий» is the second-to-last header.
  const hdr1 = h1.ensureTransSheet().__dump()[0].map(x => String(x).trim());
  check('Item 90: the comment column is appended at the end of a sheet that lacked it (before «Отгрузка»)',
    hdr1[hdr1.length - 2] === 'Комментарий' && hdr1[hdr1.length - 1] === 'Отгрузка', JSON.stringify(hdr1.slice(-2)));
  check('Item 90: the kit component row no longer shows the old auto text',
    rows1.every(r => String(r['Комментарий']).indexOf('Авто') === -1));

  const h2 = freshHarness();
  h2.ensureTransSheet();
  h2.setStockSheet([{ article: 'ART90', quantity: 50, avgCost: 10, capitalization: 500 }]);
  h2.commitTransaction([{ article: 'ART90', quantity: 2, price: 10 }], 'Расход', 'Склад', '', 'tester', D, '');
  check('Item 90: commit without a comment leaves the cell empty',
    commentsOf(h2).length === 1 && commentsOf(h2)[0] === '', JSON.stringify(commentsOf(h2)));

  // --- money-adjacent: «500₽» in the comment changes nothing ---
  const mk = (comment) => {
    const h = freshHarness();
    h.ensureTransSheet();
    h.setStockSheet([{ article: 'ART90', quantity: 50, avgCost: 10, capitalization: 500 }]);
    h.commitTransaction([{ article: 'ART90', quantity: 5, price: 10 }], 'Расход', 'Ozon (Shop)', '', 'tester', D, '', undefined, undefined, comment);
    return h.dumpTransSheet()[0];
  };
  const plain = mk(undefined), noted = mk('доплатил 500₽');
  check('Item 90: comment «доплатил 500₽» changes no «ДопРасходы», «Цена» or «Сумма»',
    String(noted['ДопРасходы']) === String(plain['ДопРасходы']) && noted['Цена'] === plain['Цена'] && noted['Сумма'] === plain['Сумма'],
    JSON.stringify({ noted, plain }));
  check('Item 90: the comment text never lands in «Объект»',
    noted['Объект'] === plain['Объект'] && String(noted['Объект']).indexOf('500') === -1 && noted['Комментарий'] === 'доплатил 500₽');

  // --- China posting ---
  const hc = withChina();
  const batch = china84PostableFixture(hc);
  hc.postChinaBatch({ id: batch.id, opId: 'op-90-1', comment: ' приход с накладной ', lines: [{ article: 'ART-POST-1', qty: 100 }] }, 'Николай');
  const chinaRows = hc.dumpTransSheet().filter(r => String(r['Объект'] || '').indexOf('NV-POST-1') !== -1);
  check('Item 90: postChinaBatch writes the comment to its receipt row',
    chinaRows.length === 1 && chinaRows[0]['Комментарий'] === 'приход с накладной', JSON.stringify(chinaRows));

  // --- edit: keep / replace / comment-only edit leaves money alone ---
  const h3 = freshHarness();
  h3.ensureTransSheet();
  h3.ensureArchiveSheet();
  h3.setStockSheet([{ article: 'ART90', quantity: 50, avgCost: 10, capitalization: 500 }]);
  h3.commitTransaction([{ article: 'ART90', quantity: 5, price: 10 }], 'Расход', 'Склад', '', 'tester', D, '', undefined, undefined, 'первый');
  const id3 = h3.getTransactions().rows[0].id;
  const edit = (id, extra) => h3.updateTransaction(id, Object.assign({ article: 'ART90', quantity: 5, price: 10, type: 'Расход', destination: 'Склад', date: D }, extra), 'tester');
  edit(id3, {});
  let row3 = h3.dumpTransSheet()[0];
  check('Item 90: an edit without a comment field keeps the stored comment', row3['Комментарий'] === 'первый', row3['Комментарий']);
  const before = { q: row3['Количество'], p: row3['Цена'], t: row3['Сумма'] };
  edit(h3.getTransactions().rows[0].id, { comment: 'второй' });
  row3 = h3.dumpTransSheet()[0];
  check('Item 90: an edit with a new comment replaces it; quantity/price/total unchanged',
    row3['Комментарий'] === 'второй' && row3['Количество'] === before.q && row3['Цена'] === before.p && row3['Сумма'] === before.t, JSON.stringify(row3));
  edit(h3.getTransactions().rows[0].id, { comment: '' });
  check('Item 90: an edit with an empty comment clears it', String(h3.dumpTransSheet()[0]['Комментарий']) === '');

  // --- delete -> «Удаленное» -> restore keeps the comment ---
  edit(h3.getTransactions().rows[0].id, { comment: 'сохрани' });
  h3.deleteTransaction(h3.getTransactions().rows[0].id, 'tester');
  const arch = h3.dumpArchive();
  check('Item 90: the archive payload carries the comment', arch.length > 0 && arch[arch.length - 1].data.comment === 'сохрани', JSON.stringify(arch.map(a => a.data.comment)));
  h3.restoreArchivedItem(arch[arch.length - 1].archiveId, 'tester');
  check('Item 90: restoreArchivedItem puts the comment back in «Комментарий»',
    h3.dumpTransSheet().length === 1 && h3.dumpTransSheet()[0]['Комментарий'] === 'сохрани', JSON.stringify(h3.dumpTransSheet()));

  // --- bulk delete -> bulk restore ---
  const idBulk = h3.getTransactions().rows[0].id;
  h3.deleteMultipleTransactions([idBulk], 'tester');
  const archBulk = h3.dumpArchive();
  check('Item 90: the bulk-delete archive payload carries the comment',
    archBulk[archBulk.length - 1].data.comment === 'сохрани', JSON.stringify(archBulk.map(a => a.data.comment)));
  h3.restoreMultipleArchivedItems([archBulk[archBulk.length - 1].archiveId], 'tester');
  check('Item 90: restoreMultipleArchivedItems puts the comment back by header',
    h3.dumpTransSheet().length === 1 && h3.dumpTransSheet()[0]['Комментарий'] === 'сохрани'
    && h3.dumpTransSheet()[0]['Артикул'] === 'ART90', JSON.stringify(h3.dumpTransSheet()));

  // --- old rows: no column / empty cell read as '' ---
  const hOld = freshHarness();
  hOld.ensureTransSheet();
  hOld.setStockSheet([{ article: 'ART90', quantity: 50, avgCost: 10, capitalization: 500 }]);
  hOld.commitTransaction([{ article: 'ART90', quantity: 1, price: 10 }], 'Расход', 'Склад', '', 'tester', D, '');
  check('Item 90: a row without a comment parses with comment \'\'',
    hOld.getTransactions().rows.length === 1 && hOld.getTransactions().rows[0].comment === '', JSON.stringify(hOld.getTransactions().rows));
  const hOld2 = freshHarness();
  hOld2.ensureTransSheet().__setData([hOld2.TRANS_HEADERS.slice(), ['ID-OLD', D, 'Приход', 'ART90', 5, 10, 0, 50, 'Склад', '', 'tester']]);
  check('Item 90: a legacy sheet with no «Комментарий» column parses old rows with comment \'\'',
    hOld2.getTransactions().rows.length === 1 && hOld2.getTransactions().rows[0].comment === '', JSON.stringify(hOld2.getTransactions().rows));

  // --- setTransactionComment: a note on ANY operation, nothing else touched ---
  const cellsOf = (h) => JSON.stringify(h.dumpTransSheet().map(r => Object.assign({}, r, { 'Комментарий': '' })));
  const { h: hOldR, id: idOldR } = withReceipt(300, 100);
  hOldR.setNow('2026-09-10T09:00:00Z'); // the receipt is 40 days old: outside the edit window
  const beforeOld = cellsOf(hOldR);
  const stockBeforeOld = JSON.stringify(hOldR.dumpStockSheet());
  hOldR.setTransactionComment({ id: idOldR, comment: '  поставщик X  ' }, 'tester');
  check('Item 90: setTransactionComment writes the trimmed cell',
    hOldR.dumpTransSheet()[0]['Комментарий'] === 'поставщик X', JSON.stringify(hOldR.dumpTransSheet()));
  check('Item 90: on a 40-day-old receipt every other cell (ID, OpID, qty, price, total) and the stock are byte-identical',
    cellsOf(hOldR) === beforeOld && JSON.stringify(hOldR.dumpStockSheet()) === stockBeforeOld && hOldR.getTransactions().rows[0].id === idOldR);

  const hCn = freshHarness();
  hCn.ensureTransSheet();
  hCn.setStockSheet([{ article: 'ART90', quantity: 0, avgCost: 0, capitalization: 0 }]);
  hCn.commitTransaction([{ article: 'ART90', quantity: 10, price: 5 }], 'Приход', 'Склад [Китай: партия NV-90]', '', 'tester', D, 'op-cn');
  const idCn = hCn.getTransactions().rows[0].id;
  let cnRefused = '';
  try { hCn.deleteTransaction(idCn, 'tester'); } catch (e) { cnRefused = String(e.message || e); }
  const beforeCn = cellsOf(hCn);
  hCn.setTransactionComment({ id: idCn, comment: 'китайская партия' }, 'tester');
  check('Item 90: a China-owned row (guarded against delete) still takes a note, nothing else changes',
    cnRefused.indexOf('NV-90') !== -1 && hCn.dumpTransSheet()[0]['Комментарий'] === 'китайская партия' && cellsOf(hCn) === beforeCn,
    cnRefused + ' | ' + JSON.stringify(hCn.dumpTransSheet()));

  const hKit = freshHarness();
  hKit.ensureTransSheet();
  hKit.setKitSheet([{ kitSku: 'KIT90', componentSku: 'COMP90', quantity: 2, kitType: 'virtual' }]);
  hKit.setStockSheet([{ article: 'COMP90', quantity: 20, avgCost: 5, capitalization: 100 }]);
  hKit.commitTransaction([{ article: 'KIT90', quantity: 3, price: 0 }], 'Расход', 'Склад', '', 'tester', D, '', undefined, undefined, 'старый');
  const mainKit = hKit.getTransactions().rows.find(r => r.groupId && !r.isComponent);
  hKit.setTransactionComment({ id: mainKit.id, comment: 'новый' }, 'tester');
  const kitRows = hKit.dumpTransSheet();
  check('Item 90: a note on a kit main row reaches the component rows too',
    kitRows.length >= 2 && kitRows.every(r => r['Комментарий'] === 'новый'), JSON.stringify(kitRows.map(r => r['Комментарий'])));

  const beforeUnknown = JSON.stringify(hKit.dumpTransSheet());
  let unknownMsg = '';
  try { hKit.setTransactionComment({ id: 'NO-SUCH-ID', comment: 'x' }, 'tester'); } catch (e) { unknownMsg = String(e.message || e); }
  check('Item 90: an unknown id throws «Операция не найдена» and writes nothing',
    unknownMsg === 'Операция не найдена' && JSON.stringify(hKit.dumpTransSheet()) === beforeUnknown, unknownMsg);
})();

// ================= Item 90, ticket 02: combined-shipment number =================
// «Отгрузка» holds one browser-generated number shared by every order of a combined write-off.
(function testItem90ShipmentNumber() {
  const D = '2026-01-05T09:00:00Z';
  const shipOf = (h) => h.dumpTransSheet().map(r => String(r['Отгрузка'] === undefined ? '' : r['Отгрузка']));
  const lastHeader = (h) => { const d = h.ensureTransSheet().__dump()[0]; return String(d[d.length - 1]).trim(); };

  // --- two orders of one combined shipment, one with a kit: every row carries the number ---
  const h1 = freshHarness();
  h1.ensureTransSheet();
  h1.setKitSheet([{ kitSku: 'KIT90', componentSku: 'COMP90', quantity: 2, kitType: 'virtual' }]);
  h1.setStockSheet([{ article: 'COMP90', quantity: 20, avgCost: 5, capitalization: 100 },
                    { article: 'ART90', quantity: 50, avgCost: 10, capitalization: 500 }]);
  h1.commitTransaction([{ article: 'KIT90', quantity: 3, price: 0 }], 'Расход', 'Ozon (Shop) [Общая поставка: заявки № 1, № 2]', '', 'tester', D, 'OP-S-1', 100, undefined, '', ' OP-S ');
  h1.commitTransaction([{ article: 'ART90', quantity: 2, price: 10 }], 'Расход', 'Ozon (Shop) [Общая поставка: заявки № 1, № 2]', '', 'tester', D, 'OP-S-2', 50, undefined, '', 'OP-S');
  const s1 = shipOf(h1);
  check('Item 90/02: every row of every order of a combined shipment (incl. kit component rows) carries the trimmed number',
    s1.length === 3 && s1.every(v => v === 'OP-S'), JSON.stringify(s1));
  check('Item 90/02: «Отгрузка» is appended as the LAST header, after «Комментарий»',
    lastHeader(h1) === 'Отгрузка', lastHeader(h1));
  check('Item 90/02: the read model exposes shipmentId',
    h1.getTransactions().rows.every(r => r.shipmentId === 'OP-S'), JSON.stringify(h1.getTransactions().rows.map(r => r.shipmentId)));

  // --- single order / receipt: empty ---
  const h2 = freshHarness();
  h2.ensureTransSheet();
  h2.setStockSheet([{ article: 'ART90', quantity: 50, avgCost: 10, capitalization: 500 }]);
  h2.commitTransaction([{ article: 'ART90', quantity: 2, price: 10 }], 'Расход', 'Ozon (Shop)', '', 'tester', D, 'OP-1');
  h2.commitTransaction([{ article: 'ART90', quantity: 4, price: 10 }], 'Приход', 'Склад', '', 'tester', D, 'OP-2', undefined, undefined, 'заметка');
  check('Item 90/02: a commit without a number leaves «Отгрузка» empty and shipmentId \'\'',
    shipOf(h2).length === 2 && shipOf(h2).every(v => v === '') && h2.getTransactions().rows.every(r => r.shipmentId === ''),
    JSON.stringify(shipOf(h2)));

  // --- money: the number changes no cell but «Отгрузка» ---
  const mk = (sid) => {
    const h = freshHarness();
    h.ensureTransSheet();
    h.setStockSheet([{ article: 'ART90', quantity: 50, avgCost: 10, capitalization: 500 }]);
    h.commitTransaction([{ article: 'ART90', quantity: 5, price: 10 }], 'Расход', 'Ozon (Shop)', '', 'tester', D, 'OP-M', 30, undefined, '', sid);
    const r = Object.assign({}, h.dumpTransSheet()[0]);
    delete r['ID']; delete r['Отгрузка'];
    return JSON.stringify(r) + JSON.stringify(h.dumpStockSheet());
  };
  check('Item 90/02: with or without a number every other cell and the stock are identical', mk('OP-M') === mk(undefined));

  // --- row edit keeps the number (and cannot set a different one) ---
  const h3 = freshHarness();
  h3.ensureTransSheet();
  h3.ensureArchiveSheet();
  h3.setStockSheet([{ article: 'ART90', quantity: 50, avgCost: 10, capitalization: 500 }]);
  h3.commitTransaction([{ article: 'ART90', quantity: 5, price: 10 }], 'Расход', 'Склад', '', 'tester', D, 'OP-E', undefined, undefined, '', 'OP-E');
  h3.updateTransaction(h3.getTransactions().rows[0].id,
    { article: 'ART90', quantity: 4, price: 10, type: 'Расход', destination: 'Склад', date: D, comment: 'правка', shipmentId: 'CHANGED' }, 'tester');
  const e3 = h3.dumpTransSheet();
  check('Item 90/02: a row edit (delete + rewrite) keeps the stored number',
    e3.length === 1 && e3[0]['Отгрузка'] === 'OP-E' && e3[0]['Количество'] === 4 && e3[0]['Комментарий'] === 'правка', JSON.stringify(e3));

  // --- delete -> restore, single and bulk ---
  h3.deleteTransaction(h3.getTransactions().rows[0].id, 'tester');
  const arch = h3.dumpArchive();
  check('Item 90/02: the archive payload carries the number', arch[arch.length - 1].data.shipmentId === 'OP-E', JSON.stringify(arch.map(a => a.data.shipmentId)));
  h3.restoreArchivedItem(arch[arch.length - 1].archiveId, 'tester');
  check('Item 90/02: restoreArchivedItem puts the number back in «Отгрузка» (comment too)',
    h3.dumpTransSheet().length === 1 && h3.dumpTransSheet()[0]['Отгрузка'] === 'OP-E' && h3.dumpTransSheet()[0]['Комментарий'] === 'правка',
    JSON.stringify(h3.dumpTransSheet()));
  h3.deleteMultipleTransactions([h3.getTransactions().rows[0].id], 'tester');
  const archBulk = h3.dumpArchive();
  check('Item 90/02: the bulk-delete archive payload carries the number',
    archBulk[archBulk.length - 1].data.shipmentId === 'OP-E', JSON.stringify(archBulk.map(a => a.data.shipmentId)));
  h3.restoreMultipleArchivedItems([archBulk[archBulk.length - 1].archiveId], 'tester');
  const r3 = h3.dumpTransSheet();
  check('Item 90/02: restoreMultipleArchivedItems puts number and comment back by header',
    r3.length === 1 && r3[0]['Отгрузка'] === 'OP-E' && r3[0]['Комментарий'] === 'правка' && r3[0]['Артикул'] === 'ART90', JSON.stringify(r3));

  // --- old rows: a sheet of 21.09/24.09 style combined rows without the column reads as before ---
  const hOld = freshHarness();
  hOld.ensureTransSheet().__setData([hOld.TRANS_HEADERS.slice(),
    ['ID-OLD-1', D, 'Расход', 'ART90', 5, 10, 50, 60, 'Ozon (Shop) [Общая поставка: заявки № 129272007-1, № 129270949-1]', '', 'tester'],
    ['ID-OLD-2', D, 'Расход', 'ART90', 3, 10, 30, 36, 'Ozon (Shop) [Общая поставка: заявки № 129272007-1, № 129270949-1]', '', 'tester']]);
  const oldRows = hOld.getTransactions().rows;
  check('Item 90/02: old combined rows without «Отгрузка» parse with shipmentId \'\' and unchanged money',
    oldRows.length === 2 && oldRows.every(r => r.shipmentId === '')
    && oldRows.find(r => r.id === 'ID-OLD-1').total === 60 && oldRows.find(r => r.id === 'ID-OLD-2').total === 36, JSON.stringify(oldRows));

  // --- doPost routes the number ---
  const codeSrc = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'Code.gs'), 'utf8');
  check('Item 90/02: doPost commit passes payload.shipmentId as the 11th argument',
    /commitTransaction\(data, payload\.type, payload\.destination, payload\.deliveryDate, currentUser\.username, null, payload\.opId, payload\.additionalCosts, undefined, payload\.comment, payload\.shipmentId\)/.test(codeSrc));
})();

// ================= Item 93, ticket 02: the cost journal follows a pencil edit, a deletion and a restore =================
//
// The journal «Себестоимость Озон» is read as chains of links (one shipment = one link, however many
// rows it owns), see buildOzonCostChain in Code.gs. Fixture, MaxiStore / ART-C — every figure was
// computed with a node snippet using the production roundToTwo, never by hand:
//   blend(base, prior, qty, cost) = round2((base * prior + qty * cost) / (base + qty))
//   seed 2026-08-01                                                       100.00
//   L1 2026-09-01 op-A  base 100, 100 pcs @200  blend(100, 100, 100, 200) = 150.00
//   L2 2026-09-05 op-B  base 200, 200 pcs @300  blend(200, 150, 200, 300) = 225.00
//   L3 2026-09-10 op-C  base 400, 100 pcs @125  blend(400, 225, 100, 125) = 205.00
// Bystanders that must stay byte for byte: ART-X / MaxiStore (seed 50, one link 50.91) and
// ART-C / Mercurius (seed 70, one link 85.00). «История» holds the matching rows with the OpIDs,
// written by the real commitTransaction; the journal is then replaced by the exact fixture rows.
// A pencil edit takes the price the form sends; the stock average (300) is set so it is known.

const T93_DEST = 'Ozon (MaxiStore)';
const T93_STAMP = '2026-09-02 10:00:00 admin';
const T93_SEED_SOURCE = 'остаток и себестоимость на 01.08.2026';

function t93Fixture(opts) {
  opts = opts || {};
  const h = freshHarness();
  h.ensureTransSheet();
  h.ensureArchiveSheet();
  const stock = () => h.setStockSheet([
    { article: 'ART-C', quantity: 1000, avgCost: 300, capitalization: 300000 },
    { article: 'ART-X', quantity: 1000, avgCost: 50, capitalization: 50000 },
    { article: 'ART-D', quantity: 100, avgCost: 400, capitalization: 40000 }
  ]);
  stock();
  h.setOzonCostSheet([]);
  h.setOzonStocksSheet([]);
  const ship = (article, qty, price, dest, delivery, opId, madeOn, extras, shipmentId) =>
    h.commitTransaction([{ article, quantity: qty, price }], 'Расход', dest, delivery, 'tester', madeOn + 'T10:00:00.000Z',
      opId, extras, undefined, '', shipmentId);
  const dayA = opts.sameDay ? '2026-09-05' : '2026-09-01';
  ship('ART-C', 100, 200, T93_DEST, dayA, 'op-A', '2026-08-31');
  if (opts.extrasOnB) ship('ART-C', 200, 295, T93_DEST, '2026-09-05', 'op-B', '2026-09-03', 1000, 'ship-B');
  else ship('ART-C', 200, 300, T93_DEST, '2026-09-05', 'op-B', '2026-09-03', undefined, 'ship-B');
  if (!opts.noTail) ship('ART-C', 100, 125, T93_DEST, '2026-09-10', 'op-C', '2026-09-08');
  ship('ART-X', 10, 60, T93_DEST, '2026-09-02', 'op-X', '2026-09-01');
  ship('ART-C', 30, 100, 'Ozon (Mercurius)', '2026-09-05', 'op-M', '2026-09-03');
  stock();

  const link = (date, cab, art, after, opId, base, before, qty, cost, extra) =>
    costRow(date, cab, art, after, opId, Object.assign({ sku: 'S-' + art, stockBefore: base, costBefore: before, shipped: qty, shippedCost: cost, source: 'отгрузка' }, extra || {}));
  const rows = [
    costRow('2026-08-01', 'MaxiStore', 'ART-C', 100, 'НАЧАЛЬНАЯ ТОЧКА', { sku: 'S-ART-C', source: T93_SEED_SOURCE, exported: T93_STAMP }),
    // opts.drift: the recorded figure of L1 is a couple of kopecks off its blend (150.02 instead of 150.00), as live chains are
    link(dayA, 'MaxiStore', 'ART-C', opts.drift ? 150.02 : 150, 'op-A', 100, 100, 100, 200, { exported: T93_STAMP }),
    link('2026-09-05', 'MaxiStore', 'ART-C', 225, 'op-B', 200, 150, 200, 300)
  ];
  if (!opts.noTail) rows.push(link('2026-09-10', 'MaxiStore', 'ART-C', 205, 'op-C', 400, 225, 100, 125));
  if (opts.legacy) {
    // Corrections an older receipt edit wrote (price of op-B 300 -> 320): blend(200, 150, 200, 320) = 235.00,
    // blend(400, 235, 100, 125) = 213.00. The state is the LAST row (213.00).
    rows.push(link('2026-09-05', 'MaxiStore', 'ART-C', 235, 'op-B', 200, 150, 200, 320, { source: 'пересчёт после правки прихода' }));
    rows.push(link('2026-09-10', 'MaxiStore', 'ART-C', 213, 'op-C', 400, 235, 100, 125, { source: 'пересчёт после правки прихода' }));
  }
  rows.push(
    costRow('2026-08-01', 'MaxiStore', 'ART-X', 50, 'НАЧАЛЬНАЯ ТОЧКА', { sku: 'S-ART-X', source: T93_SEED_SOURCE, exported: T93_STAMP }),
    link('2026-09-02', 'MaxiStore', 'ART-X', 50.91, 'op-X', 100, 50, 10, 60, { exported: T93_STAMP }),
    costRow('2026-08-01', 'Mercurius', 'ART-C', 70, 'НАЧАЛЬНАЯ ТОЧКА', { sku: 'S-M', source: T93_SEED_SOURCE, exported: T93_STAMP }),
    link('2026-09-05', 'Mercurius', 'ART-C', 85, 'op-M', 30, 70, 30, 100)
  );
  h.setOzonCostSheet(rows);
  return h;
}

const t93Chain = h => h.dumpOzonCost().filter(r => r['Кабинет'] === 'MaxiStore' && r['Артикул'] === 'ART-C');
const t93Day = r => String(r['Дата']).slice(0, 10);
const t93Shape = rows => JSON.stringify(rows.map(r => [t93Day(r), r['OpID'], r['Себестоимость после'], r['Источник']]));
const t93Bystanders = h => JSON.stringify(h.dumpOzonCost().filter(r => !(r['Кабинет'] === 'MaxiStore' && r['Артикул'] === 'ART-C')));
const t93Frozen = h => JSON.stringify([h.dumpTransSheet(), h.dumpStockSheet(), h.dumpOzonCost(), h.dumpArchive()]);
const t93State = (h, cab, art) => (h.getOzonCostState()[(cab || 'MaxiStore') + '|' + (art || 'ART-C')] || {}).cost;
// The last row of every day of ART-C / MaxiStore — what the sender reads.
const t93PerDay = h => { const m = {}; t93Chain(h).forEach(r => { m[t93Day(r)] = r; }); return m; };
const t93Row = (h, opId, article) => h.getTransactions().rows.find(t => t.opId === opId && t.article === (article || 'ART-C') && t.type === 'Расход');
const t93Edit = (h, opId, over, article) => {
  const row = t93Row(h, opId, article);
  return h.updateTransaction(row.id, Object.assign({
    article: row.article, quantity: row.quantity, price: row.price, type: 'Расход',
    destination: row.destination, deliveryDate: row.deliveryDate, date: row.date
  }, over), 'tester');
};
const T93_EDIT = 'пересчёт после правки отгрузки';
const T93_DEL = 'пересчёт после удаления отгрузки';
const T93_RES = 'пересчёт после восстановления отгрузки';
const T93_RECEIPT = 'пересчёт после правки прихода';
const T93_MARK = 'удалено из цепочки';

(function test93PureCore() {
  const h = freshHarness();
  check('93/02: a row whose source is «удалено из цепочки» is a drop marker, no other source is',
    h.isOzonCostDropRow({ source: T93_MARK }) && !h.isOzonCostDropRow({ source: 'отгрузка' })
      && !h.isOzonCostDropRow({ source: T93_EDIT }) && !h.isOzonCostDropRow({ source: '' }) && !h.isOzonCostDropRow({}));

  // The fixture rows as the journal reader returns them.
  const read = (rows) => { h.setOzonCostSheet(rows); return h.getOzonCostJournal(); };
  const seed = costRow('2026-08-01', 'MaxiStore', 'A', 100, 'НАЧАЛЬНАЯ ТОЧКА', { source: T93_SEED_SOURCE });
  const one = (date, after, opId, base, before, qty, cost, source) =>
    costRow(date, 'MaxiStore', 'A', after, opId, { stockBefore: base, costBefore: before, shipped: qty, shippedCost: cost, source: source || 'отгрузка' });

  // blend(100, 100, 100, 200) = 150.00 ; blend(200, 150, 200, 300) = 225.00
  // A reader that throws on a valid chain must fail the check below, not crash the whole stand run.
  let chainError = '';
  let chain = { links: [], entries: [] };
  try {
    chain = h.buildOzonCostChain(read([seed, one('2026-09-01', 150, 'o1', 100, 100, 100, 200), one('2026-09-05', 225, 'o2', 200, 150, 200, 300),
      one('2026-09-05', 235, 'o2', 200, 150, 200, 320, T93_RECEIPT)]));
  } catch (e) { chainError = String(e.message || e); }
  check('93/02: a corrected shipment is ONE link however many rows it owns, in the order of its first appearance',
    chain.links.length === 2 && chain.links[1].key === 'op:o2' && chain.links[1].rows.length === 2 && chain.entries.length === 3,
    chainError || JSON.stringify(chain.links.map(l => [l.key, l.rows.length])));

  const throws = (rows) => { try { h.buildOzonCostChain(read(rows)); return ''; } catch (e) { return String(e.message || e); } };
  check('93/02: two originals under one OpID make the chain unreadable',
    throws([seed, one('2026-09-01', 150, 'o1', 100, 100, 100, 200), one('2026-09-02', 160, 'o1', 100, 100, 100, 200)]).indexOf('две отгрузки') !== -1);
  check('93/02: a correction that belongs to no shipment makes the chain unreadable',
    throws([seed, one('2026-09-01', 150, 'o1', 100, 100, 100, 200), one('2026-09-05', 235, 'o9', 200, 150, 200, 320, T93_RECEIPT)]).indexOf('не относится ни к одной отгрузке') !== -1);
  check('93/02: an OpID-less correction that fits two OpID-less originals is refused, not guessed',
    throws([seed, one('2026-09-01', 150, '', 100, 100, 100, 200), one('2026-09-01', 160, '', 100, 100, 100, 210),
      one('2026-09-01', 170, '', 100, 100, 100, 220, T93_RECEIPT)]).indexOf('нельзя отнести к одной отгрузке') !== -1);
  const mixed = h.buildOzonCostChain(read([seed, one('2026-09-01', 150, '', 100, 100, 100, 200), one('2026-09-01', 160, '', 100, 100, 100, 200, T93_RECEIPT)]));
  check('93/02: an OpID-less correction joins the single OpID-less original with the same day and base',
    mixed.links.length === 1 && mixed.links[0].key === 'row:3' && mixed.links[0].rows.length === 2, JSON.stringify(mixed.links.map(l => l.key)));
})();

// ---- Scenario 1: hole 4 — legacy corrections must not make a supply count twice ----
(function test93Hole4() {
  const h = t93Fixture({ legacy: true });
  const bys = t93Bystanders(h);
  const before = h.dumpOzonCost().length;
  check('93/02 s1: before the second receipt edit the state is the last legacy correction (213.00)', t93State(h) === 213, String(t93State(h)));
  // Second receipt edit: the price of op-B 320 -> 340. blend(200, 150, 200, 340) = 245.00 ; blend(400, 245, 100, 125) = 221.00.
  const res = h.reissueOzonCostRows([{ id: 'x', opId: 'op-B', date: '2026-09-03T10:00:00.000Z', kanDay: '2026-09-05', operationDay: '2026-09-03',
    destination: T93_DEST, article: 'ART-C', quantity: 200, oldUnitCost: 320, newUnitCost: 340 }], 'tester');
  const added = h.dumpOzonCost().slice(before);
  check('93/02 s1: only the supply and the links after it are written — once each, not once per old row',
    res.appended === 2 && t93Shape(added) === JSON.stringify([['2026-09-05', 'op-B', 245, T93_RECEIPT], ['2026-09-10', 'op-C', 221, T93_RECEIPT]]),
    t93Shape(added));
  check('93/02 s1: the recorded base and the shipped pieces of the supply are kept, the unit cost is the new one',
    added[0]['Остаток до'] === 200 && added[0]['Себестоимость до'] === 150 && added[0]['Отгружено'] === 200 && added[0]['Себестоимость отгрузки'] === 340,
    JSON.stringify(added[0]));
  check('93/02 s1: the state is the last row and it is the tail (221.00); the bystanders are byte for byte',
    t93State(h) === 221 && t93Bystanders(h) === bys, String(t93State(h)));

  // The other half of hole 4: the tail's own value does not move (base 0 -> its cost is its unit cost),
  // yet the LAST row of the chain must be the tail. blend(100, 100, 100, 240) = 170.00 ; the tail stays 125.00.
  const t = freshHarness();
  t.setOzonCostSheet([
    costRow('2026-08-01', 'MaxiStore', 'ART-T', 100, 'НАЧАЛЬНАЯ ТОЧКА', { source: T93_SEED_SOURCE }),
    costRow('2026-09-01', 'MaxiStore', 'ART-T', 150, 'op-m1', { stockBefore: 100, costBefore: 100, shipped: 100, shippedCost: 200, source: 'отгрузка' }),
    costRow('2026-09-05', 'MaxiStore', 'ART-T', 125, 'op-m2', { stockBefore: 0, costBefore: 150, shipped: 50, shippedCost: 125, source: 'отгрузка' })
  ]);
  const beforeT = t.dumpOzonCost().length;
  t.reissueOzonCostRows([{ id: 'y', opId: 'op-m1', date: '2026-08-31T10:00:00.000Z', kanDay: '2026-09-01', operationDay: '2026-08-31',
    destination: T93_DEST, article: 'ART-T', quantity: 100, oldUnitCost: 200, newUnitCost: 240 }], 'tester');
  const addedT = t.dumpOzonCost().slice(beforeT);
  check('93/02 s1: when the tail does not move it is still written LAST, so the state is the tail',
    t93Shape(addedT) === JSON.stringify([['2026-09-01', 'op-m1', 170, T93_RECEIPT], ['2026-09-05', 'op-m2', 125, T93_RECEIPT]])
      && t93State(t, 'MaxiStore', 'ART-T') === 125, t93Shape(addedT));

  // An entry without an OpID (an old «История» row) is matched by day against alive OpID-less links ONLY.
  // blend(200, 150, 100, 330) = 210.00
  const n = freshHarness();
  n.setOzonCostSheet([
    costRow('2026-08-01', 'MaxiStore', 'ART-N', 100, 'НАЧАЛЬНАЯ ТОЧКА', { source: T93_SEED_SOURCE }),
    costRow('2026-09-05', 'MaxiStore', 'ART-N', 150, 'op-n1', { stockBefore: 100, costBefore: 100, shipped: 100, shippedCost: 200, source: 'отгрузка' }),
    costRow('2026-09-05', 'MaxiStore', 'ART-N', 200, '', { stockBefore: 200, costBefore: 150, shipped: 100, shippedCost: 300, source: 'отгрузка' })
  ]);
  const beforeN = n.dumpOzonCost().length;
  const nres = n.reissueOzonCostRows([{ id: 'z', opId: '', date: '2026-09-03T10:00:00.000Z', kanDay: '2026-09-05', operationDay: '2026-09-03',
    destination: T93_DEST, article: 'ART-N', quantity: 100, oldUnitCost: 300, newUnitCost: 330 }], 'tester');
  const addedN = n.dumpOzonCost().slice(beforeN);
  check('93/02 s1: an entry without an OpID corrects the OpID-less link of that day and leaves the OpID\'d link of the same day alone',
    nres.appended === 1 && t93Shape(addedN) === JSON.stringify([['2026-09-05', '', 210, T93_RECEIPT]]), t93Shape(addedN));
})();

// ---- Scenario 2: the same price again writes nothing ----
(function test93Unchanged() {
  const h = t93Fixture();
  const before = JSON.stringify(h.dumpOzonCost());
  const res = h.reissueOzonCostRows([{ id: 'x', opId: 'op-B', date: '2026-09-03T10:00:00.000Z', kanDay: '2026-09-05', operationDay: '2026-09-03',
    destination: T93_DEST, article: 'ART-C', quantity: 200, oldUnitCost: 300, newUnitCost: 300 }], 'tester');
  check('93/02 s2: a receipt edit that leaves the unit cost of a shipment as it is appends no rows',
    res.appended === 0 && JSON.stringify(h.dumpOzonCost()) === before, JSON.stringify(res));
})();

// ---- Scenario 3: a pencil edit of the quantity ----
(function test93EditQuantity() {
  const h = t93Fixture();
  const bys = t93Bystanders(h);
  const before = h.dumpOzonCost().length;
  // qty 200 -> 100 at 300: blend(200, 150, 100, 300) = 200.00 ; blend(400, 200, 100, 125) = 185.00
  const res = t93Edit(h, 'op-B', { quantity: 100 });
  const added = h.dumpOzonCost().slice(before);
  check('93/02 s3: a pencil edit of the quantity rewrites that supply (200.00) and the one after it (185.00) — no «отгрузка» row',
    t93Shape(added) === JSON.stringify([['2026-09-05', 'op-B', 200, T93_EDIT], ['2026-09-10', 'op-C', 185, T93_EDIT]]), t93Shape(added));
  check('93/02 s3: the corrected row carries the recorded base, the new pieces and the old unit cost',
    added[0]['Остаток до'] === 200 && added[0]['Себестоимость до'] === 150 && added[0]['Отгружено'] === 100 && added[0]['Себестоимость отгрузки'] === 300,
    JSON.stringify(added[0]));
  check('93/02 s3: the journal gained no row without an OpID, the edited «История» row kept its OpID',
    h.dumpOzonCost().every(r => r['OpID'] !== '') && t93Row(h, 'op-B').quantity === 100, JSON.stringify(h.dumpOzonCost().map(r => r['OpID'])));
  check('93/02 s3: the state is the tail (185.00); other articles and the other cabinet are byte for byte',
    t93State(h) === 185 && t93Bystanders(h) === bys && !res.costJournalError, String(t93State(h)));
})();

(function test93EditPrice() {
  // price 300 -> 350: blend(200, 150, 200, 350) = 250.00 ; blend(400, 250, 100, 125) = 225.00
  const h = t93Fixture();
  const bys = t93Bystanders(h);
  const before = h.dumpOzonCost().length;
  t93Edit(h, 'op-B', { price: 350 });
  const added = h.dumpOzonCost().slice(before);
  check('93/02 s3: a pencil edit of the price rewrites that supply (250.00) and the one after it (225.00) with the new unit cost',
    t93Shape(added) === JSON.stringify([['2026-09-05', 'op-B', 250, T93_EDIT], ['2026-09-10', 'op-C', 225, T93_EDIT]])
      && added[0]['Себестоимость отгрузки'] === 350 && added[0]['Отгружено'] === 200 && t93Bystanders(h) === bys, t93Shape(added));

  // A supply that carries additional costs: the edit rebuilds the row with its share of the whole shipment (item 80),
  // and the journal takes the price of the rebuilt row. qty 200 -> 100, the 1000 spread over 100 pieces: price 305.00.
  // blend(200, 150, 100, 305) = 201.67 ; blend(400, 201.67, 100, 125) = 186.34
  const x = t93Fixture({ extrasOnB: true });
  const beforeX = x.dumpOzonCost().length;
  t93Edit(x, 'op-B', { quantity: 100 });
  const addedX = x.dumpOzonCost().slice(beforeX);
  check('93/02 s3: an edit of a supply with additional costs writes the price of the rebuilt row (305.00), not the old one',
    t93Row(x, 'op-B').price === 305 && t93Shape(addedX) === JSON.stringify([['2026-09-05', 'op-B', 201.67, T93_EDIT], ['2026-09-10', 'op-C', 186.34, T93_EDIT]])
      && addedX[0]['Себестоимость отгрузки'] === 305, t93Shape(addedX));
})();

(function test93EditDrift() {
  // The chain keeps its recorded figures before the first change: L1 stays 150.02 and is not touched, L2 is blended on the RECORDED 150.02.
  // blend(200, 150.02, 100, 300) = 200.01 ; blend(400, 200.01, 100, 125) = 185.01
  const h = t93Fixture({ drift: true });
  const before = h.dumpOzonCost().length;
  t93Edit(h, 'op-B', { quantity: 100 });
  const added = h.dumpOzonCost().slice(before);
  check('93/02 s3: links before the edited one keep their recorded figures — a kopeck-level drift of L1 is not rewritten',
    t93Shape(added) === JSON.stringify([['2026-09-05', 'op-B', 200.01, T93_EDIT], ['2026-09-10', 'op-C', 185.01, T93_EDIT]]), t93Shape(added));
})();

// ---- Scenario 4: an edit that changes nothing ----
(function test93EditNothing() {
  const h = t93Fixture();
  const before = JSON.stringify(h.dumpOzonCost());
  const res = t93Edit(h, 'op-B', {});
  check('93/02 s4: a pencil edit with nothing changed appends nothing to the journal',
    JSON.stringify(h.dumpOzonCost()) === before && !res.costJournalError, JSON.stringify(h.dumpOzonCost()).length + ' vs ' + before.length);
})();

// ---- Scenario 5: the delivery date moves inside the neighbours ----
(function test93EditDate() {
  const h = t93Fixture();
  const bys = t93Bystanders(h);
  const before = h.dumpOzonCost().length;
  t93Edit(h, 'op-B', { deliveryDate: '2026-09-07' });
  const added = h.dumpOzonCost().slice(before);
  check('93/02 s5: a moved delivery date writes a marker for the old day, the supply on the new day, and ends with the tail',
    t93Shape(added) === JSON.stringify([['2026-09-05', 'op-B', '', T93_MARK], ['2026-09-07', 'op-B', 225, T93_EDIT], ['2026-09-10', 'op-C', 205, T93_EDIT]]),
    t93Shape(added));
  check('93/02 s5: the marker keeps the recorded base and carries no cost; «История» holds the new delivery date',
    added[0]['Остаток до'] === 200 && added[0]['Отгружено'] === 0 && added[0]['Себестоимость после'] === '' && t93Row(h, 'op-B').deliveryDate === '2026-09-07',
    JSON.stringify(added[0]));
  const exportRows = h.getOzonCostExport().rows.filter(r => r.cabinet === 'MaxiStore' && r.article === 'ART-C');
  check('93/02 s5: the file for KAN leaves the emptied day 09-05 out and carries the new day 09-07',
    !exportRows.some(r => String(r.date).slice(0, 10) === '2026-09-05') && exportRows.some(r => String(r.date).slice(0, 10) === '2026-09-07')
      && exportRows.every(r => r.source !== T93_MARK), JSON.stringify(exportRows.map(r => [r.date, r.cost])));
  check('93/02 s5: the state is 205.00 and the bystanders are byte for byte', t93State(h) === 205 && t93Bystanders(h) === bys);

  // Onto the day of the NEXT supply (the boundary is allowed): that supply must stay the last row of its day.
  const b = t93Fixture();
  const beforeB = b.dumpOzonCost().length;
  t93Edit(b, 'op-B', { deliveryDate: '2026-09-10' });
  const addedB = b.dumpOzonCost().slice(beforeB);
  check('93/02 s5: a supply moved onto the day of the next one — the next one is re-stated after it and stays the day\'s last row',
    t93Shape(addedB) === JSON.stringify([['2026-09-05', 'op-B', '', T93_MARK], ['2026-09-10', 'op-B', 225, T93_EDIT], ['2026-09-10', 'op-C', 205, T93_EDIT]])
      && t93PerDay(b)['2026-09-10']['OpID'] === 'op-C', t93Shape(addedB));

  // Two supplies on 09-05; the LATER one moves to 09-07. Its marker would be the last row of 09-05 and read as «the day is deleted»,
  // while the earlier supply (150.00, it does not change) is still there: it must be re-stated after the marker.
  const s = t93Fixture({ sameDay: true });
  const beforeS = s.dumpOzonCost().length;
  t93Edit(s, 'op-B', { deliveryDate: '2026-09-07' });
  const addedS = s.dumpOzonCost().slice(beforeS);
  // The sender reads a day by its LAST row in the file, so the last row of 09-05 must be the earlier supply.
  const sentDay = s.getOzonCostExport().rows.filter(r => r.cabinet === 'MaxiStore' && r.article === 'ART-C' && String(r.date).slice(0, 10) === '2026-09-05');
  check('93/02 s5: the later of two same-day supplies moved away — the earlier one is re-stated after the marker and the old day keeps 150.00',
    t93Shape(addedS) === JSON.stringify([['2026-09-05', 'op-B', '', T93_MARK], ['2026-09-05', 'op-A', 150, T93_EDIT], ['2026-09-07', 'op-B', 225, T93_EDIT], ['2026-09-10', 'op-C', 205, T93_EDIT]])
      && t93PerDay(s)['2026-09-05']['OpID'] === 'op-A' && sentDay.length > 0 && sentDay[sentDay.length - 1].opId === 'op-A'
      && sentDay[sentDay.length - 1].cost === 150, t93Shape(addedS));
})();

// ---- Scenario 6: a date outside the neighbours is refused before anything is written ----
(function test93EditDateRefused() {
  const h = t93Fixture();
  const frozen = t93Frozen(h);
  let late = '', early = '';
  try { t93Edit(h, 'op-B', { deliveryDate: '2026-09-12' }); } catch (e) { late = String(e.message || e); }
  try { t93Edit(h, 'op-B', { deliveryDate: '2026-08-30' }); } catch (e) { early = String(e.message || e); }
  check('93/02 s6: a delivery date after the next supply is refused, naming the allowed range',
    late.indexOf('от 01.09.2026 до 10.09.2026') !== -1 && late.indexOf('Ничего не записано') !== -1, late);
  check('93/02 s6: a delivery date before the previous supply is refused too', early.indexOf('от 01.09.2026 до 10.09.2026') !== -1, early);
  check('93/02 s6: after the refusals «История», «Остатки», the journal and the archive are byte for byte', t93Frozen(h) === frozen);
})();

// ---- Scenario 7: another cabinet / a write-off / a different operation are refused before any write ----
(function test93EditRefused() {
  const h = t93Fixture();
  h.commitTransaction([{ article: 'ART-X', quantity: 5, price: 60 }], 'Расход', 'Яндекс', '2026-09-03', 'tester', '2026-09-03T10:00:00.000Z', 'op-Y');
  const frozen = t93Frozen(h);
  const msgOf = (fn) => { try { fn(); return ''; } catch (e) { return String(e.message || e); } };
  const toCabinet = msgOf(() => t93Edit(h, 'op-B', { destination: 'Ozon (Mercurius)' }));
  const toWriteOff = msgOf(() => t93Edit(h, 'op-B', { destination: 'Склад [Списание - Брак]' }));
  const toReceipt = msgOf(() => t93Edit(h, 'op-B', { type: 'Приход', destination: 'Склад' }));
  const intoOzon = msgOf(() => t93Edit(h, 'op-Y', { destination: T93_DEST }, 'ART-X'));
  check('93/02 s7: another Ozon cabinet is refused with «удалите операцию и проведите её заново»', toCabinet.indexOf('удалите операцию и проведите её заново') !== -1, toCabinet);
  check('93/02 s7: Ozon -> «Списание», Ozon -> a receipt and a plain shipment -> Ozon are refused too',
    [toWriteOff, toReceipt, intoOzon].every(m => m.indexOf('удалите операцию и проведите её заново') !== -1), [toWriteOff, toReceipt, intoOzon].join(' | '));
  check('93/02 s7: nothing was written by any of the refused edits', t93Frozen(h) === frozen);
  // A plain edit of a non-Ozon shipment still works and leaves the journal alone.
  const journalBefore = JSON.stringify(h.dumpOzonCost());
  t93Edit(h, 'op-Y', { quantity: 4 }, 'ART-X');
  check('93/02 s7: editing a shipment that is not to Ozon works and does not touch the journal',
    t93Row(h, 'op-Y', 'ART-X').quantity === 4 && JSON.stringify(h.dumpOzonCost()) === journalBefore);
})();

// ---- Scenario 8: deleting a supply from the middle of the chain ----
(function test93DeleteMiddle() {
  const h = t93Fixture();
  const bys = t93Bystanders(h);
  const before = h.dumpOzonCost().length;
  const idB = t93Row(h, 'op-B').id;
  // blend(400, 150, 100, 125) = 145.00
  const res = h.deleteTransaction(idB, 'tester');
  const added = h.dumpOzonCost().slice(before);
  check('93/02 s8: deleting a supply writes a marker for its day and re-blends the chain after it (145.00)',
    t93Shape(added) === JSON.stringify([['2026-09-05', 'op-B', '', T93_MARK], ['2026-09-10', 'op-C', 145, T93_DEL]]), t93Shape(added));
  check('93/02 s8: the archive payload carries the OpID and the (empty) additional costs; the answer has no journal error',
    h.dumpArchive()[0].data.opId === 'op-B' && h.dumpArchive()[0].data.additionalCosts === '' && !res.costJournalError, JSON.stringify(h.dumpArchive()[0].data));
  const state = h.getOzonCostState()['MaxiStore|ART-C'];
  check('93/02 s8: the state is the tail (145.00); the bystanders are byte for byte', state.cost === 145 && t93Bystanders(h) === bys, JSON.stringify(state));

  const exp = h.getOzonCostExport();
  const mine = exp.rows.filter(r => r.cabinet === 'MaxiStore' && r.article === 'ART-C');
  check('93/02 s8: the file for KAN leaves the emptied day out (also the supply\'s own unsent row) and the marker, and keeps the new figure',
    !mine.some(r => String(r.date).slice(0, 10) === '2026-09-05') && mine.some(r => r.cost === 145), JSON.stringify(mine.map(r => [r.date, r.cost])));
  h.markOzonCostExported({ rows: exp.rows }, 'tester');
  const sheet = t93Chain(h);
  check('93/02 s8: stamping what was handed over leaves the marker and the emptied day unstamped',
    sheet.filter(r => t93Day(r) === '2026-09-05').every(r => String(r['Выгружено в КАН']).trim() === '')
      && sheet.filter(r => t93Day(r) === '2026-09-10').every(r => String(r['Выгружено в КАН']).trim() !== ''),
    JSON.stringify(sheet.map(r => [t93Day(r), r['Выгружено в КАН']])));
})();

// ---- Scenario 9: two supplies on the same day ----
(function test93SameDay() {
  // P op-A and Q op-B both on 2026-09-05, no tail: P blend(100, 100, 100, 200) = 150.00, Q blend(200, 150, 200, 300) = 225.00.
  const later = t93Fixture({ sameDay: true, noTail: true });
  const beforeL = later.dumpOzonCost().length;
  later.deleteTransaction(t93Row(later, 'op-B').id, 'tester');
  const addedL = later.dumpOzonCost().slice(beforeL);
  check('93/02 s9: deleting the LATER of two supplies of one day re-states the earlier one (150.00) — the day is not a delete',
    t93Shape(addedL) === JSON.stringify([['2026-09-05', 'op-B', '', T93_MARK], ['2026-09-05', 'op-A', 150, T93_DEL]])
      && t93PerDay(later)['2026-09-05']['OpID'] === 'op-A' && t93State(later) === 150, t93Shape(addedL));

  // Deleting the EARLIER one: Q is re-blended on the seed: blend(200, 100, 200, 300) = 200.00
  const earlier = t93Fixture({ sameDay: true, noTail: true });
  const beforeE = earlier.dumpOzonCost().length;
  earlier.deleteTransaction(t93Row(earlier, 'op-A').id, 'tester');
  const addedE = earlier.dumpOzonCost().slice(beforeE);
  check('93/02 s9: deleting the EARLIER of two supplies of one day re-blends the later one on the seed (200.00)',
    t93Shape(addedE) === JSON.stringify([['2026-09-05', 'op-A', '', T93_MARK], ['2026-09-05', 'op-B', 200, T93_DEL]])
      && t93PerDay(earlier)['2026-09-05']['OpID'] === 'op-B' && t93State(earlier) === 200, t93Shape(addedE));
})();

(function test93SameDayWithTail() {
  // The same pair on 2026-09-05 with the tail L3 after it: deleting the LATER one of the pair changes the tail (blend(400, 150, 100, 125) = 145.00),
  // and the earlier one — which does not change at all — must still be re-stated AFTER the marker, or the day would read as deleted.
  const h = t93Fixture({ sameDay: true });
  const before = h.dumpOzonCost().length;
  h.deleteTransaction(t93Row(h, 'op-B').id, 'tester');
  const added = h.dumpOzonCost().slice(before);
  check('93/02 s9: the earlier supply of a day whose later supply is deleted is re-stated after the marker, then the tail follows (145.00)',
    t93Shape(added) === JSON.stringify([['2026-09-05', 'op-B', '', T93_MARK], ['2026-09-05', 'op-A', 150, T93_DEL], ['2026-09-10', 'op-C', 145, T93_DEL]])
      && t93PerDay(h)['2026-09-05']['OpID'] === 'op-A' && t93State(h) === 145, t93Shape(added));
})();

// ---- Scenario 10: deleting the tail ----
(function test93DeleteTail() {
  const h = t93Fixture();
  const before = h.dumpOzonCost().length;
  h.deleteTransaction(t93Row(h, 'op-C').id, 'tester');
  const added = h.dumpOzonCost().slice(before);
  check('93/02 s10: deleting the tail writes its marker and re-states the new tail LAST (225.00), so the state is right',
    t93Shape(added) === JSON.stringify([['2026-09-10', 'op-C', '', T93_MARK], ['2026-09-05', 'op-B', 225, T93_DEL]]) && t93State(h) === 225,
    t93Shape(added));
})();

// ---- Scenario 11: the only supply of a chain ----
(function test93DeleteOnly() {
  const mk = (withSeed) => {
    const h = freshHarness();
    h.ensureTransSheet();
    h.ensureArchiveSheet();
    h.setStockSheet([{ article: 'ART-S', quantity: 100, avgCost: 80, capitalization: 8000 }]);
    h.setOzonStocksSheet([{ cabinet: 'MaxiStore', article: 'ART-S', available: 50 }]);
    h.setOzonCostSheet(withSeed ? [costRow('2026-08-01', 'MaxiStore', 'ART-S', 100, 'НАЧАЛЬНАЯ ТОЧКА', { sku: 'S-S', source: T93_SEED_SOURCE })] : []);
    return h;
  };
  const ship = (h, qty, price, opId) => h.commitTransaction([{ article: 'ART-S', quantity: qty, price }], 'Расход', T93_DEST, '2026-09-03', 'tester', '2026-09-02T10:00:00.000Z', opId);

  // No seed: the chain empties, the next supply is a first one.
  const a = mk(false);
  ship(a, 20, 80, 'op-S1');
  a.deleteTransaction(t93Row(a, 'op-S1', 'ART-S').id, 'tester');
  check('93/02 s11: the only supply of a chain without a seed deleted — a marker last, so the chain has no state',
    a.dumpOzonCost().length === 2 && a.dumpOzonCost()[1]['Источник'] === T93_MARK && a.getOzonCostState()['MaxiStore|ART-S'] === undefined,
    JSON.stringify(a.dumpOzonCost().map(r => r['Источник'])));
  ship(a, 10, 120, 'op-S2');
  const next = a.dumpOzonCost()[2];
  check('93/02 s11: the next supply of that article is a first one («первая отгрузка…») at its own cost',
    next['Источник'].indexOf('первая отгрузка') === 0 && next['Себестоимость после'] === 120 && next['OpID'] === 'op-S2', JSON.stringify(next));

  // With a seed: the seed is the cost in force again. blend(50, 100, 20, 80) = 94.29 ; blend(50, 100, 10, 120) = 103.33
  const b = mk(true);
  ship(b, 20, 80, 'op-S1');
  check('93/02 s11: with a seed the first supply blends with it (94.29)', t93State(b, 'MaxiStore', 'ART-S') === 94.29, String(t93State(b, 'MaxiStore', 'ART-S')));
  b.deleteTransaction(t93Row(b, 'op-S1', 'ART-S').id, 'tester');
  check('93/02 s11: the only supply deleted with a seed — the seed is re-stated last, the state is the seed (100.00)',
    t93State(b, 'MaxiStore', 'ART-S') === 100 && b.dumpOzonCost().length === 4 && b.dumpOzonCost()[3]['Источник'] === T93_SEED_SOURCE,
    JSON.stringify(b.dumpOzonCost().map(r => [r['Дата'], r['Источник'], r['Себестоимость после']])));
  ship(b, 10, 120, 'op-S2');
  check('93/02 s11: the next supply blends with the seed (103.33), not with nothing',
    t93State(b, 'MaxiStore', 'ART-S') === 103.33, String(t93State(b, 'MaxiStore', 'ART-S')));
})();

// ---- Scenario 12: delete, then restore from «Удаленное» ----
(function test93Restore() {
  const h = t93Fixture({ extrasOnB: true });
  const perDayBefore = JSON.stringify(Object.keys(t93PerDay(h)).map(d => [d, t93PerDay(h)[d]['Себестоимость после']]));
  const rowB = t93Row(h, 'op-B');
  check('93/02 s12: fixture check — op-B carries 1000 of additional costs and the price 300', rowB.additionalCosts === 1000 && rowB.price === 300, JSON.stringify(rowB));
  h.deleteTransaction(rowB.id, 'tester');
  const archive = h.dumpArchive()[0];
  check('93/02 s12: the archive payload keeps the OpID and the additional costs as a number',
    archive.data.opId === 'op-B' && archive.data.additionalCosts === 1000 && archive.data.shipmentId === 'ship-B', JSON.stringify(archive.data));
  const before = h.dumpOzonCost().length;
  const res = h.restoreArchivedItem(archive.archiveId, 'Николай');
  const added = h.dumpOzonCost().slice(before);
  check('93/02 s12: the restore revives the supply in its old place and re-blends after it — 225.00 and 205.00',
    t93Shape(added) === JSON.stringify([['2026-09-05', 'op-B', 225, T93_RES], ['2026-09-10', 'op-C', 205, T93_RES]]) && res.status === 'ok' && !res.costJournalError,
    t93Shape(added));
  const perDayAfter = JSON.stringify(Object.keys(t93PerDay(h)).map(d => [d, t93PerDay(h)[d]['Себестоимость после']]));
  check('93/02 s12: the chain is as before the deletion to the kopeck, day by day (150 / 225 / 205), and the state is 205.00',
    perDayAfter === perDayBefore && perDayAfter === JSON.stringify([['2026-08-01', 100], ['2026-09-01', 150], ['2026-09-05', 225], ['2026-09-10', 205]]) && t93State(h) === 205,
    perDayAfter);
  const restoredRaw = h.dumpTransSheet().find(r => r['ID'] === rowB.id);
  check('93/02 s12: the restored row has the OpID, the additional costs as a NUMBER, and the shipment number',
    restoredRaw && restoredRaw['OpID'] === 'op-B' && restoredRaw['ДопРасходы'] === 1000 && typeof restoredRaw['ДопРасходы'] === 'number' && restoredRaw['Отгрузка'] === 'ship-B',
    JSON.stringify(restoredRaw));
  const chain = h.buildOzonCostChain(h.getOzonCostJournal().filter(r => r.cabinet === 'MaxiStore' && r.article === 'ART-C'));
  check('93/02 s12: the restored supply is one alive link again (one chain, nothing OpID-less)',
    chain.byKey['op:op-B'].alive === true && chain.links.length === 3 && h.dumpOzonCost().every(r => r['OpID'] !== ''));
})();

// ---- Scenario 13: an archive row from before item 93 carries no OpID ----
(function test93RestoreOld() {
  const h = t93Fixture();
  h.archiveItem('Transaction', { id: 'old-1', date: '2026-09-03T10:00:00.000Z', type: 'Расход', article: 'ART-C', quantity: 5, price: 300,
    writeOffCost: 1500, total: 1500, destination: T93_DEST, deliveryDate: '2026-09-05', user: 'tester' }, 'admin');
  const archiveId = h.dumpArchive()[0].archiveId;
  const before = JSON.stringify(h.dumpOzonCost());
  const res = h.restoreArchivedItem(archiveId, 'Николай');
  const raw = h.dumpTransSheet().find(r => r['ID'] === 'old-1');
  check('93/02 s13: an old payload without an OpID restores as before, the journal is not touched',
    res.status === 'ok' && !!raw && !raw['OpID'] && JSON.stringify(h.dumpOzonCost()) === before);
  check('93/02 s13: and the answer says the row has no OpID', String(res.costJournalError || '').indexOf('Строка без номера операции (OpID)') === 0, String(res.costJournalError));

  // The same through the bulk restore.
  h.archiveItem('Transaction', { id: 'old-2', date: '2026-09-03T10:00:00.000Z', type: 'Расход', article: 'ART-C', quantity: 4, price: 300,
    writeOffCost: 1200, total: 1200, destination: T93_DEST, deliveryDate: '2026-09-05', user: 'tester' }, 'admin');
  const bulk = h.restoreMultipleArchivedItems([h.dumpArchive()[0].archiveId], 'Николай');
  check('93/02 s13: an old payload restored in bulk: the row is back, the journal is not touched, the answer says why',
    h.dumpTransSheet().some(r => r['ID'] === 'old-2') && JSON.stringify(h.dumpOzonCost()) === before
      && String(bulk.costJournalError || '').indexOf('Строка без номера операции (OpID)') === 0, String(bulk.costJournalError));
})();

// ---- Scenario 14: several shipments deleted and restored at once ----
(function test93Bulk() {
  const h = t93Fixture({ extrasOnB: true });
  const bys = t93Bystanders(h);
  const before = h.dumpOzonCost().length;
  const ids = [t93Row(h, 'op-A').id, t93Row(h, 'op-B').id];
  // L3 on the seed: blend(400, 100, 100, 125) = 105.00
  const res = h.deleteMultipleTransactions(ids, 'tester');
  const added = h.dumpOzonCost().slice(before);
  check('93/02 s14: a bulk delete of two supplies writes exactly 3 rows: two markers and the tail re-blended on the seed (105.00)',
    added.length === 3 && t93Shape(added) === JSON.stringify([['2026-09-01', 'op-A', '', T93_MARK], ['2026-09-05', 'op-B', '', T93_MARK], ['2026-09-10', 'op-C', 105, T93_DEL]])
      && t93State(h) === 105 && !res.costJournalError && t93Bystanders(h) === bys, t93Shape(added));
  check('93/02 s14: the bulk archive payloads carry the OpIDs and the additional costs',
    h.dumpArchive().map(a => [a.data.opId, a.data.additionalCosts]).sort().join('|') === 'op-A,|op-B,1000', JSON.stringify(h.dumpArchive().map(a => a.data)));

  const restoredAt = h.dumpOzonCost().length;
  const back = h.restoreMultipleArchivedItems(h.dumpArchive().map(a => a.archiveId), 'Николай');
  const addedBack = h.dumpOzonCost().slice(restoredAt);
  check('93/02 s14: a bulk restore revives both supplies and the chain is 150 / 225 / 205 again',
    t93Shape(addedBack) === JSON.stringify([['2026-09-01', 'op-A', 150, T93_RES], ['2026-09-05', 'op-B', 225, T93_RES], ['2026-09-10', 'op-C', 205, T93_RES]])
      && t93State(h) === 205 && !back.costJournalError, t93Shape(addedBack));
  const rawB = h.dumpTransSheet().find(r => r['OpID'] === 'op-B');
  check('93/02 s14: the bulk-restored row has its OpID and its additional costs as a number',
    !!rawB && rawB['ДопРасходы'] === 1000 && typeof rawB['ДопРасходы'] === 'number' && rawB['Отгрузка'] === 'ship-B', JSON.stringify(rawB));
})();

// ---- Scenario 15: a re-sort (item 68 / commitShipmentPeresort) ----
(function test93Peresort() {
  const h = t93Fixture();
  const idB = t93Row(h, 'op-B').id;
  h.setExternalShipmentsSheet([{ postingId: 'P-93', cabinet: 'MaxiStore', status: 'processed', items: [{ offerId: 'ART-C', quantity: 200 }],
    transGroupInfo: JSON.stringify([idB]), orderNumber: '1300' }]);
  const sheet = h.getRegistrySheet('Внешние отгрузки');
  const dump = sheet.__dump();
  dump[1][dump[0].indexOf('ПересортJSON')] = JSON.stringify({ pairs: [{ fromArticle: 'ART-C', toArticle: 'ART-D', fromOfferId: 'ART-C', toOfferId: 'ART-D', qty: 50 }] });
  sheet.__setData(dump);
  const others = () => JSON.stringify(h.dumpOzonCost().filter(r => r['Кабинет'] !== 'MaxiStore' || (r['Артикул'] !== 'ART-C' && r['Артикул'] !== 'ART-D')));
  const bys = others();
  const before = h.dumpOzonCost().length;
  // 200 -> 150 of ART-C at 300: blend(200, 150, 150, 300) = 214.29 ; blend(400, 214.29, 100, 125) = 196.43 ; ART-D 50 @400 is its first supply (400.00)
  const res = h.commitShipmentPeresort('P-93', 'tester');
  const added = h.dumpOzonCost().slice(before);
  const c = added.filter(r => r['Артикул'] === 'ART-C'), d = added.filter(r => r['Артикул'] === 'ART-D');
  check('93/02 s15: a re-sort rewrites the chain of the old article by the OpID (214.29, 196.43) — no OpID-less row anywhere',
    t93Shape(c) === JSON.stringify([['2026-09-05', 'op-B', 214.29, T93_EDIT], ['2026-09-10', 'op-C', 196.43, T93_EDIT]])
      && c[0]['Отгружено'] === 150 && h.dumpOzonCost().every(r => r['OpID'] !== ''), t93Shape(c));
  check('93/02 s15: the new article gets a link of its own with the OpID of the supply, a first one at 400.00',
    d.length === 1 && d[0]['OpID'] === 'op-B' && d[0]['Отгружено'] === 50 && d[0]['Себестоимость после'] === 400 && d[0]['Источник'].indexOf('первая отгрузка') === 0,
    JSON.stringify(d));
  check('93/02 s15: the other articles and the other cabinet are byte for byte, the answer carries no journal error',
    others() === bys && res.success === true && !res.costJournalError, JSON.stringify(res.costJournalError));
})();

// ---- Scenario 16: «История» rows without an OpID ----
(function test93OpIdLess() {
  const h = t93Fixture();
  h.commitTransaction([{ article: 'ART-X', quantity: 8, price: 70 }], 'Расход', T93_DEST, '2026-09-04', 'tester', '2026-09-03T12:00:00.000Z', '');
  const noOp = h.getTransactions().rows.find(t => t.article === 'ART-X' && t.opId === '' && t.type === 'Расход');
  const journalRows = h.dumpOzonCost().length;
  const edited = h.updateTransaction(noOp.id, { article: 'ART-X', quantity: 6, price: 70, type: 'Расход', destination: T93_DEST, deliveryDate: '2026-09-04', date: noOp.date }, 'tester');
  check('93/02 s16: an edit of an Ozon row without an OpID is done in «История», the journal is not touched, the owner is told',
    h.getTransactions().rows.find(t => t.article === 'ART-X' && t.opId === '' && t.quantity === 6) !== undefined
      && h.dumpOzonCost().length === journalRows && edited.costJournalError.indexOf('Строка без номера операции (OpID)') === 0, edited.costJournalError);
  const again = h.getTransactions().rows.find(t => t.article === 'ART-X' && t.opId === '' && t.type === 'Расход');
  const deleted = h.deleteTransaction(again.id, 'tester');
  check('93/02 s16: a deletion of an Ozon row without an OpID is done, the journal is not touched, the owner is told',
    !h.getTransactions().rows.some(t => t.id === again.id) && h.dumpOzonCost().length === journalRows
      && deleted.costJournalError.indexOf('Строка без номера операции (OpID)') === 0, deleted.costJournalError);
})();

// ---- Scenario 17: the journal fails — the operation still stands ----
(function test93JournalFailure() {
  const h = t93Fixture();
  h.context.applyOzonCostChainOps = function() { throw new Error('журнал недоступен'); };
  const journal = JSON.stringify(h.dumpOzonCost());
  const idB = t93Row(h, 'op-B').id;
  const res = h.deleteTransaction(idB, 'tester');
  check('93/02 s17: a journal failure on a deletion does not undo it, and the answer says so',
    !h.getTransactions().rows.some(t => t.id === idB) && h.dumpArchive().length === 1
      && res.costJournalError.indexOf('Операция удалена, но журнал «Себестоимость Озон» для КАН НЕ обновлён') === 0 && res.costJournalError.indexOf('журнал недоступен') !== -1
      && JSON.stringify(h.dumpOzonCost()) === journal, res.costJournalError);
  const edited = t93Edit(h, 'op-C', { quantity: 90 });
  check('93/02 s17: a journal failure on a pencil edit does not undo it either',
    t93Row(h, 'op-C').quantity === 90 && edited.costJournalError.indexOf('журнал недоступен') !== -1, edited.costJournalError);

  // A chain that cannot be read stops only itself.
  const g = t93Fixture();
  g.setOzonCostSheet(g.dumpOzonCost().map(r => Object.keys(r).map(k => r[k])).concat([
    // a second original under op-X for ART-X — that chain is broken
    ['2026-09-03', 'MaxiStore', 'ART-X', 'S-ART-X', 110, 50.91, 10, 60, 52, 'op-X', '', 'отгрузка']]));
  const edit = t93Edit(g, 'op-B', { quantity: 100 });
  check('93/02 s17: an unreadable chain of another article does not stop the edit of this one',
    !edit.costJournalError && t93State(g) === 185, String(edit.costJournalError));
  const broken = t93Edit(g, 'op-X', { quantity: 9 }, 'ART-X');
  check('93/02 s17: the unreadable chain itself fails alone: «История» is edited, the answer names the chain',
    t93Row(g, 'op-X', 'ART-X').quantity === 9 && broken.costJournalError.indexOf('две отгрузки') !== -1, String(broken.costJournalError));
})();

// ---- A combined shipment (item 90): the edit touches the link of ITS order only ----
(function test93CombinedEdit() {
  // Three orders as in the item 90 fixture: A x10 (op-comb-1), B x20 (op-comb-2), A x20 + B x10 (op-comb-3), all at 620 per piece
  // with their share of the batch. The row A x20 of order 3 becomes A x25: the row is rebuilt at 617.14 (see test90t03c).
  // blend(900, 620, 25, 617.14) = 619.92
  const h = t90ThreeOrders();
  const edited = t90Rows(h).find(t => t.opId === `${T90_SHIP}-3` && t.article === 'A');
  const before = h.dumpOzonCost().length;
  h.updateTransaction(edited.id, {
    article: 'A', quantity: 25, price: edited.price, writeOffCost: edited.writeOffCost,
    type: 'Расход', destination: edited.destination, deliveryDate: '2026-09-22', date: edited.date
  }, 'tester');
  const added = h.dumpOzonCost().slice(before);
  check('93/02 s3: a row edit inside a combined shipment rewrites only the link of its own order and article (619.92)',
    added.length === 1 && added[0]['OpID'] === `${T90_SHIP}-3` && added[0]['Артикул'] === 'A' && added[0]['Отгружено'] === 25
      && added[0]['Себестоимость отгрузки'] === 617.14 && added[0]['Себестоимость после'] === 619.92 && h.dumpOzonCost().every(r => r['OpID'] !== ''),
    JSON.stringify(added));
})();

// ---- Review fixes: a kit component brought back by a bulk restore, and a supply on the seed's own day ----
(function test93ReviewFixes() {
  // Until 2026-10-14 a bulk restore wrote «isComponent» back empty, so a kit component row of op-B came back looking
  // like a shipment of its own (ART-D under op-B, Ozon destination). Since then it comes back as a component; rows
  // restored before that still sit in «История» without the flag, and only a re-sort may add a link for them.
  const h = t93Fixture();
  const C = h.context;
  const comp = h.commitTransaction([{ article: 'ART-D', quantity: 5, price: 400 }], 'Расход', T93_DEST, '2026-09-05', 'tester',
    '2026-09-03T10:00:00.000Z', 'tmp-K', undefined, undefined, '', 'ship-B', true);
  C.stampOpIdOnTransactions(comp.newTransactions, 'op-B');
  const sheet = C.getTransactionSheet(C.getSpreadsheet());
  const hdr = C.readHeaderRow(sheet);
  const compId = String(comp.newTransactions[0].id);
  const ids = sheet.getRange(1, hdr.indexOf('ID') + 1, sheet.getLastRow(), 1).getValues().map(r => String(r[0]));
  sheet.getRange(ids.indexOf(compId) + 1, hdr.indexOf('isComponent') + 1).setValue(true);
  h.deleteMultipleTransactions([t93Row(h, 'op-B').id, compId], 'tester');
  const back = h.restoreMultipleArchivedItems(h.dumpArchive().map(a => a.archiveId), 'tester');
  const compBack = h.getTransactions().rows.find(t => String(t.id) === compId);
  check('93/02 s14: a kit component restored in bulk comes back as a component and gets no link of its own; the chain is 150 / 225 / 205 again',
    compBack && compBack.opId === 'op-B' && compBack.isComponent === true
      && h.dumpOzonCost().every(r => r['Артикул'] !== 'ART-D') && t93State(h) === 205 && !back.costJournalError,
    JSON.stringify(h.dumpOzonCost().filter(r => r['Артикул'] === 'ART-D')));
  // The same row as an older bulk restore left it (no «isComponent»): a later delete + restore of op-B still adds no link for it.
  const ids2 = sheet.getRange(1, hdr.indexOf('ID') + 1, sheet.getLastRow(), 1).getValues().map(r => String(r[0]));
  sheet.getRange(ids2.indexOf(compId) + 1, hdr.indexOf('isComponent') + 1).setValue('');
  h.deleteMultipleTransactions([t93Row(h, 'op-B').id], 'tester');
  const back2 = h.restoreMultipleArchivedItems(h.dumpArchive().map(a => a.archiveId), 'tester');
  check('93/02 s14: a component row left without «isComponent» by an older bulk restore gets no link of its own either; the chain is 205 again',
    h.getTransactions().rows.find(t => String(t.id) === compId).isComponent !== true
      && h.dumpOzonCost().every(r => r['Артикул'] !== 'ART-D') && t93State(h) === 205 && !back2.costJournalError,
    JSON.stringify(h.dumpOzonCost().filter(r => r['Артикул'] === 'ART-D')));

  // A supply dropped on the seed's own day: the day keeps the seed's cost (re-stated after the marker), it is
  // not a KAN delete. seed 100; op-a 08-01 base 100, 100 @200 -> 150; op-b 08-05 base 200, 100 @250 -> 183.33;
  // without op-a: op-b = blend(200, 100, 100, 250) = 150.00.
  const t = freshHarness();
  t.setOzonCostSheet([
    costRow('2026-08-01', 'MaxiStore', 'ART-S2', 100, 'НАЧАЛЬНАЯ ТОЧКА', { source: T93_SEED_SOURCE, exported: T93_STAMP }),
    costRow('2026-08-01', 'MaxiStore', 'ART-S2', 150, 'op-a', { stockBefore: 100, costBefore: 100, shipped: 100, shippedCost: 200, source: 'отгрузка', exported: T93_STAMP }),
    costRow('2026-08-05', 'MaxiStore', 'ART-S2', 183.33, 'op-b', { stockBefore: 200, costBefore: 150, shipped: 100, shippedCost: 250, source: 'отгрузка', exported: T93_STAMP })
  ]);
  const b0 = t.dumpOzonCost().length;
  t.applyOzonCostChainOps('MaxiStore', 'ART-S2', { 'op:op-a': { drop: true } }, 'пересчёт после удаления отгрузки');
  const added = t.dumpOzonCost().slice(b0);
  const lastOfSeedDay = t.dumpOzonCost().filter(r => String(r['Дата']).slice(0, 10) === '2026-08-01').pop();
  const fileDays = t.getOzonCostExport().rows.map(r => String(r.date).slice(0, 10) + '=' + r.cost);
  check('93/02 s9: a supply dropped on the seed\'s own day leaves the seed (100.00) as that day\'s last row, not a KAN delete',
    t93Shape(added) === JSON.stringify([['2026-08-01', 'op-a', '', T93_MARK], ['2026-08-01', 'НАЧАЛЬНАЯ ТОЧКА', 100, T93_SEED_SOURCE], ['2026-08-05', 'op-b', 150, 'пересчёт после удаления отгрузки']])
      && lastOfSeedDay['Себестоимость после'] === 100 && t93State(t, 'MaxiStore', 'ART-S2') === 150
      && fileDays.join(',') === '2026-08-01=100,2026-08-05=150',
    t93Shape(added) + ' file ' + fileDays.join(','));
})();

// ---- A retry of a deleted supply with the same OpID, and the entry point of ticket 06 ----
(function test93RetryAndEntryPoint() {
  const h = t93Fixture();
  h.deleteTransaction(t93Row(h, 'op-B').id, 'tester');
  const before = h.dumpOzonCost().length;
  const res = h.commitTransaction([{ article: 'ART-C', quantity: 200, price: 300 }], 'Расход', T93_DEST, '2026-09-05', 'tester', '2026-09-03T10:00:00.000Z', 'op-B');
  const added = h.dumpOzonCost().slice(before);
  check('93/02 s20: committing the same OpID again after its deletion revives the link in place (225.00 / 205.00), no new «отгрузка» row',
    t93Shape(added) === JSON.stringify([['2026-09-05', 'op-B', 225, T93_RES], ['2026-09-10', 'op-C', 205, T93_RES]]) && !res.costJournalError
      && t93State(h) === 205, t93Shape(added));

  // Ticket 06: the live chain with an OpID-less link (row 60 of the live journal) and two explicit corrections.
  // seed 200 -> r1 base 100, 50 @220: 206.67 ; no-OpID base 150, 20 @240: 210.59 ; op2 base 170, 30 @260: 218.00
  // dropping the no-OpID link: op2 = blend(170, 206.67, 30, 260) = 214.67 ; explicit cost 280 on op2: blend(170, 206.67, 30, 280) = 217.67
  const t = freshHarness();
  t.setOzonCostSheet([
    costRow('2026-08-01', 'MaxiStore', 'ART-L', 200, 'НАЧАЛЬНАЯ ТОЧКА', { source: T93_SEED_SOURCE }),
    costRow('2026-09-01', 'MaxiStore', 'ART-L', 206.67, 'op-1', { stockBefore: 100, costBefore: 200, shipped: 50, shippedCost: 220, source: 'отгрузка' }),
    costRow('2026-09-12', 'MaxiStore', 'ART-L', 210.59, '', { stockBefore: 150, costBefore: 206.67, shipped: 20, shippedCost: 240, source: 'отгрузка' }),
    costRow('2026-09-19', 'MaxiStore', 'ART-L', 218, 'op-2', { stockBefore: 170, costBefore: 210.59, shipped: 30, shippedCost: 260, source: 'отгрузка' })
  ]);
  const b0 = t.dumpOzonCost().length;
  const dropped = t.applyOzonCostChainOps('MaxiStore', 'ART-L', { 'row:4': { drop: true } }, 'пересчёт после ручной правки');
  const a0 = t.dumpOzonCost().slice(b0);
  check('93/02 s19: the entry point drops an OpID-less link: its marker keeps the empty OpID and base, the rest is re-blended once',
    dropped.appended === 2 && t93Shape(a0) === JSON.stringify([['2026-09-12', '', '', T93_MARK], ['2026-09-19', 'op-2', 214.67, 'пересчёт после ручной правки']])
      && a0[0]['Остаток до'] === 150 && t93State(t, 'MaxiStore', 'ART-L') === 214.67, t93Shape(a0));
  const b1 = t.dumpOzonCost().length;
  t.applyOzonCostChainOps('MaxiStore', 'ART-L', { 'op:op-2': { shippedCost: 280 } }, 'пересчёт после ручной правки');
  check('93/02 s19: an explicit unit cost op corrects one link (217.67) on top of the dropped OpID-less one',
    t93Shape(t.dumpOzonCost().slice(b1)) === JSON.stringify([['2026-09-19', 'op-2', 217.67, 'пересчёт после ручной правки']]));
  const dropAgain = t.applyOzonCostChainOps('MaxiStore', 'ART-L', { 'row:4': { drop: true } }, 'пересчёт после ручной правки');
  check('93/02 s19: dropping a link that is already dropped writes nothing', dropAgain.appended === 0);
  let unknown = '';
  try { t.applyOzonCostChainOps('MaxiStore', 'ART-L', { 'op:nope': { drop: true } }, 'пересчёт после ручной правки'); } catch (e) { unknown = String(e.message || e); }
  check('93/02 s19: an op for a link the chain does not have is an error, not a guess', unknown.indexOf('op:nope') !== -1, unknown);
  // A source that is not a «пересчёт…» text would be read back as a second original of the link.
  const b2 = t.dumpOzonCost().length;
  let badSource = '';
  try { t.applyOzonCostChainOps('MaxiStore', 'ART-L', { 'op:op-2': { shippedCost: 290 } }, 'исправление журнала'); } catch (e) { badSource = String(e.message || e); }
  check('93/02 s19: a source that does not start with «пересчёт» is refused and nothing is written',
    badSource.indexOf('должен начинаться со слова «пересчёт»') !== -1 && t.dumpOzonCost().length === b2, badSource);
})();

// ================= Item 93 ticket 03: the KAN cost sender =================
// The sender pushes the journal «Себестоимость Озон» to KAN and accepts a group only after reading KAN
// back. The stand fakes KAN behind UrlFetchApp (fakeKanCost): a stateful store of cost entries per shop,
// the live answer shapes observed on 2026-10-14, and failure modes. Fixture: MaxiStore / ART-C on
// 2026-10-13 at 233.67 (one shipment, op-1). KAN's shops: MaxiStore 2771, Mercurius 1765.
// The stand's clock is 2026-10-14 10:00 UTC = 13:00:00 in the script zone (Europe/Moscow).

const T03_TOKEN = 'tok-93-03';
const T03_NOW = '2026-10-14T10:00:00Z';
const T03_TIME = '2026-10-14 13:00:00';
const T03_OLD_STAMP = '2026-09-02 10:00:00 admin';
const T03_DAY = '2026-10-13';
const T03_ERR = 'ошибка';
const T03_OK = 'принято';
const T03_SENDING = 'отправляется';
const T03_MARKER = 'удалено из цепочки';

// JSON with sorted keys: the assertions are about the content of a request, not its key order.
const t03Canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x))
  ? Object.keys(x).sort().reduce((o, key) => { o[key] = x[key]; return o; }, {}) : x);

function fakeKanCost(options) {
  const o = Object.assign({
    scopes: ['mcp:product_cost:read', 'mcp:product_cost:write'],
    shops: [
      { id: 2771, name: 'MaxiStore', marketplace: 'ozon', is_active: true },
      { id: 1765, name: 'Mercurius', marketplace: 'ozon', is_active: true }
    ],
    entries: {},             // shopId -> [{ article, date, cost }] KAN already holds
    known: null,             // lower-cased articles KAN knows; null = every article
    issueReason: 'Товар не найден',
    issueRowNumbers: 'right', // 'wrong': row_number points at no sent row
    listShops: 'ok',         // 'ok' | 'timeout' | 'http500' | 'http401'
    preview: 'ok',           // 'ok' | 'refuse' | 'http500' | 'timeout' | 'noId'
    previewFailShop: null,   // a shop id whose previews answer HTTP 500
    apply: 'ok',             // 'ok' | 'lostFirst' (written, answer lost) | 'timeout' | 'expired' | 'refuse'
    writeDelta: 0,           // apply stores cost + writeDelta: a KAN that writes a wrong figure
    lostWrite: false,        // apply says «ok» and writes nothing
    historySaved: true,
    readBack: 'ok',          // 'ok' | 'http500'
    readFailShop: null,      // a shop id whose get_product_costs answers HTTP 500
    readFailNth: null,       // the n-th get_product_costs call (1-based) answers HTTP 500
    pageSize: 1000,
    onCall: null
  }, options || {});
  const state = { store: {}, previews: {}, seq: 0, idSeq: 1000, writes: 0, applies: 0, previewCount: 0, reads: 0, calls: [] };
  Object.keys(o.entries).forEach((shop) => {
    state.store[shop] = o.entries[shop].map((e) => ({ id: ++state.idSeq, productId: state.idSeq * 10, article: e.article, date: e.date, cost: e.cost }));
  });
  const shopEntries = (shopId) => (state.store[shopId] = state.store[shopId] || []);
  const text = (obj, isError) => ({ code: 200, body: { jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj) }], isError: !!isError } } });
  const timeout = () => new Error('Exception: Timeout: https://kultura-analitiki.ru/mcp/');
  const lower = (s) => String(s).trim().toLowerCase();

  state.handler = function (url, request) {
    const body = JSON.parse(request.payload);
    const name = body.params.name;
    const args = body.params.arguments || {};
    state.calls.push(name);
    if (o.onCall) o.onCall(name, args, state);

    if (name === 'list_shops') {
      if (o.listShops === 'timeout') throw timeout();
      if (o.listShops === 'http500') return { code: 500, body: 'Internal Server Error' };
      if (o.listShops === 'http401') return { code: 401, body: { detail: 'Invalid or missing MCP credentials.' } };
      return text({ access: { scopes: o.scopes, role: 'read_write' }, shops: o.shops });
    }

    if (name === 'preview_product_cost_changes') {
      if (o.preview === 'timeout') throw timeout();
      if (o.preview === 'http500' || (o.previewFailShop && args.shop_id && args.shop_id[0] === o.previewFailShop)) return { code: 500, body: 'boom' };
      if (o.preview === 'refuse') return text('Недостаточно прав на запись себестоимости', true);
      state.previewCount++;
      const id = 'prev-' + (++state.seq);
      if (args.operation === 'delete') {
        const found = Object.keys(state.store).some((shop) => state.store[shop].some((e) => e.id === args.entry_id));
        if (!found) return text(JSON.stringify({ error: { code: 'not_found', message: 'Запись себестоимости не найдена' } }), true);
        state.previews[id] = { kind: 'delete', entryId: args.entry_id, applied: false, result: null };
        return text({ preview_id: id, operation: 'delete', confirmation_required: true, items: [], summary: { history_saved: false, total: 1, imported: 0, issues: [] } });
      }
      if (!Array.isArray(args.shop_id) || args.shop_id.length !== 1) {
        return text(JSON.stringify({ error: { code: 'invalid_params', message: 'Укажите ровно один магазин' } }), true);
      }
      const issues = [];
      const good = [];
      args.rows.forEach((row, i) => {
        if (o.known && o.known.indexOf(lower(row.sku_article)) === -1) {
          issues.push({ row_number: o.issueRowNumbers === 'wrong' ? 99 : i + 1, sku: '', sku_article: lower(row.sku_article), reason: o.issueReason });
        } else {
          good.push(row);
        }
      });
      state.previews[id] = { kind: 'import', shopId: args.shop_id[0], rows: good, applied: false, result: null };
      const answer = {
        operation: 'import', expires_at: '2026-10-14T15:58:27.220501+00:00', confirmation_required: true,
        items: good.map((r) => ({ before: null, after: { sku_article: r.sku_article, dt: r.date, cost_price: Number(r.cost_price).toFixed(4) } })),
        summary: {
          history_saved: false, update_task_failed: false, interval_update_queued: false, task_id: null,
          total: args.rows.length, imported: good.length, created: good.length, updated: 0, unique_products: good.length, duplicates: 0,
          skipped: issues.length ? { 'Товар не найден': issues.length } : {}, issues
        },
        date_default: T03_DAY
      };
      if (o.preview !== 'noId') answer.preview_id = id;
      return text(answer);
    }

    if (name === 'apply_product_cost_changes') {
      state.applies++;
      const p = state.previews[args.preview_id];
      if (args.confirm !== true) return text('confirm=true required', true);
      if (!p) return text('Предпросмотр не найден', true);
      if (o.apply === 'expired') return text('Предпросмотр истёк', true);
      if (o.apply === 'refuse') return text('КАН не может применить изменения', true);
      if (o.apply === 'timeout') throw timeout();
      if (p.applied) return text(p.result);              // the same preview again: its result, no second write
      if (!o.lostWrite) {
        if (p.kind === 'delete') {
          Object.keys(state.store).forEach((shop) => {
            const before = state.store[shop].length;
            state.store[shop] = state.store[shop].filter((e) => e.id !== p.entryId);
            if (state.store[shop].length !== before) state.writes++;
          });
        } else {
          p.rows.forEach((row) => {
            const list = shopEntries(p.shopId);
            const cost = Math.round((Number(row.cost_price) + o.writeDelta) * 100) / 100;
            const existing = list.find((e) => lower(e.article) === lower(row.sku_article) && e.date === row.date);
            if (existing) existing.cost = cost;
            else list.push({ id: ++state.idSeq, productId: state.idSeq * 10, article: row.sku_article, date: row.date, cost });
            state.writes++;
          });
        }
      }
      p.applied = true;
      p.result = { summary: { history_saved: o.historySaved, interval_update_queued: true, update_task_failed: false } };
      if (o.apply === 'lostFirst' && state.applies === 1) throw timeout();   // written, but the answer never came back
      return text(p.result);
    }

    if (name === 'get_product_costs') {
      state.reads++;
      if (o.readBack === 'http500' || (o.readFailShop && args.shop_id && args.shop_id[0] === o.readFailShop) || (o.readFailNth && state.reads === o.readFailNth)) return { code: 500, body: 'boom' };
      if (!Array.isArray(args.shop_id) || args.limit > 1000) return text('invalid params', true);
      const list = shopEntries(args.shop_id[0]).filter((e) => e.date >= args.date__gte && e.date <= args.date__lte);
      const offset = Number(args.offset) || 0;
      const page = list.slice(offset, offset + o.pageSize);
      const next = offset + o.pageSize < list.length ? offset + o.pageSize : null;
      return text({
        count: list.length, limit: args.limit, offset, returned_rows: page.length, truncated: next !== null, next_offset: next,
        items: page.map((e) => ({ id: e.id, product_id: e.productId, shop_id: args.shop_id[0], shop_name: 'x', sku_article: e.article,
          product_name: 'Товар', dt: e.date, dt_end: null, cost_price: Number(e.cost).toFixed(4), expense: '0.0000' }))
      });
    }
    return { code: 500, body: 'unknown tool ' + name };
  };
  state.entries = (shopId) => shopEntries(shopId).map((e) => ({ article: e.article, date: e.date, cost: e.cost }));
  return state;
}

// A journal row (12 columns) with optional KAN columns appended: extra.status / answer / time.
const t03Row = (date, cab, art, cost, opId, extra) => {
  const e = extra || {};
  const row = costRow(date, cab, art, cost, opId, Object.assign({ sku: 'S-' + art, source: 'отгрузка', shipped: 10, shippedCost: cost, stockBefore: 100, costBefore: cost }, e));
  return e.status !== undefined ? row.concat([e.status, e.answer || '', e.time || '']) : row;
};
const t03One = (extra) => t03Row(T03_DAY, 'MaxiStore', 'ART-C', 233.67, 'op-1', extra);
const t03Marker = (date, art, opId, extra) => costRow(date, 'MaxiStore', art, '', opId, Object.assign({ source: T03_MARKER, shipped: 0, stockBefore: 100 }, extra || {}));

// narrow = the sheet as it was before ticket 03: 12 columns only.
function t03Setup(rows, kanOptions, narrow) {
  const h = freshHarness();
  h.setNow(T03_NOW);
  h.setScriptProperty('kan_mcpToken', T03_TOKEN);
  h.setOzonCostSheet(rows, narrow ? undefined : h.OZON_COST_HEADERS.concat(h.OZON_COST_KAN_HEADERS));
  const kan = fakeKanCost(kanOptions);
  h.setFetchHandler(kan.handler);
  return { h, kan };
}
function t03Run(rows, kanOptions, username, narrow) {
  const t = t03Setup(rows, kanOptions, narrow);
  t.before = t.h.dumpOzonCostFull();
  t.res = t.h.sendOzonCostToKan(username === undefined ? 'tester' : username);
  t.after = t.h.dumpOzonCostFull();
  return t;
}
const t03Names = (h) => h.fetchLog.map((f) => f.body.params.name);
const t03Args = (h, name) => h.fetchLog.filter((f) => f.body.params.name === name).map((f) => f.body.params.arguments);
// The 11 columns of a journal row the sender must never touch: everything but «Выгружено в КАН».
const t03Fixed = (row) => t03Canon(Object.keys(row).filter((k) => k !== 'Выгружено в КАН' && !k.endsWith(' КАН')).map((k) => [k, row[k]]));
// «Статус КАН» / «Ответ КАН» / «Время КАН» / «Выгружено в КАН» of a row.
const t03State = (row) => [row['Статус КАН'], row['Ответ КАН'], row['Время КАН'], row['Выгружено в КАН']];
// The row is an error with this exact reason, and was NOT stamped.
const t03IsError = (row, reason) => row['Статус КАН'] === T03_ERR && row['Ответ КАН'] === reason && row['Время КАН'] === T03_TIME && row['Выгружено в КАН'] === '';
const t03Accepted = (row, answer, stamp) => row['Статус КАН'] === T03_OK && row['Ответ КАН'] === answer && row['Время КАН'] === T03_TIME && row['Выгружено в КАН'] === stamp;

(function test93s03Pure() {
  const h = freshHarness();
  // kanCostReason maps the texts kanCall throws (Latin «KAN») to what the owner reads.
  const reason = (text) => h.kanCostReason(new Error(text));
  const noToken = reason('Токен KAN не задан: добавьте свойство скрипта kan_mcpToken');
  const rejected = reason('KAN отверг токен (HTTP 401): проверьте свойство kan_mcpToken');
  check('93/03 reason: a missing token and a rejected token are told apart and are not retried',
    noToken.reason === 'токен КАН не задан' && !noToken.transport && rejected.reason === 'КАН отверг токен' && !rejected.transport,
    JSON.stringify([noToken, rejected]));
  const plain = reason('KAN отказал на preview_product_cost_changes: Недостаточно прав');
  const jsonTail = reason('KAN отказал на apply_product_cost_changes: ' + JSON.stringify({ error: { code: 'x', message: 'Предпросмотр истёк' } }));
  const jsonMessage = reason('KAN ошибка на get_product_costs: ' + JSON.stringify({ message: 'Слишком много' }));
  const long = reason('KAN отказал на preview_product_cost_changes: ' + 'я'.repeat(400));
  check('93/03 reason: a refusal shows KAN\'s own words (plain text, error.message, message), cut to 150 characters',
    plain.reason === 'КАН отказал: Недостаточно прав' && jsonTail.reason === 'КАН отказал: Предпросмотр истёк'
      && jsonMessage.reason === 'КАН отказал: Слишком много' && long.reason === 'КАН отказал: ' + 'я'.repeat(150)
      && !plain.transport && !long.transport,
    JSON.stringify([plain, jsonTail, jsonMessage]));
  const down = [reason('KAN ответил HTTP 500 на ping: boom'), reason('Exception: Timeout: https://kultura-analitiki.ru/mcp/'),
    reason('KAN вернул не JSON на ping'), reason('KAN вернул нечитаемый ответ на ping'), reason('что-то совсем другое')];
  check('93/03 reason: HTTP 5xx, a timeout, unreadable answers and anything unknown are «КАН недоступен» and count as transport',
    down.every((d) => d.reason === 'КАН недоступен' && d.transport === true), JSON.stringify(down));

  // Grouping: (cabinet, article, date), the last row wins, the OpIDs of every row come along.
  const rows = (list) => { h.setOzonCostSheet(list, h.OZON_COST_HEADERS.concat(h.OZON_COST_KAN_HEADERS)); return h.getOzonCostJournal(); };
  const journal = rows([
    t03Row(T03_DAY, 'MaxiStore', 'A', 231, 'op-1'),
    t03Row(T03_DAY, 'MaxiStore', 'A', 233.67, 'op-2'),
    t03Row(T03_DAY, 'MaxiStore', 'A', 233.67, 'op-2'),
    t03Row('2026-10-12', 'MaxiStore', 'A', 200, ''),
    t03Marker('2026-10-11', 'A', 'op-3'),
    t03Row('2026-10-11', 'MaxiStore', 'B', 99, 'op-4'),
    t03Marker('2026-10-11', 'B', 'op-4'),
    t03Row(T03_DAY, '', 'C', 5, 'op-5'),
    t03Row(T03_DAY, 'MaxiStore', '', 5, 'op-6'),
    t03Row(T03_DAY + 'T00:00:00', 'Mercurius', 'A', 70, 'op-7')
  ]);
  const grouped = h.collectOzonCostKanGroups(journal);
  const brief = grouped.pending.map((g) => [g.cabinet, g.article, g.date, g.action, g.cost, g.opIds, g.rows.length]);
  check('93/03 groups: one group per cabinet, article and day; the last row\'s figure; OpIDs unique and in row order; empty cabinet or article skipped',
    t03Canon(brief) === t03Canon([
      ['MaxiStore', 'A', T03_DAY, 'upsert', 233.67, ['op-1', 'op-2'], 3],
      ['MaxiStore', 'A', '2026-10-12', 'upsert', 200, [], 1],
      ['MaxiStore', 'A', '2026-10-11', 'delete', null, ['op-3'], 1],
      ['MaxiStore', 'B', '2026-10-11', 'delete', null, ['op-4'], 2],
      ['Mercurius', 'A', T03_DAY, 'upsert', 70, ['op-7'], 1]
    ]), JSON.stringify(brief));

  // Status rules, on the LAST row of the group.
  const ruled = rows([
    t03Row(T03_DAY, 'MaxiStore', 'S-none', 1, 'o1'),
    t03Row(T03_DAY, 'MaxiStore', 'S-sending', 1, 'o2', { status: T03_SENDING }),
    t03Row(T03_DAY, 'MaxiStore', 'S-error', 1, 'o3', { status: T03_ERR }),
    t03Row(T03_DAY, 'MaxiStore', 'S-ok', 1, 'o4', { status: T03_OK, exported: T03_OLD_STAMP }),
    t03Row(T03_DAY, 'MaxiStore', 'S-manual', 1, 'o5', { status: 'вручную' }),
    t03Row(T03_DAY, 'MaxiStore', 'S-legacy', 1, 'o6', { exported: T03_OLD_STAMP }),
    t03Row(T03_DAY, 'MaxiStore', 'S-odd', 1, 'o7', { status: 'проверить' }),
    t03Row(T03_DAY, 'MaxiStore', 'S-fixed', 1, 'o8', { status: T03_OK }),
    t03Row(T03_DAY, 'MaxiStore', 'S-fixed', 2, 'o9')
  ]);
  const ruledGroups = h.collectOzonCostKanGroups(ruled);
  check('93/03 groups: unsent, «отправляется» and «ошибка» are pending; accepted, an unknown status and a legacy CSV-stamped row are not; «вручную» is only counted; a newer unsent row revives an accepted group',
    ruledGroups.pending.map((g) => g.article).join(',') === 'S-none,S-sending,S-error,S-fixed' && ruledGroups.skippedManual === 1,
    ruledGroups.pending.map((g) => g.article).join(',') + ' manual ' + ruledGroups.skippedManual);

  // The reader: absent KAN columns read as empty; a Date in «Время КАН» comes back as text.
  const old12 = h.ozonCostRowsFromValues([h.OZON_COST_HEADERS.slice(), t03One()]);
  const stamped = h.ozonCostRowsFromValues([h.OZON_COST_HEADERS.concat(h.OZON_COST_KAN_HEADERS),
    t03One().concat([T03_OK, 'КАН принял 233,67', new h.FakeDate(Date.parse(T03_NOW))])]);
  check('93/03 reader: an old 12-column sheet reads with empty KAN fields; a Date in «Время КАН» is read back as «yyyy-MM-dd HH:mm:ss» text',
    old12.length === 1 && old12[0].kanStatus === '' && old12[0].kanAnswer === '' && old12[0].kanTime === ''
      && stamped[0].kanStatus === T03_OK && stamped[0].kanAnswer === 'КАН принял 233,67' && stamped[0].kanTime === T03_TIME,
    JSON.stringify([old12[0], stamped[0]]));
})();

(function test93s03Accept() {
  const bystander = t03Row('2026-09-02', 'Mercurius', 'ART-M', 85, 'op-m', { exported: T03_OLD_STAMP, status: T03_OK, answer: 'КАН принял 85,00', time: '2026-09-02 10:00:00' });
  const t = t03Setup([t03One(), bystander]);
  const { h, kan } = t;
  const sheet = h.getRegistrySheet('Себестоимость Озон');
  const before = h.dumpOzonCostFull();
  sheet.__resetSetValuesCallCount();
  const res = h.sendOzonCostToKan('tester');
  const after = h.dumpOzonCostFull();

  check('93/03 A: the answer names the accepted group — cabinet, article, date, figure, OpIDs — and nothing else',
    res.busy === false && res.skippedManual === 0 && res.notWritten === 0 && res.failed.length === 0
      && t03Canon(res.accepted) === t03Canon([{ cabinet: 'MaxiStore', article: 'ART-C', date: T03_DAY, action: 'upsert', cost: 233.67, opIds: ['op-1'] }]),
    JSON.stringify(res));
  const bodies = h.fetchLog.map((f) => f.body);
  check('93/03 A: the requests are JSON-RPC tools/call with the Bearer token, in the order list_shops, preview, apply, read-back',
    t03Names(h).join(',') === 'list_shops,preview_product_cost_changes,apply_product_cost_changes,get_product_costs'
      && bodies.every((b) => b.jsonrpc === '2.0' && b.method === 'tools/call')
      && h.fetchLog.every((f) => f.url === 'https://kultura-analitiki.ru/mcp/' && f.options.headers.Authorization === 'Bearer ' + T03_TOKEN),
    t03Names(h).join(','));
  check('93/03 A: the arguments — one shop id, the rounded figure, expense 0, confirm true with the preview\'s own id, the read-back over the day',
    t03Canon(t03Args(h, 'list_shops')[0]) === '{}'
      && t03Canon(t03Args(h, 'preview_product_cost_changes')[0]) === t03Canon({ operation: 'import', shop_id: [2771], rows: [{ sku_article: 'ART-C', date: T03_DAY, cost_price: 233.67, expense: 0 }] })
      && t03Canon(t03Args(h, 'apply_product_cost_changes')[0]) === t03Canon({ preview_id: 'prev-1', confirm: true })
      && t03Canon(t03Args(h, 'get_product_costs')[0]) === t03Canon({ shop_id: [2771], date__gte: T03_DAY, date__lte: T03_DAY, limit: 1000, offset: 0 }),
    JSON.stringify(bodies.map((b) => b.params)));
  check('93/03 A: a one-shipment run costs exactly 4 requests to KAN', h.fetchLog.length === 4, String(h.fetchLog.length));
  check('93/03 A: the row is «принято» with the figure, the time and the stamp «время имя»; columns 1-10 and 12 are byte for byte; the other row is untouched',
    t03Accepted(after[0], 'КАН принял 233,67', T03_TIME + ' tester') && t03Fixed(after[0]) === t03Fixed(before[0])
      && t03Canon(after[1]) === t03Canon(before[1]),
    JSON.stringify(after[0]));
  check('93/03 A: KAN holds the figure after exactly one write',
    t03Canon(kan.entries(2771)) === t03Canon([{ article: 'ART-C', date: T03_DAY, cost: 233.67 }]) && kan.writes === 1, JSON.stringify(kan.entries(2771)));
  check('93/03 A: the statuses cost 3 sheet writes (SENDING, then status block and stamp column) and no request is made under a script lock',
    sheet.__getSetValuesCallCount() === 3 && h.fetchesWhileLocked() === 0 && h.nestedLockTakes() === 0 && !h.isScriptLockHeld(),
    `${sheet.__getSetValuesCallCount()} / ${h.fetchesWhileLocked()} / ${h.nestedLockTakes()}`);

  // B: a second press right after success sends nothing and writes nothing.
  const calls = h.fetchLog.length;
  const frozen = t03Canon(h.dumpOzonCostFull());
  sheet.__resetSetValuesCallCount();
  const again = h.sendOzonCostToKan('tester');
  check('93/03 B: a second call right after success makes no request and writes nothing',
    again.accepted.length === 0 && again.failed.length === 0 && again.busy === false && h.fetchLog.length === calls
      && t03Canon(h.dumpOzonCostFull()) === frozen && sheet.__getSetValuesCallCount() === 0,
    JSON.stringify(again));

  // No user name (the trigger) stamps «автоотправка».
  const auto = t03Run([t03One()], {}, '');
  check('93/03 A: with no user name the stamp ends with «автоотправка»', auto.after[0]['Выгружено в КАН'] === T03_TIME + ' автоотправка', auto.after[0]['Выгружено в КАН']);
})();

(function test93s03Failures() {
  const known = t03One();
  // A refusal on the preview.
  let t = t03Run([known], { preview: 'refuse' });
  check('93/03 C: a refusal is «ошибка» with KAN\'s words, not stamped; the read-back still runs; KAN holds nothing',
    t03IsError(t.after[0], 'КАН отказал: Недостаточно прав на запись себестоимости') && t.res.failed[0].reason === t.after[0]['Ответ КАН']
      && t.res.accepted.length === 0 && t03Names(t.h).join(',') === 'list_shops,preview_product_cost_changes,get_product_costs' && t.kan.entries(2771).length === 0,
    JSON.stringify(t.after[0]) + ' ' + t03Names(t.h).join(','));

  // KAN writes a wrong figure.
  t = t03Run([known], { writeDelta: -0.07 });
  check('93/03 C: a wrong figure written by KAN is «КАН записал 233,60 вместо 233,67» and is not stamped',
    t03IsError(t.after[0], 'КАН записал 233,60 вместо 233,67') && t.res.failed.length === 1, JSON.stringify(t.after[0]));

  // An unknown article in a mixed batch: the known one is accepted.
  t = t03Run([known, t03Row(T03_DAY, 'MaxiStore', 'NOPE-1', 50, 'op-2')], { known: ['art-c'] });
  check('93/03 C: an unknown article in a mixed batch is «товара нет в КАН» and not stamped; the known article of the same batch is accepted and stamped',
    t03Accepted(t.after[0], 'КАН принял 233,67', T03_TIME + ' tester') && t03IsError(t.after[1], 'товара нет в КАН')
      && t03Canon(t03Args(t.h, 'preview_product_cost_changes')[0].rows.map((r) => r.sku_article)) === t03Canon(['ART-C', 'NOPE-1']),
    JSON.stringify(t.after.map(t03State)));
  t = t03Run([known, t03Row(T03_DAY, 'MaxiStore', 'NOPE-1', 50, 'op-2')], { known: ['art-c'], issueRowNumbers: 'wrong' });
  check('93/03 C: when the issue\'s row_number points at no sent row, the issue is found by the article',
    t03Accepted(t.after[0], 'КАН принял 233,67', T03_TIME + ' tester') && t03IsError(t.after[1], 'товара нет в КАН'), JSON.stringify(t.after.map(t03State)));
  t = t03Run([known, t03Row(T03_DAY, 'MaxiStore', 'NOPE-1', 50, 'op-2')], { known: ['art-c'], issueReason: 'Товар определён неоднозначно' });
  check('93/03 C: any other reason KAN gives for a skipped row is shown as «КАН пропустил строку: …»',
    t03IsError(t.after[1], 'КАН пропустил строку: Товар определён неоднозначно'), JSON.stringify(t.after[1]));
  // KAN's word about THIS row (a preview issue) outranks a failure of the whole step.
  t = t03Run([t03Row(T03_DAY, 'MaxiStore', 'NOPE-1', 50, 'op-2')], { known: ['art-c'], apply: 'refuse' });
  check('93/03 C: a batch whose only row is an unknown article and whose apply is refused reads «товара нет в КАН», not KAN\'s refusal; not stamped',
    t03IsError(t.after[0], 'товара нет в КАН') && t.res.failed.length === 1 && t.res.failed[0].reason === 'товара нет в КАН'
      && t03Args(t.h, 'apply_product_cost_changes').length === 1 && t.kan.entries(2771).length === 0,
    JSON.stringify(t.after[0]));
  t = t03Run([known, t03Row(T03_DAY, 'MaxiStore', 'NOPE-1', 50, 'op-2')], { known: ['art-c'], apply: 'refuse' });
  check('93/03 C: in a mixed batch whose apply is refused the unknown article keeps «товара нет в КАН» and the known one gets KAN\'s refusal; neither is stamped',
    t03IsError(t.after[0], 'КАН отказал: КАН не может применить изменения') && t03IsError(t.after[1], 'товара нет в КАН') && t.res.accepted.length === 0,
    JSON.stringify(t.after.map(t03State)));

  // Transport failures.
  t = t03Run([known], { preview: 'http500' });
  check('93/03 C: HTTP 500 is «КАН недоступен»', t03IsError(t.after[0], 'КАН недоступен') && t.res.failed.length === 1, JSON.stringify(t.after[0]));
  t = t03Run([known], { listShops: 'timeout' });
  check('93/03 C: a timeout on list_shops is «КАН недоступен» after exactly 1 request',
    t03IsError(t.after[0], 'КАН недоступен') && t.h.fetchLog.length === 1, `${t.h.fetchLog.length} ${JSON.stringify(t.after[0])}`);
  t = t03Run([known], { listShops: 'http401' });
  check('93/03 C: a 401 is «КАН отверг токен» after 1 request', t03IsError(t.after[0], 'КАН отверг токен') && t.h.fetchLog.length === 1, JSON.stringify(t.after[0]));
  t = t03Setup([known]);
  t.h.clearScriptProperties();
  t.res = t.h.sendOzonCostToKan('tester');
  t.after = t.h.dumpOzonCostFull();
  check('93/03 C: with no token nothing is sent and the reason is «токен КАН не задан»',
    t.h.fetchLog.length === 0 && t03IsError(t.after[0], 'токен КАН не задан'), JSON.stringify(t.after[0]));

  // A lost apply answer.
  t = t03Run([known], { apply: 'lostFirst' });
  const applies = t03Args(t.h, 'apply_product_cost_changes');
  check('93/03 C: an apply whose answer was lost is repeated ONCE with the SAME preview_id (one preview, two applies) and the row is accepted',
    applies.length === 2 && applies[0].preview_id === applies[1].preview_id && t03Args(t.h, 'preview_product_cost_changes').length === 1
      && t03Accepted(t.after[0], 'КАН принял 233,67', T03_TIME + ' tester') && t.kan.writes === 1,
    JSON.stringify([applies, t.after[0]]));
  t = t03Run([known], { apply: 'timeout' });
  check('93/03 C: an apply that times out twice is «КАН недоступен» after one preview and two applies; the read-back still runs',
    t03IsError(t.after[0], 'КАН недоступен') && t03Args(t.h, 'apply_product_cost_changes').length === 2
      && t03Args(t.h, 'preview_product_cost_changes').length === 1 && t03Args(t.h, 'get_product_costs').length === 1,
    t03Names(t.h).join(','));
  t = t03Run([known], { apply: 'expired' });
  check('93/03 C: an expired preview is KAN\'s refusal: one apply, no second preview, the next run starts again',
    t03IsError(t.after[0], 'КАН отказал: Предпросмотр истёк') && t03Args(t.h, 'apply_product_cost_changes').length === 1
      && t03Args(t.h, 'preview_product_cost_changes').length === 1,
    t03Names(t.h).join(','));
  t = t03Run([known], { preview: 'noId' });
  check('93/03 C: a preview without preview_id is «КАН не вернул preview_id» and nothing is applied',
    t03IsError(t.after[0], 'КАН не вернул preview_id') && t03Args(t.h, 'apply_product_cost_changes').length === 0, JSON.stringify(t.after[0]));

  // The token cannot write; the cabinet is unknown; the figure or the date is bad.
  t = t03Run([known, t03Row(T03_DAY, 'Mercurius', 'ART-M', 85, 'op-m')], { scopes: ['mcp:product_cost:read'] });
  check('93/03 C: a token without the write scope fails every group after exactly 1 request',
    t.h.fetchLog.length === 1 && t03IsError(t.after[0], 'токен без права записи себестоимости') && t03IsError(t.after[1], 'токен без права записи себестоимости'),
    JSON.stringify(t.after.map(t03State)));
  t = t03Run([t03Row(T03_DAY, 'Ghost', 'ART-G', 10, 'op-g'), known], { shops: [
    { id: 555, name: 'Ghost', marketplace: 'wb', is_active: true },
    { id: 2771, name: 'MaxiStore', marketplace: 'ozon', is_active: true }
  ] });
  check('93/03 C: a cabinet KAN has no Ozon shop for (a Wildberries shop of that name does not count) fails alone while the other cabinet is sent',
    t03IsError(t.after[0], 'кабинет «Ghost» не найден в КАН') && t03Accepted(t.after[1], 'КАН принял 233,67', T03_TIME + ' tester')
      && t03Args(t.h, 'preview_product_cost_changes')[0].shop_id.join() === '2771',
    JSON.stringify(t.after.map(t03State)));
  t = t03Run([t03Row(T03_DAY, 'Mercurius', 'ART-M', 85, 'op-m'), known], { shops: [
    { id: 1765, name: 'Mercurius', marketplace: 'ozon', is_active: true },
    { id: 1766, name: 'Mercurius', marketplace: 'ozon', is_active: true },
    { id: 2771, name: 'MaxiStore', marketplace: 'ozon', is_active: true }
  ] });
  check('93/03 C: two Ozon shops of one name fail that cabinet without a guess (nothing sent to either shop); the other cabinet is sent',
    t03IsError(t.after[0], 'в КАН два магазина с именем «Mercurius»') && t03Accepted(t.after[1], 'КАН принял 233,67', T03_TIME + ' tester')
      && t03Args(t.h, 'preview_product_cost_changes').map((a) => a.shop_id.join()).join() === '2771',
    JSON.stringify(t.after.map(t03State)));
  t = t03Run([t03Row(T03_DAY, 'MaxiStore', 'ART-Z', 0, 'op-z'), t03Row('13.10.2026', 'MaxiStore', 'ART-D', 10, 'op-d'), known]);
  check('93/03 C: a zero figure and a malformed date are never sent: they fail locally, the good row of the same run is accepted',
    t03IsError(t.after[0], 'нулевая себестоимость — не отправлено') && t03IsError(t.after[1], 'неверная дата в журнале')
      && t03Accepted(t.after[2], 'КАН принял 233,67', T03_TIME + ' tester')
      && t03Canon(t03Args(t.h, 'preview_product_cost_changes')[0].rows.map((r) => r.sku_article)) === t03Canon(['ART-C']),
    JSON.stringify(t.after.map(t03State)));
  t = t03Run([t03Row(T03_DAY, 'MaxiStore', 'ART-Z', 0, 'op-z')]);
  check('93/03 C: when every group fails locally there is no request to KAN at all', t.h.fetchLog.length === 0 && t.res.failed.length === 1, String(t.h.fetchLog.length));

  // history_saved and the read-back disagreeing.
  t = t03Run([known], { writeDelta: -0.07, historySaved: false });
  check('93/03 C: history_saved false plus a wrong figure adds «КАН не сохранил изменения; » in front',
    t03IsError(t.after[0], 'КАН не сохранил изменения; КАН записал 233,60 вместо 233,67'), JSON.stringify(t.after[0]));
  t = t03Run([known], { historySaved: false });
  check('93/03 C: history_saved false but the read-back equals the journal — the read-back decides, the row is accepted and stamped',
    t03Accepted(t.after[0], 'КАН принял 233,67', T03_TIME + ' tester'), JSON.stringify(t.after[0]));
  t = t03Run([known], { entries: { 2771: [{ article: 'ART-C', date: T03_DAY, cost: 200 }, { article: 'art-c', date: T03_DAY, cost: 210 }] } });
  check('93/03 C: two KAN entries for one article and day are «в КАН несколько записей на эту дату», not stamped',
    t03IsError(t.after[0], 'в КАН несколько записей на эту дату'), JSON.stringify(t.after[0]));
  t = t03Run([known], { lostWrite: true });
  check('93/03 C: apply says ok but KAN holds no entry — «в КАН нет записи после отправки», not stamped',
    t03IsError(t.after[0], 'в КАН нет записи после отправки'), JSON.stringify(t.after[0]));
  t = t03Run([known], { readBack: 'http500' });
  const readFailed = t03IsError(t.after[0], 'КАН недоступен');
  t = t03Run([known], { preview: 'refuse', readBack: 'http500' });
  check('93/03 C: when the read-back itself fails the row is an error — with the step\'s own reason if a step failed before it, else «КАН недоступен»',
    readFailed && t03IsError(t.after[0], 'КАН отказал: Недостаточно прав на запись себестоимости'), JSON.stringify(t.after[0]));
})();

(function test93s03Grouping() {
  // One article on two days: one preview with both rows, one read-back over both days.
  let t = t03Run([t03One(), t03Row('2026-10-10', 'MaxiStore', 'ART-C', 210.5, 'op-0')]);
  check('93/03 D: one article on two days is two groups in ONE preview, read back once over both days; both accepted and stamped',
    t03Args(t.h, 'preview_product_cost_changes').length === 1
      && t03Canon(t03Args(t.h, 'preview_product_cost_changes')[0].rows) === t03Canon([
        { sku_article: 'ART-C', date: T03_DAY, cost_price: 233.67, expense: 0 }, { sku_article: 'ART-C', date: '2026-10-10', cost_price: 210.5, expense: 0 }])
      && t03Canon(t03Args(t.h, 'get_product_costs')) === t03Canon([{ shop_id: [2771], date__gte: '2026-10-10', date__lte: T03_DAY, limit: 1000, offset: 0 }])
      && t.res.accepted.length === 2 && t.after.every((r) => r['Статус КАН'] === T03_OK && r['Выгружено в КАН'] === T03_TIME + ' tester'),
    JSON.stringify(t.after.map(t03State)));

  // A combined shipment: three journal rows of one day, the last one wins, every row gets the status and the stamp.
  t = t03Run([t03Row(T03_DAY, 'MaxiStore', 'ART-C', 231, 'op-1'), t03Row(T03_DAY, 'MaxiStore', 'ART-C', 232.5, 'op-2'), t03Row(T03_DAY, 'MaxiStore', 'ART-C', 233.67, 'op-3')]);
  check('93/03 D: a combined shipment (3 rows, one day) sends ONE row with the last figure; every row gets the status and the stamp; the answer lists the 3 OpIDs',
    t03Args(t.h, 'preview_product_cost_changes')[0].rows.length === 1 && t03Args(t.h, 'preview_product_cost_changes')[0].rows[0].cost_price === 233.67
      && t.after.every((r) => t03Accepted(r, 'КАН принял 233,67', T03_TIME + ' tester'))
      && t03Canon(t.res.accepted[0].opIds) === t03Canon(['op-1', 'op-2', 'op-3']),
    JSON.stringify(t.after.map(t03State)));

  // 201 groups: 200 + 1, the read-back pages, the sheet is written in a few blocks, not row by row.
  const many = [];
  for (let i = 1; i <= 201; i++) many.push(t03Row(T03_DAY, 'MaxiStore', 'ART-' + i, 10 + i, 'op-' + i));
  t = t03Setup(many, { pageSize: 100 });
  t.h.getRegistrySheet('Себестоимость Озон').__resetSetValuesCallCount();
  t.res = t.h.sendOzonCostToKan('tester');
  t.after = t.h.dumpOzonCostFull();
  const batchSizes = t03Args(t.h, 'preview_product_cost_changes').map((a) => a.rows.length);
  check('93/03 D: 201 groups go as batches of 200 and 1 (two previews, two applies), read back in 3 pages; all accepted',
    batchSizes.join() === '200,1' && t03Args(t.h, 'apply_product_cost_changes').length === 2
      && t03Args(t.h, 'get_product_costs').map((a) => a.offset).join() === '0,100,200' && t.h.fetchLog.length === 8
      && t.res.accepted.length === 201 && t.after.every((r) => r['Статус КАН'] === T03_OK),
    `${batchSizes} ${t.h.fetchLog.length} ${t.res.accepted.length}`);
  check('93/03 D: 201 rows are written with 3 sheet writes in all, not one per row',
    t.h.getRegistrySheet('Себестоимость Озон').__getSetValuesCallCount() === 3, String(t.h.getRegistrySheet('Себестоимость Озон').__getSetValuesCallCount()));

  // Two cabinets: one shop id per batch.
  t = t03Run([t03One(), t03Row(T03_DAY, 'Mercurius', 'ART-M', 85, 'op-m')]);
  check('93/03 D: two cabinets are two previews, each naming ONE shop; both accepted',
    t03Args(t.h, 'preview_product_cost_changes').map((a) => a.shop_id.join()).sort().join('|') === '1765|2771'
      && t.res.accepted.length === 2 && t.kan.entries(1765).length === 1 && t.kan.entries(2771).length === 1,
    JSON.stringify(t03Args(t.h, 'preview_product_cost_changes')));
  t = t03Run([t03One(), t03Row(T03_DAY, 'Mercurius', 'ART-M', 85, 'op-m')], { previewFailShop: 1765 });
  check('93/03 D: a 500 for one shop does not stop the other: Mercurius fails, MaxiStore is accepted and stamped',
    t03IsError(t.after[1], 'КАН недоступен') && t03Accepted(t.after[0], 'КАН принял 233,67', T03_TIME + ' tester')
      && t.res.accepted.length === 1 && t.res.failed.length === 1,
    JSON.stringify(t.after.map(t03State)));
  // list_shops and both writes succeed, but the read-back of ONE shop fails: that shop's row is an error, the other shop is accepted.
  t = t03Run([t03One(), t03Row(T03_DAY, 'Mercurius', 'ART-M', 85, 'op-m')], { readFailShop: 1765 });
  check('93/03 D: when the read-back of one shop fails, that shop\'s row is «КАН недоступен» and not stamped (KAN did get the write); the other shop is accepted and stamped',
    t03IsError(t.after[1], 'КАН недоступен') && t03Accepted(t.after[0], 'КАН принял 233,67', T03_TIME + ' tester')
      && t.res.accepted.length === 1 && t.res.failed.length === 1 && t.kan.entries(1765).length === 1 && t.kan.entries(2771).length === 1,
    JSON.stringify(t.after.map(t03State)));
})();

(function test93s03StatusRules() {
  let t = t03Run([t03One({ status: 'вручную' })]);
  check('93/03 E: a «вручную» row is not sent, is counted, and is left as it is',
    t.h.fetchLog.length === 0 && t.res.skippedManual === 1 && t.res.accepted.length === 0 && t.res.failed.length === 0
      && t03Canon(t.after) === t03Canon(t.before),
    JSON.stringify(t.res));
  t = t03Run([t03One({ exported: T03_OLD_STAMP })]);
  check('93/03 E: a legacy row (no status, but stamped by the CSV button) is not sent and not touched',
    t.h.fetchLog.length === 0 && t.res.skippedManual === 0 && t03Canon(t.after) === t03Canon(t.before), JSON.stringify(t.res));
  t = t03Run([t03One({ status: T03_ERR, answer: 'КАН недоступен', time: '2026-10-13 09:00:00' }), t03Row(T03_DAY, 'MaxiStore', 'ART-S', 40, 'op-2', { status: T03_SENDING, time: '2026-10-13 09:00:00' })]);
  check('93/03 E: rows left «ошибка» or «отправляется» by an earlier run are sent again and accepted',
    t.res.accepted.length === 2 && t.after.every((r) => t03Accepted(r, r['Артикул'] === 'ART-C' ? 'КАН принял 233,67' : 'КАН принял 40,00', T03_TIME + ' tester')),
    JSON.stringify(t.after.map(t03State)));
  // A correction appended after acceptance: the group is pending again; the old stamp stays, the new row is stamped.
  t = t03Run([t03One({ status: T03_OK, answer: 'КАН принял 233,67', time: '2026-10-13 09:00:00', exported: T03_OLD_STAMP }),
    t03Row(T03_DAY, 'MaxiStore', 'ART-C', 235, 'op-1', { source: 'пересчёт после правки прихода' })]);
  check('93/03 E: a correction appended after acceptance sends the new figure (235); the accepted row keeps its stamp, the new row gets one; both rows are «принято»',
    t03Args(t.h, 'preview_product_cost_changes')[0].rows[0].cost_price === 235
      && t03Accepted(t.after[0], 'КАН принял 235,00', T03_OLD_STAMP) && t03Accepted(t.after[1], 'КАН принял 235,00', T03_TIME + ' tester'),
    JSON.stringify(t.after.map(t03State)));
  t = t03Run([t03One({ status: T03_ERR, answer: 'КАН недоступен', time: '2026-10-13 09:00:00', exported: T03_OLD_STAMP })]);
  check('93/03 E: an existing stamp on an «ошибка» row is never overwritten when the row is accepted',
    t03Accepted(t.after[0], 'КАН принял 233,67', T03_OLD_STAMP), JSON.stringify(t.after[0]));
})();

(function test93s03Deletes() {
  const supply = t03One();
  const marker = t03Marker(T03_DAY, 'ART-C', 'op-1');
  const inKan = { entries: { 2771: [{ article: 'ART-C', date: T03_DAY, cost: 233.67 }] } };
  let t = t03Setup([supply, marker], inKan);
  const entryId = t.kan.store[2771][0].id;
  t.res = t.h.sendOzonCostToKan('tester');
  t.after = t.h.dumpOzonCostFull();
  check('93/03 F: a drop marker is a KAN delete: pre-read, preview {operation: delete, entry_id}, apply, read-back — and the entry is gone',
    t03Names(t.h).join(',') === 'list_shops,get_product_costs,preview_product_cost_changes,apply_product_cost_changes,get_product_costs'
      && t03Canon(t03Args(t.h, 'preview_product_cost_changes')[0]) === t03Canon({ operation: 'delete', entry_id: entryId })
      && t.kan.entries(2771).length === 0 && t.kan.writes === 1,
    t03Names(t.h).join(','));
  check('93/03 F: the deleted day is «принято» ("КАН: запись удалена"), cost null in the answer; neither the marker nor the supply row of the group is stamped',
    t03Accepted(t.after[1], 'КАН: запись удалена', '') && t03Accepted(t.after[0], 'КАН: запись удалена', '')
      && t.res.accepted[0].action === 'delete' && t.res.accepted[0].cost === null,
    JSON.stringify(t.after.map(t03State)));

  t = t03Run([supply, marker]);
  check('93/03 F: when KAN has no entry for the day nothing is deleted: no preview, no apply — the day is accepted ("КАН: записи не было")',
    t03Names(t.h).join(',') === 'list_shops,get_product_costs,get_product_costs'
      && t03Accepted(t.after[1], 'КАН: записи не было', '') && t.res.accepted.length === 1,
    t03Names(t.h).join(','));
  t = t03Run([supply, marker], { entries: { 2771: [{ article: 'ART-C', date: T03_DAY, cost: 200 }, { article: 'ART-C', date: T03_DAY, cost: 210 }] } });
  check('93/03 F: two KAN entries for the day are never deleted — an error, no preview, no apply',
    t03IsError(t.after[1], 'в КАН несколько записей на эту дату') && t03Names(t.h).join(',') === 'list_shops,get_product_costs,get_product_costs'
      && t.kan.entries(2771).length === 2,
    t03Names(t.h).join(','));
  t = t03Run([supply, marker], Object.assign({ lostWrite: true }, inKan));
  check('93/03 F: KAN says the delete is applied but still holds the entry — «запись в КАН не удалена»',
    t03IsError(t.after[1], 'запись в КАН не удалена'), JSON.stringify(t.after[1]));
  // A delete group whose EARLIER row was stamped by the CSV button: the old stamp stays, the marker gets none, nothing new is stamped.
  t = t03Setup([t03One({ exported: T03_OLD_STAMP }), marker], inKan);
  t.res = t.h.sendOzonCostToKan('tester');
  t.after = t.h.dumpOzonCostFull();
  check('93/03 F: a delete group with an earlier CSV-stamped row is accepted; the old stamp stays as it was and the marker gets no stamp',
    t.res.accepted.length === 1 && t.res.accepted[0].action === 'delete' && t.kan.entries(2771).length === 0
      && t03Accepted(t.after[0], 'КАН: запись удалена', T03_OLD_STAMP) && t03Accepted(t.after[1], 'КАН: запись удалена', ''),
    JSON.stringify(t.after.map(t03State)));
  // The pre-read of a delete fails (the first get_product_costs): nothing is deleted, the group is an error, the entry is still in KAN.
  t = t03Run([supply, marker], Object.assign({ readFailNth: 1 }, inKan));
  check('93/03 F: when the pre-read of a delete fails nothing is deleted: no preview, no apply, both rows «КАН недоступен» and unstamped, the entry stays in KAN',
    t03Names(t.h).join(',') === 'list_shops,get_product_costs,get_product_costs'
      && t03IsError(t.after[0], 'КАН недоступен') && t03IsError(t.after[1], 'КАН недоступен') && t.kan.entries(2771).length === 1 && t.res.failed.length === 1,
    t03Names(t.h).join(',') + ' ' + JSON.stringify(t.after.map(t03State)));
  // A marker followed by a re-stated row of the same day is an UPSERT group: the marker row is never stamped, the other two are.
  t = t03Run([supply, marker, t03Row(T03_DAY, 'MaxiStore', 'ART-C', 240, 'op-2', { source: 'пересчёт после удаления отгрузки' })]);
  check('93/03 F: a day whose last row is a re-stated figure (after a marker) is an upsert; the marker row of that day is never stamped, the other rows are',
    t03Args(t.h, 'preview_product_cost_changes')[0].rows[0].cost_price === 240
      && t.after[0]['Выгружено в КАН'] === T03_TIME + ' tester' && t.after[1]['Выгружено в КАН'] === '' && t.after[2]['Выгружено в КАН'] === T03_TIME + ' tester'
      && t.after.every((r) => r['Статус КАН'] === T03_OK),
    JSON.stringify(t.after.map(t03State)));
  // A delete and an upsert in one shop, and an upsert-only shop makes no pre-read.
  t = t03Run([t03Row(T03_DAY, 'MaxiStore', 'ART-A', 50, 'op-a'), t03Marker(T03_DAY, 'ART-A', 'op-a'), t03Row(T03_DAY, 'MaxiStore', 'ART-B', 60, 'op-b')],
    { entries: { 2771: [{ article: 'ART-A', date: T03_DAY, cost: 50 }] } });
  check('93/03 F: a delete and an upsert of one shop: pre-read, delete, upsert, one read-back; the deleted article is gone and the other is written',
    t03Names(t.h).join(',') === 'list_shops,get_product_costs,preview_product_cost_changes,apply_product_cost_changes,preview_product_cost_changes,apply_product_cost_changes,get_product_costs'
      && t03Canon(t.kan.entries(2771)) === t03Canon([{ article: 'ART-B', date: T03_DAY, cost: 60 }])
      && t.res.accepted.length === 2 && t.after[2]['Выгружено в КАН'] === T03_TIME + ' tester' && t.after[0]['Выгружено в КАН'] === '' && t.after[1]['Выгружено в КАН'] === '',
    t03Names(t.h).join(','));
})();

(function test93s03Concurrency() {
  const lease = (h) => h.getScriptProperty('kan_costSenderUntil');
  // A live lease: busy, nothing sent, nothing written, the lease untouched.
  let t = t03Setup([t03One()]);
  const live = String(Date.parse(T03_NOW) + 300000);
  t.h.setScriptProperty('kan_costSenderUntil', live);
  let frozen = t03Canon(t.h.dumpOzonCostFull());
  let res = t.h.sendOzonCostToKan('tester');
  check('93/03 G: while another sender holds the lease the answer is busy «уже отправляется», no request, the sheet and the lease are untouched',
    res.busy === true && res.message === 'уже отправляется' && res.accepted.length === 0 && res.failed.length === 0
      && t.h.fetchLog.length === 0 && t03Canon(t.h.dumpOzonCostFull()) === frozen && lease(t.h) === live,
    JSON.stringify(res));
  // An expired lease is taken over, and the property is gone afterwards.
  t = t03Setup([t03One()]);
  t.h.setScriptProperty('kan_costSenderUntil', String(Date.parse(T03_NOW) - 1));
  res = t.h.sendOzonCostToKan('tester');
  check('93/03 G: an expired lease (a sender that died) is taken over and the lease is deleted afterwards',
    res.busy === false && res.accepted.length === 1 && lease(t.h) === null, JSON.stringify([res.busy, lease(t.h)]));
  // The table lock is busy.
  t = t03Setup([t03One()]);
  t.h.setScriptLockBusy(true);
  frozen = t03Canon(t.h.dumpOzonCostFull());
  res = t.h.sendOzonCostToKan('tester');
  check('93/03 G: when the table lock cannot be taken the answer is busy «таблица занята, отправка позже», no request, no lease left',
    res.busy === true && res.message === 'таблица занята, отправка позже' && t.h.fetchLog.length === 0
      && t03Canon(t.h.dumpOzonCostFull()) === frozen && lease(t.h) === null && !t.h.isScriptLockHeld(),
    JSON.stringify(res));
  // A throw inside the run frees the lease: the status columns are out of order, which the writer refuses.
  const odd = ['Статус КАН', 'Время КАН', 'Ответ КАН'];
  t = t03Setup([t03One()]);
  t.h.setOzonCostSheet([t03One()], t.h.OZON_COST_HEADERS.concat(odd));
  let thrown = '';
  try { t.h.sendOzonCostToKan('tester'); } catch (e) { thrown = String(e.message || e); }
  check('93/03 G: when the run throws (the status columns are not side by side) the error is Russian, nothing was sent to KAN, and the lease and the lock are freed',
    thrown.indexOf('должны идти подряд') !== -1 && t03Args(t.h, 'preview_product_cost_changes').length === 0
      && lease(t.h) === null && !t.h.isScriptLockHeld(),
    thrown + ' ' + t03Names(t.h).join(','));
  // Only the owner of a lease frees it.
  t = t03Setup([t03One()]);
  t.h.setScriptProperty('kan_costSenderUntil', 'someone-else');
  t.h.releaseKanCostLease('my-token');
  const kept = lease(t.h) === 'someone-else';
  t.h.releaseKanCostLease('someone-else');
  check('93/03 G: releasing a lease deletes it only if it still carries our token', kept && lease(t.h) === null, String(lease(t.h)));
})();

(function test93s03Sheet() {
  // The sheet of an older version has 12 columns: it grows to 15, the first 12 byte for byte.
  let t = t03Run([t03One(), t03Row(T03_DAY, 'MaxiStore', 'ART-X', 50, 'op-x', { exported: T03_OLD_STAMP })], {}, 'tester', true);
  let res;
  const headerRow = t.h.headerRowOf(t.h.getRegistrySheet('Себестоимость Озон'));
  check('93/03 H: a 12-column journal gets «Статус КАН», «Ответ КАН», «Время КАН» at the END (columns 13-15); columns 1-10 and 12 stay byte for byte',
    headerRow.length === 15 && headerRow.slice(12).join('|') === 'Статус КАН|Ответ КАН|Время КАН' && headerRow.slice(0, 12).join('|') === t.h.OZON_COST_HEADERS.join('|')
      && t.after.every((r, i) => t03Fixed(r) === t03Fixed(t.before[i])) && t03Accepted(t.after[0], 'КАН принял 233,67', T03_TIME + ' tester'),
    headerRow.join('|'));

  // 'отправляется' is visible while KAN is being called.
  let seen = null;
  t = t03Setup([t03One()], { onCall: (name) => { if (name === 'apply_product_cost_changes') seen = t03State(t.h.dumpOzonCostFull()[0]); } });
  t.h.sendOzonCostToKan('tester');
  check('93/03 H: during apply the row already reads «отправляется» with the time, no answer and no stamp',
    t03Canon(seen) === t03Canon([T03_SENDING, '', T03_TIME, '']), JSON.stringify(seen));

  // A row changed while KAN was working is not written; the next run sends the new figure.
  const sheetOf = () => t.h.getRegistrySheet('Себестоимость Озон');
  t = t03Setup([t03One()], { onCall: (name, args, st) => {
    if (name === 'apply_product_cost_changes' && !st.edited) { st.edited = true; sheetOf().getRange(2, 9).setValue(240); }
  } });
  res = t.h.sendOzonCostToKan('tester');
  let row = t.h.dumpOzonCostFull()[0];
  check('93/03 H: a row whose figure changed during the run is not written (notWritten 1): it stays «отправляется» and unstamped',
    res.notWritten === 1 && row['Статус КАН'] === T03_SENDING && row['Выгружено в КАН'] === '' && row['Себестоимость после'] === 240,
    JSON.stringify([res.notWritten, t03State(row)]));
  check('93/03 H: that group is reported as failed («журнал изменился во время отправки — отправится снова»), never as accepted',
    res.accepted.length === 0 && res.failed.length === 1 && res.failed[0].reason === 'журнал изменился во время отправки — отправится снова',
    JSON.stringify([res.accepted, res.failed]));
  const second = t.h.sendOzonCostToKan('tester');
  row = t.h.dumpOzonCostFull()[0];
  check('93/03 H: the next run sends the changed figure (240) and accepts it',
    second.accepted.length === 1 && t03Accepted(row, 'КАН принял 240,00', T03_TIME + ' tester') && t.kan.entries(2771)[0].cost === 240, JSON.stringify(t03State(row)));

  // A row deleted above ours during the run shifts the row numbers: nothing is written at the old place.
  t = t03Setup([t03Row('2026-09-02', 'Mercurius', 'ART-M', 85, 'op-m', { exported: T03_OLD_STAMP, status: T03_OK }), t03One(), t03Row(T03_DAY, 'MaxiStore', 'ART-Y', 70, 'op-y', { exported: T03_OLD_STAMP })], { onCall: (name, args, st) => {
    if (name === 'apply_product_cost_changes' && !st.shifted) { st.shifted = true; sheetOf().deleteRow(2); }
  } });
  res = t.h.sendOzonCostToKan('tester');
  const shifted = t.h.dumpOzonCostFull();
  check('93/03 H: when a row above ours is deleted during the run, the rows that moved are not written over (notWritten 1) and no other row is stamped',
    res.notWritten === 1 && shifted.length === 2 && shifted[0]['Артикул'] === 'ART-C' && shifted[0]['Статус КАН'] === T03_SENDING && shifted[0]['Выгружено в КАН'] === ''
      && shifted[1]['Артикул'] === 'ART-Y' && shifted[1]['Статус КАН'] === '' && shifted[1]['Выгружено в КАН'] === T03_OLD_STAMP,
    JSON.stringify([res.notWritten, shifted.map(t03State)]));

  // A row appended during the run is never touched, and is sent by the next run.
  t = t03Setup([t03One()], { onCall: (name, args, st) => {
    if (name === 'apply_product_cost_changes' && !st.appended) { st.appended = true; sheetOf().getRange(3, 1, 1, 12).setValues([t03Row(T03_DAY, 'MaxiStore', 'ART-C', 250, 'op-1', { source: 'пересчёт после правки прихода' })]); }
  } });
  res = t.h.sendOzonCostToKan('tester');
  const appended = t.h.dumpOzonCostFull()[1];
  check('93/03 H: a row appended during the run is not touched (no status, no stamp) and does not count as unwritten',
    res.notWritten === 0 && t03Canon(t03State(appended)) === t03Canon(['', '', '', '']) && appended['Себестоимость после'] === 250 && t.h.dumpOzonCostFull()[0]['Статус КАН'] === T03_OK,
    JSON.stringify(t.h.dumpOzonCostFull().map(t03State)));
  const next = t.h.sendOzonCostToKan('tester');
  check('93/03 H: the next run sends the appended figure (250); the first row keeps its stamp, the appended row gets one',
    next.accepted.length === 1 && t.kan.entries(2771)[0].cost === 250
      && t03Accepted(t.h.dumpOzonCostFull()[1], 'КАН принял 250,00', T03_TIME + ' tester') && t.h.dumpOzonCostFull()[0]['Выгружено в КАН'] === T03_TIME + ' tester',
    JSON.stringify(t.h.dumpOzonCostFull().map(t03State)));

  // Rows of other hands between ours are written back as they were (a Date in «Время КАН», an old stamp).
  // The Date must come from the harness that reads it (an instance of another harness's FakeDate is no `Date` to the code under test).
  t = t03Setup([]);
  const dateCell = new t.h.FakeDate(Date.parse('2026-09-02T07:00:00Z'));
  t.h.setOzonCostSheet([t03One(), t03Row('2026-09-02', 'Mercurius', 'ART-M', 85, 'op-m', { exported: T03_OLD_STAMP, status: T03_OK, answer: 'КАН принял 85,00', time: dateCell }),
    t03Row(T03_DAY, 'MaxiStore', 'ART-Y', 70, 'op-y')], t.h.OZON_COST_HEADERS.concat(t.h.OZON_COST_KAN_HEADERS));
  const between = t.h.dumpOzonCostFull()[1];
  t.h.sendOzonCostToKan('tester');
  const afterBetween = t.h.dumpOzonCostFull();
  // Item 93 ticket 04: a Date cell of another hand comes back as the TEXT of the same moment (the column is text now).
  check('93/03 H: a row between two rows of ours (accepted by hand earlier, a Date in «Время КАН», an old stamp) comes out of the two block writes as it went in — its time as the text of the same moment',
    t03Canon(afterBetween[1]) === t03Canon(Object.assign({}, between, { 'Время КАН': '2026-09-02 10:00:00' })) && afterBetween[1]['Время КАН'] === '2026-09-02 10:00:00'
      && t03Accepted(afterBetween[0], 'КАН принял 233,67', T03_TIME + ' tester') && t03Accepted(afterBetween[2], 'КАН принял 70,00', T03_TIME + ' tester'),
    JSON.stringify(afterBetween.map(t03State)));

  // appendOzonCostForShipment writes 12-wide rows into the 15-wide sheet (strict setValues in the stand), and the new row reads as unsent.
  const wide = t03Setup([t03One({ status: T03_OK, answer: 'КАН принял 233,67', time: T03_TIME, exported: T03_OLD_STAMP })]);
  wide.h.setOzonStocksSheet([{ cabinet: 'MaxiStore', article: 'ART-C', available: 300 }]);
  const written = wide.h.appendOzonCostForShipment([{ article: 'ART-C', quantity: 100, price: 300, status: 'ok' }], 'Ozon (MaxiStore)', '2026-10-14T09:00:00Z', 'op-new', 'tester');
  const journal = wide.h.getOzonCostJournal();
  const grouped = wide.h.collectOzonCostKanGroups(journal);
  check('93/03 H: appendOzonCostForShipment still appends a row to the 15-column sheet; the new row has no KAN status and is pending',
    written.written === 1 && journal.length === 2 && journal[1].kanStatus === '' && journal[1].exported === ''
      && grouped.pending.length === 1 && grouped.pending[0].date === '2026-10-14' && grouped.pending[0].opIds.join() === 'op-new',
    JSON.stringify([written, journal[1], grouped.pending.length]));
})();

(function test93s03DoPost() {
  const withSessions = (t) => t.h.setRegistrySheet('Сессии', [['Token', 'Username', 'Role', 'ExpiresAt'],
    ['tok-user', 'Кладовщик', 'user', String(Date.parse('2030-01-01T00:00:00Z'))], ['tok-admin', 'boss', 'admin', String(Date.parse('2030-01-01T00:00:00Z'))]]);
  // The dev-mode copy of the sheet must never be sent to the real KAN.
  let t = t03Setup([t03One()]);
  withSessions(t);
  let out = t.h.callDoPost({ action: 'sendOzonCostToKan', sessionToken: 'tok-admin', devMode: true });
  check('93/03 I: in dev mode doPost refuses with the Russian message and makes no request',
    out.status === 'error' && out.message.indexOf('Отправка себестоимости в КАН недоступна в режиме разработки') !== -1 && t.h.fetchLog.length === 0,
    JSON.stringify(out));
  t.h.vm.runInContext('_devModeSpreadsheet = ({})', t.h.context);
  let direct = '';
  try { t.h.sendOzonCostToKan('boss'); } catch (e) { direct = String(e.message || e); }
  t.h.vm.runInContext('_devModeSpreadsheet = null', t.h.context);
  check('93/03 I: the sender itself refuses too when the dev-mode spreadsheet is set',
    direct.indexOf('недоступна в режиме разработки') !== -1 && t.h.fetchLog.length === 0 && t.h.getScriptProperty('kan_costSenderUntil') === null, direct);

  // A normal call by any signed-in user runs outside the global lock.
  t = t03Setup([t03One()]);
  withSessions(t);
  out = t.h.callDoPost({ action: 'sendOzonCostToKan', sessionToken: 'tok-user' });
  check('93/03 I: a signed-in user\'s call returns success with the groups, outside the global lock (no 10 s waitLock, no request made under a lock)',
    out.status === 'success' && out.data.accepted.length === 1 && out.data.accepted[0].article === 'ART-C'
      && t.h.waitLockTimeouts().indexOf(10000) === -1 && t.h.fetchesWhileLocked() === 0 && t.h.nestedLockTakes() === 0,
    JSON.stringify([out.status, t.h.waitLockTimeouts(), t.h.fetchesWhileLocked()]));
  t = t03Setup([t03One()]);
  withSessions(t);
  out = t.h.callDoPost({ action: 'sendOzonCostToKan', sessionToken: 'nobody' });
  check('93/03 I: without a valid session nothing is sent', out.status === 'error' && t.h.fetchLog.length === 0, JSON.stringify(out));
})();

// ================= Item 93 ticket 04: the watch trigger and the «Отправлю сам» switch =================
// kanCostWatch runs every 15 minutes: it gives a never-seen row its first-seen time, looks rows switched to
// «вручную» up in KAN (15/30/45/60 min after the switch) and re-sends «ошибка» / «отправляется» rows (and
// unsent rows older than 5 min) whose last attempt is 60 min old. The clock is faked with setNow; minute 0 is
// the stand's 2026-10-14 13:00:00 in the script zone. Fixture: MaxiStore / ART-C on 2026-10-13 at 233.67.

const T04_MANUAL = 'вручную';
const T04_WAIT = 'ждём файл в КАН';
const T04_BY_HAND = ' загружено вручную';
const t04Iso = (min) => new Date(Date.parse(T03_NOW) + min * 60000).toISOString();
const t04Text = (min) => new Date(Date.parse(T03_NOW) + (min * 60 + 3 * 3600) * 1000).toISOString().slice(0, 19).replace('T', ' ');
// A group switched to manual at minute 0 (the 3 KAN columns hold «вручную» / the wait text / the switch time).
const t04Manual = (extra) => t03One(Object.assign({ status: T04_MANUAL, answer: T04_WAIT, time: T03_TIME }, extra || {}));
// Moves the clock to `minutes`, runs the watch and records what it asked KAN and what the sheet holds now.
function t04Go(t, minutes) {
  t.h.setNow(t04Iso(minutes));
  const from = t.h.fetchLog.length;
  t.res = t.h.kanCostWatch();
  t.calls = t.h.fetchLog.slice(from).map((f) => f.body.params.name);
  t.after = t.h.dumpOzonCostFull();
  return t;
}
const t04Sheet = (t) => t03Canon(t.h.dumpOzonCostFull());
// «Статус КАН» / «Ответ КАН» / «Время КАН» / «Выгружено в КАН» of a row are exactly these.
const t04Is = (row, status, answer, time, stamp) => t03Canon(t03State(row)) === t03Canon([status, answer, time, stamp]);
// KAN already holds this figure (a file the owner uploaded by hand).
const t04KanHolds = (t, shopId, article, date, cost) => {
  (t.kan.store[shopId] = t.kan.store[shopId] || []).push({ id: 7000 + (t.kan.idSeq++), productId: 70000, article: article, date: date, cost: cost });
};
const T04_READ = { shop_id: [2771], date__gte: T03_DAY, date__lte: T03_DAY, limit: 1000, offset: 0 };
const T04_LOOKUP = 'list_shops,get_product_costs';

(function test93s04Pure() {
  const h = freshHarness();
  const journal = h.ozonCostRowsFromValues([h.OZON_COST_HEADERS.concat(h.OZON_COST_KAN_HEADERS),
    t03Row(T03_DAY, 'MaxiStore', 'E-old', 1, 'o1', { status: T03_ERR, time: '2026-10-14 11:59:59' }),
    t03Row(T03_DAY, 'MaxiStore', 'E-new', 1, 'o2', { status: T03_ERR, time: '2026-10-14 12:00:01' }),
    t03Row(T03_DAY, 'MaxiStore', 'S-old', 1, 'o3', { status: T03_SENDING, time: '2026-10-14 12:00:00' }),
    t03Row(T03_DAY, 'MaxiStore', 'N-none', 1, 'o4'),
    t03Row(T03_DAY, 'MaxiStore', 'N-old', 1, 'o5', { status: '', time: '2026-10-14 12:54:59' }),
    t03Row(T03_DAY, 'MaxiStore', 'N-young', 1, 'o6', { status: '', time: '2026-10-14 12:55:01' }),
    t03Row(T03_DAY, 'MaxiStore', 'N-csv', 1, 'o7', { exported: T03_OLD_STAMP }),
    t03Row(T03_DAY, 'MaxiStore', 'E-junk', 1, 'o8', { status: T03_ERR, time: 'вчера' }),
    t03Row(T03_DAY, 'MaxiStore', 'M-1', 7, 'o9', { status: T04_MANUAL, time: '2026-10-14 12:30:00' }),
    t03Row('2026-10-11', 'MaxiStore', 'M-2', 8, 'o10', { status: T04_MANUAL, time: '2026-10-14 12:31:00' })]);
  const cut = { retry: '2026-10-14 12:00:00', fresh: '2026-10-14 12:55:00' };
  const withCut = h.collectOzonCostKanGroups(journal, cut);
  check('93/04 pure: with cut-offs «ошибка» / «отправляется» is pending only when its time is at or before the retry cut-off (a time that is not yyyy-MM-dd HH:mm:ss counts as old)',
    withCut.pending.map((g) => g.article).filter((a) => /^[ES]-/.test(a)).join() === 'E-old,S-old,E-junk', withCut.pending.map((g) => g.article).join());
  check('93/04 pure: with cut-offs an unsent row is pending only when its time is at or before the fresh cut-off; no time at all goes to `unseen` (last row, not sent); a CSV-stamped row is neither',
    withCut.pending.map((g) => g.article).filter((a) => a[0] === 'N').join() === 'N-old' && withCut.unseen.map((g) => g.article).join() === 'N-none'
      && withCut.unseen[0].rows.length === 1, withCut.pending.map((g) => g.article).join() + ' | ' + withCut.unseen.map((g) => g.article).join());
  check('93/04 pure: «вручную» groups come back in `manual` with action, cost and the switch time, are counted in skippedManual, and are never pending',
    t03Canon(withCut.manual.map((g) => [g.article, g.date, g.action, g.cost, g.lastTime])) === t03Canon([['M-1', T03_DAY, 'upsert', 7, '2026-10-14 12:30:00'], ['M-2', '2026-10-11', 'upsert', 8, '2026-10-14 12:31:00']])
      && withCut.skippedManual === 2 && withCut.pending.every((g) => g.article[0] !== 'M'), JSON.stringify(withCut.manual.map((g) => g.article)));
  const noCut = h.collectOzonCostKanGroups(journal);
  check('93/04 pure: without cut-offs the age is ignored — every unsent, «отправляется» and «ошибка» group is pending and nothing is unseen',
    noCut.pending.map((g) => g.article).join() === 'E-old,E-new,S-old,N-none,N-old,N-young,E-junk' && noCut.unseen.length === 0 && noCut.skippedManual === 2,
    noCut.pending.map((g) => g.article).join());
})();

(function test93s04ManualChecks() {
  // The group is not due before 15 min: no request, no write, and not even a lock or a lease.
  let t = t03Setup([t04Manual()]);
  let locks = t.h.lockRequests();
  let frozen = t04Sheet(t);
  t04Go(t, 14);
  check('93/04 A: 14 min after the switch the watch makes no request, writes nothing and takes neither the lease nor a lock',
    t.calls.length === 0 && t04Sheet(t) === frozen && t.h.lockRequests() === locks && t.h.getScriptProperty('kan_costSenderUntil') === null && t.res.idle === true,
    JSON.stringify([t.calls, t.res]));

  // 15 / 30 / 45: one list_shops and ONE read each; the row stays «вручную» byte for byte.
  [15, 30, 45].forEach((min) => {
    t04Go(t, min);
    check('93/04 A: ' + min + ' min after the switch KAN is read once (list_shops, one read over the day); the row stays «вручную» and the sheet is untouched',
      t.calls.join() === T04_LOOKUP && t03Canon(t03Args(t.h, 'get_product_costs').slice(-1)[0]) === t03Canon(T04_READ) && t04Sheet(t) === frozen
        && t.res.manualAccepted === 0 && t.res.manualMissed === 0 && t.h.getScriptProperty('kan_costSenderUntil') === null,
      JSON.stringify([t.calls, t.res]));
  });
  check('93/04 A: the checks never write to KAN and need nothing but reads (3 checks = 3 list_shops + 3 reads)',
    t.h.fetchLog.length === 6 && t.kan.writes === 0 && t.kan.previewCount === 0 && t.h.fetchesWhileLocked() === 0, String(t.h.fetchLog.length));

  // 60: the 4th miss turns the row into an error, unstamped; the sheet columns 1-12 stay byte for byte.
  const before = t.h.dumpOzonCostFull();
  t04Go(t, 60);
  check('93/04 A: 60 min after the switch a miss makes the row «ошибка» / «в КАН не найдено» with the time of the check, NOT stamped; columns 1-12 byte for byte',
    t.calls.join() === T04_LOOKUP && t04Is(t.after[0], T03_ERR, 'в КАН не найдено', t04Text(60), '') && t03Fixed(t.after[0]) === t03Fixed(before[0])
      && t.res.manualMissed === 1 && t.res.manualAccepted === 0,
    JSON.stringify([t.calls, t03State(t.after[0]), t.res]));

  // Back on the normal hourly retry: nothing for 59 min after the error, then the re-send, stamped «автоотправка».
  frozen = t04Sheet(t);
  t04Go(t, 75);
  const quiet75 = t.calls.length === 0 && t04Sheet(t) === frozen;
  t04Go(t, 119);
  check('93/04 A: after the miss the row waits for the hourly retry — 15 and 59 min later nothing is asked and nothing is written',
    quiet75 && t.calls.length === 0 && t04Sheet(t) === frozen, JSON.stringify(t.calls));
  t04Go(t, 120);
  check('93/04 A: 60 min after the miss the row is sent by the normal retry (4 requests) and accepted with the «автоотправка» stamp',
    t.calls.join() === 'list_shops,preview_product_cost_changes,apply_product_cost_changes,get_product_costs'
      && t04Is(t.after[0], T03_OK, 'КАН принял 233,67', t04Text(120), t04Text(120) + ' автоотправка') && t.res.accepted === 1 && t.res.failed === 0,
    JSON.stringify([t.calls, t03State(t.after[0]), t.res]));

  // Found as soon as the file is in KAN: «принято», the answer says it was by hand, the stamp too.
  t = t03Setup([t04Manual()]);
  t04Go(t, 15);
  t04KanHolds(t, 2771, 'ART-C', T03_DAY, 233.67);
  const beforeFound = t.h.dumpOzonCostFull();
  t04Go(t, 30);
  check('93/04 B: found at the 30-min check — «принято», «КАН принял 233,67 (загружено вручную)», the time of the check, the stamp «время загружено вручную»; columns 1-12 byte for byte; nothing written to KAN',
    t.calls.join() === T04_LOOKUP && t04Is(t.after[0], T03_OK, 'КАН принял 233,67 (загружено вручную)', t04Text(30), t04Text(30) + T04_BY_HAND)
      && t03Fixed(t.after[0]) === t03Fixed(beforeFound[0]) && t.res.manualAccepted === 1 && t.kan.writes === 0 && t.kan.previewCount === 0,
    JSON.stringify([t.calls, t03State(t.after[0]), t.res]));
  frozen = t04Sheet(t);
  const requests = t.h.fetchLog.length;
  t04Go(t, 45);
  t04Go(t, 600);
  check('93/04 B: once accepted the row is never touched again — the next runs (even hours later) make no request and the sheet is identical',
    t.h.fetchLog.length === requests && t04Sheet(t) === frozen, String(t.h.fetchLog.length - requests));

  // The manual check reads only: a token without the write scope is enough; the article is case-blind like in the sender.
  t = t03Setup([t04Manual()], { scopes: ['mcp:product_cost:read'] });
  t04KanHolds(t, 2771, 'art-c', T03_DAY, 233.67);
  t04Go(t, 15);
  check('93/04 B: a token with the read scope only still accepts a found row, and the article is matched without regard to case',
    t04Is(t.after[0], T03_OK, 'КАН принял 233,67 (загружено вручную)', t04Text(15), t04Text(15) + T04_BY_HAND), JSON.stringify(t03State(t.after[0])));

  // A figure that differs by one kopeck, or two entries, is not a find.
  t = t03Setup([t04Manual()]);
  t04KanHolds(t, 2771, 'ART-C', T03_DAY, 233.66);
  t04Go(t, 15);
  frozen = t04Sheet(t);
  t04Go(t, 45);
  const stayed = t04Sheet(t) === frozen;
  t04Go(t, 60);
  check('93/04 B: a figure 1 kopeck off (233.66 for 233.67) is not accepted — the row stays «вручную» until the 60-min miss, then «ошибка» / «в КАН не найдено»',
    stayed && t04Is(t.after[0], T03_ERR, 'в КАН не найдено', t04Text(60), ''), JSON.stringify(t03State(t.after[0])));
  t = t03Setup([t04Manual()]);
  t04KanHolds(t, 2771, 'ART-C', T03_DAY, 233.67);
  t04KanHolds(t, 2771, 'ART-C', T03_DAY, 233.67);
  t04Go(t, 15);
  const twoStayed = t03State(t.after[0])[0] === T04_MANUAL;
  t04Go(t, 60);
  check('93/04 B: two KAN entries for the same article and day are not a find either (exactly one counts)',
    twoStayed && t04Is(t.after[0], T03_ERR, 'в КАН не найдено', t04Text(60), ''), JSON.stringify(t03State(t.after[0])));

  // A cabinet KAN does not know: list_shops only, no read; a miss at 60.
  t = t03Setup([t03Row(T03_DAY, 'Ghost', 'ART-G', 50, 'op-g', { status: T04_MANUAL, answer: T04_WAIT, time: T03_TIME })]);
  t04Go(t, 15);
  const ghost15 = t.calls.join() === 'list_shops' && t03State(t.after[0])[0] === T04_MANUAL;
  t04Go(t, 60);
  check('93/04 B: a cabinet KAN does not know is looked up with list_shops only (no read); at 60 min it is «ошибка» / «в КАН не найдено»',
    ghost15 && t.calls.join() === 'list_shops' && t04Is(t.after[0], T03_ERR, 'в КАН не найдено', t04Text(60), ''), JSON.stringify([t.calls, t03State(t.after[0])]));

  // KAN failing: nothing is written before the 60th minute (the next run looks again); at 60 min the group goes back
  // to «ошибка» with KAN's own failure as the reason — never «вручную» for ever (token revoked, KAN down for days).
  t = t03Setup([t04Manual()], { listShops: 'http500' });
  frozen = t04Sheet(t);
  t04Go(t, 15);
  const down15 = t.calls.join() === 'list_shops' && t04Sheet(t) === frozen;
  t04Go(t, 45);
  const down45 = t.calls.join() === 'list_shops' && t04Sheet(t) === frozen;
  t04Go(t, 60);
  check('93/04 B: when list_shops fails nothing is written before 60 min; at 60 min the row is «ошибка» / «КАН недоступен» (KAN\'s own reason), the time of the check, not stamped',
    down15 && down45 && t.calls.join() === 'list_shops' && t04Is(t.after[0], T03_ERR, 'КАН недоступен', t04Text(60), '') && t.res.manualMissed === 1 && t.res.manualAccepted === 0,
    JSON.stringify([down15, down45, t.calls, t03State(t.after[0]), t.res]));
  t = t03Setup([t04Manual()], { readBack: 'http500' });
  frozen = t04Sheet(t);
  t04Go(t, 45);
  const readDown45 = t.calls.join() === T04_LOOKUP && t04Sheet(t) === frozen;
  t04Go(t, 60);
  check('93/04 B: when the read fails nothing is written before 60 min; at 60 min the row is «ошибка» / «КАН недоступен», not stamped',
    readDown45 && t.calls.join() === T04_LOOKUP && t04Is(t.after[0], T03_ERR, 'КАН недоступен', t04Text(60), '') && t.res.manualMissed === 1,
    JSON.stringify([readDown45, t.calls, t03State(t.after[0]), t.res]));
  t = t03Setup([t04Manual()], { listShops: 'http401' });
  t04Go(t, 15);
  const rejected15 = t04Is(t.after[0], T04_MANUAL, T04_WAIT, T03_TIME, '');
  t04Go(t, 60);
  check('93/04 B: a token KAN rejects does not leave the row «вручную»: at 60 min it is «ошибка» / «КАН отверг токен»',
    rejected15 && t04Is(t.after[0], T03_ERR, 'КАН отверг токен', t04Text(60), ''), JSON.stringify(t03State(t.after[0])));
  // After that the normal hourly retry takes the row (here KAN is back).
  t.h.setFetchHandler(fakeKanCost().handler);
  t04Go(t, 119);
  const quietAfterReject = t.calls.length === 0;
  t04Go(t, 120);
  check('93/04 B: after the «ошибка» of an unreadable KAN the hourly retry sends the row 60 min later and it is accepted',
    quietAfterReject && t04Is(t.after[0], T03_OK, 'КАН принял 233,67', t04Text(120), t04Text(120) + ' автоотправка'), JSON.stringify([quietAfterReject, t03State(t.after[0])]));
})();

(function test93s04ManualShops() {
  // Two days of one cabinet and a second cabinet: ONE list_shops, ONE read per shop over the min..max days.
  const manual = { status: T04_MANUAL, answer: T04_WAIT, time: T03_TIME };
  let t = t03Setup([t03Row('2026-10-10', 'MaxiStore', 'ART-C', 210.5, 'op-0', manual), t04Manual(), t03Row(T03_DAY, 'Mercurius', 'ART-M', 85, 'op-m', manual)]);
  t04KanHolds(t, 2771, 'ART-C', T03_DAY, 233.67);
  t04KanHolds(t, 1765, 'ART-M', T03_DAY, 85);
  t04Go(t, 60);
  check('93/04 C: one list_shops, then one read per shop over its own dates (MaxiStore 10-10..10-13, Mercurius 10-13)',
    t.calls.join() === 'list_shops,get_product_costs,get_product_costs'
      && t03Args(t.h, 'get_product_costs').map(t03Canon).sort().join('|') === [
        { shop_id: [2771], date__gte: '2026-10-10', date__lte: T03_DAY, limit: 1000, offset: 0 },
        { shop_id: [1765], date__gte: T03_DAY, date__lte: T03_DAY, limit: 1000, offset: 0 }].map(t03Canon).sort().join('|'),
    JSON.stringify(t03Args(t.h, 'get_product_costs')));
  check('93/04 C: each group gets its own verdict — the day KAN holds and the other cabinet are accepted, the day KAN lacks is «ошибка» at 60 min',
    t04Is(t.after[0], T03_ERR, 'в КАН не найдено', t04Text(60), '') && t04Is(t.after[1], T03_OK, 'КАН принял 233,67 (загружено вручную)', t04Text(60), t04Text(60) + T04_BY_HAND)
      && t04Is(t.after[2], T03_OK, 'КАН принял 85,00 (загружено вручную)', t04Text(60), t04Text(60) + T04_BY_HAND) && t.res.manualAccepted === 2 && t.res.manualMissed === 1,
    JSON.stringify(t.after.map(t03State)));

  // One shop's read failing: before 60 min only that shop's group is left as it was; at 60 min it is «ошибка» / «КАН недоступен».
  t = t03Setup([t04Manual(), t03Row(T03_DAY, 'Mercurius', 'ART-M', 85, 'op-m', manual)], { readFailShop: 1765 });
  t04KanHolds(t, 2771, 'ART-C', T03_DAY, 233.67);
  const before = t.h.dumpOzonCostFull();
  t04Go(t, 15);
  check('93/04 C: when the read of one shop fails, that shop\'s group is left as it was and the other shop\'s group is still accepted',
    t04Is(t.after[0], T03_OK, 'КАН принял 233,67 (загружено вручную)', t04Text(15), t04Text(15) + T04_BY_HAND) && t03Canon(t.after[1]) === t03Canon(before[1]),
    JSON.stringify(t.after.map(t03State)));
  t = t03Setup([t04Manual(), t03Row(T03_DAY, 'Mercurius', 'ART-M', 85, 'op-m', manual)], { readFailShop: 1765 });
  t04KanHolds(t, 2771, 'ART-C', T03_DAY, 233.67);
  t04Go(t, 60);
  check('93/04 C: at 60 min the group of the shop that cannot be read is «ошибка» / «КАН недоступен» (no stamp) while the other shop\'s group is accepted',
    t04Is(t.after[0], T03_OK, 'КАН принял 233,67 (загружено вручную)', t04Text(60), t04Text(60) + T04_BY_HAND)
      && t04Is(t.after[1], T03_ERR, 'КАН недоступен', t04Text(60), '') && t.res.manualAccepted === 1 && t.res.manualMissed === 1,
    JSON.stringify([t.after.map(t03State), t.res]));

  // A combined shipment: every row of the group gets the verdict; the stamp goes on the unstamped rows only.
  const rowsOfGroup = [t03Row(T03_DAY, 'MaxiStore', 'ART-C', 231, 'op-1', manual), t03Row(T03_DAY, 'MaxiStore', 'ART-C', 233.67, 'op-2', Object.assign({ exported: T03_OLD_STAMP }, manual))];
  t = t03Setup(rowsOfGroup);
  t04KanHolds(t, 2771, 'ART-C', T03_DAY, 233.67);
  t04Go(t, 15);
  check('93/04 C: both rows of a two-row group become «принято»; the row without a stamp gets «время загружено вручную», the row with an older stamp keeps it',
    t04Is(t.after[0], T03_OK, 'КАН принял 233,67 (загружено вручную)', t04Text(15), t04Text(15) + T04_BY_HAND)
      && t04Is(t.after[1], T03_OK, 'КАН принял 233,67 (загружено вручную)', t04Text(15), T03_OLD_STAMP), JSON.stringify(t.after.map(t03State)));
})();

(function test93s04Retry() {
  // «ошибка»: nothing before 60 min since the last attempt, then sent and stamped «автоотправка».
  let t = t03Setup([t03One({ status: T03_ERR, answer: 'КАН недоступен', time: T03_TIME })]);
  const frozen = t04Sheet(t);
  const locks = t.h.lockRequests();
  t04Go(t, 59);
  check('93/04 D: an «ошибка» row whose last attempt is 59 min old is not sent: no request, no write, no lock',
    t.calls.length === 0 && t04Sheet(t) === frozen && t.h.lockRequests() === locks, JSON.stringify(t.calls));
  t04Go(t, 60);
  check('93/04 D: at 60 min the «ошибка» row is sent and accepted; the stamp ends with «автоотправка»; columns 1-10 and 12 byte for byte',
    t.calls.join() === 'list_shops,preview_product_cost_changes,apply_product_cost_changes,get_product_costs'
      && t04Is(t.after[0], T03_OK, 'КАН принял 233,67', t04Text(60), t04Text(60) + ' автоотправка') && t.res.accepted === 1 && t.res.failed === 0,
    JSON.stringify([t.calls, t03State(t.after[0])]));

  // «отправляется» (a sender that died) follows the same rule.
  t = t03Setup([t03One({ status: T03_SENDING, time: T03_TIME })]);
  t04Go(t, 59);
  const sending59 = t.calls.length === 0;
  t04Go(t, 60);
  check('93/04 D: a row left «отправляется» is retried by the same 60-min rule',
    sending59 && t04Is(t.after[0], T03_OK, 'КАН принял 233,67', t04Text(60), t04Text(60) + ' автоотправка'), JSON.stringify(t03State(t.after[0])));

  // A failed retry stays an error with the new time (the next retry is 60 min after THAT).
  t = t03Setup([t03One({ status: T03_ERR, answer: 'КАН недоступен', time: T03_TIME })], { preview: 'http500' });
  t04Go(t, 60);
  const failedAt60 = t04Is(t.after[0], T03_ERR, 'КАН недоступен', t04Text(60), '') && t.res.failed === 1;
  const again = t.after;
  t04Go(t, 119);
  check('93/04 D: a retry that fails writes «ошибка» with the new time, and the next attempt is 60 min after that one (nothing at +59 from it)',
    failedAt60 && t.calls.length === 0 && t03Canon(t.after) === t03Canon(again), JSON.stringify(t03State(t.after[0])));

  // The time may be a Date cell (Sheets) or junk typed by hand.
  const withDateCell = (minutes) => {
    const setup = t03Setup([]);
    const cell = new setup.h.FakeDate(Date.parse(t04Iso(minutes)));
    setup.h.setOzonCostSheet([t03One({ status: T03_ERR, answer: 'КАН недоступен', time: cell })], setup.h.OZON_COST_HEADERS.concat(setup.h.OZON_COST_KAN_HEADERS));
    return setup;
  };
  t = withDateCell(-61);
  t04Go(t, 0);
  check('93/04 D: a Date cell in «Время КАН» is read as text: 61 min old means due',
    t.calls.length === 4 && t.after[0]['Статус КАН'] === T03_OK, JSON.stringify([t.calls, t03State(t.after[0])]));
  t = withDateCell(-59);
  t04Go(t, 0);
  check('93/04 D: a Date cell 59 min old is not due',
    t.calls.length === 0 && t.after[0]['Статус КАН'] === T03_ERR, JSON.stringify([t.calls, t03State(t.after[0])]));
  t = t03Setup([t03One({ status: T03_ERR, answer: 'КАН недоступен', time: 'вчера вечером' })]);
  t04Go(t, 0);
  check('93/04 D: a time that is not yyyy-MM-dd HH:mm:ss counts as old, so the row is sent',
    t.calls.length === 4 && t.after[0]['Статус КАН'] === T03_OK, JSON.stringify([t.calls, t03State(t.after[0])]));

  // Accepted and CSV-stamped rows are never touched, however old.
  t = t03Setup([t03One({ status: T03_OK, answer: 'КАН принял 233,67', time: '2026-10-01 10:00:00', exported: T03_OLD_STAMP }),
    t03Row(T03_DAY, 'MaxiStore', 'ART-L', 40, 'op-l', { exported: T03_OLD_STAMP })]);
  const old = t04Sheet(t);
  t04Go(t, 0);
  t04Go(t, 24 * 60);
  check('93/04 D: accepted rows and legacy CSV-stamped rows are never touched — no request, nothing written, not even a first-seen time',
    t.calls.length === 0 && t04Sheet(t) === old && t.res.idle === true, JSON.stringify(t.calls));
})();

(function test93s04Fresh() {
  // A row nobody has seen: the first run writes ONLY the time, on the LAST row of the group, and asks KAN nothing.
  let t = t03Setup([t03Row(T03_DAY, 'MaxiStore', 'ART-C', 231, 'op-1'), t03Row(T03_DAY, 'MaxiStore', 'ART-C', 233.67, 'op-2')]);
  const before = t.h.dumpOzonCostFull();
  t04Go(t, 0);
  check('93/04 E: an unsent row without a time gets the first-seen time on the LAST row of its group only (status and answer empty), and KAN is not asked',
    t.calls.length === 0 && t04Is(t.after[0], '', '', '', '') && t04Is(t.after[1], '', '', t04Text(0), '') && t.res.firstSeen === 1
      && t.after.every((r, i) => t03Fixed(r) === t03Fixed(before[i])), JSON.stringify([t.calls, t.after.map(t03State)]));
  const seen = t04Sheet(t);
  const locks = t.h.lockRequests();
  t04Go(t, 4);
  check('93/04 E: 4 min after the first-seen time nothing happens (no request, no write, no lock)',
    t.calls.length === 0 && t04Sheet(t) === seen && t.h.lockRequests() === locks, JSON.stringify(t.calls));
  t04Go(t, 5);
  check('93/04 E: 5 min after the first-seen time the group is sent and accepted («автоотправка»); both rows get the status',
    t.calls.join() === 'list_shops,preview_product_cost_changes,apply_product_cost_changes,get_product_costs'
      && t.after.every((r) => t04Is(r, T03_OK, 'КАН принял 233,67', t04Text(5), t04Text(5) + ' автоотправка')), JSON.stringify(t.after.map(t03State)));

  // A row with a time that is already old goes at once; the browser's own send never waits.
  t = t03Setup([t03One({ status: '', time: t04Text(-10) })]);
  t04Go(t, 0);
  check('93/04 E: an unsent row whose time is 10 min old is sent at once',
    t.calls.length === 4 && t04Is(t.after[0], T03_OK, 'КАН принял 233,67', t04Text(0), t04Text(0) + ' автоотправка'), JSON.stringify([t.calls, t03State(t.after[0])]));
  t = t03Run([t03One({ status: T03_ERR, answer: 'КАН недоступен', time: T03_TIME })]);
  check('93/04 E: the browser\'s send ignores the age — a fresh «ошибка» row is sent at once and stamped with the user name',
    t.res.accepted.length === 1 && t03Accepted(t.after[0], 'КАН принял 233,67', T03_TIME + ' tester'), JSON.stringify(t.res));

  // A deletion group (the last row is a drop marker) is looked at the same way.
  t = t03Setup([t03Row(T03_DAY, 'MaxiStore', 'ART-D', 90, 'op-d'), t03Marker(T03_DAY, 'ART-D', 'op-d')], { entries: { 2771: [{ article: 'ART-D', date: T03_DAY, cost: 90 }] } });
  t04Go(t, 0);
  const deleteSeen = t.calls.length === 0 && t04Is(t.after[1], '', '', t04Text(0), '') && t04Is(t.after[0], '', '', '', '');
  t04Go(t, 5);
  check('93/04 E: a deletion group gets the first-seen time on its marker row, and 5 min later KAN\'s entry is deleted',
    deleteSeen && t.kan.entries(2771).length === 0 && t.after.every((r) => r['Статус КАН'] === T03_OK && r['Выгружено в КАН'] === ''), JSON.stringify(t.after.map(t03State)));
})();

(function test93s04Lease() {
  const lease = (h) => h.getScriptProperty('kan_costSenderUntil');
  const due = () => [t03One({ status: T03_ERR, answer: 'КАН недоступен', time: '2026-10-14 11:00:00' })];
  // Another sender is running: due work waits, nothing is asked or written, the lease stays.
  let t = t03Setup(due());
  const live = String(Date.parse(T03_NOW) + 300000);
  t.h.setScriptProperty('kan_costSenderUntil', live);
  let frozen = t04Sheet(t);
  t04Go(t, 0);
  check('93/04 F: while a sender holds the lease the watch returns busy without a request or a write, and the lease stays',
    t.res.busy === true && t.res.message === 'уже отправляется' && t.calls.length === 0 && t04Sheet(t) === frozen && lease(t.h) === live, JSON.stringify(t.res));
  t = t03Setup(due());
  t.h.setScriptLockBusy(true);
  frozen = t04Sheet(t);
  t04Go(t, 0);
  check('93/04 F: when the table lock cannot be taken the watch returns busy «таблица занята, отправка позже» and leaves no lease',
    t.res.busy === true && t.res.message === 'таблица занята, отправка позже' && t.calls.length === 0 && t04Sheet(t) === frozen && lease(t.h) === null, JSON.stringify(t.res));
  // An idle run never asks for the lease: a live lease changes nothing.
  t = t03Setup([t04Manual()]);
  t.h.setScriptProperty('kan_costSenderUntil', live);
  t04Go(t, 5);
  check('93/04 F: with no due work the watch returns idle even while another sender holds the lease', t.res.idle === true && t.res.busy === false && lease(t.h) === live, JSON.stringify(t.res));

  // A normal run frees the lease and the lock and asks KAN outside any script lock.
  t = t03Setup(due());
  t04Go(t, 0);
  check('93/04 F: a run frees the lease and the lock, makes no request under a script lock and never takes a lock twice',
    lease(t.h) === null && !t.h.isScriptLockHeld() && t.h.fetchesWhileLocked() === 0 && t.h.nestedLockTakes() === 0 && t.res.accepted === 1, JSON.stringify(t.res));

  // The watch NEVER throws (a throwing trigger mails the owner on every run): the summary carries the error, one line
  // is logged, and the lease and the lock are still freed.
  const odd = ['Статус КАН', 'Время КАН', 'Ответ КАН'];
  t = t03Setup([t03One()]);
  t.h.setOzonCostSheet([t03One()], t.h.OZON_COST_HEADERS.concat(odd));
  let thrown = '';
  let summary = null;
  try { summary = t.h.kanCostWatch(); } catch (e) { thrown = String(e.message || e); }
  const errorLines = t.h.logs.filter((l) => l.indexOf('kanCostWatch: error') === 0);
  check('93/04 F: when the run fails inside (status columns out of order) the watch does not throw: the summary carries the Russian error, one line is logged, KAN was not asked, the lease and the lock are freed',
    thrown === '' && summary && summary.error.indexOf('должны идти подряд') !== -1 && summary.idle === false && summary.busy === false
      && errorLines.length === 1 && errorLines[0].indexOf('должны идти подряд') !== -1
      && t.h.fetchLog.length === 0 && lease(t.h) === null && !t.h.isScriptLockHeld(),
    JSON.stringify([thrown, summary, errorLines]));
  // A failure BEFORE the lease (the sheet cannot be read) does not throw either and takes no lease.
  t = t03Setup([t03One()]);
  t.h.getRegistrySheet('Себестоимость Озон').getDataRange = function () { throw new Error('Service Spreadsheets timed out'); };
  thrown = '';
  summary = null;
  try { summary = t.h.kanCostWatch(); } catch (e) { thrown = String(e.message || e); }
  check('93/04 F: a failure before the lease (the journal cannot be read) does not throw: the summary carries the message and no lease was taken',
    thrown === '' && summary && summary.error === 'Service Spreadsheets timed out' && lease(t.h) === null && t.h.fetchLog.length === 0
      && t.h.logs.filter((l) => l.indexOf('kanCostWatch: error') === 0).length === 1,
    JSON.stringify([thrown, summary]));
  // The lease cannot be released (Script Properties down): the run still ends normally, the error is in the summary.
  t = t03Setup(due());
  t.h.context.releaseKanCostLease = function () { throw new Error('Service Properties failed'); };
  thrown = '';
  summary = null;
  try { summary = t.h.kanCostWatch(); } catch (e) { thrown = String(e.message || e); }
  check('93/04 F: a lease that cannot be released does not make the watch throw; the work done stays in the summary, the error is added',
    thrown === '' && summary && summary.accepted === 1 && summary.error === 'Service Properties failed', JSON.stringify([thrown, summary]));
  // A clean run has an empty error field.
  t = t03Setup(due());
  t04Go(t, 0);
  check('93/04 F: a clean run and an idle run report an empty error', t.res.error === '' && t.res.accepted === 1, JSON.stringify(t.res));

  // All three jobs in one run: first-seen (no request), the manual check, the retry — in that order.
  const manual = { status: T04_MANUAL, answer: T04_WAIT, time: T03_TIME };
  t = t03Setup([t03One(manual), t03Row(T03_DAY, 'MaxiStore', 'ART-E', 40, 'op-e', { status: T03_ERR, answer: 'КАН недоступен', time: '2026-10-14 11:00:00' }), t03Row(T03_DAY, 'MaxiStore', 'ART-U', 55, 'op-u')]);
  t04KanHolds(t, 2771, 'ART-C', T03_DAY, 233.67);
  t04Go(t, 15);
  check('93/04 F: one run does all three jobs — the manual row is accepted by hand, the error row is re-sent, the unseen row only gets its time; KAN is never asked about the unseen one',
    t04Is(t.after[0], T03_OK, 'КАН принял 233,67 (загружено вручную)', t04Text(15), t04Text(15) + T04_BY_HAND)
      && t04Is(t.after[1], T03_OK, 'КАН принял 40,00', t04Text(15), t04Text(15) + ' автоотправка') && t04Is(t.after[2], '', '', t04Text(15), '')
      && t.calls.join() === 'list_shops,get_product_costs,list_shops,preview_product_cost_changes,apply_product_cost_changes,get_product_costs'
      && t03Args(t.h, 'preview_product_cost_changes').every((a) => a.rows.length === 1 && a.rows[0].sku_article === 'ART-E')
      && t.res.firstSeen === 1 && t.res.manualAccepted === 1 && t.res.manualMissed === 0 && t.res.accepted === 1 && t.res.failed === 0,
    JSON.stringify([t.calls, t.after.map(t03State), t.res]));
})();

(function test93s04Switch() {
  // The matrix: switched = pending groups ('' unstamped, «отправляется», «ошибка») and «вручную» ones with a good date and cost.
  const row = (date, cab, art, cost, opId, extra) => t03Row(date, cab, art, cost, opId, extra);
  const matrix = () => [
    row(T03_DAY, 'MaxiStore', 'ART-A', 100, 'op-a1'),                                                                   // row 2  \ one group, last figure 110
    row(T03_DAY, 'MaxiStore', 'ART-A', 110, 'op-a2'),                                                                   // row 3  /
    row(T03_DAY, 'MaxiStore', 'ART-B', 50, 'op-b', { status: T03_ERR, answer: 'КАН недоступен', time: '2026-10-13 09:00:00' }),    // row 4
    row(T03_DAY, 'MaxiStore', 'ART-C', 60, 'op-c', { status: T03_SENDING, time: '2026-10-13 09:00:00' }),                          // row 5
    row(T03_DAY, 'MaxiStore', 'ART-D', 70, 'op-d', { status: T04_MANUAL, answer: T04_WAIT, time: '2026-10-14 12:00:00' }),        // row 6
    row(T03_DAY, 'MaxiStore', 'ART-E', 80, 'op-e', { status: T03_OK, answer: 'КАН принял 80,00', time: '2026-10-13 09:00:00', exported: T03_OLD_STAMP }), // row 7
    row(T03_DAY, 'MaxiStore', 'ART-F', 90, 'op-f', { exported: T03_OLD_STAMP }),                                         // row 8: CSV-stamped, no status
    row(T03_DAY, 'MaxiStore', 'ART-G', 120, 'op-g'),                                                                    // row 9  \ the last row is a drop marker
    t03Marker(T03_DAY, 'ART-G', 'op-g'),                                                                               // row 10 /
    row('13.10.2026', 'MaxiStore', 'ART-H', 30, 'op-h'),                                                                // row 11: not an ISO date
    row(T03_DAY, 'MaxiStore', 'ART-I', 0, 'op-i'),                                                                      // row 12: zero cost
    row(T03_DAY, 'Mercurius', 'ART-J', 85, 'op-j')                                                                      // row 13
  ];
  const exportRow = (n, art, cost, opId, cab) => ({ row: n, date: T03_DAY, cabinet: cab || 'MaxiStore', article: art, sku: 'S-' + art, cost: cost, opId: opId, source: 'отгрузка' });

  let t = t03Setup(matrix());
  const before = t.h.dumpOzonCostFull();
  const res = t.h.switchOzonCostToManual('tester');
  const after = t.h.dumpOzonCostFull();
  const switchedRows = [2, 3, 4, 5, 6, 13];
  check('93/04 G: the answer lists the LAST row of each switched group in the export shape and journal order, with the counts',
    t03Canon(res) === t03Canon({ busy: false, message: '', switched: 5, notWritten: 0, rows: [
      exportRow(3, 'ART-A', 110, 'op-a2'), exportRow(4, 'ART-B', 50, 'op-b'), exportRow(5, 'ART-C', 60, 'op-c'), exportRow(6, 'ART-D', 70, 'op-d'), exportRow(13, 'ART-J', 85, 'op-j', 'Mercurius')] }),
    JSON.stringify(res));
  check('93/04 G: EVERY row of a switched group is «вручную» / «ждём файл в КАН» / now — the whole of an unsent group, an «ошибка», a «отправляется», a re-switched «вручную» and a second cabinet',
    switchedRows.every((n) => t04Is(after[n - 2], T04_MANUAL, T04_WAIT, T03_TIME, '')), JSON.stringify(switchedRows.map((n) => t03State(after[n - 2]))));
  check('93/04 G: «Выгружено в КАН» is NOT set on any switched row, and columns 1-12 of every row are byte for byte',
    switchedRows.every((n) => after[n - 2]['Выгружено в КАН'] === '') && after.every((r, i) => t03Fixed(r) === t03Fixed(before[i])), JSON.stringify(after.map(t03State)));
  check('93/04 G: accepted, CSV-stamped, drop-marker (deletion), bad-date and zero-cost groups are left exactly as they were',
    [7, 8, 9, 10, 11, 12].every((n) => t03Canon(after[n - 2]) === t03Canon(before[n - 2])), JSON.stringify([7, 8, 9, 10, 11, 12].map((n) => t03State(after[n - 2]))));
  check('93/04 G: switching asks KAN nothing and leaves no lease behind',
    t.h.fetchLog.length === 0 && t.h.getScriptProperty('kan_costSenderUntil') === null && !t.h.isScriptLockHeld() && t.h.nestedLockTakes() === 0, String(t.h.fetchLog.length));

  // A re-switch restarts the 15-min timer.
  t = t03Setup([t04Manual()]);
  t.h.setNow(t04Iso(10));
  const again = t.h.switchOzonCostToManual('tester');
  const restamped = t04Is(t.h.dumpOzonCostFull()[0], T04_MANUAL, T04_WAIT, t04Text(10), '') && again.switched === 1;
  t04Go(t, 24);
  const quiet = t.calls.length === 0;
  t04Go(t, 25);
  check('93/04 G: a re-switch of a «вручную» group resets its time — 14 min after it the watch is quiet, 15 min after it KAN is read',
    restamped && quiet && t.calls.join() === T04_LOOKUP, JSON.stringify([restamped, quiet, t.calls]));

  // The sender no longer touches a switched group, but the watch will.
  t = t03Setup([t03One()]);
  t.h.switchOzonCostToManual('tester');
  const skipped = t.h.sendOzonCostToKan('tester');
  check('93/04 G: after the switch the browser sender skips the group (counted in skippedManual) and sends nothing',
    skipped.skippedManual === 1 && skipped.accepted.length === 0 && t.h.fetchLog.length === 0, JSON.stringify(skipped));

  // Another sender holds the lease: refused, nothing written.
  t = t03Setup([t03One()]);
  const live = String(Date.parse(T03_NOW) + 300000);
  t.h.setScriptProperty('kan_costSenderUntil', live);
  const frozen = t04Sheet(t);
  const busy = t.h.switchOzonCostToManual('tester');
  check('93/04 G: while a sender holds the lease the switch answers busy «уже отправляется» with no rows, and writes nothing',
    t03Canon(busy) === t03Canon({ busy: true, message: 'уже отправляется', rows: [], switched: 0, notWritten: 0 }) && t04Sheet(t) === frozen && t.h.getScriptProperty('kan_costSenderUntil') === live,
    JSON.stringify(busy));

  // A row changed under us between the read and the write: that group is not switched and not returned.
  t = t03Setup([t03Row(T03_DAY, 'MaxiStore', 'ART-A', 100, 'op-a'), t03Row(T03_DAY, 'MaxiStore', 'ART-B', 50, 'op-b')]);
  const sheet = t.h.getRegistrySheet('Себестоимость Озон');
  const realGet = sheet.getDataRange;
  let reads = 0;
  sheet.getDataRange = function () {
    const range = realGet.call(sheet);
    if (++reads === 1) {
      const getValues = range.getValues;
      range.getValues = function () { const values = getValues.call(range); sheet.getRange(2, 9).setValue(240); return values; };
    }
    return range;
  };
  const moved = t.h.switchOzonCostToManual('tester');
  const afterMoved = t.h.dumpOzonCostFull();
  check('93/04 G: a group whose row changed between the read and the write is not switched and not returned (notWritten 1); the other group is switched',
    moved.switched === 1 && moved.notWritten === 1 && moved.rows.length === 1 && moved.rows[0].article === 'ART-B'
      && t04Is(afterMoved[0], '', '', '', '') && afterMoved[0]['Себестоимость после'] === 240 && t04Is(afterMoved[1], T04_MANUAL, T04_WAIT, T03_TIME, ''),
    JSON.stringify([moved, afterMoved.map(t03State)]));
})();

(function test93s04DoPostAndTrigger() {
  const withSessions = (t) => t.h.setRegistrySheet('Сессии', [['Token', 'Username', 'Role', 'ExpiresAt'],
    ['tok-user', 'Кладовщик', 'user', String(Date.parse('2030-01-01T00:00:00Z'))], ['tok-admin', 'boss', 'admin', String(Date.parse('2030-01-01T00:00:00Z'))]]);
  let t = t03Setup([t03One()]);
  withSessions(t);
  let frozen = t04Sheet(t);
  let out = t.h.callDoPost({ action: 'switchOzonCostToManual', sessionToken: 'tok-admin', devMode: true });
  check('93/04 H: in dev mode doPost refuses the switch with the Russian message and writes nothing',
    out.status === 'error' && out.message.indexOf('недоступно в режиме разработки') !== -1 && t04Sheet(t) === frozen, JSON.stringify(out));
  t.h.vm.runInContext('_devModeSpreadsheet = ({})', t.h.context);
  let direct = '';
  try { t.h.switchOzonCostToManual('boss'); } catch (e) { direct = String(e.message || e); }
  t.h.vm.runInContext('_devModeSpreadsheet = null', t.h.context);
  check('93/04 H: the switch itself refuses too when the dev-mode spreadsheet is set, and takes no lease',
    direct.indexOf('недоступно в режиме разработки') !== -1 && t04Sheet(t) === frozen && t.h.getScriptProperty('kan_costSenderUntil') === null, direct);

  t = t03Setup([t03One()]);
  withSessions(t);
  out = t.h.callDoPost({ action: 'switchOzonCostToManual', sessionToken: 'tok-user' });
  check('93/04 H: a signed-in user\'s call returns success with the switched rows, outside the global lock (no 10 s waitLock)',
    out.status === 'success' && out.data.switched === 1 && out.data.rows.length === 1 && out.data.rows[0].article === 'ART-C' && out.data.rows[0].cost === 233.67
      && t.h.waitLockTimeouts().indexOf(10000) === -1 && t04Is(t.h.dumpOzonCostFull()[0], T04_MANUAL, T04_WAIT, T03_TIME, ''),
    JSON.stringify([out.status, out.data, t.h.waitLockTimeouts()]));
  t = t03Setup([t03One()]);
  withSessions(t);
  frozen = t04Sheet(t);
  out = t.h.callDoPost({ action: 'switchOzonCostToManual', sessionToken: 'nobody' });
  check('93/04 H: without a valid session nothing is switched', out.status === 'error' && t04Sheet(t) === frozen, JSON.stringify(out));

  // The trigger: one «kanCostWatch» every 15 minutes, whatever was there before; other triggers stay.
  const h = freshHarness();
  h.context.ScriptApp.newTrigger('unrelatedJob').timeBased().everyMinutes(30).create();
  h.context.ScriptApp.newTrigger('kanCostWatch').timeBased().everyMinutes(5).create();
  h.setupKanCostWatchTrigger();
  h.setupKanCostWatchTrigger();
  check('93/04 H: installing the trigger twice leaves ONE kanCostWatch trigger of 15 minutes (the old one is replaced) and keeps the unrelated trigger',
    t03Canon(h.scriptTriggers()) === t03Canon([{ handler: 'unrelatedJob', kind: 'time', minutes: 30 }, { handler: 'kanCostWatch', kind: 'time', minutes: 15 }]),
    JSON.stringify(h.scriptTriggers()));
  const idle = t03Setup([t03One({ status: T03_OK, answer: 'КАН принял 233,67', time: T03_TIME, exported: T03_OLD_STAMP })]);
  t04Go(idle, 0);
  check('93/04 H: a run logs one line and returns the summary', idle.h.logs.filter((l) => l.indexOf('kanCostWatch') === 0).length === 1 && idle.res.idle === true,
    JSON.stringify(idle.h.logs));
})();

// Item 93 ticket 04, second pass (independent QA): old sheets, the shop lookup of the manual check, a journal
// that moves under the manual check, a correction appended to a «вручную» group, groups KAN cannot be asked
// about, and the two whole paths of the owner (the file lands in KAN / nothing lands).
(function test93s04Gaps() {
  const manual = { status: T04_MANUAL, answer: T04_WAIT, time: T03_TIME };
  const ALL_HEADERS = (h) => h.OZON_COST_HEADERS.concat(h.OZON_COST_KAN_HEADERS).join('|');

  // ---- An old journal sheet with the 12 columns only ----
  let t = t03Setup([t03One()], null, true);
  let before = t.h.dumpOzonCostFull();
  t04Go(t, 0);
  check('93/04 I: on an old 12-column sheet the watch adds the three KAN columns and gives the last row its first-seen time, asking KAN nothing',
    Object.keys(t.after[0]).join('|') === ALL_HEADERS(t.h) && t04Is(t.after[0], '', '', t04Text(0), '') && t03Fixed(t.after[0]) === t03Fixed(before[0])
      && t.calls.length === 0 && t.res.firstSeen === 1,
    JSON.stringify([Object.keys(t.after[0]), t03State(t.after[0]), t.calls]));
  t04Go(t, 5);
  check('93/04 I: on that upgraded sheet the next watch run 5 min later sends the row and it is accepted',
    t.calls.length === 4 && t04Is(t.after[0], T03_OK, 'КАН принял 233,67', t04Text(5), t04Text(5) + ' автоотправка'), JSON.stringify([t.calls, t03State(t.after[0])]));

  t = t03Setup([t03One(), t03Row(T03_DAY, 'Mercurius', 'ART-M', 85, 'op-m')], null, true);
  before = t.h.dumpOzonCostFull();
  const res = t.h.switchOzonCostToManual('tester');
  const after = t.h.dumpOzonCostFull();
  check('93/04 I: on an old 12-column sheet the switch adds the three KAN columns first, then switches both groups (not stamped, columns 1-12 byte for byte)',
    res.switched === 2 && res.notWritten === 0 && Object.keys(after[0]).join('|') === ALL_HEADERS(t.h)
      && after.every((r, i) => t04Is(r, T04_MANUAL, T04_WAIT, T03_TIME, '') && t03Fixed(r) === t03Fixed(before[i])),
    JSON.stringify([res, after.map(t03State)]));

  // ---- The shop lookup of the manual check: Wildberries is not an Ozon cabinet, two Ozon shops of one name are never guessed ----
  t = t03Setup([t04Manual()], { shops: [
    { id: 999, name: 'MaxiStore', marketplace: 'wildberries', is_active: true },
    { id: 2771, name: 'MaxiStore', marketplace: 'ozon', is_active: true }] });
  t04KanHolds(t, 2771, 'ART-C', T03_DAY, 233.67);
  t04Go(t, 15);
  check('93/04 J: a Wildberries shop with the cabinet\'s name is ignored by the manual check — the read goes to the Ozon shop only and the figure is found',
    t.calls.join() === T04_LOOKUP && t03Canon(t03Args(t.h, 'get_product_costs')) === t03Canon([T04_READ])
      && t04Is(t.after[0], T03_OK, 'КАН принял 233,67 (загружено вручную)', t04Text(15), t04Text(15) + T04_BY_HAND),
    JSON.stringify([t.calls, t03Args(t.h, 'get_product_costs'), t03State(t.after[0])]));

  t = t03Setup([t04Manual()], { shops: [
    { id: 2771, name: 'MaxiStore', marketplace: 'ozon', is_active: true },
    { id: 3000, name: 'MaxiStore', marketplace: 'ozon', is_active: true }] });
  t04KanHolds(t, 2771, 'ART-C', T03_DAY, 233.67);
  const twinFrozen = t04Sheet(t);
  t04Go(t, 15);
  const twin15 = t.calls.join() === 'list_shops' && t04Sheet(t) === twinFrozen;
  t04Go(t, 60);
  check('93/04 J: two Ozon shops with the cabinet\'s name are never guessed between — no read at all, even when one of them holds the figure; at 60 min «ошибка» / «в КАН не найдено»',
    twin15 && t.calls.join() === 'list_shops' && t04Is(t.after[0], T03_ERR, 'в КАН не найдено', t04Text(60), ''),
    JSON.stringify([twin15, t.calls, t03State(t.after[0])]));

  // The journal lists the later day first (a correction of an older day is appended after it): the read still spans min..max.
  t = t03Setup([t04Manual(), t03Row('2026-10-10', 'MaxiStore', 'ART-C', 210.5, 'op-0', manual)]);
  t04KanHolds(t, 2771, 'ART-C', T03_DAY, 233.67);
  t04KanHolds(t, 2771, 'ART-C', '2026-10-10', 210.5);
  t04Go(t, 15);
  check('93/04 J: the read of a shop spans its earliest to its latest day whatever the order of the groups in the journal (later day listed first), and both groups are found',
    t03Canon(t03Args(t.h, 'get_product_costs')) === t03Canon([{ shop_id: [2771], date__gte: '2026-10-10', date__lte: T03_DAY, limit: 1000, offset: 0 }])
      && t.res.manualAccepted === 2 && t.after.every((r) => r['Статус КАН'] === T03_OK),
    JSON.stringify([t03Args(t.h, 'get_product_costs'), t.after.map(t03State)]));

  // ---- Groups KAN cannot be asked about are left for a person: no request, no write ----
  const marker = (date, art, opId) => t03Marker(date, art, opId).concat([T04_MANUAL, T04_WAIT, T03_TIME]);
  t = t03Setup([
    t03Row('13.10.2026', 'MaxiStore', 'ART-H', 30, 'op-h', manual),
    t03Row(T03_DAY, 'MaxiStore', 'ART-I', 0, 'op-i', manual),
    t03Row(T03_DAY, 'MaxiStore', 'ART-D', 90, 'op-d', manual),
    marker(T03_DAY, 'ART-D', 'op-d')]);
  const unaskable = t04Sheet(t);
  t04Go(t, 60);
  t04Go(t, 600);
  check('93/04 K: a «вручную» group with a bad date, a zero figure or a deletion marker as its last row is never looked up in KAN — no request, nothing written, idle',
    t.calls.length === 0 && t04Sheet(t) === unaskable && t.res.idle === true && t.h.fetchLog.length === 0, JSON.stringify([t.calls, t.res]));

  // ---- The journal moves under the manual check (the row is edited while KAN is being read) ----
  const moveRow2 = (name, args) => {
    if (name === 'get_product_costs' && args.shop_id[0] === 2771 && !moveRow2.done) {
      moveRow2.done = true;
      t.h.getRegistrySheet('Себестоимость Озон').getRange(2, 9).setValue(240);
    }
  };
  moveRow2.done = false;
  t = t03Setup([t04Manual(), t03Row(T03_DAY, 'Mercurius', 'ART-M', 85, 'op-m', manual)], { onCall: (name, args) => moveRow2(name, args) });
  t04KanHolds(t, 2771, 'ART-C', T03_DAY, 233.67);
  t04KanHolds(t, 1765, 'ART-M', T03_DAY, 85);
  t04Go(t, 15);
  check('93/04 L: a found group whose row the journal moved between the read and the write is not accepted and not counted; the other group is accepted',
    t.res.manualAccepted === 1 && t.res.manualMissed === 0 && t.after[0]['Себестоимость после'] === 240 && t04Is(t.after[0], T04_MANUAL, T04_WAIT, T03_TIME, '')
      && t04Is(t.after[1], T03_OK, 'КАН принял 85,00 (загружено вручную)', t04Text(15), t04Text(15) + T04_BY_HAND),
    JSON.stringify([t.res, t.after.map(t03State)]));
  t04Go(t, 30);
  check('93/04 L: the moved row is judged by its NEW figure on the next run (KAN holds 233.67, the journal says 240 — still «вручную»)',
    t04Is(t.after[0], T04_MANUAL, T04_WAIT, T03_TIME, '') && t.res.manualAccepted === 0, JSON.stringify(t03State(t.after[0])));

  moveRow2.done = false;
  t = t03Setup([t04Manual(), t03Row(T03_DAY, 'Mercurius', 'ART-M', 85, 'op-m', manual)], { onCall: (name, args) => moveRow2(name, args) });
  t04KanHolds(t, 1765, 'ART-M', T03_DAY, 85);
  t04Go(t, 60);
  check('93/04 L: a missed group (60 min) whose row the journal moved meanwhile is not turned into «ошибка» and not counted as missed; the other group is accepted',
    t.res.manualMissed === 0 && t.res.manualAccepted === 1 && t04Is(t.after[0], T04_MANUAL, T04_WAIT, T03_TIME, '') && t.after[0]['Себестоимость после'] === 240
      && t.after[1]['Статус КАН'] === T03_OK, JSON.stringify([t.res, t.after.map(t03State)]));

  // ---- A new correction row appended to a «вручную» group: the group leaves manual and is handled as unsent ----
  const correction = [t03Row(T03_DAY, 'MaxiStore', 'ART-C', 231, 'op-1', manual), t03Row(T03_DAY, 'MaxiStore', 'ART-C', 233.67, 'op-2')];
  t = t03Setup(correction);
  t04KanHolds(t, 2771, 'ART-C', T03_DAY, 233.67);
  t04Go(t, 15);
  check('93/04 M: a correction row (no status) appended to a «вручную» group takes the group out of manual — KAN is not asked, the old row stays «вручную», only the new last row gets its first-seen time',
    t.calls.length === 0 && t04Is(t.after[0], T04_MANUAL, T04_WAIT, T03_TIME, '') && t04Is(t.after[1], '', '', t04Text(15), '') && t.res.firstSeen === 1 && t.res.manualAccepted === 0,
    JSON.stringify([t.calls, t.after.map(t03State), t.res]));
  t04Go(t, 19);
  const correction19 = t.calls.length === 0;
  t04Go(t, 20);
  check('93/04 M: 5 min after that the whole group is sent by the normal sender and both rows end «принято» with the «автоотправка» stamp',
    correction19 && t.calls.join() === 'list_shops,preview_product_cost_changes,apply_product_cost_changes,get_product_costs'
      && t.after.every((r) => t04Is(r, T03_OK, 'КАН принял 233,67', t04Text(20), t04Text(20) + ' автоотправка')), JSON.stringify([t.calls, t.after.map(t03State)]));
  t = t03Setup(correction);
  const again = t.h.switchOzonCostToManual('tester');
  const afterAgain = t.h.dumpOzonCostFull();
  check('93/04 M: pressing «Отправлю сам» again switches the whole group back to «вручную» (both rows) and returns its last row',
    again.switched === 1 && again.rows.length === 1 && again.rows[0].row === 3 && again.rows[0].cost === 233.67
      && afterAgain.every((r) => t04Is(r, T04_MANUAL, T04_WAIT, T03_TIME, '')), JSON.stringify([again, afterAgain.map(t03State)]));

  // ---- The whole paths of the owner: the browser send fails, «Отправлю сам», then KAN either gets the file or does not ----
  const owner = () => {
    const state = { down: true };
    const o = t03Setup([t03One()], { onCall: () => { if (state.down) throw new Error('Exception: Timeout: https://kultura-analitiki.ru/mcp/'); } });
    o.state = state;
    o.h.setNow(t04Iso(0));
    o.browser = o.h.sendOzonCostToKan('Кладовщик');
    o.switched = o.h.switchOzonCostToManual('Кладовщик');
    o.state.down = false;
    return o;
  };
  t = owner();
  check('93/04 N: the browser send with KAN down leaves a failed group, and «Отправлю сам» then switches that «ошибка» row and hands back its line for the file (not stamped)',
    t.browser.failed.length === 1 && t.browser.failed[0].reason === 'КАН недоступен' && t.switched.switched === 1 && t.switched.rows.length === 1
      && t.switched.rows[0].article === 'ART-C' && t.switched.rows[0].cost === 233.67 && t04Is(t.h.dumpOzonCostFull()[0], T04_MANUAL, T04_WAIT, T03_TIME, ''),
    JSON.stringify([t.browser, t.switched]));
  t04KanHolds(t, 2771, 'ART-C', T03_DAY, 233.67);
  t04Go(t, 14);
  const wait14 = t.calls.length === 0 && t.res.idle === true;
  t04Go(t, 15);
  check('93/04 N: the owner\'s file lands in KAN — the watch 15 min after the switch accepts it with «загружено вручную» and the stamp, and writes nothing to KAN',
    wait14 && t04Is(t.after[0], T03_OK, 'КАН принял 233,67 (загружено вручную)', t04Text(15), t04Text(15) + T04_BY_HAND) && t.kan.writes === 0 && t.kan.previewCount === 0,
    JSON.stringify([wait14, t03State(t.after[0]), t.kan.writes]));

  t = owner();
  [15, 30, 45].forEach((min) => t04Go(t, min));
  const stillManual = t04Is(t.after[0], T04_MANUAL, T04_WAIT, T03_TIME, '') && t.kan.writes === 0;
  t04Go(t, 60);
  const errorAt60 = t04Is(t.after[0], T03_ERR, 'в КАН не найдено', t04Text(60), '');
  t04Go(t, 119);
  const quiet119 = t.calls.length === 0;
  t04Go(t, 120);
  check('93/04 N: nothing lands in KAN — «вручную» through 45 min, «ошибка» / «в КАН не найдено» at 60, quiet until the hourly retry at 120, which sends the figure through the API and is accepted («автоотправка»)',
    stillManual && errorAt60 && quiet119 && t04Is(t.after[0], T03_OK, 'КАН принял 233,67', t04Text(120), t04Text(120) + ' автоотправка')
      && t.kan.entries(2771).length === 1 && t.kan.entries(2771)[0].cost === 233.67,
    JSON.stringify([stillManual, errorAt60, quiet119, t03State(t.after[0]), t.kan.entries(2771)]));
})();

// ---- Item 93 ticket 04, review: «Время КАН» is stored as TEXT, whatever zone the spreadsheet lives in ----
// The real script zone is Asia/Yekaterinburg; a spreadsheet may carry another zone. Writing '2026-10-14 15:30:00' into
// a General cell makes Sheets parse it as a date-time, and getValues then returns a Date in the SPREADSHEET's zone,
// which the reader formats in the SCRIPT zone: every age decision of the watch shifts by the zone difference. The stand
// switches that behaviour on with setSheetAutoDates(zone); here the sheet is in Yekaterinburg (UTC+5) and the stand's
// script zone is Moscow (UTC+3), so a Date cell would read 2 hours EARLIER than what was written.
(function test93s04TimeAsText() {
  const SHEET_ZONE = 'Asia/Yekaterinburg';
  const timeColumn = (h) => h.OZON_COST_HEADERS.length + 3;                  // 1-based column of «Время КАН»
  const cellOf = (t, row, col) => t.h.getRegistrySheet('Себестоимость Озон').__dump()[row - 1][col - 1];
  const timeCell = (t, row) => cellOf(t, row, timeColumn(t.h));
  const formatOf = (t, row, col) => t.h.getRegistrySheet('Себестоимость Озон').__getFormat(row, col);

  // The switch at minute 0, the watch at +14 (quiet) and +15 (one look, still «вручную»).
  let t = t03Setup([t03One()]);
  t.h.setSheetAutoDates(SHEET_ZONE);
  t.h.setNow(t04Iso(0));
  t.h.switchOzonCostToManual();
  check('93/04 P: on a sheet that turns written times into dates the switch still leaves «Время КАН» as the TEXT of the script zone',
    timeCell(t, 2) === T03_TIME, typeof timeCell(t, 2) + ' ' + String(timeCell(t, 2)));
  const frozen = t04Sheet(t);
  t04Go(t, 14);
  const quiet14 = t.calls.length === 0 && t.res.idle === true;
  t04Go(t, 15);
  check('93/04 P: switched at minute 0, the watch is quiet at +14 and reads KAN once at +15, and the row stays «вручную» (the sheet zone shifts no age)',
    quiet14 && t.calls.join() === T04_LOOKUP && t04Sheet(t) === frozen && t.res.manualMissed === 0, JSON.stringify([quiet14, t.calls, t03State(t.after[0])]));
  t04Go(t, 45);
  check('93/04 P: the row is not given up on before the 60th minute (+45: one more look, still «вручную», nothing written)',
    t.calls.join() === T04_LOOKUP && t04Sheet(t) === frozen, JSON.stringify([t.calls, t03State(t.after[0])]));

  // An «ошибка» written by a failed send is not retried at +59, and is at +60.
  const state = { down: true };
  t = t03Setup([t03One()], { onCall: () => { if (state.down) throw new Error('Exception: Timeout: https://kultura-analitiki.ru/mcp/'); } });
  t.h.setSheetAutoDates(SHEET_ZONE);
  t.h.setNow(t04Iso(0));
  const failed = t.h.sendOzonCostToKan('Кладовщик');
  check('93/04 P: a send that fails leaves «ошибка» with its time as TEXT on a sheet that turns written times into dates',
    failed.failed.length === 1 && t03Canon(t03State(t.h.dumpOzonCostFull()[0])) === t03Canon([T03_ERR, 'КАН недоступен', T03_TIME, '']) && timeCell(t, 2) === T03_TIME,
    JSON.stringify([failed, typeof timeCell(t, 2), t03State(t.h.dumpOzonCostFull()[0])]));
  state.down = false;
  t04Go(t, 59);
  const quiet59 = t.calls.length === 0 && t.res.idle === true;
  t04Go(t, 60);
  check('93/04 P: that «ошибка» is not retried at +59 and is sent and accepted at +60 (the retry is not early by the zone difference)',
    quiet59 && t.calls.join() === 'list_shops,preview_product_cost_changes,apply_product_cost_changes,get_product_costs'
      && t04Is(t.after[0], T03_OK, 'КАН принял 233,67', t04Text(60), t04Text(60) + ' автоотправка') && timeCell(t, 2) === t04Text(60),
    JSON.stringify([quiet59, t.calls, t03State(t.after[0])]));

  // The first-seen time of an unseen row is text as well: 4 min quiet, 5 min sent.
  t = t03Setup([t03One()]);
  t.h.setSheetAutoDates(SHEET_ZONE);
  t04Go(t, 0);
  const seenAsText = timeCell(t, 2) === T03_TIME;
  t04Go(t, 4);
  const quiet4 = t.calls.length === 0;
  t04Go(t, 5);
  check('93/04 P: the first-seen time is text too — the unsent row waits 4 min and is sent at 5 min, not at once',
    seenAsText && quiet4 && t.calls.length === 4 && t04Is(t.after[0], T03_OK, 'КАН принял 233,67', t04Text(5), t04Text(5) + ' автоотправка'), JSON.stringify([seenAsText, quiet4, t.calls]));

  // The time cells carry the text format after a write; other columns do not; the rows of other hands inside the span too.
  const setup = t03Setup([]);
  const dateCell = new setup.h.FakeDate(Date.parse('2026-09-02T07:00:00Z'));          // 10:00:00 in the stand's script zone
  setup.h.setOzonCostSheet([t03One(), t03Row('2026-09-02', 'Mercurius', 'ART-M', 85, 'op-m', { exported: T03_OLD_STAMP, status: T03_OK, answer: 'КАН принял 85,00', time: dateCell }),
    t03Row(T03_DAY, 'MaxiStore', 'ART-Y', 70, 'op-y')], setup.h.OZON_COST_HEADERS.concat(setup.h.OZON_COST_KAN_HEADERS));
  setup.h.setSheetAutoDates(SHEET_ZONE);
  t = setup;
  const colTime = timeColumn(t.h);
  check('93/04 P: before any write the time cells have no format (fixture check)', [2, 3, 4].every((n) => formatOf(t, n, colTime) === ''), formatOf(t, 2, colTime));
  t.h.sendOzonCostToKan('tester');
  check('93/04 P: after a write the «Время КАН» cells of the whole written block (the rows of other hands inside it too) are formatted as text, and the neighbouring columns are not',
    [2, 3, 4].every((n) => formatOf(t, n, colTime) === '@') && [2, 3, 4].every((n) => formatOf(t, n, colTime - 1) === '' && formatOf(t, n, colTime - 2) === '' && formatOf(t, n, colTime + 1) === ''),
    JSON.stringify([2, 3, 4].map((n) => [formatOf(t, n, colTime - 2), formatOf(t, n, colTime - 1), formatOf(t, n, colTime), formatOf(t, n, colTime + 1)])));
  check('93/04 P: the row of another hand inside the block gets its Date back as TEXT of the same moment («2026-09-02 10:00:00»), not as a Date; its status, answer and stamp are as they were',
    timeCell(t, 3) === '2026-09-02 10:00:00' && t03Canon([cellOf(t, 3, colTime - 2), cellOf(t, 3, colTime - 1), cellOf(t, 3, 11)]) === t03Canon([T03_OK, 'КАН принял 85,00', T03_OLD_STAMP]),
    typeof timeCell(t, 3) + ' ' + String(timeCell(t, 3)));
  check('93/04 P: the times of the two rows of ours are text too («2026-10-14 13:00:00»)',
    timeCell(t, 2) === T03_TIME && timeCell(t, 4) === T03_TIME, JSON.stringify([timeCell(t, 2), timeCell(t, 4)]));
})();

// ================= Item 93 ticket 05, step A: the KAN markers of the history =================
// The history shows, next to a shipment, what KAN said about its cost. The server side is one pure read:
// ozonCostKanMarkersFromJournal(journal) -> [{ opId, article, status, answer, time }]. KAN's status lives on a
// DAY group (cabinet|article|day, the sender's own key) and its LAST row decides; a shipment (opId + article)
// follows the day group of the LAST journal row that carries it (a re-dated link: the drop marker of the old
// day is written first, the new link later). Rows with no status (written before item 93), without an opId,
// cabinet or article give no entry. getOzonCostKanMarkers() wraps it over the real journal and is a lock-free
// read that any signed-in user may call (the browser decides who sees what).
// A missing function is reported as failed checks, never as a throw that would kill the blocks after this one.

const T05_FN = 'ozonCostKanMarkersFromJournal';
const t05Journal = (h, rows) => { h.setOzonCostSheet(rows, h.OZON_COST_HEADERS.concat(h.OZON_COST_KAN_HEADERS)); return h.getOzonCostJournal(); };
const t05Entry = (opId, article, status, answer, time) => ({ opId: opId, article: article, status: status, answer: answer, time: time });
const t05Sorted = (list) => Array.prototype.slice.call(list).sort((a, b) => (a.opId + '|' + a.article).localeCompare(b.opId + '|' + b.article));
function t05Scenario(name, body) {
  const h = freshHarness();
  if (typeof h.context[T05_FN] !== 'function') { check(name, false, T05_FN + ' is missing in Code.gs'); return; }
  try {
    const r = body(h, h.context[T05_FN]);
    check(name, r.ok, r.details);
  } catch (e) {
    check(name, false, 'threw: ' + String((e && e.message) || e));
  }
}

(function test93s05Markers() {
  const probe = freshHarness();
  check('93/05 markers: ozonCostKanMarkersFromJournal and getOzonCostKanMarkers exist in Code.gs',
    typeof probe.context[T05_FN] === 'function' && typeof probe.context.getOzonCostKanMarkers === 'function',
    T05_FN + ': ' + typeof probe.context[T05_FN] + ', getOzonCostKanMarkers: ' + typeof probe.context.getOzonCostKanMarkers);

  t05Scenario('93/05 A: one accepted shipment gives one entry with its status, answer and time; the status is compared trimmed and lower-cased', (h, fn) => {
    const journal = t05Journal(h, [t03One({ status: 'Принято', answer: 'КАН принял 233,67', time: T03_TIME, exported: T03_OLD_STAMP })]);
    const out = fn(journal);
    const spaced = fn([Object.assign({}, journal[0], { kanStatus: '  ПРИНЯТО  ' })]);
    const want = [t05Entry('op-1', 'ART-C', 'принято', 'КАН принял 233,67', T03_TIME)];
    return { ok: t03Canon(out) === t03Canon(want) && t03Canon(spaced) === t03Canon(want), details: JSON.stringify([out, spaced]) };
  });

  t05Scenario('93/05 B: a shipment accepted earlier and a newer unsent one on the SAME cabinet, article and day (the day key cuts a time part off the date): the day reads unsent, so neither has an entry; another accepted day still does',
    (h, fn) => {
      const journal = t05Journal(h, [
        t03Row(T03_DAY, 'MaxiStore', 'ART-C', 231, 'op-x', { status: T03_OK, answer: 'КАН принял 231,00', time: T03_TIME }),
        t03Row(T03_DAY + 'T00:00:00', 'MaxiStore', 'ART-C', 233.67, 'op-y'),
        t03Row(T03_DAY, 'MaxiStore', 'ART-D', 70, 'op-z', { status: T03_OK, answer: 'КАН принял 70,00', time: T03_TIME })
      ]);
      const out = fn(journal);
      return { ok: t03Canon(out) === t03Canon([t05Entry('op-z', 'ART-D', 'принято', 'КАН принял 70,00', T03_TIME)]), details: JSON.stringify(out) };
    });

  t05Scenario('93/05 C: a re-dated shipment follows its NEW day — the old day is closed by the drop marker (accepted as a deletion), the new day failed: the entry is «ошибка» with the new day\'s answer, one entry only',
    (h, fn) => {
      const journal = t05Journal(h, [
        t03Row('2026-10-12', 'MaxiStore', 'ART-C', 100, 'op-x', { status: T03_OK, answer: 'КАН принял 100,00', time: '2026-10-13 09:00:00' }),
        t03Marker('2026-10-12', 'ART-C', 'op-x').concat([T03_OK, 'КАН: запись удалена', '2026-10-14 12:00:00']),
        t03Row(T03_DAY, 'MaxiStore', 'ART-C', 100, 'op-x', { status: T03_ERR, answer: 'КАН недоступен', time: T03_TIME })
      ]);
      const out = fn(journal);
      return { ok: t03Canon(out) === t03Canon([t05Entry('op-x', 'ART-C', 'ошибка', 'КАН недоступен', T03_TIME)]), details: JSON.stringify(out) };
    });

  t05Scenario('93/05 D: «вручную» (with the wait text) and «отправляется» groups come through as they are',
    (h, fn) => {
      const journal = t05Journal(h, [
        t03Row(T03_DAY, 'MaxiStore', 'ART-C', 233.67, 'op-1', { status: 'вручную', answer: 'ждём файл в КАН', time: T03_TIME }),
        t03Row(T03_DAY, 'MaxiStore', 'ART-E', 80, 'op-2', { status: T03_SENDING, time: T03_TIME })
      ]);
      const out = t05Sorted(fn(journal));
      return {
        ok: t03Canon(out) === t03Canon([t05Entry('op-1', 'ART-C', 'вручную', 'ждём файл в КАН', T03_TIME), t05Entry('op-2', 'ART-E', 'отправляется', '', T03_TIME)]),
        details: JSON.stringify(out)
      };
    });

  t05Scenario('93/05 E: one order with two articles gives two entries, one per article, each with its own day group\'s status',
    (h, fn) => {
      const journal = t05Journal(h, [
        t03Row(T03_DAY, 'MaxiStore', 'ART-A', 10, 'op-x', { status: T03_OK, answer: 'КАН принял 10,00', time: T03_TIME }),
        t03Row(T03_DAY, 'MaxiStore', 'ART-B', 20, 'op-x', { status: T03_ERR, answer: 'КАН недоступен', time: T03_TIME })
      ]);
      const out = t05Sorted(fn(journal));
      return {
        ok: t03Canon(out) === t03Canon([t05Entry('op-x', 'ART-A', 'принято', 'КАН принял 10,00', T03_TIME), t05Entry('op-x', 'ART-B', 'ошибка', 'КАН недоступен', T03_TIME)]),
        details: JSON.stringify(out)
      };
    });

  t05Scenario('93/05 F: no entry for a row without an OpID, a row written before item 93 (12 columns, or empty status), or a row with no cabinet or no article; an empty journal gives an empty list',
    (h, fn) => {
      const journal = t05Journal(h, [
        t03Row(T03_DAY, 'MaxiStore', 'ART-1', 5, '', { status: T03_OK, answer: 'КАН принял 5,00', time: T03_TIME }),
        t03Row(T03_DAY, 'MaxiStore', 'ART-2', 5, 'op-2'),
        t03Row(T03_DAY, 'MaxiStore', 'ART-3', 5, 'op-3', { status: '', answer: '', time: '' }),
        t03Row(T03_DAY, '', 'ART-4', 5, 'op-4', { status: T03_OK, answer: 'КАН принял 5,00', time: T03_TIME }),
        t03Row(T03_DAY, 'MaxiStore', '', 5, 'op-5', { status: T03_OK, answer: 'КАН принял 5,00', time: T03_TIME })
      ]);
      const out = fn(journal);
      const none = fn([]);
      return { ok: Array.isArray(out) && out.length === 0 && Array.isArray(none) && none.length === 0, details: JSON.stringify([out, none]) };
    });
})();

(function test93s05DoPost() {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'Code.gs'), 'utf8');
  const list = (src.match(/const LOCK_FREE_ACTIONS = \[([\s\S]*?)\];/) || [])[1] || '';
  const inList = /['"]getOzonCostKanMarkers['"]/.test(list);
  const hasCase = /case 'getOzonCostKanMarkers':/.test(src);
  check('93/05 H: doPost lists getOzonCostKanMarkers in LOCK_FREE_ACTIONS and dispatches it by its own `case`',
    inList && hasCase, 'listed: ' + inList + ', case: ' + hasCase);

  const t = t03Setup([t03One({ status: T03_OK, answer: 'КАН принял 233,67', time: T03_TIME, exported: T03_OLD_STAMP })]);
  t.h.setRegistrySheet('Сессии', [['Token', 'Username', 'Role', 'ExpiresAt'],
    ['tok-user', 'Кладовщик', 'user', String(Date.parse('2030-01-01T00:00:00Z'))]]);
  const frozen = t04Sheet(t);
  const want = [t05Entry('op-1', 'ART-C', 'принято', 'КАН принял 233,67', T03_TIME)];
  let out = null;
  let direct = null;
  let thrown = '';
  try {
    out = t.h.callDoPost({ action: 'getOzonCostKanMarkers', sessionToken: 'tok-user' });
    if (typeof t.h.context.getOzonCostKanMarkers === 'function') direct = t.h.context.getOzonCostKanMarkers();
  } catch (e) { thrown = String((e && e.message) || e); }
  check('93/05 H: a signed-in non-admin user gets success and data.markers (the list for the real journal; the call itself returns {markers}), outside the global lock, with no request to KAN and the sheet untouched',
    out !== null && out.status === 'success' && !!out.data && Array.isArray(out.data.markers) && t03Canon(out.data.markers) === t03Canon(want)
      && !!direct && t03Canon(direct) === t03Canon({ markers: want })
      && t.h.waitLockTimeouts().length === 0 && t.h.fetchesWhileLocked() === 0 && t.h.nestedLockTakes() === 0
      && t.h.fetchLog.length === 0 && t04Sheet(t) === frozen,
    thrown || JSON.stringify([out, direct, t.h.waitLockTimeouts(), t.h.fetchLog.length]));
})();

// ================= Bulk restore writes columns 11–13 like the single restore (2026-10-14) =================
// restoreMultipleArchivedItems used to stop at column 10, so «Пользователь», «groupId» and «isComponent»
// came back empty and a kit component row read as a plain expense row.
(function testBulkRestoreKitColumns() {
  const D = '2026-01-05T09:00:00Z';
  const cells = (r) => [r['Пользователь'], r['groupId'], r['isComponent']];
  const h = freshHarness();
  h.ensureTransSheet();
  h.ensureArchiveSheet();
  h.setKitSheet([{ kitSku: 'KITB', componentSku: 'COMPB', quantity: 2, kitType: 'virtual' }]);
  h.setStockSheet([{ article: 'COMPB', quantity: 20, avgCost: 5, capitalization: 100 },
                   { article: 'ARTB', quantity: 50, avgCost: 10, capitalization: 500 }]);
  h.commitTransaction([{ article: 'KITB', quantity: 3, price: 0 }], 'Расход', 'Склад', '', 'tester', D, '');
  h.commitTransaction([{ article: 'ARTB', quantity: 2, price: 10 }], 'Расход', 'Склад', '', 'tester', D, '');
  const before = {};
  h.dumpTransSheet().forEach(r => { before[r['ID']] = JSON.stringify(cells(r)); });
  const stockBefore = JSON.stringify(h.dumpStockSheet());
  const ids = Object.keys(before);
  const comp = h.dumpTransSheet().find(r => r['isComponent'] === true);
  const main = h.dumpTransSheet().find(r => r['Артикул'] === 'KITB');

  h.deleteMultipleTransactions(ids, 'tester');
  h.restoreMultipleArchivedItems(h.dumpArchive().map(a => a.archiveId), 'tester');
  const after = h.dumpTransSheet();
  check('Bulk restore 11-13: every restored row gets back «Пользователь», «groupId», «isComponent» as they were',
    after.length === 3 && !!comp && comp['groupId'] !== '' && after.every(r => before[r['ID']] === JSON.stringify(cells(r))),
    JSON.stringify(after.map(cells)) + ' vs ' + JSON.stringify(before));
  const parsed = h.getTransactions().rows;
  const pComp = parsed.find(r => r.id === comp['ID']);
  const pMain = parsed.find(r => r.id === main['ID']);
  check('Bulk restore 11-13: the read model sees the component row as a component of the kit\'s group again',
    pComp && pComp.isComponent === true && pMain && pMain.isComponent === false && pComp.groupId === pMain.groupId && pMain.groupId !== '',
    JSON.stringify(parsed.map(r => [r.article, r.groupId, r.isComponent])));
  check('Bulk restore 11-13: bulk delete + bulk restore leave «Остатки» byte-identical (stock arithmetic untouched)',
    JSON.stringify(h.dumpStockSheet()) === stockBefore, JSON.stringify(h.dumpStockSheet()));
  // A later single delete of the kit main row finds its component through groupId/isComponent:
  // both rows leave «История» and the component's stock comes back.
  h.deleteTransaction(main['ID'], 'tester');
  const compStock = h.stockOf('COMPB');
  check('Bulk restore 11-13: deleting the restored kit main row cascades to its component (20 pcs, 100 ₽ back)',
    h.dumpTransSheet().length === 1 && h.dumpTransSheet()[0]['Артикул'] === 'ARTB'
      && compStock && compStock.quantity === 20 && compStock.capitalization === 100,
    JSON.stringify(h.dumpTransSheet().map(r => r['Артикул'])) + ' ' + JSON.stringify(compStock));

  // The same archive payload restored by both paths writes the same 13 positional cells — with the fields and
  // without. (The late cells are compared by item 90/93 checks; the bulk path pads them, so the sheets differ in width.)
  const first13 = (r) => h.TRANS_HEADERS.concat(['groupId', 'isComponent']).map(k => r[k]);
  const viaBoth = (payload) => ['single', 'bulk'].map(path => {
    const t = freshHarness();
    t.ensureTransSheet();
    t.ensureArchiveSheet();
    t.setStockSheet([{ article: 'COMPB', quantity: 20, avgCost: 5, capitalization: 100 }]);
    t.archiveItem('Transaction', payload, 'tester');
    const archiveId = t.dumpArchive()[0].archiveId;
    if (path === 'single') t.restoreArchivedItem(archiveId, 'tester'); else t.restoreMultipleArchivedItems([archiveId], 'tester');
    return JSON.stringify(t.dumpTransSheet().map(first13));
  });
  const basePayload = { id: 'ID-B-1', date: D, type: 'Расход', article: 'COMPB', quantity: 6, price: 0, writeOffCost: 30, total: 0, destination: 'Склад', deliveryDate: '' };
  const withFields = viaBoth(Object.assign({ user: 'tester', groupId: 'G-1', isComponent: true }, basePayload));
  check('Bulk restore 11-13: a component payload restores to the same cells via restoreArchivedItem and restoreMultipleArchivedItems',
    withFields[0] === withFields[1] && withFields[1].indexOf('"G-1"') !== -1, withFields.join(' | '));
  const oldPayload = viaBoth(basePayload);
  check('Bulk restore 11-13: an old payload without the fields restores with empty user/groupId and isComponent false, same as the single path',
    oldPayload[0] === oldPayload[1] && JSON.stringify(JSON.parse(oldPayload[1])[0].slice(10)) === JSON.stringify(['', '', false]), oldPayload.join(' | '));
})();

// ================= Admin password from a Script Property: no password written in Code.gs =================
// The repository is public. «Админ» gets its password only from the Script Property
// auth_newAdminPassword, applied on the next login and then deleted.
(function testAdminPasswordProperty() {
  const sha = (s) => require('crypto').createHash('sha256').update(s, 'utf8').digest('hex');
  const setup = (userRows) => {
    const h = freshHarness();
    h.setNow('2026-10-14T09:00:00Z');
    h.setRegistrySheet('Пользователи', [['Username', 'Password', 'Role']].concat(userRows));
    h.setRegistrySheet('Сессии', [['Token', 'Username', 'Role', 'ExpiresAt']]);
    return h;
  };
  const prop = (h) => h.context.PropertiesService.getScriptProperties().getProperty('auth_newAdminPassword');
  const loginError = (h, u, p) => { try { h.context.loginUser(u, p); return ''; } catch (e) { return String(e.message || e); } };
  // A refused login is a failed check, not a crash of the whole stand.
  const loginUserOf = (h, u, p) => { try { return h.context.loginUser(u, p).user; } catch (e) { return { error: String(e.message || e) }; } };

  // 1. No users, no property: nobody logs in and no user is created.
  {
    const h = setup([]);
    const err = loginError(h, 'Админ', 'Any-1');
    const rows = h.dumpRegistrySheet('Пользователи');
    check('Admin password: no users and no property → login refused naming the property, no user created',
      err.indexOf('auth_newAdminPassword') !== -1 && rows.length === 1, 'err=' + err + ' rows=' + rows.length);
  }
  // 2. No users, property set with stray spaces: «Админ» is created from the trimmed value.
  {
    const h = setup([]);
    h.setScriptProperty('auth_newAdminPassword', '  Bootstrap-1  ');
    const user = loginUserOf(h, 'админ', 'Bootstrap-1');
    const rows = h.dumpRegistrySheet('Пользователи');
    check('Admin password: no users + property → «Админ» created with the trimmed password, login succeeds, property deleted',
      user.role === 'admin' && rows.length === 2 && rows[1][0] === 'Админ' && rows[1][1] === sha('Bootstrap-1')
        && rows[1][2] === 'admin' && prop(h) === null,
      JSON.stringify(user) + ' ' + JSON.stringify(rows.map(r => [r[0], String(r[1]).slice(0, 8), r[2]])) + ' prop=' + prop(h));
  }
  // 3. Existing «Админ»: any login attempt replaces its password in place; the old one stops working.
  {
    const h = setup([['Админ', sha('Old-1'), 'admin'], ['Кладовщик', sha('Worker-1'), 'user']]);
    h.setScriptProperty('auth_newAdminPassword', 'New-1');
    const err = loginError(h, 'Админ', 'Old-1');
    const rows = h.dumpRegistrySheet('Пользователи');
    const okNew = loginUserOf(h, 'Админ', 'New-1').username === 'Админ';
    check('Admin password: property set → «Админ» password replaced in place, old one refused, other users untouched, property deleted',
      err.indexOf('Неверное имя') !== -1 && okNew && rows.length === 3 && rows[1][1] === sha('New-1')
        && rows[2][1] === sha('Worker-1') && prop(h) === null,
      'err=' + err + ' okNew=' + okNew + ' rows=' + rows.length + ' prop=' + prop(h));
  }
  // 4. No property: login behaves as before.
  {
    const h = setup([['Админ', sha('Old-1'), 'admin']]);
    const ok = loginUserOf(h, ' админ ', 'Old-1').role === 'admin';
    const err = loginError(h, 'Админ', 'Wrong-1');
    const rows = h.dumpRegistrySheet('Пользователи');
    check('Admin password: no property → right password logs in, wrong one refused, sheet unchanged',
      ok && err.indexOf('Неверное имя') !== -1 && rows.length === 2 && rows[1][1] === sha('Old-1'),
      'ok=' + ok + ' err=' + err + ' rows=' + rows.length);
  }
  // 5. No hashPassword call with a written-in password anywhere in Code.gs.
  {
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'Code.gs'), 'utf8');
    const n = (src.match(/hashPassword\(\s*['"`]/g) || []).length;
    check('Admin password: Code.gs has no hashPassword call with a string literal', n === 0, 'literal calls: ' + n);
  }
})();

// ================= Item 97 ticket 01, part B: kopecks of the shipment extras (96.12, 96.13) =================
// 96.12: every row's share was rounded on its own — 1.00 over three 1-pc rows gave 0.99, 2.00 gave 2.01.
// The rows of one order now get the largest-remainder split (splitByQuantityGs), on commit and in
// «Вся отгрузка»; a re-spread takes off the share a row REALLY carries — rows written by the old
// per-row rounding exist. 96.13: service sums were rounded to whole roubles (100.40 → 100).

function t0bShipment(destination, extras) {
  const h = freshHarness();
  h.ensureTransSheet();
  h.ensureArchiveSheet();
  h.setOzonCostSheet([]);
  h.setStockSheet(['A', 'B', 'C'].map(a => ({ article: a, quantity: 10, avgCost: 100, capitalization: 1000 })));
  h.commitTransaction(['A', 'B', 'C'].map(a => ({ article: a, quantity: 1, price: 100 })), 'Расход', destination,
    '2026-10-19', 'tester', '2026-10-19T07:00:00Z', 't0b-op', extras === undefined ? null : extras);
  return h;
}
const t0bRows = (h) => h.getTransactions().rows.filter(t => t.type === 'Расход' && !t.isComponent)
  .sort((x, y) => x.article.localeCompare(y.article));
const t0bExtras = (h) => Math.round(t0bRows(h).reduce((s, t) => s + t.total - 100, 0) * 100) / 100;
const t0bOther = (value) => ({ packagingMode: 'batch', packagingValue: 0, otherMode: 'batch', otherValue: value, services: [] });

(function testT0bCommitSplitsExactly() {
  const one = t0bShipment('Ozon (MaxiStore) [Прочее: 1₽]');
  check('T0-B: commit spreads 1.00 over three 1-pc rows to the kopeck', t0bExtras(one) === 1,
    t0bRows(one).map(t => t.total).join(' / '));
  const two = t0bShipment('Ozon (MaxiStore) [Прочее: 2₽]');
  check('T0-B: commit spreads 2.00 over three 1-pc rows to the kopeck', t0bExtras(two) === 2,
    t0bRows(two).map(t => t.total).join(' / '));
  const stated = t0bShipment('Ozon (MaxiStore) [Общая поставка: доля 3 из 6 шт.]', 1);
  check('T0-B: a stated order share (combined shipment) is spread to the kopeck too', t0bExtras(stated) === 1,
    t0bRows(stated).map(t => t.total).join(' / '));
  check('T0-B: the write-off cost and the stock do not move with the split',
    t0bRows(two).every(t => t.writeOffCost === 100) && two.stockOf('A').quantity === 9 && two.stockOf('A').capitalization === 900,
    JSON.stringify(two.stockOf('A')));
})();

(function testT0bWholeShipmentAndRepeat() {
  const h = t0bShipment('Ozon (MaxiStore) [Прочее: 1₽]');
  const res = h.updateShipmentExtras(Object.assign({ id: t0bRows(h)[0].id }, t0bOther(2)), 'tester');
  check('T0-B: «Вся отгрузка» 1.00 → 2.00 over three rows sums to the kopeck', t0bExtras(h) === 2 && res.newTotal === 2,
    t0bRows(h).map(t => t.total).join(' / ') + ' newTotal ' + res.newTotal);
  const before = t0bRows(h).map(t => t.total + '/' + t.price).join(' ');
  const again = h.updateShipmentExtras(Object.assign({ id: t0bRows(h)[0].id }, t0bOther(2)), 'tester');
  const after = t0bRows(h).map(t => t.total + '/' + t.price).join(' ');
  check('T0-B: a repeat save of the same extras moves no kopeck', after === before && again.changedRows === 0,
    before + ' → ' + after + ' changed ' + again.changedRows);
  h.updateShipmentExtras(Object.assign({ id: t0bRows(h)[0].id }, t0bOther(1)), 'tester');
  check('T0-B: back to 1.00 sums to the kopeck', t0bExtras(h) === 1, t0bRows(h).map(t => t.total).join(' / '));
  check('T0-B: «Вся отгрузка» moves neither stock nor write-off cost',
    t0bRows(h).every(t => t.writeOffCost === 100 && t.quantity === 1) && h.stockOf('B').capitalization === 900,
    JSON.stringify(h.stockOf('B')));
})();

(function testT0bOldRoundingRows() {
  // Rows written before this fix: each carries its own rounded share, 0.33 + 0.33 + 0.33 of 1.00.
  const h = t0bShipment('Ozon (MaxiStore) [Прочее: 1₽]');
  const sheet = h.ensureTransSheet();
  const data = sheet.__dump();
  const hdr = data[0].map(x => String(x).trim());
  for (let r = 1; r < data.length; r++) {
    if (String(data[r][hdr.indexOf('Тип')]) !== 'Расход') continue;
    sheet.getRange(r + 1, hdr.indexOf('Сумма') + 1).setValue(100.33);
    sheet.getRange(r + 1, hdr.indexOf('Цена') + 1).setValue(100.33);
  }
  h.updateShipmentExtras(Object.assign({ id: t0bRows(h)[0].id }, t0bOther(2)), 'tester');
  check('T0-B: an old-rounding shipment re-spread to 2.00 sums to the kopeck (its real shares come off)',
    t0bExtras(h) === 2, t0bRows(h).map(t => t.total).join(' / '));
})();

(function testT0bServiceKopecks() {
  const h = freshHarness();
  h.ensureTransSheet();
  h.ensureArchiveSheet();
  h.setOzonCostSheet([]);
  h.setStockSheet([{ article: 'A', quantity: 10, avgCost: 100, capitalization: 1000 }]);
  h.commitTransaction([{ article: 'A', quantity: 1, price: 100 }], 'Расход', 'Other', '', 'tester',
    '2026-10-19T07:00:00Z', 't0b-svc', null);
  const id = h.getTransactions().rows[0].id;
  const res = h.updateShipmentExtras({ id, packagingMode: 'batch', packagingValue: 0, otherMode: 'batch', otherValue: 0,
    services: [{ name: 'Packing', quantity: 1, unitCost: 100.40 }] }, 'tester');
  const row = h.getTransactions().rows[0];
  check('T0-B: a service of 100.40 keeps its kopecks (total, price, text)',
    res.newTotal === 100.4 && row.price === 200.4 && row.total === 200.4 && row.destination.indexOf('Packing x1 (100.40₽)') !== -1,
    res.newTotal + ' ' + row.price + ' ' + row.destination);
  const res3 = h.updateShipmentExtras({ id, packagingMode: 'batch', packagingValue: 0, otherMode: 'batch', otherValue: 0,
    services: [{ name: 'Packing', quantity: 3, unitCost: 100.01 }] }, 'tester');
  const row3 = h.getTransactions().rows[0];
  check('T0-B: 100.01 × 3 keeps every kopeck', res3.newTotal === 300.03 && row3.total === 400.03
    && row3.destination.indexOf('Packing x3 (300.03₽)') !== -1, res3.newTotal + ' ' + row3.total + ' ' + row3.destination);
  // A re-save from the text as parsed (the window sends the stored entries back) keeps the sum.
  const parsed = h.context.parseShipmentExtrasGs(row3.destination).services;
  const res3b = h.updateShipmentExtras({ id, packagingMode: 'batch', packagingValue: 0, otherMode: 'batch', otherValue: 0,
    services: parsed }, 'tester');
  check('T0-B: re-saving the parsed 300.03 changes nothing', res3b.newTotal === 300.03 && res3b.changedRows === 0,
    res3b.newTotal + ' changed ' + res3b.changedRows);
})();

(function testT0bServiceTextCommit() {
  const h = freshHarness();
  h.ensureTransSheet();
  h.ensureArchiveSheet();
  h.setOzonCostSheet([]);
  h.setStockSheet([{ article: 'A', quantity: 10, avgCost: 100, capitalization: 1000 }]);
  // The confirmation window writes the services into the text; the commit reads them from there.
  h.commitTransaction([{ article: 'A', quantity: 1, price: 100 }], 'Расход', 'Ozon (MaxiStore) [Услуги: Packing x1 (100.40₽)]',
    '2026-10-19', 'tester', '2026-10-19T07:00:00Z', 't0b-txt', null);
  const row = h.getTransactions().rows[0];
  check('T0-B: a commit with a 100.40 service in the text prices the piece at 200.40', row.price === 200.4 && row.total === 200.4,
    row.price + '/' + row.total);
})();

(function testT0bOldWholeRoubleTexts() {
  const h = freshHarness();
  const total = (d) => h.context.parseAdditionalCostsFromDestination(d);
  const cases = [
    ['Яндекс [Упаковка: 40 шт. x 6₽ = 240₽ | Услуги: Доставка по городу 1 короб x4 (636₽)]', 876],
    ['Клиент [Доп. услуги: Маркировка x2 (40₽)]', 40],
    // Written by Math.round(33.33 × 3): the old parser rounded the sum back to 100, the new one must too.
    ['Ozon [Услуги: Packing x3 (100₽)]', 100],
    ['Ozon [Услуги: Pallet x7 (1300₽), Box x3 (50₽)]', 1350]
  ];
  const bad = cases.filter(c => total(c[0]) !== c[1]).map(c => c[0] + ' → ' + total(c[0]));
  check('T0-B: old whole-rouble texts give the same totals as before', bad.length === 0, bad.join('; '));
  const e = h.context.parseShipmentExtrasGs('Ozon [Услуги: Packing x3 (100₽)]');
  const rebuilt = h.context.buildDestinationGs(e, e, 3);
  check('T0-B: an old whole-rouble service text is rebuilt unchanged', rebuilt === 'Ozon [Услуги: Packing x3 (100₽)]', rebuilt);
})();

(function testT0bParsedServiceResaveAndKits() {
  // (1) The window sends the parsed entries back: 100 / 3 is not rounded to 33.33, so the sum stays 100.
  const h = freshHarness();
  h.ensureTransSheet();
  h.ensureArchiveSheet();
  h.setOzonCostSheet([]);
  h.setStockSheet([{ article: 'A', quantity: 10, avgCost: 100, capitalization: 1000 }]);
  h.commitTransaction([{ article: 'A', quantity: 1, price: 100 }], 'Расход', 'Ozon [Услуги: Packing x3 (100₽)]', '', 'tester',
    '2026-10-19T07:00:00Z', 't0b-resave', null);
  const row = h.getTransactions().rows[0];
  const parsed = h.context.parseShipmentExtrasGs(row.destination).services;
  const res = h.updateShipmentExtras({ id: row.id, packagingMode: 'batch', packagingValue: 0, otherMode: 'batch', otherValue: 0,
    services: parsed }, 'tester');
  const after = h.getTransactions().rows[0];
  check('T0-B: re-saving an old «x3 (100₽)» keeps 100 (the parsed unit cost is not rounded)',
    res.newTotal === 100 && res.changedRows === 0 && after.total === 200 && after.destination === 'Ozon [Услуги: Packing x3 (100₽)]',
    res.newTotal + ' changed ' + res.changedRows + ' ' + after.total + ' ' + after.destination);

  // (2) Two virtual kits and a plain row carrying the OLD per-row shares: each kit row's evidence is
  // its own components (same groupId), so every real share 0.33 comes off and 2.00 lands exactly.
  const k = freshHarness();
  k.ensureTransSheet();
  k.ensureArchiveSheet();
  k.setOzonCostSheet([]);
  k.setStockSheet([
    { article: 'P1', quantity: 100, avgCost: 40, capitalization: 4000 },
    { article: 'P2', quantity: 100, avgCost: 30, capitalization: 3000 },
    { article: 'C', quantity: 100, avgCost: 100, capitalization: 10000 }
  ]);
  k.setKitSheet([
    { kitSku: 'K1', componentSku: 'P1', quantity: 1, kitType: 'virtual' },
    { kitSku: 'K2', componentSku: 'P2', quantity: 2, kitType: 'virtual' }
  ]);
  k.commitTransaction([{ article: 'K1', quantity: 1, price: 0 }, { article: 'K2', quantity: 1, price: 0 }, { article: 'C', quantity: 1, price: 100 }],
    'Расход', 'Ozon (MaxiStore) [Прочее: 1₽]', '2026-10-19', 'tester', '2026-10-19T07:00:00Z', 't0b-kits', null);
  const sheet = k.ensureTransSheet();
  const data = sheet.__dump();
  const hdr = data[0].map(x => String(x).trim());
  const col = (name) => hdr.indexOf(name);
  const isComp = (r) => String(data[r][col('isComponent')]).toLowerCase() === 'true';
  const expenseRows = [];
  for (let r = 1; r < data.length; r++) if (String(data[r][col('Тип')]) === 'Расход') expenseRows.push(r);
  const goodsOf = (r) => expenseRows.reduce((sum, c) => (isComp(c) && data[r][col('groupId')] && data[c][col('groupId')] === data[r][col('groupId')]
    ? sum + Number(data[c][col('Сумма')]) : sum), Number(data[r][col('Себестоимость списания')]));
  expenseRows.forEach(r => {
    if (isComp(r)) return;
    const goods = goodsOf(r);
    sheet.getRange(r + 1, col('Сумма') + 1).setValue(Math.round((goods + 0.33) * 100) / 100);
    sheet.getRange(r + 1, col('Цена') + 1).setValue(Math.round((goods + 0.33) * 100) / 100);
  });
  const kitRow = k.getTransactions().rows.find(t => t.type === 'Расход' && t.article === 'K1');
  k.updateShipmentExtras({ id: kitRow.id, packagingMode: 'batch', packagingValue: 0, otherMode: 'batch', otherValue: 2, services: [] }, 'tester');
  const rowsAfter = k.getTransactions().rows.filter(t => t.type === 'Расход');
  const mainSum = rowsAfter.filter(t => !t.isComponent).reduce((s, t) => s + t.total, 0);
  const compSum = rowsAfter.filter(t => t.isComponent).reduce((s, t) => s + t.total, 0);
  const plainGoods = rowsAfter.filter(t => !t.isComponent && t.article === 'C').reduce((s, t) => s + t.writeOffCost, 0);
  const extrasLeft = Math.round((mainSum - compSum - plainGoods) * 100) / 100;
  check('T0-B: kits and a plain row with old per-row shares re-spread to 2.00 sum to the kopeck (evidence by groupId)',
    extrasLeft === 2, 'extras ' + extrasLeft + ' / ' + rowsAfter.filter(t => !t.isComponent).map(t => t.article + ':' + t.total).join(' '));
})();

// Independent re-check of part B (tester). The extras of an order are the part of «Сумма» above the goods.
const t0bExtrasOf = (rows) => Math.round(rows.filter(t => !t.isComponent).reduce((s, t) => {
  const comps = rows.filter(c => c.isComponent && t.groupId && c.groupId === t.groupId).reduce((x, c) => x + c.total, 0);
  return s + t.total - t.writeOffCost - comps;
}, 0) * 100) / 100;

(function testT0bCombinedShipmentOrdersAndCostJournal() {
  // A combined shipment as ConfirmModal writes it: one commit per order with the order's share of the batch
  // total. 1.00 over orders of 3 / 2 / 1 pieces = 0.50 / 0.33 / 0.17 (kopecks 50 / 33 / 17 by largest remainder);
  // 2.00 = 1.00 / 0.67 / 0.33. Inside order 1 that is 0.34 / 0.33 / 0.33 (the leftover kopeck to the earlier row).
  const h = freshHarness();
  h.ensureTransSheet();
  h.ensureArchiveSheet();
  h.setOzonCostSheet([]);
  h.setStockSheet(['A', 'B', 'C'].map(a => ({ article: a, quantity: 500, avgCost: 100, capitalization: 50000 })));
  h.setOzonStocksSheet(['A', 'B', 'C'].map((a, i) => ({ cabinet: 'MaxiStore', article: a, available: 900, sku: String(111 * (i + 1)) })));
  const labels = ['1-1', '2-1', '3-1'];
  const orders = [['A', 'B', 'C'], ['A', 'B'], ['C']];
  const shares = [0.5, 0.33, 0.17];
  orders.forEach((arts, i) => {
    const note = `[Общая поставка: заявки ${labels.map(l => '№ ' + l).join(', ')}; доля этой заявки ${arts.length} из 6 шт., ${shares[i].toFixed(2)} руб. из 1.00 руб.]`;
    h.commitTransaction(arts.map(a => ({ article: a, quantity: 1, price: 100 })), 'Расход',
      'Ozon (MaxiStore) [Прочее: 1₽] ' + note, '2026-10-19', 'tester', '2026-10-19T07:00:00Z', `t0b-comb-${i + 1}`, shares[i], undefined, '', 't0b-comb');
  });
  const rows = () => h.getTransactions().rows.filter(t => t.type === 'Расход');
  const perOrder = () => orders.map((_, i) => t0bExtrasOf(rows().filter(t => t.opId === `t0b-comb-${i + 1}`)));
  const createdPerOrder = JSON.stringify(perOrder());

  const journalBefore = h.dumpOzonCost().length;
  const res = h.updateShipmentExtras(Object.assign({ id: rows()[0].id }, t0bOther(2)), 'tester');
  check('T0-B: a combined shipment — every order sums to its share on create and to its new share after «Вся отгрузка»',
    createdPerOrder === '[0.5,0.33,0.17]' && JSON.stringify(perOrder()) === '[1,0.67,0.33]' && res.newTotal === 2
      && JSON.stringify(res.orders.map(o => o.newShare)) === '[1,0.67,0.33]'
      && rows().filter(t => t.opId === 't0b-comb-1').map(t => t.total).sort().join(' ') === '100.33 100.33 100.34',
    createdPerOrder + ' -> ' + JSON.stringify(perOrder()) + ' ' + JSON.stringify(res.orders.map(o => o.newShare)));

  // The journal «Себестоимость Озон» is corrected with the per-row price of each order, not a stale one.
  const lastCost = (article, opId) => {
    const entries = h.dumpOzonCost().filter(j => j['Артикул'] === article && j['OpID'] === opId);
    return entries.length ? entries[entries.length - 1]['Себестоимость отгрузки'] : null;
  };
  const stale = rows().filter(t => lastCost(t.article, t.opId) !== t.price).map(t => t.opId + '/' + t.article + ' row ' + t.price + ' journal ' + lastCost(t.article, t.opId));
  check('T0-B: the Ozon cost journal gets the corrected per-row price of every row after «Вся отгрузка»',
    res.costRowsAppended === 6 && h.dumpOzonCost().length === journalBefore + 6 && stale.length === 0,
    'appended ' + res.costRowsAppended + ' journal ' + journalBefore + ' -> ' + h.dumpOzonCost().length + ' stale: ' + stale.join('; '));
})();

(function testT0bCommitKitsAndSkippedItemInSplit() {
  // Two virtual kits and a plain row share 1.00 as 0.34 / 0.33 / 0.33 by the ITEM index, with a skipped
  // item (status not ok) between them: the shares must stay with their own items. Components carry none.
  const k = freshHarness();
  k.ensureTransSheet();
  k.ensureArchiveSheet();
  k.setOzonCostSheet([]);
  k.setStockSheet([
    { article: 'P1', quantity: 100, avgCost: 40, capitalization: 4000 },
    { article: 'P2', quantity: 100, avgCost: 30, capitalization: 3000 },
    { article: 'C', quantity: 100, avgCost: 100, capitalization: 10000 }
  ]);
  k.setKitSheet([
    { kitSku: 'K1', componentSku: 'P1', quantity: 1, kitType: 'virtual' },
    { kitSku: 'K2', componentSku: 'P2', quantity: 2, kitType: 'virtual' }
  ]);
  k.commitTransaction([{ article: 'K1', quantity: 1, price: 0 }, { article: 'ZZ', quantity: 5, price: 1, status: 'error' },
    { article: 'K2', quantity: 1, price: 0 }, { article: 'C', quantity: 1, price: 100 }],
  'Расход', 'Ozon (MaxiStore) [Прочее: 1₽]', '2026-10-19', 'tester', '2026-10-19T07:00:00Z', 't0b-kitsplit', null);
  const rows = k.getTransactions().rows.filter(t => t.type === 'Расход');
  const by = (a) => rows.find(t => t.article === a);
  check('T0-B: kits and a plain row share 1.00 as 0.34 / 0.33 / 0.33 on commit, a skipped item in between keeps its place',
    by('K1').total === 40.34 && by('K2').total === 60.33 && by('C').total === 100.33
      && by('P1').total === 40 && by('P2').total === 60 && t0bExtrasOf(rows) === 1
      && rows.filter(t => !t.isComponent).every(t => t.additionalCosts === 1),
    rows.map(t => t.article + ':' + t.total).join(' '));
})();

(function testT0bPencilResaveThenWholeShipment() {
  // A pencil re-save that changes no amount deletes the row and writes it again at the END of the sheet,
  // so its place in the largest-remainder split changes. «Вся отгрузка» after it must still sum to the kopeck.
  const h = t0bShipment('Ozon (MaxiStore) [Прочее: 1₽]');
  const a = t0bRows(h)[0];
  const totalsBefore = t0bRows(h).map(t => t.article + ':' + t.total).join(' ');
  h.updateTransaction(a.id, { article: 'A', quantity: 1, price: a.price, writeOffCost: a.writeOffCost, type: 'Расход',
    destination: a.destination, deliveryDate: '2026-10-19', date: a.date }, 'tester');
  const totalsAfterPencil = t0bRows(h).map(t => t.article + ':' + t.total).join(' ');
  h.updateShipmentExtras(Object.assign({ id: t0bRows(h)[0].id }, t0bOther(2)), 'tester');
  // The first part is the premise: the pencil itself moved no amount, only the row's place in the sheet.
  check('T0-B: «Вся отгрузка» after a no-op pencil re-save (the row moves to the end of the sheet) still sums to 2.00',
    totalsAfterPencil === totalsBefore && t0bExtras(h) === 2,
    totalsBefore + ' -> ' + totalsAfterPencil + ' -> ' + t0bRows(h).map(t => t.article + ':' + t.total).join(' ') + ' extras ' + t0bExtras(h));
})();

(function testT0bHandEditedRowTakesOffTheSplitShare() {
  // A row whose share is neither the old per-row rounding (0.33) nor its split share (0.34): hand-edited
  // «Сумма» 130. The evidence is no use, so the split share b = 0.34 comes off; a repeat save moves nothing.
  const h = t0bShipment('Ozon (MaxiStore) [Прочее: 1₽]');
  const sheet = h.ensureTransSheet();
  const data = sheet.__dump();
  const hdr = data[0].map(x => String(x).trim());
  for (let r = 1; r < data.length; r++) {
    if (String(data[r][hdr.indexOf('Артикул')]) !== 'A') continue;
    sheet.getRange(r + 1, hdr.indexOf('Сумма') + 1).setValue(130);
    sheet.getRange(r + 1, hdr.indexOf('Цена') + 1).setValue(130);
  }
  h.updateShipmentExtras(Object.assign({ id: t0bRows(h)[0].id }, t0bOther(2)), 'tester');
  const totals = t0bRows(h).map(t => t.article + ':' + t.total).join(' ');
  const again = h.updateShipmentExtras(Object.assign({ id: t0bRows(h)[0].id }, t0bOther(2)), 'tester');
  check('T0-B: a hand-edited row loses its split share (not the per-row one); a repeat save then moves no kopeck',
    totals === 'A:130.33 B:100.67 C:100.66' && again.changedRows === 0
      && t0bRows(h).map(t => t.article + ':' + t.total).join(' ') === totals,
    totals + ' repeat changed ' + again.changedRows);
})();

(function testT0bEvidenceWindowIsOneKopeckEachWay() {
  // 1.00 over three 1-pc rows: the exact share is 33.33 kopecks, so a carried share of 33 or 34 kopecks is taken as
  // real (any share either rule could give); 32 (floor - 1) and 35 (ceil + 1) are not, nor is 38 (+0.05): there the split
  // share b of the row's position (0.34 / 0.33 / 0.33) comes off and the deviation stays on the row.
  const setTotal = (h, article, total) => {
    const sheet = h.ensureTransSheet();
    const data = sheet.__dump();
    const hdr = data[0].map(x => String(x).trim());
    for (let r = 1; r < data.length; r++) {
      if (String(data[r][hdr.indexOf('Артикул')]) !== article) continue;
      sheet.getRange(r + 1, hdr.indexOf('Сумма') + 1).setValue(total);
      sheet.getRange(r + 1, hdr.indexOf('Цена') + 1).setValue(total);
    }
  };
  const edge = t0bShipment('Ozon (MaxiStore) [Прочее: 1₽]');
  setTotal(edge, 'A', 100.35);
  setTotal(edge, 'B', 100.32);
  setTotal(edge, 'C', 100.33);
  edge.updateShipmentExtras(Object.assign({ id: t0bRows(edge)[0].id }, t0bOther(2)), 'tester');
  const edgeTotals = t0bRows(edge).map(t => t.article + ':' + t.total).join(' ');
  check('T0-B: the evidence window is floor..ceil of the exact share: 35 and 32 kopecks are refused, 33 accepted',
    edgeTotals === 'A:100.68 B:100.66 C:100.66', edgeTotals);

  const far = t0bShipment('Ozon (MaxiStore) [Прочее: 1₽]');
  setTotal(far, 'A', 100.38);
  far.updateShipmentExtras(Object.assign({ id: t0bRows(far)[0].id }, t0bOther(2)), 'tester');
  const farTotals = t0bRows(far).map(t => t.article + ':' + t.total).join(' ');
  const farAgain = far.updateShipmentExtras(Object.assign({ id: t0bRows(far)[0].id }, t0bOther(2)), 'tester');
  check('T0-B: a row 0.05 off its exact share keeps its deviation (0.04) through «Вся отгрузка»; b comes off, not d',
    farTotals === 'A:100.71 B:100.67 C:100.66' && t0bExtras(far) === 2.04 && farAgain.changedRows === 0,
    farTotals + ' extras ' + t0bExtras(far) + ' repeat changed ' + farAgain.changedRows);
})();

// ================= Item 97 ticket 01, part C1: a retry after a partial failure deducts nothing twice (96.10), server side =================
// Written TEST-FIRST against the agreed interface (owner-approved design, ticket 01 «Comments»):
//  - commitTransaction with an opId saves a memo in Script Properties (keys `pendingOp:<opId>…`, every value <= 9000
//    characters, split into several properties when long) BEFORE its first stock write: the call's content and, per
//    touched «Остатки» row, the values before and after. Stages: s1 «Остатки» write, s2 «История» append, s3 the
//    «Себестоимость Озон» journal append. Every stage done -> the memo is deleted; a journal failure (returned as
//    costJournalError) leaves it.
//  - A retry with the same opId reads the memo first: stock = before -> runs normally; = after and no «История» rows ->
//    writes «История» and the journal, no second deduction; «История» rows but no journal row -> completes the journal;
//    neither before nor after -> a Russian error, nothing written, the memo stays. No memo -> idempotentHit as before.
//  - getPendingOperations() -> [{ opId, startedAt, user, type, destination, articles: [{ article, quantity }],
//    stage: 'stock' | 'history' | 'journal' | 'conflict', canComplete, canCancel }]; getInitialData gains
//    `pendingOperations` for every user; doPost 'resolvePendingOperation' { opId, action: complete | cancel | dismiss },
//    ADMIN only. The numbers are the ticket's: 10 pcs @ 100, expense 2 to an Ozon destination -> 8 pcs / 800.
// Failures are injected on the sheet write itself (the review's probe A5): the first setValues of the stage throws.

const T0C_DEST = 'Ozon (MaxiStore)';
function t0cStand() {
  const h = freshHarness();
  h.ensureTransSheet();
  h.ensureArchiveSheet();
  h.setOzonCostSheet([]);
  h.setStockSheet([{ article: 'A', quantity: 10, avgCost: 100, capitalization: 1000 }]);
  h.setOzonStocksSheet([{ cabinet: 'MaxiStore', article: 'A', available: 500, sku: '111' }]);
  const far = String(Date.parse('2030-01-01T00:00:00Z'));
  h.setRegistrySheet('Сессии', [['Token', 'Username', 'Role', 'ExpiresAt'],
    ['tok-user', 'Кладовщик', 'user', far], ['tok-admin', 'boss', 'admin', far]]);
  return h;
}
const t0cCommit = (h, opId, items, dest) => h.commitTransaction(items || [{ article: 'A', quantity: 2, price: 100 }], 'Расход',
  dest || T0C_DEST, '2026-10-19', 'tester', '2026-10-19T07:00:00Z', opId, null);
function t0cFailOnce(sheet, matches) {
  const original = sheet.getRange.bind(sheet);
  let armed = true;
  sheet.getRange = (...args) => {
    const range = original(...args);
    const setValues = range.setValues.bind(range);
    range.setValues = (rows) => {
      if (armed && matches(args)) { armed = false; throw new Error('Injected write failure'); }
      return setValues(rows);
    };
    return range;
  };
}
const t0cFailStock = (h) => t0cFailOnce(h.getRegistrySheet('Остатки'), (a) => a[0] > 1);
const t0cFailHistory = (h) => t0cFailOnce(h.ensureTransSheet(), (a) => a[0] > 1 && a[1] === 1);
const t0cFailJournal = (h) => t0cFailOnce(h.getRegistrySheet('Себестоимость Озон'), (a) => a[0] > 1);
const t0cThrows = (fn) => { try { fn(); return ''; } catch (e) { return String((e && e.message) || e) || 'threw'; } };
const t0cMemo = (h) => h.context.PropertiesService.getScriptProperties().getProperties();
const t0cMemoKeys = (h) => Object.keys(t0cMemo(h)).filter(k => k.indexOf('pendingOp:') === 0);
const t0cRows = (h, opId) => h.getTransactions().rows.filter(t => t.type === 'Расход' && t.opId === opId);
const t0cJournal = (h, opId) => h.dumpOzonCost().filter(r => r['OpID'] === opId);
// null when getPendingOperations is missing or broken, so the conditions that do not need it still report on their own.
const t0cPending = (h) => { try { return JSON.parse(JSON.stringify(h.context.getPendingOperations())); } catch (e) { return null; } };
const t0cNoPending = (h) => { const p = t0cPending(h); return Array.isArray(p) && p.length === 0; };
const t0cStock = (h, article) => { const s = h.stockOf(article || 'A'); return s.quantity + '/' + s.capitalization; };
const t0cResolve = (h, token, opId, action) => h.callDoPost({ action: 'resolvePendingOperation', sessionToken: token, data: { opId: opId, action: action } });
const t0cPendingIs = (p, opId, stage, canComplete, canCancel, user) => Array.isArray(p) && p.length === 1 && p[0].opId === opId && p[0].stage === stage
  && p[0].canComplete === canComplete && p[0].canCancel === canCancel && p[0].user === (user || 'tester') && p[0].type === 'Расход'
  && p[0].destination === T0C_DEST && JSON.stringify(p[0].articles) === '[{"article":"A","quantity":2}]' && !!p[0].startedAt;
// The commit as the BROWSER sends it: the doPost 'commit' action, user «Кладовщик» (token tok-user). Since the caller
// bookkeeping refinement only a memo saved under this action can be completed by the admin; a direct call of
// commitTransaction (the other helpers here) is "any other caller".
const T0C_BROWSER_USER = 'Кладовщик';
const t0cBrowserCommit = (h, opId, extra) => h.callDoPost(Object.assign({ action: 'commit', sessionToken: 'tok-user', type: 'Расход',
  destination: T0C_DEST, deliveryDate: '2026-10-19', opId: opId, data: [{ article: 'A', quantity: 2, price: 100 }] }, extra || {}));
// Runs `build` (returns { conds: { description: boolean }, note }); an exception fails the check with its text instead of
// aborting the whole stand run. The details line names every failed condition.
function t0cCheck(name, build) {
  let conds = {};
  let note = '';
  try { const r = build(); conds = r.conds; note = r.note || ''; }
  catch (e) { conds = { 'ran to the end': false }; note = 'threw: ' + String((e && e.message) || e); }
  const failed = Object.keys(conds).filter(k => !conds[k]);
  check(name, failed.length === 0, (failed.length ? 'FAILED: ' + failed.join(' | ') + ' -- ' : '') + note);
}
// The three states used more than once.
function t0cAfterHistoryFailure(opId) {
  const h = t0cStand();
  t0cFailHistory(h);
  const err = t0cThrows(() => t0cCommit(h, opId));
  return { h, err };
}
function t0cConflict(opId) {
  const s = t0cAfterHistoryFailure(opId);
  t0cCommit(s.h, 'op-other', [{ article: 'A', quantity: 1, price: 100 }]);
  return s;
}

t0cCheck('T0-C: s1 — the stock write fails: a memo is saved first, nothing else moved (stage «stock»); the retry makes ONE operation: 8 / 800, one history row, one journal row, no memo', () => {
  const h = t0cStand();
  t0cFailStock(h);
  const failed = t0cBrowserCommit(h, 'op-s1');
  const err = failed.status === 'error' ? String(failed.message || 'error') : '';
  const memoAfterFailure = t0cMemoKeys(h);
  const stateAfterFailure = t0cStock(h) + ' rows ' + t0cRows(h, 'op-s1').length;
  const pending = t0cPending(h);
  const retried = t0cBrowserCommit(h, 'op-s1');
  const retryErr = retried.status === 'error' ? String(retried.message || 'error') : '';
  return {
    conds: {
      'the commit failed (doPost answered an error)': err !== '',
      'a memo with keys pendingOp:op-s1… exists after the failure': memoAfterFailure.length > 0 && memoAfterFailure.every(k => k.indexOf('pendingOp:op-s1') === 0),
      'stock still 10/1000, no history': stateAfterFailure === '10/1000 rows 0',
      'pending: one entry, stage stock, canComplete true, canCancel true': t0cPendingIs(pending, 'op-s1', 'stock', true, true, T0C_BROWSER_USER),
      'the retry did not throw': retryErr === '',
      'after the retry stock 8/800': t0cStock(h) === '8/800',
      'exactly one history row for the opId': t0cRows(h, 'op-s1').length === 1,
      'exactly one journal row for the opId': t0cJournal(h, 'op-s1').length === 1,
      'no memo left': t0cMemoKeys(h).length === 0
    },
    note: 'failure: ' + err + ' | memo keys ' + memoAfterFailure.length + ' | ' + stateAfterFailure + ' | pending ' + JSON.stringify(pending)
      + ' | retry: ' + (retryErr || 'ok') + ' ' + t0cStock(h) + ' rows ' + t0cRows(h, 'op-s1').length + ' journal ' + t0cJournal(h, 'op-s1').length + ' memo ' + t0cMemoKeys(h).length
  };
});

t0cCheck('T0-C: s2 — the «История» write fails after the stock was written: the memo holds the call and the values before / after, stage «history»', () => {
  const h = t0cStand();
  h.setNow('2026-10-19T07:00:00Z');
  t0cFailHistory(h);
  const failed = t0cBrowserCommit(h, 'op-s2');
  const err = failed.status === 'error' ? String(failed.message || 'error') : '';
  const keys = t0cMemoKeys(h);
  const values = keys.map(k => String(t0cMemo(h)[k]));
  const text = values.join('');
  const pending = t0cPending(h);
  return {
    conds: {
      'the commit failed (doPost answered an error)': err !== '',
      'a memo with keys pendingOp:op-s2… exists': keys.length > 0 && keys.every(k => k.indexOf('pendingOp:op-s2') === 0),
      'every memo value is at most 9000 characters': values.every(v => v.length <= 9000),
      'the memo holds the content: destination, user, the date of the start, article': text.indexOf(T0C_DEST) !== -1 && text.indexOf(T0C_BROWSER_USER) !== -1
        && text.indexOf('2026-10-19T07:00:00') !== -1 && text.indexOf('"A"') !== -1,
      'the memo holds the capitalization before (1000) and after (800)': text.indexOf('1000') !== -1 && text.indexOf('800') !== -1,
      'stock is 8/800 (written), no history row, no journal row': t0cStock(h) === '8/800' && t0cRows(h, 'op-s2').length === 0 && t0cJournal(h, 'op-s2').length === 0,
      'pending: one entry, stage history, canComplete true, canCancel true': t0cPendingIs(pending, 'op-s2', 'history', true, true, T0C_BROWSER_USER)
    },
    note: 'failure: ' + err + ' | memo keys ' + keys.length + ' | ' + t0cStock(h) + ' | pending ' + JSON.stringify(pending)
  };
});

t0cCheck('T0-C: s2 retry with the same opId — stock 8 / 800 (not 6 / 600), exactly one operation in «История», one journal row, no memo', () => {
  const { h } = t0cAfterHistoryFailure('op-s2r');
  const retryErr = t0cThrows(() => t0cCommit(h, 'op-s2r'));
  return {
    conds: {
      'the retry did not throw': retryErr === '',
      'stock 8/800 (no second deduction)': t0cStock(h) === '8/800',
      'exactly one history row for the opId': t0cRows(h, 'op-s2r').length === 1,
      'exactly one journal row for the opId': t0cJournal(h, 'op-s2r').length === 1,
      'no memo left': t0cMemoKeys(h).length === 0,
      'nothing pending (getPendingOperations returns [])': t0cNoPending(h)
    },
    note: 'retry: ' + (retryErr || 'ok') + ' | ' + t0cStock(h) + ' rows ' + t0cRows(h, 'op-s2r').length + ' journal ' + t0cJournal(h, 'op-s2r').length + ' memo ' + t0cMemoKeys(h).length
  };
});

t0cCheck('T0-C: s3 — the journal write fails (costJournalError): the operation stands, the memo STAYS, stage «journal», canComplete true, canCancel false', () => {
  const h = t0cStand();
  t0cFailJournal(h);
  const answer = t0cBrowserCommit(h, 'op-s3');
  const result = answer.status === 'success' ? answer.data : null;
  const pending = t0cPending(h);
  return {
    conds: {
      'the commit answered success with a costJournalError': !!(result && result.costJournalError),
      'stock 8/800 and one history row': t0cStock(h) === '8/800' && t0cRows(h, 'op-s3').length === 1,
      'no journal row yet': t0cJournal(h, 'op-s3').length === 0,
      'the memo stays': t0cMemoKeys(h).length > 0,
      'pending: one entry, stage journal, canComplete true, canCancel false': t0cPendingIs(pending, 'op-s3', 'journal', true, false, T0C_BROWSER_USER)
    },
    note: 'result error: ' + (result && result.costJournalError) + ' | ' + t0cStock(h) + ' | memo keys ' + t0cMemoKeys(h).length + ' | pending ' + JSON.stringify(pending)
  };
});

t0cCheck('T0-C: s3 retry — the missing journal row is written (priced 100, 2 pcs), «История» is not duplicated, stock stays 8 / 800, the memo goes', () => {
  const h = t0cStand();
  t0cFailJournal(h);
  t0cCommit(h, 'op-s3r');
  const retryErr = t0cThrows(() => t0cCommit(h, 'op-s3r'));
  const journal = t0cJournal(h, 'op-s3r');
  return {
    conds: {
      'the retry did not throw': retryErr === '',
      'exactly one journal row for the opId, shipped 2 at 100': journal.length === 1 && journal[0]['Отгружено'] === 2 && journal[0]['Себестоимость отгрузки'] === 100,
      'exactly one history row for the opId': t0cRows(h, 'op-s3r').length === 1,
      'stock 8/800': t0cStock(h) === '8/800',
      'no memo left, nothing pending': t0cMemoKeys(h).length === 0 && t0cNoPending(h)
    },
    note: 'retry: ' + (retryErr || 'ok') + ' | journal ' + JSON.stringify(journal) + ' | ' + t0cStock(h) + ' rows ' + t0cRows(h, 'op-s3r').length
  };
});

t0cCheck('T0-C: conflict — stock changed by another operation since the failure: the retry is refused in Russian, nothing is written, the memo stays', () => {
  const { h } = t0cConflict('op-c');
  const before = t0cStock(h) + ' other rows ' + t0cRows(h, 'op-other').length + ' journal ' + h.dumpOzonCost().length;
  const retryErr = t0cThrows(() => t0cCommit(h, 'op-c'));
  const after = t0cStock(h) + ' other rows ' + t0cRows(h, 'op-other').length + ' journal ' + h.dumpOzonCost().length;
  return {
    conds: {
      'the retry threw': retryErr !== '',
      'the error is in Russian': /[А-Яа-яЁё]/.test(retryErr),
      'stock is the other operation\'s result, 7/700 (neither before nor after)': t0cStock(h) === '7/700',
      'no history row and no journal row for the refused opId': t0cRows(h, 'op-c').length === 0 && t0cJournal(h, 'op-c').length === 0,
      'nothing at all changed by the refused retry': before === after,
      'the memo of the refused opId stays': t0cMemoKeys(h).some(k => k.indexOf('pendingOp:op-c') === 0)
    },
    note: 'retry error: ' + retryErr + ' | ' + before + ' -> ' + after
  };
});

t0cCheck('T0-C: conflict — getPendingOperations shows stage «conflict», canComplete false, canCancel false (before and after the refused retry)', () => {
  const { h } = t0cConflict('op-cp');
  const first = t0cPending(h);
  t0cThrows(() => t0cCommit(h, 'op-cp'));
  const second = t0cPending(h);
  return {
    conds: {
      'one pending entry, stage conflict, both buttons off': t0cPendingIs(first, 'op-cp', 'conflict', false, false),
      'the same after the refused retry': t0cPendingIs(second, 'op-cp', 'conflict', false, false)
    },
    note: JSON.stringify(first)
  };
});

t0cCheck('T0-C: resolve «complete» as admin does what a retry does — 8 / 800, one history row, one journal row, no memo', () => {
  const h = t0cStand();
  t0cFailHistory(h);
  t0cBrowserCommit(h, 'op-rc');
  const out = t0cResolve(h, 'tok-admin', 'op-rc', 'complete');
  return {
    conds: {
      'doPost answered success': out.status === 'success',
      'stock 8/800': t0cStock(h) === '8/800',
      'exactly one history row and one journal row': t0cRows(h, 'op-rc').length === 1 && t0cJournal(h, 'op-rc').length === 1,
      'no memo, nothing pending': t0cMemoKeys(h).length === 0 && t0cNoPending(h)
    },
    note: JSON.stringify(out).slice(0, 200) + ' | ' + t0cStock(h)
  };
});

t0cCheck('T0-C: resolve «cancel» as admin — stage «stock» drops the memo only, stage «history» puts the stock back to 10 / 1000 (no history, no journal)', () => {
  const a = t0cStand();
  t0cFailStock(a);
  t0cThrows(() => t0cCommit(a, 'op-ca'));
  const outA = t0cResolve(a, 'tok-admin', 'op-ca', 'cancel');
  const { h: b } = t0cAfterHistoryFailure('op-cb');
  const stockBeforeCancelB = t0cStock(b);
  const outB = t0cResolve(b, 'tok-admin', 'op-cb', 'cancel');
  return {
    conds: {
      'stage stock: success, memo gone, stock 10/1000, nothing written': outA.status === 'success' && t0cMemoKeys(a).length === 0
        && t0cStock(a) === '10/1000' && t0cRows(a, 'op-ca').length === 0 && t0cJournal(a, 'op-ca').length === 0,
      'stage history premise: stock was 8/800 before the cancel': stockBeforeCancelB === '8/800',
      'stage history: success, stock back to 10/1000, memo gone, nothing written': outB.status === 'success' && t0cStock(b) === '10/1000'
        && t0cMemoKeys(b).length === 0 && t0cRows(b, 'op-cb').length === 0 && t0cJournal(b, 'op-cb').length === 0
    },
    note: JSON.stringify(outA).slice(0, 120) + ' | ' + JSON.stringify(outB).slice(0, 120) + ' | ' + t0cStock(b)
  };
});

t0cCheck('T0-C: resolve «cancel» is refused when «История» rows exist, and when the stock has moved on since; nothing changes, the memo stays', () => {
  const h = t0cStand();
  t0cFailJournal(h);
  t0cCommit(h, 'op-rj');
  const outJournal = t0cResolve(h, 'tok-admin', 'op-rj', 'cancel');
  const afterJournal = t0cStock(h) + ' rows ' + t0cRows(h, 'op-rj').length + ' memo ' + (t0cMemoKeys(h).length > 0);
  const { h: c } = t0cConflict('op-rx');
  const outConflict = t0cResolve(c, 'tok-admin', 'op-rx', 'cancel');
  return {
    conds: {
      'history exists: cancel answered with a refusal (not an unknown action)': outJournal.status === 'error' && !/Unknown action/.test(String(outJournal.message)),
      'history exists: stock 8/800, the history row and the memo untouched': afterJournal === '8/800 rows 1 memo true',
      'stock moved on: cancel answered with a refusal (not an unknown action)': outConflict.status === 'error' && !/Unknown action/.test(String(outConflict.message)),
      'stock moved on: stock stays 7/700 and the memo stays': t0cStock(c) === '7/700' && t0cMemoKeys(c).some(k => k.indexOf('pendingOp:op-rx') === 0)
    },
    note: JSON.stringify(outJournal).slice(0, 120) + ' | ' + JSON.stringify(outConflict).slice(0, 120) + ' | ' + afterJournal
  };
});

t0cCheck('T0-C: resolve «dismiss» as admin on a conflict drops the memo and touches no data', () => {
  const { h } = t0cConflict('op-rd');
  const dataBefore = t0cStock(h) + ' other rows ' + t0cRows(h, 'op-other').length + ' journal ' + h.dumpOzonCost().length;
  const out = t0cResolve(h, 'tok-admin', 'op-rd', 'dismiss');
  const dataAfter = t0cStock(h) + ' other rows ' + t0cRows(h, 'op-other').length + ' journal ' + h.dumpOzonCost().length;
  return {
    conds: {
      'doPost answered success': out.status === 'success',
      'the memo is gone, nothing pending': t0cMemoKeys(h).length === 0 && t0cNoPending(h),
      'stock, history and journal untouched': dataBefore === dataAfter && t0cStock(h) === '7/700' && t0cRows(h, 'op-rd').length === 0
    },
    note: JSON.stringify(out).slice(0, 120) + ' | ' + dataBefore + ' -> ' + dataAfter
  };
});

t0cCheck('T0-C: resolve complete / cancel / dismiss are refused for a plain user; the memo, the stock and the sheets stay as they were', () => {
  const { h } = t0cAfterHistoryFailure('op-ru');
  const keysBefore = t0cMemoKeys(h).length;
  const outs = ['complete', 'cancel', 'dismiss'].map(a => t0cResolve(h, 'tok-user', 'op-ru', a));
  return {
    conds: {
      'a memo existed to be protected': keysBefore > 0,
      'all three answered with the rights error': outs.every(o => o.status === 'error' && /Forbidden|администратор/i.test(String(o.message))),
      'the memo is untouched': t0cMemoKeys(h).length === keysBefore,
      'stock 8/800, no history, no journal': t0cStock(h) === '8/800' && t0cRows(h, 'op-ru').length === 0 && t0cJournal(h, 'op-ru').length === 0
    },
    note: outs.map(o => String(o.message)).join(' | ')
  };
});

t0cCheck('T0-C: a commit without a failure leaves no memo, no pending entry and the usual result; a failing commit WITHOUT an opId saves no memo', () => {
  const h = t0cStand();
  const result = t0cCommit(h, 'op-ok');
  const normal = {
    memo: t0cMemoKeys(h).length,
    stock: t0cStock(h),
    rows: t0cRows(h, 'op-ok').length,
    journal: t0cJournal(h, 'op-ok').length,
    pending: (t0cNoPending(h) ? 0 : -1)
  };
  const g = t0cStand();
  t0cFailHistory(g);
  const err = t0cThrows(() => t0cCommit(g, ''));
  return {
    conds: {
      'no memo, nothing pending after a normal commit': normal.memo === 0 && normal.pending === 0,
      'stock 8/800, one history row, one journal row': normal.stock === '8/800' && normal.rows === 1 && normal.journal === 1,
      'the result is the usual one: no idempotentHit, no costJournalError': !result.idempotentHit && !result.costJournalError && result.newTransactions.length === 1,
      'a failing commit without an opId threw and left no memo': err !== '' && t0cMemoKeys(g).length === 0
    },
    note: JSON.stringify(normal) + ' | no-opId failure: ' + err
  };
});

t0cCheck('T0-C: a 200-article operation interrupted after the stock write keeps every memo value within 9000 characters; the retry completes all 200', () => {
  const h = t0cStand();
  const names = Array.from({ length: 200 }, (_, i) => 'Артикул_' + String(i + 1).padStart(3, '0'));
  h.setStockSheet(names.map(a => ({ article: a, quantity: 10, avgCost: 100, capitalization: 1000 })));
  const items = names.map(a => ({ article: a, quantity: 2, price: 100 }));
  t0cFailHistory(h);
  const err = t0cThrows(() => t0cCommit(h, 'op-200', items, 'Яндекс'));
  const keys = t0cMemoKeys(h);
  const values = keys.map(k => String(t0cMemo(h)[k]));
  const allDeducted = names.every(a => t0cStock(h, a) === '8/800');
  const pending = t0cPending(h);
  const retryErr = t0cThrows(() => t0cCommit(h, 'op-200', items, 'Яндекс'));
  const bytes = values.map(v => Buffer.byteLength(v, 'utf8'));
  return {
    conds: {
      'the commit threw after the stock write': err !== '' && allDeducted,
      'the memo is split into several properties, all keyed pendingOp:op-200…': keys.length >= 2 && keys.every(k => k.indexOf('pendingOp:op-200') === 0),
      'every memo value is at most 9000 characters': values.length > 0 && values.every(v => v.length <= 9000),
      'EXTRA (tester): every memo value is at most 9216 UTF-8 bytes — Cyrillic articles take 2 bytes a character': bytes.length > 0 && bytes.every(b => b <= 9216),
      'pending lists all 200 articles, stage history': Array.isArray(pending) && pending.length === 1 && pending[0].stage === 'history' && pending[0].articles.length === 200,
      'the retry did not throw': retryErr === '',
      '200 history rows for the opId, every article 8/800 (not 6/600)': t0cRows(h, 'op-200').length === 200 && names.every(a => t0cStock(h, a) === '8/800'),
      'no memo left': t0cMemoKeys(h).length === 0
    },
    note: 'memo properties ' + keys.length + ', max chars ' + Math.max(0, ...values.map(v => v.length)) + ', max bytes ' + Math.max(0, ...bytes)
      + ' | failure: ' + err + ' | retry: ' + (retryErr || 'ok') + ' rows ' + t0cRows(h, 'op-200').length
  };
});

t0cCheck('T0-C: getInitialData carries pendingOperations for every user — the stuck operation for a plain user and for the admin, an empty array when none', () => {
  const { h } = t0cAfterHistoryFailure('op-gi');
  const asUser = h.callDoPost({ action: 'getInitialData', sessionToken: 'tok-user', data: {} });
  const asAdmin = h.callDoPost({ action: 'getInitialData', sessionToken: 'tok-admin', data: {} });
  t0cCommit(h, 'op-gi');
  const clean = h.callDoPost({ action: 'getInitialData', sessionToken: 'tok-user', data: {} });
  const listOf = (o) => (o.data && o.data.pendingOperations);
  return {
    conds: {
      'plain user: one pending operation op-gi, stage history': Array.isArray(listOf(asUser)) && listOf(asUser).length === 1 && listOf(asUser)[0].opId === 'op-gi' && listOf(asUser)[0].stage === 'history',
      'admin: the same list': Array.isArray(listOf(asAdmin)) && listOf(asAdmin).length === 1 && listOf(asAdmin)[0].opId === 'op-gi',
      'after the retry: an empty array, not a missing field': Array.isArray(listOf(clean)) && listOf(clean).length === 0
    },
    note: 'user data keys: ' + Object.keys(asUser.data || {}).join(',')
  };
});


// ----- Part C1 refinements (written test-first; the coder's first C1 is green, these four are not built yet) -----
//  1. caller bookkeeping: getPendingOperations() entries gain `origin: 'commit' | 'other'`. A memo saved under the doPost
//     'commit' action holds its postingIds, and resolve «complete» on it does what the 'commit' case does — the commit
//     AND linkPostingsToCommit. A memo from any other caller (chinaPostBatch, commitUnshippedReturn, a direct call) has
//     canComplete false (canCancel per stage as before) and resolve «complete» on it is refused in Russian; the module's own
//     retry with the same opId keeps working.
//  2. dev mode: a memo saved by a dev-mode request lives under `pendingOpDev:<opId>…`; every read / retry / resolve sees only
//     the memos of its own mode.
//  3. phantom popup: getInitialData tries the script lock with tryLock(0); lock free -> every memo is listed, lock busy ->
//     only memos whose startedAt is at least 7 minutes old.
//  4. a damaged memo (part 0 is not JSON, or a part is missing) never makes getPendingOperations / getInitialData throw: it is
//     listed with stage 'conflict', canComplete false, canCancel false, damaged true; resolve «dismiss» removes all its keys.
function t0cSessions(h) {
  const far = String(Date.parse('2030-01-01T00:00:00Z'));
  h.setRegistrySheet('Сессии', [['Token', 'Username', 'Role', 'ExpiresAt'],
    ['tok-user', 'Кладовщик', 'user', far], ['tok-admin', 'boss', 'admin', far]]);
}
const t0cKeysOf = (h, opId, prefix) => Object.keys(t0cMemo(h)).filter(k => k.indexOf((prefix || 'pendingOp:') + opId + ':') === 0);
const t0cIsRussianError = (out) => out.status === 'error' && /[А-Яа-яЁё]/.test(String(out.message)) && !/Unknown action/.test(String(out.message));

t0cCheck('T0-C: caller bookkeeping — a commit with postingIds interrupted after the stock write is origin «commit»; resolve «complete» links the posting exactly as an uninterrupted commit does', () => {
  const posting = { postingId: 'P-100', cabinet: 'MaxiStore', status: 'new', items: [{ offerId: 'A', quantity: 2 }] };
  // the control: the same commit, nothing interrupted
  const c = t0cStand();
  c.setExternalShipmentsSheet([posting]);
  t0cBrowserCommit(c, 'op-post-c', { postingIds: ['P-100'] });
  const control = c.dumpExternalShipments()[0];
  const controlIds = JSON.stringify(t0cRows(c, 'op-post-c').map(r => r.id));
  // the interrupted one, finished by the admin
  const h = t0cStand();
  h.setExternalShipmentsSheet([posting]);
  t0cFailHistory(h);
  const failed = t0cBrowserCommit(h, 'op-post', { postingIds: ['P-100'] });
  const pending = t0cPending(h);
  const memoText = t0cMemoKeys(h).map(k => String(t0cMemo(h)[k])).join('');
  const postingBefore = h.dumpExternalShipments()[0]['Статус'];
  const resolved = t0cResolve(h, 'tok-admin', 'op-post', 'complete');
  const row = h.dumpExternalShipments()[0];
  const ids = JSON.stringify(t0cRows(h, 'op-post').map(r => r.id));
  // the same interruption finished by a retry through the commit action
  const r = t0cStand();
  r.setExternalShipmentsSheet([posting]);
  t0cFailHistory(r);
  t0cBrowserCommit(r, 'op-post-r', { postingIds: ['P-100'] });
  const retried = t0cBrowserCommit(r, 'op-post-r', { postingIds: ['P-100'] });
  const retryRow = r.dumpExternalShipments()[0];
  return {
    conds: {
      'control: an uninterrupted commit marks the posting processed and links its rows': control['Статус'] === 'processed' && control['TransGroupInfo'] === controlIds && controlIds !== '[]',
      'pending: one entry, origin «commit», stage history, canComplete true': Array.isArray(pending) && pending.length === 1 && pending[0].origin === 'commit' && pending[0].stage === 'history' && pending[0].canComplete === true,
      'the memo holds the postingIds': memoText.indexOf('P-100') !== -1,
      'before the resolve the posting is untouched': postingBefore === 'new',
      'resolve «complete» answered success': resolved.status === 'success',
      'the posting is linked as after an uninterrupted commit: processed, TransGroupInfo = the rows of the operation': row['Статус'] === 'processed' && row['TransGroupInfo'] === ids && ids !== '[]',
      'stock 8/800, one history row, one journal row, no memo': t0cStock(h) === '8/800' && t0cRows(h, 'op-post').length === 1 && t0cJournal(h, 'op-post').length === 1 && t0cMemoKeys(h).length === 0,
      'a retry through the commit action links the posting too, with no second deduction': retried.status === 'success' && retryRow['Статус'] === 'processed' && t0cStock(r) === '8/800' && t0cMemoKeys(r).length === 0
    },
    note: 'failure: ' + failed.status + ' | pending ' + JSON.stringify(pending) + ' | posting ' + postingBefore + ' -> ' + row['Статус'] + ' ' + row['TransGroupInfo'] + ' vs rows ' + ids + ' | resolve ' + JSON.stringify(resolved).slice(0, 120)
  };
});

t0cCheck('T0-C: caller bookkeeping — a China batch posting interrupted after the stock write is origin «other»: complete is off and refused, cancel restores, the module\'s own retry completes ONE receipt with the batch mark', () => {
  const stand = () => { const h = withChina(); const batch = china84PostableFixture(h); t0cSessions(h); return { h, batch }; };
  const post = (h, batch, opId) => h.postChinaBatch({ id: batch.id, opId: opId, lines: [{ article: 'ART-POST-1', qty: 100 }] }, 'Николай');
  const receipts = (h) => h.dumpTransSheet().filter(r => String(r['Тип']) === 'Приход' && String(r['Объект'] || '').indexOf('NV-POST-1') !== -1);
  const stateOf = (res, batch) => res.batches.filter(b => b.id === batch.id)[0].postingState;

  const { h, batch } = stand();
  t0cFailHistory(h);
  const err = t0cThrows(() => post(h, batch, 'op-ch-1'));
  const pending = t0cPending(h);
  const entry = Array.isArray(pending) && pending.length === 1 ? pending[0] : {};
  const refused = t0cResolve(h, 'tok-admin', 'op-ch-1', 'complete');
  const afterRefusal = h.stockOf('ART-POST-1').quantity + ' receipts ' + receipts(h).length + ' memo ' + (t0cMemoKeys(h).length > 0);
  const cancelled = t0cResolve(h, 'tok-admin', 'op-ch-1', 'cancel');
  const afterCancel = JSON.stringify(h.stockOf('ART-POST-1'));
  const retried = post(h, batch, 'op-ch-1');

  // the plain retry, without the cancel
  const { h: g, batch: gb } = stand();
  t0cFailHistory(g);
  t0cThrows(() => post(g, gb, 'op-ch-2'));
  const plain = post(g, gb, 'op-ch-2');
  return {
    conds: {
      'the posting failed at «История»': err !== '',
      'pending: one entry, origin «other», stage history, canComplete false, canCancel true': entry.origin === 'other' && entry.stage === 'history' && entry.canComplete === false && entry.canCancel === true && entry.type === 'Приход',
      'resolve «complete» is refused in Russian': t0cIsRussianError(refused),
      'the refusal changed nothing: 100 pcs written, no receipt, the memo stays': afterRefusal === '100 receipts 0 memo true',
      'resolve «cancel» succeeded and the memo is gone': cancelled.status === 'success' && t0cMemoKeys(h).length === 0,
      'cancel restored the stock row (0 pcs, 0 capitalization)': (function () { const s = JSON.parse(afterCancel); return s.quantity === 0 && s.capitalization === 0; })(),
      'then the module\'s own retry with the SAME opId completes: one receipt, 100 pcs, the batch marked «предварительно»': stateOf(retried, batch) === 'предварительно' && receipts(h).length === 1 && h.stockOf('ART-POST-1').quantity === 100 && t0cMemoKeys(h).length === 0,
      'a plain retry without the cancel completes the same operation: 100 pcs (not 200), one receipt, batch marked': stateOf(plain, gb) === 'предварительно' && g.stockOf('ART-POST-1').quantity === 100 && receipts(g).length === 1 && t0cMemoKeys(g).length === 0
    },
    note: 'pending ' + JSON.stringify(pending) + ' | refusal ' + JSON.stringify(refused).slice(0, 140) + ' | after refusal ' + afterRefusal + ' | after cancel ' + afterCancel
  };
});

t0cCheck('T0-C: caller bookkeeping — an unshipped return interrupted after the stock write is origin «other»: complete is off and refused, cancel restores, the module\'s own retry completes ONE receipt with the record', () => {
  const stand = () => {
    const h = freshHarness();
    h.ensureTransSheet();
    h.ensureArchiveSheet();
    h.setOzonCostSheet([]);
    h.setStockSheet([{ article: 'ART-PLAIN', quantity: 10, avgCost: 7, capitalization: 70 }]);
    t0cSessions(h);
    const writeOff = h.commitTransaction([{ article: 'ART-PLAIN', quantity: 10, price: 7 }], 'Расход', 'Ozon (MaxiStore)', '2026-09-16', 'tester', '2026-09-06T10:00:00Z', '');
    h.setExternalShipmentsSheet([{ postingId: 'P-RET', cabinet: 'MaxiStore', status: 'processed', ozonStatus: 'REJECTED_AT_SUPPLY_WAREHOUSE',
      items: [{ offerId: 'ART-PLAIN', barcode: 'OZN2', quantity: 10 }], transGroupInfo: JSON.stringify(writeOff.newTransactions.map(t => String(t.id))), orderNumber: '1368918716' }]);
    return h;
  };
  const giveBack = (h, opId) => h.commitUnshippedReturn('P-RET', [{ offerId: 'ART-PLAIN', article: 'ART-PLAIN', shipped: 6 }], 'tester', opId);
  const receipts = (h) => h.dumpTransSheet().filter(r => String(r['Тип']) === 'Приход');
  const recordOf = (h) => String(h.dumpExternalShipments()[0]['ОтгруженоJSON']);

  const h = stand();
  const stockBefore = JSON.stringify(h.stockOf('ART-PLAIN'));
  t0cFailHistory(h);
  const err = t0cThrows(() => giveBack(h, 'op-ret-1'));
  const pending = t0cPending(h);
  const entry = Array.isArray(pending) && pending.length === 1 ? pending[0] : {};
  const refused = t0cResolve(h, 'tok-admin', 'unshipped-return:p-ret', 'complete');
  const afterRefusal = h.stockOf('ART-PLAIN').quantity + ' receipts ' + receipts(h).length + ' record ' + (recordOf(h) !== '') + ' memo ' + (t0cMemoKeys(h).length > 0);
  const cancelled = t0cResolve(h, 'tok-admin', 'unshipped-return:p-ret', 'cancel');
  const afterCancel = JSON.stringify(h.stockOf('ART-PLAIN'));
  giveBack(h, 'op-ret-1');
  let record = null;
  try { record = JSON.parse(recordOf(h)); } catch (e) {}

  const g = stand();
  t0cFailHistory(g);
  t0cThrows(() => giveBack(g, 'op-ret-2'));
  const plainErr = t0cThrows(() => giveBack(g, 'op-ret-2'));
  return {
    conds: {
      'the return failed at «История»': err !== '',
      'pending: one entry, origin «other», stage history, canComplete false, canCancel true': entry.origin === 'other' && entry.stage === 'history' && entry.canComplete === false && entry.canCancel === true && entry.type === 'Приход',
      'resolve «complete» is refused in Russian': t0cIsRussianError(refused),
      'the refusal changed nothing: 4 pcs written, no receipt, no record, the memo stays': afterRefusal === '4 receipts 0 record false memo true',
      'resolve «cancel» succeeded, the memo is gone and the stock is exactly as before the return': cancelled.status === 'success' && t0cMemoKeys(h).length === 0 && afterCancel === stockBefore,
      'then the module\'s own retry with the SAME opId completes: one receipt, 4 pcs, the record with one return id': receipts(h).length === 1 && h.stockOf('ART-PLAIN').quantity === 4 && !!record && record.returnTxIds.length === 1 && t0cMemoKeys(h).length === 0,
      'a plain retry without the cancel completes the same operation: 4 pcs (not 8), one receipt, record written': plainErr === '' && g.stockOf('ART-PLAIN').quantity === 4 && receipts(g).length === 1 && recordOf(g) !== '' && t0cMemoKeys(g).length === 0
    },
    note: 'pending ' + JSON.stringify(pending) + ' | refusal ' + JSON.stringify(refused).slice(0, 140) + ' | after refusal ' + afterRefusal + ' | before ' + stockBefore + ' after cancel ' + afterCancel + ' | plain retry: ' + (plainErr || 'ok')
  };
});

t0cCheck('T0-C: dev mode — a memo saved in dev mode lives under pendingOpDev: and is invisible to live requests; a live resolve cannot touch it (and the other way round); live data untouched', () => {
  const h = t0cStand();
  h.setScriptProperty('test_dbSpreadsheetId', h.targetSpreadsheetId);
  h.setTargetSheet('Остатки', [h.STOCK_HEADERS, ['A', 5, 100, 500, 0, 0]]);
  h.setTargetSheet('Транзакции', [h.TRANS_HEADERS]);
  const dev = (payload) => h.callDoPost(Object.assign({ sessionToken: 'tok-admin', devMode: true }, payload));
  const live = (payload) => h.callDoPost(Object.assign({ sessionToken: 'tok-admin' }, payload));
  const idsOf = (out) => ((out.data && out.data.pendingOperations) || []).map(p => p.opId);
  const devCommit = () => dev({ action: 'commit', type: 'Расход', destination: 'Яндекс', deliveryDate: '2026-10-19', opId: 'op-dev', data: [{ article: 'A', quantity: 2, price: 100 }] });

  t0cFailOnce(h.getTargetSheet('Транзакции'), (a) => a[0] > 1 && a[1] === 1);
  const devFailed = devCommit();
  t0cFailHistory(h);
  const liveFailed = t0cBrowserCommit(h, 'op-live');
  const devKeys = t0cKeysOf(h, 'op-dev', 'pendingOpDev:');
  const strayDevKeys = t0cKeysOf(h, 'op-dev', 'pendingOp:');
  const liveKeys = t0cKeysOf(h, 'op-live', 'pendingOp:');
  const strayLiveKeys = t0cKeysOf(h, 'op-live', 'pendingOpDev:');

  const liveList = idsOf(h.callDoPost({ action: 'getInitialData', sessionToken: 'tok-user', data: {} }));
  const devList = idsOf(dev({ action: 'getInitialData', data: {} }));
  const liveDismissDev = live({ action: 'resolvePendingOperation', data: { opId: 'op-dev', action: 'dismiss' } });
  const liveCompleteDev = live({ action: 'resolvePendingOperation', data: { opId: 'op-dev', action: 'complete' } });
  const devDismissLive = dev({ action: 'resolvePendingOperation', data: { opId: 'op-live', action: 'dismiss' } });
  const devKeysAfter = t0cKeysOf(h, 'op-dev', 'pendingOpDev:').length;
  const liveKeysAfter = t0cKeysOf(h, 'op-live', 'pendingOp:').length;
  const liveStock = h.dumpStockSheet().rows.map(r => r[0] + ':' + r[1]).join();
  const liveRows = h.dumpTransSheet().filter(r => String(r['OpID']) === 'op-dev').length;
  const retried = devCommit();
  const devStock = h.dumpTargetSheet('Остатки').slice(1).map(r => r[0] + ':' + r[1]).join();
  const devRows = h.dumpTargetSheet('Транзакции').slice(1).filter(r => r.some(v => String(v) === 'op-dev')).length;
  return {
    conds: {
      'both interrupted commits answered an error': devFailed.status === 'error' && liveFailed.status === 'error',
      'the dev memo is under pendingOpDev:op-dev… and not under pendingOp:': devKeys.length > 0 && strayDevKeys.length === 0,
      'the live memo is under pendingOp:op-live… and not under pendingOpDev:': liveKeys.length > 0 && strayLiveKeys.length === 0,
      'a live getInitialData lists only the live operation': JSON.stringify(liveList) === '["op-live"]',
      'a dev-mode getInitialData lists only the dev operation': JSON.stringify(devList) === '["op-dev"]',
      'a live resolve (dismiss, complete) of the dev opId finds nothing and leaves the dev memo': liveDismissDev.status === 'error' && liveCompleteDev.status === 'error' && devKeysAfter === devKeys.length,
      'a dev-mode resolve of the live opId finds nothing and leaves the live memo': devDismissLive.status === 'error' && liveKeysAfter === liveKeys.length,
      'live data untouched by the dev operation: live stock is the live operation\'s 8, no live row with the dev opId': liveStock === 'A:8' && liveRows === 0,
      'a dev-mode retry finishes the dev operation on the dev sheets: dev stock 3, one dev row, no dev memo, the live memo stays': retried.status === 'success' && devStock === 'A:3' && devRows === 1 && t0cKeysOf(h, 'op-dev', 'pendingOpDev:').length === 0 && t0cKeysOf(h, 'op-live', 'pendingOp:').length === liveKeys.length
    },
    note: 'dev keys ' + devKeys.length + ' (stray ' + strayDevKeys.length + '), live keys ' + liveKeys.length + ' (stray ' + strayLiveKeys.length + ') | live list ' + JSON.stringify(liveList) + ' dev list ' + JSON.stringify(devList)
      + ' | live resolve of dev: ' + liveDismissDev.status + '/' + liveCompleteDev.status + ' | dev resolve of live: ' + devDismissLive.status + ' | live stock ' + liveStock + ' dev stock ' + devStock
  };
});

t0cCheck('T0-C: phantom popup — while another request holds the script lock getInitialData lists only memos at least 7 minutes old; with the lock free it lists every memo', () => {
  const h = t0cStand();
  h.setNow('2026-10-22T10:00:00Z');
  t0cFailHistory(h);
  const failed = t0cBrowserCommit(h, 'op-ph');
  const listed = (at, busy) => {
    h.setNow(at);
    h.setScriptLockBusy(busy);
    const out = h.callDoPost({ action: 'getInitialData', sessionToken: 'tok-user', data: {} });
    h.setScriptLockBusy(false);
    return out.status === 'success' ? out.data.pendingOperations.map(p => p.opId) : 'error: ' + out.message;
  };
  const freeFresh = listed('2026-10-22T10:00:30Z', false);
  const busyFresh = listed('2026-10-22T10:00:30Z', true);
  const busySixFiftyNine = listed('2026-10-22T10:06:59Z', true);
  const busySeven = listed('2026-10-22T10:07:00Z', true);
  const busyEight = listed('2026-10-22T10:08:00Z', true);
  const freeOld = listed('2026-10-22T10:30:00Z', false);
  const same = (v, ids) => JSON.stringify(v) === JSON.stringify(ids);
  return {
    conds: {
      'a memo exists to be listed': failed.status === 'error' && t0cMemoKeys(h).length > 0,
      'lock free, memo 30 seconds old: listed': same(freeFresh, ['op-ph']),
      'lock busy, memo 30 seconds old: NOT listed (it may be a commit still running)': same(busyFresh, []),
      'lock busy, memo 6 min 59 s old: NOT listed': same(busySixFiftyNine, []),
      'lock busy, memo exactly 7 min old: listed': same(busySeven, ['op-ph']),
      'lock busy, memo 8 min old: listed': same(busyEight, ['op-ph']),
      'lock free, memo 30 min old: listed': same(freeOld, ['op-ph'])
    },
    note: JSON.stringify({ freeFresh, busyFresh, busySixFiftyNine, busySeven, busyEight, freeOld })
  };
});

// A healthy operation next to a damaged one: the damaged memo must not hide it, and the dismiss must not touch it.
function t0cTwoStuckOperations(badNames) {
  const h = t0cStand();
  const names = badNames || ['B'];
  h.setStockSheet(['A'].concat(names).map(a => ({ article: a, quantity: 10, avgCost: 100, capitalization: 1000 })));
  t0cFailHistory(h);
  t0cBrowserCommit(h, 'op-good');
  t0cFailHistory(h);
  t0cBrowserCommit(h, 'op-bad', { destination: 'Яндекс', data: names.map(a => ({ article: a, quantity: 2, price: 100 })) });
  return h;
}
function t0cDamagedConds(h, label) {
  const direct = (function () { try { return JSON.parse(JSON.stringify(h.context.getPendingOperations())); } catch (e) { return 'threw: ' + e.message; } })();
  const initial = h.callDoPost({ action: 'getInitialData', sessionToken: 'tok-user', data: {} });
  const fromInitial = initial.status === 'success' ? initial.data.pendingOperations : null;
  const pick = (list, id) => (Array.isArray(list) ? list.filter(p => p.opId === id)[0] : undefined);
  const bad = pick(direct, 'op-bad');
  const good = pick(direct, 'op-good');
  const badKeys = t0cKeysOf(h, 'op-bad').length;
  const completeTry = t0cResolve(h, 'tok-admin', 'op-bad', 'complete');
  const keysAfterComplete = t0cKeysOf(h, 'op-bad').length;
  const goodKeys = t0cKeysOf(h, 'op-good').length;
  const dismissed = t0cResolve(h, 'tok-admin', 'op-bad', 'dismiss');
  const conds = {};
  conds[label + ': getPendingOperations does not throw']  = Array.isArray(direct);
  conds[label + ': getInitialData answers success and carries the list'] = Array.isArray(fromInitial) && !!pick(fromInitial, 'op-bad');
  conds[label + ': the damaged memo is listed: stage conflict, canComplete false, canCancel false, damaged true, articles an array'] = !!bad && bad.stage === 'conflict'
    && bad.canComplete === false && bad.canCancel === false && bad.damaged === true && Array.isArray(bad.articles);
  conds[label + ': the healthy operation is still listed, not damaged'] = !!good && good.stage === 'history' && good.canComplete === true && good.damaged !== true;
  conds[label + ': resolve «complete» on the damaged memo is refused and keeps its keys'] = completeTry.status === 'error' && keysAfterComplete === badKeys && badKeys > 0;
  conds[label + ': resolve «dismiss» succeeds and removes every key of the damaged memo, the healthy one keeps its own'] = dismissed.status === 'success'
    && t0cKeysOf(h, 'op-bad').length === 0 && t0cKeysOf(h, 'op-good').length === goodKeys && goodKeys > 0;
  return { conds, note: label + ': ' + JSON.stringify(direct).slice(0, 300) + ' | complete: ' + JSON.stringify(completeTry).slice(0, 100) + ' | dismiss: ' + JSON.stringify(dismissed).slice(0, 100) };
}

t0cCheck('T0-C: a damaged memo (part 0 is not JSON) never makes the list throw: listed «conflict» + damaged, nothing can be pressed but dismiss, which removes all its keys', () => {
  const h = t0cTwoStuckOperations();
  h.context.PropertiesService.getScriptProperties().setProperty('pendingOp:op-bad:0', '{"opId":"op-bad","items":[{"article":"B"');
  return t0cDamagedConds(h, 'part 0 broken');
});

t0cCheck('T0-C: a damaged memo (a middle part is missing) never makes the list throw: listed «conflict» + damaged, dismiss removes all its remaining keys', () => {
  // a long memo has several parts: op-bad is a 200-article operation
  const names = Array.from({ length: 200 }, (_, i) => 'Артикул_' + String(i + 1).padStart(3, '0'));
  const h = t0cTwoStuckOperations(names);
  const parts = t0cKeysOf(h, 'op-bad');
  h.context.PropertiesService.getScriptProperties().deleteProperty('pendingOp:op-bad:1');
  const result = t0cDamagedConds(h, 'part 1 missing');
  result.conds['the memo really had several parts before the damage'] = parts.length >= 3;
  return result;
});


// ----- Final pass: checks added for mutants that survived on the real C1 code -----
t0cCheck('T0-C: a stock that changed only in COST since the failure (same quantity as «after») is a conflict: the retry and «cancel» are refused and the correction is not overwritten', () => {
  const { h } = t0cAfterHistoryFailure('op-cost');
  // 8 / 800 after the interrupted expense; a cost correction (+50 ₽, no quantity change) then moves the capitalization to 850
  h.context.commitCostCorrection('A', 50, 'Корректировка: тест', '', 'tester');
  const stockAfterCorrection = t0cStock(h);
  const pending = t0cPending(h);
  const retryErr = t0cThrows(() => t0cCommit(h, 'op-cost'));
  const cancelled = t0cResolve(h, 'tok-admin', 'op-cost', 'cancel');
  // a correction of one kopeck: quantity AND average cost (to two decimals) stay, only the capitalization differs
  const { h: g } = t0cAfterHistoryFailure('op-kop');
  g.context.commitCostCorrection('A', 0.01, 'Корректировка: тест', '', 'tester');
  const kopeckStock = t0cStock(g);
  const kopeckPending = t0cPending(g);
  const kopeckCancel = t0cResolve(g, 'tok-admin', 'op-kop', 'cancel');
  return {
    conds: {
      'a one-kopeck correction is a conflict too (8/800.01: same quantity, same average, other capitalization), cancel is refused and leaves it': kopeckStock === '8/800.01'
        && Array.isArray(kopeckPending) && kopeckPending.length === 1 && kopeckPending[0].stage === 'conflict'
        && kopeckCancel.status === 'error' && t0cStock(g) === '8/800.01',
      'premise: the correction moved the capitalization, not the quantity': stockAfterCorrection === '8/850',
      'pending: stage conflict, canComplete false, canCancel false': Array.isArray(pending) && pending.length === 1 && pending[0].stage === 'conflict' && pending[0].canComplete === false && pending[0].canCancel === false,
      'the retry is refused in Russian and writes no history row': retryErr !== '' && /[А-Яа-яЁё]/.test(retryErr) && t0cRows(h, 'op-cost').length === 0,
      '«cancel» is refused and does NOT put the stock back over the correction (still 8/850)': cancelled.status === 'error' && t0cStock(h) === '8/850',
      'the memo stays': t0cMemoKeys(h).some(k => k.indexOf('pendingOp:op-cost') === 0)
    },
    note: 'stock ' + stockAfterCorrection + ' -> ' + t0cStock(h) + ' | pending ' + JSON.stringify(pending) + ' | retry: ' + retryErr + ' | cancel ' + JSON.stringify(cancelled).slice(0, 120)
  };
});

t0cCheck('T0-C: the origin and the postingIds survive a resolve «complete» that stops at the journal: the second «complete» finishes it and the posting stays linked', () => {
  const h = t0cStand();
  h.setExternalShipmentsSheet([{ postingId: 'P-100', cabinet: 'MaxiStore', status: 'new', items: [{ offerId: 'A', quantity: 2 }] }]);
  t0cFailStock(h);
  const failed = t0cBrowserCommit(h, 'op-keep', { postingIds: ['P-100'] });   // stage «stock»: nothing was written
  t0cFailJournal(h);
  const first = t0cResolve(h, 'tok-admin', 'op-keep', 'complete');            // stock + history written, the journal fails
  const pending = t0cPending(h);
  const memoText = t0cMemoKeys(h).map(k => String(t0cMemo(h)[k])).join('');
  const second = t0cResolve(h, 'tok-admin', 'op-keep', 'complete');           // completes the journal
  return {
    conds: {
      'the commit action failed at the stock write': failed.status === 'error',
      'the first complete answered success with a costJournalError': first.status === 'success' && !!(first.data && first.data.costJournalError),
      'the posting is linked by the first complete': h.dumpExternalShipments()[0]['Статус'] === 'processed',
      'the memo is still the commit action\'s: origin «commit», stage journal, canComplete true, postingIds kept': Array.isArray(pending) && pending.length === 1 && pending[0].origin === 'commit'
        && pending[0].stage === 'journal' && pending[0].canComplete === true && memoText.indexOf('P-100') !== -1,
      'the second complete answered success, one journal row, one history row, 8/800, memo gone': second.status === 'success' && t0cJournal(h, 'op-keep').length === 1
        && t0cRows(h, 'op-keep').length === 1 && t0cStock(h) === '8/800' && t0cMemoKeys(h).length === 0
    },
    note: 'first ' + JSON.stringify(first).slice(0, 160) + ' | pending ' + JSON.stringify(pending) + ' | second ' + JSON.stringify(second).slice(0, 100)
  };
});

t0cCheck('T0-C: a memo save cut short (a Script Property write fails part-way) leaves no memo at all: nothing listed, the stock untouched, the retry runs normally and leaves no orphan keys', () => {
  const h = t0cStand();
  const names = Array.from({ length: 200 }, (_, i) => 'Артикул_' + String(i + 1).padStart(3, '0'));
  h.setStockSheet(names.map(a => ({ article: a, quantity: 10, avgCost: 100, capitalization: 1000 })));
  const items = names.map(a => ({ article: a, quantity: 2, price: 100 }));
  const service = h.context.PropertiesService;
  const realGet = service.getScriptProperties;
  let memoWrites = 0;
  service.getScriptProperties = () => {
    const props = realGet();
    const setProperty = props.setProperty;
    return Object.assign({}, props, { setProperty: (key, value) => {
      if (String(key).indexOf('pendingOp:') === 0 && ++memoWrites === 2) throw new Error('Injected property failure');
      return setProperty(key, value);
    } });
  };
  const err = t0cThrows(() => t0cCommit(h, 'op-cut', items, 'Яндекс'));
  service.getScriptProperties = realGet;
  const untouched = names.every(a => t0cStock(h, a) === '10/1000');
  const listed = t0cPending(h);
  const retryErr = t0cThrows(() => t0cCommit(h, 'op-cut', items, 'Яндекс'));
  return {
    conds: {
      'the commit failed on the second memo write': err !== '' && memoWrites >= 2,
      'no stock row was touched': untouched,
      'no operation is listed (an unfinished save is no memo, and no damaged one either)': Array.isArray(listed) && listed.length === 0,
      'the retry did not throw': retryErr === '',
      '200 history rows, every article 8/800': t0cRows(h, 'op-cut').length === 200 && names.every(a => t0cStock(h, a) === '8/800'),
      'no memo key left, orphans included': t0cMemoKeys(h).length === 0
    },
    note: 'failure: ' + err + ' | listed ' + JSON.stringify(listed) + ' | retry: ' + (retryErr || 'ok')
  };
});


// ----- Code-review findings on C1 (written test-first; the coder builds the fixes next) -----
//  1. The stage was inferred from stock values alone. The memo now records that the stock write actually happened (a flag
//     written right after flushStockRows succeeds). Without the flag the stage is 'stock' only when the stock equals «before»,
//     otherwise 'conflict'; with the flag it is 'history' only when the stock equals «after», otherwise 'conflict'.
//  2. «История» rows present but no journal applies (a «Приход», a «Расход» to a non-Ozon destination, skipOzonCost) is stage
//     'done', not 'journal': origin 'commit' -> canComplete true (the idempotent commit path + the posting link, then the memo
//     goes); origin 'other' -> canComplete false, canCancel false (dismiss only). 'journal' only when the journal applies and
//     its row of the opId is missing.
//  3. A damaged memo is not listed by getInitialData while the script lock is busy (it has no age), only with the lock free.
function t0cFailOnceAfterWrite(sheet, matches) {
  const original = sheet.getRange.bind(sheet);
  let armed = true;
  sheet.getRange = (...args) => {
    const range = original(...args);
    const setValues = range.setValues.bind(range);
    range.setValues = (rows) => {
      if (armed && matches(args)) { armed = false; setValues(rows); throw new Error('Injected failure after the write'); }
      return setValues(rows);
    };
    return range;
  };
}
// The first deleteProperty of a memo key AFTER the operation's «История» rows exist throws: the commit has written everything
// and dies on its very last step. (An earlier delete — a memo rewritten to set a flag, say — is let through, so the injection
// does not depend on how the memo is maintained.)
function t0cFailMemoDeleteOnce(h) {
  const service = h.context.PropertiesService;
  const realGet = service.getScriptProperties;
  let armed = true;
  service.getScriptProperties = () => {
    const props = realGet();
    const deleteProperty = props.deleteProperty;
    return Object.assign({}, props, { deleteProperty: (key) => {
      const text = String(key);
      if (armed && text.indexOf('pendingOp:') === 0) {
        const opId = text.slice('pendingOp:'.length).replace(/:\d+$/, '');
        if (h.dumpTransSheet().some(r => String(r['OpID']) === opId)) { armed = false; throw new Error('Injected memo delete failure'); }
      }
      return deleteProperty(key);
    } });
  };
}
const t0cStageOf = (h, opId) => { const p = t0cPending(h); const e = Array.isArray(p) ? p.filter(x => x.opId === opId)[0] : undefined; return e ? e.stage + (e.canComplete ? '+complete' : '') + (e.canCancel ? '+cancel' : '') : 'not listed'; };
const t0cAllExpenseRows = (h) => h.getTransactions().rows.filter(t => t.type === 'Расход');

t0cCheck('T0-C: review 1 — the same expense entered again under a NEW opId after a failed stock write: the first memo is a conflict (never «history»); retry, complete and cancel are refused and the legitimate deduction stays', () => {
  // op-A: the stock write failed (10/1000, memo stage «stock»); the user enters the same expense again as op-B: 8/800.
  const scenario = () => {
    const h = t0cStand();
    t0cFailStock(h);
    const first = t0cBrowserCommit(h, 'op-A');
    const premise = t0cStageOf(h, 'op-A') + ' ' + t0cStock(h);
    const second = t0cBrowserCommit(h, 'op-B');
    return { h, first, second, premise };
  };
  const base = scenario();
  const pending = t0cPending(base.h);
  const entry = Array.isArray(pending) ? pending.filter(p => p.opId === 'op-A')[0] : undefined;
  const untouched = (h) => t0cStock(h) === '8/800' && t0cAllExpenseRows(h).length === 1 && t0cAllExpenseRows(h)[0].opId === 'op-B'
    && h.dumpOzonCost().length === 1 && h.dumpOzonCost()[0]['OpID'] === 'op-B' && t0cMemoKeys(h).some(k => k.indexOf('pendingOp:op-A') === 0);

  const r = scenario();
  const retry = t0cBrowserCommit(r.h, 'op-A');
  const c = scenario();
  const complete = t0cResolve(c.h, 'tok-admin', 'op-A', 'complete');
  const d = scenario();
  const cancel = t0cResolve(d.h, 'tok-admin', 'op-A', 'cancel');
  const notUnknown = (out) => out.status === 'error' && !/Unknown action/.test(String(out.message));
  return {
    conds: {
      'premise: after the failed stock write the first memo is stage «stock» and the stock is 10/1000': base.premise === 'stock+complete+cancel 10/1000',
      'premise: the second entry succeeded, stock 8/800': base.second.status === 'success' && t0cStock(base.h) === '8/800',
      'op-A is listed as stage «conflict», canComplete false, canCancel false': !!entry && entry.stage === 'conflict' && entry.canComplete === false && entry.canCancel === false,
      'only op-A is listed (the new operation left no memo)': Array.isArray(pending) && pending.length === 1,
      'a retry of op-A through the commit action is refused, and nothing changed': notUnknown(retry) && untouched(r.h),
      'resolve «complete» is refused, and nothing changed (no second «История» row, no second journal row)': notUnknown(complete) && untouched(c.h),
      'resolve «cancel» is refused and does NOT put 10/1000 back over the new operation': notUnknown(cancel) && untouched(d.h)
    },
    note: 'op-A: ' + t0cStageOf(base.h, 'op-A') + ' | retry ' + retry.status + ' stock ' + t0cStock(r.h) + ' rows ' + t0cAllExpenseRows(r.h).length
      + ' | complete ' + complete.status + ' stock ' + t0cStock(c.h) + ' rows ' + t0cAllExpenseRows(c.h).length + ' journal ' + c.h.dumpOzonCost().length
      + ' | cancel ' + cancel.status + ' stock ' + t0cStock(d.h) + ' rows ' + t0cAllExpenseRows(d.h).length
  };
});

t0cCheck('T0-C: review 1 — the stock-written flag decides the stage: without it only «before» is «stock» (a write that persisted and then failed is a conflict), with it only «after» is «history» (a stock put back to «before» is a conflict)', () => {
  // (i) the stock write persisted and the request died before the flag could be written
  const a = t0cStand();
  t0cFailOnceAfterWrite(a.getRegistrySheet('Остатки'), (args) => args[0] > 1);
  const aFailed = t0cBrowserCommit(a, 'op-flag-a');
  const aStage = t0cStageOf(a, 'op-flag-a');
  const aRetry = t0cBrowserCommit(a, 'op-flag-a');
  // (ii) the flag is there (the «История» write failed) and the stock was then put back to «before» by hand
  const b = t0cStand();
  t0cFailHistory(b);
  const bFailed = t0cBrowserCommit(b, 'op-flag-b');
  const bStageBefore = t0cStageOf(b, 'op-flag-b');
  b.getRegistrySheet('Остатки').getRange(2, 2, 1, 3).setValues([[10, 100, 1000]]);
  const bStage = t0cStageOf(b, 'op-flag-b');
  const bCancel = t0cResolve(b, 'tok-admin', 'op-flag-b', 'cancel');
  return {
    conds: {
      '(i) the commit failed with the stock already written (8/800)': aFailed.status === 'error' && t0cStock(a) === '8/800',
      '(i) no flag, stock = «after»: stage conflict, nothing can be pressed': aStage === 'conflict',
      '(i) the retry is refused and writes nothing (stock stays 8/800, no history row)': aRetry.status === 'error' && t0cStock(a) === '8/800' && t0cAllExpenseRows(a).length === 0,
      '(ii) premise: the flag is there, stock = «after»: stage history, both buttons': bFailed.status === 'error' && bStageBefore === 'history+complete+cancel',
      '(ii) flag set, stock put back to «before»: stage conflict (not «stock»)': bStage === 'conflict',
      '(ii) cancel is refused': bCancel.status === 'error' && !/Unknown action/.test(String(bCancel.message))
    },
    note: '(i) ' + aStage + ' retry ' + aRetry.status + ' ' + t0cStock(a) + ' | (ii) ' + bStageBefore + ' -> ' + bStage + ' | cancel ' + JSON.stringify(bCancel).slice(0, 100)
  };
});

t0cCheck('T0-C: review 2 — origin «commit», rows in «История» and nothing missing (memo delete failed once): stage «done», complete finishes it with the posting link and nothing duplicated (non-Ozon and Ozon with its journal row)', () => {
  const posting = { postingId: 'P-100', cabinet: 'MaxiStore', status: 'new', items: [{ offerId: 'A', quantity: 2 }] };
  // (a) a shipment to a non-Ozon destination: no journal applies
  const a = t0cStand();
  a.setExternalShipmentsSheet([posting]);
  t0cFailMemoDeleteOnce(a);
  const aFailed = t0cBrowserCommit(a, 'op-done-a', { destination: 'Яндекс', postingIds: ['P-100'] });
  const aPending = t0cPending(a);
  const aEntry = Array.isArray(aPending) ? aPending.filter(p => p.opId === 'op-done-a')[0] : undefined;
  const aPostingBefore = a.dumpExternalShipments()[0]['Статус'];
  const aComplete = t0cResolve(a, 'tok-admin', 'op-done-a', 'complete');
  // (b) a shipment to Ozon whose journal row was written: the journal is NOT missing
  const b = t0cStand();
  t0cFailMemoDeleteOnce(b);
  const bFailed = t0cBrowserCommit(b, 'op-done-b');
  const bPending = t0cPending(b);
  const bEntry = Array.isArray(bPending) ? bPending.filter(p => p.opId === 'op-done-b')[0] : undefined;
  const bComplete = t0cResolve(b, 'tok-admin', 'op-done-b', 'complete');
  return {
    conds: {
      '(a) the commit died on the memo delete, after every write': aFailed.status === 'error' && t0cRows(a, 'op-done-a').length === 1 && t0cStock(a) === '8/800' && aPostingBefore === 'new',
      '(a) stage «done», origin commit, canComplete true, canCancel false': !!aEntry && aEntry.stage === 'done' && aEntry.origin === 'commit' && aEntry.canComplete === true && aEntry.canCancel === false,
      '(a) complete answered success, linked the posting, left one row, 8/800, no journal row, no memo': aComplete.status === 'success' && a.dumpExternalShipments()[0]['Статус'] === 'processed'
        && t0cRows(a, 'op-done-a').length === 1 && t0cStock(a) === '8/800' && a.dumpOzonCost().length === 0 && t0cMemoKeys(a).length === 0 && t0cNoPending(a),
      '(b) the commit died on the memo delete, the journal row is there': bFailed.status === 'error' && t0cRows(b, 'op-done-b').length === 1 && t0cJournal(b, 'op-done-b').length === 1,
      '(b) stage «done» (not «journal»), origin commit, canComplete true, canCancel false': !!bEntry && bEntry.stage === 'done' && bEntry.origin === 'commit' && bEntry.canComplete === true && bEntry.canCancel === false,
      '(b) complete answered success, still one history row and one journal row, 8/800, no memo': bComplete.status === 'success' && t0cRows(b, 'op-done-b').length === 1
        && t0cJournal(b, 'op-done-b').length === 1 && t0cStock(b) === '8/800' && t0cMemoKeys(b).length === 0
    },
    note: '(a) pending ' + JSON.stringify(aPending) + ' | (b) pending ' + JSON.stringify(bPending)
  };
});

t0cCheck('T0-C: review 2 — origin «other», a «Приход» fully written (memo delete failed once): stage «done», no button but «dismiss»; complete is refused; the module\'s own retry and the dismiss both leave one receipt', () => {
  const receipt = (h) => h.commitTransaction([{ article: 'A', quantity: 3, price: 100 }], 'Приход', 'Поставка', '', 'tester', '2026-10-19T07:00:00Z', 'op-rcpt', null);
  const receipts = (h) => h.dumpTransSheet().filter(r => String(r['Тип']) === 'Приход' && String(r['OpID']) === 'op-rcpt');
  const a = t0cStand();
  t0cFailMemoDeleteOnce(a);
  const err = t0cThrows(() => receipt(a));
  const pending = t0cPending(a);
  const entry = Array.isArray(pending) ? pending.filter(p => p.opId === 'op-rcpt')[0] : undefined;
  const complete = t0cResolve(a, 'tok-admin', 'op-rcpt', 'complete');
  const afterRefusal = t0cStock(a) + ' receipts ' + receipts(a).length + ' memo ' + (t0cMemoKeys(a).length > 0);
  const retryErr = t0cThrows(() => receipt(a));
  // the other way out: the admin dismisses it
  const b = t0cStand();
  t0cFailMemoDeleteOnce(b);
  t0cThrows(() => receipt(b));
  const dismissed = t0cResolve(b, 'tok-admin', 'op-rcpt', 'dismiss');
  return {
    conds: {
      'the receipt died on the memo delete, after every write (13/1300, one row)': err !== '' && afterRefusal === '13/1300 receipts 1 memo true',
      'stage «done», origin other, canComplete false, canCancel false': !!entry && entry.stage === 'done' && entry.origin === 'other' && entry.canComplete === false && entry.canCancel === false,
      'resolve «complete» is refused (not an unknown action)': complete.status === 'error' && !/Unknown action/.test(String(complete.message)),
      'the module\'s own retry with the same opId completes without a second receipt: 13/1300, one row, memo gone': retryErr === '' && t0cStock(a) === '13/1300' && receipts(a).length === 1 && t0cMemoKeys(a).length === 0,
      'dismiss succeeds, removes the memo and leaves the receipt (13/1300, one row)': dismissed.status === 'success' && t0cMemoKeys(b).length === 0 && t0cStock(b) === '13/1300' && receipts(b).length === 1
    },
    note: 'pending ' + JSON.stringify(pending) + ' | after refusal ' + afterRefusal + ' | complete ' + JSON.stringify(complete).slice(0, 120) + ' | retry ' + (retryErr || 'ok')
  };
});

t0cCheck('T0-C: review 3 — a damaged memo is listed by getInitialData only while the script lock is free (it has no age to judge by); a healthy old memo is listed either way, getPendingOperations() lists both', () => {
  const h = t0cStand();
  h.setNow('2026-10-22T10:00:00Z');
  t0cFailHistory(h);
  t0cBrowserCommit(h, 'op-old');
  h.context.PropertiesService.getScriptProperties().setProperty('pendingOp:op-dmg:0', 'not a memo {');
  const listed = (at, busy) => {
    h.setNow(at);
    h.setScriptLockBusy(busy);
    const out = h.callDoPost({ action: 'getInitialData', sessionToken: 'tok-user', data: {} });
    h.setScriptLockBusy(false);
    return out.status === 'success' ? out.data.pendingOperations.map(p => p.opId).sort() : 'error: ' + out.message;
  };
  const same = (v, ids) => JSON.stringify(v) === JSON.stringify(ids);
  const freeFresh = listed('2026-10-22T10:00:30Z', false);
  const busyFresh = listed('2026-10-22T10:00:30Z', true);
  const busyOld = listed('2026-10-22T10:08:00Z', true);
  const freeOld = listed('2026-10-22T10:08:00Z', false);
  const direct = t0cPending(h);
  return {
    conds: {
      'lock free: both are listed': same(freeFresh, ['op-dmg', 'op-old']) && same(freeOld, ['op-dmg', 'op-old']),
      'lock busy, everything fresh: nothing is listed, the damaged memo included': same(busyFresh, []),
      'lock busy, the healthy memo 8 minutes old: only it is listed, the damaged one is not': same(busyOld, ['op-old']),
      'getPendingOperations() without an age lists both': Array.isArray(direct) && direct.map(p => p.opId).sort().join() === 'op-dmg,op-old'
    },
    note: JSON.stringify({ freeFresh, busyFresh, busyOld, freeOld })
  };
});

// Found by a mutation of the review fix: finishing stage «done» must not run the cost-journal code at all (the append
// would only find its row and "revive" it in place, a rewrite nobody asked for).
t0cCheck('T0-C: stage «done» is finished without touching the cost journal — neither the append nor the resync runs (resolve «complete» and the commit retry), the journal sheet stays as it was; stage «journal» does run it', () => {
  const spy = (h) => {
    const calls = [];
    ['appendOzonCostForShipment', 'resyncOzonCostForOps', 'reissueOzonCostRows'].forEach(name => {
      const real = h.context[name];
      h.context[name] = function () { calls.push(name); return real.apply(this, arguments); };
    });
    return calls;
  };
  const doneStand = (opId) => {
    const h = t0cStand();
    t0cFailMemoDeleteOnce(h);
    t0cBrowserCommit(h, opId);                       // every write done, the memo delete died: stage «done»
    return h;
  };
  const a = doneStand('op-nj-a');
  const aStage = t0cStageOf(a, 'op-nj-a');
  const aJournalBefore = JSON.stringify(a.dumpOzonCostFull());
  const aCalls = spy(a);
  const aResolve = t0cResolve(a, 'tok-admin', 'op-nj-a', 'complete');
  const b = doneStand('op-nj-b');
  const bJournalBefore = JSON.stringify(b.dumpOzonCostFull());
  const bCalls = spy(b);
  const bRetry = t0cBrowserCommit(b, 'op-nj-b');
  // the control: a real stage «journal» does run the journal code
  const c = t0cStand();
  t0cFailJournal(c);
  t0cBrowserCommit(c, 'op-nj-c');
  const cCalls = spy(c);
  const cResolve = t0cResolve(c, 'tok-admin', 'op-nj-c', 'complete');
  return {
    conds: {
      'premise: the stand is at stage «done» (Ozon, journal row present)': aStage.indexOf('done') === 0 && a.dumpOzonCost().length === 1,
      'resolve «complete» on «done»: success, no journal function called, journal sheet unchanged, memo gone': aResolve.status === 'success' && aCalls.length === 0
        && JSON.stringify(a.dumpOzonCostFull()) === aJournalBefore && t0cMemoKeys(a).length === 0,
      'the commit retry on «done»: no journal function called, journal sheet unchanged, memo gone': bRetry.status === 'success' && bCalls.length === 0
        && JSON.stringify(b.dumpOzonCostFull()) === bJournalBefore && t0cMemoKeys(b).length === 0,
      'control: completing a real stage «journal» does call the journal append and writes its row': cResolve.status === 'success' && cCalls.indexOf('appendOzonCostForShipment') !== -1 && t0cJournal(c, 'op-nj-c').length === 1
    },
    note: 'done calls: resolve [' + aCalls.join() + '] retry [' + bCalls.join() + '] | journal control [' + cCalls.join() + ']'
  };
});

// ----- Spec pins the review found missing (guards: they may already pass) -----
t0cCheck('T0-B: a service sum not divisible by its quantity — «x3 (100.01₽)» keeps 100.01 through parse, total and rebuild, and through a «Вся отгрузка» re-save (newTotal 100.01, text unchanged, nothing changed)', () => {
  const h = freshHarness();
  const text = 'Ozon (MaxiStore) [Услуги: Packing x3 (100.01₽)]';
  const e = h.context.parseShipmentExtrasGs(text);
  const parsedTotal = h.context.extrasTotalGs(e);
  const rebuilt = h.context.buildDestinationGs(e, e, 1);
  h.ensureTransSheet();
  h.ensureArchiveSheet();
  h.setOzonCostSheet([]);
  h.setStockSheet([{ article: 'A', quantity: 10, avgCost: 100, capitalization: 1000 }]);
  h.commitTransaction([{ article: 'A', quantity: 1, price: 100 }], 'Расход', text, '2026-10-19', 'tester', '2026-10-19T07:00:00Z', 't0b-100-01', null);
  const row = h.getTransactions().rows[0];
  const stored = h.context.parseShipmentExtrasGs(row.destination).services;
  const res = h.updateShipmentExtras({ id: row.id, packagingMode: 'batch', packagingValue: 0, otherMode: 'batch', otherValue: 0, services: stored }, 'tester');
  const after = h.getTransactions().rows[0];
  return {
    conds: {
      'parse + extrasTotalGs give 100.01': parsedTotal === 100.01,
      'buildDestinationGs gives the same text back': rebuilt === text,
      'the commit priced the piece at 200.01': row.price === 200.01 && row.total === 200.01,
      'the re-save from the stored entries: newTotal 100.01': res.newTotal === 100.01,
      'the re-save changed nothing: text unchanged, 0 rows changed, total 200.01': after.destination === text && res.changedRows === 0 && after.total === 200.01
    },
    note: parsedTotal + ' | ' + rebuilt + ' | newTotal ' + res.newTotal + ' changed ' + res.changedRows + ' ' + after.destination
  };
});

t0cCheck('T0-B: the ticket\'s original example on the remaining editor — A 1 @ 100 + B 1 @ 900, «Вся отгрузка» adds one service of 100: rows 150 / 950 (split by pieces), stock and write-off cost unchanged', () => {
  const h = freshHarness();
  h.ensureTransSheet();
  h.ensureArchiveSheet();
  h.setOzonCostSheet([]);
  h.setStockSheet([{ article: 'A', quantity: 10, avgCost: 100, capitalization: 1000 }, { article: 'B', quantity: 10, avgCost: 900, capitalization: 9000 }]);
  h.commitTransaction([{ article: 'A', quantity: 1, price: 100 }, { article: 'B', quantity: 1, price: 900 }], 'Расход', 'Яндекс', '2026-10-19', 'tester', '2026-10-19T07:00:00Z', 'ticket-example', null);
  const rows = () => h.getTransactions().rows.filter(t => t.type === 'Расход').sort((x, y) => x.article.localeCompare(y.article));
  const before = rows().map(t => t.article + ':' + t.total).join(' ');
  const stockBefore = JSON.stringify([h.stockOf('A'), h.stockOf('B')]);
  const res = h.updateShipmentExtras({ id: rows()[0].id, packagingMode: 'batch', packagingValue: 0, otherMode: 'batch', otherValue: 0,
    services: [{ name: 'Packing', quantity: 1, unitCost: 100 }] }, 'tester');
  const after = rows();
  return {
    conds: {
      'premise: the rows were 100 / 900': before === 'A:100 B:900',
      'newTotal 100 and the text carries the service': res.newTotal === 100 && after[0].destination.indexOf('Packing x1 (100₽)') !== -1,
      'rows are 150 / 950, not 210 / 1090': after.map(t => t.article + ':' + t.total).join(' ') === 'A:150 B:950',
      'write-off cost and stock unchanged': after.map(t => t.writeOffCost).join() === '100,900' && JSON.stringify([h.stockOf('A'), h.stockOf('B')]) === stockBefore
    },
    note: before + ' -> ' + after.map(t => t.article + ':' + t.total).join(' ') + ' newTotal ' + res.newTotal
  };
});

// ================= Item 100.3 / R-026: expectedQuantities on the doPost 'commit' path =================
// Test-first. Contract: the browser may send `expectedQuantities` (article -> quantity the user saw); the server compares it with the
// «Остатки» values it reads (missing article = 0) after the opId idempotency hit, before any write; a mismatch throws and writes nothing.
const r026Rows = (h) => h.getTransactions().rows.length;
const r026Commit = (h, opId, type, qty, expected, destination) => h.callDoPost(Object.assign({ action: 'commit', sessionToken: 'tok-user', type: type,
  destination: destination || 'Склад [Корректировка остатка]', deliveryDate: '2026-10-19', opId: opId, data: [{ article: 'A', quantity: qty, price: 100 }] },
  expected === undefined ? {} : { expectedQuantities: expected }));
const r026Stand = (qty) => {
  const h = t0cStand();
  h.setStockSheet(qty === null ? [] : [{ article: 'A', quantity: qty, avgCost: 100, capitalization: qty * 100 }]);
  return h;
};
t0cCheck('R-026: s1 — stock moved 10 -> 15 after the screen loaded, expected {A:10}, Расход 2 -> refused, stock stays 15, nothing written, no memo', () => {
  const h = r026Stand(15);
  const rowsBefore = r026Rows(h);
  const out = r026Commit(h, 'op-r026-1', 'Расход', 2, { A: 10 });
  const msg = String(out.message || '');
  return {
    conds: {
      'doPost answered an error': out.status === 'error',
      'the message names the article, the seen value 10 and the current value 15': /A/.test(msg) && /10/.test(msg) && /15/.test(msg),
      'stock still 15': h.stockOf('A').quantity === 15,
      'no new history rows': r026Rows(h) === rowsBefore,
      'no pending-op memo left': t0cMemoKeys(h).length === 0
    },
    note: 'status ' + out.status + ' | message ' + msg + ' | stock ' + h.stockOf('A').quantity + ' | rows ' + rowsBefore + '->' + r026Rows(h) + ' | memo ' + t0cMemoKeys(h).length
  };
});
t0cCheck('R-026: s2 — stock 10, expected {A:10}, Расход 2 -> written, stock 8', () => {
  const h = r026Stand(10);
  const out = r026Commit(h, 'op-r026-2', 'Расход', 2, { A: 10 });
  return {
    conds: { 'doPost answered success': out.status === 'success', 'stock 8': h.stockOf('A').quantity === 8, 'one history row': r026Rows(h) === 1 },
    note: 'status ' + out.status + ' ' + (out.message || '') + ' | stock ' + h.stockOf('A').quantity + ' | rows ' + r026Rows(h)
  };
});
t0cCheck('R-026: s3 — article absent from «Остатки», expected {A:0}, Приход 5 -> written (missing = 0)', () => {
  const h = r026Stand(null);
  const out = r026Commit(h, 'op-r026-3', 'Приход', 5, { A: 0 }, 'Склад');
  return {
    conds: { 'doPost answered success': out.status === 'success', 'stock 5': h.stockOf('A').quantity === 5 },
    note: 'status ' + out.status + ' ' + (out.message || '') + ' | stock ' + h.stockOf('A').quantity
  };
});
t0cCheck('R-026: s3b — article absent from «Остатки», expected {A:7}, Приход 5 -> refused (missing counts as 0), nothing written', () => {
  const h = r026Stand(null);
  const out = r026Commit(h, 'op-r026-3b', 'Приход', 5, { A: 7 }, 'Склад');
  return {
    conds: { 'doPost answered an error': out.status === 'error', 'no history rows': r026Rows(h) === 0 },
    note: 'status ' + out.status + ' ' + (out.message || '') + ' | rows ' + r026Rows(h)
  };
});
t0cCheck('R-026: s4 — the same opId retried with a now-stale expected is an idempotent hit: not refused, nothing written twice', () => {
  const h = r026Stand(10);
  const first = r026Commit(h, 'op-r026-4', 'Расход', 2, { A: 10 });
  const rowsAfterFirst = r026Rows(h);
  const retry = r026Commit(h, 'op-r026-4', 'Расход', 2, { A: 10 });   // stock is now 8, so {A:10} is stale
  return {
    conds: { 'first commit succeeded': first.status === 'success', 'retry answered success, not an error': retry.status === 'success',
      'stock 8, not 6': h.stockOf('A').quantity === 8, 'history rows unchanged by the retry': r026Rows(h) === rowsAfterFirst },
    note: 'first ' + first.status + ' | retry ' + retry.status + ' ' + (retry.message || '') + ' | stock ' + h.stockOf('A').quantity + ' | rows ' + rowsAfterFirst + '->' + r026Rows(h)
  };
});
t0cCheck('R-026: s5 — a commit without expectedQuantities is unaffected (regression)', () => {
  const h = r026Stand(15);
  const out = r026Commit(h, 'op-r026-5', 'Расход', 2, undefined);
  return {
    conds: { 'doPost answered success': out.status === 'success', 'stock 13': h.stockOf('A').quantity === 13 },
    note: 'status ' + out.status + ' ' + (out.message || '') + ' | stock ' + h.stockOf('A').quantity
  };
});
t0cCheck('R-026: s6 — quantity cell is -3 (screen shows 0), expected {A:0}, Приход 8 -> accepted, not refused', () => {
  const h = r026Stand(-3);
  const out = r026Commit(h, 'op-r026-6', 'Приход', 8, { A: 0 }, 'Склад');
  const msg = String(out.message || '');
  return {
    conds: { 'doPost did not refuse (no «изменился» message)': !/изменился/.test(msg), 'doPost answered success': out.status === 'success' },
    note: 'status ' + out.status + ' | message ' + msg
  };
});
t0cCheck('R-026: s6b — quantity cell is -3 (screen shows 0), expected {A:5}, Приход 8 -> refused', () => {
  const h = r026Stand(-3);
  const out = r026Commit(h, 'op-r026-6b', 'Приход', 8, { A: 5 }, 'Склад');
  return {
    conds: { 'doPost answered an error': out.status === 'error', 'no history rows': r026Rows(h) === 0 },
    note: 'status ' + out.status + ' | message ' + (out.message || '') + ' | rows ' + r026Rows(h)
  };
});
t0cCheck('R-026: s7 — quantity cell is the TEXT "1 000" (screen shows 1000), expected {A:1000}, Расход 2 -> accepted, not refused', () => {
  const h = r026Stand('1 000');
  const out = r026Commit(h, 'op-r026-7', 'Расход', 2, { A: 1000 });
  const msg = String(out.message || '');
  return {
    conds: { 'doPost did not refuse (no «изменился» message)': !/изменился/.test(msg), 'doPost answered success': out.status === 'success' },
    note: 'status ' + out.status + ' | message ' + msg
  };
});

// ================= Item 101 ticket 02: stale cargo-label cleanup in saveSupplyDocsToDrive =================
const harness = require('./harness.cjs');
function staleStand(extraNames) {
  const root = harness.resetFakeDrive();
  const order = root.createFolder('Order-1');
  const files = {};
  (extraNames || []).forEach(n => { files[n] = order.__addFile(n); });
  return { root, order, files };
}
function staleRun(st, data) {
  return harness.saveSupplyDocsToDrive(Object.assign({ folderName: 'Order-1', files: [], articles: [] }, data));
}
const STALE_NAMES = [
  '2000072172420.pdf', 'tags-cargoes-by-supply-2000072172420.zip', '20000721724201.pdf',
  'Новосибирск.xlsx', 'ART-1.pdf', '2000099999999.pdf'
];
t0cCheck('Item 101 stale labels: <id>.pdf of the stale supply is trashed and reported in removedStaleLabels', () => {
  const st = staleStand(STALE_NAMES);
  const out = staleRun(st, { staleLabelSupplyIds: ['2000072172420'] });
  return {
    conds: { 'file trashed': st.files['2000072172420.pdf'].isTrashed(), 'reported': JSON.stringify(out.removedStaleLabels) === '["2000072172420"]' },
    note: 'removed ' + JSON.stringify(out.removedStaleLabels)
  };
});
t0cCheck('Item 101 stale labels: tags-cargoes-by-supply-<id>.zip of the stale supply is trashed', () => {
  const st = staleStand(STALE_NAMES);
  staleRun(st, { staleLabelSupplyIds: ['2000072172420'] });
  return { conds: { 'zip trashed': st.files['tags-cargoes-by-supply-2000072172420.zip'].isTrashed() } };
});
t0cCheck('Item 101 stale labels: longer id with the same prefix, composition xlsx, product label and another supply label are untouched', () => {
  const st = staleStand(STALE_NAMES);
  staleRun(st, { staleLabelSupplyIds: ['2000072172420'] });
  const untouched = ['20000721724201.pdf', 'Новосибирск.xlsx', 'ART-1.pdf', '2000099999999.pdf'];
  const conds = {};
  untouched.forEach(n => { conds[n + ' not trashed'] = !st.files[n].isTrashed(); });
  return { conds };
});
t0cCheck('Item 101 stale labels: a non-digit id is ignored and trashes nothing', () => {
  const st = staleStand(STALE_NAMES.concat(['abc.pdf']));
  const out = staleRun(st, { staleLabelSupplyIds: ['abc', '', '12.*', '../x'] });
  const any = Object.keys(st.files).some(n => st.files[n].isTrashed());
  return { conds: { 'nothing trashed': !any, 'nothing reported': out.removedStaleLabels.length === 0 }, note: JSON.stringify(out.removedStaleLabels) };
});
t0cCheck('Item 101 stale labels: no staleLabelSupplyIds -> nothing trashed and removedStaleLabels is an empty array', () => {
  const st = staleStand(STALE_NAMES);
  const out = staleRun(st, {});
  const any = Object.keys(st.files).some(n => st.files[n].isTrashed());
  return { conds: { 'nothing trashed': !any, 'empty array': Array.isArray(out.removedStaleLabels) && out.removedStaleLabels.length === 0 } };
});
t0cCheck('Item 101 stale labels: of two ids only the one with a live file is reported, the id whose file was already trashed is not', () => {
  const st = staleStand(['2000072172420.pdf', '2000099999999.pdf']);
  st.files['2000072172420.pdf'].setTrashed(true);
  const out = staleRun(st, { staleLabelSupplyIds: ['2000072172420', '2000099999999'] });
  return { conds: { 'only the live one reported': JSON.stringify(out.removedStaleLabels) === '["2000099999999"]' }, note: JSON.stringify(out.removedStaleLabels) };
});
t0cCheck('Item 101 stale labels: only an already trashed match -> removedStaleLabels is empty', () => {
  const st = staleStand(['2000072172420.pdf']);
  st.files['2000072172420.pdf'].setTrashed(true);
  const out = staleRun(st, { staleLabelSupplyIds: ['2000072172420'] });
  return { conds: { 'empty': out.removedStaleLabels.length === 0 }, note: JSON.stringify(out.removedStaleLabels) };
});
t0cCheck('Item 101 stale labels: a fresh label of another supply in the same call is still written and the stale one trashed', () => {
  const st = staleStand(STALE_NAMES);
  const realFetch = harness.context.UrlFetchApp.fetch;
  harness.context.UrlFetchApp.fetch = () => ({
    getResponseCode: () => 200,
    getBlob: () => harness.makeFakeDriveBlob('x'),
    getAllHeaders: () => ({ 'Content-Type': 'application/pdf' })
  });
  let out;
  try {
    out = staleRun(st, {
      staleLabelSupplyIds: ['2000072172420'],
      files: [{ kind: 'url', url: 'https://ozon.fake/label', fallbackName: 'tags-cargoes-by-supply-2000099999999' }]
    });
  } finally { harness.context.UrlFetchApp.fetch = realFetch; }
  const written = st.order.__files.filter(f => f.getName() === 'tags-cargoes-by-supply-2000099999999.pdf' && !f.isTrashed());
  return {
    conds: { 'new label written': written.length === 1, 'stale trashed': st.files['2000072172420.pdf'].isTrashed(), 'saved lists it': out.saved.indexOf('tags-cargoes-by-supply-2000099999999.pdf') >= 0 },
    note: 'saved ' + JSON.stringify(out.saved) + ' problems ' + JSON.stringify(out.problems)
  };
});

// ================= Item 101 ticket 03: getSupplyDocsState, savedBySupply, purgeExpiredSupplyDocsCargoIds =================
const RESUME_JOURNAL_HEADERS = ['ID', 'Дата', 'Кабинет', 'DraftID', 'OrderID', 'Точка отгрузки', 'Кластеры', 'Состав', 'Кто', 'Статус', 'Документы'];
function resumeStand(rows) {
  const H = freshHarness();
  H.setNow('2026-11-01T12:00:00Z');
  const root = H.resetFakeDrive();
  const ss = H.context.SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.insertSheet('Заявки Ozon');
  sheet.__setData([RESUME_JOURNAL_HEADERS.slice()].concat(rows));
  return { H, root, sheet, ctx: H.context };
}
const resumeRow = (id, orderId, docs, date) => [id, new Date(date || '2026-10-30T10:00:00Z'), 'Mercurius', 'D1', orderId, 'Точка', '1', '[]', 'Николай', 'Создана', docs];
const resumeRecord = (atIso, ids) => JSON.stringify({
  at: atIso, orderNumber: 'N1', folderName: 'Озон N1', ok: true,
  supplies: [
    { supplyId: '2000000000011', clusterName: 'Казань', cargoIds: ids.slice(), composition: true, label: true },
    { supplyId: '2000000000012', clusterName: 'Самара', cargoIds: ids.slice(), composition: true, label: false }
  ]
});

t0cCheck('Item 101 getSupplyDocsState: returns the docsJSON of the LAST journal row of the order that has one, and the live file names of the order folder', () => {
  const st = resumeStand([
    resumeRow('R1', '777', '{"at":"old"}'),
    resumeRow('R2', '888', '{"at":"other order"}'),
    resumeRow('R3', '777', '{"at":"newest"}'),
    resumeRow('R4', '777', '')
  ]);
  const folder = st.root.createFolder('Озон N1');
  folder.__addFile('Казань.xlsx');
  folder.__addFile('2000000000011.pdf');
  folder.__addFile('gone.pdf').setTrashed(true);
  const out = st.ctx.getSupplyDocsState({ orderId: '777', folderName: 'Озон N1' });
  return {
    conds: {
      'last row with a record wins (empty row after it ignored)': out.docsJSON === '{"at":"newest"}',
      'file names listed': JSON.stringify(out.folderFiles) === '["Казань.xlsx","2000000000011.pdf"]'
    },
    note: JSON.stringify(out)
  };
});
t0cCheck('Item 101 getSupplyDocsState: an absent order folder gives [] and the folder is NOT created; no record gives an empty docsJSON', () => {
  const st = resumeStand([resumeRow('R1', '777', '')]);
  const out = st.ctx.getSupplyDocsState({ orderId: '777', folderName: 'Озон N-absent' });
  return {
    conds: {
      'folderFiles empty': Array.isArray(out.folderFiles) && out.folderFiles.length === 0,
      'docsJSON empty': out.docsJSON === '',
      'root folder still has no sub-folders': st.root.__folders.length === 0
    },
    note: JSON.stringify(out)
  };
});
t0cCheck('Item 101 getSupplyDocsState: without orderId it throws and reads nothing', () => {
  const st = resumeStand([]);
  let msg = '';
  try { st.ctx.getSupplyDocsState({ folderName: 'x' }); } catch (e) { msg = String(e && e.message); }
  return { conds: { 'threw about orderId': /orderId/.test(msg) }, note: msg };
});

function savedBySupplyRun(label500) {
  const st = resumeStand([]);
  const U = st.ctx.Utilities;
  const hadMime = 'MimeType' in st.ctx;
  const keepMime = st.ctx.MimeType;
  st.ctx.MimeType = { MICROSOFT_EXCEL: 'xls' };
  const realFetch = st.ctx.UrlFetchApp.fetch;
  const keep = { newBlob: U.newBlob, base64Decode: U.base64Decode };
  U.newBlob = (bytes, mime, name) => st.H.makeFakeDriveBlob(name);
  U.base64Decode = () => [1, 2, 3];
  st.ctx.UrlFetchApp.fetch = (url) => (String(url).indexOf('label-ok') >= 0 && !label500
    ? { getResponseCode: () => 200, getBlob: () => st.H.makeFakeDriveBlob('x'), getAllHeaders: () => ({ 'Content-Type': 'application/pdf' }) }
    : { getResponseCode: () => 500, getBlob: () => st.H.makeFakeDriveBlob('x'), getAllHeaders: () => ({}) });
  try {
    return st.ctx.saveSupplyDocsToDrive({
      folderName: 'Order-1',
      articles: [],
      files: [
        { kind: 'base64', name: 'Казань.xlsx', supplyId: '2000000000011', content: 'AAA=' },
        { kind: 'url', url: 'https://ozon.fake/label-ok-1', supplyId: '2000000000011', fallbackName: 'tags-cargoes-by-supply-2000000000011' },
        { kind: 'base64', name: 'Самара.xlsx', supplyId: '2000000000012', content: 'AAA=' },
        { kind: 'url', url: 'https://ozon.fake/label-bad-2', supplyId: '2000000000012', fallbackName: 'tags-cargoes-by-supply-2000000000012' }
      ]
    });
  } finally {
    U.newBlob = keep.newBlob; U.base64Decode = keep.base64Decode;
    if (hadMime) st.ctx.MimeType = keepMime; else delete st.ctx.MimeType;
    st.ctx.UrlFetchApp.fetch = realFetch;
  }
}
t0cCheck('Item 101 savedBySupply: a label whose URL fetch returns HTTP 500 has label false while its composition file is true; the good supply has both true', () => {
  const out = savedBySupplyRun(false);
  const a = out.savedBySupply['2000000000011'];
  const b = out.savedBySupply['2000000000012'];
  return {
    conds: {
      'supply 11 composition and label true': !!a && a.composition === true && a.label === true,
      'supply 12 composition true': !!b && b.composition === true,
      'supply 12 label false after HTTP 500': !!b && b.label === false,
      'the HTTP 500 is reported in problems': out.problems.some(p => /HTTP 500/.test(p))
    },
    note: JSON.stringify(out.savedBySupply) + ' problems ' + JSON.stringify(out.problems)
  };
});
t0cCheck('Item 101 savedBySupply: when every label fetch fails no supply gets label true', () => {
  const out = savedBySupplyRun(true);
  const labels = Object.keys(out.savedBySupply).map(k => out.savedBySupply[k].label);
  return { conds: { 'two supplies listed': labels.length === 2, 'all labels false': labels.every(v => v === false) }, note: JSON.stringify(out.savedBySupply) };
});

t0cCheck('Item 101 purgeExpiredSupplyDocsCargoIds: clears cargoIds of a 21-day-old record, keeps a 19-day-old one, other fields of both stay', () => {
  const old = resumeRecord('2026-10-11T12:00:00Z', ['901', '902']);   // 21 days before 2026-11-01T12:00Z
  const fresh = resumeRecord('2026-10-13T12:00:00Z', ['903']);        // 19 days
  const st = resumeStand([resumeRow('R1', '1', old), resumeRow('R2', '2', fresh), resumeRow('R3', '3', '')]);
  const changed = st.ctx.purgeExpiredSupplyDocsCargoIds();
  const rows = st.ctx.getOzonSupplyRequests();
  const r1 = JSON.parse(rows[0].docsJSON);
  const r2 = JSON.parse(rows[1].docsJSON);
  return {
    conds: {
      'one cell rewritten': changed === 1,
      'old record ids cleared': r1.supplies.every(e => e.cargoIds.length === 0),
      'old record other fields kept': r1.supplies[0].supplyId === '2000000000011' && r1.supplies[0].composition === true && r1.supplies[0].label === true && r1.supplies[0].clusterName === 'Казань' && r1.orderNumber === 'N1' && r1.ok === true && r1.at === '2026-10-11T12:00:00Z',
      'fresh record untouched byte for byte': rows[1].docsJSON === fresh,
      'empty cell stays empty': rows[2].docsJSON === ''
    },
    note: 'changed ' + changed
  };
});
t0cCheck('Item 101 purgeExpiredSupplyDocsCargoIds: a second run changes nothing, and a record from before the item (no supplies[]) or with broken JSON is left alone', () => {
  const legacy = JSON.stringify({ at: '2026-01-01T00:00:00Z', ok: true, cargoes: 3 });
  const st = resumeStand([resumeRow('R1', '1', resumeRecord('2026-10-11T12:00:00Z', ['901'])), resumeRow('R2', '2', legacy), resumeRow('R3', '3', '{broken')]);
  const first = st.ctx.purgeExpiredSupplyDocsCargoIds();
  const second = st.ctx.purgeExpiredSupplyDocsCargoIds();
  const rows = st.ctx.getOzonSupplyRequests();
  return {
    conds: { 'first run rewrote one': first === 1, 'second run rewrote none': second === 0, 'legacy untouched': rows[1].docsJSON === legacy, 'broken untouched': rows[2].docsJSON === '{broken' },
    note: first + '/' + second
  };
});
t0cCheck('Item 101 purgeExpiredSupplyDocsCargoIds: applyCancelledOzonOrders calls it at its end (the result carries purgedDocsCargoIds)', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'Code.gs'), 'utf8');
  const body = src.slice(src.indexOf('function applyCancelledOzonOrders'));
  const end = body.indexOf('\nfunction ', 10);
  const fn = body.slice(0, end);
  return { conds: { 'call present': /result\.purgedDocsCargoIds\s*=\s*purgeExpiredSupplyDocsCargoIds\(\)/.test(fn), 'before the final return': fn.indexOf('purgeExpiredSupplyDocsCargoIds()') > fn.lastIndexOf('syncOzonJournalFromShipments') } };
});

// ================= Item 100.4 / R-014: an unshipped kit returns by the composition of its write-off =================
// The return must not read today's kit card: the write-off's own component rows decide.
{
  const standR014 = (recipeAtWriteOff) => {
    const h = freshHarness();
    h.setNow('2026-10-20T07:00:00Z');
    h.ensureTransSheet();
    h.ensureArchiveSheet();
    h.setStockSheet([
      { article: 'COMP', quantity: 40, avgCost: 100, capitalization: 4000 },
      { article: 'ART-PLAIN', quantity: 10, avgCost: 7, capitalization: 70 }
    ]);
    h.setKitSheet([{ kitSku: 'KIT', componentSku: 'COMP', quantity: recipeAtWriteOff, kitType: 'virtual' }]);
    const wo = h.commitTransaction([{ article: 'KIT', quantity: 10, price: 0 }, { article: 'ART-PLAIN', quantity: 10, price: 7 }],
      'Расход', 'Ozon (MaxiStore)', '2026-10-20', 'tester', '2026-10-19T07:00:00Z', 'op-wo');
    h.setExternalShipmentsSheet([{ postingId: 'P1', cabinet: 'MaxiStore', status: 'processed',
      items: [{ offerId: 'KIT', quantity: 10 }, { offerId: 'ART-PLAIN', quantity: 10 }],
      transGroupInfo: JSON.stringify(wo.newTransactions.map(t => String(t.id))), orderNumber: '1' }]);
    return h;
  };
  const retKit = (h) => h.commitUnshippedReturn('P1', [{ offerId: 'KIT', article: 'KIT', shipped: 5 }, { offerId: 'ART-PLAIN', article: 'ART-PLAIN', shipped: 10 }], 'tester', 'op-ret');
  {
    const h = standR014(2); // write-off: 10 kits x 2 = 20 COMP, stock 20
    check('Item 100.4 / R-014: precondition - the write-off took 20 COMP (recipe x2)', h.stockOf('COMP').quantity === 20, String(h.stockOf('COMP').quantity));
    h.setKitSheet([{ kitSku: 'KIT', componentSku: 'COMP', quantity: 3, kitType: 'virtual' }]); // recipe edited afterwards
    retKit(h);
    const s = h.stockOf('COMP');
    check('Item 100.4 / R-014: recipe edited x2 -> x3 after the write-off, return of 5 kits gives back 10 COMP (write-off composition), capitalization 3000',
      s.quantity === 30 && s.capitalization === 3000, 'quantity ' + s.quantity + ' capitalization ' + s.capitalization);
  }
  {
    const h = standR014(2);
    retKit(h);
    const s = h.stockOf('COMP');
    check('Item 100.4 / R-014: recipe unchanged, return of 5 kits gives back 10 COMP, capitalization 3000 (regression)',
      s.quantity === 30 && s.capitalization === 3000, 'quantity ' + s.quantity + ' capitalization ' + s.capitalization);
  }
  {
    const h = standR014(2);
    h.setKitSheet([]); // the article is no longer a kit
    retKit(h);
    const s = h.stockOf('COMP');
    check('Item 100.4 / R-014: kit recipe removed after the write-off, return of 5 kits still gives back 10 COMP, capitalization 3000',
      s.quantity === 30 && s.capitalization === 3000, 'quantity ' + s.quantity + ' capitalization ' + s.capitalization);
  }
  {
    // The same kit in two main rows of one write-off (6 + 4 kits, recipe x2 = 20 COMP): per-kit quantity is the SUM of components / SUM of kit rows.
    const h = freshHarness();
    h.setNow('2026-10-20T07:00:00Z');
    h.ensureTransSheet();
    h.ensureArchiveSheet();
    h.setStockSheet([{ article: 'COMP', quantity: 40, avgCost: 100, capitalization: 4000 }]);
    h.setKitSheet([{ kitSku: 'KIT', componentSku: 'COMP', quantity: 2, kitType: 'virtual' }]);
    const wo = h.commitTransaction([{ article: 'KIT', quantity: 6, price: 0 }, { article: 'KIT', quantity: 4, price: 0 }],
      'Расход', 'Ozon (MaxiStore)', '2026-10-20', 'tester', '2026-10-19T07:00:00Z', 'op-wo');
    h.setKitSheet([{ kitSku: 'KIT', componentSku: 'COMP', quantity: 3, kitType: 'virtual' }]);
    h.setExternalShipmentsSheet([{ postingId: 'P1', cabinet: 'MaxiStore', status: 'processed', items: [{ offerId: 'KIT', quantity: 10 }],
      transGroupInfo: JSON.stringify(wo.newTransactions.map(t => String(t.id))), orderNumber: '1' }]);
    h.commitUnshippedReturn('P1', [{ offerId: 'KIT', article: 'KIT', shipped: 5 }], 'tester', 'op-ret');
    const s = h.stockOf('COMP');
    check('Item 100.4 / R-014: the same kit in two main rows of one write-off (6 + 4), recipe edited, return of 5 kits gives back 10 COMP, capitalization 3000',
      s.quantity === 30 && s.capitalization === 3000, 'quantity ' + s.quantity + ' capitalization ' + s.capitalization);
  }
  {
    const h = freshHarness();
    h.setNow('2026-10-20T07:00:00Z');
    h.ensureTransSheet();
    h.ensureArchiveSheet();
    h.setStockSheet([{ article: 'A', quantity: 10, avgCost: 100, capitalization: 1000 }]);
    const wo = h.commitTransaction([{ article: 'A', quantity: 10, price: 100 }], 'Расход', 'Ozon (MaxiStore)', '2026-10-20', 'tester', '2026-10-19T07:00:00Z', 'op-wo', 100, undefined, undefined, undefined, true);
    h.setExternalShipmentsSheet([{ postingId: 'P1', cabinet: 'MaxiStore', status: 'processed', items: [{ offerId: 'A', quantity: 10 }],
      transGroupInfo: JSON.stringify(wo.newTransactions.map(t => String(t.id))), orderNumber: '1' }]);
    h.commitUnshippedReturn('P1', [{ offerId: 'A', article: 'A', shipped: 5 }], 'tester', 'op-ret');
    const s = h.stockOf('A');
    const wanted = 5 * (h.context.getTransactions().rows.find(t => t.id === wo.newTransactions[0].id).price);
    check('Item 100.4 / R-014: plain article return is unaffected - 5 units come back at the write-off row price (services included on purpose, R-013)',
      s.quantity === 5 && s.capitalization === wanted, 'quantity ' + s.quantity + ' capitalization ' + s.capitalization + ' expected ' + wanted);
  }
}

// ================= Item 100.4 / R-015, R-034: unshipped return retry safety and duplicate input =================
{
  const standR015 = () => {
    const h = freshHarness();
    h.setNow('2026-10-20T07:00:00Z');
    h.ensureTransSheet();
    h.ensureArchiveSheet();
    h.setStockSheet([{ article: 'A', quantity: 20, avgCost: 100, capitalization: 2000 }]);
    const wo = h.commitTransaction([{ article: 'A', quantity: 10, price: 100 }], 'Расход', 'Ozon (MaxiStore)', '2026-10-20', 'tester', '2026-10-19T07:00:00Z', 'op-wo', undefined, undefined, undefined, undefined, true);
    const sheet = h.setExternalShipmentsSheet([{ postingId: 'P1', cabinet: 'MaxiStore', status: 'processed', items: [{ offerId: 'A', quantity: 10 }],
      transGroupInfo: JSON.stringify(wo.newTransactions.map(t => String(t.id))), orderNumber: '1' }]);
    return { h, sheet };
  };
  // Transient Sheets error on the first write of the shipped marker only.
  const failMarkerOnce = (h, sheet) => {
    const origGetRange = sheet.getRange.bind(sheet);
    const iShipped = h.context.EXTERNAL_SHIPMENTS_HEADERS.indexOf('ОтгруженоJSON') + 1;
    let failOnce = true;
    sheet.getRange = (...a) => {
      const r = origGetRange(...a);
      if (a[0] > 1 && a[1] === iShipped) {
        const sv = r.setValue.bind(r);
        r.setValue = (v) => { if (failOnce) { failOnce = false; throw new Error('Injected marker write failure'); } return sv(v); };
      }
      return r;
    };
  };
  const markerOf = (h) => (h.dumpExternalShipments().find(r => r.PostingID === 'P1') || {}).ОтгруженоJSON || '';
  const receiptsOf = (h) => h.dumpTransSheet().filter(r => r['Тип'] === 'Приход');
  const ret5 = (h, op) => h.commitUnshippedReturn('P1', [{ offerId: 'A', article: 'A', shipped: 5 }], 'tester', op);
  {
    const { h, sheet } = standR015();
    failMarkerOnce(h, sheet);
    try { ret5(h, 'attempt-1'); } catch (e) {}
    try { ret5(h, 'attempt-2'); } catch (e) {}
    const s = h.stockOf('A');
    check('Item 100.4 / R-015: retry with a NEW opId after a marker write failure does not return the goods twice (stock 15, capitalization 1500)',
      s.quantity === 15 && s.capitalization === 1500, 'quantity ' + s.quantity + ' capitalization ' + s.capitalization);
    check('Item 100.4 / R-015: retry with a NEW opId after a marker write failure leaves exactly one receipt row',
      receiptsOf(h).length === 1, 'receipt rows ' + receiptsOf(h).length);
    check('Item 100.4 / R-015: after the retry the shipped marker of the posting is written',
      markerOf(h) !== '', 'marker "' + markerOf(h) + '"');
  }
  {
    const { h, sheet } = standR015();
    failMarkerOnce(h, sheet);
    try { ret5(h, 'same-op'); } catch (e) {}
    try { ret5(h, 'same-op'); } catch (e) {}
    const s = h.stockOf('A');
    check('Item 100.4 / R-015: control - retry with the SAME opId after a marker write failure gives stock 15, one receipt, marker written',
      s.quantity === 15 && receiptsOf(h).length === 1 && markerOf(h) !== '', 'quantity ' + s.quantity + ' receipts ' + receiptsOf(h).length + ' marker "' + markerOf(h) + '"');
  }
  {
    const h = freshHarness();
    h.setNow('2026-10-20T07:00:00Z');
    h.ensureTransSheet();
    h.ensureArchiveSheet();
    h.setStockSheet([{ article: 'A', quantity: 10, avgCost: 100, capitalization: 1000 }]);
    const wo = h.commitTransaction([{ article: 'A', quantity: 10, price: 100 }], 'Расход', 'Ozon (MaxiStore)', '2026-10-20', 'tester', '2026-10-19T07:00:00Z', 'op-wo', undefined, undefined, undefined, undefined, true);
    h.setExternalShipmentsSheet([{ postingId: 'P1', cabinet: 'MaxiStore', status: 'processed', items: [{ offerId: 'A', quantity: 10 }],
      transGroupInfo: JSON.stringify(wo.newTransactions.map(t => String(t.id))), orderNumber: '1' }]);
    let err = '';
    try { h.commitUnshippedReturn('P1', [{ offerId: 'A', article: 'A', shipped: 5 }, { offerId: 'A', article: 'A', shipped: 5 }], 'tester', 'op-dup'); } catch (e) { err = String(e.message || e); }
    const s = h.stockOf('A');
    check('Item 100.4 / R-034: the same offerId twice in "shipped" is refused with an error',
      err !== '', 'no error thrown');
    check('Item 100.4 / R-034: the refused duplicate input changes no stock and writes no receipt row',
      s.quantity === 0 && s.capitalization === 0 && h.dumpTransSheet().filter(r => r['Тип'] === 'Приход').length === 0,
      'quantity ' + s.quantity + ' capitalization ' + s.capitalization + ' receipts ' + h.dumpTransSheet().filter(r => r['Тип'] === 'Приход').length);
  }
}

// ================= Item 100.4 / R-033, R-035: re-sort works per supply and is refused before any change =================
{
  const setCell = (h, rowNo, header, value) => {
    const sheet = h.getRegistrySheet('Внешние отгрузки');
    const dump = sheet.__dump();
    dump[rowNo][dump[0].indexOf(header)] = value;
    sheet.__setData(dump);
  };
  const shipRow = (h, postingId) => h.dumpExternalShipments().find(r => r.PostingID === postingId);
  // each supply is its own expense of A for the same OrderID; supplies: [{posting, qty, pq, fromOffer}]
  const peresortFixture = (supplies) => {
    const h = freshHarness();
    h.setNow('2026-10-20T07:00:00Z');
    h.ensureTransSheet();
    h.ensureArchiveSheet();
    h.setStockSheet([{ article: 'A', quantity: 30, avgCost: 100, capitalization: 3000 }, { article: 'B', quantity: 30, avgCost: 200, capitalization: 6000 }]);
    const rows = supplies.map((s, i) => {
      const wo = h.commitTransaction([{ article: 'A', quantity: s.qty, price: 100 }], 'Расход', 'Склад Тест', '2026-10-20', 'tester', '2026-10-19T0' + (i + 1) + ':00:00Z', 'op-' + s.posting, undefined, undefined, undefined, undefined, true);
      return { postingId: s.posting, cabinet: 'MaxiStore', status: 'processed', items: [{ offerId: 'A', quantity: s.qty }],
        transGroupInfo: JSON.stringify(wo.newTransactions.map(t => String(t.id))), orderNumber: '1300' };
    });
    h.setExternalShipmentsSheet(rows);
    supplies.forEach((s, i) => {
      setCell(h, i + 1, 'OrderID', 'ORDER-1');
      setCell(h, i + 1, 'ПересортJSON', JSON.stringify({ pairs: [{ fromArticle: 'A', toArticle: 'B', fromOfferId: s.fromOffer || 'A', toOfferId: 'B', qty: s.pq }] }));
    });
    return h;
  };
  {
    const h = peresortFixture([{ posting: 'P1', qty: 5, pq: 1 }, { posting: 'P2', qty: 7, pq: 7 }]);
    const p2Before = shipRow(h, 'P2').TransGroupInfo;
    h.commitShipmentPeresort('P1', 'tester');
    const p2After = shipRow(h, 'P2').TransGroupInfo;
    let err2 = '';
    try { h.commitShipmentPeresort('P2', 'tester'); } catch (e) { err2 = String(e.message || e); }
    const A = h.stockOf('A'), B = h.stockOf('B');
    check('Item 100.4 / R-033: re-sort of supply P1 leaves the links (TransGroupInfo) of supply P2 of the same order unchanged',
      p2After === p2Before, 'before ' + p2Before + ' after ' + p2After);
    check('Item 100.4 / R-033: a later re-sort of supply P2 succeeds after P1 was re-sorted',
      err2 === '', 'error "' + err2 + '"');
    check('Item 100.4 / R-033: stock after both re-sorts is A 26 / B 22',
      A.quantity === 26 && B.quantity === 22, 'A ' + A.quantity + ' B ' + B.quantity);
  }
  {
    const h = peresortFixture([{ posting: 'P1', qty: 10, pq: 2, fromOffer: 'missing-offer' }]);
    const snapStock = () => JSON.stringify(h.dumpStockSheet());
    const snapHist = () => JSON.stringify(h.dumpTransSheet());
    const snapExt = () => JSON.stringify(h.dumpExternalShipments());
    const [st0, hi0, ex0] = [snapStock(), snapHist(), snapExt()];
    let err = '';
    try { h.commitShipmentPeresort('P1', 'tester'); } catch (e) { err = String(e.message || e); }
    check('Item 100.4 / R-035: re-sort with a fromOfferId not in the supply is refused with an error', err !== '', 'no error thrown');
    check('Item 100.4 / R-035: the refused re-sort leaves stock unchanged', snapStock() === st0, 'stock changed: ' + snapStock());
    check('Item 100.4 / R-035: the refused re-sort leaves "История" unchanged (no deleted or added rows)', snapHist() === hi0, 'history changed');
    check('Item 100.4 / R-035: the refused re-sort leaves the supply links unchanged', snapExt() === ex0, 'supply row changed');
  }
  {
    // Two supplies of one order that share ONE write-off: both rows carry the same links, so a re-sort must relink both.
    const h = peresortFixture([{ posting: 'P1', qty: 5, pq: 2 }]);
    const shared = shipRow(h, 'P1').TransGroupInfo;
    const sheetX = h.getRegistrySheet('Внешние отгрузки');
    const dumpX = sheetX.__dump();
    const rowP1 = dumpX[1].slice();
    dumpX.push(rowP1.map((v, ci) => dumpX[0][ci] === 'PostingID' ? 'P2' : v));
    sheetX.__setData(dumpX);
    let err = '';
    try { h.commitShipmentPeresort('P1', 'tester'); } catch (e) { err = String(e.message || e); }
    const p1 = shipRow(h, 'P1').TransGroupInfo, p2 = shipRow(h, 'P2').TransGroupInfo;
    check('Item 100.4 / R-033: two supplies sharing one write-off - re-sort of P1 relinks both rows to the new transactions',
      err === '' && p1 !== shared && p2 === p1, 'error "' + err + '" shared ' + shared + ' P1 ' + p1 + ' P2 ' + p2);
  }
  {
    // A foreign supply whose link cell is valid JSON but not an array is not a link to the replaced transactions.
    const h = peresortFixture([{ posting: 'P1', qty: 5, pq: 2 }, { posting: 'P2', qty: 7, pq: 7 }]);
    setCell(h, 2, 'TransGroupInfo', '{"legacy":true}');
    h.commitShipmentPeresort('P1', 'tester');
    check('Item 100.4 / R-033: a foreign supply with a non-array link cell is left untouched by a re-sort of P1',
      shipRow(h, 'P2').TransGroupInfo === '{"legacy":true}', 'P2 links ' + shipRow(h, 'P2').TransGroupInfo);
  }
  {
    const h = peresortFixture([{ posting: 'P1', qty: 5, pq: 2 }]);
    const linksBefore = shipRow(h, 'P1').TransGroupInfo;
    let err = '';
    try { h.commitShipmentPeresort('P1', 'tester'); } catch (e) { err = String(e.message || e); }
    const A = h.stockOf('A'), B = h.stockOf('B');
    check('Item 100.4 / R-033: control - ordinary valid re-sort of a single-supply order works (A 27 / B 28, links rewritten, no error)',
      err === '' && A.quantity === 27 && B.quantity === 28 && shipRow(h, 'P1').TransGroupInfo !== linksBefore,
      'error "' + err + '" A ' + A.quantity + ' B ' + B.quantity);
  }
}

// ================= Item 100.5 / R-060: saveOzonSupplyRequest writes by header name =================
{
  const readBack = (hdr) => {
    const H = freshHarness();
    H.setNow('2026-10-28T10:00:00Z');
    H.setRegistrySheet('Заявки Ozon', [hdr]);
    H.context.saveOzonSupplyRequest({ cabinet: 'MaxiStore', draftId: '11', orderId: 'order-123', dropOffName: 'Drop X', clusters: '1,2', itemsJSON: '[{"a":1}]', status: 'Создана' }, 'admin');
    return H.context.getOzonSupplyRequests()[0] || {};
  };
  const okAll = (r) => String(r.cabinet) === 'MaxiStore' && String(r.orderId) === 'order-123' && String(r.draftId) === '11' &&
    r.dropOffName === 'Drop X' && r.clusters === '1,2' && r.itemsJSON === '[{"a":1}]' && r.who === 'admin' && r.status === 'Создана';
  const r1 = readBack(['ID', 'Дата', 'OrderID', 'DraftID', 'Кабинет', 'Точка отгрузки', 'Кластеры', 'Состав', 'Кто', 'Статус', 'Документы']);
  check('Item 100.5 / R-060: a journal with OrderID and Кабинет columns swapped reads back the right cabinet, order id and every other field',
    okAll(r1), JSON.stringify(r1));
  const r2 = readBack(['ID', 'Дата', 'Кабинет', 'DraftID', 'OrderID', 'Точка отгрузки', 'Кластеры', 'Состав', 'Кто', 'Статус', 'Документы']);
  check('Item 100.5 / R-060: control - the standard header order still reads back every field correctly',
    okAll(r2), JSON.stringify(r2));
}

// ================= Item 100.6 part 1: China money / files regressions (R-017, R-019, R-023, R-039, R-041, R-042) =================
// Test-first: every check asserts the CORRECT behaviour and is expected to FAIL until part 2 lands.
{
  const N6 = 'Николай';
  const r2 = (x) => Math.round(x * 100) / 100;
  const ordersOf = (h) => h.getChinaMoney().orders.map(o => ({ o: o.orderNo, cny: o.knownCny !== undefined ? o.knownCny : o.cny, rub: o.knownRub !== undefined ? o.knownRub : o.rub }));

  // ---- R-017: pruning old reports must not re-price money already allocated between orders
  {
    const h = withChina();
    const rc = [{ date: '2026-08-10', goodsCny: 100 }, { date: '2026-08-20', goodsCny: 100 }];
    const rep = (date, a, b) => h.saveChinaReport({ reportDate: date, source: 'скрипт',
      orders: [{ orderNo: 'A', date: '2026-08-01', receivedCny: a, totalCny: 1000 }, { orderNo: 'B', date: '2026-08-05', receivedCny: b, totalCny: 1000 }],
      receipts: rc, freights: [] }, N6);
    h.saveChinaPayment({ date: '2026-08-10', amountRub: 1000, rate: 10, comment: 'PA' }, N6);
    h.saveChinaPayment({ date: '2026-08-20', amountRub: 2000, rate: 20, comment: 'PB' }, N6);
    rep('2026-09-01', 100, 100);
    rep('2026-09-02', 50, 150);
    rep('2026-09-03', 100, 100);
    rep('2026-09-04', 100, 100);
    const o4 = ordersOf(h);
    rep('2026-09-05', 100, 100);
    const o5 = ordersOf(h);
    const rubOf = (arr, k) => (arr.find(x => x.o === k) || {}).rub;
    check('Item 100.6 part 1 / R-017: saving report 5 (no change, the 4th-oldest report is pruned) does not re-price orders A and B',
      JSON.stringify(o4) === JSON.stringify(o5), 'R4 ' + JSON.stringify(o4) + ' R5 ' + JSON.stringify(o5));
    rep('2026-09-06', 100, 100);
    const o6 = ordersOf(h);
    check('Item 100.6 part 1 / R-017: a SECOND prune (report 6, baseline chained) still leaves orders A and B unchanged',
      JSON.stringify(o5) === JSON.stringify(o6), 'R5 ' + JSON.stringify(o5) + ' R6 ' + JSON.stringify(o6));
    check('Item 100.6 part 1 / R-017: after report 5 order A keeps 1333.30 and order B 1666.70 rubles (not 1000.00 / 2000.00)',
      r2(rubOf(o5, 'A')) === 1333.3 && r2(rubOf(o5, 'B')) === 1666.7, 'A ' + rubOf(o5, 'A') + ' B ' + rubOf(o5, 'B'));
  }

  // ---- R-041: pruning with real Date cells in «Дата отчёта» keeps the newest
  {
    const h = withChina();
    ['2026-10-13', '2026-10-14', '2026-10-15'].forEach(d => h.saveChinaReport({ reportDate: d, source: 'скрипт', orders: [], receipts: [] }, N6));
    // midnight of the stand's script zone (Europe/Moscow, UTC+3) - independent of the process TZ
    const mk = (y, m, d) => new Date(Date.UTC(y, m - 1, d) - 3 * 3600 * 1000);
    const sheet = h.context.chinaSpreadsheet().getSheetByName('Отчёты');
    const hdr = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
    const col = hdr.indexOf('Дата отчёта') + 1;
    [mk(2026, 10, 13), mk(2026, 10, 14), mk(2026, 10, 15)].forEach((d, i) => sheet.getRange(i + 2, col, 1, 1).setValue(d));
    const row = hdr.map(() => ''); row[hdr.indexOf('ID')] = 'CR9'; row[hdr.indexOf('Дата отчёта')] = mk(2026, 10, 16);
    row[hdr.indexOf('Данные (JSON)')] = JSON.stringify({ orders: [], receipts: [], freights: [] });
    sheet.appendRow(row);
    h.context.chinaPruneReports(h.context.chinaSpreadsheet());
    const left = h.context.chinaReadSheet(h.context.chinaSpreadsheet(), 'Отчёты', h.context.CHINA_REPORT_HEADERS).rows
      .map(r => h.context.chinaDateText(r['Дата отчёта'], 'x')).sort();
    check('Item 100.6 part 1 / R-041: pruning with Date-typed «Дата отчёта» cells deletes the OLDEST report and keeps the three newest',
      JSON.stringify(left) === JSON.stringify(['2026-10-14', '2026-10-15', '2026-10-16']), JSON.stringify(left));
  }

  // ---- R-042: same-day correction keeps the movement journal equal to the latest receivedCny
  {
    const h = withChina();
    const rep = (d, cny) => ({ reportDate: d, source: 'скрипт', orders: [{ orderNo: '28', date: '2026-01-01', receivedCny: cny }], receipts: [] });
    h.saveChinaReport(rep('2026-10-10', 100), N6);
    h.saveChinaReport(rep('2026-10-11', 150), N6);
    h.saveChinaReport(rep('2026-10-11', 160), N6);
    const rows = h.dumpChinaSheet('Движения заказов').map(r => Number(r['Изменение ¥']));
    const sum = r2(rows.reduce((a, b) => a + b, 0));
    check('Item 100.6 part 1 / R-042: two reports on the same date - the movement journal sums to the latest receivedCny (160)',
      sum === 160, 'rows ' + JSON.stringify(rows) + ' sum ' + sum);
  }

  // ---- R-023: chinaSplitLots conserves money
  {
    const h = withChina();
    const lots = [1, 2, 3, 4, 5, 6].map(i => ({ receiptId: 'r' + i, cny: 100 }));
    const s = h.chinaSplitLots(lots, 0.03);
    const sum = (a) => r2(a.reduce((t, x) => t + x.cny, 0));
    const t = sum(s.taken), rem = sum(s.remaining);
    check('Item 100.6 part 1 / R-023: moving 0.03 out of six 100-yuan lots takes exactly 0.03, leaves 599.97, total 600.00',
      t === 0.03 && rem === 599.97 && r2(t + rem) === 600 && s.remaining.every(x => x.cny <= 100) && s.taken.every(x => x.cny >= 0),
      'taken ' + t + ' remaining ' + rem + ' total ' + r2(t + rem));
    const bad = [];
    for (let n = 2; n <= 10; n++) for (let c = 1; c <= 10; c++) {
      const amt = c / 100; const ls = []; for (let i = 0; i < n; i++) ls.push({ receiptId: 'r' + i, cny: 100 });
      const sp = h.chinaSplitLots(ls, amt);
      const tk = sum(sp.taken), rm = sum(sp.remaining);
      if (tk !== amt || r2(tk + rm) !== n * 100) bad.push({ n, amt, tk, rm });
    }
    check('Item 100.6 part 1 / R-023: sweep n=2..10 equal lots x amounts 0.01..0.10 - taken == amount and taken+remaining == original total in every combination',
      bad.length === 0, bad.length + ' bad, first ' + JSON.stringify(bad.slice(0, 3)));
  }

  // ---- R-019 (owner decision): a newer report revises a matched receipt
  {
    const setup = () => {
      const h = withChina();
      h.saveChinaReport({ reportDate: '2026-09-01', source: 'скрипт', orders: [{ orderNo: '1', date: '2026-08-01', receivedCny: 600, totalCny: 600 }],
        receipts: [{ date: '2026-08-20', goodsCny: 600, freightCny: 400 }], freights: [] }, N6);
      h.saveChinaPayment({ date: '2026-08-20', amountRub: 10000, rate: 10, comment: 'P1' }, N6);
      return h;
    };
    const next = (h, g, f, tot) => h.saveChinaReport({ reportDate: '2026-09-02', source: 'скрипт',
      orders: [{ orderNo: '1', date: '2026-08-01', receivedCny: tot, totalCny: tot }],
      receipts: [{ date: '2026-08-20', goodsCny: g, freightCny: f }], freights: [] }, N6);

    // a) same total, different split
    {
      const h = setup();
      const pre = h.dumpChinaSheet('Поступления')[0];
      next(h, 400, 600, 400);
      const r = h.dumpChinaSheet('Поступления')[0], p = h.dumpChinaSheet('Платежи')[0];
      const amountRub = Number(p['Сумма ₽']);
      const rubGoods = r2(amountRub * 400 / 1000), rubFreight = r2(amountRub - rubGoods);
      check('Item 100.6 part 1 / R-019a: same total, new goods/freight split - the matched receipt\'s «Товар ¥»/«Доставка ¥» are rewritten to 400/600',
        pre['Статус'] === 'сопоставлено' && Number(r['Товар ¥']) === 400 && Number(r['Доставка ¥']) === 600, JSON.stringify(r));
      check('Item 100.6 part 1 / R-019a: same total, new split - «₽ товар»/«₽ доставка» are recomputed from the same payment (4000/6000)',
        Number(r['₽ товар']) === rubGoods && Number(r['₽ доставка']) === rubFreight, 'rub ' + r['₽ товар'] + '/' + r['₽ доставка'] + ' expected ' + rubGoods + '/' + rubFreight);
      check('Item 100.6 part 1 / R-019a: same total, new split - the match stays (receipt «сопоставлено», payment tied to it)',
        r['Статус'] === 'сопоставлено' && String(r['ОплатаID']) === String(p['ID']) && String(p['ПоступлениеID']) === String(r['ID']),
        'receipt ' + r['Статус'] + '/' + r['ОплатаID'] + ' payment ' + p['ПоступлениеID']);
    }
    // a2) same total, amount that does not split evenly: the two rouble parts must add up to the payment exactly
    {
      const h = withChina();
      h.saveChinaReport({ reportDate: '2026-09-01', source: 'скрипт', orders: [{ orderNo: '1', date: '2026-08-01', receivedCny: 3, totalCny: 3 }],
        receipts: [{ date: '2026-08-20', goodsCny: 1, freightCny: 2 }], freights: [] }, N6);
      h.saveChinaPayment({ date: '2026-08-20', amountRub: 100, rate: 100 / 3, comment: 'P1' }, N6);
      const matched = h.dumpChinaSheet('Поступления')[0]['Статус'] === 'сопоставлено';
      next(h, 2, 1, 3);
      const r = h.dumpChinaSheet('Поступления')[0], p = h.dumpChinaSheet('Платежи')[0];
      check('Item 100.6 part 1 / R-019a rounding: payment 100.00 RUB, split 1/2 -> 2/1 yuan - ₽ товар + ₽ доставка equals the payment exactly',
        matched && r['Статус'] === 'сопоставлено' && r2(Number(r['₽ товар']) + Number(r['₽ доставка'])) === Number(p['Сумма ₽']) && Number(r['₽ товар']) === 66.67,
        'matched ' + matched + ' ' + JSON.stringify(r));
    }
    // b) changed total
    {
      const h = setup();
      const res = next(h, 600, 600, 600);
      const r = h.dumpChinaSheet('Поступления')[0], p = h.dumpChinaSheet('Платежи')[0];
      const warns = (res && res.warnings || []).map(String);
      check('Item 100.6 part 1 / R-019b: changed total - the payment is released (not distributed, empty ПоступлениеID / Юани по отчёту / Курс фактический)',
        p['Статус'] === 'не распределена' && String(p['ПоступлениеID']) === '' && String(p['Юани по отчёту']) === '' && String(p['Курс фактический']) === '',
        JSON.stringify(p));
      check('Item 100.6 part 1 / R-019b: changed total - the receipt loses the match (no ОплатаID, no ₽ товар / ₽ доставка, status not «сопоставлено»)',
        r['Статус'] !== 'сопоставлено' && String(r['ОплатаID']) === '' && String(r['₽ товар']) === '' && String(r['₽ доставка']) === '' && Number(r['Всего ¥']) === 1200,
        JSON.stringify(r));
      check('Item 100.6 part 1 / R-019b: changed total - a warning names the receipt date 2026-08-20 and says the match was removed («сопоставлен»)',
        warns.some(w => w.indexOf('2026-08-20') !== -1 && w.indexOf('сопоставлен') !== -1), JSON.stringify(warns));
    }
    // control: UNmatched receipt with a changed total
    {
      const h = withChina();
      h.saveChinaReport({ reportDate: '2026-09-01', source: 'скрипт', orders: [{ orderNo: '1', date: '2026-08-01', receivedCny: 600, totalCny: 600 }],
        receipts: [{ date: '2026-08-20', goodsCny: 600, freightCny: 400 }], freights: [] }, N6);
      const res = next(h, 600, 600, 600);
      const r = h.dumpChinaSheet('Поступления')[0];
      const warns = (res && res.warnings || []).map(String);
      check('Item 100.6 part 1 / R-019 control: an UNmatched receipt with a changed total is rewritten (1200) and gets the existing «изменилось» warning',
        Number(r['Товар ¥']) === 600 && Number(r['Доставка ¥']) === 600 && Number(r['Всего ¥']) === 1200 && r['Статус'] !== 'сопоставлено' &&
        warns.some(w => w.indexOf('изменилось') !== -1), JSON.stringify(r) + ' ' + JSON.stringify(warns));
    }
  }

  // ---- R-039 (owner decision): editing an allocated payment's money is refused
  {
    const setup = () => {
      const h = withChina();
      h.saveChinaReport({ reportDate: '2026-08-22', source: 'скрипт', orders: [], receipts: [{ date: '2026-08-30', goodsCny: 100 }] }, N6);
      h.saveChinaPayment({ date: '2026-08-22', amountRub: 1000, rate: 10, comment: 'p' }, N6);
      const pay = h.dumpChinaSheet('Платежи')[0];
      h.matchChinaPayment({ paymentId: pay.ID, receiptId: h.getChinaMoney().receipts[0].id }, N6);
      return { h, id: pay.ID };
    };
    const base = { date: '2026-08-22', amountRub: 1000, rate: 10, comment: 'p' };
    const variants = [
      ['amountRub', { amountRub: 2000, rate: 20 }],
      ['rate', { rate: 20 }],
      ['amountCny', { rate: undefined, amountCny: 50 }],
      ['date', { date: '2026-08-23' }]
    ];
    variants.forEach(([label, change]) => {
      const { h, id } = setup();
      const before = JSON.stringify([h.dumpChinaSheet('Платежи'), h.dumpChinaSheet('Поступления')]);
      let err = '';
      try { h.saveChinaPayment(Object.assign({ id }, base, change), N6); } catch (e) { err = String(e.message || e); }
      const after = JSON.stringify([h.dumpChinaSheet('Платежи'), h.dumpChinaSheet('Поступления')]);
      check('Item 100.6 part 1 / R-039: editing ' + label + ' of an allocated payment throws «отмените сопоставление»',
        err.toLowerCase().indexOf('отмените сопоставление') !== -1, 'error "' + err + '"');
      check('Item 100.6 part 1 / R-039: the refused ' + label + ' edit leaves both the payments and the receipts sheet unchanged',
        before === after, before === after ? '' : 'sheets changed');
    });
    {
      const { h, id } = setup();
      let err = '';
      try { h.saveChinaPayment(Object.assign({ id }, base, { comment: 'new note', confirmed: true }), N6); } catch (e) { err = String(e.message || e); }
      const p = h.dumpChinaSheet('Платежи')[0];
      check('Item 100.6 part 1 / R-039: changing only comment and confirmed on an allocated payment still succeeds and keeps the match',
        err === '' && p['Комментарий'] === 'new note' && p['Подтверждено'] === 'да' && p['Статус'] === 'распределена' && Number(p['Сумма ₽']) === 1000,
        'error "' + err + '" ' + JSON.stringify(p));
    }
    {
      const h = withChina();
      h.saveChinaPayment({ date: '2026-08-22', amountRub: 1000, rate: 10, comment: 'p' }, N6);
      const id = h.dumpChinaSheet('Платежи')[0].ID;
      let err = '';
      try { h.saveChinaPayment({ id, date: '2026-08-22', amountRub: 2000, rate: 20, comment: 'p' }, N6); } catch (e) { err = String(e.message || e); }
      check('Item 100.6 part 1 / R-039 control: editing the amount of an UNallocated payment still works',
        err === '' && Number(h.dumpChinaSheet('Платежи')[0]['Сумма ₽']) === 2000, 'error "' + err + '"');
    }
  }
}

// ================= Item 100.6 part 2: China money / files regressions (R-018, R-020, R-021, R-022, R-040, R-047) =================
// Test-first: every check asserts the CORRECT behaviour and is expected to FAIL until the fixes land.
{
  const N7 = 'Николай';
  const run = (fn) => { try { return { v: fn(), err: '' }; } catch (e) { return { v: undefined, err: String(e && e.message || e) }; } };
  const postable7 = (h, over, reportOver) => {
    h.setSkuSheet(['SKU', 'ШТ/КОР'], [['ART-POST-1', 10], ['ART-POST-2', 10]]);
    h.setStockSheet([]); h.ensureTransSheet();
    h.saveChinaReport(Object.assign({ reportDate: '2026-09-01', source: 'скрипт', orders: [], receipts: [],
      freights: [{ code: 'NV-POST-1', orderNo: 'P1', amountUsd: 50, cargoRate: 7 }] }, reportOver || {}), N7);
    return h.saveChinaBatch(Object.assign({ orderNo: 'P1', code: 'NV-POST-1', status: 'Прибыла', shippedAt: '2026-08-01', arrivedAt: '2026-08-25',
      weightKg: 100, ratePerKgUsd: 1, rubRate: 12,
      lines: [{ marking: 'M1', boxes: 10, pcsPerBox: 10, qty: 100, priceCny: 10, article: 'ART-POST-1' }],
      costs: [{ type: 'Прочее', amountRub: 500, comment: 'разгрузка' }] }, over || {}), N7).batches[0];
  };

  // ---- R-020: same marking in two lines of a posted batch - changing one line's quantity must be refused
  {
    const lines = q1 => [
      { marking: 'SAME', boxes: 1, pcsPerBox: 3, qty: q1, priceCny: 10, article: 'ART-POST-1' },
      { marking: 'SAME', boxes: 1, pcsPerBox: 7, qty: 7, priceCny: 10, article: 'ART-POST-1' }];
    const payload = (id, q1) => ({ id, orderNo: 'P1', code: 'NV-POST-1', status: 'Прибыла', shippedAt: '2026-08-01', arrivedAt: '2026-08-25',
      weightKg: 100, ratePerKgUsd: 1, rubRate: 12, lines: lines(q1), costs: [{ type: 'Прочее', amountRub: 500, comment: 'разгрузка' }] });
    const setup = () => {
      const h = withChina();
      const b = postable7(h, { lines: lines(3) });
      h.postChinaBatch({ id: b.id, opId: 'op-r20', lines: [{ article: 'ART-POST-1', qty: 10 }] }, N7);
      return { h, b };
    };
    {
      const { h, b } = setup();
      const stBefore = h.stockOf('ART-POST-1');
      const r = run(() => h.saveChinaBatch(payload(b.id, 30), N7));
      const after = h.getChinaBatches().batches.filter(x => x.id === b.id)[0];
      const qtySaved = after.lines.reduce((t, l) => t + l.qty, 0);
      const st = h.stockOf('ART-POST-1');
      check('Item 100.6 part 2 / R-020: posted batch, one marking in two lines (3+7) - resaving with the first line 30 is refused with the "quantities fixed" error',
        r.err !== '' && r.err.toLowerCase().indexOf('количеств') !== -1, 'error "' + r.err + '"');
      check('Item 100.6 part 2 / R-020: the refused resave changes nothing - saved line quantities stay 10 in total, stock unchanged',
        qtySaved === 10 && st.quantity === stBefore.quantity && st.capitalization === stBefore.capitalization,
        'qtySaved ' + qtySaved + ' stock ' + st.quantity + '/' + st.capitalization + ' before ' + stBefore.quantity + '/' + stBefore.capitalization);
    }
    {
      const { h, b } = setup();
      const r = run(() => h.saveChinaBatch(payload(b.id, 3), N7));
      const after = h.getChinaBatches().batches.filter(x => x.id === b.id)[0];
      check('Item 100.6 part 2 / R-020 control: resaving the posted batch with unchanged quantities succeeds',
        r.err === '' && after.lines.reduce((t, l) => t + l.qty, 0) === 10, 'error "' + r.err + '"');
    }
    {
      const { h, b } = setup();
      const p = payload(b.id, 3);
      p.lines = p.lines.slice().reverse();
      const r = run(() => h.saveChinaBatch(p, N7));
      check('Item 100.6 part 2 / R-020 gap: resaving a posted batch with the lines only REORDERED (same quantities) is accepted',
        r.err === '', 'error "' + r.err + '"');
    }
    {
      const { h, b } = setup();
      const p = payload(b.id, 3);
      p.lines[0].article = 'ART-POST-2';
      const r = run(() => h.saveChinaBatch(p, N7));
      const after = h.getChinaBatches().batches.filter(x => x.id === b.id)[0];
      check('Item 100.6 part 2 / R-020 gap: posted batch, duplicate marking - changing the ARTICLE of one line is refused and saved articles stay unchanged',
        r.err !== '' && after.lines.every(l => l.article === 'ART-POST-1'),
        'error "' + r.err + '" articles ' + JSON.stringify(after.lines.map(l => l.article)));
    }
  }

  // ---- R-021: cancelling an old posting must be all-or-nothing
  {
    const payload = (rf, id) => Object.assign(id ? { id } : {}, {
      orderNo: 'P1', code: 'NV-POST-1', status: 'Прибыла', shippedAt: '2026-08-01', arrivedAt: '2026-08-25',
      weightKg: 100, ratePerKgUsd: 1, rubRate: 12,
      lines: [{ marking: 'M1', boxes: 10, pcsPerBox: 10, qty: 100, priceCny: 10, article: 'ART-POST-1' }],
      costs: [{ type: 'Прочее', amountRub: rf, comment: 'разгрузка' }] });
    const h = withChina();
    h.setNow('2026-09-01T07:00:00Z');
    h.setSkuSheet(['SKU', 'ШТ/КОР'], [['ART-POST-1', 10]]); h.setStockSheet([]); h.ensureTransSheet();
    h.saveChinaReport({ reportDate: '2026-09-01', source: 'скрипт', orders: [], receipts: [], openingFreightUsd: -50,
      freights: [{ code: 'NV-POST-1', orderNo: 'P1', amountUsd: 50, cargoRate: 7 }] }, N7);
    const b = h.saveChinaBatch(payload(500), N7).batches[0];
    h.postChinaBatch({ id: b.id, opId: 'op-r21', lines: [{ article: 'ART-POST-1', qty: 100 }] }, N7);
    h.setNow('2026-10-20T07:00:00Z');
    h.saveChinaBatch(payload(700, b.id), N7);
    const before = h.stockOf('ART-POST-1');
    const rowsBefore = h.dumpTransSheet().length;
    const recBefore = JSON.stringify(h.getChinaBatches().batches.filter(x => x.id === b.id)[0].postingRecords);
    const r = run(() => h.cancelChinaBatchPosting({ id: b.id }, N7));
    const after = h.stockOf('ART-POST-1');
    const rowsAfter = h.dumpTransSheet().length;
    const recAfter = JSON.stringify(h.getChinaBatches().batches.filter(x => x.id === b.id)[0].postingRecords);
    check('Item 100.6 part 2 / R-021: cancelling a posting older than 30 days that has a later correction is refused (age error)',
      r.err !== '', 'no error thrown');
    check('Item 100.6 part 2 / R-021: the refused cancel deletes nothing - capitalization 16900, 2 transaction rows, postingRecords unchanged',
      after.capitalization === before.capitalization && before.capitalization === 16900 && after.quantity === before.quantity &&
      rowsBefore === 2 && rowsAfter === rowsBefore && recAfter === recBefore,
      'cap ' + before.capitalization + '->' + after.capitalization + ' qty ' + before.quantity + '->' + after.quantity + ' rows ' + rowsBefore + '->' + rowsAfter + ' recordsSame ' + (recAfter === recBefore));
  }

  // ---- R-021 gap: a fresh posting WITH a correction cancels fully
  {
    const payload = (rf, id) => Object.assign(id ? { id } : {}, {
      orderNo: 'P1', code: 'NV-POST-1', status: 'Прибыла', shippedAt: '2026-08-01', arrivedAt: '2026-08-25',
      weightKg: 100, ratePerKgUsd: 1, rubRate: 12,
      lines: [{ marking: 'M1', boxes: 10, pcsPerBox: 10, qty: 100, priceCny: 10, article: 'ART-POST-1' }],
      costs: [{ type: 'Прочее', amountRub: rf, comment: 'разгрузка' }] });
    const h = withChina();
    h.setNow('2026-09-01T07:00:00Z');
    h.setSkuSheet(['SKU', 'ШТ/КОР'], [['ART-POST-1', 10]]); h.setStockSheet([]); h.ensureTransSheet();
    h.saveChinaReport({ reportDate: '2026-09-01', source: 'скрипт', orders: [], receipts: [], openingFreightUsd: -50,
      freights: [{ code: 'NV-POST-1', orderNo: 'P1', amountUsd: 50, cargoRate: 7 }] }, N7);
    const b = h.saveChinaBatch(payload(500), N7).batches[0];
    h.postChinaBatch({ id: b.id, opId: 'op-r21f', lines: [{ article: 'ART-POST-1', qty: 100 }] }, N7);
    h.setNow('2026-09-05T07:00:00Z');
    h.saveChinaBatch(payload(700, b.id), N7);
    const rowsBefore = h.dumpTransSheet().length;
    const r = run(() => h.cancelChinaBatchPosting({ id: b.id }, N7));
    const st = h.stockOf('ART-POST-1');
    const rec = h.getChinaBatches().batches.filter(x => x.id === b.id)[0].postingRecords;
    check('Item 100.6 part 2 / R-021 gap: a fresh posting with a correction (rows ' + rowsBefore + ') cancels fully - no error, no transaction rows, no stock left',
      rowsBefore === 2 && r.err === '' && h.dumpTransSheet().length === 0 && (!st || Number(st.quantity) === 0) && (!rec || rec.length === 0),
      'rowsBefore ' + rowsBefore + ' error "' + r.err + '" rowsAfter ' + h.dumpTransSheet().length + ' stock ' + JSON.stringify(st) + ' records ' + JSON.stringify(rec));
  }

  // ---- R-018: a crash in the middle of per-article cost corrections must not double-apply on retry
  {
    const payload = (rf, id) => Object.assign(id ? { id } : {}, {
      orderNo: 'P1', code: 'NV-POST-1', status: 'Прибыла', shippedAt: '2026-08-01', arrivedAt: '2026-08-25',
      weightKg: 100, ratePerKgUsd: 1, rubRate: 12,
      lines: [
        { marking: 'MA', boxes: 5, pcsPerBox: 10, qty: 50, priceCny: 10, article: 'ART-POST-1' },
        { marking: 'MB', boxes: 5, pcsPerBox: 10, qty: 50, priceCny: 10, article: 'ART-POST-2' }],
      costs: [{ type: 'Прочее', amountRub: rf, comment: 'разгрузка' }] });
    const caps = h => [h.stockOf('ART-POST-1').capitalization, h.stockOf('ART-POST-2').capitalization];
    const scenario = (failSecond) => {
      const h = withChina();
      h.setSkuSheet(['SKU', 'ШТ/КОР'], [['ART-POST-1', 10], ['ART-POST-2', 10]]);
      h.setStockSheet([]); h.ensureTransSheet();
      h.saveChinaReport({ reportDate: '2026-09-01', source: 'скрипт', orders: [], receipts: [], openingFreightUsd: -50,
        freights: [{ code: 'NV-POST-1', orderNo: 'P1', amountUsd: 50, cargoRate: 7 }] }, N7);
      const b = h.saveChinaBatch(payload(500), N7).batches[0];
      h.postChinaBatch({ id: b.id, opId: 'op-r18', lines: [{ article: 'ART-POST-1', qty: 50 }, { article: 'ART-POST-2', qty: 50 }] }, N7);
      let calls = 0; const orig = h.context.commitCostCorrection; let crashed = '';
      if (failSecond) h.context.commitCostCorrection = function () { calls++; if (calls === 2) throw new Error('simulated crash'); return orig.apply(this, arguments); };
      try { h.saveChinaBatch(payload(900, b.id), N7); } catch (e) { crashed = e.message; }
      h.context.commitCostCorrection = orig;
      const retry = run(() => h.saveChinaBatch(payload(900, b.id), N7));
      return { final: caps(h), crashed, retryErr: retry.err, calls };
    };
    const ctrl = scenario(false), fail = scenario(true);
    check('Item 100.6 part 2 / R-018 control: without a crash both articles get capitalization 8550 after the cost correction',
      JSON.stringify(ctrl.final) === '[8550,8550]', JSON.stringify(ctrl));
    check('Item 100.6 part 2 / R-018: crash on the 2nd per-article correction, then retry - final capitalizations equal the no-crash control [8550,8550] (top-up not added twice to article A)',
      JSON.stringify(fail.final) === JSON.stringify(ctrl.final), 'final ' + JSON.stringify(fail.final) + ' control ' + JSON.stringify(ctrl.final) + ' crashed "' + fail.crashed + '" retryErr "' + fail.retryErr + '" calls ' + fail.calls);
  }

  // ---- R-022: the empty-article "one product" fill applies to the SAME marking only
  {
    const mk = (orderNo, markings) => {
      const h = withChina();
      h.saveChinaReport({ reportDate: '2026-09-25', source: 'скрипт', orders: [{ orderNo, date: '2026-09-01', receivedCny: 0, totalCny: 1000, unpaidCny: 1000 }], receipts: [], freights: [] }, N7);
      const b = h.saveChinaBatch({ orderNo, code: 'NV-' + orderNo, status: 'В пути', shippedAt: '2026-09-16', rubRate: 12,
        lines: markings.map(m => ({ marking: m, boxes: 1, pcsPerBox: 10, qty: 10, priceCny: 0, article: '' })) }, N7).batches[0];
      return b;
    };
    const b = mk('77', ['CHAIR10', 'TABLE10']);
    check('Item 100.6 part 2 / R-022: two DIFFERENT markings with empty articles and zero prices - goods are not filled from the 1000 yuan order total as one product',
      b.goodsCny === 0, 'goodsCny ' + b.goodsCny + ' missing ' + JSON.stringify(b.missing));
    const c = mk('78', ['SAME', 'SAME']);
    check('Item 100.6 part 2 / R-022 control: the SAME marking twice with empty article - fill from the report is still allowed (goodsCny 1000)',
      c.goodsCny === 1000, 'goodsCny ' + c.goodsCny);
  }

  // ---- R-040: a posting request must cover all lines of the batch
  {
    const setup40 = () => {
      const h = withChina();
      h.setSkuSheet(['SKU', 'ШТ/КОР'], [['ART-A', 10], ['ART-B', 10]]);
      h.setStockSheet([]); h.ensureTransSheet();
      h.saveChinaReport({ reportDate: '2026-09-01', source: 'скрипт', orders: [], receipts: [],
        freights: [{ code: 'NV-POST-1', orderNo: 'P1', amountUsd: 50, cargoRate: 7 }] }, N7);
      const b = h.saveChinaBatch({ orderNo: 'P1', code: 'NV-POST-1', status: 'Прибыла', shippedAt: '2026-08-01', arrivedAt: '2026-08-25',
        weightKg: 100, ratePerKgUsd: 1, rubRate: 12,
        lines: [{ marking: 'M1', boxes: 5, pcsPerBox: 10, qty: 50, priceCny: 10, article: 'ART-A' },
                { marking: 'M2', boxes: 5, pcsPerBox: 10, qty: 50, priceCny: 10, article: 'ART-B' }],
        costs: [{ type: 'Прочее', amountRub: 500, comment: 'x' }] }, N7).batches[0];
      return { h, b };
    };
    {
      const { h, b } = setup40();
      const factoryOf = () => JSON.stringify(h.dumpFactoryOrders());
      const factoryBefore = factoryOf();
      const r = run(() => h.postChinaBatch({ id: b.id, opId: 'op-r40a', lines: [{ article: 'ART-A', qty: 50 }] }, N7));
      const after = h.getChinaBatches().batches.find(x => x.id === b.id);
      check('Item 100.6 part 2 / R-040: a posting request covering only ART-A of a two-article batch is refused with an error',
        b.canPost === true && r.err !== '', 'canPost ' + b.canPost + ' error "' + r.err + '"');
      check('Item 100.6 part 2 / R-040: the refused partial request posts nothing - no stock for ART-A/ART-B, postingState empty, factory rows unchanged',
        !h.stockOf('ART-A') && !h.stockOf('ART-B') && (after.postingState || '') === '' && factoryOf() === factoryBefore,
        'stockA ' + !!h.stockOf('ART-A') + ' stockB ' + !!h.stockOf('ART-B') + ' state "' + after.postingState + '" factoryChanged ' + (factoryOf() !== factoryBefore));
    }
    {
      const { h, b } = setup40();
      const r = run(() => h.postChinaBatch({ id: b.id, opId: 'op-r40b', lines: [{ article: 'ART-A', qty: 50 }, { article: 'ART-B', qty: 50 }] }, N7));
      const after = h.getChinaBatches().batches.find(x => x.id === b.id);
      check('Item 100.6 part 2 / R-040 control: the full request (both articles) still posts the batch',
        r.err === '' && !!h.stockOf('ART-A') && !!h.stockOf('ART-B') && (after.postingState || '') !== '',
        'error "' + r.err + '" state "' + after.postingState + '"');
    }
  }

  // ---- R-047 (owner decision): the same article in two forecast lines is summed into one factory row
  {
    const h = withChina();
    h.setNow('2026-10-20T07:00:00Z');
    const mkBase = (article) => h.saveChinaBatch({ orderNo: '44', code: 'NV-BOX-' + article, status: 'Прибыла', shippedAt: '2026-01-01', arrivedAt: '2026-02-01',
      lines: [{ marking: 'NVX' + article, name: 'x', boxes: 10, pcsPerBox: 10, qty: 100, priceCny: 20, boxLengthM: 0.3, boxWidthM: 0.2, boxHeightM: 0.1, factoryBoxKg: 5, article }] }, N7);
    mkBase('ART-F');
    const r = run(() => h.saveChinaForecast({ orderNo: '45', lines: [{ article: 'ART-F', pieces: 5 }, { article: 'ART-F', pieces: 7 }], expectedShipAt: '2026-10-21' }, N7));
    const rows = h.dumpFactoryOrders().filter(x => x['Заказ Китай'] === '45');
    check('Item 100.6 part 2 / R-047: a forecast with the same article in two lines (5 and 7) produces ONE factory row with quantity 12',
      r.err === '' && rows.length === 1 && Number(rows[0]['Количество']) === 12,
      'error "' + r.err + '" rows ' + JSON.stringify(rows.map(x => x['Количество'])));

    const syncAgain = run(() => { h.context.syncChinaFactoryOrders(N7); h.context.syncChinaFactoryOrders(N7); });
    const rows2 = h.dumpFactoryOrders().filter(x => x['Заказ Китай'] === '45');
    check('Item 100.6 part 2 / R-047 gap: syncing the same forecast again (twice more) is idempotent - still ONE row with quantity 12, no growth to 24',
      syncAgain.err === '' && rows2.length === 1 && Number(rows2[0]['Количество']) === 12,
      'error "' + syncAgain.err + '" rows ' + JSON.stringify(rows2.map(x => x['Количество'])));

    const h2 = withChina();
    h2.setNow('2026-10-20T07:00:00Z');
    ['ART-F', 'ART-G'].forEach(article => h2.saveChinaBatch({ orderNo: '44' + article, code: 'NV-BOX-' + article, status: 'Прибыла', shippedAt: '2026-01-01', arrivedAt: '2026-02-01',
      lines: [{ marking: 'NVX' + article, name: 'x', boxes: 10, pcsPerBox: 10, qty: 100, priceCny: 20, boxLengthM: 0.3, boxWidthM: 0.2, boxHeightM: 0.1, factoryBoxKg: 5, article }] }, N7));
    const r3 = run(() => h2.saveChinaForecast({ orderNo: '46', lines: [{ article: 'ART-F', pieces: 5 }, { article: 'ART-G', pieces: 7 }], expectedShipAt: '2026-10-21' }, N7));
    const rows3 = h2.dumpFactoryOrders().filter(x => x['Заказ Китай'] === '46').map(x => Number(x['Количество'])).sort((a, b) => a - b);
    check('Item 100.6 part 2 / R-047 control: a forecast with two DISTINCT articles (5 and 7) keeps two separate factory rows',
      r3.err === '' && JSON.stringify(rows3) === '[5,7]', 'error "' + r3.err + '" rows ' + JSON.stringify(rows3));
  }
}

// ================= Item 100.8 T4: owner decisions of 2026-10-30 (A: absent order, B: text quantity cells, C: repeat unshipped return) =================
{
  // ---- A) a China batch whose order is absent from the newest report is not closed ----
  const batchOf = (h, id) => h.getChinaBatches().batches.filter(x => x.id === id)[0];
  {
    // The batch is costed and posted when the newest report ALREADY lacks its order (the report lists order 2 only).
    const h = withChina();
    h.setSkuSheet(['SKU', 'ШТ/КОР'], [['ART-POST-1', 10]]); h.setStockSheet([]); h.ensureTransSheet();
    const frt = { code: 'NV-R16', orderNo: '1', amountUsd: 10, cargoRate: 7 };
    // Report 1 settles order 1 and pays its receipts at a real rate; report 2 (newer) lists order 2 only,
    // so the only thing left to hold the batch open is the absent order.
    h.saveChinaReport({ reportDate: '2026-09-01', source: 'скрипт',
      orders: [{ orderNo: '1', date: '2026-08-20', receivedCny: 100, totalCny: 100, unpaidCny: 0 }],
      receipts: [{ date: '2026-09-01', goodsCny: 100, freightCny: 70, freightUsd: 10 }], freights: [frt] }, 'Николай');
    h.saveChinaPayment({ date: '2026-09-01', amountRub: 1700, rate: 10, comment: 'P1' }, 'Николай');
    h.saveChinaReport({ reportDate: '2026-09-02', source: 'скрипт',
      orders: [{ orderNo: '2', date: '2026-08-20', receivedCny: 0, totalCny: 500, unpaidCny: 500 }],
      receipts: [{ date: '2026-09-01', goodsCny: 100, freightCny: 70, freightUsd: 10 }], freights: [frt] }, 'Николай');
    const pl = function (id) {
      return Object.assign(id ? { id: id } : {}, { orderNo: '1', code: 'NV-R16', status: 'Прибыла', shippedAt: '2026-08-01', arrivedAt: '2026-08-25',
        weightKg: 100, ratePerKgUsd: 1, cargoRate: 7,
        lines: [{ marking: 'M1', boxes: 1, pcsPerBox: 10, qty: 10, priceCny: 100, article: 'ART-POST-1' }],
        costs: [{ type: 'Прочее', amountRub: 100, comment: 'разгрузка' }] });
    };
    const b0 = h.saveChinaBatch(pl(), 'Николай').batches[0];
    h.postChinaBatch({ id: b0.id, opId: 'op-t4a', lines: [{ article: 'ART-POST-1', qty: 10 }] }, 'Николай');
    h.saveChinaBatch(pl(b0.id), 'Николай');
    const after = batchOf(h, b0.id);
    check('100.8 T4 A sanity: the ONLY missing reason of that batch is the absent order (no provisional rate etc.)',
      after.missing.length === 1 && /заказ/i.test(after.missing[0]), JSON.stringify(after.missing));
    check('100.8 T4 A: a batch costed and posted while the newest report lacks its order is NOT closed and not «окончательно»',
      after.closed === false && after.postingState !== 'окончательно',
      JSON.stringify({ closed: after.closed, state: after.postingState, missing: after.missing }));
    check('100.8 T4 A: the missing list of that batch names the absent order (an entry with «заказ» and «отчёт»)',
      after.missing.some(m => /заказ/i.test(m) && /отчёт/i.test(m) && m.indexOf('товар не оплачен') === -1),
      JSON.stringify(after.missing));
  }
  {
    // A batch that is already «окончательно» is not reopened by a later report without its order.
    const h = withChina();
    const s = china100R016Scenario(h, 900);
    h.saveChinaPayment({ date: '2026-09-10', amountRub: 18000, rate: 20, comment: 'P2' }, 'Николай');
    h.saveChinaReport({ reportDate: '2026-09-10', source: 'скрипт',
      orders: [{ orderNo: '1', date: '2026-08-20', receivedCny: 1000, totalCny: 1000, unpaidCny: 0 }],
      receipts: [{ date: '2026-09-01', goodsCny: 100, freightCny: 70, freightUsd: 10 }, { date: '2026-09-10', goodsCny: 900 }], freights: [s.frt] }, 'Николай');
    const fin0 = batchOf(h, s.id);
    h.saveChinaReport({ reportDate: '2026-09-11', source: 'скрипт',
      orders: [{ orderNo: '2', date: '2026-09-05', receivedCny: 0, totalCny: 500, unpaidCny: 500 }],
      receipts: [{ date: '2026-09-01', goodsCny: 100, freightCny: 70, freightUsd: 10 }, { date: '2026-09-10', goodsCny: 900 }], freights: [s.frt] }, 'Николай');
    const fin1 = batchOf(h, s.id);
    check('100.8 T4 A guard: a batch already «окончательно» stays «окончательно» (and closed) after a later report without its order',
      fin0.postingState === 'окончательно' && fin1.postingState === 'окончательно' && fin1.closed === true,
      JSON.stringify({ before: fin0.postingState, after: fin1.postingState, closed: fin1.closed, missing: fin1.missing }));
  }
  {
    const h = withChina();
    h.saveChinaBatch({ orderNo: '99', code: 'OLDBATCH', status: 'Черновик', shippedAt: '2026-05-01',
      lines: [{ marking: 'M1', name: 'x', boxes: 1, pcsPerBox: 1, qty: 1, priceCny: 10 }] }, 'Николай');
    h.saveChinaReport({ reportDate: '2026-09-10', source: 'скрипт',
      orders: [{ orderNo: '2', date: '2026-09-05', receivedCny: 0, totalCny: 500, unpaidCny: 500 }],
      receipts: [], freights: [] }, 'Николай');
    const old = h.getChinaBatches().batches.filter(b => b.code === 'OLDBATCH')[0];
    check('100.8 T4 A guard: a history batch (shipped before tracking) with its order absent from the newest report stays closed with no missing entries',
      old.history === true && old.closed === true && old.missing.length === 0,
      JSON.stringify({ history: old.history, closed: old.closed, missing: old.missing }));
  }

  // ---- B) text cells in «Остатки» are read like parseNumber ----
  {
    const run = (type, qty, price) => {
      const h = freshHarness();
      h.ensureTransSheet();
      h.setStockSheet([{ article: 'ART-TXT', quantity: '10,5', avgCost: '5,5', capitalization: '57,75' }]);
      let err = '';
      try { h.commitTransaction([{ article: 'ART-TXT', quantity: qty, price: price }], type, type === 'Приход' ? 'Поставка' : 'Склад Тест', '', 'tester', '2026-01-05T09:00:00Z', ''); }
      catch (e) { err = String(e.message || e); }
      const row = h.dumpStockSheet().rows.filter(r => r[0] === 'ART-TXT')[0];
      return { err, row };
    };
    const e = run('Расход', 3, 5.5);
    check('100.8 T4 B: an expense of 3 from a text-quantity row «10,5» leaves a real NUMBER 7.5 in «Остатки» (not NaN, not text)',
      e.err === '' && typeof e.row[1] === 'number' && e.row[1] === 7.5, JSON.stringify({ err: e.err, row: e.row }));
    check('100.8 T4 B: that expense capitalizes correctly from text cells (57.75 - 3*5.5 = 41.25, avg 5.5)',
      typeof e.row[3] === 'number' && Math.abs(e.row[3] - 41.25) < 0.005 && Math.abs(e.row[2] - 5.5) < 0.005, JSON.stringify(e.row));
    const r = run('Приход', 5, 6);
    check('100.8 T4 B: a receipt of 5 at 6 on a text-quantity row «10,5» adds correctly: quantity 15.5, capitalization 87.75',
      r.err === '' && r.row[1] === 15.5 && Math.abs(r.row[3] - 87.75) < 0.005, JSON.stringify({ err: r.err, row: r.row }));
  }

  // ---- C) «вернуть неотгруженное» may be repeated once all its receipts were deleted ----
  {
    const stand = (articles) => {
      const h = freshHarness();
      h.setNow('2026-10-20T07:00:00Z');
      h.ensureTransSheet();
      h.ensureArchiveSheet();
      h.setStockSheet(articles.map(a => ({ article: a, quantity: 20, avgCost: 100, capitalization: 2000 })));
      const wo = h.commitTransaction(articles.map(a => ({ article: a, quantity: 10, price: 100 })), 'Расход', 'Ozon (MaxiStore)', '2026-10-20', 'tester', '2026-10-19T07:00:00Z', 'op-wo', undefined, undefined, undefined, undefined, true);
      h.setExternalShipmentsSheet([{ postingId: 'P1', cabinet: 'MaxiStore', status: 'processed', items: articles.map(a => ({ offerId: a, quantity: 10 })),
        transGroupInfo: JSON.stringify(wo.newTransactions.map(t => String(t.id))), orderNumber: '1' }]);
      return h;
    };
    const ret = (h, articles, shipped, op) => h.commitUnshippedReturn('P1', articles.map(a => ({ offerId: a, article: a, shipped })), 'tester', op);
    const receipts = (h) => h.dumpTransSheet().filter(r => r['Тип'] === 'Приход');
    const marker = (h) => (h.dumpExternalShipments().find(r => r.PostingID === 'P1') || {}).ОтгруженоJSON || '';
    {
      const h = stand(['A']);
      ret(h, ['A'], 5, 'x');
      const oldId = String(receipts(h)[0]['ID']);
      h.deleteTransaction(oldId, 'tester');
      let err = '';
      try { ret(h, ['A'], 3, 'y'); } catch (e) { err = String(e.message || e); }
      const live = receipts(h);
      check('100.8 T4 C: after the return receipt was deleted from «История», returning again (3 shipped) succeeds without an error',
        err === '', 'error "' + err + '"');
      check('100.8 T4 C: the repeated return leaves exactly one live receipt, new id, quantity 7, and stock 17',
        live.length === 1 && String(live[0]['ID']) !== oldId && Number(live[0]['Количество']) === 7 && h.stockOf('A').quantity === 17,
        JSON.stringify({ receipts: live.map(r => [r['ID'], r['Количество']]), oldId: oldId, stock: h.stockOf('A').quantity }));
      check('100.8 T4 C: ОтгруженоJSON is rewritten to point at the new receipt, not the deleted one',
        err === '' && marker(h) !== '' && JSON.parse(marker(h)).returnTxIds.indexOf(oldId) === -1 && JSON.parse(marker(h)).returnTxIds.indexOf(String(live[0] && live[0]['ID'])) !== -1,
        'marker "' + marker(h) + '"');
      let err3 = '';
      try { ret(h, ['A'], 3, 'z'); } catch (e) { err3 = String(e.message || e); }
      check('100.8 T4 C guard: a further return while the repeated receipt is live is refused and posts nothing',
        err3 !== '' && receipts(h).length === 1 && h.stockOf('A').quantity === 17, 'error "' + err3 + '" receipts ' + receipts(h).length + ' stock ' + h.stockOf('A').quantity);
    }
    {
      const h = stand(['A']);
      ret(h, ['A'], 5, 'x');
      let err = '';
      try { ret(h, ['A'], 3, 'y'); } catch (e) { err = String(e.message || e); }
      check('100.8 T4 C guard: a second return while the first receipt still exists is refused; stock stays 15, one receipt',
        err !== '' && h.stockOf('A').quantity === 15 && receipts(h).length === 1, 'error "' + err + '" stock ' + h.stockOf('A').quantity + ' receipts ' + receipts(h).length);
    }
    {
      const h = stand(['A', 'B']);
      ret(h, ['A', 'B'], 5, 'x');
      h.deleteTransaction(String(receipts(h)[0]['ID']), 'tester');
      let err = '';
      try { ret(h, ['A', 'B'], 3, 'y'); } catch (e) { err = String(e.message || e); }
      check('100.8 T4 C guard: with only SOME of the return receipts deleted (one of two live) a repeat is refused and posts nothing',
        err !== '' && receipts(h).length === 1, 'error "' + err + '" receipts ' + receipts(h).length);
    }
    {
      const h = stand(['A']);
      ret(h, ['A'], 5, 'x');
      h.deleteTransaction(String(receipts(h)[0]['ID']), 'tester');
      check('100.8 T4 C: deleting the only return receipt clears «ОтгруженоJSON» of the supply (marker empty)',
        marker(h) === '', 'marker "' + marker(h) + '"');
    }
    {
      const h = stand(['A', 'B']);
      ret(h, ['A', 'B'], 5, 'x');
      const before = marker(h);
      h.deleteTransaction(String(receipts(h)[0]['ID']), 'tester');
      check('100.8 T4 C: deleting ONE of two return receipts leaves «ОтгруженоJSON» unchanged',
        before !== '' && marker(h) === before, 'before "' + before + '" after "' + marker(h) + '"');
    }
    {
      const h = stand(['A']);
      ret(h, ['A'], 5, 'x');
      const before = marker(h);
      const r = receipts(h)[0];
      let err = '';
      try {
        h.updateTransaction(String(r['ID']), { article: 'A', quantity: 4, price: 100, type: 'Приход', destination: String(r['Объект']), date: '2026-10-20T07:00:00Z' }, 'tester');
      } catch (e) { err = String(e.message || e); }
      check('100.8 T4 C: a pencil edit of the return receipt (update path) does NOT clear «ОтгруженоJSON»',
        err === '' && marker(h) !== '' && marker(h) === before, 'error "' + err + '" before "' + before + '" after "' + marker(h) + '"');
    }
    // ---- restore of a deleted return receipt from the archive is refused (owner ruling 2026-10-30, option A) ----
    {
      const h = stand(['A']);
      ret(h, ['A'], 5, 'x');
      h.deleteTransaction(String(receipts(h)[0]['ID']), 'tester');
      const archiveId = h.dumpArchive()[h.dumpArchive().length - 1].archiveId;
      const stockBefore = h.stockOf('A').quantity;
      let err = '';
      try { h.restoreArchivedItem(archiveId, 'tester'); } catch (e) { err = String(e.message || e); }
      check('100.8 T4 C restore: restoring a deleted return-of-unshipped receipt (single restore) is refused with a message',
        err !== '', 'no error thrown');
      check('100.8 T4 C restore: the refused single restore changes no stock and leaves the receipt out of «История»',
        h.stockOf('A').quantity === stockBefore && receipts(h).length === 0,
        'stock ' + h.stockOf('A').quantity + ' (was ' + stockBefore + ') receipts ' + receipts(h).length);
      check('100.8 T4 C restore: the refused row stays in the archive',
        h.dumpArchive().some(a => a.archiveId === archiveId), 'archive ids ' + JSON.stringify(h.dumpArchive().map(a => a.archiveId)));
    }
    {
      const h = stand(['A']);
      ret(h, ['A'], 5, 'x');
      h.deleteTransaction(String(receipts(h)[0]['ID']), 'tester');
      const ids = h.dumpArchive().map(a => a.archiveId);
      const stockBefore = h.stockOf('A').quantity;
      let res = null, err = '';
      try { res = h.restoreMultipleArchivedItems(ids, 'tester'); } catch (e) { err = String(e.message || e); }
      check('100.8 T4 C restore: the multiple-restore path also refuses a return-of-unshipped receipt (no receipt back, stock unchanged, row stays in the archive)',
        receipts(h).length === 0 && h.stockOf('A').quantity === stockBefore && h.dumpArchive().length === ids.length,
        JSON.stringify({ err: err, receipts: receipts(h).length, stock: h.stockOf('A').quantity, was: stockBefore, archive: h.dumpArchive().length, message: res && res.message }));
    }
    {
      const h = stand(['A']);
      h.commitTransaction([{ article: 'A', quantity: 4, price: 100 }], 'Приход', 'Поставка', '2026-10-20', 'tester', '2026-10-20T06:00:00Z', 'op-plain');
      const plain = receipts(h)[0];
      h.deleteTransaction(String(plain['ID']), 'tester');
      const archiveId = h.dumpArchive()[h.dumpArchive().length - 1].archiveId;
      const stockBefore = h.stockOf('A').quantity;
      let err = '';
      try { h.restoreArchivedItem(archiveId, 'tester'); } catch (e) { err = String(e.message || e); }
      check('100.8 T4 C restore guard: restoring an ordinary deleted receipt still works (back in «История», stock +4)',
        err === '' && receipts(h).length === 1 && h.stockOf('A').quantity === stockBefore + 4,
        'error "' + err + '" receipts ' + receipts(h).length + ' stock ' + h.stockOf('A').quantity + ' (was ' + stockBefore + ')');
    }
  }
}

// ================= Item 100.9 part 1: R-024 (ensureColumns must not release the caller's lock), R-025 (nightly analytics races receipts) =================
{
  const stockWithSale = () => {
    const h = freshHarness();
    h.setNow('2026-10-20T07:00:00Z');
    h.ensureTransSheet();
    h.ensureArchiveSheet();
    h.setStockSheet([{ article: 'A', quantity: 10, avgCost: 100, capitalization: 1000 }]);
    h.commitTransaction([{ article: 'A', quantity: 3, price: 100 }], 'Расход', 'Склад', '', 'tester', undefined, 'op-sale');
    return h; // A: stock 7, sales over 120 days 3, turnover 7 / (3 / 120) = 280
  };
  // Runs recalculateDailyAnalytics; the first read of the whole stock sheet is followed by a receipt of 5 (the "mid-run" posting).
  const runWithMidRunReceipt = (h) => {
    const stock = h.getRegistrySheet('Остатки');
    const origDR = stock.getDataRange.bind(stock);
    const origRange = stock.getRange.bind(stock);
    const info = { injected: false, receiptStatus: '', heldAtWrite: [], writes: [] };
    let injecting = false;
    stock.getDataRange = () => {
      const r = origDR();
      const gv = r.getValues.bind(r);
      r.getValues = () => {
        const v = gv();
        if (!info.injected) {
          info.injected = true;
          injecting = true; // writes of the injected receipt are not the analytics' own writes
          try { h.commitTransaction([{ article: 'A', quantity: 5, price: 100 }], 'Приход', 'Склад', '', 'tester', undefined, 'op-mid'); info.receiptStatus = 'success'; }
          catch (e) { info.receiptStatus = 'error: ' + e.message; }
          injecting = false;
        }
        return v;
      };
      return r;
    };
    stock.getRange = (...a) => {
      const r = origRange(...a);
      const sv = r.setValues.bind(r);
      r.setValues = (vals) => { if (injecting) return sv(vals); info.heldAtWrite.push(h.isScriptLockHeld()); info.writes.push({ args: a, rows: vals.length, cols: (vals[0] || []).length }); return sv(vals); };
      return r;
    };
    h.context.recalculateDailyAnalytics();
    stock.getDataRange = origDR;
    stock.getRange = origRange;
    return info;
  };

  // --- R-025 ---
  {
    const h = stockWithSale();
    const info = runWithMidRunReceipt(h);
    const s = h.stockOf('A');
    check('100.9 R-025: a receipt posted after the nightly analytics took its snapshot survives (stock 7+5=12, capitalization 1200)',
      info.receiptStatus === 'success' && s.quantity === 12 && s.capitalization === 1200,
      JSON.stringify({ receiptStatus: info.receiptStatus, stock: s }));
  }
  {
    const h = stockWithSale();
    const info = runWithMidRunReceipt(h);
    check('100.9 R-025: the nightly analytics holds the script lock while it writes and releases it afterwards',
      info.writes.length > 0 && info.heldAtWrite.every(x => x === true) && !h.isScriptLockHeld(),
      JSON.stringify({ heldAtWrite: info.heldAtWrite, heldAfter: h.isScriptLockHeld() }));
  }
  {
    // control: no concurrent posting at all
    const h = stockWithSale();
    h.context.recalculateDailyAnalytics();
    const row = h.getRegistrySheet('Остатки').__dump()[1];
    check('100.9 R-025 control: the nightly analytics writes sales 3 and turnover 280 into columns 5-6 and keeps columns 1-4',
      row[0] === 'A' && row[1] === 7 && row[2] === 100 && row[3] === 700 && row[4] === 3 && row[5] === 280,
      JSON.stringify(row));
  }
  {
    const h = stockWithSale();
    runWithMidRunReceipt(h);
    const row = h.getRegistrySheet('Остатки').__dump()[1];
    check('100.9 R-025: columns 1-4 hold the live values changed mid-run (A, 12, 100, 1200) and columns 5-6 still hold the analytics values',
      row[0] === 'A' && row[1] === 12 && row[2] === 100 && row[3] === 1200 && row[4] === 3,
      JSON.stringify(row));
  }
  {
    const h = stockWithSale();
    const info = runWithMidRunReceipt(h);
    const only56 = info.writes.length > 0 && info.writes.every(w => w.args[1] >= 5 && w.args[1] + w.args[3] - 1 <= 6);
    check('100.9 R-025: the analytics writes only columns 5-6 (never the quantity/avgCost/capitalization columns)',
      only56, JSON.stringify(info.writes));
  }

  // --- R-024 ---
  {
    const h = freshHarness();
    h.setNow('2026-10-20T07:00:00Z');
    h.ensureTransSheet();
    h.ensureArchiveSheet();
    h.makeSheet(h.TRANS_HEADERS, 'Транзакции'); // an old «История»: none of the service columns exist yet
    h.setStockSheet([{ article: 'A', quantity: 10, avgCost: 100, capitalization: 1000 }]);
    const stock = h.getRegistrySheet('Остатки');
    const origRange = stock.getRange.bind(stock);
    const heldAtStockRead = [];
    stock.getRange = (...a) => {
      const r = origRange(...a);
      const gv = r.getValues.bind(r);
      r.getValues = () => { heldAtStockRead.push(h.isScriptLockHeld()); return gv(); };
      return r;
    };
    const lock = h.context.LockService.getScriptLock();
    lock.waitLock(30000); // the caller (doPost 'commit') holds the script lock for the whole operation
    h.commitTransaction([{ article: 'A', quantity: 6, price: 100 }], 'Расход', 'Склад', '', 'tester', undefined, 'op-1');
    const heldAfter = h.isScriptLockHeld();
    stock.getRange = origRange;
    check('100.9 R-024: ensureColumns migrating an old «История» does not release the lock its caller holds (held at every stock read and after commit)',
      heldAtStockRead.length > 0 && heldAtStockRead.every(x => x === true) && heldAfter === true,
      JSON.stringify({ heldAtStockRead: heldAtStockRead, heldAfterCommit: heldAfter }));
  }
  {
    const h = freshHarness();
    const sheet = h.makeSheet(['Артикул'], 'Тест');
    const before = h.lockRequests();
    let heldDuringWrite = null;
    const origRange = sheet.getRange.bind(sheet);
    sheet.getRange = (...a) => { const r = origRange(...a); const sv = r.setValue.bind(r); r.setValue = (v) => { heldDuringWrite = h.isScriptLockHeld(); return sv(v); }; return r; };
    h.context.ensureColumns(sheet, ['Артикул', 'Новая']);
    sheet.getRange = origRange;
    check('100.9 R-024 control: ensureColumns called with no lock held takes the lock for the header write and releases it afterwards',
      h.lockRequests() === before + 1 && heldDuringWrite === true && !h.isScriptLockHeld() && h.headerRowOf(sheet).indexOf('Новая') !== -1,
      JSON.stringify({ lockRequests: h.lockRequests() - before, heldDuringWrite: heldDuringWrite, heldAfter: h.isScriptLockHeld(), header: h.headerRowOf(sheet) }));
  }
}

// ================= Item 100.9 part 2: R-062 (text receipt date read month-first), R-068 («Обновлено» shifts when the spreadsheet zone differs from the script zone) =================
{
  const REAL_ZONE = 'Asia/Yekaterinburg'; // appsscript.json; the stand hard-codes Europe/Moscow
  const freshReal = () => {
    const h = freshHarness();
    h.setScriptTimeZone(REAL_ZONE);
    h.setNow('2026-10-20T07:00:00Z');
    return h;
  };

  // --- R-062 ---
  {
    const h = freshReal();
    const a = h.daysSinceTransactionDate('01.10.2026');
    const b = h.daysSinceTransactionDate('10.08.2026');
    const c = h.daysSinceTransactionDate('01-10-2026');
    check('100.9 R-062: a text date dd.mm.yyyy is read day-first (01.10.2026 is 19 days old at 2026-10-20)', a === 19, 'age=' + a);
    check('100.9 R-062: a text date dd.mm.yyyy is read day-first (10.08.2026 is 71 days old, not month-first 10 Aug read as 8 Oct)', b === 71, 'age=' + b);
    check('100.9 R-062: a text date dd-mm-yyyy is read day-first (01-10-2026 is 19 days old)', c === 19, 'age=' + c);
    const iso = h.daysSinceTransactionDate('2026-10-01');
    const isoTime = h.daysSinceTransactionDate('2026-10-01T00:00:00');
    check('100.9 R-062 control: ISO strings keep their age (2026-10-01 and 2026-10-01T00:00:00 are both 19 days old)',
      iso === 19 && isoTime === 19, JSON.stringify({ iso: iso, isoTime: isoTime }));
    check('100.9 R-062 control: an empty or unreadable date has age 0',
      h.daysSinceTransactionDate('') === 0 && h.daysSinceTransactionDate('not a date') === 0,
      JSON.stringify({ empty: h.daysSinceTransactionDate(''), junk: h.daysSinceTransactionDate('not a date') }));
  }
  {
    const h = freshReal();
    h.ensureTransSheet();
    h.ensureArchiveSheet();
    h.setStockSheet([]);
    const tx = h.commitTransaction([{ article: 'A', quantity: 10, price: 100 }], 'Приход', 'Склад', '', 'tester', undefined, 'op-old');
    const id = tx.newTransactions[0].id;
    const sheet = h.getRegistrySheet('Транзакции');
    const d = sheet.__dump();
    d[1][d[0].indexOf('Дата')] = '10.08.2026'; // text date, 71 days old
    sheet.__setData(d);
    let delErr = '';
    try { h.deleteTransaction(id, 'tester'); } catch (e) { delErr = e.message; }
    const after = h.stockOf('A');
    check('100.9 R-062: deleting a receipt whose date cell is the text 10.08.2026 (71 days) is refused and stock stays 10',
      !!delErr && after.quantity === 10, JSON.stringify({ error: delErr, stock: after }));
  }

  // --- R-068 ---
  const stocksPayload = () => ({ rows: [{ cabinet: 'K1', sku: '1', offerId: 'A', name: 'n', warehouseName: 'w', clusterName: 'c', clusterId: '1', available: 1, preparing: 0, requested: 0, transit: 0, excess: 0, returns: 0, other: 0 }] });
  const stocksRoundTrip = (sheetZone) => {
    const h = freshReal();
    h.setOzonStocksSheet([]);
    h.setSheetAutoDates(sheetZone); // Sheets turns the written text into a date-time read in the SPREADSHEET zone
    h.setTargetSpreadsheetTimeZone(sheetZone);
    h.context.saveOzonStocks(stocksPayload());
    const rows = h.context.getOzonStocks();
    return rows[0] && rows[0].updatedAt;
  };
  const WANTED = '2026-10-20 12:00:00'; // 07:00Z = 12:00 Yekaterinburg
  {
    const got = stocksRoundTrip('UTC');
    check('100.9 R-068: «Обновлено» of «Остатки Ozon» reads back as written when the spreadsheet zone is UTC and the script zone is Yekaterinburg',
      got === WANTED, 'got=' + got);
  }
  {
    const got = stocksRoundTrip(REAL_ZONE);
    check('100.9 R-068 control: «Обновлено» of «Остатки Ozon» reads back as written when the spreadsheet zone equals the script zone',
      got === WANTED, 'got=' + got);
  }
  {
    const h = freshReal();
    h.setOzonSalesSheet([]);
    h.setOzonSalesArchiveSheet([]);
    h.setOzonSettings({ salesRetentionWeeks: 78 });
    h.setSheetAutoDates('UTC');
    h.setTargetSpreadsheetTimeZone('UTC');
    h.saveOzonSales({ rows: [{ week: '2026-10-12', cabinet: 'K1', offerId: 'A', cluster: 'c', qty: 3 }], okCabinets: ['K1'], mode: 'recent', replacedWeeks: ['2026-10-12'] });
    const rows = h.getOzonSales(78);
    const got = rows[0] && rows[0].updatedAt;
    check('100.9 R-068: «Обновлено» of «Продажи Ozon» (saveOzonSales/getOzonSales) reads back as written with spreadsheet zone UTC',
      got === WANTED, 'got=' + got + ' rows=' + rows.length);
  }
  {
    const h = freshReal();
    h.setOzonStocksSheet([]);
    h.setSheetAutoDates('UTC');
    h.setTargetSpreadsheetTimeZone('UTC');
    h.context.saveOzonStocks(stocksPayload());
    const rows = h.context.getOzonStockHistory();
    const got = rows[0] && rows[0].updatedAt;
    check('100.9 R-068: «Обновлено» of «История остатков Ozon» (saveOzonStocks/getOzonStockHistory) reads back as written with spreadsheet zone UTC',
      got === WANTED, 'got=' + got + ' rows=' + rows.length);
  }
  {
    // The only writer of «Дата обнаружения» is saveExternalShipments (new row = script-zone text, via setValues).
    const h = freshReal();
    h.setExternalShipmentsSheet([]);
    h.setSheetAutoDates('UTC');
    h.setTargetSpreadsheetTimeZone('UTC');
    h.context.saveExternalShipments([{ postingId: 'P-1', shipmentDate: '2026-10-21', itemsJSON: '[]', cabinet: 'K1' }]);
    const rows = h.context.getExternalShipments();
    const got = rows[0] && rows[0].detectedAt;
    check('100.9 R-068: «Дата обнаружения» of «Внешние отгрузки» (saveExternalShipments/getExternalShipments) reads back as written with spreadsheet zone UTC',
      got === WANTED, 'got=' + got + ' rows=' + rows.length);
  }
}

// ================= Item 100.10 part 1: R-070 (the stand is weaker than real Apps Script) =================
{
  const hasSwitch = (h) => typeof h.setScriptTimeZone === 'function';
  const INSTANT = Date.parse('2026-10-20T07:05:09Z'); // 12:05:09 Yekaterinburg, 10:05:09 Moscow
  const fmt = (h, zone, pattern) => {
    try { return h.context.Utilities.formatDate(new h.FakeDate(INSTANT), zone, pattern); } catch (e) { return 'THROWS: ' + e.message; }
  };
  {
    const h = freshHarness();
    const a = fmt(h, 'Asia/Yekaterinburg', "yyyy-MM-dd'T'HH:mm:ss");
    const b = fmt(h, 'Europe/Moscow', "yyyy-MM-dd'T'HH:mm:ss");
    check("100.10 R-070: formatDate supports yyyy-MM-dd'T'HH:mm:ss (Yekaterinburg and Moscow)",
      a === '2026-10-20T12:05:09' && b === '2026-10-20T10:05:09', JSON.stringify({ ekb: a, msk: b }));
  }
  {
    const h = freshHarness();
    const a = fmt(h, 'Asia/Yekaterinburg', 'yyyy-MM-dd HH-mm');
    const b = fmt(h, 'Europe/Moscow', 'yyyy-MM-dd HH-mm');
    check('100.10 R-070: formatDate supports yyyy-MM-dd HH-mm (Yekaterinburg and Moscow)',
      a === '2026-10-20 12-05' && b === '2026-10-20 10-05', JSON.stringify({ ekb: a, msk: b }));
  }
  {
    const h = freshHarness();
    const def = h.context.Session.getScriptTimeZone();
    let after = null;
    if (hasSwitch(h)) { h.setScriptTimeZone('Asia/Yekaterinburg'); after = h.context.Session.getScriptTimeZone(); }
    check('100.10 R-070: setScriptTimeZone switches Session.getScriptTimeZone; the default stays Europe/Moscow',
      hasSwitch(h) && def === 'Europe/Moscow' && after === 'Asia/Yekaterinburg', JSON.stringify({ hasSwitch: hasSwitch(h), def: def, after: after }));
  }
  {
    const h = freshHarness();
    let other = null;
    if (hasSwitch(h)) { h.setScriptTimeZone('Asia/Yekaterinburg'); other = freshHarness().context.Session.getScriptTimeZone(); }
    check('100.10 R-070: setScriptTimeZone is per harness instance (a fresh harness is back on Europe/Moscow)',
      hasSwitch(h) && other === 'Europe/Moscow', JSON.stringify({ hasSwitch: hasSwitch(h), fresh: other }));
  }
  {
    const isDate = (v) => Object.prototype.toString.call(v) === '[object Date]';
    const appendRead = (mode, noFormat) => {
      const h = freshHarness();
      h.setSheetAutoDates(mode);
      const sheet = h.ensureTransSheet();
      if (noFormat) sheet.getRange(2, 1).setNumberFormat('@');
      sheet.appendRow(['2026-10-14 15:30:00']);
      return sheet.getRange(2, 1, 1, 1).getValues()[0][0];
    };
    const viaSetValues = (() => {
      const h = freshHarness();
      h.setSheetAutoDates('UTC');
      const sheet = h.ensureTransSheet();
      sheet.getRange(2, 1, 1, 1).setValues([['2026-10-14 15:30:00']]);
      return sheet.getRange(2, 1, 1, 1).getValues()[0][0];
    })();
    const auto = appendRead('UTC', false);
    check('100.10 R-070: appendRow of a yyyy-MM-dd HH:mm:ss text under setSheetAutoDates becomes a Date, like setValues',
      isDate(viaSetValues) && isDate(auto) && auto.getTime() === Date.parse('2026-10-14T15:30:00Z'),
      'appendRow gave ' + (isDate(auto) ? 'Date ' + auto.toISOString() : JSON.stringify(auto)));
    const plain = appendRead(null, false);
    check('100.10 R-070 control: appendRow keeps the text when setSheetAutoDates is off',
      plain === '2026-10-14 15:30:00', JSON.stringify(plain));
    const asText = appendRead('UTC', true);
    check("100.10 R-070 control: appendRow keeps the text in a cell already formatted '@' under setSheetAutoDates",
      asText === '2026-10-14 15:30:00', JSON.stringify(asText));
  }
  {
    const h = freshHarness();
    let got = null, err = '';
    if (hasSwitch(h)) {
      h.setScriptTimeZone('Asia/Yekaterinburg');
      const sheet = h.ensureTransSheet();
      const H = h.TRANS_HEADERS;
      const row = H.map(() => '');
      row[H.indexOf('ID')] = 'T-100-10';
      row[H.indexOf('Дата')] = new h.FakeDate(INSTANT);
      row[H.indexOf('Тип')] = 'Приход';
      row[H.indexOf('Артикул')] = 'A';
      sheet.__setData([H.slice(), row]);
      try { const r = h.getTransactions({}); got = r.rows && r.rows[0] && r.rows[0].date; } catch (e) { err = e.message; }
    }
    check('100.10 R-070: under setScriptTimeZone(Yekaterinburg) a «Транзакции» row with a Date cell is read back as the Yekaterinburg wall time ISO string',
      got === '2026-10-20T12:05:09', JSON.stringify({ hasSwitch: hasSwitch(h), got: got, err: err }));
  }
}

// ================= Итог =================
const total = results.length;
const failed = results.filter(r => !r.ok);
console.log('\n=== ИТОГО: ' + total + ' проверок, провалено: ' + failed.length + ' ===');
if (failed.length > 0) {
  console.log('Провалившиеся проверки:');
  failed.forEach(f => console.log(' - ' + f.name + ' :: ' + f.details));
  process.exitCode = 1;
} else {
  process.exitCode = 0;
}
