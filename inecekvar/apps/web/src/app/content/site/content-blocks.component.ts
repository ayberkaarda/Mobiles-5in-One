import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Block, InlinePart } from '../../../content/blocks';
import { PUBLIC_WEB_CONFIG } from '../../public-config';

type ViewPart =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'to'; readonly path: string; readonly text: string }
  | { readonly kind: 'app'; readonly href: string; readonly text: string };

type ViewBlock =
  | { readonly kind: 'h2' | 'h3'; readonly text: string }
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
          <h2>{{ block.text }}</h2>
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
      margin: 2rem 0 0.5rem;
      font-size: 1.35rem;
    }
    p,
    li {
      line-height: 1.6;
    }
    li {
      padding: 0.2rem 0;
    }
    .note {
      border-left: 0.25rem solid var(--iv-color-dolmus-sarisi);
      padding: 0.75rem;
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
    return this.blocks().map((block): ViewBlock => {
      switch (block.kind) {
        case 'h2':
        case 'h3':
          return { kind: block.kind, text: block.text };
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
