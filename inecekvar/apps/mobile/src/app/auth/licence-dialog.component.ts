import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  viewChild,
} from '@angular/core';
import { TPipe } from '../i18n/i18n';
import { LicenceGate } from './licence-gate';

/** The licence acceptance dialog, shown by `LicenceGate.ensure()`; hosted once in the tab shell. */
@Component({
  selector: 'iv-licence-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TPipe],
  host: { '(document:keydown.escape)': 'gate.open() && gate.decline()' },
  template: `
    @if (gate.open()) {
      <div class="backdrop" (click)="gate.decline()" aria-hidden="true"></div>
      <section
        #panel
        class="panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="iv-licence-title"
        tabindex="-1"
      >
        <p class="kicker">{{ 'licence.kicker' | t }}</p>
        <h2 id="iv-licence-title">{{ 'licence.title' | t }}</h2>
        <ul>
          <li>{{ 'licence.pointLicence' | t }}</li>
          <li>{{ 'licence.pointAttribution' | t }}</li>
          <li>{{ 'licence.pointDeletion' | t }}</li>
          <li>{{ 'licence.pointTraces' | t }}</li>
        </ul>
        <p class="pending">{{ 'licence.pending' | t }}</p>
        @if (gate.error(); as error) {
          <p class="error" role="alert">{{ error | t }}</p>
        }
        <div class="actions">
          <button type="button" class="iv-button" [disabled]="gate.busy()" (click)="gate.accept()">
            {{ (gate.busy() ? 'licence.busy' : 'licence.accept') | t }}
          </button>
          <button type="button" class="later" [disabled]="gate.busy()" (click)="gate.decline()">
            {{ 'licence.decline' | t }}
          </button>
        </div>
      </section>
    }
  `,
  styles: `
    .backdrop {
      position: fixed;
      inset: 0;
      z-index: 1000;
      background: rgba(31, 33, 36, 0.6);
    }
    .panel {
      position: fixed;
      z-index: 1001;
      left: 16px;
      right: 16px;
      bottom: max(16px, env(safe-area-inset-bottom));
      max-height: calc(100% - 48px);
      overflow: auto;
      padding: 20px 18px 18px;
      border-radius: var(--iv-radius-l);
      border-top: 8px solid var(--iv-stripe);
      background: var(--iv-surface);
      color: var(--iv-ink);
    }
    .panel:focus {
      outline: none;
    }
    .kicker {
      margin: 0;
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--iv-ink-muted);
    }
    h2 {
      margin: 4px 0 10px;
      font-size: 22px;
      line-height: 1.15;
    }
    ul {
      margin: 0;
      padding-left: 20px;
      display: grid;
      gap: 6px;
      font-size: 14px;
      line-height: 1.45;
    }
    .pending,
    .error {
      margin: 10px 0 0;
      font-size: 13px;
      line-height: 1.4;
      color: var(--iv-ink-muted);
    }
    .error {
      color: var(--iv-danger);
      font-weight: 600;
    }
    .actions {
      display: grid;
      gap: 8px;
      margin-top: 16px;
    }
    .later {
      min-height: 44px;
      border: 0;
      background: transparent;
      color: var(--iv-ink);
      font: inherit;
      font-weight: 600;
      text-decoration: underline;
      cursor: pointer;
    }
  `,
})
export class LicenceDialogComponent {
  protected readonly gate = inject(LicenceGate);
  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');

  constructor() {
    afterRenderEffect(() => {
      this.panel()?.nativeElement.focus();
    });
  }
}
