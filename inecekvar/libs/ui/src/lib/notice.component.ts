import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

export type NoticeTone = 'info' | 'offline' | 'warn';

/**
 * A one-line strip with an optional action: offline hints, pack prompts and the update prompt.
 * Text only; the caller translates everything.
 */
@Component({
  selector: 'iv-notice',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class]': "'iv-notice--' + tone()",
    '[attr.role]': "tone() === 'warn' ? 'alert' : 'status'",
  },
  template: `
    <span class="dot" aria-hidden="true"></span>
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
    .dot {
      flex: none;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: var(--iv-color-turkuaz);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--iv-color-turkuaz) 25%, transparent);
    }
    :host(.iv-notice--offline) .dot {
      background: var(--iv-ink-muted);
      box-shadow: 0 0 0 3px var(--iv-surface-sunk);
    }
    :host(.iv-notice--warn) {
      border-color: var(--iv-color-dolmus-sarisi);
    }
    :host(.iv-notice--warn) .dot {
      background: var(--iv-color-dolmus-sarisi);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--iv-color-dolmus-sarisi) 30%, transparent);
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
      outline: 2px solid var(--iv-color-turkuaz);
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
