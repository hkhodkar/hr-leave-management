import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  linkedSignal,
  signal,
} from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { apiErrorMessage } from '../../core/api/api-error';
import { EmployeesApi } from '../../core/api/employees.api';
import { LeaveApi } from '../../core/api/leave.api';
import { LeaveRequest, LeaveRequestDetail, LeaveStatus } from '../../core/models/hr.models';
import { SessionService } from '../../core/session/session.service';
import { todayIso, yearOf } from '../../core/utils/dates';
import { Icon } from '../../shared/ui/icon';
import { Pagination } from '../../shared/ui/pagination';
import { ToastService } from '../../shared/ui/toast.service';
import { BalanceCards } from './balance-cards';
import { RequestDetail } from './request-detail';
import { RequestForm } from './request-form';
import { RequestTable } from './request-table';

type StatusFilter = LeaveStatus | 'all';

@Component({
  selector: 'app-my-leave-page',
  imports: [Icon, Pagination, BalanceCards, RequestForm, RequestDetail, RequestTable],
  templateUrl: './my-leave-page.html',
  styleUrl: './my-leave-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MyLeavePage {
  private readonly employeesApi = inject(EmployeesApi);
  private readonly leaveApi = inject(LeaveApi);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  protected readonly session = inject(SessionService);

  /** `?book=1` opens the request form straight away (used by the dashboard). */
  readonly book = input<string>();

  private readonly currentYear = yearOf(todayIso());
  protected readonly years = [this.currentYear, this.currentYear + 1];
  protected readonly year = signal(this.currentYear);
  protected readonly status = signal<StatusFilter>('all');
  protected readonly page = linkedSignal({
    source: () => [this.status(), this.year(), this.session.userId()],
    computation: () => 1,
  });
  protected readonly pageSize = 10;

  protected readonly formOpen = linkedSignal(() => this.book() === '1');
  protected readonly openRequestId = signal<number | null>(null);

  protected readonly statusFilters: { value: StatusFilter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'pending', label: 'Pending' },
    { value: 'approved', label: 'Approved' },
    { value: 'rejected', label: 'Rejected' },
    { value: 'cancelled', label: 'Cancelled' },
  ];

  protected readonly balances = rxResource({
    params: () => ({ user: this.session.userId(), year: this.year() }),
    stream: ({ params }) => this.employeesApi.balances(params.user, params.year),
  });

  protected readonly requests = rxResource({
    params: () => ({
      user: this.session.userId(),
      year: this.year(),
      status: this.status(),
      page: this.page(),
    }),
    stream: ({ params }) =>
      this.leaveApi.list({
        scope: 'mine',
        year: params.year,
        status: params.status === 'all' ? [] : [params.status],
        sort: '-start_date',
        page: params.page,
        page_size: this.pageSize,
      }),
  });

  protected errorText(error: unknown): string {
    return apiErrorMessage(error, 'Could not load your leave');
  }

  protected setYear(event: Event): void {
    this.year.set(Number((event.target as HTMLSelectElement).value));
  }

  protected setStatus(value: StatusFilter): void {
    this.status.set(value);
  }

  protected openForm(): void {
    this.formOpen.set(true);
  }

  protected closeForm(): void {
    this.formOpen.set(false);
    if (this.book()) {
      void this.router.navigate([], { queryParams: { book: null }, replaceUrl: true });
    }
  }

  protected onSaved(request: LeaveRequestDetail): void {
    this.closeForm();
    this.toast.success(`Request sent for ${request.days} ${request.days === 1 ? 'day' : 'days'}`);
    this.year.set(yearOf(request.start_date));
    this.reload();
  }

  protected openRequest(request: LeaveRequest): void {
    this.openRequestId.set(request.id);
  }

  protected closeRequest(): void {
    this.openRequestId.set(null);
  }

  protected reload(): void {
    this.balances.reload();
    this.requests.reload();
    this.session.refresh();
  }
}
