import { parseIsoDate } from './dates';

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');
}

/** Deterministic avatar color so the same person always gets the same one. */
export function avatarColor(seed: string): string {
  let hash = 0;
  for (const char of seed) {
    hash = (hash * 31 + char.charCodeAt(0)) | 0;
  }
  return `hsl(${Math.abs(hash) % 360} 45% 44%)`;
}

export function formatDays(days: number): string {
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

const dayMonth = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
const fullDate = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
const weekdayDate = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
const dateTime = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatDate(iso: string, style: 'short' | 'full' | 'weekday' = 'full'): string {
  const date = parseIsoDate(iso);
  if (style === 'short') return dayMonth.format(date);
  if (style === 'weekday') return weekdayDate.format(date);
  return fullDate.format(date);
}

/** "3 Mar 2026", "3 – 7 Mar 2026" or "28 Feb – 3 Mar 2026". */
export function formatDateRange(start: string, end: string): string {
  if (start === end) return formatDate(start);
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  const sameMonth = sameYear && start.slice(5, 7) === end.slice(5, 7);
  if (sameMonth) return `${Number(start.slice(8))} – ${formatDate(end)}`;
  if (sameYear) return `${formatDate(start, 'short')} – ${formatDate(end)}`;
  return `${formatDate(start)} – ${formatDate(end)}`;
}

/** Which part of the day a request covers, e.g. "Morning" or "Ends at midday". */
export function halfDayLabel(request: {
  start_date: string;
  end_date: string;
  half_day_start: boolean;
  half_day_end: boolean;
}): string | null {
  if (request.start_date === request.end_date) {
    if (request.half_day_start) return 'Afternoon';
    if (request.half_day_end) return 'Morning';
    return null;
  }
  const parts = [];
  if (request.half_day_start) parts.push('starts after lunch');
  if (request.half_day_end) parts.push('ends at midday');
  if (!parts.length) return null;
  const text = parts.join(', ');
  return text[0].toUpperCase() + text.slice(1);
}

/** Timestamps from the API are UTC. */
export function formatTimestamp(value: string): string {
  const zoned = /[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`;
  return dateTime.format(new Date(zoned));
}
