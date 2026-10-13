import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FACTS } from '../../content/facts';

/** Footer of the home page: the name, the tagline and the internal content links. */
@Component({
  selector: 'iv-site-footer',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <footer class="foot">
      <div class="inner">
        <p class="name">
          <span class="word">{{ name }}</span>
          <span class="line">{{ tagline }}</span>
        </p>
        <nav aria-label="Alt bağlantılar">
          <ul role="list">
            @for (link of links; track link.path) {
              <li>
                <a [routerLink]="link.path">{{ link.text }}</a>
              </li>
            }
          </ul>
        </nav>
      </div>
    </footer>
  `,
  styles: `
    :host {
      display: block;
    }
    .foot {
      background: var(--iv-color-lacivert);
      border-top: 4px solid var(--iv-color-dolmus-sarisi);
      color: var(--iv-color-krem);
    }
    .inner {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-start;
      justify-content: space-between;
      gap: 1rem 2rem;
      max-width: 68rem;
      margin: 0 auto;
      padding: 1.75rem 1rem 2rem;
    }
    .name {
      display: grid;
      gap: 0.25rem;
      margin: 0;
    }
    .word {
      font-family: var(--iv-font-display);
      font-weight: var(--iv-font-display-weight);
      font-size: 1.125rem;
    }
    .line {
      font-size: 0.9rem;
    }
    ul {
      display: flex;
      flex-wrap: wrap;
      gap: 0.25rem 0.5rem;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    a {
      display: inline-flex;
      align-items: center;
      min-height: 44px;
      padding: 0 0.5rem;
      color: inherit;
      text-underline-offset: 0.25em;
      border-radius: 0.5rem;
    }
    a:hover {
      color: var(--iv-color-dolmus-sarisi);
    }
    a:focus-visible {
      outline: 3px solid var(--iv-color-turkuaz);
      outline-offset: 2px;
    }
  `,
})
export class SiteFooterComponent {
  protected readonly name = FACTS.name;
  protected readonly tagline = FACTS.tagline;
  protected readonly links = [
    { path: FACTS.topLevelPaths.guides, text: 'Rehberler' },
    { path: FACTS.topLevelPaths.faq, text: 'Sıkça sorulan sorular' },
    { path: FACTS.topLevelPaths.data, text: 'Açık veri' },
    { path: FACTS.topLevelPaths.about, text: 'Hakkında' },
    { path: FACTS.topLevelPaths.privacy, text: 'Gizlilik' },
  ] as const;
}
