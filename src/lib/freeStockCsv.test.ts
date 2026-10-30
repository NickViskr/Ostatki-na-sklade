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

// minimal RFC-4180 reader with ';' separator
function parseSemicolonCsv(t: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let f = '';
  let q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"') {
        if (t[i + 1] === '"') { f += '"'; i++; } else q = false;
      } else f += c;
    } else if (c === '"') q = true;
    else if (c === ';') { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  row.push(f);
  rows.push(row);
  return rows;
}

describe('buildFreeStockCsv escaping (R-061)', () => {
  it('round trips articles containing a semicolon, a newline and a double quote', () => {
    const csv = buildFreeStockCsv(
      [{ article: 'A;variant\nsecond-line', quantity: 10 }, { article: 'Q"x', quantity: 3 }],
      {}
    );
    const rows = parseSemicolonCsv(csv);
    expect(rows.length).toBe(3);
    expect(rows[1]).toEqual(['A;variant\nsecond-line', '10']);
    expect(rows[2]).toEqual(['Q"x', '3']);
  });

  it('wraps a field with a special character in quotes, doubles inner quotes, leaves plain articles unquoted', () => {
    expect(buildFreeStockCsv([{ article: 'Q"x;y', quantity: 3 }, { article: 'PLAIN-1', quantity: 2 }], {}))
      .toBe('Артикул;Свободно\n"Q""x;y";3\nPLAIN-1;2');
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
