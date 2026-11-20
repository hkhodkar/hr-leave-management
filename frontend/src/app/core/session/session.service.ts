import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { Me, Role, SessionUser } from '../models/hr.models';
import { ActingUser, DEFAULT_USER_ID } from './acting-user';

@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly http = inject(HttpClient);
  private readonly acting = inject(ActingUser);

  readonly userId = this.acting.id.asReadonly();

  /** Everyone the app can be viewed as. */
  readonly users = rxResource({
    stream: () => this.http.get<SessionUser[]>('/api/session/users'),
  });

  /** The acting user's profile and badge counts, reloaded after every switch. */
  readonly me = rxResource({
    params: () => ({ id: this.acting.id() }),
    stream: () => this.http.get<Me>('/api/me'),
  });

  readonly current = computed<SessionUser | null>(
    () => this.users.value()?.find((u) => u.id === this.acting.id()) ?? null,
  );
  readonly role = computed<Role | null>(() => this.current()?.role ?? null);
  readonly isHr = computed(() => this.role() === 'hr');
  /** Managers decide for their team, HR for everyone. */
  readonly canApprove = computed(
    () =>
      this.role() === 'hr' ||
      this.role() === 'manager' ||
      (this.me.value()?.user.report_count ?? 0) > 0,
  );
  readonly pendingApprovals = computed(() => this.me.value()?.pending_approvals ?? 0);
  readonly myPending = computed(() => this.me.value()?.my_pending ?? 0);

  switchTo(id: number): void {
    this.acting.set(id);
  }

  /** Refresh badge counts after something changed. */
  refresh(): void {
    this.me.reload();
  }

  /** Reload the people list after HR added or renamed someone. */
  refreshUsers(): void {
    this.users.reload();
  }

  /** An id saved from an older data set may no longer exist. */
  ensureKnownUser(): void {
    const users = this.users.value();
    if (users && !users.some((u) => u.id === this.acting.id())) {
      this.acting.set(users.some((u) => u.id === DEFAULT_USER_ID) ? DEFAULT_USER_ID : users[0].id);
    }
  }
}
