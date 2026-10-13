import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { PLACARD_STYLES } from './sign-styles';

/** One leg on the card: a line placard, or a walk with its distance already worded. */
export type ItineraryLegView =
  { kind: 'ride'; code: string; name: string } | { kind: 'walk'; label: string };

/** Everything the card shows, translated by the caller. */
export interface ItinerarySummary {
  title: string;
  legs: readonly ItineraryLegView[];
  duration: string;
  fare: string;
  transfers: string;
  walk: string;
}

/**
 * One planner option. The legs read left to right as a chain of yellow placards (rides) and
 * dashed walk chips; duration leads, transfers, walking and the estimated fare follow. The
 * whole card is one toggle button that selects the option.
 */
@Component({
  selector: 'iv-itinerary-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      class="card"
      [class.on]="selected()"
      [attr.aria-pressed]="selected()"
      (click)="selectedChange.emit()"
    >
      <span class="head">
        <span class="title">{{ summary().title }}</span>
        <span class="duration">{{ summary().duration }}</span>
      </span>
      <span class="chain">
        @for (leg of summary().legs; track $index) {
          @if (!$first) {
            <svg class="sep" viewBox="0 0 12 12" aria-hidden="true"><path d="M4 2l4 4-4 4" /></svg>
          }
          @if (leg.kind === 'ride') {
            <span class="plate iv-placard iv-placard--s">
              {{ leg.code }}<span class="iv-visually-hidden"> {{ leg.name }}</span>
            </span>
          } @else {
            <span class="walk">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="13" cy="4.5" r="2" />
                <path d="M10 21l2-6 3 3v3M9 12l2-4 4 1 2 3M11 8l-2 5" />
              </svg>
              {{ leg.label }}
            </span>
          }
        }
      </span>
      <span class="facts">
        <span class="fact">{{ summary().transfers }}</span>
        <span class="fact">{{ summary().walk }}</span>
        <span class="fact fare">{{ summary().fare }}</span>
      </span>
    </button>
  `,
  styles: [
    PLACARD_STYLES,
    `
      :host {
        display: block;
      }
      .card {
        display: grid;
        gap: 12px;
        width: 100%;
        padding: 14px;
        border: 1.5px solid var(--iv-line);
        border-radius: var(--iv-radius-m);
        background: var(--iv-surface);
        box-shadow: var(--iv-shadow-hard);
        color: var(--iv-ink);
        font: inherit;
        text-align: left;
        cursor: pointer;
      }
      .card.on {
        --iv-ink: var(--iv-board-ink);
        --iv-ink-muted: var(--iv-board-muted);
        --iv-line-strong: rgba(255, 248, 231, 0.34);
        border-color: var(--iv-board-edge);
        background: var(--iv-board);
        box-shadow:
          inset 0 -4px 0 var(--iv-stripe),
          var(--iv-shadow-board);
      }
      .card.on .duration {
        color: var(--iv-board-sign);
        text-shadow: var(--iv-board-glow);
      }
      .card:focus-visible {
        outline: none;
        box-shadow: var(--iv-focus);
      }
      .head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 12px;
      }
      .title {
        font-size: 13px;
        font-weight: var(--iv-font-body-weight-600);
        color: var(--iv-ink-muted);
      }
      .duration {
        font-family: var(--iv-font-display);
        font-weight: var(--iv-font-display-weight);
        font-size: 26px;
        line-height: 1;
        letter-spacing: -0.01em;
        font-variant-numeric: tabular-nums;
      }
      .chain {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
        min-width: 0;
      }
      .sep {
        width: 12px;
        height: 12px;
        fill: none;
        stroke: var(--iv-ink-muted);
        stroke-width: 1.8;
        stroke-linecap: round;
        stroke-linejoin: round;
      }
      .plate {
        white-space: nowrap;
      }
      .walk {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        padding: 3px 7px;
        border: 1.5px dashed var(--iv-line-strong);
        border-radius: 999px;
        font-size: 13px;
        color: var(--iv-ink-muted);
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
      }
      .walk svg {
        width: 16px;
        height: 16px;
        fill: none;
        stroke: currentColor;
        stroke-width: 1.8;
        stroke-linecap: round;
        stroke-linejoin: round;
      }
      .walk circle {
        fill: currentColor;
        stroke: none;
      }
      .facts {
        display: flex;
        flex-wrap: wrap;
        font-size: 13px;
        color: var(--iv-ink-muted);
      }
      .fact {
        white-space: nowrap;
      }
      .fact:not(:last-child)::after {
        content: '·';
        margin: 0 6px;
      }
      .fare {
        color: var(--iv-ink);
        font-weight: var(--iv-font-body-weight-600);
      }
    `,
  ],
})
export class ItineraryCardComponent {
  readonly summary = input.required<ItinerarySummary>();
  readonly selected = input(false);
  readonly selectedChange = output<void>();
}
