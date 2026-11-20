import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { DemoMode } from './core/mock/demo-mode';
import { ROLE_LABELS, Role } from './core/models/hr.models';
import { SessionService } from './core/session/session.service';
import { Avatar } from './shared/ui/avatar';
import { DemoBanner } from './shared/ui/demo-banner';
import { Icon, IconName } from './shared/ui/icon';
import { ToastContainer } from './shared/ui/toast-container';

interface NavItem {
  path: string;
  label: string;
  icon: IconName;
  exact?: boolean;
  badge?: () => number;
  visible?: () => boolean;
}

const ROLE_ORDER: Role[] = ['hr', 'manager', 'employee'];
const GROUP_LABELS: Record<Role, string> = {
  hr: 'HR admins',
  manager: 'Managers',
  employee: 'Employees',
};

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon, Avatar, ToastContainer, DemoBanner],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  protected readonly session = inject(SessionService);
  protected readonly demo = inject(DemoMode);
  private readonly router = inject(Router);

  protected readonly menuOpen = signal(false);
  protected readonly roleLabels = ROLE_LABELS;

  protected readonly navItems: NavItem[] = [
    { path: '/', label: 'Dashboard', icon: 'dashboard', exact: true },
    { path: '/my-leave', label: 'My leave', icon: 'plane', badge: () => this.session.myPending() },
    {
      path: '/approvals',
      label: 'Approvals',
      icon: 'inbox',
      badge: () => this.session.pendingApprovals(),
      visible: () => this.session.canApprove(),
    },
    { path: '/calendar', label: 'Team calendar', icon: 'calendar' },
    { path: '/employees', label: 'Employees', icon: 'users' },
  ];

  /** People for the "View as" picker, grouped by role. */
  protected readonly userGroups = computed(() => {
    const users = this.session.users.value() ?? [];
    return ROLE_ORDER.map((role) => ({
      label: GROUP_LABELS[role],
      users: users.filter((u) => u.role === role),
    })).filter((group) => group.users.length > 0);
  });

  constructor() {
    // close the mobile menu after navigating
    this.router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe(() => this.menuOpen.set(false));

    effect(() => {
      if (this.session.users.hasValue()) {
        this.session.ensureKnownUser();
      }
    });

    // leave the approvals page when switching to someone who can't approve
    effect(() => {
      const role = this.session.role();
      if (role && !this.session.canApprove() && this.router.url.startsWith('/approvals')) {
        void this.router.navigateByUrl('/');
      }
    });
  }

  protected toggleMenu(): void {
    this.menuOpen.update((open) => !open);
  }

  protected switchUser(event: Event): void {
    const id = Number((event.target as HTMLSelectElement).value);
    this.session.switchTo(id);
  }
}
