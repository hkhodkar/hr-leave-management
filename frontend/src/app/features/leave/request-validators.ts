import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';
import { Balance, LeaveRequest, LeaveRequestInput, LeaveType } from '../../core/models/hr.models';
import { addDays, yearOf } from '../../core/utils/dates';
import { HolidaySet, halfDaySpan, spansOverlap, workingDays } from '../../core/utils/working-days';

export type DayPart = 'full' | 'morning' | 'afternoon';

export interface LeaveFormValue {
  leave_type_id: number | null;
  start_date: string;
  end_date: string;
  /** used when the request is a single day */
  day_part: DayPart;
  /** used for longer requests */
  half_day_start: boolean;
  half_day_end: boolean;
  reason: string;
}

/** Everything the form checks a request against before it is sent. */
export interface LeaveFormContext {
  today: string;
  holidays: HolidaySet;
  leaveTypes: readonly LeaveType[];
  /** balances of the person booking, for every year they might book in */
  balances: readonly Balance[];
  /** their pending and approved requests */
  existing: readonly LeaveRequest[];
}

export const SICK_BACKDATE_DAYS = 30;

/** The API payload for a form value, or null while dates or type are missing. */
export function toRequestInput(value: LeaveFormValue): LeaveRequestInput | null {
  const { leave_type_id, start_date, end_date } = value;
  if (leave_type_id === null || !start_date || !end_date) return null;
  const singleDay = start_date === end_date;
  return {
    leave_type_id,
    start_date,
    end_date,
    half_day_start: singleDay ? value.day_part === 'afternoon' : value.half_day_start,
    half_day_end: singleDay ? value.day_part === 'morning' : value.half_day_end,
    reason: value.reason.trim() || null,
  };
}

/** Working days the request would cost, 0 when the dates are not usable yet. */
export function requestedDays(input: LeaveRequestInput | null, holidays: HolidaySet): number {
  if (!input || input.end_date < input.start_date) return 0;
  return workingDays(
    input.start_date,
    input.end_date,
    holidays,
    input.half_day_start,
    input.half_day_end,
  );
}

function inputOf(control: AbstractControl): LeaveRequestInput | null {
  return toRequestInput(control.value as LeaveFormValue);
}

/** End must not be before start, and a request stays inside one leave year. */
export const dateRangeValidator: ValidatorFn = (control) => {
  const { start_date, end_date } = control.value as LeaveFormValue;
  if (!start_date || !end_date) return null;
  if (end_date < start_date) return { dateOrder: true };
  if (yearOf(start_date) !== yearOf(end_date)) return { crossYear: true };
  return null;
};

/** Only sick leave may be booked after the fact, and only for a month back. */
export function pastDateValidator(context: () => LeaveFormContext): ValidatorFn {
  return (control) => {
    const input = inputOf(control);
    const ctx = context();
    if (!input || input.start_date >= ctx.today) return null;
    const type = ctx.leaveTypes.find((t) => t.id === input.leave_type_id);
    if (type?.code !== 'sick') return { pastDate: true };
    if (input.start_date < addDays(ctx.today, -SICK_BACKDATE_DAYS)) return { backdateLimit: true };
    return null;
  };
}

export function workingDaysValidator(context: () => LeaveFormContext): ValidatorFn {
  return (control) => {
    const input = inputOf(control);
    if (!input || input.end_date < input.start_date) return null;
    return requestedDays(input, context().holidays) > 0 ? null : { noWorkingDays: true };
  };
}

/** The new request may not share a half day with a pending or approved one. */
export function overlapValidator(context: () => LeaveFormContext): ValidatorFn {
  return (control) => {
    const input = inputOf(control);
    if (!input || input.end_date < input.start_date) return null;
    const span = halfDaySpan(
      input.start_date,
      input.end_date,
      input.half_day_start,
      input.half_day_end,
    );
    const clash = context().existing.find(
      (r) =>
        (r.status === 'pending' || r.status === 'approved') &&
        spansOverlap(span, halfDaySpan(r.start_date, r.end_date, r.half_day_start, r.half_day_end)),
    );
    return clash
      ? { overlap: { start: clash.start_date, end: clash.end_date, status: clash.status } }
      : null;
  };
}

/** Enough days left of the chosen type in that year (unpaid leave has no limit). */
export function balanceValidator(context: () => LeaveFormContext): ValidatorFn {
  return (control) => {
    const input = inputOf(control);
    if (!input) return null;
    const ctx = context();
    const balance = ctx.balances.find(
      (b) => b.leave_type.id === input.leave_type_id && b.year === yearOf(input.start_date),
    );
    if (!balance || balance.remaining === null) return null;
    const requested = requestedDays(input, ctx.holidays);
    return requested > balance.remaining
      ? { balance: { requested, remaining: Math.max(balance.remaining, 0) } }
      : null;
  };
}

export function leaveRequestValidators(context: () => LeaveFormContext): ValidatorFn[] {
  return [
    dateRangeValidator,
    pastDateValidator(context),
    workingDaysValidator(context),
    overlapValidator(context),
    balanceValidator(context),
  ];
}

/** Single sentence for the first problem of the form, in the order a user fixes them. */
export function leaveErrorMessage(errors: ValidationErrors | null): string | null {
  if (!errors) return null;
  if (errors['dateOrder']) return "The end date can't be before the start date.";
  if (errors['crossYear']) return 'A request has to stay within one year. Please split it in two.';
  if (errors['pastDate']) return 'Only sick leave can be booked for past dates.';
  if (errors['backdateLimit'])
    return `Sick leave can be backdated by up to ${SICK_BACKDATE_DAYS} days.`;
  if (errors['noWorkingDays']) return 'These dates fall on a weekend or bank holiday.';
  if (errors['overlap']) return 'You already have leave booked on some of these days.';
  if (errors['balance']) {
    const { requested, remaining } = errors['balance'] as { requested: number; remaining: number };
    return `That's ${requested} days, but you only have ${remaining} left.`;
  }
  return null;
}
