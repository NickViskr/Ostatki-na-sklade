import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { buildFreeStockCsv, buildFreeStockRows } from './freeStockCsv';

describe('buildFreeStockRows', () => {
  it('subtracts the reserve of the Ozon supply orders from the shelf quantity', () => {
    const rows = buildFreeStockRows([{ article: 'A', quantity: 50 }, { article: 'B', quantity: 7 }], { A: 20 });
    expect(rows).toEqual([{ article: 'A', free: 30 }, { article: 'B', free: 7 }]);
  });

  it('leaves out articles with nothing free: fully reserved, over-reserved or empty', () => {
    const rows = buildFreeStockRows(
      [{ article: 'A', quantity: 10 }, { article: 'B', quantity: 5 }, { article: 'C', quantity: 0 }, { article: 'D', quantity: 1 }],
      { A: 10, B: 9 }
    );
    expect(rows).toEqual([{ article: 'D', free: 1 }]);
  });

  it('keeps the order of the table', () => {
    const rows = buildFreeStockRows([{ article: 'Z', quantity: 1 }, { article: 'A', quantity: 1 }], {});
    expect(rows.map((r) => r.article)).toEqual(['Z', 'A']);
  });
});

describe('buildFreeStockCsv', () => {
  it('two columns, semicolon separated, header first', () => {
    expect(buildFreeStockCsv([{ article: 'A', quantity: 50 }, { article: 'B', quantity: 3 }], { A: 20, B: 3 }))
      .toBe('Артикул;Свободно\nA;30');
  });

  it('only the header when nothing is free', () => {
    expect(buildFreeStockCsv([{ article: 'A', quantity: 5 }], { A: 5 })).toBe('Артикул;Свободно');
  });
});

describe('подключение: кнопка «Скачать CSV» на вкладке «Склад»', () => {
  it('Dashboard строит файл через buildFreeStockCsv по резерву заявок Ozon', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src/components/Dashboard.tsx'), 'utf8');
    expect(src).toContain("import { buildFreeStockCsv } from '../lib/freeStockCsv';");
    expect(src).toMatch(/buildFreeStockCsv\(sortedStock, pendingSupplies\.byArticle\)/);
    expect(src).not.toContain("const headers = ['Артикул', 'Кол-во'");
  });
});
