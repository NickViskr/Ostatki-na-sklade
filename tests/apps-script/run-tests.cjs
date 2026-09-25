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
    check('Стоимость остатков: повтор перезаписывает значение', dump[1][1] === 1200 && res.replaced === true, 'B=' + dump[1][1]);
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
    check('Стоимость остатков: день узнаётся и в формате ДД.ММ.ГГГГ, строка не задваивается', dump.length === 2 && dump[1][1] === 7, JSON.stringify(dump));
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
  const proxy = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'server.ts'), 'utf8');
  check('78a: прокси знает getTurnoverData как чтение с кэшем Ozon', /'getTurnoverData',/.test(proxy) && /'getOzonInitialData', 'getTurnoverData'\]\.includes\(action\)/.test(proxy));
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
    batchHead[batchHead.length - 1] === 'Проверка: детали',
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
  check('81g-1: the revision\'s own movement is the 1000 ¥ that moved, not measured against itself',
    revisedMovements.length === 2 &&
    revisedMovements.some(function (r) { return r['Номер заказа'] === '29' && r['Изменение ¥'] === -1000; }) &&
    revisedMovements.some(function (r) { return r['Номер заказа'] === '30' && r['Изменение ¥'] === 1000; }),
    JSON.stringify(revisedMovements));
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

// ---- 83d: status «Прибыла» -> received, and a status taken back reopens the row ----
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
  check('83d: «Прибыла» marks the row received, with the arrival date',
    row['Статус'] === 'received' && row['Дата получения'] === '2026-09-25', JSON.stringify(row));

  // Status taken back (owner corrects a mistaken «Прибыла») -> the row reopens.
  h.saveChinaBatch({ id: batchId, orderNo: '42', code: 'NV-0902-1', status: 'В пути',
    shippedAt: '2026-09-01',
    lines: [{ marking: 'M1', boxes: 1, pcsPerBox: 10, qty: 10, priceCny: 5, article: article }]
  }, 'Николай');
  row = byKeySuffix(h.dumpFactoryOrders(), ':' + article)[0];
  check('83d: a status taken back reopens the row — active again, no received date',
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
  // still 'active', not 'checked'). Before the fix this un-hid the manual row and the pipeline
  // read 50: the goods were counted as received stock AND as the still-open manual order.
  const batchId = h.getChinaBatches().batches.filter(function (b) { return b.orderNo === '29'; })[0].id;
  h.saveChinaBatch({
    id: batchId, orderNo: '29', code: 'NV-0916-24', status: 'Прибыла',
    shippedAt: '2026-09-16', arrivedAt: '2026-09-24',
    lines: [{ marking: 'MD1', boxes: 1, pcsPerBox: 80, qty: 80, priceCny: 5, article: article }]
  }, 'Николай');
  today = h.factoryPipelineQtyByArticleGs(h.getFactoryOrders(), '2026-09-25');
  check("owner's case, conflict NOT resolved: after «Прибыла» the pipeline reads 0, not 50 — no double count on arrival",
    today[article] === undefined || today[article] === 0, JSON.stringify(today));

  // The owner can still close the manual row as the same order even after arrival.
  h.resolveFactoryOrderConflict({ id: manual.id, same: true }, 'Николай');
  today = h.factoryPipelineQtyByArticleGs(h.getFactoryOrders(), '2026-09-25');
  check("owner's case: resolving the conflict after arrival still reads 0 (the manual row is now 'replaced')",
    today[article] === undefined || today[article] === 0, JSON.stringify(today));
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
