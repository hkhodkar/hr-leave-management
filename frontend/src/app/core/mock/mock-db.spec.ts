import { beforeEach, describe, expect, it } from 'vitest';
import { LeaveRequestInput } from '../models/hr.models';
import { MockApiError, MockDb, STORAGE_KEY } from './mock-db';
import { createSeedData } from './seed';

// a Monday in early March, like the backend tests
const NOW = new Date('2026-03-02T12:00:00Z');

class MemoryStorage implements Storage {
  private items = new Map<string, string>();
  get length() {
    return this.items.size;
  }
  clear() {
    this.items.clear();
  }
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  key(index: number) {
    return [...this.items.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
  setItem(key: string, value: string) {
    this.items.set(key, value);
  }
}

const HR = 1;
const DANIEL = 2; // engineering manager
const LIAM = 6; // reports to Daniel
const AISHA = 7; // reports to Daniel
const NOAH = 12; // product team

function request(
  start: string,
  end = start,
  extra: Partial<LeaveRequestInput> = {},
): LeaveRequestInput {
  return {
    leave_type_id: 1,
    start_date: start,
    end_date: end,
    half_day_start: false,
    half_day_end: false,
    reason: null,
    ...extra,
  };
}

function expectError(action: () => unknown, status: number, message?: string): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(MockApiError);
    expect((error as MockApiError).status).toBe(status);
    if (message) expect(String((error as MockApiError).detail)).toContain(message);
    return;
  }
  throw new Error(`expected a ${status} error`);
}

describe('seed data', () => {
  it('matches the backend seed for the same day', () => {
    // reference values printed by backend/app/seed.py for 2 March 2026
    const data = createSeedData(NOW);
    const statuses = data.requests.reduce<Record<string, number>>((acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1;
      return acc;
    }, {});
    expect(data.employees).toHaveLength(25);
    expect(data.requests).toHaveLength(104);
    expect(statuses).toEqual({ approved: 58, pending: 34, cancelled: 8, rejected: 4 });
    expect(data.requests.reduce((sum, r) => sum + r.days, 0)).toBe(365);
    expect(data.requests[40]).toMatchObject({
      employee_id: 9,
      start_date: '2026-04-07',
      end_date: '2026-04-09',
      days: 3,
      status: 'pending',
      reason: null,
      created_at: '2026-03-01T16:30:00Z',
    });
    expect(data.requests.at(-1)).toMatchObject({
      employee_id: 25,
      start_date: '2026-06-01',
      days: 5,
      reason: 'Family holiday',
      created_at: '2026-02-10T09:52:00Z',
    });
  });

  it('gives every seeded request a history', () => {
    const data = createSeedData(NOW);
    for (const r of data.requests) {
      const actions = data.events.filter((e) => e.request_id === r.id).map((e) => e.action);
      expect(actions[0]).toBe('submitted');
      if (r.status !== 'pending') expect(actions).toContain(r.status);
    }
  });
});

describe('MockDb', () => {
  let storage: MemoryStorage;
  let db: MockDb;
  const as = (id: number) => db.actor(String(id));

  beforeEach(() => {
    storage = new MemoryStorage();
    db = new MockDb(storage, () => NOW);
  });

  it('needs a known acting user', () => {
    expectError(() => db.actor(null), 401);
    expectError(() => db.actor('999'), 401);
  });

  it('scopes request lists by role', () => {
    const ids = (actor: number) =>
      new Set(
        db.listRequests(as(actor), { page: 1, page_size: 200 }).items.map((r) => r.employee.id),
      );
    expect(ids(LIAM)).toEqual(new Set([LIAM]));
    expect([...ids(DANIEL)].every((id) => [DANIEL, 6, 7, 8, 9, 10, 11].includes(id))).toBe(true);
    expect(ids(HR).size).toBeGreaterThan(15);
    expectError(
      () => db.listRequests(as(LIAM), { page: 1, page_size: 20, employee_id: AISHA }),
      403,
    );
    expectError(() => db.balances(as(DANIEL), NOAH), 403);
  });

  it('validates new requests like the API', () => {
    expectError(
      () => db.createRequest(as(LIAM), request('2026-03-10', '2026-03-09')),
      422,
      'end date',
    );
    expectError(
      () => db.createRequest(as(LIAM), request('2026-03-07', '2026-03-08')),
      422,
      'no working days',
    );
    expectError(() => db.createRequest(as(LIAM), request('2026-02-25')), 422, 'past dates');
    expect(
      db.createRequest(as(LIAM), request('2026-02-25', '2026-02-25', { leave_type_id: 2 })).status,
    ).toBe('pending');
    expectError(
      () => db.createRequest(as(LIAM), request('2026-06-01', '2026-12-31')),
      422,
      'Not enough',
    );
  });

  it('rejects overlaps but allows a morning and an afternoon', () => {
    db.createRequest(as(LIAM), request('2026-09-14', '2026-09-16', { half_day_end: true }));
    expectError(() => db.createRequest(as(LIAM), request('2026-09-16')), 409, 'overlaps');
    expect(
      db.createRequest(as(LIAM), request('2026-09-16', '2026-09-16', { half_day_start: true }))
        .days,
    ).toBe(0.5);
  });

  it('runs the approval flow with an audit trail', () => {
    const created = db.createRequest(as(LIAM), request('2026-09-21', '2026-09-22'));
    expect(created.can_cancel).toBe(true);
    expectError(() => db.approve(as(AISHA), created.id, null), 403);
    expectError(() => db.approve(as(NOAH), created.id, null), 403);
    expectError(() => db.reject(as(DANIEL), created.id, null), 422, 'comment');

    const approved = db.approve(as(DANIEL), created.id, 'Enjoy');
    expect(approved.status).toBe('approved');
    expect(approved.events.map((e) => [e.action, e.actor.id])).toEqual([
      ['submitted', LIAM],
      ['approved', DANIEL],
    ]);
    expectError(() => db.reject(as(DANIEL), created.id, 'No'), 409);

    const cancelled = db.cancel(as(LIAM), created.id, null);
    expect(cancelled.events.at(-1)?.action).toBe('cancelled');
  });

  it('does not let anyone approve their own leave', () => {
    const own = db.createRequest(as(DANIEL), request('2026-10-05'));
    expect(own.can_decide).toBe(false);
    expectError(() => db.approve(as(DANIEL), own.id, null), 403, 'own request');
    expect(db.approve(as(HR), own.id, null).status).toBe('approved');
  });

  it('keeps leave that already started', () => {
    const started = db
      .listRequests(as(AISHA), { page: 1, page_size: 50, status: ['approved'] })
      .items.find((r) => r.start_date <= '2026-03-02');
    expect(started?.can_cancel).toBe(false);
    expectError(() => db.cancel(as(AISHA), started!.id, null), 409, 'already started');
  });

  it('updates balances and badge counts', () => {
    const before = db.balances(as(LIAM), LIAM, 2026)[0];
    const pendingBefore = db.me(as(DANIEL)).pending_approvals;
    db.createRequest(as(LIAM), request('2026-11-02', '2026-11-03'));
    const after = db.balances(as(LIAM), LIAM, 2026)[0];
    expect(after.pending).toBe(before.pending + 2);
    expect(after.remaining).toBe(before.remaining! - 2);
    expect(db.me(as(DANIEL)).pending_approvals).toBe(pendingBefore + 1);
  });

  it('only lets HR add employees and keeps emails unique', () => {
    const input = {
      name: 'Jordan Lee',
      email: 'jordan.lee@northpeak.example',
      job_title: 'Data Analyst',
      department_id: 1,
      manager_id: DANIEL,
      role: 'employee' as const,
      start_date: '2026-04-01',
    };
    expectError(() => db.createEmployee(as(DANIEL), input), 403);
    const created = db.createEmployee(as(HR), input);
    expect(created.manager?.name).toBe('Daniel Kim');
    expectError(
      () => db.createEmployee(as(HR), { ...input, email: 'LIAM.OCONNOR@northpeak.example' }),
      409,
    );
    expectError(
      () =>
        db.updateEmployee(as(HR), DANIEL, {
          ...input,
          email: 'daniel.kim@northpeak.example',
          manager_id: LIAM,
        }),
      422,
      'their team',
    );
  });

  it('filters and pages the directory', () => {
    const page = db.listEmployees({ page: 2, page_size: 10, sort: 'name' });
    expect(page.total).toBe(25);
    expect(page.items).toHaveLength(10);
    const engineers = db.listEmployees({
      page: 1,
      page_size: 20,
      search: 'engineer',
      department_id: 1,
    });
    expect(engineers.items.every((e) => e.department_id === 1)).toBe(true);
  });

  it('hides leave types of coworkers in the calendar', () => {
    const month = db.calendar(as(LIAM), 2026, 3, null);
    const others = month.absences.filter((a) => a.employee.id !== LIAM);
    expect(others.length).toBeGreaterThan(0);
    expect(others.every((a) => a.leave_type === null && a.status === 'approved')).toBe(true);
    const asHr = db.calendar(as(HR), 2026, 3, null);
    expect(asHr.absences.some((a) => a.status === 'pending')).toBe(true);
  });

  it('saves changes and can reset them', () => {
    db.createRequest(as(LIAM), request('2026-11-09'));
    expect(storage.getItem(STORAGE_KEY)).toContain('2026-11-09');
    const reloaded = new MockDb(storage, () => NOW);
    expect(
      reloaded.listRequests(reloaded.actor(String(LIAM)), {
        page: 1,
        page_size: 1,
        sort: '-created_at',
      }).items[0].start_date,
    ).toBe('2026-11-09');

    reloaded.reset();
    expect(storage.getItem(STORAGE_KEY)).toBeNull();
    expect(
      reloaded
        .listRequests(reloaded.actor(String(LIAM)), { page: 1, page_size: 200 })
        .items.some((r) => r.start_date === '2026-11-09'),
    ).toBe(false);
  });
});
