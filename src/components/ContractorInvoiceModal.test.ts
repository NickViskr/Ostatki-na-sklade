import { describe, expect, it } from 'vitest';
import { draftFromSavedInvoice } from './ContractorInvoiceModal';
import type { ContractorInvoice } from '../types';

// SYNTHETIC invoice: invented supplier, no real INN or bank data.
const saved = {
  id: 'INV-1', week: '2026-W44', number: '0045', date: '02.11.2026', supplier: 'ООО Ромашка', buyer: 'ИП Тестов',
  total: 175, vat: 'Без НДС', itemCount: 3, fileId: '', fileName: '', uploadedBy: 'Кладовщик', uploadedAt: '', replacedAt: '',
  lines: [
    { n: 1, name: 'Поставка', qty: '1', unit: 'шт', price: 100, sum: 100, toSupply: true },
    { n: 2, name: 'Хранение', qty: '1', unit: 'шт', price: 50, sum: 50, toSupply: false },
    { n: 3, name: 'Возврат', qty: '1', unit: 'шт', price: 25, sum: 25, toSupply: true }
  ]
} as unknown as ContractorInvoice;

describe('draftFromSavedInvoice', () => {
  it('carries toSupply of every saved line into the draft lines', () => {
    const d = draftFromSavedInvoice(saved);
    expect(d.lines.map((l) => l.toSupply)).toEqual([true, false, true]);
  });
  it('keeps the money as comma text and the header as before', () => {
    const d = draftFromSavedInvoice(saved);
    expect(d.lines[1]).toMatchObject({ name: 'Хранение', price: '50,00', sum: '50,00' });
    expect(d.header.total).toBe('175,00');
    expect(d.header.itemCount).toBe('3');
  });
});
