import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Fare ticket: a yellow stub with a perforated tear line. The stub carries the short label, the
 * body the amount and a note such as the update date. Text only; the caller translates it.
 */
@Component({
  selector: 'iv-ticket',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'iv-ticket' },
  template: `
    <span class="iv-ticket__stub" aria-hidden="true">{{ stub() }}</span>
    <span class="iv-ticket__body">
      <span class="iv-visually-hidden">{{ stub() }}: </span>
      <span class="iv-ticket__amount">{{ amount() }}</span>
      @if (note()) {
        {{ ' ' }}<span class="iv-ticket__note">{{ note() }}</span>
      }
    </span>
  `,
})
export class TicketComponent {
  /** Short label on the stub, for example "Ücret". */
  readonly stub = input.required<string>();
  readonly amount = input.required<string>();
  readonly note = input<string>('');
}
