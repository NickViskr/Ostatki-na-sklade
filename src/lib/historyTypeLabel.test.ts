import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { STOCK_CORRECTION_TAG, historyTypeLabel } from './utils';

/**
 * Owner, 16.09.2026: a stock correction made in the «Списание» menu must be visible in
 * «История» as «Приход-корректировка» / «Расход-корректировка». The row is still stored as a
 * plain receipt or expense with the tag «[Корректировка остатка]» in its destination — only the
 * label changes.
 */
describe('Тип строки «Истории» для «Корректировки остатка»', () => {
  it('расход и приход с меткой получают суффикс «-корректировка»', () => {
    expect(historyTypeLabel({ type: 'Расход', destination: 'Склад [Корректировка остатка]' })).toBe('Расход-корректировка');
    expect(historyTypeLabel({ type: 'Приход', destination: 'Склад [Корректировка остатка]' })).toBe('Приход-корректировка');
  });

  it('метка без объекта (пустое поле «Объект») тоже распознаётся', () => {
    expect(historyTypeLabel({ type: 'Приход', destination: '[Корректировка остатка]' })).toBe('Приход-корректировка');
  });

  it('обычные операции и другие метки остаются как есть', () => {
    expect(historyTypeLabel({ type: 'Расход', destination: 'Ozon (MaxiStore) [Упаковка: 216 шт. x 37₽ = 7992₽ | Услуги: Забор груза]' })).toBe('Расход');
    expect(historyTypeLabel({ type: 'Расход', destination: 'Склад [Списание - Брак]' })).toBe('Расход');
    expect(historyTypeLabel({ type: 'Приход', destination: 'Склад [Оприходование - Излишки]' })).toBe('Приход');
    expect(historyTypeLabel({ type: 'Приход', destination: 'Корректировка: возврат неотгруженного, поставка № 2000065651020 (заявка № 127380557-1)' })).toBe('Приход');
    expect(historyTypeLabel({ type: 'Приход', destination: '' })).toBe('Приход');
    expect(historyTypeLabel({ type: 'Приход' })).toBe('Приход');
  });

  it('метка совпадает с той, что пишет меню «Списание»', () => {
    const manual = fs.readFileSync(path.join(process.cwd(), 'src/components/ManualTab.tsx'), 'utf8');
    expect(manual).toContain('`${destination} [' + STOCK_CORRECTION_TAG + ']`');
    expect(manual).toContain("'[" + STOCK_CORRECTION_TAG + "]'");
  });

  it('«История» выводит подпись в таблице, в списке удаления и в CSV, а не сырой тип', () => {
    const history = fs.readFileSync(path.join(process.cwd(), 'src/components/HistoryTab.tsx'), 'utf8');
    expect(history.match(/\{historyTypeLabel\(t\)\}/g)?.length).toBe(2);
    expect(history).toContain('csvRows.push([t.id, t.date, historyTypeLabel(t), t.article,');
    expect(history).not.toMatch(/\{t\.type\}/);
  });
});
