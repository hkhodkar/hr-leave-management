import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { LeaveTypeRef } from '../../core/models/hr.models';

/** Colored dot and name of a leave type, or a neutral "Away" when it is private. */
@Component({
  selector: 'app-leave-type-tag',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="swatch" [style.background]="type()?.color ?? 'var(--text-subtle)'"></span>
    <span class="name">{{ type()?.name ?? 'Away' }}</span>
  `,
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
      font-weight: 500;
    }

    .swatch {
      flex-shrink: 0;
      width: 10px;
      height: 10px;
      border-radius: 3px;
    }

    .name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  `,
})
export class LeaveTypeTag {
  readonly type = input.required<LeaveTypeRef | null>();
}
