import { describe, expect, it } from 'vitest';
import {
  checkContractorInvoice,
  contractorInvoiceKey,
  contractorInvoiceNormalise,
  contractorInvoicePrompt,
  parseKopecks,
  parseQtyMilli,
  supplyTotalKopecks,
  type ContractorInvoiceDraft,
  type ContractorInvoiceLine,
} from './contractorInvoice';

// SYNTHETIC invoices only: invented supplier, no real INN or bank data.
const line = (over: Partial<ContractorInvoiceLine> = {}): ContractorInvoiceLine => ({
  name: 'Услуга', qty: '1', unit: 'шт', price: '100,00', sum: '100,00', ...over,
});
const draft = (
  lines: ContractorInvoiceLine[],
  header: Partial<ContractorInvoiceDraft['header']> = {},
): ContractorInvoiceDraft => ({
  header: {
    number: '15', date: '02.11.2026', supplier: 'ООО Ромашка', buyer: 'ИП Тест',
    total: '', vat: 'Без НДС', itemCount: String(lines.length), ...header,
  },
  lines,
});

describe('checkContractorInvoice', () => {
  it('accepts a valid invoice with a kopeck line 1 x 9022,74', () => {
    const d = draft(
      [line({ name: 'Сборка', price: '9022,74', sum: '9022,74' }), line({ qty: '2', price: '55,00', sum: '110,00' })],
      { total: '9132,74' },
    );
    const r = checkContractorInvoice(d);
    expect(r.headerErrors).toEqual([]);
    expect(r.lineErrors).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('names the line number and both amounts when a line sum is wrong', () => {
    const d = draft(
      [line(), line(), line({ qty: '2', price: '55,00', sum: '100,00' })],
      { total: '300,00' },
    );
    const r = checkContractorInvoice(d);
    expect(r.ok).toBe(false);
    expect(r.lineErrors).toHaveLength(1);
    expect(r.lineErrors[0].index).toBe(2);
    expect(r.lineErrors[0].message).toContain('Строка 3');
    expect(r.lineErrors[0].message).toContain('110,00');
    expect(r.lineErrors[0].message).toContain('100,00');
  });

  it('fails with a header error when the total misses one line', () => {
    const r = checkContractorInvoice(draft([line(), line()], { total: '100,00' }));
    expect(r.ok).toBe(false);
    expect(r.headerErrors.length).toBeGreaterThan(0);
  });

  it('fails when itemCount differs from the number of lines', () => {
    const r = checkContractorInvoice(draft([line(), line()], { total: '200,00', itemCount: '3' }));
    expect(r.ok).toBe(false);
  });

  it('passes with a note when itemCount is empty', () => {
    const r = checkContractorInvoice(draft([line(), line()], { total: '200,00', itemCount: '' }));
    expect(r.ok).toBe(true);
    expect(r.notes).toContain('В счёте нет строки «Всего наименований» — проверка числа строк пропущена');
  });

  it('accepts fractional qty 1,5 x 100,01 = 150,02 (product rounded half-up)', () => {
    const r = checkContractorInvoice(draft([line({ qty: '1,5', price: '100,01', sum: '150,02' })], { total: '150,02' }));
    expect(r.lineErrors).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('rejects 150,01 for 1,5 x 100,01', () => {
    const r = checkContractorInvoice(draft([line({ qty: '1,5', price: '100,01', sum: '150,01' })], { total: '150,01' }));
    expect(r.ok).toBe(false);
    expect(r.lineErrors[0].index).toBe(0);
  });
});

describe('parseKopecks', () => {
  it.each([
    ['9 022,74', 902274],
    ['9 022,74', 902274],
    ['9022.74', 902274],
    ['1 299', 129900],
    ['159 ₽', 15900],
    ['1 299,00 руб.', 129900],
  ])('parses %j as %i kopecks', (text, kop) => {
    expect(parseKopecks(text)).toBe(kop);
  });
  it.each([['1,234'], ['abc'], [''], ['-5']])('returns null for %j', (text) => {
    expect(parseKopecks(text)).toBeNull();
  });
});

describe('parseQtyMilli', () => {
  it.each([['2', 2000], ['1,5', 1500]])('parses %j as %i thousandths', (text, milli) => {
    expect(parseQtyMilli(text)).toBe(milli);
  });
  it.each([['0'], ['-1'], ['1,2345']])('returns null for %j', (text) => {
    expect(parseQtyMilli(text)).toBeNull();
  });
});

describe('contractorInvoiceNormalise', () => {
  const raw = (over: Record<string, unknown> = {}) => ({
    header: { number: 15, date: '2026-11-02', supplier: ' ООО Ромашка ', total: 200 },
    lines: [{ name: 'Услуга', qty: 2, price: 100, sum: 200 }],
    ...over,
  });
  it('turns numbers into text, trims and fills missing fields with empty text', () => {
    const d = contractorInvoiceNormalise(raw())!;
    expect(d.header.number).toBe('15');
    expect(d.header.supplier).toBe('ООО Ромашка');
    expect(d.header.total).toBe('200');
    expect(d.header.buyer).toBe('');
    expect(d.header.itemCount).toBe('');
    expect(d.lines[0].qty).toBe('2');
    expect(d.lines[0].unit).toBe('');
  });
  it.each([['2026-11-02'], ['2.11.2026'], ['2 ноября 2026 г.']])('normalises date %j to 02.11.2026', (date) => {
    const d = contractorInvoiceNormalise(raw({ header: { number: '1', date, supplier: 'x' } }))!;
    expect(d.header.date).toBe('02.11.2026');
  });
  it('returns null for a non-object or when lines is not an array', () => {
    expect(contractorInvoiceNormalise('text')).toBeNull();
    expect(contractorInvoiceNormalise(null)).toBeNull();
    expect(contractorInvoiceNormalise(raw({ lines: 'none' }))).toBeNull();
  });
});

describe('contractorInvoiceKey', () => {
  const h = (supplier: string, number = '15', date = '02.11.2026') =>
    draft([], { supplier, number, date }).header;
  it('gives the same key for supplier spellings differing in case, spaces and quotes', () => {
    expect(contractorInvoiceKey(h('ООО "Ромашка"'))).toBe(contractorInvoiceKey(h('ооо  «ромашка»')));
  });
  it('gives a different key for a different invoice number', () => {
    expect(contractorInvoiceKey(h('ООО Ромашка', '15'))).not.toBe(contractorInvoiceKey(h('ООО Ромашка', '16')));
  });
});

describe('contractorInvoicePrompt', () => {
  it('is a non-empty prompt that asks for JSON', () => {
    const p = contractorInvoicePrompt();
    expect(p.length).toBeGreaterThan(0);
    expect(p).toContain('JSON');
  });
});

describe('supplyTotalKopecks (item 97 ticket 05: ticked lines only)', () => {
  const five = () => [
    line({ sum: '100,00' }), line({ sum: '200,50' }), line({ sum: '300,00' }), line({ sum: '1 000,00' }), line({ sum: '0,25' }),
  ];
  it('equals the sum of all lines when every line is ticked or toSupply is absent', () => {
    const lines = five();
    lines[1].toSupply = true;
    expect(supplyTotalKopecks(draft(lines))).toBe(160075);
  });
  it('skips two unticked lines out of five', () => {
    const lines = five();
    lines[3].toSupply = false;
    lines[1].toSupply = false;
    expect(supplyTotalKopecks(draft(lines))).toBe(10000 + 30000 + 25);
  });
  it('is 0 when no line is ticked', () => {
    expect(supplyTotalKopecks(draft(five().map((l) => ({ ...l, toSupply: false }))))).toBe(0);
  });
  it('is null when a ticked line has an unparseable sum', () => {
    const lines = five();
    lines[2].sum = 'abc';
    expect(supplyTotalKopecks(draft(lines))).toBeNull();
  });
  it('ignores an unparseable sum on an UNticked line', () => {
    const lines = five();
    lines[2] = { ...lines[2], sum: 'abc', toSupply: false };
    expect(supplyTotalKopecks(draft(lines))).toBe(10000 + 20050 + 100000 + 25);
  });
});

describe('checkContractorInvoice with unticked lines (toSupply is ignored)', () => {
  it('is ok when the whole invoice sums and counts, though some lines are unticked', () => {
    const d = draft(
      [line({ sum: '100,00' }), line({ price: '50,00', sum: '50,00', toSupply: false }), line({ price: '25,00', sum: '25,00', toSupply: false })],
      { total: '175,00' },
    );
    const r = checkContractorInvoice(d);
    expect(r.ok).toBe(true);
    expect(r.headerErrors).toEqual([]);
  });
  it('still fails when the total equals only the sum of all lines together with the unticked ones removed', () => {
    const d = draft(
      [line({ price: '20 000,00', sum: '20 000,00' }), line({ price: '715,07', sum: '715,07', toSupply: false })],
      { total: '20 000,00' },
    );
    expect(checkContractorInvoice(d).ok).toBe(false);
  });
  it('still fails when the item count counts only ticked lines', () => {
    const d = draft([line(), line({ toSupply: false })], { total: '200,00', itemCount: '1' });
    expect(checkContractorInvoice(d).ok).toBe(false);
  });
  it('gives the same answer for the same invoice with and without toSupply flags', () => {
    const base = [line({ sum: '100,00' }), line({ price: '50,00', sum: '50,00' })];
    const flagged = base.map((l, i) => ({ ...l, toSupply: i === 0 }));
    expect(checkContractorInvoice(draft(flagged, { total: '150,00' }))).toEqual(checkContractorInvoice(draft(base, { total: '150,00' })));
  });
});

describe('contractorInvoiceNormalise and toSupply', () => {
  it('never sets toSupply on AI-read lines', () => {
    const out = contractorInvoiceNormalise({ header: { number: '1' }, lines: [{ name: 'Услуга', qty: 1, unit: 'шт', price: 100, sum: 100 }] } as never);
    expect(out).not.toBeNull();
    expect(out!.lines.length).toBeGreaterThan(0);
    for (const l of out!.lines) expect('toSupply' in l && l.toSupply !== undefined).toBe(false);
  });
});
