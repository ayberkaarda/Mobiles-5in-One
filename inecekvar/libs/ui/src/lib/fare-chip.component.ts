import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { formatFareMinor } from '@inecekvar/domain';

export type FareChipState = 'paid' | 'free' | 'unknown';

/**
 * Fare price tag. A positive kuruş amount renders as lira with tabular digits, zero renders the
 * free label and a missing fare renders the unknown label. All copy comes from the caller.
 */
@Component({
  selector: 'iv-fare-chip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'iv-chip iv-fare',
    '[class.iv-fare--free]': "state() === 'free'",
    '[class.iv-fare--unknown]': "state() === 'unknown'",
    '[attr.data-state]': 'state()',
  },
  template: `@if (srLabel()) {
      <span class="iv-visually-hidden">{{ srLabel() }}: </span>
    }
    {{ text() }}`,
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      height: 26px;
      padding: 0 10px;
      border-radius: var(--iv-radius-s);
      background: var(--iv-tag);
      color: var(--iv-tag-ink);
      font-size: 13px;
      font-weight: var(--iv-font-body-weight-600);
      font-variant-numeric: var(--iv-font-fare-numeric);
      line-height: 1;
      white-space: nowrap;
    }
    :host(.iv-fare--free) {
      background: transparent;
      color: var(--iv-success);
      box-shadow: inset 0 0 0 1.5px currentColor;
    }
    :host(.iv-fare--unknown) {
      background: transparent;
      color: var(--iv-ink-muted);
      box-shadow: inset 0 0 0 1px var(--iv-line-strong);
      font-weight: var(--iv-font-body-weight-500);
    }
  `,
})
export class FareChipComponent {
  /** Fare in kuruş; `null` when nobody has reported it yet. */
  readonly fareMinor = input<number | null>(null);
  readonly freeLabel = input.required<string>();
  readonly unknownLabel = input.required<string>();
  /** Optional screen-reader prefix such as "Ücret". */
  readonly srLabel = input<string>('');

  readonly state = computed<FareChipState>(() => {
    const fare = this.fareMinor();
    if (fare === null) return 'unknown';
    return fare === 0 ? 'free' : 'paid';
  });

  readonly text = computed(() => {
    switch (this.state()) {
      case 'unknown':
        return this.unknownLabel();
      case 'free':
        return this.freeLabel();
      default:
        return formatFareMinor(this.fareMinor() ?? 0);
    }
  });
}
