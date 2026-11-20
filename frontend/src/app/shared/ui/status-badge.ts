import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { LeaveStatus, STATUS_LABELS } from '../../core/models/hr.models';

@Component({
  selector: 'app-status-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'badge', '[class]': "'status-' + status()" },
  template: `<span class="dot"></span>{{ label() }}`,
  styles: `
    :host(.status-pending) {
      background: var(--warning-soft);
      color: var(--warning);
    }

    :host(.status-approved) {
      background: var(--success-soft);
      color: var(--success);
    }

    :host(.status-rejected) {
      background: var(--danger-soft);
      color: var(--danger);
    }

    :host(.status-cancelled) {
      background: var(--surface-muted);
      color: var(--text-muted);
    }
  `,
})
export class StatusBadge {
  readonly status = input.required<LeaveStatus>();
  protected readonly label = computed(() => STATUS_LABELS[this.status()]);
}
