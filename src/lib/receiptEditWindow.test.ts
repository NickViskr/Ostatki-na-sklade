import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { daysSinceReceipt, RECEIPT_EDIT_WINDOW_DAYS } from './utils';

const at = (iso: string) => new Date(iso);
const receipt = '2026-08-01T09:00:00Z';

describe('окно правки прихода', () => {
  it('окно равно 30 дням — как в Code.gs', () => {
    expect(RECEIPT_EDIT_WINDOW_DAYS).toBe(30);
  });

  it('29 дней — внутри окна', () => {
    expect(daysSinceReceipt(receipt, at('2026-08-30T09:00:00Z'))).toBe(29);
  });

  it('ровно 30 дней — ещё внутри, граница включена', () => {
    const days = daysSinceReceipt(receipt, at('2026-08-31T09:00:00Z'));
    expect(days).toBe(30);
    expect(days > RECEIPT_EDIT_WINDOW_DAYS).toBe(false);
  });

  it('30 дней 23 ч 59 мин — сутки считаются полными, ещё можно', () => {
    const days = daysSinceReceipt(receipt, at('2026-09-01T08:59:00Z'));
    expect(days).toBe(30);
    expect(days > RECEIPT_EDIT_WINDOW_DAYS).toBe(false);
  });

  it('31 день — за окном', () => {
    const days = daysSinceReceipt(receipt, at('2026-09-01T09:00:00Z'));
    expect(days).toBe(31);
    expect(days > RECEIPT_EDIT_WINDOW_DAYS).toBe(true);
  });

  it('дата в будущем даёт ноль, а не отрицательное число', () => {
    expect(daysSinceReceipt(receipt, at('2026-07-01T09:00:00Z'))).toBe(0);
  });

  it('пустая и нечитаемая дата дают ноль — экран не запрещает из-за непонятой даты', () => {
    expect(daysSinceReceipt('', at('2026-09-01T09:00:00Z'))).toBe(0);
    expect(daysSinceReceipt('не дата', at('2026-09-01T09:00:00Z'))).toBe(0);
    expect(daysSinceReceipt(null, at('2026-09-01T09:00:00Z'))).toBe(0);
  });

  it('русский формат даты из базы понимается так же', () => {
    expect(daysSinceReceipt('01.08.2026', at('2026-09-01T12:00:00Z'))).toBe(31);
  });
});

/**
 * Окно правки живёт в двух местах: решает сервер, а экран не должен обманывать. Проверки
 * ниже читают исходник окна правки — тесты идут в окружении node, отрисовать компонент тут
 * нечем, а обещание кнопки, расходящееся с ответом сервера, это худший вид дефекта:
 * пользователь жмёт «Сохранить» и получает отказ.
 */
describe('окно правки в интерфейсе', () => {
  const modal = fs.readFileSync(
    path.join(process.cwd(), 'src/components/EditTransModal.tsx'),
    'utf8'
  );

  it('кнопка «Сохранить» гаснет за пределами окна', () => {
    expect(modal).toContain('disabled={isProcessing || isReceiptLocked}');
  });

  it('окно правки считает возраст только для прихода', () => {
    expect(modal).toMatch(/receiptAgeDays\s*=\s*editingTrans\.type === 'Приход'/);
  });

  it('пользователю объясняют причину, а не просто гасят кнопку', () => {
    expect(modal).toContain('isReceiptLocked && (');
    expect(modal).toContain('Править этот приход уже нельзя');
  });

  it('сохранение отбивается и по нажатию, а не только видом кнопки', () => {
    const save = modal.slice(modal.indexOf('const handleSave'));
    expect(save.indexOf('if (isReceiptLocked)')).toBeLessThan(save.indexOf('handleUpdateTransaction'));
  });
});
