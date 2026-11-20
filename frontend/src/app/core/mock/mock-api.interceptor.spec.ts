import {
  HttpClient,
  HttpErrorResponse,
  provideHttpClient,
  withInterceptors,
} from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { beforeEach, describe, expect, it } from 'vitest';
import { actingUserInterceptor, ActingUser } from '../session/acting-user';
import { DemoMode, MOCK_LATENCY, MOCK_STORAGE } from './demo-mode';
import { backendUnavailable, mockApiInterceptor } from './mock-api.interceptor';

describe('mockApiInterceptor', () => {
  let http: HttpClient;
  let backend: HttpTestingController;
  let demo: DemoMode;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([actingUserInterceptor, mockApiInterceptor])),
        provideHttpClientTesting(),
        { provide: MOCK_LATENCY, useValue: [0, 0] },
        { provide: MOCK_STORAGE, useValue: null },
      ],
    });
    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
    demo = TestBed.inject(DemoMode);
  });

  it('switches to demo mode when the API is not reachable', async () => {
    const result = firstValueFrom(http.get<{ status: string }>('/api/health'));
    backend.expectOne('/api/health').error(new ProgressEvent('error'), { status: 0 });
    expect(await result).toEqual({ status: 'ok' });
    expect(demo.active()).toBe(true);
  });

  it('keeps real API errors', async () => {
    const result = firstValueFrom(http.get('/api/employees/999'));
    backend.expectOne('/api/employees/999').flush(
      { detail: 'Employee 999 was not found' },
      {
        status: 404,
        statusText: 'Not Found',
        headers: { 'content-type': 'application/json' },
      },
    );
    await expect(result).rejects.toBeInstanceOf(HttpErrorResponse);
    expect(demo.active()).toBe(false);
  });

  it('answers as the acting user once in demo mode', async () => {
    demo.enable();
    TestBed.inject(ActingUser).set(6);
    const page = await firstValueFrom(
      http.get<{ items: { employee: { id: number } }[] }>('/api/leave-requests'),
    );
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.every((r) => r.employee.id === 6)).toBe(true);

    const error = await firstValueFrom(http.get('/api/employees/2/balances')).catch(
      (e: unknown) => e,
    );
    expect((error as HttpErrorResponse).status).toBe(403);
    backend.verify();
  });

  it('reports validation errors with the FastAPI body', async () => {
    demo.enable();
    const error = (await firstValueFrom(
      http.post('/api/employees', { name: '', email: 'nope' }, { headers: { 'X-User-Id': '1' } }),
    ).catch((e: unknown) => e)) as HttpErrorResponse;
    expect(error.status).toBe(422);
    const fields = (error.error.detail as { loc: string[] }[]).map((issue) => issue.loc[1]);
    expect(fields).toEqual(['name', 'email', 'job_title', 'department_id', 'start_date']);
  });

  it('only treats a missing backend as unavailable', () => {
    const json = { 'content-type': 'application/json' };
    expect(backendUnavailable(new HttpErrorResponse({ status: 0 }))).toBe(true);
    expect(backendUnavailable(new HttpErrorResponse({ status: 502 }))).toBe(true);
    expect(backendUnavailable(new HttpErrorResponse({ status: 404, headers: undefined }))).toBe(
      true,
    );
    expect(
      backendUnavailable(
        new HttpErrorResponse({
          status: 404,
          headers: new (class {
            get = (name: string) => (json as Record<string, string>)[name] ?? null;
          })() as never,
        }),
      ),
    ).toBe(false);
  });
});
