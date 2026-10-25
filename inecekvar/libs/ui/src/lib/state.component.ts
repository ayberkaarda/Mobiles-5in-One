import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { CitySceneComponent } from './city-scene.component';

export type StateKind = 'empty' | 'error' | 'offline';

/**
 * Empty, error and offline states. The illustration is a stop sign on a pole: upright and
 * on its board colours when there is simply nothing yet, knocked over and dark for errors (the
 * heading says what went wrong, colour is never the only cue), greyed for offline.
 * First-run moments can show the street scene instead.
 */
@Component({
  selector: 'iv-state',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CitySceneComponent],
  host: {
    '[class]': "'iv-state--' + kind() + (art() === 'street' ? ' iv-state--street' : '')",
    '[attr.role]': "kind() === 'error' ? 'alert' : 'status'",
  },
  template: `
    @if (art() === 'street') {
      <iv-city-scene class="scene" />
    } @else {
      <svg class="art" viewBox="0 0 120 96" aria-hidden="true">
        <path class="road" d="M8 88H112" />
        <g [attr.transform]="kind() === 'error' ? 'rotate(-14 60 88)' : null">
          <rect class="pole" x="57" y="34" width="6" height="54" rx="2" />
          <circle class="sign" cx="60" cy="30" r="22" />
          <circle class="ring" cx="60" cy="30" r="10" />
          <rect class="stripe" x="44" y="44" width="32" height="5" rx="2.5" />
        </g>
      </svg>
    }
    <h2 class="heading">{{ heading() }}</h2>
    @if (message()) {
      <p class="message">{{ message() }}</p>
    }
    <ng-content />
    @if (actionLabel()) {
      <button type="button" class="iv-button" (click)="action.emit()">{{ actionLabel() }}</button>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
      padding: 24px 20px;
      text-align: center;
      border: 1.5px dashed var(--iv-line-strong);
      border-radius: var(--iv-radius-l);
    }
    .art {
      width: 104px;
      height: 84px;
    }
    :host(.iv-state--street) {
      overflow: hidden;
      padding-top: 0;
      border-style: solid;
      border-color: var(--iv-line);
      background: var(--iv-surface);
    }
    .scene {
      align-self: stretch;
      margin: 0 -20px 6px;
      padding-top: 18px;
      background: var(--iv-bg-deep);
    }
    .road {
      stroke: var(--iv-line-strong);
      stroke-width: 3;
      stroke-dasharray: 10 8;
      stroke-linecap: round;
    }
    .pole {
      fill: var(--iv-ink-muted);
    }
    .sign {
      fill: var(--iv-board);
      stroke: var(--iv-ink);
      stroke-width: 3;
    }
    .ring {
      fill: none;
      stroke: var(--iv-plate);
      stroke-width: 4;
    }
    .stripe {
      fill: var(--iv-stripe);
    }
    :host(.iv-state--error) .sign {
      fill: var(--iv-danger);
    }
    :host(.iv-state--offline) .sign {
      fill: var(--iv-surface-sunk);
      stroke: var(--iv-ink-muted);
    }
    :host(.iv-state--offline) .ring {
      stroke: var(--iv-ink-muted);
    }
    .heading {
      margin: 6px 0 0;
      font-family: var(--iv-font-display);
      font-weight: var(--iv-font-display-weight);
      font-size: 20px;
      line-height: 1.2;
      color: var(--iv-ink);
    }
    .message {
      margin: 0;
      max-width: 34ch;
      font-size: 15px;
      line-height: 1.5;
      color: var(--iv-ink-muted);
    }
    .iv-button {
      margin-top: 8px;
    }
  `,
})
export class StateComponent {
  readonly kind = input<StateKind>('empty');
  /** The stop sign (default) or the street scene, for first-run moments. */
  readonly art = input<'stop' | 'street'>('stop');
  readonly heading = input.required<string>();
  readonly message = input<string>('');
  /** Shows the action button when set. */
  readonly actionLabel = input<string>('');
  readonly action = output<void>();
}
