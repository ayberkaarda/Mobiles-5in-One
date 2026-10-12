import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

export interface StopSequenceItem {
  slug: string;
  name: string;
  /** Secondary text such as "unmarked stop"; translated by the caller. */
  note?: string;
}

/**
 * The ordered stops of a line on a vertical minibüs stripe; the first and last stops are drawn
 * as terminals. Every stop is a button that emits its slug. Names are rendered as text only.
 */
@Component({
  selector: 'iv-stop-sequence',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ol class="seq">
      @for (stop of stops(); track stop.slug; let first = $first, last = $last) {
        <li [class.terminal]="first || last">
          <button type="button" (click)="selected.emit(stop.slug)">
            <span class="dot" aria-hidden="true"></span>
            <span class="text">
              <span class="name">{{ stop.name }}</span>
              @if (stop.note) {
                <span class="note">{{ stop.note }}</span>
              }
            </span>
            <svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
          </button>
        </li>
      }
    </ol>
  `,
  styles: `
    :host {
      display: block;
    }
    .seq {
      position: relative;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .seq::before {
      content: '';
      position: absolute;
      left: 15px;
      top: 22px;
      bottom: 22px;
      width: 6px;
      border-radius: 3px;
      background: var(--iv-stripe);
    }
    button {
      position: relative;
      display: flex;
      align-items: center;
      gap: 14px;
      width: 100%;
      min-height: 48px;
      padding: 6px 4px 6px 8px;
      border: 0;
      border-radius: var(--iv-radius-s);
      background: none;
      color: var(--iv-ink);
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    button:focus-visible {
      outline: none;
      box-shadow: var(--iv-focus);
    }
    .dot {
      flex: none;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: var(--iv-surface);
      border: 3px solid var(--iv-ink);
    }
    .terminal .dot {
      background: var(--iv-accent);
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
      font-weight: var(--iv-font-body-weight-600);
    }
    .note {
      font-size: 12px;
      color: var(--iv-ink-muted);
    }
    .chev {
      flex: none;
      width: 18px;
      height: 18px;
      fill: none;
      stroke: var(--iv-ink-muted);
      stroke-width: 2;
    }
  `,
})
export class StopSequenceComponent {
  readonly stops = input.required<readonly StopSequenceItem[]>();
  readonly selected = output<string>();
}
