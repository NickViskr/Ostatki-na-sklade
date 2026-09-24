import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { chinaSheetsFromWorkbook, chinaDateCell } from './chinaXlsx';
import { detectChinaFile, parseChinaBatchFile } from './chinaFileParse';

describe('файл xlsx превращается в сетку ячеек', () => {
  it('a date becomes a yyyy-MM-dd string by its own day, not by UTC', () => {
    // 27.08.2026 00:00 local: in UTC+3 this is the 26th at 21:00, and a careless conversion
    // would move the shipping date a day back.
    expect(chinaDateCell(new Date(2026, 7, 27))).toBe('2026-08-27');
    expect(chinaDateCell(new Date(2026, 0, 1))).toBe('2026-01-01');
  });

  it('keeps numbers as numbers and empty cells as empty strings', () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['a', 1.5, null], [true, '', 'текст']]), 'Лист1');
    const grid = chinaSheetsFromWorkbook(wb)['Лист1'];
    expect(grid[0][1]).toBe(1.5);
    expect(grid[0][2]).toBe('');
    expect(grid[1][0]).toBe('');
    expect(grid[1][2]).toBe('текст');
  });

  it('carries a whole batch file through to the parser', () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['транспортный код \n（柜号）', '', 'NV-0825-2/东线'],
      ['стоимость товары\n货值：', '', 8008],
      ['', '', '', '', '', 'Дата отправки\n发货日期：', '', new Date(2026, 7, 27)],
      ['货物品名', '总件数', '体积', '重量', '单价', '保险费', '包装费', '佣金', '运费'],
      ['收纳盒', 2, 4.92, 672.5, 2.3, '', 90, '', 1546.75],
      ['Итого \n合计($)', '', '', '', '', 1636.75]
    ]), '运单表');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ['货号', '品名', '件数', '装箱数', '总数量', '单价¥', '总额¥', '总毛重'],
      ['NV-99', '收纳盒', 30, 8, 240, 20.3, 4872, 339],
      ['NV-98', '收纳盒', 15, 8, 120, 20.3, 2436, 333.5],
      ['Стоимость доставки в Китае', '', '', '', '', '', 700]
    ]), '详单');

    // Through a real xlsx and back, exactly as the browser reads a file the owner picked:
    // only `XLSX.read(..., { cellDates: true })` hands dates over as Date objects.
    const roundTrip = XLSX.read(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), { cellDates: true });
    const sheets = chinaSheetsFromWorkbook(roundTrip);
    expect(detectChinaFile(sheets)).toBe('batch');
    const parsed = parseChinaBatchFile(sheets)!;
    expect(parsed.code).toBe('NV-0825-2');
    expect(parsed.shippedAt).toBe('2026-08-27');
    expect(parsed.weightKg).toBe(672.5);
    expect(parsed.freightUsd).toBe(1636.75);
    expect(parsed.chinaDeliveryCny).toBe(700);
    expect(parsed.lines).toHaveLength(2);
    expect(parsed.warnings).toEqual([]);
  });
});
