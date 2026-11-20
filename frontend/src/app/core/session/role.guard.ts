import { inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { CanActivateFn, Router } from '@angular/router';
import { filter, map, take } from 'rxjs';
import { SessionService } from './session.service';

/** Pages for people who approve leave: managers and HR. */
export const approverGuard: CanActivateFn = () => {
  const session = inject(SessionService);
  const router = inject(Router);
  return toObservable(session.role).pipe(
    filter((role) => role !== null),
    take(1),
    map(() => session.canApprove() || router.createUrlTree(['/'])),
  );
};
