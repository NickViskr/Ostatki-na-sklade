// Стенд для проверки updateOzonStockHistory() из боевого Code.gs без Apps Script.
// Code.gs НЕ модифицируется, только читается.
'use strict';

const fs = require('fs');
const vm = require('vm');
const path = require('path');

const CODE_GS_PATH = path.join(__dirname, '..', '..', 'Code.gs');
const src = fs.readFileSync(CODE_GS_PATH, 'utf8');

// ---------- Утилиты форматирования дат (ручной расчёт, без сторонних библиотек) ----------
function pad(n) { return String(n).padStart(2, '0'); }

function tzOffsetMs(tz) {
  if (tz === 'Europe/Moscow') return 3 * 3600 * 1000; // UTC+3, без учёта DST
  if (tz === 'UTC') return 0;
  throw new Error('Неподдерживаемая таймзона в стенде: ' + tz);
}

function formatDateImpl(date, tz, fmt) {
  const shifted = new Date(date.getTime() + tzOffsetMs(tz));
  const yyyy = shifted.getUTCFullYear();
  const MM = pad(shifted.getUTCMonth() + 1);
  const dd = pad(shifted.getUTCDate());
  if (fmt === 'yyyy-MM-dd') return `${yyyy}-${MM}-${dd}`;
  if (fmt === 'yyyy-MM-dd HH:mm:ss') {
    const HH = pad(shifted.getUTCHours());
    const mm = pad(shifted.getUTCMinutes());
    const ss = pad(shifted.getUTCSeconds());
    return `${yyyy}-${MM}-${dd} ${HH}:${mm}:${ss}`;
  }
  throw new Error('Неподдерживаемый формат в стенде: ' + fmt);
}

// ---------- Подменный класс Date: без аргументов возвращает фиксированное "сейчас" ----------
class FakeDate extends Date {
  constructor(...args) {
    if (args.length === 0) {
      super(FakeDate.__now);
    } else {
      super(...args);
    }
  }
  static now() {
    return FakeDate.__now;
  }
}
FakeDate.__now = Date.parse('2026-01-05T09:00:00Z'); // понедельник, 09:00 UTC -> 12:00 МСК

// ---------- Логи ----------
const logs = [];

// ---------- Фальшивый лист (мини-модель Google Sheets) ----------
// name — необязательное имя листа (для getName(), нужно getSheetByNameRobust из Code.gs,
// которая ищет лист перебором ss.getSheets(), а не по прямому ключу).
function makeFakeSheet(headers, name) {
  // data[0] всегда заголовки; строки 1.. — данные (может быть пусто).
  let data = [headers.slice()];
  let setValuesCallCount = 0; // сервисный счётчик стенда: сколько раз реально вызвали setValues на этом листе
  return {
    getName() { return name; },
    appendRow(row) {
      data.push(row.slice());
    },
    setFrozenRows() { /* нет визуального представления в стенде — заглушка */ },
    getLastRow() {
      for (let i = data.length - 1; i >= 0; i--) {
        const row = data[i];
        if (row && row.some(v => String(v).trim() !== '')) return i + 1; // 1-based
      }
      return 0;
    },
    getLastColumn() {
      return data[0] ? data[0].length : headers.length;
    },
    getDataRange() {
      const lastRow = Math.max(this.getLastRow(), 1);
      return this.getRange(1, 1, lastRow, this.getLastColumn());
    },
    getRange(startRow, startCol, numRows, numCols) {
      if (numRows === undefined) numRows = 1;
      if (numCols === undefined) numCols = 1;
      return {
        getValues() {
          const result = [];
          for (let r = 0; r < numRows; r++) {
            const rowIdx = startRow - 1 + r;
            const existing = data[rowIdx] || [];
            const rowArr = [];
            for (let c = 0; c < numCols; c++) {
              const colIdx = startCol - 1 + c;
              const v = existing[colIdx];
              rowArr.push(v === undefined ? '' : v);
            }
            result.push(rowArr);
          }
          return result;
        },
        setValues(values) {
          setValuesCallCount++;
          for (let r = 0; r < values.length; r++) {
            const rowIdx = startRow - 1 + r;
            while (data.length <= rowIdx) data.push([]);
            for (let c = 0; c < values[r].length; c++) {
              const colIdx = startCol - 1 + c;
              data[rowIdx][colIdx] = values[r][c];
            }
          }
        },
        setValue(value) {
          const rowIdx = startRow - 1;
          while (data.length <= rowIdx) data.push([]);
          data[rowIdx][startCol - 1] = value;
        },
        clearContent() {
          for (let r = 0; r < numRows; r++) {
            const rowIdx = startRow - 1 + r;
            if (data[rowIdx]) {
              for (let c = 0; c < numCols; c++) {
                const colIdx = startCol - 1 + c;
                data[rowIdx][colIdx] = '';
              }
            }
          }
        }
      };
    },
    // сервисные методы стенда (не часть Apps Script API)
    __dump() { return data.map(r => r.slice()); },
    __setData(d) { data = d.map(r => r.slice()); },
    __getSetValuesCallCount() { return setValuesCallCount; },
    __resetSetValuesCallCount() { setValuesCallCount = 0; }
  };
}

// ---------- UUID для Utilities.getUuid: детерминированный счётчик, сбрасывается при каждом freshHarness() ----------
let uuidCounter = 0;

// ---------- Реестр «прочих» листов (Остатки, Транзакции, Комплекты и т.п.) ----------
// SKU-лист исторически хранится в отдельной переменной skuSheet (см. ниже) — оставляем
// как есть ради обратной совместимости с уже существующими 42 проверками.
const sheetRegistry = {};

// ---------- Сборка контекста vm ----------
const sandbox = {
  console,
  Utilities: {
    formatDate: (date, tz, fmt) => formatDateImpl(date, tz, fmt),
    getUuid: () => 'uuid-' + (++uuidCounter)
  },
  Session: {
    getScriptTimeZone: () => 'Europe/Moscow'
  },
  Logger: {
    log: (msg) => { logs.push(String(msg)); }
  },
  Date: FakeDate,
  SpreadsheetApp: {
    getActiveSpreadsheet: () => ({
      getSheetByName: (name) => (name === 'SKU' ? skuSheet : (sheetRegistry[name] || null)),
      getSheets: () => {
        const all = [];
        if (skuSheet) all.push(skuSheet);
        Object.keys(sheetRegistry).forEach(k => all.push(sheetRegistry[k]));
        return all;
      },
      insertSheet: (name) => {
        const sheet = makeFakeSheet([], name);
        sheetRegistry[name] = sheet;
        return sheet;
      }
    }),
    flush: () => { /* нет очереди отложенной записи в стенде — заглушка */ }
  }
};
const context = vm.createContext(sandbox);

// Выполняем весь Code.gs как скрипт в контексте: функции объявляются (hoisted) и
// автоматически становятся свойствами контекста, top-level константы (массивы
// заголовков, дефолты настроек и т.п.) вычисляются, но НЕ становятся свойствами
// контекста (const/let не "утекают" в global object) — поэтому в конец файла
// добавляем строку, которая явно прокидывает нужные константы наружу.
// Тела функций при загрузке файла не вызываются — только объявляются.
const exportLine = `
;this.OZON_STOCK_HISTORY_HEADERS = OZON_STOCK_HISTORY_HEADERS;
this.OZON_STOCKS_HEADERS = OZON_STOCKS_HEADERS;
this.OZON_SALES_HEADERS = OZON_SALES_HEADERS;
`;
vm.runInContext(src + exportLine, context, { filename: 'Code.gs' });

// ---------- Заглушки настроек и листа истории, подставляемые ПОСЛЕ загрузки файла ----------
let ozonSettingsStore = { stockHistoryRetentionWeeks: 15 };
context.getOzonSettings = function () {
  return Object.assign({}, ozonSettingsStore);
};

let historySheet = makeFakeSheet(context.OZON_STOCK_HISTORY_HEADERS);
context.getOzonStockHistorySheet = function () {
  return historySheet;
};

// ---------- Фальшивый лист SKU: по умолчанию отсутствует (null), пока тест его не создаст ----------
let skuSheet = null;

// ---------- Экспортируемые для теста хелперы ----------
module.exports = {
  context,
  FakeDate,
  logs,
  setNow(isoUtc) { FakeDate.__now = Date.parse(isoUtc); },
  setRetentionWeeks(n) { ozonSettingsStore.stockHistoryRetentionWeeks = n; },
  resetHistorySheet() { historySheet = makeFakeSheet(context.OZON_STOCK_HISTORY_HEADERS); },
  getHistorySheet() { return historySheet; },
  setHistoryRaw(rows) {
    // rows — массив массивов данных (без заголовка), напрямую кладём в лист как "как если бы записали руками".
    const headers = context.OZON_STOCK_HISTORY_HEADERS;
    historySheet.__setData([headers.slice(), ...rows]);
  },
  dumpHistory() {
    const headers = context.OZON_STOCK_HISTORY_HEADERS;
    const data = historySheet.__dump();
    const lastRow = historySheet.getLastRow();
    return data.slice(1, Math.max(lastRow, 1)).filter(r => r.some(v => String(v).trim() !== ''));
  },
  OZON_STOCKS_HEADERS: context.OZON_STOCKS_HEADERS,
  OZON_STOCK_HISTORY_HEADERS: context.OZON_STOCK_HISTORY_HEADERS,
  updateOzonStockHistory: (...args) => context.updateOzonStockHistory(...args),
  // rows — массив массивов данных (без заголовка) листа SKU; headers — заголовки листа.
  setSkuSheet(headers, rows) {
    skuSheet = makeFakeSheet(headers);
    if (rows && rows.length > 0) skuSheet.__setData([headers.slice(), ...rows]);
  },
  clearSkuSheet() { skuSheet = null; },
  getSkuSheet() { return skuSheet; },
  dumpSkuSheet() {
    if (!skuSheet) return null;
    const data = skuSheet.__dump();
    const lastRow = skuSheet.getLastRow();
    return { headers: data[0].slice(), rows: data.slice(1, Math.max(lastRow, 1)) };
  },
  updateSkuNamesFromOzonStocks: (...args) => context.updateSkuNamesFromOzonStocks(...args),

  // ---------- Хелперы для commitTransaction (Пункт 40, этап B: долг себестоимости) ----------
  // Заголовки листа "Остатки" и "Транзакции" — как в setupDatabase() из Code.gs.
  STOCK_HEADERS: ['Артикул', 'Количество на складе', 'Средняя себестоимость', 'Капитализация', 'Продажи за 120д', 'Оборачиваемость (дн)'],
  TRANS_HEADERS: ['ID', 'Дата', 'Тип', 'Артикул', 'Количество', 'Цена', 'Себестоимость списания', 'Сумма', 'Объект', 'Дата поставки', 'Пользователь'],
  KIT_HEADERS: ['kitSku', 'componentSku', 'quantity', 'kitType'],
  // items — массив {article, quantity, avgCost, capitalization, sales120?, turnover?}
  setStockSheet(items) {
    const headers = this.STOCK_HEADERS;
    const rows = items.map(it => [it.article, it.quantity, it.avgCost, it.capitalization, it.sales120 || 0, it.turnover || 0]);
    const sheet = makeFakeSheet(headers, 'Остатки');
    if (rows.length > 0) sheet.__setData([headers.slice(), ...rows]);
    sheetRegistry['Остатки'] = sheet;
    return sheet;
  },
  dumpStockSheet() {
    const sheet = sheetRegistry['Остатки'];
    if (!sheet) return null;
    const data = sheet.__dump();
    const lastRow = sheet.getLastRow();
    return { headers: data[0].slice(), rows: data.slice(1, Math.max(lastRow, 1)) };
  },
  // Лист "Транзакции" обязателен для commitTransaction: без него код падает на transSheet.getLastRow().
  ensureTransSheet() {
    if (!sheetRegistry['Транзакции']) {
      sheetRegistry['Транзакции'] = makeFakeSheet(this.TRANS_HEADERS, 'Транзакции');
    }
    return sheetRegistry['Транзакции'];
  },
  // items — массив {kitSku, componentSku, quantity, kitType} ('legacy' | 'virtual')
  setKitSheet(items) {
    const headers = this.KIT_HEADERS;
    const rows = items.map(it => [it.kitSku, it.componentSku, it.quantity, it.kitType]);
    const sheet = makeFakeSheet(headers, 'Комплекты');
    if (rows.length > 0) sheet.__setData([headers.slice(), ...rows]);
    sheetRegistry['Комплекты'] = sheet;
    return sheet;
  },
  commitTransaction: (...args) => context.commitTransaction(...args),
  // Item 56, stage 2: needed to prove the additional costs survive a round trip through the sheet.
  getTransactions: (...args) => context.getTransactions(...args),

  // ---------- Хелперы для getOzonSales (пункт 22, этап I: окно недель) ----------
  OZON_SALES_HEADERS: context.OZON_SALES_HEADERS,
  // Подменяет весь набор настроек Ozon целиком: getOzonSales читает из него окно,
  // когда вызывающая сторона своё не передала.
  setOzonSettings(obj) { ozonSettingsStore = Object.assign({}, obj); },
  // rows — массив {week, cabinet, offerId, clusterName, qty, updatedAt, days}
  setOzonSalesSheet(rows) {
    const headers = context.OZON_SALES_HEADERS;
    const data = rows.map(r => [r.week, r.cabinet || 'Mercurius', r.offerId, r.clusterName || 'Екатеринбург',
      r.qty, r.updatedAt || '2026-01-05 12:00:00', r.days]);
    const sheet = makeFakeSheet(headers, 'Продажи Ozon');
    if (data.length > 0) sheet.__setData([headers.slice(), ...data]);
    sheetRegistry['Продажи Ozon'] = sheet;
    return sheet;
  },
  getOzonSales: (...args) => context.getOzonSales(...args),

  // ---------- Хелперы для saveOzonSales (item 26: split of the sales sheet) ----------
  setOzonSalesArchiveSheet(rows) {
    const headers = context.OZON_SALES_HEADERS;
    const data = (rows || []).map(r => [r.week, r.cabinet || 'Mercurius', r.offerId, r.clusterName || 'Екатеринбург',
      r.qty, r.updatedAt || '2026-01-05 12:00:00', r.days]);
    const sheet = makeFakeSheet(headers, 'Продажи Ozon Архив');
    if (data.length > 0) sheet.__setData([headers.slice(), ...data]);
    sheetRegistry['Продажи Ozon Архив'] = sheet;
    return sheet;
  },
  dumpSalesSheet(name) {
    const sheet = sheetRegistry[name];
    if (!sheet) return null;
    const data = sheet.__dump();
    const lastRow = sheet.getLastRow();
    return data.slice(1, Math.max(lastRow, 1)).filter(r => r.some(v => String(v).trim() !== ''))
      .map(r => ({ week: String(r[0]), cabinet: String(r[1]), offerId: String(r[2]),
                   cluster: String(r[3]), qty: Number(r[4]), days: Number(r[6]) }));
  },
  saveOzonSales: (...args) => context.saveOzonSales(...args),
  vm
};
