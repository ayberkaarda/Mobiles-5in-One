import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FACTS } from '../../content/facts';

/**
 * Footer of the public pages: a stretch of road with lane marks, then the name, the tagline and
 * the internal content links.
 */
@Component({
  selector: 'iv-site-footer',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <footer class="foot">
      <div class="road" aria-hidden="true"></div>
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
      margin-top: 4rem;
    }
    .foot {
      background: var(--iv-board);
      color: var(--iv-board-ink);
    }
    .road {
      height: 2.75rem;
      background:
        repeating-linear-gradient(
            90deg,
            rgba(255, 248, 231, 0.55) 0 2.25rem,
            transparent 2.25rem 4.5rem
          )
          center / 100% 4px no-repeat,
        var(--iv-scene-road);
      border-top: 0.6rem solid var(--iv-scene-curb);
    }
    .inner {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-start;
      justify-content: space-between;
      gap: 1rem 2rem;
      max-width: var(--iv-wide);
      margin: 0 auto;
      padding: 1.75rem 1rem 2.5rem;
    }
    .name {
      display: grid;
      justify-items: start;
      gap: 0.35rem;
      margin: 0;
    }
    .word {
      font-family: var(--iv-font-display);
      font-weight: var(--iv-font-display-weight);
      font-size: 1.35rem;
      letter-spacing: 0.04em;
      color: var(--iv-board-sign);
    }
    .line {
      font-size: 0.95rem;
      color: var(--iv-board-muted);
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
      color: var(--iv-board-sign);
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
