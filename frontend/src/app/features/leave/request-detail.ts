import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Observable } from 'rxjs';
import { apiErrorMessage } from '../../core/api/api-error';
import { LeaveApi } from '../../core/api/leave.api';
import { LeaveEvent, LeaveRequestDetail } from '../../core/models/hr.models';
import {
  formatDateRange,
  formatDays,
  formatTimestamp,
  halfDayLabel,
} from '../../core/utils/format';
import { Avatar } from '../../shared/ui/avatar';
import { ConfirmDialog } from '../../shared/ui/confirm-dialog';
import { Icon, IconName } from '../../shared/ui/icon';
import { LeaveTypeTag } from '../../shared/ui/leave-type-tag';
import { Modal } from '../../shared/ui/modal';
import { StatusBadge } from '../../shared/ui/status-badge';
import { ToastService } from '../../shared/ui/toast.service';
import { RejectDialog } from './reject-dialog';

const EVENT_TEXT: Record<LeaveEvent['action'], { verb: string; icon: IconName }> = {
  submitted: { verb: 'requested the leave', icon: 'send' },
  approved: { verb: 'approved', icon: 'check-circle' },
  rejected: { verb: 'rejected', icon: 'x-circle' },
  cancelled: { verb: 'cancelled', icon: 'x' },
};

/** A request with its history, and the actions the acting user may take. */
@Component({
  selector: 'app-request-detail',
  imports: [
    FormsModule,
    Modal,
    Avatar,
    Icon,
    LeaveTypeTag,
    StatusBadge,
    ConfirmDialog,
    RejectDialog,
  ],
  templateUrl: './request-detail.html',
  styleUrl: './request-detail.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RequestDetail {
  private readonly api = inject(LeaveApi);
  private readonly toast = inject(ToastService);

  readonly requestId = input.required<number>();
  readonly changed = output<LeaveRequestDetail>();
  readonly closed = output<void>();

  protected readonly request = rxResource({
    params: () => this.requestId(),
    stream: ({ params }) => this.api.get(params),
  });

  protected readonly busy = signal(false);
  protected readonly confirmCancel = signal(false);
  protected readonly rejecting = signal(false);
  protected readonly actionError = signal<string | null>(null);

  protected readonly loadError = computed(() =>
    this.request.error()
      ? apiErrorMessage(this.request.error(), 'Could not load the request')
      : null,
  );

  protected readonly eventText = EVENT_TEXT;
  protected readonly formatDateRange = formatDateRange;
  protected readonly formatDays = formatDays;
  protected readonly formatTimestamp = formatTimestamp;
  protected readonly halfDayLabel = halfDayLabel;

  protected approve(request: LeaveRequestDetail): void {
    this.run(this.api.approve(request.id), `Approved ${request.employee.name}'s leave`);
  }

  protected openReject(): void {
    this.actionError.set(null);
    this.rejecting.set(true);
  }

  protected closeReject(): void {
    this.rejecting.set(false);
  }

  protected reject(request: LeaveRequestDetail, comment: string): void {
    this.run(this.api.reject(request.id, comment), 'Request rejected', () =>
      this.rejecting.set(false),
    );
  }

  protected askCancel(): void {
    this.confirmCancel.set(true);
  }

  protected keepRequest(): void {
    this.confirmCancel.set(false);
  }

  protected cancel(request: LeaveRequestDetail): void {
    this.run(this.api.cancel(request.id), 'Request cancelled', () => this.confirmCancel.set(false));
  }

  protected close(): void {
    this.closed.emit();
  }

  private run(call: Observable<LeaveRequestDetail>, message: string, done?: () => void): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.actionError.set(null);
    call.subscribe({
      next: (updated) => {
        this.busy.set(false);
        done?.();
        this.request.set(updated);
        this.toast.success(message);
        this.changed.emit(updated);
      },
      error: (error: unknown) => {
        this.busy.set(false);
        const text = apiErrorMessage(error, 'Something went wrong');
        if (this.rejecting()) {
          this.actionError.set(text);
        } else {
          done?.();
          this.toast.error(text);
        }
      },
    });
  }
}
