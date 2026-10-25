import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Fare ticket: a stub with a perforated tear line. The stub carries the short label, the
 * body the amount and a note such as the update date. Text only; the caller translates it.
 */
@Component({
  selector: 'iv-ticket',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'iv-ticket' },
  styles: `
    /* Fare ticket: a stub with a perforated tear line and notches. */
    :host {
      --iv-ticket-cut: 4.25rem;
      position: relative;
      display: grid;
      grid-template-columns: var(--iv-ticket-cut) 1fr;
      align-items: stretch;
      min-height: 4.5rem;
      border-radius: 10px;
      background: var(--iv-ticket);
      color: var(--iv-ticket-ink);
      -webkit-mask:
        radial-gradient(circle at var(--iv-ticket-cut) 0, transparent 8px, #000 8.5px) top / 100%
          51% no-repeat,
        radial-gradient(circle at var(--iv-ticket-cut) 100%, transparent 8px, #000 8.5px) bottom /
          100% 51% no-repeat;
      mask:
        radial-gradient(circle at var(--iv-ticket-cut) 0, transparent 8px, #000 8.5px) top / 100%
          51% no-repeat,
        radial-gradient(circle at var(--iv-ticket-cut) 100%, transparent 8px, #000 8.5px) bottom /
          100% 51% no-repeat;
    }

    .iv-ticket__stub {
      display: grid;
      place-items: center;
      /* The stub is turned half a turn, so its left edge is the tear line. */
      border-left: 2px dashed color-mix(in srgb, var(--iv-ticket-ink) 45%, transparent);
      font-family: var(--iv-font-display);
      font-weight: var(--iv-font-display-weight);
      font-size: 0.72rem;
      letter-spacing: 0.12em;
      writing-mode: vertical-rl;
      transform: rotate(180deg);
      text-transform: uppercase;
    }

    .iv-ticket__body {
      display: grid;
      align-content: center;
      gap: 2px;
      padding: 0.7rem 1rem 0.7rem 1.1rem;
      min-width: 0;
    }

    .iv-ticket__amount {
      font-family: var(--iv-font-display);
      font-weight: var(--iv-font-display-weight);
      font-size: 1.85rem;
      line-height: 1;
      letter-spacing: -0.01em;
      font-variant-numeric: tabular-nums;
    }

    .iv-ticket__note {
      font-size: 0.82rem;
      line-height: 1.35;
      opacity: 0.86;
    }
  `,
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
