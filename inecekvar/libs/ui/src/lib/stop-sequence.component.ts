import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';

export interface StopSequenceItem {
  slug: string;
  name: string;
  /** Secondary text such as "unmarked stop"; translated by the caller. */
  note?: string;
  /** Router link of the stop page; the stop renders as a link instead of a button. */
  link?: readonly string[];
  query?: Record<string, string>;
  /** Short text at the end of the row, such as the stop number. */
  tick?: string;
}

/**
 * The ordered stops of a line as the vertical form of the strip diagram: the rail with its
 * casing, a dot per stop and the terminals marked. Each stop is a link (when the
 * item has one) or a button that emits its slug. Names are rendered as text only.
 */
@Component({
  selector: 'iv-stop-sequence',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet, RouterLink],
  template: `
    <ol class="seq" [attr.aria-label]="label() || null">
      @for (stop of stops(); track stop.slug; let first = $first, last = $last) {
        <li
          [class.terminal]="first || last"
          [class.first]="first"
          [class.last]="last"
          [class.ticked]="!!stop.tick"
        >
          @if (stop.link) {
            <a class="row" [routerLink]="stop.link" [queryParams]="stop.query">
              <ng-container *ngTemplateOutlet="body; context: { $implicit: stop }" />
            </a>
          } @else {
            <button type="button" class="row" (click)="selected.emit(stop.slug)">
              <ng-container *ngTemplateOutlet="body; context: { $implicit: stop }" />
            </button>
          }
          @if (stop.tick) {
            <span class="tick" aria-hidden="true">{{ stop.tick }}</span>
          }
        </li>
      }
    </ol>
    <ng-template #body let-stop>
      <span class="dot" aria-hidden="true"></span>
      <span class="text">
        <span class="name">{{ stop.name }}</span>
        @if (stop.note) {
          <span class="note">{{ stop.note }}</span>
        }
      </span>
    </ng-template>
  `,
  styles: `
    :host {
      display: block;
    }
    .seq {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    li {
      position: relative;
    }
    li::before {
      content: '';
      position: absolute;
      left: 15px;
      top: 0;
      bottom: 0;
      width: 5px;
      background: var(--iv-rail);
      box-shadow:
        -3px 0 0 var(--iv-rail-casing),
        3px 0 0 var(--iv-rail-casing);
    }
    li.first::before {
      top: 50%;
    }
    li.last::before {
      bottom: 50%;
    }
    li.first.last::before {
      display: none;
    }
    .row {
      position: relative;
      display: flex;
      align-items: center;
      gap: 16px;
      width: 100%;
      min-height: 52px;
      padding: 6px 6px 6px 7px;
      border: 0;
      border-radius: var(--iv-radius-s);
      background: none;
      color: var(--iv-ink);
      font: inherit;
      text-align: left;
      text-decoration: none;
      cursor: pointer;
    }
    .row:focus-visible {
      outline: none;
      box-shadow: var(--iv-focus);
    }
    .dot {
      position: relative;
      flex: none;
      width: 16px;
      height: 16px;
      margin-left: 2px;
      border-radius: 50%;
      background: var(--iv-stop-fill);
      border: 3px solid var(--iv-rail-casing);
      box-sizing: border-box;
    }
    .terminal .dot {
      width: 22px;
      height: 22px;
      margin-left: -1px;
      background: var(--iv-plate);
      border-width: 3.5px;
    }
    .text {
      display: grid;
      flex: 1;
      min-width: 0;
    }
    .name {
      font-size: 15px;
      line-height: 1.3;
      overflow-wrap: anywhere;
    }
    .terminal .name {
      font-family: var(--iv-font-display);
      font-weight: var(--iv-font-display-weight);
      font-size: 16px;
    }
    .note {
      font-size: 12px;
      color: var(--iv-ink-muted);
    }
    .ticked .row {
      padding-right: 46px;
    }
    .tick {
      position: absolute;
      right: 6px;
      top: 50%;
      transform: translateY(-50%);
      pointer-events: none;
      min-width: 26px;
      padding: 3px 6px;
      border-radius: 6px;
      background: var(--iv-surface-sunk);
      color: var(--iv-ink-muted);
      font-size: 12px;
      font-weight: 600;
      text-align: center;
      font-variant-numeric: tabular-nums;
    }
    @media (hover: hover) {
      .row:hover .name {
        text-decoration: underline;
        text-underline-offset: 3px;
      }
    }
  `,
})
export class StopSequenceComponent {
  readonly stops = input.required<readonly StopSequenceItem[]>();
  /** Accessible name of the list, translated by the caller. */
  readonly label = input<string>('');
  readonly selected = output<string>();
}
