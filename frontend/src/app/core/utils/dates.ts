// Calendar dates travel as ISO strings (YYYY-MM-DD). The math below works in UTC
// so a date never shifts by a day because of the user's timezone.

const DAY_MS = 24 * 60 * 60 * 1000;

export function parseIsoDate(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function isoDate(year: number, month: number, day: number): string {
  return toIsoDate(new Date(Date.UTC(year, month - 1, day)));
}

/** Today in the user's own timezone. */
export function todayIso(now: Date = new Date()): string {
  return isoDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export function addDays(iso: string, days: number): string {
  return toIsoDate(new Date(parseIsoDate(iso).getTime() + days * DAY_MS));
}

export function daysBetween(from: string, to: string): number {
  return Math.round((parseIsoDate(to).getTime() - parseIsoDate(from).getTime()) / DAY_MS);
}

/** Day number since 1970-01-01, handy for comparing and slotting dates. */
export function dayNumber(iso: string): number {
  return Math.round(parseIsoDate(iso).getTime() / DAY_MS);
}

/** 0 = Monday ... 6 = Sunday, like Python's date.weekday(). */
export function weekday(iso: string): number {
  return (parseIsoDate(iso).getUTCDay() + 6) % 7;
}

export function yearOf(iso: string): number {
  return Number(iso.slice(0, 4));
}

export function startOfWeek(iso: string): string {
  return addDays(iso, -weekday(iso));
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
