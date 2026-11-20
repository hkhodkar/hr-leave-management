import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Modal } from '../../shared/ui/modal';

/** Rejecting needs a reason, so the employee knows what to change. */
@Component({
  selector: 'app-reject-dialog',
  imports: [ReactiveFormsModule, Modal],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal title="Reject request" [width]="480" (closed)="cancelled.emit()">
      <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
        <div class="modal-body">
          <p class="text-muted intro">{{ summary() }}</p>
          <div class="field">
            <label for="reject-comment">Comment for {{ employeeName() }}</label>
            <textarea
              id="reject-comment"
              class="textarea"
              rows="4"
              maxlength="500"
              [formControl]="comment"
              placeholder="e.g. That's our release week, could you move it?"
            ></textarea>
            @if (comment.invalid && (comment.touched || tried())) {
              <span class="field-error">Please explain why the request is rejected.</span>
            }
          </div>
          @if (error(); as message) {
            <p class="form-error" role="alert">{{ message }}</p>
          }
        </div>
        <footer class="modal-footer">
          <button type="button" class="btn" (click)="cancelled.emit()">Cancel</button>
          <button type="submit" class="btn btn-danger" [disabled]="busy()">
            {{ busy() ? 'Rejecting…' : 'Reject request' }}
          </button>
        </footer>
      </form>
    </app-modal>
  `,
  styles: `
    .intro {
      margin-bottom: 16px;
    }

    .form-error {
      margin-top: 16px;
    }
  `,
})
export class RejectDialog {
  readonly employeeName = input.required<string>();
  readonly summary = input.required<string>();
  readonly busy = input(false);
  readonly error = input<string | null>(null);

  readonly confirmed = output<string>();
  readonly cancelled = output<void>();

  protected readonly tried = signal(false);
  protected readonly comment = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.pattern(/\S/), Validators.maxLength(500)],
  });
  protected readonly form = new FormGroup({ comment: this.comment });

  protected submit(): void {
    this.tried.set(true);
    if (this.comment.invalid) return;
    this.confirmed.emit(this.comment.value.trim());
  }
}
