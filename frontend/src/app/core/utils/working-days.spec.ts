import { describe, expect, it } from 'vitest';
import {
  addWorkingDays,
  easterSunday,
  entitlement,
  halfDaySpan,
  publicHolidays,
  spansOverlap,
  workingDays,
} from './working-days';

const holidays2026 = new Set(publicHolidays(2026).map((h) => h.date));

describe('public holidays', () => {
  it('finds Easter', () => {
    expect(easterSunday(2026)).toBe('2026-04-05');
    expect(easterSunday(2027)).toBe('2027-03-28');
  });

  it('lists the 2026 bank holidays with the Boxing Day substitute', () => {
    expect(publicHolidays(2026).map((h) => h.date)).toEqual([
      '2026-01-01',
      '2026-04-03',
      '2026-04-06',
      '2026-05-04',
      '2026-05-25',
      '2026-08-31',
      '2026-12-25',
      '2026-12-28',
    ]);
  });

  it('moves Christmas and Boxing Day off a weekend', () => {
    const december = publicHolidays(2027).filter((h) => h.date.startsWith('2027-12'));
    expect(december.map((h) => h.date)).toEqual(['2027-12-27', '2027-12-28']);
  });
});

describe('workingDays', () => {
  it('skips weekends and bank holidays', () => {
    // two weeks around Easter: 10 weekdays minus Good Friday and Easter Monday
    expect(workingDays('2026-03-30', '2026-04-10', holidays2026)).toBe(8);
  });

  it('is zero for a weekend or a reversed range', () => {
    expect(workingDays('2026-03-07', '2026-03-08', holidays2026)).toBe(0);
    expect(workingDays('2026-03-10', '2026-03-09', holidays2026)).toBe(0);
  });

  it('counts half days', () => {
    expect(workingDays('2026-03-02', '2026-03-02', holidays2026, false, true)).toBe(0.5);
    expect(workingDays('2026-03-02', '2026-03-02', holidays2026, true, false)).toBe(0.5);
    expect(workingDays('2026-03-02', '2026-03-04', holidays2026, true, true)).toBe(2);
  });

  it('does not take a half day off a weekend', () => {
    expect(workingDays('2026-03-07', '2026-03-10', holidays2026, true)).toBe(2);
  });

  it('adds working days in both directions', () => {
    expect(addWorkingDays('2026-04-02', 1, holidays2026)).toBe('2026-04-07');
    expect(addWorkingDays('2026-04-07', -1, holidays2026)).toBe('2026-04-02');
  });
});

describe('half-day overlaps', () => {
  it('lets a morning and an afternoon share a day', () => {
    const morning = halfDaySpan('2026-03-10', '2026-03-10', false, true);
    const afternoon = halfDaySpan('2026-03-10', '2026-03-10', true, false);
    const fullDay = halfDaySpan('2026-03-10', '2026-03-10', false, false);
    expect(spansOverlap(morning, afternoon)).toBe(false);
    expect(spansOverlap(morning, fullDay)).toBe(true);
  });
});

describe('entitlement', () => {
  it('prorates the first year to the nearest half day', () => {
    expect(entitlement(25, '2026-04-14', 2026)).toBe(19);
    expect(entitlement(25, '2026-07-01', 2026)).toBe(12.5);
    expect(entitlement(25, '2026-04-14', 2027)).toBe(25);
    expect(entitlement(null, '2020-01-01', 2026)).toBeNull();
  });
});
