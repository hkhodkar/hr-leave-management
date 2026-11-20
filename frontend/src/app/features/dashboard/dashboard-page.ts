import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { ChartConfiguration } from 'chart.js';
import { apiErrorMessage } from '../../core/api/api-error';
import { LeaveApi } from '../../core/api/leave.api';
import { OverviewApi } from '../../core/api/overview.api';
import { Absence, Dashboard } from '../../core/models/hr.models';
import { SessionService } from '../../core/session/session.service';
import { daysBetween } from '../../core/utils/dates';
import { formatDate, formatDateRange, formatDays } from '../../core/utils/format';
import { ChartDirective } from '../../shared/directives/chart.directive';
import { Avatar } from '../../shared/ui/avatar';
import { Icon } from '../../shared/ui/icon';
import { LeaveTypeTag } from '../../shared/ui/leave-type-tag';
import { BalanceCards } from '../leave/balance-cards';
import { RequestDetail } from '../leave/request-detail';

type UsageMode = 'total' | 'per-person';

@Component({
  selector: 'app-dashboard-page',
  imports: [RouterLink, ChartDirective, Avatar, Icon, LeaveTypeTag, BalanceCards, RequestDetail],
  templateUrl: './dashboard-page.html',
  styleUrl: './dashboard-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardPage {
  private readonly api = inject(OverviewApi);
  private readonly leaveApi = inject(LeaveApi);
  protected readonly session = inject(SessionService);

  protected readonly dashboard = rxResource({
    params: () => this.session.userId(),
    stream: () => this.api.dashboard(),
  });

  /** The next few requests waiting for the acting user. */
  protected readonly waiting = rxResource({
    params: () => (this.session.canApprove() ? { user: this.session.userId() } : undefined),
    stream: () =>
      this.leaveApi.list({
        scope: 'approvals',
        status: ['pending'],
        sort: 'start_date',
        page_size: 4,
      }),
  });

  protected readonly usageMode = signal<UsageMode>('total');
  protected readonly openRequestId = signal<number | null>(null);

  protected readonly firstName = computed(() => this.session.current()?.name.split(' ')[0] ?? '');
  protected readonly greeting = computed(() => {
    const hour = new Date().getHours();
    return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  });

  /** Everyone off this week, except those already listed as off today. */
  protected readonly alsoThisWeek = computed(() => {
    const data = this.dashboard.value();
    if (!data) return [];
    const today = new Set(data.off_today.map((a) => a.request_id));
    return data.off_this_week.filter((a) => !today.has(a.request_id));
  });

  protected readonly chart = computed<ChartConfiguration<'bar'> | null>(() => {
    const data = this.dashboard.value();
    return data ? usageChart(data, this.usageMode()) : null;
  });

  protected readonly formatDate = formatDate;
  protected readonly formatDateRange = formatDateRange;
  protected readonly formatDays = formatDays;

  protected errorText(error: unknown): string {
    return apiErrorMessage(error, 'Could not load the dashboard');
  }

  protected setMode(mode: UsageMode): void {
    this.usageMode.set(mode);
  }

  protected backOn(absence: Absence, today: string): string {
    if (absence.end_date === today) {
      return absence.half_day_end ? 'Back this afternoon' : 'Back tomorrow';
    }
    const days = daysBetween(today, absence.end_date);
    return days < 7
      ? `Until ${formatDate(absence.end_date, 'weekday')}`
      : `Until ${formatDate(absence.end_date)}`;
  }

  protected daysUntil(date: string, today: string): string {
    const days = daysBetween(today, date);
    if (days === 0) return 'Today';
    if (days === 1) return 'Tomorrow';
    return `In ${days} days`;
  }

  protected open(absence: Absence): void {
    if (absence.leave_type) {
      this.openRequestId.set(absence.request_id);
    }
  }

  protected openRequest(id: number): void {
    this.openRequestId.set(id);
  }

  protected closeRequest(): void {
    this.openRequestId.set(null);
  }

  protected changed(): void {
    this.dashboard.reload();
    this.waiting.reload();
    this.session.refresh();
  }
}

function usageChart(data: Dashboard, mode: UsageMode): ChartConfiguration<'bar'> {
  const departments = data.usage.departments;
  const perPerson = mode === 'per-person';
  return {
    type: 'bar',
    data: {
      labels: departments.map((d) => d.name),
      datasets: data.usage.leave_types.map((type) => ({
        label: type.name,
        data: departments.map((d) => {
          const days = d.days[type.code] ?? 0;
          return perPerson ? Math.round((days / Math.max(d.headcount, 1)) * 10) / 10 : days;
        }),
        backgroundColor: type.color,
        borderRadius: 4,
        barThickness: 18,
      })),
    },
    options: {
      indexAxis: 'y',
      maintainAspectRatio: false,
      animation: { duration: 300 },
      scales: {
        x: {
          stacked: true,
          grid: { color: '#eef1f4' },
          border: { display: false },
          title: {
            display: true,
            text: perPerson ? 'Days per person' : 'Days taken',
            color: '#5f6f7c',
          },
        },
        y: { stacked: true, grid: { display: false }, border: { display: false } },
      },
      plugins: {
        legend: {
          position: 'bottom',
          labels: { boxWidth: 12, boxHeight: 12, useBorderRadius: true, borderRadius: 3 },
        },
        tooltip: {
          callbacks: {
            label: (item) => ` ${item.dataset.label}: ${item.formattedValue} days`,
          },
        },
      },
    },
  };
}
