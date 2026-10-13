import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Block, InlinePart } from '../../../content/blocks';
import { PUBLIC_WEB_CONFIG } from '../../public-config';

type ViewPart =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'to'; readonly path: string; readonly text: string }
  | { readonly kind: 'app'; readonly href: string; readonly text: string };

type ViewBlock =
  | { readonly kind: 'h2'; readonly text: string; readonly id: string }
  | { readonly kind: 'h3'; readonly text: string }
  | { readonly kind: 'p' | 'note'; readonly parts: readonly ViewPart[] }
  | { readonly kind: 'ul' | 'ol'; readonly items: readonly (readonly ViewPart[])[] };

@Component({
  selector: 'iv-inline',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `@for (part of parts(); track $index) {
    @switch (part.kind) {
      @case ('text') {
        <span>{{ part.text }}</span>
      }
      @case ('to') {
        <a [routerLink]="part.path">{{ part.text }}</a>
      }
      @case ('app') {
        <a [href]="part.href" rel="nofollow noopener">{{ part.text }}</a>
      }
    }
  }`,
})
export class InlineComponent {
  readonly parts = input.required<readonly ViewPart[]>();
}

/** Anchor of the n-th (1-based) second-level heading of a page. */
export function sectionId(n: number): string {
  return `bolum-${n}`;
}

/** The table of contents of a page: its second-level headings with their anchors. */
export function blockToc(blocks: readonly Block[]): { id: string; text: string }[] {
  return blocks
    .flatMap((block) => (block.kind === 'h2' ? [block.text] : []))
    .map((text, index) => ({ id: sectionId(index + 1), text }));
}

/** Renders structured content blocks with template bindings only; no HTML string is built. */
@Component({
  selector: 'iv-content-blocks',
  standalone: true,
  imports: [InlineComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (block of view(); track $index) {
      @switch (block.kind) {
        @case ('h2') {
          <h2 [id]="block.id">{{ block.text }}</h2>
        }
        @case ('h3') {
          <h3>{{ block.text }}</h3>
        }
        @case ('p') {
          <p><iv-inline [parts]="block.parts" /></p>
        }
        @case ('note') {
          <p class="note"><iv-inline [parts]="block.parts" /></p>
        }
        @case ('ul') {
          <ul>
            @for (item of block.items; track $index) {
              <li><iv-inline [parts]="item" /></li>
            }
          </ul>
        }
        @case ('ol') {
          <ol>
            @for (item of block.items; track $index) {
              <li><iv-inline [parts]="item" /></li>
            }
          </ol>
        }
      }
    }
  `,
  styles: `
    h2 {
      position: relative;
      margin: 2.75rem 0 0.75rem;
      padding-left: 1.6rem;
      font-size: 1.6rem;
      line-height: 1.2;
      letter-spacing: -0.015em;
      scroll-margin-top: 1rem;
    }
    h2::before {
      content: '';
      position: absolute;
      left: 0;
      top: 0.35em;
      width: 0.8rem;
      height: 0.8rem;
      box-sizing: border-box;
      border-radius: 50%;
      background: var(--iv-plate);
      border: 3px solid var(--iv-rail-casing);
    }
    h3 {
      margin: 1.75rem 0 0.5rem;
      font-size: 1.2rem;
    }
    p,
    li {
      line-height: 1.7;
    }
    li {
      padding: 0.2rem 0;
    }
    li::marker {
      color: var(--iv-ink-muted);
      font-weight: 600;
    }
    a {
      text-decoration-color: var(--iv-stripe);
      text-decoration-thickness: 2px;
    }
    .note {
      margin: 2rem 0;
      padding: 0.25rem 0 0.25rem 1.25rem;
      border-left: 6px solid var(--iv-accent);
      font-family: var(--iv-font-display);
      font-weight: 700;
      font-size: 1.3rem;
      line-height: 1.4;
      letter-spacing: -0.005em;
    }
  `,
})
export class ContentBlocksComponent {
  readonly blocks = input.required<readonly Block[]>();
  private readonly config = inject(PUBLIC_WEB_CONFIG);

  protected readonly view = computed<ViewBlock[]>(() => {
    const origin = this.config.appOrigin;
    const part = (value: InlinePart): ViewPart => {
      if (typeof value === 'string') return { kind: 'text', text: value };
      if ('to' in value) return { kind: 'to', path: value.to, text: value.text };
      return { kind: 'app', href: new URL(value.app, origin).toString(), text: value.text };
    };
    let headings = 0;
    return this.blocks().map((block): ViewBlock => {
      switch (block.kind) {
        case 'h2':
          headings += 1;
          return { kind: 'h2', text: block.text, id: sectionId(headings) };
        case 'h3':
          return { kind: 'h3', text: block.text };
        case 'p':
        case 'note':
          return { kind: block.kind, parts: block.parts.map(part) };
        case 'ul':
        case 'ol':
          return { kind: block.kind, items: block.items.map((item) => item.map(part)) };
      }
    });
  });
}
