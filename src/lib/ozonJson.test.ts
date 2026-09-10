import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { parseOzonJson, quoteLossyIntegers } from './ozonJson';
import { buildCompositionXlsxBase64, readCargoIds } from './ozonComposition';

// ============================================================================================
// Длинные целые числа Ozon (10.09.2026, по боевому случаю прямой поставки 2000066179965).
//
// cargo_id у Ozon — int64. JSON.parse кладёт его в double, который держит целые точно только
// до 2^53 − 1 = 9 007 199 254 740 991. Девятнадцатизначный номер туда не влезает, и цифры
// пропадали ДО того, как их видел наш код.
// ============================================================================================

/** Номер грузоместа прямой поставки 2000066179965: 19 знаков, double его не держит. */
const DIRECT_CARGO = '1000000000058319036';
/** Номер грузоместа кросс-докинга 2000066179375: 16 знаков, ниже предела, портиться нечему. */
const CROSSDOCK_CARGO = '1022104706512000';

describe('quoteLossyIntegers', () => {
  it('боевой cargo_id прямой поставки переживает разбор целиком', () => {
    const raw = `{"cargo_id":${DIRECT_CARGO}}`;
    expect(parseOzonJson(raw).cargo_id).toBe(DIRECT_CARGO);
    // Ровно та потеря, которую видел владелец, — без правки.
    expect(String(JSON.parse(raw).cargo_id)).toBe('1000000000058319000');
  });

  it('короткий номер кросс-докинга остаётся ЧИСЛОМ: портиться нечему', () => {
    const parsed = parseOzonJson(`{"cargo_id":${CROSSDOCK_CARGO}}`);
    expect(parsed.cargo_id).toBe(1022104706512000);
    expect(typeof parsed.cargo_id).toBe('number');
  });

  it('граница ровно по 2^53 − 1: предел остаётся числом, предел плюс два — строкой', () => {
    const safe = String(Number.MAX_SAFE_INTEGER); // 9007199254740991
    expect(typeof parseOzonJson(`{"v":${safe}}`).v).toBe('number');
    // 2^53 + 1 не представимо, double округлит его вниз до 2^53.
    expect(parseOzonJson('{"v":9007199254740993}').v).toBe('9007199254740993');
  });

  it('цифры ВНУТРИ строки не трогаются: это текст, а не число', () => {
    const raw = `{"offer_id":"1000000000058319036","name":"Коробка 1000000000058319036 шт"}`;
    const parsed = parseOzonJson(raw);
    expect(parsed.offer_id).toBe(DIRECT_CARGO);
    expect(parsed.name).toBe('Коробка 1000000000058319036 шт');
    expect(quoteLossyIntegers(raw)).toBe(raw);
  });

  it('экранированная кавычка внутри строки не обрывает строку', () => {
    const raw = '{"name":"склад \\"РФЦ\\" 1000000000058319036","id":1000000000058319036}';
    const parsed = parseOzonJson(raw);
    expect(parsed.name).toBe('склад "РФЦ" 1000000000058319036');
    expect(parsed.id).toBe(DIRECT_CARGO);
  });

  it('обратный слэш в конце строки не съедает закрывающую кавычку', () => {
    const parsed = parseOzonJson('{"a":"путь\\\\","b":1000000000058319036}');
    expect(parsed.a).toBe('путь\\');
    expect(parsed.b).toBe(DIRECT_CARGO);
  });

  it('экранированная кавычка ПЕРЕД длинным числом внутри строки не открывает число', () => {
    // Проверка добавлена 10.09.2026: две прежние проверки экранирования пережили мутацию.
    // В обеих строка всё равно закрывалась в том же месте, и разбор совпадал случайно.
    // Здесь же неверный разбор уводит число ИЗ строки наружу, обрамляет его кавычками
    // и рвёт JSON — расхождение становится видимым.
    const raw = '{"a":"\\"1000000000058319036"}';
    expect(parseOzonJson(raw).a).toBe('"' + DIRECT_CARGO);
    expect(quoteLossyIntegers(raw)).toBe(raw);
  });

  it('дробные и экспоненциальные числа не трогаются никогда', () => {
    const parsed = parseOzonJson('{"a":1000000000058319036.5,"b":1e19,"c":1.5E+20,"d":-2.25}');
    expect(typeof parsed.a).toBe('number');
    expect(typeof parsed.b).toBe('number');
    expect(typeof parsed.c).toBe('number');
    expect(parsed.d).toBe(-2.25);
  });

  it('отрицательное длинное целое тоже сохраняется', () => {
    expect(parseOzonJson('{"v":-1000000000058319036}').v).toBe('-1000000000058319036');
  });

  it('«минус ноль» остаётся числом: это не потеря точности', () => {
    const parsed = parseOzonJson('{"v":-0,"w":0}');
    expect(typeof parsed.v).toBe('number');
    expect(typeof parsed.w).toBe('number');
  });

  it('массивы и вложенность: номер достаётся с любой глубины', () => {
    const raw = `{"result":{"cargoes":[{"key":"box-1","value":{"cargo_id":${DIRECT_CARGO}}}]}}`;
    expect(parseOzonJson(raw).result.cargoes[0].value.cargo_id).toBe(DIRECT_CARGO);
  });

  it('обычный ответ без длинных чисел не меняется ни на байт', () => {
    const raw = '{"status":"SUCCESS","supply_id":2000066179965,"draft_id":120214369,"ok":true,"none":null}';
    expect(quoteLossyIntegers(raw)).toBe(raw);
    expect(parseOzonJson(raw).supply_id).toBe(2000066179965);
  });

  it('битый ответ падает так же громко, как падал res.json()', () => {
    expect(() => parseOzonJson('не json')).toThrow();
  });

  it('одинокий минус не превращается в строку и не чинит битый ответ молча', () => {
    // Проверка добавлена 10.09.2026: прежние проверки пережили мутацию, снимавшую условие
    // «за минусом обязана идти цифра». Одинокий минус встречается только в БИТОМ ответе,
    // и обрамление его кавычками сделало бы такой ответ разбираемым — ошибка Ozon стала бы
    // молчаливой вместо громкой.
    expect(quoteLossyIntegers('{"a":-}')).toBe('{"a":-}');
    expect(() => parseOzonJson('{"a":-}')).toThrow();
  });
});

// ---- Весь путь целиком: правка в разборе бесполезна, если номер теряется дальше по дороге.
// Проверка идёт от СЫРОГО текста ответа Ozon до ячейки файла, который уезжает на Google Диск.
describe('весь путь: ответ Ozon → ячейка «ШК ГМ» файла состава', () => {
  const rawCreateInfo = (cargoId: string) => JSON.stringify({
    status: 'SUCCESS',
    result: { cargoes: [{ key: 'box-1', value: { cargo_id: '@@ID@@' } }] }
  }).replace('"@@ID@@"', cargoId);

  const boxes = [{
    key: 'box-1',
    items: [{ barcode: 'OZN4498013867', offerId: 'Миска_двойная', quantity: 21 }]
  }];
  const zones = { OZN4498013867: 'SORT' };

  /** Читает готовый файл так же, как его прочитает Excel: значение и ТИП ячейки. */
  function cellOfComposition(cargoId: string) {
    const info = parseOzonJson(rawCreateInfo(cargoId));
    const base64 = buildCompositionXlsxBase64(boxes, readCargoIds(info.result), zones);
    const wb = XLSX.read(base64, { type: 'base64' });
    const ws = wb.Sheets['Состав ГМ поставки'];
    return ws['F2']; // колонка «ШК ГМ», первая строка данных
  }

  it('прямая поставка: в ячейке все 19 цифр, как на этикетке Ozon', () => {
    expect(cellOfComposition(DIRECT_CARGO).v).toBe(DIRECT_CARGO);
  });

  it('кросс-докинг: номер тоже доезжает без изменений', () => {
    expect(cellOfComposition(CROSSDOCK_CARGO).v).toBe(CROSSDOCK_CARGO);
  });

  it('ячейка «ШК ГМ» — ТЕКСТ, иначе Excel округлит номер сам', () => {
    // 's' — строковая ячейка. В числовой ячейке xlsx хранит double, и 19 цифр туда не влезут:
    // файл снова стал бы неверным, причём в коде всё выглядело бы правильно.
    expect(cellOfComposition(DIRECT_CARGO).t).toBe('s');
  });

  it('заголовок и остальные колонки на месте, порядок не поехал', () => {
    const info = parseOzonJson(rawCreateInfo(DIRECT_CARGO));
    const base64 = buildCompositionXlsxBase64(boxes, readCargoIds(info.result), zones);
    const ws = XLSX.read(base64, { type: 'base64' }).Sheets['Состав ГМ поставки'];
    expect(ws['A1'].v).toBe('ШК товара');
    expect(ws['F1'].v).toBe('ШК ГМ');
    expect(ws['A2'].v).toBe('OZN4498013867');
    expect(ws['B2'].v).toBe('Миска_двойная');
    expect(ws['C2'].v).toBe(21);
    expect(ws['D2'].v).toBe('Сортируемый товар');
    expect(ws['G2'].v).toBe('Коробка');
  });

  it('коробка без номера от Ozon даёт пустую ячейку, а не «undefined»', () => {
    const base64 = buildCompositionXlsxBase64(boxes, {}, zones);
    const ws = XLSX.read(base64, { type: 'base64' }).Sheets['Состав ГМ поставки'];
    expect(ws['F2'].v).toBe('');
  });

  it('сопоставление идёт по key, а не по порядку: Ozon присылает как хочет', () => {
    const info = parseOzonJson(JSON.stringify({
      cargoes: [
        { key: 'box-2', value: { cargo_id: '@@B@@' } },
        { key: 'box-1', value: { cargo_id: '@@A@@' } }
      ]
    }).replace('"@@B@@"', '1000000000058319037').replace('"@@A@@"', DIRECT_CARGO));
    const byKey = readCargoIds(info);
    expect(byKey['box-1']).toBe(DIRECT_CARGO);
    expect(byKey['box-2']).toBe('1000000000058319037');
  });
});

// ---- Сторожа над прокси: разбор ответа Ozon должен быть в ОДНОМ месте и без исключений.
describe('прокси разбирает ответы Ozon только через parseOzonJson', () => {
  const server = fs.readFileSync(path.join(process.cwd(), 'server.ts'), 'utf8');

  it('прямых вызовов .json() по ответу Ozon не осталось ни одного', () => {
    expect(server).not.toMatch(/await\s+\w*[Rr]es\.json\(\)/);
    expect(server).not.toMatch(/return\s+res\.json\(\);/);
  });

  it('оба места читают текст и разбирают его безопасно', () => {
    const safe = server.match(/parseOzonJson\(await \w+\.text\(\)\)/g) || [];
    expect(safe).toHaveLength(2);
  });

  it('сборка файла и чтение номеров взяты из модуля, а не продублированы в прокси', () => {
    expect(server).toMatch(/import \{ buildCompositionXlsxBase64, readCargoIds \} from "\.\/src\/lib\/ozonComposition"/);
    expect(server).not.toContain('XLSX.utils.aoa_to_sheet');
    expect(server).not.toContain("String(c?.value?.cargo_id");
  });
});
