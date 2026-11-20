import {
  EmployeeInput,
  EmployeeSort,
  LeaveRequestInput,
  LeaveStatus,
  RequestScope,
  RequestSort,
  Role,
} from '../models/hr.models';
import { MockApiError, MockDb, Paging } from './mock-db';

export interface MockResponse {
  status: number;
  body: unknown;
}

export interface MockRequest {
  method: string;
  /** path with query string, e.g. /api/employees?page=2 */
  url: string;
  body: unknown;
  /** value of the X-User-Id header */
  userId: string | null;
}

interface Issue {
  type: string;
  loc: (string | number)[];
  msg: string;
  input: unknown;
}

const ROLES: Role[] = ['employee', 'manager', 'hr'];
const STATUSES: LeaveStatus[] = ['pending', 'approved', 'rejected', 'cancelled'];
const SCOPES: RequestScope[] = ['all', 'mine', 'team', 'approvals'];
const EMPLOYEE_SORTS: EmployeeSort[] = ['name', '-name', 'department', 'start_date', '-start_date'];
const REQUEST_SORTS: RequestSort[] = ['start_date', '-start_date', 'created_at', '-created_at'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const quoted = (values: readonly string[]) => values.map((v) => `'${v}'`).join(', ');

/**
 * Collects validation problems the way FastAPI/Pydantic report them, so the
 * frontend gets the same 422 body from the mock and from the real API.
 */
class Checker {
  readonly issues: Issue[] = [];

  constructor(
    private readonly source: Record<string, unknown>,
    private readonly where: 'body' | 'query',
  ) {}

  text(name: string, opts: { required?: boolean; max?: number } = {}): string | null {
    const value = this.source[name];
    if (value === undefined || value === null) {
      if (opts.required) this.missing(name);
      return null;
    }
    if (typeof value !== 'string') {
      this.add(name, 'string_type', 'Input should be a valid string', value);
      return null;
    }
    const trimmed = value.trim();
    if (opts.required && !trimmed) {
      this.add(name, 'string_too_short', 'String should have at least 1 character', value);
    } else if (opts.max && trimmed.length > opts.max) {
      this.add(name, 'string_too_long', `String should have at most ${opts.max} characters`, value);
    }
    return trimmed;
  }

  int(name: string, opts: { required?: boolean; min?: number; max?: number } = {}): number | null {
    const raw = this.source[name];
    if (raw === undefined || raw === null) {
      if (opts.required) this.missing(name);
      return null;
    }
    const value = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      this.add(name, 'int_parsing', 'Input should be a valid integer', raw);
      return null;
    }
    if (opts.min !== undefined && value < opts.min) {
      this.add(
        name,
        'greater_than_equal',
        `Input should be greater than or equal to ${opts.min}`,
        raw,
      );
    } else if (opts.max !== undefined && value > opts.max) {
      this.add(name, 'less_than_equal', `Input should be less than or equal to ${opts.max}`, raw);
    }
    return value;
  }

  bool(name: string): boolean {
    const value = this.source[name];
    if (value === undefined || value === null) return false;
    if (typeof value !== 'boolean') {
      this.add(name, 'bool_type', 'Input should be a valid boolean', value);
      return false;
    }
    return value;
  }

  date(name: string): string {
    const value = this.source[name];
    if (value === undefined || value === null) {
      this.missing(name);
      return '';
    }
    const valid =
      typeof value === 'string' &&
      ISO_DATE.test(value) &&
      !Number.isNaN(Date.parse(value)) &&
      new Date(value).toISOString().startsWith(value);
    if (!valid) {
      this.add(name, 'date_from_datetime_parsing', 'Input should be a valid date', value);
      return '';
    }
    return value;
  }

  email(name: string): string {
    const value = this.text(name, { required: true });
    if (value && !EMAIL.test(value)) {
      this.add(name, 'value_error', 'value is not a valid email address', value);
    }
    return value ?? '';
  }

  choice<T extends string>(
    name: string,
    values: readonly T[],
    fallback: T | null = null,
  ): T | null {
    const value = this.source[name];
    if (value === undefined || value === null) return fallback;
    if (!values.includes(value as T)) {
      this.add(name, 'literal_error', `Input should be ${quoted(values)}`, value);
      return fallback;
    }
    return value as T;
  }

  done(): void {
    if (this.issues.length) {
      throw new MockApiError(422, this.issues);
    }
  }

  private missing(name: string): void {
    this.add(name, 'missing', 'Field required', this.source[name] ?? null);
  }

  private add(name: string, type: string, msg: string, input: unknown): void {
    this.issues.push({ type, loc: [this.where, name], msg, input });
  }
}

function bodyChecker(body: unknown): Checker {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new MockApiError(422, [
      {
        type: 'model_attributes_type',
        loc: ['body'],
        msg: 'Input should be an object',
        input: body,
      },
    ]);
  }
  return new Checker(body as Record<string, unknown>, 'body');
}

function employeeInput(body: unknown): EmployeeInput {
  const c = bodyChecker(body);
  const input: EmployeeInput = {
    name: c.text('name', { required: true, max: 100 }) ?? '',
    email: c.email('email'),
    job_title: c.text('job_title', { required: true, max: 100 }) ?? '',
    department_id: c.int('department_id', { required: true }) ?? 0,
    manager_id: c.int('manager_id'),
    role: c.choice('role', ROLES, 'employee')!,
    start_date: c.date('start_date'),
  };
  c.done();
  return input;
}

function requestInput(body: unknown): LeaveRequestInput {
  const c = bodyChecker(body);
  const input: LeaveRequestInput = {
    leave_type_id: c.int('leave_type_id', { required: true }) ?? 0,
    start_date: c.date('start_date'),
    end_date: c.date('end_date'),
    half_day_start: c.bool('half_day_start'),
    half_day_end: c.bool('half_day_end'),
    reason: c.text('reason', { max: 500 }) || null,
  };
  c.done();
  return input;
}

function comment(body: unknown): string | null {
  if (body === null || body === undefined) return null;
  const c = bodyChecker(body);
  const value = c.text('comment', { max: 500 });
  c.done();
  return value || null;
}

function paging(q: Checker, maxSize = 200): Paging {
  return {
    page: q.int('page', { min: 1 }) ?? 1,
    page_size: q.int('page_size', { min: 1, max: maxSize }) ?? 20,
  };
}

type Handler = (db: MockDb, req: MockRequest, query: URLSearchParams, id: number) => unknown;

interface Route {
  pattern: RegExp;
  methods: Partial<Record<string, Handler>>;
  /** status for a successful POST */
  created?: boolean;
}

const queryChecker = (query: URLSearchParams) => new Checker(Object.fromEntries(query), 'query');

const ROUTES: Route[] = [
  { pattern: /^\/api\/health$/, methods: { GET: () => ({ status: 'ok' }) } },
  { pattern: /^\/api\/session\/users$/, methods: { GET: (db) => db.sessionUsers() } },
  { pattern: /^\/api\/me$/, methods: { GET: (db, req) => db.me(db.actor(req.userId)) } },
  { pattern: /^\/api\/departments$/, methods: { GET: (db) => db.departments() } },
  { pattern: /^\/api\/leave-types$/, methods: { GET: (db) => db.leaveTypes() } },
  {
    pattern: /^\/api\/holidays$/,
    methods: {
      GET: (db, _req, query) => {
        const q = queryChecker(query);
        const year = q.int('year', { min: 2000, max: 2100 });
        q.done();
        return db.holidays(year ?? new Date().getFullYear());
      },
    },
  },
  {
    pattern: /^\/api\/employees$/,
    created: true,
    methods: {
      GET: (db, req, query) => {
        db.actor(req.userId);
        const q = queryChecker(query);
        const filter = {
          ...paging(q),
          search: query.get('search'),
          department_id: q.int('department_id'),
          role: q.choice('role', ROLES),
          sort: q.choice('sort', EMPLOYEE_SORTS),
        };
        q.done();
        return db.listEmployees(filter);
      },
      POST: (db, req) => db.createEmployee(db.actor(req.userId), employeeInput(req.body)),
    },
  },
  {
    pattern: /^\/api\/employees\/(\d+)$/,
    methods: {
      GET: (db, req, _query, id) => {
        db.actor(req.userId);
        return db.getEmployee(id);
      },
      PUT: (db, req, _query, id) =>
        db.updateEmployee(db.actor(req.userId), id, employeeInput(req.body)),
    },
  },
  {
    pattern: /^\/api\/employees\/(\d+)\/balances$/,
    methods: {
      GET: (db, req, query, id) => {
        const actor = db.actor(req.userId);
        const q = queryChecker(query);
        const year = q.int('year', { min: 2000, max: 2100 });
        q.done();
        return db.balances(actor, id, year);
      },
    },
  },
  {
    pattern: /^\/api\/leave-requests$/,
    created: true,
    methods: {
      GET: (db, req, query) => {
        const actor = db.actor(req.userId);
        const q = queryChecker(query);
        const status = query.getAll('status');
        status.forEach((value, index) => {
          if (!STATUSES.includes(value as LeaveStatus)) {
            q.issues.push({
              type: 'enum',
              loc: ['query', 'status', index],
              msg: `Input should be ${quoted(STATUSES)}`,
              input: value,
            });
          }
        });
        const filter = {
          ...paging(q),
          scope: q.choice('scope', SCOPES),
          status: status as LeaveStatus[],
          employee_id: q.int('employee_id'),
          department_id: q.int('department_id'),
          leave_type_id: q.int('leave_type_id'),
          year: q.int('year', { min: 2000, max: 2100 }),
          sort: q.choice('sort', REQUEST_SORTS),
        };
        q.done();
        return db.listRequests(actor, filter);
      },
      POST: (db, req) => db.createRequest(db.actor(req.userId), requestInput(req.body)),
    },
  },
  {
    pattern: /^\/api\/leave-requests\/(\d+)$/,
    methods: { GET: (db, req, _query, id) => db.getRequest(db.actor(req.userId), id) },
  },
  {
    pattern: /^\/api\/leave-requests\/(\d+)\/approve$/,
    methods: { POST: (db, req, _q, id) => db.approve(db.actor(req.userId), id, comment(req.body)) },
  },
  {
    pattern: /^\/api\/leave-requests\/(\d+)\/reject$/,
    methods: {
      POST: (db, req, _q, id) => {
        const actor = db.actor(req.userId);
        // the backend expects a body here, a missing one is a validation error
        if (req.body === null || req.body === undefined) {
          throw new MockApiError(422, [
            { type: 'missing', loc: ['body'], msg: 'Field required', input: null },
          ]);
        }
        return db.reject(actor, id, comment(req.body));
      },
    },
  },
  {
    pattern: /^\/api\/leave-requests\/(\d+)\/cancel$/,
    methods: { POST: (db, req, _q, id) => db.cancel(db.actor(req.userId), id, comment(req.body)) },
  },
  {
    pattern: /^\/api\/calendar$/,
    methods: {
      GET: (db, req, query) => {
        const actor = db.actor(req.userId);
        const q = queryChecker(query);
        const year = q.int('year', { required: true, min: 2000, max: 2100 });
        const month = q.int('month', { required: true, min: 1, max: 12 });
        const department = q.int('department_id');
        q.done();
        return db.calendar(actor, year!, month!, department);
      },
    },
  },
  {
    pattern: /^\/api\/dashboard$/,
    methods: { GET: (db, req) => db.dashboard(db.actor(req.userId)) },
  },
];

/** Answers one API call from the mock database, like the FastAPI app would. */
export function handleMockRequest(db: MockDb, req: MockRequest): MockResponse {
  const [path, search = ''] = req.url.split('?');
  const cleanPath = path.replace(/\/+$/, '') || '/';
  for (const route of ROUTES) {
    const match = route.pattern.exec(cleanPath);
    if (!match) continue;
    const handler = route.methods[req.method.toUpperCase()];
    if (!handler) {
      return { status: 405, body: { detail: 'Method Not Allowed' } };
    }
    try {
      const body = handler(db, req, new URLSearchParams(search), Number(match[1]));
      const status = req.method.toUpperCase() === 'POST' && route.created ? 201 : 200;
      return { status, body };
    } catch (error) {
      if (error instanceof MockApiError) {
        return { status: error.status, body: { detail: error.detail } };
      }
      throw error;
    }
  }
  return { status: 404, body: { detail: 'Not Found' } };
}
