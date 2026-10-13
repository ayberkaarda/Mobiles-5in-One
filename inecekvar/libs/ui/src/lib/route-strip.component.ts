import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { StripNode, StripSegment, stripLayout } from './route-strip';

/**
 * The strip diagram of a line or an itinerary, server-renderable and without script: a straight
 * rail, one dot per stop, slanted names, ticks and placards (layout in `route-strip.ts`). Wider
 * than its box it scrolls sideways. The SVG is one image with the caller's text alternative; the
 * page lists the same stops as an ordered list for screen readers.
 */
@Component({
  selector: 'iv-route-strip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (layout(); as strip) {
      <div class="scroller" [class.long]="long()" [attr.tabindex]="long() ? 0 : null">
        <svg
          class="iv-strip"
          [attr.viewBox]="strip.viewBox"
          [attr.width]="strip.width"
          [attr.height]="strip.height"
          role="img"
          [attr.aria-label]="label()"
          preserveAspectRatio="xMinYMin meet"
        >
          @for (walk of strip.walks; track $index) {
            <path class="walk" [attr.d]="walk" />
          }
          @for (ride of strip.rides; track $index) {
            <path class="casing" [attr.d]="ride" />
            <path class="rail" [attr.d]="ride" />
          }
          @for (node of strip.nodes; track $index) {
            @if (node.kind === 'transfer') {
              <rect
                class="capsule"
                [attr.x]="node.x - 8"
                [attr.y]="node.y - 14"
                width="16"
                height="28"
                rx="8"
              />
            }
            @if (node.kind === 'place') {
              <rect
                [class]="'node ' + node.kind"
                [attr.x]="node.x - 7"
                [attr.y]="node.y - 7"
                width="14"
                height="14"
                rx="3"
              />
            } @else {
              <circle
                [class]="'node ' + node.kind"
                [attr.cx]="node.x"
                [attr.cy]="node.y"
                [attr.r]="node.r"
              />
            }
            <text
              class="name"
              [class.end]="node.kind === 'terminal' || node.kind === 'place'"
              [attr.x]="node.labelX"
              [attr.y]="node.labelY"
              [attr.transform]="node.labelTransform"
            >
              {{ node.label }}
            </text>
            @if (node.tick) {
              <text class="tick" [attr.x]="node.x" [attr.y]="node.tickY" text-anchor="middle">
                {{ node.tick }}
              </text>
            }
          }
          @for (placard of strip.placards; track $index) {
            <rect
              class="placard"
              [attr.x]="placard.x"
              [attr.y]="placard.y"
              [attr.width]="placard.width"
              [attr.height]="placard.height"
              rx="5"
            />
            <text
              class="code"
              [attr.x]="placard.textX"
              [attr.y]="placard.textY"
              text-anchor="middle"
            >
              {{ placard.code }}
            </text>
          }
          @for (item of strip.labels; track $index) {
            <text class="segment" [attr.x]="item.x" [attr.y]="item.y" text-anchor="middle">
              {{ item.text }}
            </text>
          }
        </svg>
      </div>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .scroller {
      overflow-x: auto;
      overscroll-behavior-x: contain;
      scrollbar-width: thin;
      border-radius: var(--iv-radius-s);
    }
    .scroller:focus-visible {
      outline: none;
      box-shadow: var(--iv-focus);
    }
    svg {
      display: block;
      width: 100%;
      max-width: 34rem;
      height: auto;
      overflow: visible;
    }
    .long svg {
      width: auto;
      max-width: none;
    }
    .casing {
      fill: none;
      stroke: var(--iv-rail-casing);
      stroke-width: 11;
      stroke-linecap: round;
    }
    .rail {
      fill: none;
      stroke: var(--iv-rail);
      stroke-width: 5;
      stroke-linecap: round;
    }
    .walk {
      fill: none;
      stroke: var(--iv-walk);
      stroke-width: 3.5;
      stroke-linecap: round;
      stroke-dasharray: 0.5 7;
    }
    .node,
    .capsule {
      fill: var(--iv-stop-fill);
      stroke: var(--iv-rail-casing);
      stroke-width: 3;
    }
    .node.terminal,
    .node.place {
      fill: var(--iv-plate);
      stroke-width: 3.5;
    }
    .node.transfer {
      stroke-width: 2.5;
    }
    text {
      fill: var(--iv-ink);
      font-family: var(--iv-font-display);
      font-weight: var(--iv-font-display-weight);
    }
    .name {
      font-size: 12px;
    }
    .name.end {
      font-size: 12.5px;
    }
    .tick,
    .segment {
      fill: var(--iv-ink-muted);
      font-family: var(--iv-font-body);
      font-size: 11px;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }
    .placard {
      fill: var(--iv-plate);
      stroke: var(--iv-plate-ink);
      stroke-width: 2;
    }
    .code {
      fill: var(--iv-plate-ink);
      font-size: 13px;
      letter-spacing: 0.03em;
    }
  `,
})
export class RouteStripComponent {
  readonly nodes = input.required<readonly StripNode[]>();
  /** One per gap between nodes; missing entries are rides. */
  readonly segments = input<readonly StripSegment[]>([]);
  /** Text alternative of the whole drawing, translated by the caller. */
  readonly label = input.required<string>();
  /** Width the strip aims to fit before it scrolls. */
  readonly fit = input<number>(340);

  /** Long strips keep their drawn size and scroll; short ones scale to the box. */
  protected readonly long = computed(() => this.nodes().length > 8);

  protected readonly layout = computed(() =>
    stripLayout(this.nodes(), this.segments(), { fit: this.fit() }),
  );
}
