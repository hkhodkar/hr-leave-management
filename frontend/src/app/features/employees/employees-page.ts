import { ChangeDetectionStrategy, Component, inject, linkedSignal, signal } from '@angular/core';
import { rxResource, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { debounceTime, distinctUntilChanged, map } from 'rxjs';
import { apiErrorMessage } from '../../core/api/api-error';
import { EmployeesApi } from '../../core/api/employees.api';
import { OverviewApi } from '../../core/api/overview.api';
import { Employee, EmployeeSort, ROLE_LABELS } from '../../core/models/hr.models';
import { SessionService } from '../../core/session/session.service';
import { formatDate } from '../../core/utils/format';
import { Avatar } from '../../shared/ui/avatar';
import { Icon } from '../../shared/ui/icon';
import { Pagination } from '../../shared/ui/pagination';
import { ToastService } from '../../shared/ui/toast.service';
import { EmployeeForm } from './employee-form';

@Component({
  selector: 'app-employees-page',
  imports: [Avatar, Icon, Pagination, EmployeeForm],
  templateUrl: './employees-page.html',
  styleUrl: './employees-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EmployeesPage {
  private readonly api = inject(EmployeesApi);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  protected readonly session = inject(SessionService);

  protected readonly departments = toSignal(inject(OverviewApi).departments$, { initialValue: [] });

  protected readonly searchText = signal('');
  private readonly search = toSignal(
    toObservable(this.searchText).pipe(
      debounceTime(250),
      map((text) => text.trim()),
      distinctUntilChanged(),
    ),
    { initialValue: '' },
  );
  protected readonly departmentId = signal<number | null>(null);
  protected readonly sort = signal<EmployeeSort>('name');
  protected readonly page = linkedSignal({
    source: () => [this.search(), this.departmentId(), this.sort()],
    computation: () => 1,
  });
  protected readonly pageSize = 10;

  protected readonly employees = rxResource({
    params: () => ({
      search: this.search(),
      department: this.departmentId(),
      sort: this.sort(),
      page: this.page(),
      user: this.session.userId(),
    }),
    stream: ({ params }) =>
      this.api.list({
        search: params.search,
        department_id: params.department,
        sort: params.sort,
        page: params.page,
        page_size: this.pageSize,
      }),
  });

  protected readonly editing = signal<Employee | null | undefined>(undefined);
  protected readonly roleLabels = ROLE_LABELS;
  protected readonly formatDate = formatDate;

  protected errorText(error: unknown): string {
    return apiErrorMessage(error, 'Could not load employees');
  }

  protected onSearch(event: Event): void {
    this.searchText.set((event.target as HTMLInputElement).value);
  }

  protected setDepartment(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.departmentId.set(value ? Number(value) : null);
  }

  protected setSort(event: Event): void {
    this.sort.set((event.target as HTMLSelectElement).value as EmployeeSort);
  }

  protected open(employee: Employee): void {
    void this.router.navigate(['/employees', employee.id]);
  }

  protected add(): void {
    this.editing.set(null);
  }

  protected edit(employee: Employee, event: Event): void {
    event.stopPropagation();
    this.editing.set(employee);
  }

  protected closeForm(): void {
    this.editing.set(undefined);
  }

  protected onSaved(employee: Employee): void {
    const isNew = this.editing() === null;
    this.closeForm();
    this.toast.success(isNew ? `${employee.name} was added` : 'Changes saved');
    this.employees.reload();
    this.session.refreshUsers();
  }
}
