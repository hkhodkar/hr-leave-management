import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { Balance, Employee, EmployeeInput, EmployeeQuery, Page } from '../models/hr.models';
import { toHttpParams } from '../utils/http-params';

@Injectable({ providedIn: 'root' })
export class EmployeesApi {
  private readonly http = inject(HttpClient);

  list(query: EmployeeQuery = {}): Observable<Page<Employee>> {
    return this.http.get<Page<Employee>>('/api/employees', { params: toHttpParams({ ...query }) });
  }

  get(id: number): Observable<Employee> {
    return this.http.get<Employee>(`/api/employees/${id}`);
  }

  create(input: EmployeeInput): Observable<Employee> {
    return this.http.post<Employee>('/api/employees', input);
  }

  update(id: number, input: EmployeeInput): Observable<Employee> {
    return this.http.put<Employee>(`/api/employees/${id}`, input);
  }

  balances(id: number, year?: number): Observable<Balance[]> {
    return this.http.get<Balance[]>(`/api/employees/${id}/balances`, {
      params: toHttpParams({ year }),
    });
  }
}
