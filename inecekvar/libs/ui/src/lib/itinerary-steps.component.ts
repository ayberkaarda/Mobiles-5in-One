import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { KeepCodesComponent } from './keep-codes.component';
import { PLACARD_STYLES } from './sign-styles';

/** One step of a chosen itinerary, translated by the caller. */
export interface ItineraryStep {
  kind: 'ride' | 'walk';
  /** Line code for rides; shown on the placard. */
  code?: string;
  title: string;
  detail: string;
}

/**
 * The steps of the selected itinerary as an ordered list: a code plate marks each ride, a
 * dashed ring each walk, joined by a rail like the stop sequence of a line page.
 */
@Component({
  selector: 'iv-itinerary-steps',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [KeepCodesComponent],
  template: `
    <ol class="steps" [attr.aria-label]="label()">
      @for (step of steps(); track $index) {
        <li class="step" [class.walk]="step.kind === 'walk'">
          <span class="marker" aria-hidden="true">
            @if (step.kind === 'ride') {
              <span class="plate iv-placard iv-placard--s">{{ step.code }}</span>
            } @else {
              <span class="ring"></span>
            }
          </span>
          <span class="text">
            <span class="title"><iv-keep-codes [text]="step.title" /></span>
            <span class="detail"><iv-keep-codes [text]="step.detail" /></span>
          </span>
        </li>
      }
    </ol>
  `,
  styles: [
    PLACARD_STYLES,
    `
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
        border-left: 5px solid var(--iv-rail);
        box-shadow: -3px 0 0 var(--iv-rail-casing);
        margin-left: -1px;
      }
      .step.walk:not(:last-child)::before {
        border-left: 3px dotted var(--iv-walk);
        box-shadow: none;
      }
      .marker {
        display: flex;
        align-items: flex-start;
        justify-content: center;
        position: relative;
        z-index: 1;
      }
      .plate {
        white-space: nowrap;
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
  ],
})
export class ItineraryStepsComponent {
  readonly steps = input.required<readonly ItineraryStep[]>();
  /** Accessible name of the list, translated by the caller. */
  readonly label = input.required<string>();
}
