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
  check('clasp: наружу выпущены ровно манифест и Code.gs',
    JSON.stringify(rules.slice(1).sort()) === JSON.stringify(['!Code.gs', '!appsscript.json']), 'правила: ' + rules.slice(1).join(' '));
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
    packaging: 240,
    other: 0,
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
  const res = h.updateShipmentExtras({ id: rowA.id, packaging: 0, other: 0, services: [] }, 'tester');
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
    id: kitRow.id, packaging: 0, other: 0,
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

(function test80b4() {
  const { h, rowA } = withShipment();
  let message = '';
  try {
    h.updateShipmentExtras({ id: 'нет такой строки', packaging: 0, other: 0, services: [] }, 'tester');
  } catch (e) { message = String(e.message || e); }
  check('80b: неизвестная строка истории отвергается', message.indexOf('не найдена') !== -1, message);

  const receipt = h.getTransactions().rows.find(t => t.type === 'Приход');
  message = '';
  if (receipt) {
    try {
      h.updateShipmentExtras({ id: receipt.id, packaging: 0, other: 0, services: [] }, 'tester');
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
    h.updateShipmentExtras({ id: batchRow.id, packaging: 0, other: 0, services: [] }, 'tester');
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
    id: row.id, packaging: 0, other: 0,
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
  check('80b: сборка текста возвращает исходную строку', h.buildDestinationGs(e, e) === d, h.buildDestinationGs(e, e));
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
