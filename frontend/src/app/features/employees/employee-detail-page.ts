import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
  signal,
} from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { apiErrorMessage } from '../../core/api/api-error';
import { EmployeesApi } from '../../core/api/employees.api';
import { LeaveApi } from '../../core/api/leave.api';
import { Employee, LeaveRequest, ROLE_LABELS } from '../../core/models/hr.models';
import { SessionService } from '../../core/session/session.service';
import { todayIso, yearOf } from '../../core/utils/dates';
import { formatDate } from '../../core/utils/format';
import { Avatar } from '../../shared/ui/avatar';
import { Icon } from '../../shared/ui/icon';
import { Pagination } from '../../shared/ui/pagination';
import { ToastService } from '../../shared/ui/toast.service';
import { BalanceCards } from '../leave/balance-cards';
import { RequestDetail } from '../leave/request-detail';
import { RequestTable } from '../leave/request-table';
import { EmployeeForm } from './employee-form';

@Component({
  selector: 'app-employee-detail-page',
  imports: [
    RouterLink,
    Avatar,
    Icon,
    Pagination,
    BalanceCards,
    RequestDetail,
    RequestTable,
    EmployeeForm,
  ],
  templateUrl: './employee-detail-page.html',
  styleUrl: './employee-detail-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EmployeeDetailPage {
  private readonly employeesApi = inject(EmployeesApi);
  private readonly leaveApi = inject(LeaveApi);
  private readonly toast = inject(ToastService);
  protected readonly session = inject(SessionService);

  /** Route parameter. */
  readonly id = input.required<string>();
  protected readonly employeeId = computed(() => Number(this.id()));

  private readonly currentYear = yearOf(todayIso());
  protected readonly years = [this.currentYear - 1, this.currentYear, this.currentYear + 1];
  protected readonly year = signal(this.currentYear);
  protected readonly page = linkedSignal({
    source: () => [this.employeeId(), this.year(), this.session.userId()],
    computation: () => 1,
  });

  protected readonly employee = rxResource({
    params: () => ({ id: this.employeeId(), user: this.session.userId() }),
    stream: ({ params }) => this.employeesApi.get(params.id),
  });

  /** Same rule as the API: yourself, your direct reports, or anyone for HR. */
  protected readonly canSeeLeave = computed(() => {
    const employee = this.employee.value();
    const viewer = this.session.userId();
    if (!employee) return false;
    return employee.id === viewer || employee.manager_id === viewer || this.session.isHr();
  });

  protected readonly balances = rxResource({
    params: () =>
      this.canSeeLeave()
        ? { id: this.employeeId(), year: this.year(), user: this.session.userId() }
        : undefined,
    stream: ({ params }) => this.employeesApi.balances(params.id, params.year),
  });

  protected readonly requests = rxResource({
    params: () =>
      this.canSeeLeave()
        ? {
            id: this.employeeId(),
            year: this.year(),
            page: this.page(),
            user: this.session.userId(),
          }
        : undefined,
    stream: ({ params }) =>
      this.leaveApi.list({
        employee_id: params.id,
        year: params.year,
        sort: '-start_date',
        page: params.page,
        page_size: 8,
      }),
  });

  /** The API would answer 403 here, so the page explains instead of asking. */
  protected readonly restricted = computed(() => {
    const error = this.balances.error();
    const forbidden = error instanceof HttpErrorResponse && error.status === 403;
    return forbidden || (this.employee.hasValue() && !this.canSeeLeave());
  });

  protected readonly editing = signal(false);
  protected readonly openRequestId = signal<number | null>(null);
  protected readonly roleLabels = ROLE_LABELS;
  protected readonly formatDate = formatDate;

  protected errorText(error: unknown, fallback: string): string {
    return apiErrorMessage(error, fallback);
  }

  protected isNotFound(): boolean {
    const error = this.employee.error();
    return error instanceof HttpErrorResponse && error.status === 404;
  }

  protected setYear(event: Event): void {
    this.year.set(Number((event.target as HTMLSelectElement).value));
  }

  protected tenure(employee: Employee): string {
    const months =
      (yearOf(todayIso()) - yearOf(employee.start_date)) * 12 +
      Number(todayIso().slice(5, 7)) -
      Number(employee.start_date.slice(5, 7));
    if (months < 1) return 'Joined this month';
    if (months < 12) return `${months} ${months === 1 ? 'month' : 'months'}`;
    const years = Math.floor(months / 12);
    return `${years} ${years === 1 ? 'year' : 'years'}`;
  }

  protected openRequest(request: LeaveRequest): void {
    this.openRequestId.set(request.id);
  }

  protected closeRequest(): void {
    this.openRequestId.set(null);
  }

  protected edit(): void {
    this.editing.set(true);
  }

  protected closeForm(): void {
    this.editing.set(false);
  }

  protected onSaved(): void {
    this.editing.set(false);
    this.toast.success('Changes saved');
    this.employee.reload();
    this.balances.reload();
    this.session.refreshUsers();
  }

  protected changed(): void {
    this.balances.reload();
    this.requests.reload();
    this.session.refresh();
  }
}
