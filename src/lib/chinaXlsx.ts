/**
 * Item 81c: turning a file the Chinese side sent into the grid of cells the parser reads.
 *
 * Item 81e's owner check (2026-09-24) found every date a day early in Asia/Yekaterinburg: with
 * `{ cellDates: true }` SheetJS hands over a JS `Date`, and building it from an Excel serial
 * uses the HISTORICAL local-mean-time offset (Yekaterinburg was +5:00:33, not +5:00:00, before
 * 1919) — the resulting instant is a few dozen seconds before local midnight, so reading its
 * date by local parts under the CURRENT offset rolls it back a whole day. A file the carrier
 * dated 2026-09-24 turned into a draft named NV-0922, missed the batch it belonged to, and
 * a second batch was created with the owner's work on the first one lost.
 *
 * The fix never builds a `Date` at all: a date cell is read as its raw Excel serial number
 * (decided by the cell's OWN number format, via `XLSX.SSF.is_date`, not by JS Date guessing)
 * and turned into y/m/d with `XLSX.SSF.parse_date_code` — pure arithmetic on the serial, with
 * no time zone anywhere in it.
 */

import * as XLSX from 'xlsx';
import { ChinaSheets, ChinaSheetGrid } from './chinaFileParse';

const pad = (n: number): string => String(n).padStart(2, '0');

/** Kept for the tests: the same 'yyyy-MM-dd' text, from the y/m/d SheetJS already parsed. */
export function chinaDateCell(value: Date): string {
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

/** Serial-number y/m/d → the same 'yyyy-MM-dd' text `chinaDateCell` gives a `Date`, TZ-free. */
function chinaDateFromSerial(serial: number): string {
  const parsed = XLSX.SSF.parse_date_code(serial);
  if (!parsed) return '';
  return `${parsed.y}-${pad(parsed.m)}-${pad(parsed.d)}`;
}

function chinaCellValue(cell: XLSX.CellObject | undefined): string | number {
  if (!cell) return '';
  if (cell.t === 'n') {
    if (typeof cell.v !== 'number' || !isFinite(cell.v)) return 0;
    if (cell.z && XLSX.SSF.is_date(cell.z)) return chinaDateFromSerial(cell.v);
    return cell.v;
  }
  if (cell.t === 's') return cell.v === undefined || cell.v === null ? '' : String(cell.v);
  return '';
}

export function chinaSheetsFromWorkbook(wb: XLSX.WorkBook): ChinaSheets {
  const sheets: ChinaSheets = {};
  wb.SheetNames.forEach((name) => {
    const ws = wb.Sheets[name];
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
    const grid: ChinaSheetGrid = [];
    for (let r = range.s.r; r <= range.e.r; r++) {
      const row: (string | number)[] = [];
      for (let c = range.s.c; c <= range.e.c; c++) {
        row.push(chinaCellValue(ws[XLSX.utils.encode_cell({ r, c })]));
      }
      grid.push(row);
    }
    sheets[name] = grid;
  });
  return sheets;
}

export async function chinaSheetsFromFile(file: File): Promise<ChinaSheets> {
  const buffer = await file.arrayBuffer();
  // `cellDates: false` (the default) so no `Date` is ever built from a serial; `cellNF: true`
  // so each cell keeps its own number-format string, which is how a date cell is told apart
  // from a plain number — see `chinaCellValue`.
  return chinaSheetsFromWorkbook(XLSX.read(buffer, { cellDates: false, cellNF: true }));
}
