import * as XLSX from 'xlsx';
import type { Transaction } from '../types';
import { historyTypeLabel } from './utils';

// The «История» export is a real .xlsx: a comma CSV opens as one column in a Russian-locale
// Excel, and the «Объект» text carries its own commas.

const HEADERS = ['Дата', 'Тип', 'Артикул', 'Кол-во', 'Цена', 'Сумма', 'Объект', 'Комментарий', 'Пользователь', 'ID'];

const pad = (n: number) => String(n).padStart(2, '0');

/** ISO timestamp → «дд.мм.гггг чч:мм» in the browser's zone; unparsable text is kept as is. */
function formatDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export function buildHistoryRows(rows: Transaction[]): (string | number)[][] {
  return [
    HEADERS,
    ...rows.map(t => [
      formatDate(t.date),
      historyTypeLabel(t),
      t.article,
      Number(t.quantity) || 0,
      round2(t.price),
      round2(t.total),
      t.destination,
      t.comment || '',
      t.user || '',
      t.id,
    ]),
  ];
}

export function buildHistoryWorkbook(rows: Transaction[]): XLSX.WorkBook {
  const sheet = XLSX.utils.aoa_to_sheet(buildHistoryRows(rows));
  sheet['!cols'] = [18, 20, 26, 8, 10, 12, 80, 30, 16, 38].map(wch => ({ wch }));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'История');
  return book;
}

export function downloadHistoryXlsx(rows: Transaction[]): void {
  XLSX.writeFile(buildHistoryWorkbook(rows), 'history.xlsx');
}
