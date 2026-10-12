import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type StatusTone = 'pending' | 'approved' | 'rejected' | 'neutral';

/**
 * A small state label for a proposal: a shape as well as a colour (clock ring, tick, cross),
 * so the state does not depend on colour alone. The caller translates the label.
 */
@Component({
  selector: 'iv-status-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-tone]': 'tone()' },
  template: `
    <svg viewBox="0 0 16 16" aria-hidden="true">
      @switch (tone()) {
        @case ('approved') {
          <path d="M3.5 8.5l3 3 6-7" />
        }
        @case ('rejected') {
          <path d="M4 4l8 8M12 4l-8 8" />
        }
        @case ('pending') {
          <circle cx="8" cy="8" r="5.5" />
          <path d="M8 5v3.2l2 1.3" />
        }
        @default {
          <circle cx="8" cy="8" r="2.5" />
        }
      }
    </svg>
    <span>{{ label() }}</span>
  `,
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      height: 24px;
      padding: 0 9px 0 7px;
      border-radius: var(--iv-radius-pill);
      background: var(--iv-surface-sunk);
      color: var(--iv-ink);
      font-size: 12px;
      font-weight: 600;
      white-space: nowrap;
    }
    svg {
      width: 14px;
      height: 14px;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    :host([data-tone='pending']) {
      background: var(--iv-mode-dolmus-bg);
    }
    :host([data-tone='approved']) {
      background: color-mix(in srgb, var(--iv-success) 22%, transparent);
    }
    :host([data-tone='rejected']) {
      background: color-mix(in srgb, var(--iv-danger) 18%, transparent);
    }
  `,
})
export class StatusBadgeComponent {
  readonly tone = input<StatusTone>('neutral');
  readonly label = input.required<string>();
}
