import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { rxResource, toSignal } from '@angular/core/rxjs-interop';
import { apiErrorMessage } from '../../core/api/api-error';
import { OverviewApi } from '../../core/api/overview.api';
import { Absence } from '../../core/models/hr.models';
import { SessionService } from '../../core/session/session.service';
import { todayIso } from '../../core/utils/dates';
import { formatDate, formatDateRange } from '../../core/utils/format';
import { Avatar } from '../../shared/ui/avatar';
import { Icon } from '../../shared/ui/icon';
import { LeaveTypeTag } from '../../shared/ui/leave-type-tag';
import { Modal } from '../../shared/ui/modal';
import { RequestDetail } from '../leave/request-detail';
import { CalendarDay, CalendarEntry, buildMonth, shortName } from './month-grid';

const MONTHS = new Intl.DateTimeFormat('en-GB', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});
const MAX_CHIPS = 3;

@Component({
  selector: 'app-calendar-page',
  imports: [Avatar, Icon, LeaveTypeTag, Modal, RequestDetail],
  templateUrl: './calendar-page.html',
  styleUrl: './calendar-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CalendarPage {
  private readonly api = inject(OverviewApi);
  private readonly session = inject(SessionService);

  protected readonly today = todayIso();
  protected readonly year = signal(Number(this.today.slice(0, 4)));
  protected readonly month = signal(Number(this.today.slice(5, 7)));
  protected readonly departmentId = signal<number | null>(null);

  protected readonly departments = toSignal(this.api.departments$, { initialValue: [] });
  protected readonly leaveTypes = toSignal(this.api.leaveTypes$, { initialValue: [] });

  protected readonly data = rxResource({
    params: () => ({
      user: this.session.userId(),
      year: this.year(),
      month: this.month(),
      department: this.departmentId(),
    }),
    stream: ({ params }) => this.api.calendar(params.year, params.month, params.department),
  });

  protected readonly title = computed(() =>
    MONTHS.format(new Date(Date.UTC(this.year(), this.month() - 1, 1))),
  );
  protected readonly weeks = computed(() => {
    const data = this.data.value();
    return data ? buildMonth(data, this.today) : [];
  });
  /** Days with someone off or a holiday, for the phone agenda. */
  protected readonly agenda = computed(() =>
    this.weeks()
      .flat()
      .filter((d) => d.inMonth && (d.entries.length > 0 || d.holiday)),
  );
  protected readonly peopleOff = computed(
    () => new Set(this.data.value()?.absences.map((a) => a.employee.id) ?? []).size,
  );

  protected readonly selectedDay = signal<CalendarDay | null>(null);
  protected readonly openRequestId = signal<number | null>(null);

  protected readonly weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  protected readonly maxChips = MAX_CHIPS;
  protected readonly shortName = shortName;
  protected readonly formatDate = formatDate;
  protected readonly formatDateRange = formatDateRange;

  protected errorText(error: unknown): string {
    return apiErrorMessage(error, 'Could not load the calendar');
  }

  protected move(step: number): void {
    const index = this.year() * 12 + this.month() - 1 + step;
    this.year.set(Math.floor(index / 12));
    this.month.set((index % 12) + 1);
  }

  protected goToday(): void {
    this.year.set(Number(this.today.slice(0, 4)));
    this.month.set(Number(this.today.slice(5, 7)));
  }

  protected isCurrentMonth(): boolean {
    return `${this.year()}-${String(this.month()).padStart(2, '0')}` === this.today.slice(0, 7);
  }

  protected setDepartment(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.departmentId.set(value ? Number(value) : null);
  }

  protected chipTitle(entry: CalendarEntry): string {
    const a = entry.absence;
    const type = a.leave_type?.name ?? 'Away';
    const pending = a.status === 'pending' ? ' (pending)' : '';
    const half = entry.half ? `, ${entry.half} only` : '';
    return `${a.employee.name}: ${type}${pending}${half}, ${formatDateRange(a.start_date, a.end_date)}`;
  }

  /** Only requests the viewer may open (their own, their team's, or anyone's for HR). */
  protected canOpen(absence: Absence): boolean {
    return absence.leave_type !== null;
  }

  protected openEntry(absence: Absence): void {
    if (this.canOpen(absence)) {
      this.selectedDay.set(null);
      this.openRequestId.set(absence.request_id);
    }
  }

  protected showDay(day: CalendarDay): void {
    this.selectedDay.set(day);
  }

  protected closeDay(): void {
    this.selectedDay.set(null);
  }

  protected closeRequest(): void {
    this.openRequestId.set(null);
  }

  protected changed(): void {
    this.data.reload();
    this.session.refresh();
  }
}
