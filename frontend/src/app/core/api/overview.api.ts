import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, shareReplay } from 'rxjs';
import { CalendarMonth, Dashboard, Department, Holiday, LeaveType } from '../models/hr.models';
import { toHttpParams } from '../utils/http-params';

@Injectable({ providedIn: 'root' })
export class OverviewApi {
  private readonly http = inject(HttpClient);
  private readonly holidayCache = new Map<number, Observable<Holiday[]>>();

  // reference data rarely changes, so every page shares one request
  readonly departments$ = this.http.get<Department[]>('/api/departments').pipe(shareReplay(1));
  readonly leaveTypes$ = this.http.get<LeaveType[]>('/api/leave-types').pipe(shareReplay(1));

  holidays(year: number): Observable<Holiday[]> {
    let cached = this.holidayCache.get(year);
    if (!cached) {
      cached = this.http
        .get<Holiday[]>('/api/holidays', { params: toHttpParams({ year }) })
        .pipe(shareReplay(1));
      this.holidayCache.set(year, cached);
    }
    return cached;
  }

  dashboard(): Observable<Dashboard> {
    return this.http.get<Dashboard>('/api/dashboard');
  }

  calendar(year: number, month: number, departmentId: number | null): Observable<CalendarMonth> {
    return this.http.get<CalendarMonth>('/api/calendar', {
      params: toHttpParams({ year, month, department_id: departmentId }),
    });
  }
}
