'use strict';

const results = [];
function check(name, condition, details) {
  results.push({ name, ok: !!condition, details });
  console.log((condition ? 'OK    ' : 'ПРОВАЛ') + '  ' + name + (details ? ('  -- ' + details) : ''));
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
(function test6() {
  const h = freshHarness();
  const stockHeaders = h.OZON_STOCKS_HEADERS;
  const H = h.OZON_STOCK_HISTORY_HEADERS;

  // Настройка retention=2 недели, а не дефолт 15 -- чтобы доказать что настройка реально читается.
  h.setRetentionWeeks(2);
  h.setNow('2026-06-01T09:00:00Z'); // понедельник, текущая неделя

  // Определим понедельник текущей недели через сам стенд (используя getIsoWeekMonday из Code.gs).
  const todayStr = h.context.Utilities.formatDate(new h.context.Date(), 'Europe/Moscow', 'yyyy-MM-dd');
  const curMonday = h.context.getIsoWeekMonday(todayStr);
  // "Заведомо старше срока" (20 недель назад) -- генерическая проверка удаления вообще.
  const veryOldWeek = h.context.shiftIsoWeek(curMonday, -20);
  // 5 недель назад: при retention=2 (oldestKept = curMonday-1 неделя) должна быть УДАЛЕНА,
  // а при дефолтном retention=15 (oldestKept = curMonday-14 недель) была бы СОХРАНЕНА.
  // Это и доказывает, что применяется именно настройка 2, а не жёстко зашитые 15.
  const midOldWeek = h.context.shiftIsoWeek(curMonday, -5);

  function makeOldRow(week, article) {
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
  h.setHistoryRaw([makeOldRow(veryOldWeek, 'ARTVERYOLD'), makeOldRow(midOldWeek, 'ARTMIDOLD')]);

  const combos = [
    { cabinet: 'Cab1', article: 'ART1', clusterId: 'CL1', clusterName: 'Центр', warehouses: [{ warehouse: 'W1', available: 5, transit: 0 }] }
  ];
  const rows = buildFinalRows(stockHeaders, combos);
  h.updateOzonStockHistory(rows, stockHeaders);

  const hist = h.dumpHistory();
  const veryOldStill = hist.find(r => r[H.indexOf('Артикул')] === 'ARTVERYOLD');
  const midOldStill = hist.find(r => r[H.indexOf('Артикул')] === 'ARTMIDOLD');
  const curRow = hist.find(r => r[H.indexOf('Артикул')] === 'ART1');

  check('П6: заведомо старая строка (20 недель назад) удалена', !veryOldStill, `осталась ли строка ARTVERYOLD: ${!!veryOldStill}`);
  check('П6: текущая неделя на месте', !!curRow, `curRow найден: ${!!curRow}`);
  check('П6: настройка stockHistoryRetentionWeeks=2 реально применяется (не дефолт 15)', !midOldStill,
    `строка 5 недель назад (${midOldWeek}) при retention=2 должна быть удалена, а при дефолте 15 -- сохранена; осталась: ${!!midOldStill}`);

  // Контрольный прогон: та же строка 5-недельной давности при ДЕФОЛТНОМ retention (15) должна СОХРАНИТЬСЯ.
  // Доказывает, что удаление в основном прогоне вызвано именно значением настройки 2, а не постоянной 15.
  const h2 = freshHarness();
  h2.setNow('2026-06-01T09:00:00Z'); // без setRetentionWeeks -- остаётся дефолт 15
  h2.setHistoryRaw([makeOldRow(midOldWeek, 'ARTMIDOLD')]);
  h2.updateOzonStockHistory(buildFinalRows(h2.OZON_STOCKS_HEADERS, combos), h2.OZON_STOCKS_HEADERS);
  const hist2 = h2.dumpHistory();
  const midOldKeptAtDefault = hist2.find(r => r[H.indexOf('Артикул')] === 'ARTMIDOLD');
  check('П6 (контроль): при дефолтном retention=15 та же строка 5 недель назад СОХРАНЕНА', !!midOldKeptAtDefault,
    `осталась ли строка ARTMIDOLD при дефолте: ${!!midOldKeptAtDefault}`);
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

  // Ряд недельных строк на 20 понедельников назад от текущего.
  const mondays = [];
  for (let i = 0; i < 21; i++) {
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

  check('П71: без явного окна getOzonSales берёт его из настроек (13 тренд + 2 запаса = 15 полных недель)',
    fullAuto.length === 15, `получено полных недель: ${fullAuto.length} (${autoWeeks.length} всего, с ${autoWeeks[0]})`);
  check('П71: текущая незавершённая неделя тоже отдаётся, но НЕ занимает место полной',
    autoWeeks.indexOf(current) !== -1 && autoWeeks.length === 16,
    `недель всего: ${autoWeeks.length}`);

  // Рост настройки должен сразу расширять окно — раньше он упирался в число на клиенте.
  H.setOzonSettings({ trendWeeks: 18, speedWeeks: 4 });
  const wider = H.getOzonSales();
  const widerFull = Array.from(new Set(wider.map(r => r.week))).filter(w => w < current);
  check('П72: увеличение настройки «Окно тренда» сразу расширяет окно выдачи',
    widerFull.length === 20, `получено полных недель: ${widerFull.length}`);

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
// Weekly zone is 13 weeks; anything older is compacted into 28-day blocks. Before this change both
// zones lived in one sheet, and getOzonSales read all of it on every start-up: 1805 of 3194 rows
// were archive rows the date window always discards.
(() => {
  const H = freshHarness();
  H.setNow('2026-01-05T09:00:00Z');           // понедельник 05.01.2026
  H.setOzonSettings({ salesRetentionWeeks: 78 });

  // Свежая неделя остаётся недельной; 2025-09-08 старше границы уплотнения и уходит в блок.
  H.setOzonSalesSheet([
    { week: '2025-12-29', offerId: 'ART', qty: 10, days: 7 },
    { week: '2025-09-08', offerId: 'ART', qty: 5, days: 7 }
  ]);
  H.setOzonSalesArchiveSheet([]);
  H.saveOzonSales({ rows: [], okCabinets: [], mode: 'recent', replacedWeeks: [] });

  const weekly = H.dumpSalesSheet('Продажи Ozon');
  const archive = H.dumpSalesSheet('Продажи Ozon Архив');

  check('П75: недельные строки остались в основном листе',
    weekly.length === 1 && weekly[0].week === '2025-12-29' && weekly[0].qty === 10,
    `получено: ${JSON.stringify(weekly)}`);
  check('П75: в основном листе НЕТ 28-дневных блоков — их и читал зря старт приложения',
    weekly.every(r => r.days === 7), `получено: ${JSON.stringify(weekly.map(r => r.days))}`);
  check('П75: уплотнённый блок ушёл в архивный лист',
    archive.length === 1 && archive[0].days === 28 && archive[0].qty === 5,
    `получено: ${JSON.stringify(archive)}`);

  // Второй прогон: старый блок уже лежит в архивном листе и должен быть подхвачен, а не потерян.
  const H2 = freshHarness();
  H2.setNow('2026-01-05T09:00:00Z');
  H2.setOzonSettings({ salesRetentionWeeks: 78 });
  H2.setOzonSalesSheet([{ week: '2025-12-29', offerId: 'ART', qty: 10, days: 7 }]);
  H2.setOzonSalesArchiveSheet([{ week: '2025-09-08', offerId: 'ART', qty: 100, days: 28 }]);
  H2.saveOzonSales({ rows: [], okCabinets: [], mode: 'recent', replacedWeeks: [] });
  const arch2 = H2.dumpSalesSheet('Продажи Ozon Архив');
  check('П76: существующий архивный блок прочитан и сохранён, а не потерян',
    arch2.length === 1 && arch2[0].qty === 100, `получено: ${JSON.stringify(arch2)}`);

  // Третий прогон: строка из основного листа доливается в УЖЕ существующий блок того же периода.
  const H3 = freshHarness();
  H3.setNow('2026-01-05T09:00:00Z');
  H3.setOzonSettings({ salesRetentionWeeks: 78 });
  H3.setOzonSalesSheet([{ week: '2025-09-15', offerId: 'ART', qty: 7, days: 7 }]);
  H3.setOzonSalesArchiveSheet([{ week: '2025-09-08', offerId: 'ART', qty: 100, days: 28 }]);
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
})();

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
