import { Holiday } from '../models/hr.models';
import { addDays, dayNumber, isoDate, weekday } from './dates';

// Same rules as backend/app/workdays.py, so the request form can show the
// number of days a request costs before it is sent.

export function easterSunday(year: number): string {
  // anonymous Gregorian algorithm
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const m = (32 + 2 * e + 2 * i - h - k) % 7;
  const n = Math.floor((a + 11 * h + 22 * m) / 451);
  const month = Math.floor((h + m - 7 * n + 114) / 31);
  const day = ((h + m - 7 * n + 114) % 31) + 1;
  return isoDate(year, month, day);
}

function firstMonday(year: number, month: number): string {
  const first = isoDate(year, month, 1);
  return addDays(first, (7 - weekday(first)) % 7);
}

function lastMonday(year: number, month: number): string {
  const last = addDays(isoDate(year, month + 1, 1), -1);
  return addDays(last, -weekday(last));
}

/** Bank holidays for England and Wales, moved to the next free weekday when needed. */
export function publicHolidays(year: number): Holiday[] {
  const easter = easterSunday(year);
  const holidays: Holiday[] = [];
  const taken = new Set<string>();
  const observed = (date: string, name: string) => {
    while (weekday(date) >= 5 || taken.has(date)) {
      date = addDays(date, 1);
    }
    taken.add(date);
    holidays.push({ date, name });
  };

  observed(isoDate(year, 1, 1), "New Year's Day");
  holidays.push({ date: addDays(easter, -2), name: 'Good Friday' });
  holidays.push({ date: addDays(easter, 1), name: 'Easter Monday' });
  holidays.push({ date: firstMonday(year, 5), name: 'Early May bank holiday' });
  holidays.push({ date: lastMonday(year, 5), name: 'Spring bank holiday' });
  holidays.push({ date: lastMonday(year, 8), name: 'Summer bank holiday' });
  observed(isoDate(year, 12, 25), 'Christmas Day');
  observed(isoDate(year, 12, 26), 'Boxing Day');
  return holidays.sort((x, y) => (x.date < y.date ? -1 : 1));
}

export type HolidaySet = ReadonlySet<string>;

export function isWorkingDay(date: string, holidays: HolidaySet): boolean {
  return weekday(date) < 5 && !holidays.has(date);
}

/** Days of leave a request costs: weekdays minus holidays, halves counted as 0.5. */
export function workingDays(
  start: string,
  end: string,
  holidays: HolidaySet,
  halfDayStart = false,
  halfDayEnd = false,
): number {
  if (end < start) return 0;
  let total = 0;
  for (let day = start; day <= end; day = addDays(day, 1)) {
    if (isWorkingDay(day, holidays)) total += 1;
  }
  if (start === end) {
    return total && (halfDayStart || halfDayEnd) ? 0.5 : total;
  }
  if (halfDayStart && isWorkingDay(start, holidays)) total -= 0.5;
  if (halfDayEnd && isWorkingDay(end, holidays)) total -= 0.5;
  return total;
}

/** Move `count` working days forward (or back when negative). */
export function addWorkingDays(start: string, count: number, holidays: HolidaySet): string {
  const step = count >= 0 ? 1 : -1;
  let remaining = Math.abs(count);
  let day = start;
  while (remaining > 0) {
    day = addDays(day, step);
    if (isWorkingDay(day, holidays)) remaining -= 1;
  }
  return day;
}

export function nextWorkingDay(day: string, holidays: HolidaySet): string {
  while (!isWorkingDay(day, holidays)) {
    day = addDays(day, 1);
  }
  return day;
}

export type HalfDaySpan = readonly [number, number];

/** The request as an inclusive range of half-day slots (morning, afternoon). */
export function halfDaySpan(
  start: string,
  end: string,
  halfDayStart: boolean,
  halfDayEnd: boolean,
): HalfDaySpan {
  return [dayNumber(start) * 2 + (halfDayStart ? 1 : 0), dayNumber(end) * 2 + (halfDayEnd ? 0 : 1)];
}

export function spansOverlap(a: HalfDaySpan, b: HalfDaySpan): boolean {
  return a[0] <= b[1] && b[0] <= a[1];
}

export function roundHalf(value: number): number {
  return Math.floor(value * 2 + 0.5) / 2;
}

/** Yearly allowance, prorated by month for people who join during the year. */
export function entitlement(
  allowance: number | null,
  startDate: string,
  year: number,
): number | null {
  if (allowance === null) return null;
  const startYear = Number(startDate.slice(0, 4));
  if (startYear > year) return 0;
  if (startYear < year) return allowance;
  const months = 12 - Number(startDate.slice(5, 7)) + 1;
  return roundHalf((allowance * months) / 12);
}
