import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { buildHistoryWorkbook } from './historyExport';
import type { Transaction } from '../types';

const row: Transaction = {
  id: 'id-1',
  date: new Date(2026, 8, 29, 20, 58).toISOString(),
  type: 'Расход',
  article: 'BowlGrayMini_01',
  quantity: 18,
  price: 125.85000000000001,
  writeOffCost: 0,
  total: 3947.78,
  destination: 'Ozon (MaxiStore) [Услуги: Забор груза x1 (159₽), Доставка x1 (1299₽)]',
  comment: 'проверка 90',
  user: 'администратор',
};

describe('history xlsx export', () => {
  it('keeps each field in its own cell, commas in «Объект» included', () => {
    const book = XLSX.read(XLSX.write(buildHistoryWorkbook([row]), { type: 'array', bookType: 'xlsx' }));
    const cells = XLSX.utils.sheet_to_json<(string | number)[]>(book.Sheets['История'], { header: 1 });
    expect(cells[0]).toEqual(['Дата', 'Тип', 'Артикул', 'Кол-во', 'Цена', 'Сумма', 'Объект', 'Комментарий', 'Пользователь', 'ID']);
    expect(cells[1]).toEqual([
      '29.09.2026 20:58', 'Расход', 'BowlGrayMini_01', 18, 125.85, 3947.78,
      row.destination, 'проверка 90', 'администратор', 'id-1',
    ]);
  });
});
