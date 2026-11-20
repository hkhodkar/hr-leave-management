import { ChangeDetectionStrategy, Component, inject, linkedSignal, signal } from '@angular/core';
import { rxResource, toSignal } from '@angular/core/rxjs-interop';
import { apiErrorMessage } from '../../core/api/api-error';
import { LeaveApi } from '../../core/api/leave.api';
import { OverviewApi } from '../../core/api/overview.api';
import { LeaveRequest } from '../../core/models/hr.models';
import { SessionService } from '../../core/session/session.service';
import {
  formatDateRange,
  formatDays,
  formatTimestamp,
  halfDayLabel,
} from '../../core/utils/format';
import { Avatar } from '../../shared/ui/avatar';
import { Icon } from '../../shared/ui/icon';
import { LeaveTypeTag } from '../../shared/ui/leave-type-tag';
import { Pagination } from '../../shared/ui/pagination';
import { ToastService } from '../../shared/ui/toast.service';
import { RejectDialog } from '../leave/reject-dialog';
import { RequestDetail } from '../leave/request-detail';
import { RequestTable } from '../leave/request-table';

type Tab = 'pending' | 'history';

@Component({
  selector: 'app-approvals-page',
  imports: [Avatar, Icon, LeaveTypeTag, Pagination, RejectDialog, RequestDetail, RequestTable],
  templateUrl: './approvals-page.html',
  styleUrl: './approvals-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ApprovalsPage {
  private readonly api = inject(LeaveApi);
  private readonly toast = inject(ToastService);
  protected readonly session = inject(SessionService);

  protected readonly departments = toSignal(inject(OverviewApi).departments$, { initialValue: [] });

  protected readonly tab = signal<Tab>('pending');
  protected readonly departmentId = signal<number | null>(null);
  protected readonly page = linkedSignal({
    source: () => [this.tab(), this.departmentId(), this.session.userId()],
    computation: () => 1,
  });
  protected readonly pageSize = 10;

  protected readonly busyId = signal<number | null>(null);
  protected readonly rejectTarget = signal<LeaveRequest | null>(null);
  protected readonly rejectError = signal<string | null>(null);
  protected readonly openRequestId = signal<number | null>(null);

  protected readonly requests = rxResource({
    params: () => ({
      user: this.session.userId(),
      tab: this.tab(),
      department: this.departmentId(),
      page: this.page(),
    }),
    stream: ({ params }) =>
      this.api.list({
        scope: 'approvals',
        status: params.tab === 'pending' ? ['pending'] : ['approved', 'rejected', 'cancelled'],
        department_id: params.department,
        // soonest first while deciding, most recent first in the history
        sort: params.tab === 'pending' ? 'start_date' : '-created_at',
        page: params.page,
        page_size: this.pageSize,
      }),
  });

  protected readonly dateRange = formatDateRange;
  protected readonly days = formatDays;
  protected readonly halfDay = halfDayLabel;
  protected readonly stamp = formatTimestamp;

  protected errorText(error: unknown): string {
    return apiErrorMessage(error, 'Could not load the requests');
  }

  protected setTab(tab: Tab): void {
    this.tab.set(tab);
  }

  protected setDepartment(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.departmentId.set(value ? Number(value) : null);
  }

  protected approve(request: LeaveRequest): void {
    if (this.busyId()) return;
    this.busyId.set(request.id);
    this.api.approve(request.id).subscribe({
      next: () => {
        this.busyId.set(null);
        this.toast.success(
          `Approved ${request.employee.name}'s ${request.leave_type.name.toLowerCase()}`,
        );
        this.changed();
      },
      error: (error: unknown) => {
        this.busyId.set(null);
        this.toast.error(apiErrorMessage(error));
        this.changed();
      },
    });
  }

  protected askReject(request: LeaveRequest): void {
    this.rejectError.set(null);
    this.rejectTarget.set(request);
  }

  protected closeReject(): void {
    this.rejectTarget.set(null);
  }

  protected reject(request: LeaveRequest, comment: string): void {
    this.busyId.set(request.id);
    this.api.reject(request.id, comment).subscribe({
      next: () => {
        this.busyId.set(null);
        this.rejectTarget.set(null);
        this.toast.success(`Rejected ${request.employee.name}'s request`);
        this.changed();
      },
      error: (error: unknown) => {
        this.busyId.set(null);
        this.rejectError.set(apiErrorMessage(error));
      },
    });
  }

  protected summary(request: LeaveRequest): string {
    return `${request.leave_type.name}, ${formatDateRange(request.start_date, request.end_date)} (${formatDays(request.days)})`;
  }

  protected open(request: LeaveRequest): void {
    this.openRequestId.set(request.id);
  }

  protected closeRequest(): void {
    this.openRequestId.set(null);
  }

  protected changed(): void {
    this.requests.reload();
    this.session.refresh();
  }
}
