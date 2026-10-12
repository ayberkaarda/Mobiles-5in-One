import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** One step of a chosen itinerary, translated by the caller. */
export interface ItineraryStep {
  kind: 'ride' | 'walk';
  /** Line code for rides; shown on the placard. */
  code?: string;
  title: string;
  detail: string;
}

/**
 * The steps of the selected itinerary as an ordered list: a yellow placard marks each ride, a
 * dashed ring each walk, joined by a rail like the stop sequence of a line page.
 */
@Component({
  selector: 'iv-itinerary-steps',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ol class="steps" [attr.aria-label]="label()">
      @for (step of steps(); track $index) {
        <li class="step" [class.walk]="step.kind === 'walk'">
          <span class="marker" aria-hidden="true">
            @if (step.kind === 'ride') {
              <span class="plate">{{ step.code }}</span>
            } @else {
              <span class="ring"></span>
            }
          </span>
          <span class="text">
            <span class="title">{{ step.title }}</span>
            <span class="detail">{{ step.detail }}</span>
          </span>
        </li>
      }
    </ol>
  `,
  styles: `
    :host {
      display: block;
    }
    .steps {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .step {
      position: relative;
      display: grid;
      grid-template-columns: 64px 1fr;
      gap: 12px;
      padding-bottom: 16px;
    }
    .step:not(:last-child)::before {
      content: '';
      position: absolute;
      left: 31px;
      top: 26px;
      bottom: 0;
      border-left: 3px solid var(--iv-stripe);
    }
    .step.walk:not(:last-child)::before {
      border-left: 2px dashed var(--iv-line-strong);
    }
    .marker {
      display: flex;
      align-items: flex-start;
      justify-content: center;
      position: relative;
      z-index: 1;
    }
    .plate {
      min-width: 52px;
      padding: 6px 6px 4px;
      border-radius: var(--iv-radius-s);
      background: var(--iv-plate);
      color: var(--iv-plate-ink);
      border-bottom: 3px solid var(--iv-stripe);
      font-family: var(--iv-font-display);
      font-weight: var(--iv-font-display-weight);
      font-size: 14px;
      text-align: center;
      line-height: 1;
      overflow-wrap: anywhere;
    }
    .ring {
      width: 16px;
      height: 16px;
      margin-top: 4px;
      border: 2px dashed var(--iv-ink-muted);
      border-radius: 50%;
      background: var(--iv-bg);
    }
    .text {
      display: grid;
      gap: 2px;
      min-width: 0;
    }
    .title {
      font-weight: var(--iv-font-body-weight-600);
      font-size: 15px;
      line-height: 1.35;
      color: var(--iv-ink);
      overflow-wrap: anywhere;
    }
    .detail {
      font-size: 13px;
      line-height: 1.4;
      color: var(--iv-ink-muted);
      overflow-wrap: anywhere;
    }
  `,
})
export class ItineraryStepsComponent {
  readonly steps = input.required<readonly ItineraryStep[]>();
  /** Accessible name of the list, translated by the caller. */
  readonly label = input.required<string>();
}
