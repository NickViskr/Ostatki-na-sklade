import { describe, expect, it } from 'vitest';
import { isoWeekLabel, selectableWeeks } from './isoWeek';

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
