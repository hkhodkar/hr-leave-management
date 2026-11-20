import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { Balance } from '../../core/models/hr.models';

@Component({
  selector: 'app-balance-cards',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (b of balances(); track b.leave_type.id) {
      <article class="card balance" [style.--type-color]="b.leave_type.color">
        <header>
          <span class="swatch"></span>
          <h3>{{ b.leave_type.name }}</h3>
        </header>
        @if (b.remaining !== null && b.entitled !== null) {
          <p class="remaining">
            <strong>{{ b.remaining }}</strong>
            <span>of {{ b.entitled }} days left</span>
          </p>
          <div class="meter" role="img" [attr.aria-label]="meterLabel(b)">
            <span class="used" [style.width.%]="share(b.used, b.entitled)"></span>
            <span class="pending" [style.width.%]="share(b.pending, b.entitled)"></span>
          </div>
        } @else {
          <p class="remaining">
            <strong>{{ b.used + b.pending }}</strong>
            <span>days taken, no yearly limit</span>
          </p>
          <div class="meter"></div>
        }
        <dl>
          <div>
            <dt>Used</dt>
            <dd>{{ b.used }}</dd>
          </div>
          <div>
            <dt>Pending</dt>
            <dd>{{ b.pending }}</dd>
          </div>
          <div>
            <dt>Entitled</dt>
            <dd>{{ b.entitled ?? '–' }}</dd>
          </div>
        </dl>
      </article>
    }
  `,
  styles: `
    :host {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 16px;
    }

    .balance {
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 18px;
      border-top: 3px solid var(--type-color);
    }

    header {
      display: flex;
      align-items: center;
      gap: 8px;

      h3 {
        font-size: 14px;
      }
    }

    .swatch {
      width: 10px;
      height: 10px;
      border-radius: 3px;
      background: var(--type-color);
    }

    .remaining {
      display: flex;
      align-items: baseline;
      gap: 8px;
      color: var(--text-muted);
      font-size: 13px;

      strong {
        color: var(--text);
        font-size: 28px;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
        line-height: 1;
      }
    }

    .meter {
      display: flex;
      height: 8px;
      overflow: hidden;
      border-radius: 999px;
      background: var(--surface-muted);

      .used {
        background: var(--type-color);
      }

      .pending {
        background: repeating-linear-gradient(
          -45deg,
          var(--type-color) 0 3px,
          color-mix(in srgb, var(--type-color) 35%, transparent) 3px 6px
        );
        opacity: 0.6;
      }
    }

    dl {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      margin: 0;
      font-size: 12px;

      dt {
        color: var(--text-muted);
      }

      dd {
        margin: 0;
        font-weight: 600;
        font-size: 14px;
        font-variant-numeric: tabular-nums;
      }
    }

    @media (max-width: 1200px) {
      :host {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    @media (max-width: 520px) {
      :host {
        grid-template-columns: minmax(0, 1fr);
        gap: 12px;
      }
    }
  `,
})
export class BalanceCards {
  readonly balances = input.required<Balance[]>();

  protected share(days: number, entitled: number): number {
    return entitled > 0 ? Math.min(100, (days / entitled) * 100) : 0;
  }

  protected meterLabel(b: Balance): string {
    return `${b.used} used and ${b.pending} pending of ${b.entitled} days`;
  }
}
