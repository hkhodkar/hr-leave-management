import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { map } from 'rxjs';
import { apiErrorMessage } from '../../core/api/api-error';
import { EmployeesApi } from '../../core/api/employees.api';
import { OverviewApi } from '../../core/api/overview.api';
import { Employee, EmployeeInput, ROLE_LABELS, Role } from '../../core/models/hr.models';
import { todayIso } from '../../core/utils/dates';
import { Modal } from '../../shared/ui/modal';

@Component({
  selector: 'app-employee-form',
  imports: [ReactiveFormsModule, Modal],
  templateUrl: './employee-form.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EmployeeForm implements OnInit {
  private readonly api = inject(EmployeesApi);

  /** The employee to edit, or null to add a new one. */
  readonly employee = input<Employee | null>(null);
  readonly saved = output<Employee>();
  readonly closed = output<void>();

  protected readonly departments = toSignal(inject(OverviewApi).departments$, { initialValue: [] });
  private readonly people = toSignal(
    this.api.list({ page_size: 200, sort: 'name' }).pipe(map((page) => page.items)),
    { initialValue: [] },
  );
  /** Anyone but the person being edited can be their manager. */
  protected readonly managers = computed(() =>
    this.people().filter((p) => p.id !== this.employee()?.id),
  );

  protected readonly roles = Object.entries(ROLE_LABELS) as [Role, string][];
  protected readonly saving = signal(false);
  protected readonly serverError = signal<string | null>(null);

  protected readonly form = new FormGroup({
    name: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.pattern(/\S/), Validators.maxLength(100)],
    }),
    email: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.email, Validators.maxLength(200)],
    }),
    job_title: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.pattern(/\S/), Validators.maxLength(100)],
    }),
    department_id: new FormControl<number | null>(null, Validators.required),
    manager_id: new FormControl<number | null>(null),
    role: new FormControl<Role>('employee', { nonNullable: true }),
    start_date: new FormControl(todayIso(), { nonNullable: true, validators: Validators.required }),
  });

  protected get isEdit(): boolean {
    return this.employee() !== null;
  }

  ngOnInit(): void {
    const employee = this.employee();
    if (employee) {
      this.form.setValue({
        name: employee.name,
        email: employee.email,
        job_title: employee.job_title,
        department_id: employee.department_id,
        manager_id: employee.manager_id,
        role: employee.role,
        start_date: employee.start_date,
      });
    }
  }

  protected showError(name: keyof typeof this.form.controls): boolean {
    const control = this.form.controls[name];
    return control.invalid && (control.touched || control.dirty);
  }

  protected submit(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid || this.saving()) return;
    const value = this.form.getRawValue();
    const input: EmployeeInput = {
      ...value,
      name: value.name.trim(),
      email: value.email.trim(),
      job_title: value.job_title.trim(),
      department_id: value.department_id!,
    };
    this.saving.set(true);
    this.serverError.set(null);
    const employee = this.employee();
    const request = employee ? this.api.update(employee.id, input) : this.api.create(input);
    request.subscribe({
      next: (saved) => {
        this.saving.set(false);
        this.saved.emit(saved);
      },
      error: (error: unknown) => {
        this.saving.set(false);
        if (error instanceof HttpErrorResponse && error.status === 409) {
          this.form.controls.email.setErrors({ taken: true });
        }
        this.serverError.set(apiErrorMessage(error, 'Could not save the employee'));
      },
    });
  }

  protected close(): void {
    this.closed.emit();
  }
}
