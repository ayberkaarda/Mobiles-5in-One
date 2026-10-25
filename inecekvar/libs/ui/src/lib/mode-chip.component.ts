import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { LineMode } from '@inecekvar/domain';

/**
 * Vehicle kind of a line: the label always names the kind; the tint and the dot only repeat it
 * (dolmuş on the plate colour, minibüs on the information blue, servis on a neutral tint).
 */
@Component({
  selector: 'iv-mode-chip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'iv-chip',
    '[class]': "'iv-chip--' + mode()",
    '[attr.data-mode]': 'mode()',
  },
  template: `<span class="dot" aria-hidden="true"></span>{{ label() }}`,
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      height: 26px;
      padding: 0 10px;
      border-radius: var(--iv-radius-pill);
      font-size: 13px;
      font-weight: var(--iv-font-body-weight-600);
      line-height: 1;
      color: var(--iv-ink);
      white-space: nowrap;
    }
    :host(.iv-chip--dolmus) {
      background: var(--iv-mode-dolmus-bg);
    }
    :host(.iv-chip--minibus) {
      background: var(--iv-mode-minibus-bg);
    }
    :host(.iv-chip--servis) {
      background: var(--iv-mode-servis-bg);
      box-shadow: inset 0 0 0 1px var(--iv-line-strong);
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--iv-mode-dolmus-dot);
    }
    :host(.iv-chip--minibus) .dot {
      background: var(--iv-mode-minibus-dot);
    }
    :host(.iv-chip--servis) .dot {
      background: var(--iv-ink);
      box-shadow: none;
    }
  `,
})
export class ModeChipComponent {
  readonly mode = input.required<LineMode>();
  /** Translated name of the mode; the component holds no copy of its own. */
  readonly label = input.required<string>();
}
