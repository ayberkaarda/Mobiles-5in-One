import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  viewChild,
} from '@angular/core';
import { StepUpService } from '../step-up/step-up.service';
import { ConfirmService } from './confirm.service';

/** The step-up code dialog and the confirmation dialog, mounted once by the admin shell. */
@Component({
  selector: 'iv-admin-dialogs',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'escape()' },
  template: `
    @if (stepUp.open()) {
      <div class="iv-admin-backdrop">
        <form
          class="iv-admin-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="iv-stepup-title"
          data-dialog="step-up"
          novalidate
          (submit)="$event.preventDefault(); stepUp.submit(code.value.trim())"
        >
          <h2 id="iv-stepup-title">Doğrulama kodu</h2>
          <p>
            Bu işlem ek doğrulama istiyor. Doğrulama uygulamandaki 6 haneli kodu gir; doğrulama 15
            dakika geçerli olur ve işlem bir kez yeniden denenir.
          </p>
          <label for="iv-stepup-code">Kod</label>
          <input
            #code
            id="iv-stepup-code"
            name="code"
            inputmode="numeric"
            autocomplete="one-time-code"
            pattern="[0-9]{6}"
            maxlength="6"
            minlength="6"
            required
            [disabled]="stepUp.submitting()"
          />
          @if (stepUp.error(); as message) {
            <p class="iv-admin-error" role="alert">{{ message }}</p>
          }
          <div class="iv-admin-actions">
            <button
              type="button"
              class="secondary"
              [disabled]="stepUp.submitting()"
              (click)="stepUp.cancel()"
            >
              Vazgeç
            </button>
            <button type="submit" [disabled]="stepUp.submitting()">
              {{ stepUp.submitting() ? 'Doğrulanıyor…' : 'Doğrula' }}
            </button>
          </div>
        </form>
      </div>
    }
    @if (confirm.request(); as request) {
      <div class="iv-admin-backdrop">
        <div
          class="iv-admin-dialog"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="iv-confirm-title"
          aria-describedby="iv-confirm-body"
          data-dialog="confirm"
        >
          <h2 id="iv-confirm-title">{{ request.title }}</h2>
          <p id="iv-confirm-body">{{ request.body }}</p>
          <div class="iv-admin-actions">
            <button #cancel type="button" class="secondary" (click)="confirm.answer(false)">
              Vazgeç
            </button>
            <button type="button" class="danger" (click)="confirm.answer(true)">
              {{ request.confirmLabel }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
})
export class AdminDialogsComponent {
  protected readonly stepUp = inject(StepUpService);
  protected readonly confirm = inject(ConfirmService);
  private readonly codeInput = viewChild<ElementRef<HTMLInputElement>>('code');
  private readonly cancelButton = viewChild<ElementRef<HTMLButtonElement>>('cancel');

  protected escape(): void {
    if (this.confirm.request() !== null) this.confirm.answer(false);
    else if (this.stepUp.open()) this.stepUp.cancel();
  }

  constructor() {
    // Focus moves into a dialog when it opens; the safe choice (Vazgeç) gets it on confirmations.
    afterRenderEffect(() => {
      const input = this.codeInput()?.nativeElement;
      if (input && document.activeElement !== input && input.value === '') input.focus();
    });
    afterRenderEffect(() => {
      this.cancelButton()?.nativeElement.focus();
    });
  }
}
