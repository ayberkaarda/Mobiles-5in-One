import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * The header of a stop: a stop pole beside the projected name and kind, on a lacivert board.
 * The pole is the brand's stop sign (yellow disc, lacivert ring, turquoise band) drawn from
 * plain shapes; it is decorative.
 */
@Component({
  selector: 'iv-stop-sign',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="board iv-board">
      <svg class="pole" viewBox="0 0 56 112" aria-hidden="true" focusable="false">
        <rect class="post" x="25" y="40" width="6" height="72" rx="2" />
        <circle class="disc" cx="28" cy="26" r="22" />
        <circle class="ring" cx="28" cy="26" r="8.5" />
        <rect class="band" x="13" y="42" width="30" height="6" rx="3" />
      </svg>
      <div class="text"><ng-content /></div>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .board {
      display: flex;
      align-items: flex-end;
      gap: 14px;
      padding: 18px 16px 0;
      border-radius: var(--iv-radius-l);
      overflow: hidden;
    }
    .pole {
      flex: none;
      width: 52px;
      height: 104px;
      margin-bottom: -2px;
    }
    .post {
      fill: var(--iv-board-muted);
    }
    .disc {
      fill: var(--iv-plate);
      stroke: var(--iv-plate-ink);
      stroke-width: 3;
    }
    .ring {
      fill: none;
      stroke: var(--iv-plate-ink);
      stroke-width: 4.5;
    }
    .band {
      fill: var(--iv-stripe);
    }
    .text {
      flex: 1;
      min-width: 0;
      padding-bottom: 22px;
      color: var(--iv-board-ink);
    }
  `,
})
export class StopSignComponent {}
