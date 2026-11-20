import { FormControl, FormGroup } from '@angular/forms';
import { describe, expect, it } from 'vitest';
import { Balance, LeaveRequest } from '../../core/models/hr.models';
import { publicHolidays } from '../../core/utils/working-days';
import { LEAVE_TYPES } from '../../core/mock/seed';
import {
  DayPart,
  LeaveFormContext,
  LeaveFormValue,
  leaveErrorMessage,
  leaveRequestValidators,
  toRequestInput,
} from './request-validators';

const annual = LEAVE_TYPES[0];
const sick = LEAVE_TYPES[1];
const unpaid = LEAVE_TYPES[3];

function balance(typeIndex: number, remaining: number | null, year = 2026): Balance {
  const { yearly_allowance, ...ref } = LEAVE_TYPES[typeIndex];
  return { leave_type: ref, year, entitled: yearly_allowance, used: 0, pending: 0, remaining };
}

function booked(start: string, end: string, extra: Partial<LeaveRequest> = {}): LeaveRequest {
  const { yearly_allowance: _, ...type } = annual;
  return {
    id: 1,
    employee: { id: 3, name: 'Eve', job_title: 'Engineer', department_id: 1 },
    leave_type: type,
    start_date: start,
    end_date: end,
    half_day_start: false,
    half_day_end: false,
    days: 1,
    reason: null,
    status: 'approved',
    created_at: '2026-02-01T09:00:00Z',
    decided_at: null,
    decided_by: null,
    decision_comment: null,
    can_cancel: true,
    can_decide: false,
    ...extra,
  };
}

let context: LeaveFormContext = {
  today: '2026-03-02',
  holidays: new Set(publicHolidays(2026).map((h) => h.date)),
  leaveTypes: LEAVE_TYPES,
  balances: [balance(0, 5), balance(1, 10), balance(3, null)],
  existing: [booked('2026-03-16', '2026-03-18', { half_day_end: true })],
};

function errorsFor(value: Partial<LeaveFormValue>) {
  const form = new FormGroup(
    {
      leave_type_id: new FormControl<number | null>(annual.id),
      start_date: new FormControl(''),
      end_date: new FormControl(''),
      day_part: new FormControl<DayPart>('full'),
      half_day_start: new FormControl(false),
      half_day_end: new FormControl(false),
      reason: new FormControl(''),
    },
    { validators: leaveRequestValidators(() => context) },
  );
  form.patchValue(value);
  return form.errors;
}

describe('toRequestInput', () => {
  it('maps the day part of a single day to half-day flags', () => {
    const base: LeaveFormValue = {
      leave_type_id: 1,
      start_date: '2026-03-10',
      end_date: '2026-03-10',
      day_part: 'morning',
      half_day_start: true,
      half_day_end: false,
      reason: '  ',
    };
    expect(toRequestInput(base)).toMatchObject({
      half_day_start: false,
      half_day_end: true,
      reason: null,
    });
    expect(toRequestInput({ ...base, day_part: 'afternoon' })).toMatchObject({
      half_day_start: true,
      half_day_end: false,
    });
    expect(toRequestInput({ ...base, end_date: '2026-03-11' })).toMatchObject({
      half_day_start: true,
      half_day_end: false,
    });
    expect(toRequestInput({ ...base, start_date: '' })).toBeNull();
  });
});

describe('leave request validators', () => {
  it('accepts a normal request', () => {
    expect(errorsFor({ start_date: '2026-03-09', end_date: '2026-03-10' })).toBeNull();
  });

  it('rejects an end date before the start', () => {
    expect(errorsFor({ start_date: '2026-03-10', end_date: '2026-03-09' })).toEqual({
      dateOrder: true,
    });
  });

  it('keeps a request inside one leave year', () => {
    expect(errorsFor({ start_date: '2026-12-30', end_date: '2027-01-04' })).toMatchObject({
      crossYear: true,
    });
  });

  it('only lets sick leave go into the past', () => {
    expect(errorsFor({ start_date: '2026-02-26', end_date: '2026-02-26' })).toEqual({
      pastDate: true,
    });
    expect(
      errorsFor({ leave_type_id: sick.id, start_date: '2026-02-26', end_date: '2026-02-26' }),
    ).toBeNull();
    expect(
      errorsFor({ leave_type_id: sick.id, start_date: '2026-01-05', end_date: '2026-01-05' }),
    ).toEqual({ backdateLimit: true });
  });

  it('needs at least one working day', () => {
    // Good Friday to Easter Monday
    expect(errorsFor({ start_date: '2026-04-03', end_date: '2026-04-06' })).toEqual({
      noWorkingDays: true,
    });
  });

  it('finds overlaps with booked leave but allows the free afternoon', () => {
    expect(errorsFor({ start_date: '2026-03-13', end_date: '2026-03-16' })).toEqual({
      overlap: { start: '2026-03-16', end: '2026-03-18', status: 'approved' },
    });
    expect(
      errorsFor({ start_date: '2026-03-18', end_date: '2026-03-18', day_part: 'afternoon' }),
    ).toBeNull();
  });

  it('ignores cancelled and rejected requests', () => {
    const before = context;
    context = {
      ...context,
      existing: [booked('2026-03-09', '2026-03-09', { status: 'cancelled' })],
    };
    expect(errorsFor({ start_date: '2026-03-09', end_date: '2026-03-09' })).toBeNull();
    context = before;
  });

  it('checks the remaining balance', () => {
    const errors = errorsFor({ start_date: '2026-03-02', end_date: '2026-03-09' });
    expect(errors).toEqual({ balance: { requested: 6, remaining: 5 } });
    expect(leaveErrorMessage(errors)).toBe("That's 6 days, but you only have 5 left.");
    // starting a day later with a half day fits
    expect(
      errorsFor({ start_date: '2026-03-03', end_date: '2026-03-09', half_day_start: true }),
    ).toBeNull();
  });

  it('has no limit for unpaid leave', () => {
    expect(
      errorsFor({ leave_type_id: unpaid.id, start_date: '2026-06-01', end_date: '2026-07-31' }),
    ).toBeNull();
  });
});
