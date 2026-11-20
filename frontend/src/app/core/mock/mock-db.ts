import {
  Absence,
  Balance,
  CalendarMonth,
  Dashboard,
  Department,
  Employee,
  EmployeeInput,
  EmployeeRef,
  EmployeeSort,
  Holiday,
  LeaveRequest,
  LeaveRequestDetail,
  LeaveRequestInput,
  LeaveStatus,
  LeaveType,
  LeaveTypeRef,
  Me,
  Page,
  Ref,
  RequestScope,
  RequestSort,
  Role,
  SessionUser,
} from '../models/hr.models';
import { addDays, daysInMonth, isoDate, startOfWeek, todayIso, yearOf } from '../utils/dates';
import { entitlement, halfDaySpan, spansOverlap, workingDays } from '../utils/working-days';
import { EmployeeRow, EventRow, MockData, RequestRow, createSeedData, timestamp } from './seed';

/** An error the mock API answers with, `detail` follows FastAPI's error body. */
export class MockApiError extends Error {
  constructor(
    readonly status: number,
    readonly detail: unknown,
  ) {
    super(typeof detail === 'string' ? detail : `HTTP ${status}`);
  }
}

export interface Paging {
  page: number;
  page_size: number;
}

export interface EmployeeFilter extends Paging {
  search?: string | null;
  department_id?: number | null;
  role?: Role | null;
  sort?: EmployeeSort | null;
}

export interface RequestFilter extends Paging {
  scope?: RequestScope | null;
  status?: LeaveStatus[];
  employee_id?: number | null;
  department_id?: number | null;
  leave_type_id?: number | null;
  year?: number | null;
  sort?: RequestSort | null;
}

export const STORAGE_KEY = 'leave-management.demo-data';
const STORAGE_VERSION = 1;
const SICK_BACKDATE_DAYS = 30;
const ACTIVE: LeaveStatus[] = ['pending', 'approved'];

function paginate<T>(items: T[], { page, page_size }: Paging): Page<T> {
  const start = (page - 1) * page_size;
  return { items: items.slice(start, start + page_size), total: items.length, page, page_size };
}

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function formatDays(days: number): string {
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

const shortDate = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  timeZone: 'UTC',
});
const longDate = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

/**
 * In-memory version of the FastAPI backend with the same permission rules,
 * validation messages, filters and paging. Changes are saved to storage
 * (localStorage in the browser) so they survive a reload.
 */
export class MockDb {
  private data: MockData;

  constructor(
    private readonly storage: Storage | null = null,
    private readonly clock: () => Date = () => new Date(),
  ) {
    this.data = this.load() ?? createSeedData(this.clock());
  }

  /** Throws away all changes and starts again from the demo data. */
  reset(): void {
    try {
      this.storage?.removeItem(STORAGE_KEY);
    } catch {
      // storage not available, nothing to clear
    }
    this.data = createSeedData(this.clock());
  }

  // --- session ---

  /** The acting user from the X-User-Id header, like the backend's current_user. */
  actor(header: string | null): EmployeeRow {
    if (header === null || header === '') {
      throw new MockApiError(401, 'Pick who you are acting as with the X-User-Id header');
    }
    const id = Number(header);
    const user = Number.isInteger(id) ? this.data.employees.find((e) => e.id === id) : undefined;
    if (!user) {
      throw new MockApiError(401, `No employee with id ${header}`);
    }
    return user;
  }

  sessionUsers(): SessionUser[] {
    return [...this.data.employees]
      .sort((a, b) => byText(a.name, b.name))
      .map((e) => ({
        id: e.id,
        name: e.name,
        role: e.role,
        job_title: e.job_title,
        department: this.department(e.department_id).name,
      }));
  }

  me(actor: EmployeeRow): Me {
    const pending = this.data.requests.filter((r) => r.status === 'pending');
    return {
      user: this.toEmployee(actor),
      pending_approvals: pending.filter((r) => this.isApprover(actor, this.employee(r.employee_id)))
        .length,
      my_pending: pending.filter((r) => r.employee_id === actor.id).length,
    };
  }

  // --- reference data ---

  departments(): Department[] {
    return [...this.data.departments]
      .sort((a, b) => byText(a.name, b.name))
      .map((d) => ({
        id: d.id,
        name: d.name,
        headcount: this.data.employees.filter((e) => e.department_id === d.id).length,
      }));
  }

  leaveTypes(): LeaveType[] {
    return this.data.leave_types.map((t) => ({ ...t }));
  }

  holidays(year: number): Holiday[] {
    return this.data.holidays.filter((h) => yearOf(h.date) === year);
  }

  // --- employees ---

  listEmployees(filter: EmployeeFilter): Page<Employee> {
    const term = filter.search?.trim().toLowerCase();
    let rows = this.data.employees.filter(
      (e) =>
        (!term ||
          [e.name, e.email, e.job_title].some((field) => field.toLowerCase().includes(term))) &&
        (filter.department_id == null || e.department_id === filter.department_id) &&
        (!filter.role || e.role === filter.role),
    );
    const sort = filter.sort ?? 'name';
    const name = (e: EmployeeRow) => e.name.toLowerCase();
    rows = [...rows].sort((a, b) => {
      if (sort === 'department') {
        return (
          byText(this.department(a.department_id).name, this.department(b.department_id).name) ||
          byText(name(a), name(b))
        );
      }
      const key = sort.endsWith('name') ? name : (e: EmployeeRow) => e.start_date;
      const direction = sort.startsWith('-') ? -1 : 1;
      return direction * byText(key(a), key(b)) || a.id - b.id;
    });
    return paginate(
      rows.map((e) => this.toEmployee(e)),
      filter,
    );
  }

  getEmployee(id: number): Employee {
    return this.toEmployee(this.employee(id));
  }

  createEmployee(actor: EmployeeRow, input: EmployeeInput): Employee {
    this.requireHr(actor);
    this.checkEmployee(input);
    const row: EmployeeRow = {
      id: this.nextId(this.data.employees),
      ...input,
      created_at: this.now(),
    };
    this.data.employees.push(row);
    this.save();
    return this.toEmployee(row);
  }

  updateEmployee(actor: EmployeeRow, id: number, input: EmployeeInput): Employee {
    this.requireHr(actor);
    const row = this.employee(id);
    this.checkEmployee(input, id);
    Object.assign(row, input);
    this.save();
    return this.toEmployee(row);
  }

  balances(actor: EmployeeRow, id: number, year?: number | null): Balance[] {
    const employee = this.employee(id);
    if (!this.canViewLeave(actor, employee)) {
      throw new MockApiError(403, 'You can only see leave balances for yourself and your team');
    }
    return this.balancesFor(employee, year ?? yearOf(this.today()));
  }

  // --- leave requests ---

  listRequests(actor: EmployeeRow, filter: RequestFilter): Page<LeaveRequest> {
    const visible = this.visibleIds(actor);
    let ids: Set<number> | null;
    const scope = filter.scope ?? 'all';
    if (scope === 'mine') {
      ids = new Set([actor.id]);
    } else if (scope === 'team') {
      ids = new Set(this.data.employees.filter((e) => e.manager_id === actor.id).map((e) => e.id));
    } else if (scope === 'approvals') {
      ids = new Set(this.data.employees.filter((e) => this.isApprover(actor, e)).map((e) => e.id));
    } else {
      ids = visible;
    }

    if (filter.employee_id != null) {
      const id = filter.employee_id;
      if (visible !== null && !visible.has(id)) {
        throw new MockApiError(403, 'You can only see leave for yourself and your team');
      }
      ids = ids === null || ids.has(id) ? new Set([id]) : new Set();
    }
    if (filter.department_id != null) {
      const inDepartment = this.data.employees
        .filter((e) => e.department_id === filter.department_id)
        .map((e) => e.id);
      ids = new Set(ids === null ? inDepartment : inDepartment.filter((id) => ids!.has(id)));
    }

    const rows = this.data.requests.filter(
      (r) =>
        (ids === null || ids.has(r.employee_id)) &&
        (!filter.status?.length || filter.status.includes(r.status)) &&
        (filter.leave_type_id == null || r.leave_type_id === filter.leave_type_id) &&
        (filter.year == null || yearOf(r.start_date) === filter.year),
    );
    const sort = filter.sort ?? '-start_date';
    const field = sort.replace(/^-/, '') as 'start_date' | 'created_at';
    const direction = sort.startsWith('-') ? -1 : 1;
    rows.sort((a, b) => direction * (byText(a[field], b[field]) || a.id - b.id));
    const today = this.today();
    return paginate(
      rows.map((r) => this.toRequest(r, actor, today)),
      filter,
    );
  }

  getRequest(actor: EmployeeRow, id: number): LeaveRequestDetail {
    return this.toDetail(this.visibleRequest(actor, id), actor);
  }

  createRequest(actor: EmployeeRow, input: LeaveRequestInput): LeaveRequestDetail {
    const days = this.validateRequest(actor, input);
    const row: RequestRow = {
      id: this.nextId(this.data.requests),
      employee_id: actor.id,
      leave_type_id: input.leave_type_id,
      start_date: input.start_date,
      end_date: input.end_date,
      half_day_start: input.half_day_start,
      half_day_end: input.half_day_end,
      days,
      reason: input.reason || null,
      status: 'pending',
      created_at: this.now(),
      decided_at: null,
      decided_by_id: null,
      decision_comment: null,
    };
    this.data.requests.push(row);
    this.addEvent(row.id, 'submitted', actor.id, null);
    this.save();
    return this.toDetail(row, actor);
  }

  approve(actor: EmployeeRow, id: number, comment: string | null): LeaveRequestDetail {
    return this.decide(actor, id, 'approved', comment);
  }

  reject(actor: EmployeeRow, id: number, comment: string | null): LeaveRequestDetail {
    if (!comment) {
      throw new MockApiError(422, 'Please add a comment explaining why the request is rejected');
    }
    return this.decide(actor, id, 'rejected', comment);
  }

  cancel(actor: EmployeeRow, id: number, comment: string | null): LeaveRequestDetail {
    const row = this.visibleRequest(actor, id);
    if (!this.canCancel(actor, row, this.today())) {
      if (actor.id !== row.employee_id && actor.role !== 'hr') {
        throw new MockApiError(403, 'Only the employee or HR can cancel this request');
      }
      if (row.status === 'approved') {
        throw new MockApiError(409, "This leave has already started and can't be cancelled");
      }
      throw new MockApiError(409, `A ${row.status} request can't be cancelled`);
    }
    row.status = 'cancelled';
    this.addEvent(row.id, 'cancelled', actor.id, comment || null);
    this.save();
    return this.toDetail(row, actor);
  }

  // --- overview ---

  calendar(
    actor: EmployeeRow,
    year: number,
    month: number,
    departmentId: number | null,
  ): CalendarMonth {
    const first = isoDate(year, month, 1);
    const last = isoDate(year, month, daysInMonth(year, month));
    let absences = this.absences(actor, first, last, true);
    if (departmentId !== null) {
      absences = absences.filter((a) => a.employee.department_id === departmentId);
    }
    return {
      year,
      month,
      holidays: this.data.holidays.filter((h) => h.date >= first && h.date <= last),
      absences,
    };
  }

  dashboard(actor: EmployeeRow): Dashboard {
    const today = this.today();
    const monday = startOfWeek(today);
    const year = yearOf(today);
    const pending = this.data.requests.filter((r) => r.status === 'pending');
    const types = this.data.leave_types;

    const usage = new Map<number, Record<string, number>>();
    for (const r of this.data.requests) {
      if (r.status !== 'approved' || yearOf(r.start_date) !== year) continue;
      const departmentId = this.employee(r.employee_id).department_id;
      const days = usage.get(departmentId) ?? Object.fromEntries(types.map((t) => [t.code, 0]));
      days[this.leaveType(r.leave_type_id).code] += r.days;
      usage.set(departmentId, days);
    }

    return {
      date: today,
      off_today: this.absences(actor, today, today, false),
      off_this_week: this.absences(actor, monday, addDays(monday, 6), false),
      pending_approvals: pending.filter((r) => this.isApprover(actor, this.employee(r.employee_id)))
        .length,
      my_pending: pending.filter((r) => r.employee_id === actor.id).length,
      next_holidays: this.data.holidays.filter((h) => h.date >= today).slice(0, 3),
      my_balances: this.balancesFor(actor, year),
      usage: {
        year,
        leave_types: types.map((t) => this.typeRef(t.id)),
        departments: this.departments().map((d) => ({
          id: d.id,
          name: d.name,
          headcount: d.headcount,
          days: usage.get(d.id) ?? Object.fromEntries(types.map((t) => [t.code, 0])),
        })),
      },
    };
  }

  // --- rules ---

  private isApprover(actor: EmployeeRow, employee: EmployeeRow): boolean {
    if (actor.id === employee.id) return false;
    return actor.role === 'hr' || employee.manager_id === actor.id;
  }

  private canViewLeave(actor: EmployeeRow, employee: EmployeeRow): boolean {
    return actor.id === employee.id || this.isApprover(actor, employee);
  }

  private canCancel(actor: EmployeeRow, row: RequestRow, today: string): boolean {
    if (actor.id !== row.employee_id && actor.role !== 'hr') return false;
    if (row.status === 'pending') return true;
    return row.status === 'approved' && row.start_date > today;
  }

  /** Whose leave the actor may see, null means everyone. */
  private visibleIds(actor: EmployeeRow): Set<number> | null {
    if (actor.role === 'hr') return null;
    const reports = this.data.employees.filter((e) => e.manager_id === actor.id).map((e) => e.id);
    return new Set([actor.id, ...reports]);
  }

  private requireHr(actor: EmployeeRow): void {
    if (actor.role !== 'hr') {
      throw new MockApiError(403, 'Only HR admins can do this');
    }
  }

  private checkEmployee(input: EmployeeInput, employeeId?: number): void {
    if (!this.data.departments.some((d) => d.id === input.department_id)) {
      throw new MockApiError(422, `Unknown department ${input.department_id}`);
    }
    const taken = this.data.employees.find(
      (e) => e.email.toLowerCase() === input.email.toLowerCase(),
    );
    if (taken && taken.id !== employeeId) {
      throw new MockApiError(409, `${input.email} is already used by ${taken.name}`);
    }
    if (input.manager_id === null) return;
    let manager = this.data.employees.find((e) => e.id === input.manager_id);
    if (!manager) {
      throw new MockApiError(422, `Unknown manager ${input.manager_id}`);
    }
    // walk up the chain so nobody ends up managing their own manager
    const seen = new Set<number>();
    while (manager && !seen.has(manager.id)) {
      if (manager.id === employeeId) {
        throw new MockApiError(
          422,
          "An employee can't report to themselves or to someone in their team",
        );
      }
      seen.add(manager.id);
      const next: number | null = manager.manager_id;
      manager = next === null ? undefined : this.data.employees.find((e) => e.id === next);
    }
  }

  private validateRequest(actor: EmployeeRow, input: LeaveRequestInput): number {
    const type = this.data.leave_types.find((t) => t.id === input.leave_type_id);
    if (!type) {
      throw new MockApiError(422, `Unknown leave type ${input.leave_type_id}`);
    }
    const { start_date: start, end_date: end } = input;
    const today = this.today();
    if (end < start) {
      throw new MockApiError(422, "The end date can't be before the start date");
    }
    if (yearOf(start) !== yearOf(end)) {
      throw new MockApiError(422, "A request can't span two leave years, please split it in two");
    }
    if (start === end && input.half_day_start && input.half_day_end) {
      throw new MockApiError(422, 'For a single day pick either the morning or the afternoon');
    }
    if (start < today) {
      if (type.code !== 'sick') {
        throw new MockApiError(422, 'Only sick leave can be booked for past dates');
      }
      if (start < addDays(today, -SICK_BACKDATE_DAYS)) {
        throw new MockApiError(
          422,
          `Sick leave can be backdated by up to ${SICK_BACKDATE_DAYS} days`,
        );
      }
    }

    const holidays = new Set(this.holidays(yearOf(start)).map((h) => h.date));
    const days = workingDays(start, end, holidays, input.half_day_start, input.half_day_end);
    if (days <= 0) {
      throw new MockApiError(422, 'The selected dates contain no working days');
    }

    const span = halfDaySpan(start, end, input.half_day_start, input.half_day_end);
    const clash = this.data.requests.find(
      (r) =>
        r.employee_id === actor.id &&
        ACTIVE.includes(r.status) &&
        spansOverlap(span, halfDaySpan(r.start_date, r.end_date, r.half_day_start, r.half_day_end)),
    );
    if (clash) {
      throw new MockApiError(
        409,
        `This overlaps with your ${clash.status} request from ` +
          `${shortDate.format(new Date(clash.start_date))} to ${longDate.format(new Date(clash.end_date))}`,
      );
    }

    const balance = this.balancesFor(actor, yearOf(start)).find(
      (b) => b.leave_type.id === type.id,
    )!;
    if (balance.remaining !== null && days > balance.remaining) {
      throw new MockApiError(
        422,
        `Not enough ${type.name.toLowerCase()} left: ${formatDays(days)} requested, ` +
          `${formatDays(Math.max(balance.remaining, 0))} remaining`,
      );
    }
    return days;
  }

  private decide(
    actor: EmployeeRow,
    id: number,
    status: 'approved' | 'rejected',
    comment: string | null,
  ): LeaveRequestDetail {
    const row = this.visibleRequest(actor, id);
    const employee = this.employee(row.employee_id);
    if (row.status !== 'pending') {
      throw new MockApiError(409, `This request is already ${row.status}`);
    }
    if (!this.isApprover(actor, employee)) {
      if (actor.id === employee.id) {
        throw new MockApiError(403, "You can't approve or reject your own request");
      }
      throw new MockApiError(403, 'Only their manager or HR can decide on this request');
    }
    const now = this.now();
    row.status = status;
    row.decided_at = now;
    row.decided_by_id = actor.id;
    row.decision_comment = comment || null;
    this.addEvent(row.id, status, actor.id, comment || null, now);
    this.save();
    return this.toDetail(row, actor);
  }

  private balancesFor(employee: EmployeeRow, year: number): Balance[] {
    const requests = this.data.requests.filter(
      (r) =>
        r.employee_id === employee.id && ACTIVE.includes(r.status) && yearOf(r.start_date) === year,
    );
    return this.data.leave_types.map((type) => {
      const mine = requests.filter((r) => r.leave_type_id === type.id);
      const used = mine.filter((r) => r.status === 'approved').reduce((s, r) => s + r.days, 0);
      const pending = mine.filter((r) => r.status === 'pending').reduce((s, r) => s + r.days, 0);
      const entitled = entitlement(type.yearly_allowance, employee.start_date, year);
      return {
        leave_type: this.typeRef(type.id),
        year,
        entitled,
        used,
        pending,
        remaining: entitled === null ? null : entitled - used - pending,
      };
    });
  }

  private absences(
    actor: EmployeeRow,
    start: string,
    end: string,
    includePending: boolean,
  ): Absence[] {
    const statuses: LeaveStatus[] = includePending ? ['approved', 'pending'] : ['approved'];
    return this.data.requests
      .filter(
        (r) =>
          statuses.includes(r.status) &&
          r.start_date <= end &&
          r.end_date >= start &&
          // pending requests only show up for people who could see the request itself
          (r.status === 'approved' || this.canViewLeave(actor, this.employee(r.employee_id))),
      )
      .sort(
        (a, b) =>
          byText(a.start_date, b.start_date) ||
          byText(this.employee(a.employee_id).name, this.employee(b.employee_id).name),
      )
      .map((r) => ({
        request_id: r.id,
        employee: this.employeeRef(r.employee_id),
        leave_type: this.canViewLeave(actor, this.employee(r.employee_id))
          ? this.typeRef(r.leave_type_id)
          : null,
        start_date: r.start_date,
        end_date: r.end_date,
        half_day_start: r.half_day_start,
        half_day_end: r.half_day_end,
        days: r.days,
        status: r.status,
      }));
  }

  // --- lookups and shapes ---

  private employee(id: number): EmployeeRow {
    const row = this.data.employees.find((e) => e.id === id);
    if (!row) throw new MockApiError(404, `Employee ${id} was not found`);
    return row;
  }

  private department(id: number) {
    return this.data.departments.find((d) => d.id === id)!;
  }

  private leaveType(id: number): LeaveType {
    return this.data.leave_types.find((t) => t.id === id)!;
  }

  private visibleRequest(actor: EmployeeRow, id: number): RequestRow {
    const row = this.data.requests.find((r) => r.id === id);
    if (!row) throw new MockApiError(404, `Leave request ${id} was not found`);
    if (!this.canViewLeave(actor, this.employee(row.employee_id))) {
      throw new MockApiError(403, 'You can only see leave for yourself and your team');
    }
    return row;
  }

  private ref(id: number | null): Ref | null {
    const row = id === null ? undefined : this.data.employees.find((e) => e.id === id);
    return row ? { id: row.id, name: row.name } : null;
  }

  private employeeRef(id: number): EmployeeRef {
    const e = this.employee(id);
    return { id: e.id, name: e.name, job_title: e.job_title, department_id: e.department_id };
  }

  private typeRef(id: number): LeaveTypeRef {
    const { yearly_allowance: _, ...ref } = this.leaveType(id);
    return ref;
  }

  private toEmployee(e: EmployeeRow): Employee {
    const department = this.department(e.department_id);
    return {
      id: e.id,
      name: e.name,
      email: e.email,
      job_title: e.job_title,
      role: e.role,
      start_date: e.start_date,
      department_id: e.department_id,
      department: { id: department.id, name: department.name },
      manager_id: e.manager_id,
      manager: this.ref(e.manager_id),
      report_count: this.data.employees.filter((other) => other.manager_id === e.id).length,
      created_at: e.created_at,
    };
  }

  private toRequest(r: RequestRow, actor: EmployeeRow, today: string): LeaveRequest {
    const employee = this.employee(r.employee_id);
    return {
      id: r.id,
      employee: this.employeeRef(r.employee_id),
      leave_type: this.typeRef(r.leave_type_id),
      start_date: r.start_date,
      end_date: r.end_date,
      half_day_start: r.half_day_start,
      half_day_end: r.half_day_end,
      days: r.days,
      reason: r.reason,
      status: r.status,
      created_at: r.created_at,
      decided_at: r.decided_at,
      decided_by: this.ref(r.decided_by_id),
      decision_comment: r.decision_comment,
      can_cancel: this.canCancel(actor, r, today),
      can_decide: r.status === 'pending' && this.isApprover(actor, employee),
    };
  }

  private toDetail(r: RequestRow, actor: EmployeeRow): LeaveRequestDetail {
    const events = this.data.events
      .filter((e) => e.request_id === r.id)
      .sort((a, b) => byText(a.created_at, b.created_at) || a.id - b.id)
      .map((e) => ({
        id: e.id,
        action: e.action,
        actor: this.ref(e.actor_id)!,
        comment: e.comment,
        created_at: e.created_at,
      }));
    return { ...this.toRequest(r, actor, this.today()), events };
  }

  private addEvent(
    requestId: number,
    action: EventRow['action'],
    actorId: number,
    comment: string | null,
    when = this.now(),
  ): void {
    this.data.events.push({
      id: this.nextId(this.data.events),
      request_id: requestId,
      action,
      actor_id: actorId,
      comment,
      created_at: when,
    });
  }

  private nextId(rows: { id: number }[]): number {
    return rows.reduce((max, row) => Math.max(max, row.id), 0) + 1;
  }

  private today(): string {
    return todayIso(this.clock());
  }

  private now(): string {
    return timestamp(this.clock());
  }

  private load(): MockData | null {
    try {
      const saved = JSON.parse(this.storage?.getItem(STORAGE_KEY) ?? 'null');
      return saved?.version === STORAGE_VERSION ? (saved.data as MockData) : null;
    } catch {
      return null;
    }
  }

  private save(): void {
    try {
      this.storage?.setItem(
        STORAGE_KEY,
        JSON.stringify({ version: STORAGE_VERSION, data: this.data }),
      );
    } catch {
      // storage full or disabled, changes then only last until a reload
    }
  }
}
