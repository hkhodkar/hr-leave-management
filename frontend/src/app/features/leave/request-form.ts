import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { apiErrorMessage } from '../../core/api/api-error';
import { EmployeesApi } from '../../core/api/employees.api';
import { LeaveApi } from '../../core/api/leave.api';
import { OverviewApi } from '../../core/api/overview.api';
import { Balance, LeaveRequestDetail, LeaveType } from '../../core/models/hr.models';
import { SessionService } from '../../core/session/session.service';
import { todayIso, yearOf } from '../../core/utils/dates';
import { formatDate, formatDays } from '../../core/utils/format';
import { nextWorkingDay } from '../../core/utils/working-days';
import { Icon } from '../../shared/ui/icon';
import { Modal } from '../../shared/ui/modal';
import {
  DayPart,
  LeaveFormContext,
  leaveErrorMessage,
  leaveRequestValidators,
  requestedDays,
  toRequestInput,
} from './request-validators';

@Component({
  selector: 'app-request-form',
  imports: [ReactiveFormsModule, Modal, Icon],
  templateUrl: './request-form.html',
  styleUrl: './request-form.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RequestForm {
  private readonly leaveApi = inject(LeaveApi);
  private readonly employeesApi = inject(EmployeesApi);
  private readonly overviewApi = inject(OverviewApi);
  private readonly session = inject(SessionService);

  readonly saved = output<LeaveRequestDetail>();
  readonly closed = output<void>();

  protected readonly today = todayIso();
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly submitted = signal(false);
  protected readonly serverError = signal<string | null>(null);

  private readonly context = signal<LeaveFormContext>({
    today: this.today,
    holidays: new Set(),
    leaveTypes: [],
    balances: [],
    existing: [],
  });

  protected readonly form = new FormGroup(
    {
      leave_type_id: new FormControl<number | null>(null, Validators.required),
      start_date: new FormControl('', { nonNullable: true, validators: Validators.required }),
      end_date: new FormControl('', { nonNullable: true, validators: Validators.required }),
      day_part: new FormControl<DayPart>('full', { nonNullable: true }),
      half_day_start: new FormControl(false, { nonNullable: true }),
      half_day_end: new FormControl(false, { nonNullable: true }),
      reason: new FormControl('', { nonNullable: true, validators: Validators.maxLength(500) }),
    },
    { validators: leaveRequestValidators(() => this.context()) },
  );

  private readonly value = toSignal(this.form.valueChanges, {
    initialValue: this.form.getRawValue(),
  });
  private readonly status = toSignal(this.form.statusChanges, { initialValue: this.form.status });

  protected readonly leaveTypes = computed(() => this.context().leaveTypes);
  protected readonly singleDay = computed(() => {
    const { start_date, end_date } = this.value();
    return !!start_date && start_date === end_date;
  });
  protected readonly input = computed(() => {
    this.value();
    return toRequestInput(this.form.getRawValue());
  });
  protected readonly days = computed(() => requestedDays(this.input(), this.context().holidays));

  /** Bank holidays inside the chosen dates, shown under the day count. */
  protected readonly holidaysInRange = computed(() => {
    const input = this.input();
    if (!input || input.end_date < input.start_date) return [];
    return this.holidayList().filter((h) => h.date >= input.start_date && h.date <= input.end_date);
  });
  private readonly holidayList = signal<{ date: string; name: string }[]>([]);
  protected readonly holidayNames = computed(() =>
    this.holidaysInRange()
      .map((h) => h.name)
      .join(', '),
  );

  protected readonly selectedBalance = computed<Balance | null>(() => {
    const input = this.input();
    const typeId = this.value().leave_type_id;
    const year = input ? yearOf(input.start_date) : yearOf(this.today);
    return (
      this.context().balances.find((b) => b.leave_type.id === typeId && b.year === year) ?? null
    );
  });

  // the status can stay INVALID while the reason changes, so follow the value too
  protected readonly problem = computed(() => {
    this.value();
    this.status();
    return leaveErrorMessage(this.form.errors);
  });

  protected readonly formatDays = formatDays;
  protected readonly formatDate = formatDate;

  constructor() {
    const userId = this.session.userId();
    const year = yearOf(this.today);
    forkJoin({
      types: this.overviewApi.leaveTypes$,
      holidays: this.overviewApi.holidays(year),
      nextHolidays: this.overviewApi.holidays(year + 1),
      balances: this.employeesApi.balances(userId, year),
      nextBalances: this.employeesApi.balances(userId, year + 1),
      existing: this.leaveApi.list({
        scope: 'mine',
        status: ['pending', 'approved'],
        page_size: 200,
      }),
    })
      .pipe(takeUntilDestroyed(inject(DestroyRef)))
      .subscribe({
        next: (data) => {
          const holidays = [...data.holidays, ...data.nextHolidays];
          this.holidayList.set(holidays);
          this.context.set({
            today: this.today,
            holidays: new Set(holidays.map((h) => h.date)),
            leaveTypes: data.types,
            balances: [...data.balances, ...data.nextBalances],
            existing: data.existing.items,
          });
          const first = nextWorkingDay(this.today, this.context().holidays);
          this.form.patchValue({
            leave_type_id: data.types.find((t) => t.code === 'annual')?.id ?? data.types[0]?.id,
            start_date: first,
            end_date: first,
          });
          this.loading.set(false);
        },
        error: (error: unknown) => {
          this.serverError.set(apiErrorMessage(error, 'Could not load your balances'));
          this.loading.set(false);
        },
      });

    // moving the start past the end drags the end along
    this.form.controls.start_date.valueChanges.pipe(takeUntilDestroyed()).subscribe((start) => {
      const end = this.form.controls.end_date.value;
      if (start && (!end || end < start)) {
        this.form.controls.end_date.setValue(start);
      }
    });
  }

  protected remainingLabel(type: LeaveType): string {
    const input = this.input();
    const year = input ? yearOf(input.start_date) : yearOf(this.today);
    const balance = this.context().balances.find(
      (b) => b.leave_type.id === type.id && b.year === year,
    );
    if (!balance || balance.remaining === null) return 'No yearly limit';
    return `${formatDays(balance.remaining)} left`;
  }

  protected remainingAfter(): number | null {
    const balance = this.selectedBalance();
    if (!balance || balance.remaining === null) return null;
    return balance.remaining - this.days();
  }

  protected showDateErrors(): boolean {
    const { start_date, end_date } = this.form.controls;
    return this.submitted() || start_date.dirty || end_date.dirty || start_date.touched;
  }

  protected submit(): void {
    this.submitted.set(true);
    this.form.markAllAsTouched();
    const input = toRequestInput(this.form.getRawValue());
    if (this.form.invalid || !input || this.saving()) return;
    this.saving.set(true);
    this.serverError.set(null);
    this.leaveApi.create(input).subscribe({
      next: (request) => {
        this.saving.set(false);
        this.saved.emit(request);
      },
      error: (error: unknown) => {
        this.saving.set(false);
        this.serverError.set(apiErrorMessage(error, 'Could not send the request'));
      },
    });
  }

  protected close(): void {
    this.closed.emit();
  }
}
