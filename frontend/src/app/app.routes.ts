import { Routes } from '@angular/router';
import { approverGuard } from './core/session/role.guard';

export const routes: Routes = [
  {
    path: '',
    title: 'Dashboard · Leave Manager',
    loadComponent: () => import('./features/dashboard/dashboard-page').then((m) => m.DashboardPage),
  },
  {
    path: 'my-leave',
    title: 'My leave · Leave Manager',
    loadComponent: () => import('./features/leave/my-leave-page').then((m) => m.MyLeavePage),
  },
  {
    path: 'approvals',
    title: 'Approvals · Leave Manager',
    canActivate: [approverGuard],
    loadComponent: () => import('./features/approvals/approvals-page').then((m) => m.ApprovalsPage),
  },
  {
    path: 'calendar',
    title: 'Team calendar · Leave Manager',
    loadComponent: () => import('./features/calendar/calendar-page').then((m) => m.CalendarPage),
  },
  {
    path: 'employees',
    title: 'Employees · Leave Manager',
    loadComponent: () => import('./features/employees/employees-page').then((m) => m.EmployeesPage),
  },
  {
    path: 'employees/:id',
    title: 'Employee · Leave Manager',
    loadComponent: () =>
      import('./features/employees/employee-detail-page').then((m) => m.EmployeeDetailPage),
  },
  { path: '**', redirectTo: '' },
];
