import { describe, expect, it } from 'vitest';
import { invoiceWeekOptions, isoWeekLabel, selectableWeeks, serviceWeekOfInvoice, weekFilterOptions } from './isoWeek';

// Expected values are fixed strings and must not depend on the machine zone (TZ=UTC and TZ=Asia/Yekaterinburg).
describe('isoWeekLabel', () => {
  it('formats 2026-W44 as number plus Monday-Sunday range', () => {
    expect(isoWeekLabel('2026-W44')).toBe('44 · 26.10–01.11');
  });
  it('formats a 53-week year across the New Year', () => {
    expect(isoWeekLabel('2026-W53')).toBe('53 · 28.12–03.01');
  });
  it('keeps a two-digit week number for week 1', () => {
    expect(isoWeekLabel('2027-W01')).toBe('01 · 04.01–10.01');
  });
});

describe('selectableWeeks', () => {
  const ms = (iso: string) => Date.parse(iso);
  it('on Monday 01:30 Ekb (still Sunday in UTC) the current week is W45 and the list ends at W46, newest first', () => {
    expect(selectableWeeks(ms('2026-11-01T20:30:00Z'))).toEqual(['2026-W46', '2026-W45', '2026-W44', '2026-W43']);
  });
  it('on Sunday 23:00 Ekb the current week is still W44, so the list starts at W45', () => {
    expect(selectableWeeks(ms('2026-11-01T18:00:00Z'))).toEqual(['2026-W45', '2026-W44', '2026-W43']);
  });
  it('in the first week of the range (W43) the list is W44 then W43', () => {
    expect(selectableWeeks(ms('2026-10-21T10:00:00Z'))).toEqual(['2026-W44', '2026-W43']);
  });
});

describe('weekFilterOptions', () => {
  const now = Date.parse('2026-11-03T10:00:00Z');
  it('with no weeks on postings returns W45..W43 up to the current week, newest first', () => {
    expect(weekFilterOptions([], now)).toEqual(['2026-W45', '2026-W44', '2026-W43']);
  });
  it('keeps an earlier posting week once, lists duplicates once and drops weeks after the current one', () => {
    expect(weekFilterOptions(['2026-W42', '2026-W44', '2026-W46'], now)).toEqual([
      '2026-W45', '2026-W44', '2026-W43', '2026-W42',
    ]);
  });
  it('switches the newest option at the Ekaterinburg Monday boundary', () => {
    expect(weekFilterOptions([], Date.parse('2026-11-08T18:59:59Z'))[0]).toBe('2026-W45');
    expect(weekFilterOptions([], Date.parse('2026-11-08T19:00:00Z'))[0]).toBe('2026-W46');
  });
});

describe('serviceWeekOfInvoice', () => {
  it('takes the ISO week before the invoice day: Monday 02.11.2026 -> 2026-W44', () => {
    expect(serviceWeekOfInvoice('02.11.2026')).toBe('2026-W44');
  });
  it('26.10.2026 -> 2026-W43', () => {
    expect(serviceWeekOfInvoice('26.10.2026')).toBe('2026-W43');
  });
  it('05.01.2026 -> 2026-W01 (day 29.12.2025 belongs to the next ISO year)', () => {
    expect(serviceWeekOfInvoice('05.01.2026')).toBe('2026-W01');
  });
  it('04.01.2027 -> 2026-W53', () => {
    expect(serviceWeekOfInvoice('04.01.2027')).toBe('2026-W53');
  });
  it('returns empty text for a non-existent date and for garbage', () => {
    expect(serviceWeekOfInvoice('31.02.2026')).toBe('');
    expect(serviceWeekOfInvoice('abc')).toBe('');
  });
});

describe('invoiceWeekOptions', () => {
  it('lists W43 up to the current Ekb week, newest first', () => {
    expect(invoiceWeekOptions(Date.parse('2026-11-03T12:00:00Z'))).toEqual(['2026-W45', '2026-W44', '2026-W43']);
  });
  it('starts with W45 on Monday 01:00 Ekb (still Sunday in UTC)', () => {
    expect(invoiceWeekOptions(Date.parse('2026-11-01T20:00:00Z'))[0]).toBe('2026-W45');
  });
});
