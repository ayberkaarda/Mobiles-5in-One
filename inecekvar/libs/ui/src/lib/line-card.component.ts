import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { LineMode } from '@inecekvar/domain';
import { FareChipComponent } from './fare-chip.component';
import { KeepCodesComponent } from './keep-codes.component';
import { ModeChipComponent } from './mode-chip.component';
import { PLACARD_STYLES } from './sign-styles';

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
 * One line in a list, drawn as a route placard: the painted code plate bolted to the board with
 * the line name in board lettering, the mode and fare beneath, and the stripe along the foot. The board is one button that opens the line; the star toggles a
 * favourite. Optional start and end stops read like a destination sign.
 */
@Component({
  selector: 'iv-line-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FareChipComponent, KeepCodesComponent, ModeChipComponent],
  template: `
    <article class="card iv-board">
      <button type="button" class="main" (click)="opened.emit()">
        <span class="plate iv-placard" aria-hidden="true">{{ code() }}</span>
        <span class="body">
          <span class="name">
            <span class="iv-visually-hidden">{{ code() }} </span><iv-keep-codes [text]="name()" />
          </span>
          @if (from() && to()) {
            <span class="ends">
              <span class="end">{{ from() }}</span>
              <svg viewBox="0 0 16 8" aria-hidden="true"><path d="M1 4h13M10 1l3 3-3 3" /></svg>
              <span class="end">{{ to() }}</span>
            </span>
          }
          <span class="chips">
            <iv-mode-chip [mode]="mode()" [label]="labels().mode" />
            @if (fareMinor() !== undefined) {
              <iv-fare-chip
                [fareMinor]="fareMinor() ?? null"
                [srLabel]="labels().fare"
                [freeLabel]="labels().fareFree"
                [unknownLabel]="labels().fareUnknown"
                [locale]="locale()"
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
  styles: [
    PLACARD_STYLES,
    `
      :host {
        display: block;
      }
      .card {
        --iv-ink: var(--iv-board-ink);
        --iv-ink-muted: var(--iv-board-muted);
        --iv-line-strong: var(--iv-board-line);
        --iv-tag: var(--iv-plate);
        --iv-tag-ink: var(--iv-plate-ink);
        --iv-mode-servis-bg: color-mix(in srgb, var(--iv-board-ink) 8%, transparent);
        display: flex;
        align-items: stretch;
        transition: transform 120ms var(--iv-ease-out);
      }
      .card:active {
        transform: translateY(2px);
      }
      .main {
        flex: 1;
        display: flex;
        gap: 14px;
        align-items: flex-start;
        min-width: 0;
        min-height: 76px;
        padding: 14px 4px 18px 14px;
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
        margin-top: 2px;
        white-space: nowrap;
      }
      .body {
        display: grid;
        gap: 7px;
        min-width: 0;
      }
      .name {
        font-family: var(--iv-font-display);
        font-weight: var(--iv-font-display-weight);
        font-size: 17px;
        line-height: 1.25;
        letter-spacing: -0.005em;
        color: var(--iv-board-ink);
        overflow-wrap: anywhere;
      }
      .ends {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 2px 6px;
        font-size: 13px;
        font-weight: var(--iv-font-body-weight-600);
        color: var(--iv-board-sign);
      }
      .ends svg {
        width: 16px;
        height: 8px;
        fill: none;
        stroke: currentColor;
        stroke-width: 1.6;
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
        color: var(--iv-board-muted);
        font-variant-numeric: tabular-nums;
      }
      .star {
        flex: none;
        width: 52px;
        border: 0;
        background: none;
        color: var(--iv-board-muted);
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
        color: var(--iv-board-sign);
      }
      .star.on path {
        fill: currentColor;
      }
      @media (prefers-reduced-motion: reduce) {
        .card {
          transition: none;
        }
      }
    `,
  ],
})
export class LineCardComponent {
  readonly code = input.required<string>();
  readonly name = input.required<string>();
  readonly mode = input.required<LineMode>();
  readonly labels = input.required<LineCardLabels>();
  /** Fare in kuruş, `null` when unknown, `undefined` to leave the fare chip out. */
  readonly fareMinor = input<number | null | undefined>(null);
  /** Locale of the fare format. */
  readonly locale = input<string>('tr-TR');
  /** Secondary facts such as stop count and hours; each part wraps as a whole. */
  readonly meta = input<readonly string[]>([]);
  /** First and last stop, shown as a destination line when both are known. */
  readonly from = input<string>('');
  readonly to = input<string>('');
  /** `null` hides the star; `true`/`false` shows it pressed or not. */
  readonly favorite = input<boolean | null>(null);

  readonly opened = output<void>();
  readonly favoriteToggle = output<void>();
}
