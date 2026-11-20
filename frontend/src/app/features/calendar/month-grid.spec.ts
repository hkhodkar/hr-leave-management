import { describe, expect, it } from 'vitest';
import { Absence } from '../../core/models/hr.models';
import { buildMonth, shortName } from './month-grid';

const absence = (start: string, end: string, extra: Partial<Absence> = {}): Absence => ({
  request_id: 1,
  employee: { id: 7, name: 'Aisha Rahman', job_title: 'Engineer', department_id: 1 },
  leave_type: { id: 1, code: 'annual', name: 'Annual leave', color: '#2563eb' },
  start_date: start,
  end_date: end,
  half_day_start: false,
  half_day_end: false,
  days: 1,
  status: 'approved',
  ...extra,
});

describe('buildMonth', () => {
  const weeks = buildMonth(
    {
      year: 2026,
      month: 4,
      holidays: [{ date: '2026-04-03', name: 'Good Friday' }],
      absences: [absence('2026-04-01', '2026-04-07', { half_day_end: true })],
    },
    '2026-04-02',
  );
  const day = (date: string) => weeks.flat().find((d) => d.date === date)!;

  it('starts on the Monday before the 1st and ends on a Sunday', () => {
    expect(weeks[0][0].date).toBe('2026-03-30');
    expect(weeks.at(-1)!.at(-1)!.date).toBe('2026-05-03');
    expect(weeks.every((w) => w.length === 7)).toBe(true);
  });

  it('puts absences on working days only', () => {
    expect(day('2026-04-01').entries).toHaveLength(1);
    expect(day('2026-04-03').entries).toHaveLength(0); // bank holiday
    expect(day('2026-04-04').entries).toHaveLength(0); // Saturday
    expect(day('2026-03-31').entries).toHaveLength(0); // outside the month
    expect(day('2026-04-07').entries[0].half).toBe('morning');
    expect(day('2026-04-02').today).toBe(true);
    expect(day('2026-04-03').holiday).toBe('Good Friday');
  });

  it('shortens names for chips', () => {
    expect(shortName('Aisha Rahman')).toBe('Aisha R.');
    expect(shortName('Cher')).toBe('Cher');
  });
});
