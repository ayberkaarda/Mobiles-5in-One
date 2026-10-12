import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * A thin road-striped progress bar. With a `value` between 0 and 1 it fills to that point;
 * with `value` null it shows an indeterminate moving stripe (size not known yet).
 */
@Component({
  selector: 'iv-progress-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'progressbar',
    'aria-valuemin': '0',
    'aria-valuemax': '100',
    '[attr.aria-valuenow]': 'percent()',
    '[attr.aria-label]': 'label()',
    '[class.iv-progress--indeterminate]': 'percent() === null',
  },
  template: `<span class="fill" [style.width.%]="percent() ?? 35"></span>`,
  styles: `
    :host {
      display: block;
      position: relative;
      height: 8px;
      overflow: hidden;
      border-radius: 999px;
      background: var(--iv-surface-sunk);
      box-shadow: inset 0 0 0 1px var(--iv-line);
    }
    .fill {
      position: absolute;
      inset: 0 auto 0 0;
      border-radius: inherit;
      background: repeating-linear-gradient(
        -45deg,
        var(--iv-color-turkuaz) 0 10px,
        color-mix(in srgb, var(--iv-color-turkuaz) 75%, var(--iv-color-lacivert)) 10px 20px
      );
      transition: width 160ms ease-out;
    }
    :host(.iv-progress--indeterminate) .fill {
      animation: iv-progress-slide 1.2s ease-in-out infinite;
    }
    @keyframes iv-progress-slide {
      from {
        transform: translateX(-100%);
      }
      to {
        transform: translateX(300%);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .fill {
        transition: none;
      }
      :host(.iv-progress--indeterminate) .fill {
        animation: none;
        width: 100% !important;
        opacity: 0.45;
      }
    }
  `,
})
export class ProgressBarComponent {
  /** Fraction done, 0 to 1, or `null` when unknown. */
  readonly value = input<number | null>(null);
  /** Accessible name, translated by the caller. */
  readonly label = input.required<string>();

  protected readonly percent = computed(() => {
    const value = this.value();
    if (value === null || !Number.isFinite(value)) return null;
    return Math.round(Math.min(1, Math.max(0, value)) * 100);
  });
}
