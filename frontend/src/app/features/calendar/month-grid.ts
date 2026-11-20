import { Absence, CalendarMonth } from '../../core/models/hr.models';
import { addDays, daysInMonth, isoDate, startOfWeek, weekday } from '../../core/utils/dates';

export interface CalendarEntry {
  absence: Absence;
  /** set when only half of this day is taken */
  half: 'morning' | 'afternoon' | null;
}

export interface CalendarDay {
  date: string;
  day: number;
  inMonth: boolean;
  weekend: boolean;
  today: boolean;
  holiday: string | null;
  entries: CalendarEntry[];
}

function halfOf(absence: Absence, date: string): CalendarEntry['half'] {
  if (date === absence.start_date && absence.half_day_start) return 'afternoon';
  if (date === absence.end_date && absence.half_day_end) return 'morning';
  return null;
}

/** Monday-first weeks covering the month, with who is off on each working day. */
export function buildMonth(data: CalendarMonth, today: string): CalendarDay[][] {
  const first = isoDate(data.year, data.month, 1);
  const last = isoDate(data.year, data.month, daysInMonth(data.year, data.month));
  const holidays = new Map(data.holidays.map((h) => [h.date, h.name]));
  const weeks: CalendarDay[][] = [];
  let week: CalendarDay[] = [];
  for (let date = startOfWeek(first); date <= last || week.length > 0; date = addDays(date, 1)) {
    const weekend = weekday(date) >= 5;
    const holiday = holidays.get(date) ?? null;
    const inMonth = date >= first && date <= last;
    week.push({
      date,
      day: Number(date.slice(8)),
      inMonth,
      weekend,
      today: date === today,
      holiday,
      // nobody is "off" on days nobody works
      entries:
        inMonth && !weekend && !holiday
          ? data.absences
              .filter((a) => a.start_date <= date && a.end_date >= date)
              .map((absence) => ({ absence, half: halfOf(absence, date) }))
          : [],
    });
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  }
  return weeks;
}

export function shortName(name: string): string {
  const parts = name.split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : name;
}
