import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import {
  LeaveRequest,
  LeaveRequestDetail,
  LeaveRequestInput,
  Page,
  RequestQuery,
} from '../models/hr.models';
import { toHttpParams } from '../utils/http-params';

@Injectable({ providedIn: 'root' })
export class LeaveApi {
  private readonly http = inject(HttpClient);

  list(query: RequestQuery = {}): Observable<Page<LeaveRequest>> {
    return this.http.get<Page<LeaveRequest>>('/api/leave-requests', {
      params: toHttpParams({ ...query }),
    });
  }

  get(id: number): Observable<LeaveRequestDetail> {
    return this.http.get<LeaveRequestDetail>(`/api/leave-requests/${id}`);
  }

  create(input: LeaveRequestInput): Observable<LeaveRequestDetail> {
    return this.http.post<LeaveRequestDetail>('/api/leave-requests', input);
  }

  approve(id: number, comment: string | null = null): Observable<LeaveRequestDetail> {
    return this.http.post<LeaveRequestDetail>(`/api/leave-requests/${id}/approve`, { comment });
  }

  reject(id: number, comment: string): Observable<LeaveRequestDetail> {
    return this.http.post<LeaveRequestDetail>(`/api/leave-requests/${id}/reject`, { comment });
  }

  cancel(id: number, comment: string | null = null): Observable<LeaveRequestDetail> {
    return this.http.post<LeaveRequestDetail>(`/api/leave-requests/${id}/cancel`, { comment });
  }
}
