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
function makeFakeSheet(headers) {
  // data[0] всегда заголовки; строки 1.. — данные (может быть пусто).
  let data = [headers.slice()];
  return {
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
    getRange(startRow, startCol, numRows, numCols) {
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
          for (let r = 0; r < values.length; r++) {
            const rowIdx = startRow - 1 + r;
            while (data.length <= rowIdx) data.push([]);
            for (let c = 0; c < values[r].length; c++) {
              const colIdx = startCol - 1 + c;
              data[rowIdx][colIdx] = values[r][c];
            }
          }
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
    __setData(d) { data = d.map(r => r.slice()); }
  };
}

// ---------- Сборка контекста vm ----------
const sandbox = {
  console,
  Utilities: {
    formatDate: (date, tz, fmt) => formatDateImpl(date, tz, fmt)
  },
  Session: {
    getScriptTimeZone: () => 'Europe/Moscow'
  },
  Logger: {
    log: (msg) => { logs.push(String(msg)); }
  },
  Date: FakeDate
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
  vm
};
