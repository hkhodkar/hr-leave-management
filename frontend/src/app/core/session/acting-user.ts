import { HttpInterceptorFn } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';

export const USER_HEADER = 'X-User-Id';
const STORAGE_KEY = 'leave-management.acting-user';

/** Daniel Kim, the engineering manager, has the most to show on first visit. */
export const DEFAULT_USER_ID = 2;

/**
 * Who the app is being used as. There is no login in this project: the
 * "View as" picker sets this and every API call carries it in a header.
 */
@Injectable({ providedIn: 'root' })
export class ActingUser {
  readonly id = signal(readStored() ?? DEFAULT_USER_ID);

  set(id: number): void {
    this.id.set(id);
    try {
      localStorage.setItem(STORAGE_KEY, String(id));
    } catch {
      // storage blocked, the choice then lasts until a reload
    }
  }
}

function readStored(): number | null {
  try {
    const value = Number(localStorage.getItem(STORAGE_KEY));
    return Number.isInteger(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

export const actingUserInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith('/api/') || req.headers.has(USER_HEADER)) {
    return next(req);
  }
  const id = inject(ActingUser).id();
  return next(req.clone({ setHeaders: { [USER_HEADER]: String(id) } }));
};
