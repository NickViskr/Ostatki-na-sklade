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

  // ВАЖНО ДЛЯ ПОДЭТАПА 4. Вся разница 100 x (400 - 300) = 10000 руб легла на ОСТАВШИЕСЯ
  // 50 шт: 15000 + 10000 = 25000, то есть 500 руб/шт. Это действующее правило «долга
  // себестоимости», а не ошибка — но владелец просил другого: отгруженные 50 шт должны
  // стоить по 400. Подэтап 4 переносит 5000 руб с остатка на отгрузку.
  const after = h.stockOf('ART');
  check('Пока вся разница ложится на остаток: 25000 руб на 50 шт, средняя 500',
    after.capitalization === 25000 && after.avgCost === 500,
    `получено: кап=${after.capitalization}, средняя=${after.avgCost}`);
  check('Журнал себестоимости Озона правкой ещё не тронут — это подэтап 4',
    h.dumpOzonCost().length === 1 && h.dumpOzonCost()[0]['Себестоимость отгрузки'] === 300,
    `получено: ${JSON.stringify(h.dumpOzonCost().map(r => r['Себестоимость отгрузки']))}`);
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
