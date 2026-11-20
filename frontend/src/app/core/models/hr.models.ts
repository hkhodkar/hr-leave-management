export type Role = 'employee' | 'manager' | 'hr';
export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';
export type LeaveCode = 'annual' | 'sick' | 'parental' | 'unpaid';

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

export interface Ref {
  id: number;
  name: string;
}

export interface Department {
  id: number;
  name: string;
  headcount: number;
}

export interface EmployeeRef {
  id: number;
  name: string;
  job_title: string;
  department_id: number;
}

export interface Employee {
  id: number;
  name: string;
  email: string;
  job_title: string;
  role: Role;
  start_date: string;
  department_id: number;
  department: Ref;
  manager_id: number | null;
  manager: Ref | null;
  report_count: number;
  created_at: string;
}

export interface EmployeeInput {
  name: string;
  email: string;
  job_title: string;
  department_id: number;
  manager_id: number | null;
  role: Role;
  start_date: string;
}

export interface SessionUser {
  id: number;
  name: string;
  role: Role;
  job_title: string;
  department: string;
}

export interface Me {
  user: Employee;
  pending_approvals: number;
  my_pending: number;
}

export interface LeaveTypeRef {
  id: number;
  code: LeaveCode;
  name: string;
  color: string;
}

export interface LeaveType extends LeaveTypeRef {
  yearly_allowance: number | null;
}

export interface Holiday {
  date: string;
  name: string;
}

export interface Balance {
  leave_type: LeaveTypeRef;
  year: number;
  entitled: number | null;
  used: number;
  pending: number;
  remaining: number | null;
}

export interface LeaveRequestInput {
  leave_type_id: number;
  start_date: string;
  end_date: string;
  half_day_start: boolean;
  half_day_end: boolean;
  reason: string | null;
}

export interface LeaveEvent {
  id: number;
  action: 'submitted' | 'approved' | 'rejected' | 'cancelled';
  actor: Ref;
  comment: string | null;
  created_at: string;
}

export interface LeaveRequest {
  id: number;
  employee: EmployeeRef;
  leave_type: LeaveTypeRef;
  start_date: string;
  end_date: string;
  half_day_start: boolean;
  half_day_end: boolean;
  days: number;
  reason: string | null;
  status: LeaveStatus;
  created_at: string;
  decided_at: string | null;
  decided_by: Ref | null;
  decision_comment: string | null;
  can_cancel: boolean;
  can_decide: boolean;
}

export interface LeaveRequestDetail extends LeaveRequest {
  events: LeaveEvent[];
}

export type RequestScope = 'all' | 'mine' | 'team' | 'approvals';
export type RequestSort = 'start_date' | '-start_date' | 'created_at' | '-created_at';

export interface RequestQuery {
  scope?: RequestScope;
  status?: LeaveStatus[];
  employee_id?: number | null;
  department_id?: number | null;
  leave_type_id?: number | null;
  year?: number | null;
  sort?: RequestSort;
  page?: number;
  page_size?: number;
}

export type EmployeeSort = 'name' | '-name' | 'department' | 'start_date' | '-start_date';

export interface EmployeeQuery {
  search?: string | null;
  department_id?: number | null;
  role?: Role | null;
  sort?: EmployeeSort;
  page?: number;
  page_size?: number;
}

export interface Absence {
  request_id: number;
  employee: EmployeeRef;
  /** null when the viewer may not see the reason someone is away */
  leave_type: LeaveTypeRef | null;
  start_date: string;
  end_date: string;
  half_day_start: boolean;
  half_day_end: boolean;
  days: number;
  status: LeaveStatus;
}

export interface CalendarMonth {
  year: number;
  month: number;
  holidays: Holiday[];
  absences: Absence[];
}

export interface DepartmentUsage {
  id: number;
  name: string;
  headcount: number;
  days: Record<string, number>;
}

export interface Dashboard {
  date: string;
  off_today: Absence[];
  off_this_week: Absence[];
  pending_approvals: number;
  my_pending: number;
  next_holidays: Holiday[];
  my_balances: Balance[];
  usage: {
    year: number;
    leave_types: LeaveTypeRef[];
    departments: DepartmentUsage[];
  };
}

export const ROLE_LABELS: Record<Role, string> = {
  employee: 'Employee',
  manager: 'Manager',
  hr: 'HR admin',
};

export const STATUS_LABELS: Record<LeaveStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};
