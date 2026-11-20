import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { LeaveRequest } from '../../core/models/hr.models';
import {
  formatDateRange,
  formatDays,
  formatTimestamp,
  halfDayLabel,
} from '../../core/utils/format';
import { Avatar } from '../../shared/ui/avatar';
import { LeaveTypeTag } from '../../shared/ui/leave-type-tag';
import { StatusBadge } from '../../shared/ui/status-badge';

/** Leave requests as a table on wide screens and stacked rows on phones. */
@Component({
  selector: 'app-request-table',
  imports: [Avatar, LeaveTypeTag, StatusBadge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="table-wrap">
      <table class="table">
        <thead>
          <tr>
            @if (showEmployee()) {
              <th>Employee</th>
            }
            <th>Type</th>
            <th>Dates</th>
            <th class="num">Days</th>
            <th>Status</th>
            <th>Requested</th>
          </tr>
        </thead>
        <tbody>
          @for (r of requests(); track r.id) {
            <tr
              class="clickable"
              tabindex="0"
              (click)="open(r)"
              (keydown.enter)="open(r)"
              [attr.aria-label]="'Open request ' + r.id"
            >
              @if (showEmployee()) {
                <td>
                  <div class="cell-main">
                    <app-avatar [name]="r.employee.name" [size]="30" />
                    <div>
                      <strong>{{ r.employee.name }}</strong>
                      <small>{{ r.employee.job_title }}</small>
                    </div>
                  </div>
                </td>
              }
              <td><app-leave-type-tag [type]="r.leave_type" /></td>
              <td>
                {{ dateRange(r.start_date, r.end_date) }}
                @if (halfDay(r); as half) {
                  <small class="half">{{ half }}</small>
                }
              </td>
              <td class="num">
                {{ r.days }}<span class="unit"> {{ r.days === 1 ? 'day' : 'days' }}</span>
              </td>
              <td><app-status-badge [status]="r.status" /></td>
              <td class="text-muted">{{ stamp(r.created_at) }}</td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
  styles: `
    .unit {
      display: none;
    }

    .half {
      display: block;
      color: var(--text-muted);
      font-size: 12px;
    }

    @media (max-width: 720px) {
      // stack rows into cards so nothing needs sideways scrolling
      .table thead {
        display: none;
      }

      .table,
      .table tbody,
      .table tr,
      .table td {
        display: block;
        width: 100%;
      }

      .table tr {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 6px 12px;
        padding: 14px 16px;
      }

      .table td {
        padding: 0 !important;
        white-space: normal;
      }

      .table td.num {
        text-align: left;
      }

      .unit {
        display: inline;
        color: var(--text-muted);
      }
    }
  `,
})
export class RequestTable {
  readonly requests = input.required<LeaveRequest[]>();
  readonly showEmployee = input(false);
  readonly opened = output<LeaveRequest>();

  protected readonly dateRange = formatDateRange;
  protected readonly days = formatDays;
  protected readonly halfDay = halfDayLabel;

  protected stamp(value: string): string {
    return formatTimestamp(value).replace(/,? \d\d:\d\d$/, '');
  }

  protected open(request: LeaveRequest): void {
    this.opened.emit(request);
  }
}
