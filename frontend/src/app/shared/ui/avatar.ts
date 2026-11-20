import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { avatarColor, initials } from '../../core/utils/format';

@Component({
  selector: 'app-avatar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[style.--avatar-size.px]': 'size()',
    '[style.background]': 'color()',
    '[class.square]': 'square()',
    '[attr.title]': 'name()',
  },
  template: `{{ letters() }}`,
  styles: `
    :host {
      display: inline-grid;
      flex-shrink: 0;
      place-items: center;
      width: var(--avatar-size);
      height: var(--avatar-size);
      border-radius: 50%;
      color: #fff;
      font-size: calc(var(--avatar-size) * 0.38);
      font-weight: 600;
      letter-spacing: 0.02em;
      user-select: none;
    }

    :host(.square) {
      border-radius: 25%;
    }
  `,
})
export class Avatar {
  readonly name = input.required<string>();
  readonly size = input(34);
  readonly square = input(false);

  protected readonly letters = computed(() => initials(this.name()));
  protected readonly color = computed(() => avatarColor(this.name()));
}
