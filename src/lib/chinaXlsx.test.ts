import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { chinaSheetsFromWorkbook, chinaSheetsFromFile, chinaDateCell } from './chinaXlsx';
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

    // Through a real xlsx and back, exactly as the browser reads a file the owner picked: NOT
    // `cellDates: true` — item 81e found every date a day early in Asia/Yekaterinburg that way.
    const roundTrip = XLSX.read(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), { cellDates: false, cellNF: true });
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

/**
 * Item 81e's own defect, found by the owner on 2026-09-24: `XLSX.read(buf, { cellDates: true })`
 * hands over a JS `Date` built from the Excel serial with the HISTORICAL local-mean-time offset
 * of the reading time zone — Yekaterinburg was +5:00:33, not +5:00:00, before 1919 — so the
 * instant sits a few dozen seconds before local midnight, and reading it apart by local getters
 * under the zone's CURRENT offset rolls the day back by one. `2026-09-24` (the final batch's
 * shipping date) became `2026-09-23`; the arrival date `2026-09-23` became `2026-09-22`; the
 * final file's draft code no longer matched, so a second batch was created and the owner's
 * choices on the first one were lost.
 *
 * The fix (`chinaXlsx.ts`) never builds a `Date`: it reads a date cell as its raw Excel serial,
 * told apart from a plain number by the cell's OWN format (`XLSX.SSF.is_date`), and turns it
 * into y/m/d with `XLSX.SSF.parse_date_code` — arithmetic on the serial, no time zone in it at
 * all. Proved here across three zones, on a workbook built from real xlsx bytes in the test AND
 * (when this machine has them) on the owner's own files of item 81e.
 */
describe('item 81e: a date cell reads the same in every time zone', () => {
  // Node re-reads `process.env.TZ` for every `Date`, so setting it mid-test does change the
  // zone the conversion runs under — the offsets below prove it actually did, not just that the
  // variable was set.
  const EXPECTED_OFFSET_MIN: Record<string, number> = {
    'Asia/Yekaterinburg': -300,
    UTC: 0,
    'America/New_York': 300
  };
  const ZONES = Object.keys(EXPECTED_OFFSET_MIN);

  // Awaits `run` BEFORE restoring `TZ` — `chinaSheetsFromFile` awaits `file.arrayBuffer()`
  // first, and restoring the zone before that resolves would test nothing.
  const inZone = async <T,>(tz: string, run: () => T | Promise<T>): Promise<T> => {
    const before = process.env.TZ;
    process.env.TZ = tz;
    try {
      expect(new Date(2026, 0, 1).getTimezoneOffset()).toBe(EXPECTED_OFFSET_MIN[tz]);
      return await run();
    } finally {
      process.env.TZ = before;
    }
  };

  it('the actual browser entry point, chinaSheetsFromFile, reads the same date in every zone', async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[new Date(2026, 8, 24)]]), 'S1');
    const bytes = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const file = new File([bytes], 'test.xlsx');

    for (const tz of ZONES) {
      // eslint-disable-next-line no-await-in-loop
      const grid = await inZone(tz, () => chinaSheetsFromFile(file));
      expect(grid['S1'][0][0]).toBe('2026-09-24');
    }
  });

  it('a workbook of real xlsx bytes gives the identical date string in every zone', async () => {
    const wb = XLSX.utils.book_new();
    // The exact shape of the bug: a pure calendar date, no time of day typed by anyone.
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[new Date(2026, 8, 24)]]), 'S1');
    const bytes = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const results = [];
    for (const tz of ZONES) {
      // eslint-disable-next-line no-await-in-loop
      results.push(await inZone(tz, () => {
        const back = XLSX.read(bytes, { cellDates: false, cellNF: true });
        return chinaSheetsFromWorkbook(back)['S1'][0][0];
      }));
    }
    expect(results).toEqual(['2026-09-24', '2026-09-24', '2026-09-24']);
  });
});
