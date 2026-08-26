import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildKanCostCsv,
  KAN_COST_CSV_HEADER,
  KanCostRow,
  kanCostFileName,
  normaliseKanDate,
} from './kanCostExport';

/** Как файл видит разборщик: снимаем BOM и режем по CRLF. */
const linesOf = (csv: string): string[] => csv.replace(/^\uFEFF/, '').split('\r\n');

const row = (over: Partial<KanCostRow> = {}): KanCostRow => ({
  date: '2026-08-06',
  sku: '2889355784',
  article: 'BowlBlueMini_01',
  cost: 199.37,
  cabinet: 'MaxiStore',
  ...over,
});

describe('CSV для КАН', () => {
  it('шапка совпадает с образцом КАН посимвольно', () => {
    expect(linesOf(buildKanCostCsv([]))[0]).toBe(
      '"Дата";"SKU";"Артикул";"Себестоимость за единицу товара";"Доп. расходы за единицу товара";"Магазин";"Статус"'
    );
  });

  it('пустой список даёт только шапку, без хвостовой пустой строки', () => {
    expect(buildKanCostCsv([])).toBe('\uFEFF' + KAN_COST_CSV_HEADER);
  });

  it('строка собрана в том же порядке и с теми же кавычками, что и образец', () => {
    const line = linesOf(buildKanCostCsv([row()]))[1];
    expect(line).toBe('"2026-08-06";2889355784;"BowlBlueMini_01";199.3700;0.0000;"MaxiStore";"MAIN"');
  });

  it('разделитель — точка с запятой, ровно шесть штук в строке', () => {
    const line = linesOf(buildKanCostCsv([row()]))[1];
    expect(line.split(';')).toHaveLength(7);
  });

  it('числа идут без кавычек, всегда с четырьмя знаками после точки', () => {
    const cells = linesOf(buildKanCostCsv([row({ cost: 200 })]))[1].split(';');
    expect(cells[3]).toBe('200.0000');
    expect(cells[4]).toBe('0.0000');
  });

  it('доп. расходы всегда ноль: владелец включает все расходы в саму себестоимость', () => {
    const rows = [row({ cost: 1 }), row({ cost: 1075.75 }), row({ cost: 0 })];
    linesOf(buildKanCostCsv(rows)).slice(1).forEach((line) => {
      expect(line.split(';')[4]).toBe('0.0000');
    });
  });

  it('статус всегда MAIN', () => {
    const cells = linesOf(buildKanCostCsv([row()]))[1].split(';');
    expect(cells[6]).toBe('"MAIN"');
  });

  it('магазин берётся из кабинета как есть', () => {
    const cells = linesOf(buildKanCostCsv([row({ cabinet: 'Mercurius' })]))[1].split(';');
    expect(cells[5]).toBe('"Mercurius"');
  });

  it('пустой SKU не роняет выгрузку — поле остаётся пустым, строка на месте', () => {
    const lines = linesOf(buildKanCostCsv([row({ sku: '' })]));
    expect(lines).toHaveLength(2);
    expect(lines[1].split(';')[1]).toBe('');
  });

  it('все изменения по одному артикулу уходят отдельными строками', () => {
    const five = [1, 2, 3, 4, 5].map((n) =>
      row({ date: `2026-08-0${n}`, article: 'Органайзер_2_пол_белый', cost: 100 + n })
    );
    const lines = linesOf(buildKanCostCsv(five));
    expect(lines).toHaveLength(6);
    expect(lines.slice(1).map((l) => l.split(';')[3])).toEqual([
      '101.0000', '102.0000', '103.0000', '104.0000', '105.0000',
    ]);
  });

  it('кавычка внутри артикула удваивается и не разваливает строку', () => {
    const cells = linesOf(buildKanCostCsv([row({ article: 'Полка "Люкс"' })]))[1].split(';');
    expect(cells[2]).toBe('"Полка ""Люкс"""');
  });

  it('копейки не теряются при округлении до четырёх знаков', () => {
    const cells = linesOf(buildKanCostCsv([row({ cost: 250.53 })]))[1].split(';');
    expect(cells[3]).toBe('250.5300');
  });

  it('нечисловая себестоимость даёт ноль, а не NaN в файле', () => {
    const cells = linesOf(buildKanCostCsv([row({ cost: Number.NaN })]))[1].split(';');
    expect(cells[3]).toBe('0.0000');
  });
});

describe('дата', () => {
  it('ГГГГ-ММ-ДД проходит без изменений', () => {
    expect(normaliseKanDate('2026-08-06')).toBe('2026-08-06');
  });

  it('русская ДД.ММ.ГГГГ переводится в формат КАН', () => {
    expect(normaliseKanDate('01.08.2026')).toBe('2026-08-01');
  });

  it('непонятное значение отдаётся как есть, чтобы его было видно в файле', () => {
    expect(normaliseKanDate('позавчера')).toBe('позавчера');
  });
});

describe('имя файла', () => {
  it('несёт дату выгрузки', () => {
    expect(kanCostFileName(new Date(2026, 8, 1))).toBe('kan_cost_2026-09-01.csv');
  });
});

/**
 * Порядок шагов в сторе проверяется по исходнику, как в hooksOrder.test.ts: тесты идут в
 * окружении node, DOM и сети тут нет, а правило нарушается один раз и молча — отметка
 * «выгружено», проставленная до того, как файл собран, навсегда прячет изменение
 * себестоимости от КАН. Проверка запрещает возврат приёма.
 */
describe('порядок шагов при выгрузке', () => {
  const store = fs.readFileSync(
    path.join(process.cwd(), 'src/store/useWarehouseStore.ts'),
    'utf8'
  );
  const body = store.slice(store.indexOf('exportKanCost: async'));

  it('файл отдаётся пользователю раньше, чем строки помечаются выгруженными', () => {
    const clicked = body.indexOf('link.click()');
    const marked = body.indexOf("'markOzonCostExported'");
    expect(clicked).toBeGreaterThan(-1);
    expect(marked).toBeGreaterThan(-1);
    expect(clicked).toBeLessThan(marked);
  });

  it('файл отдаётся до любого раннего выхода — кнопка всегда скачивает файл', () => {
    const clicked = body.indexOf('link.click()');
    const emptyExit = body.indexOf('rows.length === 0');
    const repeatExit = body.indexOf('if (isRepeat)');
    expect(emptyExit).toBeGreaterThan(-1);
    expect(repeatExit).toBeGreaterThan(-1);
    expect(clicked).toBeLessThan(emptyExit);
    expect(clicked).toBeLessThan(repeatExit);
  });

  it('на повторной выгрузке отметка не переставляется', () => {
    const repeatExit = body.indexOf('if (isRepeat)');
    const marked = body.indexOf("'markOzonCostExported'");
    expect(repeatExit).toBeLessThan(marked);
  });
});

/**
 * Сверка с живым файлом КАН, а не с моей памятью о нём.
 *
 * 26.08.2026 я записал формат по ТЗ и ошибся в трёх местах сразу: поставил SKU в кавычки,
 * не поставил BOM и перевёл строки одним символом вместо двух. Образец `products_import`
 * лежит рядом и разрешает спор в один шаг, поэтому проверка читает именно его.
 */
describe('сверка с образцом КАН', () => {
  const raw = fs.readFileSync(
    path.join(process.cwd(), 'docs/kan_products_import_sample_2026-08-25.csv')
  );
  const sample = raw.toString('utf8');
  const sampleLines = sample.replace(/^﻿/, '').split('\r\n');
  const ours = buildKanCostCsv([row()]);

  it('файл КАН начинается с BOM — и наш тоже', () => {
    expect(raw.subarray(0, 3).toString('hex')).toBe('efbbbf');
    expect(ours.charCodeAt(0)).toBe(0xfeff);
  });

  it('переводы строк в файле КАН двухсимвольные — и у нас тоже', () => {
    expect(sample).toContain('\r\n');
    expect(ours).toContain('\r\n');
    expect(ours.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it('шапка совпадает с образцом посимвольно', () => {
    expect(sampleLines[0]).toBe(KAN_COST_CSV_HEADER);
  });

  it('SKU в образце — голое число без кавычек, и у нас так же', () => {
    const theirs = sampleLines[1].split(';')[1];
    const mine = ours.replace(/^﻿/, '').split('\r\n')[1].split(';')[1];
    expect(theirs).toMatch(/^\d+$/);
    expect(mine).toMatch(/^\d+$/);
  });

  it('в каждом поле образца кавычки стоят там же, где у нас', () => {
    const quoted = (line: string) => line.split(';').map((c) => c.startsWith('"'));
    const mine = ours.replace(/^﻿/, '').split('\r\n')[1];
    expect(quoted(mine)).toEqual(quoted(sampleLines[1]));
  });

  it('числа в образце идут с четырьмя знаками — как и у нас', () => {
    const theirs = sampleLines[1].split(';');
    expect(theirs[3]).toMatch(/^\d+\.\d{4}$/);
    expect(theirs[4]).toMatch(/^\d+\.\d{4}$/);
  });
});
