import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

export type NoticeTone = 'info' | 'offline' | 'warn' | 'error';

/**
 * A one-line strip with an optional action: offline hints, pack prompts, the update prompt and
 * errors. Each tone has its own mark (an i, a crossed-out cloud, a warning triangle, a cross), so
 * the tone never rests on colour alone; warnings and errors are announced as alerts. Text only;
 * the caller translates everything.
 */
@Component({
  selector: 'iv-notice',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class]': "'iv-notice--' + tone()",
    '[attr.role]': "tone() === 'warn' || tone() === 'error' ? 'alert' : 'status'",
  },
  template: `
    <svg class="mark" viewBox="0 0 20 20" aria-hidden="true">
      @switch (tone()) {
        @case ('offline') {
          <path d="M6 15h8.5a3 3 0 0 0 .4-6A4.5 4.5 0 0 0 6.3 8 3.5 3.5 0 0 0 6 15z" />
          <path d="M3 3l14 14" />
        }
        @case ('warn') {
          <path d="M10 2.8l7.8 13.7H2.2z" />
          <path d="M10 8v4M10 14.2v.1" />
        }
        @case ('error') {
          <circle cx="10" cy="10" r="7.6" />
          <path d="M7 7l6 6M13 7l-6 6" />
        }
        @default {
          <circle cx="10" cy="10" r="7.6" />
          <path d="M10 9v5M10 6.2v.1" />
        }
      }
    </svg>
    <span class="text">
      @if (heading()) {
        <strong class="heading">{{ heading() }}</strong>
      }
      <span class="message">{{ message() }}</span>
    </span>
    @if (actionLabel()) {
      <button type="button" class="action" (click)="action.emit()">{{ actionLabel() }}</button>
    }
  `,
  styles: `
    :host {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 12px;
      border-radius: var(--iv-radius-m);
      border: 1px solid var(--iv-line);
      background: var(--iv-surface);
      color: var(--iv-ink);
      font-size: 14px;
      line-height: 1.4;
    }
    .mark {
      flex: none;
      width: 20px;
      height: 20px;
      fill: none;
      stroke: var(--iv-info);
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    :host(.iv-notice--offline) .mark {
      stroke: var(--iv-ink-muted);
    }
    :host(.iv-notice--warn),
    :host(.iv-notice--error) {
      border-color: var(--iv-ink);
      border-width: 2px;
    }
    :host(.iv-notice--warn) .mark,
    :host(.iv-notice--error) .mark {
      stroke: var(--iv-ink);
    }
    :host(.iv-notice--error) .message {
      color: var(--iv-ink);
    }
    .text {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
      overflow-wrap: anywhere;
    }
    .heading {
      font-weight: 600;
    }
    .message {
      color: var(--iv-ink-muted);
    }
    .heading + .message {
      font-size: 13px;
    }
    .action {
      flex: none;
      min-height: 36px;
      padding: 0 12px;
      border: 0;
      border-radius: 999px;
      background: var(--iv-accent);
      color: var(--iv-accent-ink);
      font: inherit;
      font-weight: 600;
      cursor: pointer;
    }
    .action:focus-visible {
      outline: 2px solid var(--iv-ink);
      outline-offset: 2px;
    }
  `,
})
export class NoticeComponent {
  readonly tone = input<NoticeTone>('info');
  readonly heading = input<string>('');
  readonly message = input.required<string>();
  readonly actionLabel = input<string>('');
  readonly action = output<void>();
}
