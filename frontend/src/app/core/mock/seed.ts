import { Holiday, LeaveCode, LeaveStatus, LeaveType, Role } from '../models/hr.models';
import { addDays, daysBetween, todayIso, yearOf } from '../utils/dates';
import {
  addWorkingDays,
  entitlement,
  halfDaySpan,
  nextWorkingDay,
  publicHolidays,
  spansOverlap,
  workingDays,
} from '../utils/working-days';
import { Rng } from './rng';

// A port of backend/app/seed.py: same people, same steps, same random numbers.

export interface DepartmentRow {
  id: number;
  name: string;
}

export interface EmployeeRow {
  id: number;
  name: string;
  email: string;
  job_title: string;
  department_id: number;
  manager_id: number | null;
  role: Role;
  start_date: string;
  created_at: string;
}

export interface RequestRow {
  id: number;
  employee_id: number;
  leave_type_id: number;
  start_date: string;
  end_date: string;
  half_day_start: boolean;
  half_day_end: boolean;
  days: number;
  reason: string | null;
  status: LeaveStatus;
  created_at: string;
  decided_at: string | null;
  decided_by_id: number | null;
  decision_comment: string | null;
}

export interface EventRow {
  id: number;
  request_id: number;
  action: 'submitted' | 'approved' | 'rejected' | 'cancelled';
  actor_id: number;
  comment: string | null;
  created_at: string;
}

export interface MockData {
  departments: DepartmentRow[];
  employees: EmployeeRow[];
  leave_types: LeaveType[];
  holidays: Holiday[];
  requests: RequestRow[];
  events: EventRow[];
}

const DEPARTMENTS = [
  'Engineering',
  'Product & Design',
  'Sales',
  'Marketing',
  'People & Operations',
];

export const LEAVE_TYPES: LeaveType[] = [
  { id: 1, code: 'annual', name: 'Annual leave', color: '#2563eb', yearly_allowance: 25 },
  { id: 2, code: 'sick', name: 'Sick leave', color: '#e5484d', yearly_allowance: 10 },
  { id: 3, code: 'parental', name: 'Parental & family', color: '#8b5cf6', yearly_allowance: 15 },
  { id: 4, code: 'unpaid', name: 'Unpaid leave', color: '#d97706', yearly_allowance: null },
];

type Person = [string, string, number, number | null, Role, string];

// name, job title, department, manager id, role, start date ("{Y}" is the current year)
const EMPLOYEES: Person[] = [
  ['Olivia Bennett', 'Head of People', 5, null, 'hr', '2019-03-04'],
  ['Daniel Kim', 'Engineering Manager', 1, null, 'manager', '2018-06-11'],
  ['Priya Raman', 'Head of Product', 2, null, 'manager', '2020-01-13'],
  ['Marcus Johnson', 'Sales Director', 3, null, 'manager', '2019-09-02'],
  ['Sofia Martinez', 'Marketing Lead', 4, null, 'manager', '2021-02-01'],
  ["Liam O'Connor", 'Senior Backend Engineer', 1, 2, 'employee', '2020-05-18'],
  ['Aisha Rahman', 'Frontend Engineer', 1, 2, 'employee', '2022-08-01'],
  ['Tomás Silva', 'DevOps Engineer', 1, 2, 'employee', '2021-11-15'],
  ['Hannah Weber', 'QA Engineer', 1, 2, 'employee', '2023-03-06'],
  ['Kenji Watanabe', 'Backend Engineer', 1, 2, 'employee', '2024-01-08'],
  ['Emma Lindqvist', 'Junior Frontend Engineer', 1, 2, 'employee', '{Y}-04-14'],
  ['Noah Fischer', 'Product Manager', 2, 3, 'employee', '2021-06-21'],
  ['Chloe Dubois', 'Product Designer', 2, 3, 'employee', '2022-02-14'],
  ['Ravi Patel', 'UX Researcher', 2, 3, 'employee', '2023-09-04'],
  ['Isabella Rossi', 'UI Designer', 2, 3, 'employee', '2024-05-20'],
  ['Ethan Clarke', 'Account Executive', 3, 4, 'employee', '2020-10-05'],
  ['Mia Novak', 'Account Executive', 3, 4, 'employee', '2022-04-25'],
  ['Lucas Moreau', 'Sales Development Rep', 3, 4, 'employee', '2024-07-01'],
  ['Grace Okafor', 'Customer Success Manager', 3, 4, 'employee', '2021-03-15'],
  ['Ava Thompson', 'Content Marketer', 4, 5, 'employee', '2022-10-10'],
  ['Mateo García', 'Growth Marketer', 4, 5, 'employee', '2023-01-16'],
  ['Zoe Andersson', 'Brand Designer', 4, 5, 'employee', '2023-06-12'],
  ['James Whitaker', 'HR Generalist', 5, 1, 'hr', '2022-01-10'],
  ['Leah Cohen', 'Office Manager', 5, 1, 'employee', '2021-08-23'],
  ['Samuel Adeyemi', 'Finance Analyst', 5, 1, 'employee', '2023-11-06'],
];

const EMAIL_DOMAIN = 'northpeak.example';

// employee id, leave type, working days from the next working day, length, half day end, status
const PLANNED: [number, LeaveCode, number, number, boolean, LeaveStatus][] = [
  [7, 'annual', 0, 3, false, 'approved'],
  [13, 'annual', -2, 5, false, 'approved'],
  [17, 'sick', 0, 1, false, 'approved'],
  [21, 'annual', 2, 2, false, 'approved'],
  [10, 'annual', 3, 1, true, 'pending'],
  [24, 'parental', 1, 3, false, 'pending'],
  [19, 'annual', 6, 5, false, 'pending'],
  [8, 'annual', 8, 4, false, 'pending'],
  [3, 'annual', 10, 3, false, 'pending'],
  [16, 'unpaid', 12, 3, false, 'pending'],
];

const REASONS: Record<LeaveCode, (string | null)[]> = {
  annual: [
    'Family holiday',
    'Long weekend away',
    'Visiting family',
    "Friend's wedding",
    'Moving house',
    'Summer trip',
    null,
    null,
  ],
  sick: ['Flu', "Doctor's appointment", 'Migraine', null],
  parental: ['School holiday cover', 'Childcare', 'Family appointment'],
  unpaid: ['Extended trip', 'Personal matters'],
};
const APPROVE_COMMENTS = ['Enjoy!', 'Have a good break', null, null, null];
const REJECT_COMMENTS = [
  'Too many people are off in the team that week',
  "That's our release week, could you move it by a week?",
  "Overlaps with quarterly planning, let's find another date",
  'We need cover for the client workshop, can we talk?',
];
const CANCEL_COMMENTS = ['Plans changed', 'Trip postponed', null];

const ACTIVE: LeaveStatus[] = ['pending', 'approved'];

interface Planned {
  employee_id: number;
  code: LeaveCode;
  start: string;
  end: string;
  half_day_start: boolean;
  half_day_end: boolean;
  days: number;
  status: LeaveStatus;
}

/** ISO timestamp without milliseconds, the way the API sends them. */
export function timestamp(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function emailFor(name: string): string {
  const parts = name
    .toLowerCase()
    .replace("'", '')
    .replace('á', 'a')
    .replace('í', 'i')
    .split(/\s+/);
  return `${parts[0]}.${parts[parts.length - 1]}@${EMAIL_DOMAIN}`;
}

export function createSeedData(now: Date = new Date()): MockData {
  const today = todayIso(now);
  const year = yearOf(today);
  const holidays = [...publicHolidays(year), ...publicHolidays(year + 1)];
  const holidaySet = new Set(holidays.map((h) => h.date));

  const departments = DEPARTMENTS.map((name, i) => ({ id: i + 1, name }));
  const employees: EmployeeRow[] = EMPLOYEES.map(
    ([name, job_title, department_id, manager_id, role, start], i) => ({
      id: i + 1,
      name,
      email: emailFor(name),
      job_title,
      department_id,
      manager_id,
      role,
      start_date: start.replace('{Y}', String(year)),
      created_at: '2026-01-05T09:00:00Z',
    }),
  );
  const typeByCode = new Map(LEAVE_TYPES.map((t) => [t.code, t]));

  const rng = new Rng(2026);
  const firstDay = nextWorkingDay(today, holidaySet);
  const horizon = addDays(today, 100);
  const byPerson = new Map<number, Planned[]>(employees.map((e) => [e.id, []]));
  const planned: Planned[] = [];

  const add = (
    employee: EmployeeRow,
    code: LeaveCode,
    start: string,
    end: string,
    halfStart: boolean,
    halfEnd: boolean,
    status: LeaveStatus,
  ): boolean => {
    if (yearOf(end) !== yearOf(start)) return false;
    const days = workingDays(start, end, holidaySet, halfStart, halfEnd);
    if (days <= 0) return false;
    const span = halfDaySpan(start, end, halfStart, halfEnd);
    const mine = byPerson.get(employee.id)!;
    for (const other of mine) {
      const otherSpan = halfDaySpan(
        other.start,
        other.end,
        other.half_day_start,
        other.half_day_end,
      );
      if (spansOverlap(span, otherSpan)) return false;
    }
    const allowance = typeByCode.get(code)!.yearly_allowance;
    if (ACTIVE.includes(status) && allowance !== null) {
      const entitled = entitlement(allowance, employee.start_date, yearOf(start))!;
      const taken = mine
        .filter(
          (r) => r.code === code && ACTIVE.includes(r.status) && yearOf(r.start) === yearOf(start),
        )
        .reduce((sum, r) => sum + r.days, 0);
      if (days > entitled - taken) return false;
    }
    const request: Planned = {
      employee_id: employee.id,
      code,
      start,
      end,
      half_day_start: halfStart,
      half_day_end: halfEnd,
      days,
      status,
    };
    mine.push(request);
    planned.push(request);
    return true;
  };

  for (const [id, code, offset, length, halfEnd, status] of PLANNED) {
    const start = addWorkingDays(firstDay, offset, holidaySet);
    const end = addWorkingDays(start, length - 1, holidaySet);
    add(employees[id - 1], code, start, end, false, halfEnd, status);
  }

  const yearStart = `${year}-01-01`;
  for (const person of employees) {
    let cursor = addDays(
      person.start_date > yearStart ? person.start_date : yearStart,
      rng.int(2, 30),
    );
    for (;;) {
      cursor = nextWorkingDay(cursor, holidaySet);
      if (cursor > horizon) break;
      const r = rng.next();
      let code: LeaveCode;
      let length: number;
      if (r < 0.14 && cursor < today) {
        [code, length] = ['sick', rng.pick([1, 1, 1, 2, 3])];
      } else if (r >= 0.14 && r < 0.19) {
        [code, length] = ['unpaid', rng.pick([1, 2, 3])];
      } else if (r >= 0.19 && r < 0.24) {
        [code, length] = ['parental', rng.pick([1, 2, 3, 5])];
      } else {
        [code, length] = ['annual', rng.pick([1, 1, 2, 3, 4, 5, 5, 10])];
      }
      let halfStart = false;
      let halfEnd = false;
      const h = rng.next();
      if (length === 1 && h < 0.25) {
        if (rng.next() < 0.5) halfEnd = true;
        else halfStart = true;
      } else if (length > 1 && h < 0.12) {
        halfEnd = true;
      }
      const end = addWorkingDays(cursor, length - 1, holidaySet);
      const s = rng.next();
      let status: LeaveStatus;
      if (end < today) {
        status = s < 0.82 ? 'approved' : s < 0.9 ? 'rejected' : 'cancelled';
      } else if (cursor <= today) {
        status = 'approved';
      } else {
        status = s < 0.4 ? 'pending' : s < 0.92 ? 'approved' : 'cancelled';
      }
      if (add(person, code, cursor, end, halfStart, halfEnd, status)) {
        cursor = addDays(end, rng.int(18, 60));
      } else {
        cursor = addDays(cursor, rng.int(4, 12));
      }
    }
  }

  // second pass: who did what and when
  const at = (day: string, minutes: number): string => {
    const [y, m, d] = day.split('-').map(Number);
    const time = Date.UTC(y, m - 1, d, 8, 0) + minutes * 60_000;
    return timestamp(new Date(Math.min(time, now.getTime())));
  };
  const later = (a: string, b: string) => (a > b ? a : b);

  const requests: RequestRow[] = [];
  const events: EventRow[] = [];
  const event = (
    requestId: number,
    action: EventRow['action'],
    actor: number,
    when: string,
    comment: string | null,
  ) =>
    events.push({
      id: events.length + 1,
      request_id: requestId,
      action,
      actor_id: actor,
      comment,
      created_at: when,
    });

  for (const p of planned) {
    const person = employees[p.employee_id - 1];
    const approver = person.manager_id ?? (person.id === 1 ? 23 : 1);
    let createdDay: string;
    if (p.code === 'sick') {
      createdDay = p.start < today ? p.start : today;
    } else {
      createdDay = addDays(p.start, -rng.int(5, 40));
      if (createdDay > today) {
        // leave booked well ahead, spread over the last few weeks
        createdDay = addDays(today, -(daysBetween(today, createdDay) % 21));
      }
    }
    const row: RequestRow = {
      id: requests.length + 1,
      employee_id: p.employee_id,
      leave_type_id: typeByCode.get(p.code)!.id,
      start_date: p.start,
      end_date: p.end,
      half_day_start: p.half_day_start,
      half_day_end: p.half_day_end,
      days: p.days,
      reason: null,
      status: p.status,
      created_at: at(createdDay, rng.int(0, 540)),
      decided_at: null,
      decided_by_id: null,
      decision_comment: null,
    };
    row.reason = rng.pick(REASONS[p.code]);
    requests.push(row);
    event(row.id, 'submitted', person.id, row.created_at, null);

    if (p.status === 'approved' || p.status === 'rejected') {
      const decidedDay = minDate(addDays(createdDay, rng.int(0, 3)), today);
      const decided = later(at(decidedDay, 60 + rng.int(0, 480)), row.created_at);
      const comment = rng.pick(p.status === 'approved' ? APPROVE_COMMENTS : REJECT_COMMENTS);
      row.decided_at = decided;
      row.decided_by_id = approver;
      row.decision_comment = comment;
      event(row.id, p.status, approver, decided, comment);
    } else if (p.status === 'cancelled') {
      const cancelledDay = minDate(addDays(createdDay, rng.int(1, 10)), today);
      const cancelled = later(at(cancelledDay, 60 + rng.int(0, 480)), row.created_at);
      event(row.id, 'cancelled', person.id, cancelled, rng.pick(CANCEL_COMMENTS));
    }
  }

  return {
    departments,
    employees,
    leave_types: LEAVE_TYPES.map((t) => ({ ...t })),
    holidays,
    requests,
    events,
  };
}

function minDate(a: string, b: string): string {
  return a < b ? a : b;
}
