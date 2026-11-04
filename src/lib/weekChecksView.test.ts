import { describe, expect, it } from 'vitest';
import { weekChecksView } from './weekChecksView';
import { InvoiceSpreadState } from '../types';

const fmt = (k: number) => `${k / 100} ₽`;
const INV = [{ id: 'i1', number: '15', date: '01.11.2026' }];
const base = (extra: Partial<InvoiceSpreadState>): InvoiceSpreadState => ({
  operations: [{ opId: 'o1', cabinet: 'A', orderNumbers: ['111', '222'], auto: true, shipmentId: '', rows: [], services: 0 }],
  applied: [],
  ...extra
});

describe('weekChecksView', () => {
  it('is empty for an older answer without the checks', () => {
    expect(weekChecksView(base({}), INV, fmt)).toEqual({ staleItems: [], reconciliation: [], notInSpread: [] });
    expect(weekChecksView(null, INV, fmt).staleItems).toEqual([]);
  });
  it('names stale supplies, steps, unknown supply and invoice fallback', () => {
    const v = weekChecksView(base({
      stale: { step1: [{ opId: 'o1', articles: ['X1'] }], invoices: [{ invoiceId: 'i1', opIds: ['gone'] }, { invoiceId: 'zz', opIds: ['o1'] }] }
    }), INV, fmt);
    expect(v.staleItems).toEqual([
      'A 111, 222 — шаг 1 (артикулы: X1)',
      'удалённая поставка — счёт № 15 от 01.11.2026',
      'A 111, 222 — счёт zz'
    ]);
  });
  it('shows reconciliation lines with problems only when red, and not-in-spread', () => {
    const v = weekChecksView(base({
      reconciliation: [
        { invoiceId: 'i1', allocatedKop: 10000, onRowsKop: 9000, ok: false, missingRows: ['7'], mismatchedRows: [{ id: 3, article: 'X1', cellKop: 500, sharesKop: 600 }] },
        { invoiceId: 'i1', allocatedKop: 100, onRowsKop: 100, ok: true, missingRows: [], mismatchedRows: [] }
      ],
      notInSpread: [{ opId: 'o1', cabinet: 'A', orderNumbers: ['111'] }]
    }), INV, fmt);
    expect(v.reconciliation[0]).toEqual({
      text: 'Счёт № 15 от 01.11.2026: распределено 100 ₽ · на строках 90 ₽',
      ok: false,
      problems: ['строка 7: строка удалена', 'X1: в строке 5 ₽, по долям 6 ₽']
    });
    expect(v.reconciliation[1].problems).toEqual([]);
    expect(v.notInSpread).toEqual(['A 111, 222']);
  });
});
