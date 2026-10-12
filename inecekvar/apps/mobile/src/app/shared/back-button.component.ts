import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { NavController } from '@ionic/angular';
import { TPipe } from '../i18n/i18n';

/**
 * Toolbar back control for detail pages. It goes back in history when there is one and to the
 * fallback route otherwise (a deep link opened from outside). A plain button keeps
 * `ion-back-button` out of the initial bundle.
 */
@Component({
  selector: 'iv-back-button',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TPipe],
  template: `
    <button type="button" (click)="back()">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
      <span>{{ 'line.back' | t }}</span>
    </button>
  `,
  styles: `
    button {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      min-height: 48px;
      padding: 0 12px 0 6px;
      border: 0;
      border-radius: var(--iv-radius-m);
      background: none;
      color: var(--iv-chrome-ink);
      font: inherit;
      font-weight: var(--iv-font-body-weight-600);
      cursor: pointer;
    }
    button:focus-visible {
      outline: none;
      box-shadow: var(--iv-focus);
    }
    svg {
      width: 24px;
      height: 24px;
      fill: none;
      stroke: currentColor;
      stroke-width: 2.4;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
  `,
})
export class BackButtonComponent {
  private readonly nav = inject(NavController);
  private readonly history = inject(DOCUMENT).defaultView?.history;

  readonly fallback = input('/ara');

  protected back(): void {
    if ((this.history?.length ?? 0) > 1) this.nav.back();
    else void this.nav.navigateBack(this.fallback());
  }
}
