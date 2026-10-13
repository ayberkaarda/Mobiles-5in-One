import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * The destination sign at the top of a line: the large code placard and the mode on a lacivert
 * board, then the start and end stops in sign lettering joined by a short rail; each row turns
 * in once like a flip display (no motion with reduced motion). The page projects its heading
 * and an optional action (marked `slot="action"`). Text only.
 */
@Component({
  selector: 'iv-destination-sign',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="sign iv-board">
      <div class="top">
        <span class="plate iv-placard iv-placard--xl" aria-hidden="true">{{ code() }}</span>
        @if (mode()) {
          <span class="mode iv-sign-text">{{ mode() }}</span>
        }
        <span class="action"><ng-content select="[slot=action]" /></span>
      </div>
      <ng-content />
      @if (from() && to()) {
        <p class="ends">
          <span class="row iv-flip">
            <span class="cap">{{ fromLabel() }}</span>
            <span class="stop iv-sign-text">{{ from() }}</span>
          </span>
          <span class="row iv-flip iv-flip--1">
            <span class="cap">{{ toLabel() }}</span>
            <span class="stop iv-sign-text">{{ to() }}</span>
          </span>
        </p>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .sign {
      padding: 18px 16px 24px;
      border-radius: var(--iv-radius-l);
    }
    .top {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .plate {
      white-space: nowrap;
    }
    .mode {
      font-size: 13px;
      letter-spacing: 0.14em;
    }
    .action {
      margin-left: auto;
      display: flex;
    }
    .ends {
      position: relative;
      display: grid;
      gap: 12px;
      margin: 16px 0 0;
      padding: 14px 0 0 26px;
      border-top: 1px dashed rgba(255, 248, 231, 0.24);
    }
    .ends::before {
      content: '';
      position: absolute;
      left: 6px;
      top: 26px;
      bottom: 14px;
      width: 4px;
      border-radius: 2px;
      background: var(--iv-rail);
    }
    .row {
      position: relative;
      display: grid;
      gap: 1px;
      min-width: 0;
    }
    .row::before {
      content: '';
      position: absolute;
      left: -26px;
      top: 7px;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: var(--iv-board-sign);
      box-shadow: 0 0 0 3px var(--iv-board);
    }
    .cap {
      font-size: 12px;
      color: var(--iv-board-muted);
    }
    .stop {
      font-size: 19px;
      line-height: 1.15;
      letter-spacing: 0.03em;
      overflow-wrap: anywhere;
    }
  `,
})
export class DestinationSignComponent {
  readonly code = input.required<string>();
  /** Translated mode name, shown in sign lettering beside the placard. */
  readonly mode = input<string>('');
  readonly from = input<string>('');
  readonly to = input<string>('');
  readonly fromLabel = input<string>('');
  readonly toLabel = input<string>('');
}
