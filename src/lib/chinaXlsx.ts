/**
 * Item 81c: turning a file the Chinese side sent into the grid of cells the parser reads.
 *
 * The only browser-bound step of the import. Dates become 'yyyy-MM-dd' strings here, by their
 * LOCAL parts: an Excel date is midnight, and taking it apart in UTC would move half of them
 * to the day before.
 */

import * as XLSX from 'xlsx';
import { ChinaSheets, ChinaSheetGrid } from './chinaFileParse';

const pad = (n: number): string => String(n).padStart(2, '0');

export function chinaDateCell(value: Date): string {
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

export function chinaSheetsFromWorkbook(wb: XLSX.WorkBook): ChinaSheets {
  const sheets: ChinaSheets = {};
  wb.SheetNames.forEach((name) => {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, defval: '', raw: true });
    sheets[name] = rows.map((row) => (row || []).map((cell) => {
      if (cell instanceof Date) return chinaDateCell(cell);
      if (typeof cell === 'number') return isFinite(cell) ? cell : 0;
      if (typeof cell === 'string') return cell;
      if (cell === null || cell === undefined || typeof cell === 'boolean') return '';
      return String(cell);
    })) as ChinaSheetGrid;
  });
  return sheets;
}

export async function chinaSheetsFromFile(file: File): Promise<ChinaSheets> {
  const buffer = await file.arrayBuffer();
  return chinaSheetsFromWorkbook(XLSX.read(buffer, { cellDates: true }));
}
