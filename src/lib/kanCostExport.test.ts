import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildKanCostCsv,
  collapseKanCostRows,
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

/**
 * Один артикул за один день — одна строка (03.09.2026, по боевому файлу владельца).
 *
 * Он оформил несколько отдельных списаний одного артикула за день, и в файл ушла строка на
 * каждое: BowlGrayMini_01 трижды — 245,61, 234,61 и 233,67. Все три числа верные, но два
 * первых — промежуточные состояния того же дня: себестоимость на Ozon скользящая и
 * пересчитывается при каждой отгрузке.
 */
describe('схлопывание строк одного дня', () => {
  it('три строки одного артикула дают одну с ПОСЛЕДНИМ значением', () => {
    const rows = [
      row({ article: 'BowlGrayMini_01', cost: 245.61 }),
      row({ article: 'BowlGrayMini_01', cost: 234.61 }),
      row({ article: 'BowlGrayMini_01', cost: 233.67 }),
    ];
    const out = collapseKanCostRows(rows);
    expect(out).toHaveLength(1);
    // Именно последнее, а не среднее арифметическое трёх: 237,96 не соответствует ни одному
    // состоянию, в котором товар когда-либо был.
    expect(out[0].cost).toBe(233.67);
    expect(out[0].cost).not.toBeCloseTo(237.9633, 3);
  });

  it('разные даты поставки не схлопываются', () => {
    const out = collapseKanCostRows([
      row({ article: 'A', date: '2026-09-10', cost: 10 }),
      row({ article: 'A', date: '2026-09-11', cost: 20 }),
    ]);
    expect(out).toHaveLength(2);
    expect(out.map(r => r.cost)).toEqual([10, 20]);
  });

  it('одна дата в разных записях приводится к общему виду и схлопывается', () => {
    // Строку могли вписать в лист руками в русском формате — это тот же день.
    const out = collapseKanCostRows([
      row({ article: 'A', date: '2026-09-10', cost: 10 }),
      row({ article: 'A', date: '10.09.2026', cost: 20 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].cost).toBe(20);
  });

  it('разные магазины не схлопываются', () => {
    const out = collapseKanCostRows([
      row({ article: 'A', cabinet: 'MaxiStore', cost: 10 }),
      row({ article: 'A', cabinet: 'Mercurius', cost: 20 }),
    ]);
    expect(out).toHaveLength(2);
  });

  it('разные артикулы не схлопываются', () => {
    const out = collapseKanCostRows([row({ article: 'A' }), row({ article: 'B' })]);
    expect(out).toHaveLength(2);
  });

  it('одиночная строка проходит как была', () => {
    const one = [row({ article: 'Полка_выдв_27см', cost: 677.21 })];
    expect(collapseKanCostRows(one)).toEqual(one);
  });

  it('порядок первого появления групп сохраняется', () => {
    const out = collapseKanCostRows([
      row({ article: 'B', cost: 1 }),
      row({ article: 'A', cost: 2 }),
      row({ article: 'B', cost: 3 }),
    ]);
    expect(out.map(r => r.article)).toEqual(['B', 'A']);
    expect(out.map(r => r.cost)).toEqual([3, 2]);
  });

  it('пустой список не ломает схлопывание', () => {
    expect(collapseKanCostRows([])).toEqual([]);
  });

  it('боевой файл владельца от 03.09.2026: 9 строк превращаются в 5', () => {
    // Ровно те строки, что он прислал, в том же порядке.
    const live: KanCostRow[] = [
      { date: '2026-09-03', sku: '2889355808', article: 'BowlGrayMini_01', cost: 245.61, cabinet: 'MaxiStore' },
      { date: '2026-09-03', sku: '2889355808', article: 'BowlGrayMini_01', cost: 234.61, cabinet: 'MaxiStore' },
      { date: '2026-09-03', sku: '2889355808', article: 'BowlGrayMini_01', cost: 233.67, cabinet: 'MaxiStore' },
      { date: '2026-09-03', sku: '4498013867', article: 'Миска_двойная', cost: 229.79, cabinet: 'MaxiStore' },
      { date: '2026-09-03', sku: '4498013867', article: 'Миска_двойная', cost: 229.58, cabinet: 'MaxiStore' },
      { date: '2026-09-03', sku: '2071666870', article: 'Полка_выдв_27см', cost: 677.21, cabinet: 'Mercurius' },
      { date: '2026-09-03', sku: '3034379862', article: 'Набор_полок_выдв_бел', cost: 1650.49, cabinet: 'Mercurius' },
      { date: '2026-09-03', sku: '3034379862', article: 'Набор_полок_выдв_бел', cost: 1647.59, cabinet: 'Mercurius' },
      { date: '2026-09-03', sku: '3361571448', article: 'Органайзер_2_пол_PureWhite', cost: 584.51, cabinet: 'Mercurius' },
    ];
    const out = collapseKanCostRows(live);
    expect(out).toHaveLength(5);
    expect(out.map(r => [r.article, r.cost])).toEqual([
      ['BowlGrayMini_01', 233.67],
      ['Миска_двойная', 229.58],
      ['Полка_выдв_27см', 677.21],
      ['Набор_полок_выдв_бел', 1647.59],
      ['Органайзер_2_пол_PureWhite', 584.51],
    ]);
    // В файле каждый артикул встречается ровно один раз.
    const csvLines = buildKanCostCsv(out).replace(/^﻿/, '').split('\r\n').slice(1);
    expect(csvLines).toHaveLength(5);
    expect(csvLines.filter(l => l.includes('BowlGrayMini_01'))).toHaveLength(1);
  });
});

/** Проверки формы кода: расчёт, не подключённый к кнопке, владельцу ничем не помогает. */
describe('схлопывание подключено к выгрузке', () => {
  const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
  const store = read('src/store/useWarehouseStore.ts');

  it('файл собирается из схлопнутых строк', () => {
    expect(store).toContain('buildKanCostCsv(collapseKanCostRows(rows))');
  });

  it('отметку «выгружено» получают ВСЕ исходные строки журнала, а не только попавшие в файл', () => {
    // Иначе схлопнутые сочли бы себя невыгруженными и вылезли бы следующей выгрузкой.
    expect(store).toMatch(/rows: pending\.map\(\(r\) => \(\{/);
    expect(store).not.toMatch(/rows: collapse\w*\(/);
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
