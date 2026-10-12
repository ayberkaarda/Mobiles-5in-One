import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { LineMode } from '@inecekvar/domain';
import { FareChipComponent } from './fare-chip.component';
import { ModeChipComponent } from './mode-chip.component';

/** Labels the card needs; the caller passes translated strings. */
export interface LineCardLabels {
  mode: string;
  fare: string;
  fareFree: string;
  fareUnknown: string;
  favoriteAdd: string;
  favoriteRemove: string;
}

/**
 * One line in a list. The code sits on a yellow dolmuş window placard with the turquoise
 * minibüs stripe; name, mode, fare and a meta line follow. The star toggles a favourite.
 */
@Component({
  selector: 'iv-line-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FareChipComponent, ModeChipComponent],
  template: `
    <article class="card">
      <button type="button" class="main" (click)="opened.emit()">
        <span class="plate" aria-hidden="true">{{ code() }}</span>
        <span class="body">
          <span class="name">
            <span class="iv-visually-hidden">{{ code() }} </span>{{ name() }}
          </span>
          <span class="chips">
            <iv-mode-chip [mode]="mode()" [label]="labels().mode" />
            @if (fareMinor() !== undefined) {
              <iv-fare-chip
                [fareMinor]="fareMinor() ?? null"
                [srLabel]="labels().fare"
                [freeLabel]="labels().fareFree"
                [unknownLabel]="labels().fareUnknown"
              />
            }
          </span>
          @if (meta().length > 0) {
            <span class="meta">
              @for (part of meta(); track $index) {
                <span class="meta-part">{{ part }}</span>
              }
            </span>
          }
        </span>
      </button>
      @if (favorite() !== null) {
        <button
          type="button"
          class="star"
          [class.on]="favorite()"
          [attr.aria-pressed]="favorite()"
          [attr.aria-label]="favorite() ? labels().favoriteRemove : labels().favoriteAdd"
          (click)="favoriteToggle.emit()"
        >
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path d="M12 3.2l2.6 5.5 6 .8-4.4 4.1 1.1 5.9L12 16.6l-5.3 2.9 1.1-5.9-4.4-4.1 6-.8z" />
          </svg>
        </button>
      }
    </article>
  `,
  styles: `
    :host {
      display: block;
    }
    .card {
      position: relative;
      display: flex;
      align-items: stretch;
      background: var(--iv-surface);
      border: 1px solid var(--iv-line);
      border-radius: var(--iv-radius-m);
      box-shadow: var(--iv-shadow-hard);
    }
    .main {
      flex: 1;
      display: flex;
      gap: 14px;
      align-items: flex-start;
      min-width: 0;
      padding: 14px 4px 14px 14px;
      border: 0;
      background: none;
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
      border-radius: var(--iv-radius-m);
    }
    .main:focus-visible,
    .star:focus-visible {
      outline: none;
      box-shadow: var(--iv-focus);
    }
    .plate {
      flex: none;
      min-width: 76px;
      padding: 9px 8px 7px;
      border-radius: var(--iv-radius-s);
      background: var(--iv-plate);
      color: var(--iv-plate-ink);
      border-bottom: 4px solid var(--iv-stripe);
      font-family: var(--iv-font-display);
      font-weight: var(--iv-font-display-weight);
      font-size: 17px;
      letter-spacing: 0.04em;
      text-align: center;
      line-height: 1;
    }
    .body {
      display: grid;
      gap: 8px;
      min-width: 0;
    }
    .name {
      font-weight: var(--iv-font-body-weight-600);
      font-size: 16px;
      line-height: 1.3;
      color: var(--iv-ink);
      overflow-wrap: anywhere;
    }
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .meta-part {
      white-space: nowrap;
    }
    .meta-part:not(:last-child)::after {
      content: '·';
      margin: 0 5px;
    }
    .meta {
      display: flex;
      flex-wrap: wrap;
      font-size: 13px;
      color: var(--iv-ink-muted);
      font-variant-numeric: tabular-nums;
    }
    .star {
      flex: none;
      width: 48px;
      border: 0;
      background: none;
      color: var(--iv-ink-muted);
      cursor: pointer;
      border-radius: var(--iv-radius-m);
    }
    .star path {
      fill: none;
      stroke: currentColor;
      stroke-width: 1.8;
      stroke-linejoin: round;
    }
    .star.on {
      color: var(--iv-accent);
    }
    .star.on path {
      fill: currentColor;
    }
  `,
})
export class LineCardComponent {
  readonly code = input.required<string>();
  readonly name = input.required<string>();
  readonly mode = input.required<LineMode>();
  readonly labels = input.required<LineCardLabels>();
  /** Fare in kuruş, `null` when unknown, `undefined` to leave the fare chip out. */
  readonly fareMinor = input<number | null | undefined>(null);
  /** Secondary facts such as stop count and hours; each part wraps as a whole. */
  readonly meta = input<readonly string[]>([]);
  /** `null` hides the star; `true`/`false` shows it pressed or not. */
  readonly favorite = input<boolean | null>(null);

  readonly opened = output<void>();
  readonly favoriteToggle = output<void>();
}
