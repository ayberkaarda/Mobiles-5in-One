import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PLACARD_STYLES } from '@inecekvar/ui';

/**
 * One line as a route board link on the public pages: the yellow code placard on a lacivert sign
 * with the line name and a short meta line, the same board as the line cards of the app. The
 * whole board is one link; names are rendered as text only.
 */
@Component({
  selector: 'iv-route-board',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a class="board iv-board" [routerLink]="link()">
      <span class="plate iv-placard" aria-hidden="true">{{ code() }}</span>
      <span class="text">
        <span class="name"
          ><span class="code">{{ code() }} </span>{{ name() }}</span
        >
        @if (meta()) {
          <span class="meta">{{ meta() }}</span>
        }
      </span>
    </a>
  `,
  styles: [
    PLACARD_STYLES,
    `
      :host {
        display: block;
      }
      .board {
        display: flex;
        align-items: flex-start;
        gap: 1rem;
        min-height: 4.5rem;
        padding: 1rem 1rem 1.3rem;
        box-sizing: border-box;
        color: var(--iv-board-ink);
        text-decoration: none;
        transition: transform 120ms var(--iv-ease-out);
      }
      .board:hover {
        transform: translateY(-2px);
      }
      .board:hover .name {
        text-decoration: underline;
        text-decoration-color: var(--iv-board-sign);
        text-underline-offset: 0.2em;
      }
      .plate {
        flex: none;
        white-space: nowrap;
      }
      .text {
        display: grid;
        gap: 0.25rem;
        min-width: 0;
      }
      .name {
        font-family: var(--iv-font-display);
        font-weight: var(--iv-font-display-weight);
        font-size: 1.1rem;
        line-height: 1.25;
        overflow-wrap: anywhere;
      }
      .code {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
        white-space: nowrap;
      }
      .meta {
        font-size: 0.9rem;
        color: var(--iv-board-muted);
      }
      .meta::first-letter {
        text-transform: uppercase;
      }
      @media (prefers-reduced-motion: reduce) {
        .board {
          transition: none;
        }
      }
    `,
  ],
})
export class RouteBoardComponent {
  readonly code = input.required<string>();
  readonly name = input.required<string>();
  readonly link = input.required<readonly string[]>();
  readonly meta = input<string>('');
}
