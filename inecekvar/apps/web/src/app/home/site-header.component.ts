import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FACTS } from '../../content/facts';

/**
 * Lacivert site bar with the turquoise minibüs stripe, as in the app chrome: the brand mark from
 * brand/logo/inecekvar-mark.svg with the name, and the three main content links.
 */
@Component({
  selector: 'iv-site-header',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a class="skip" href="#icerik">İçeriğe geç</a>
    <header class="bar">
      <div class="inner">
        <a class="brand" routerLink="/" aria-label="İnecek Var ana sayfa">
          <svg class="mark" viewBox="0 0 512 512" aria-hidden="true">
            <rect x="208" y="64" width="96" height="64" rx="20" fill="#F2B705" />
            <rect x="128" y="396" width="48" height="48" rx="12" fill="#FFF8E7" />
            <rect x="336" y="396" width="48" height="48" rx="12" fill="#FFF8E7" />
            <rect x="64" y="104" width="384" height="304" rx="64" fill="#F2B705" />
            <path d="M232 232H280V328H232Z" fill="#14213D" />
            <circle cx="256" cy="180" r="26" fill="none" stroke="#14213D" stroke-width="12" />
            <rect x="96" y="352" width="320" height="20" rx="10" fill="#2AB7CA" />
          </svg>
          <span class="word" aria-hidden="true">{{ wordmark }}</span>
        </a>
        <nav aria-label="Site">
          <a [routerLink]="paths.guides">Rehberler</a>
          <a [routerLink]="paths.faq">SSS</a>
          <a [routerLink]="paths.data">Açık veri</a>
        </nav>
      </div>
    </header>
  `,
  styles: `
    :host {
      display: block;
    }
    .skip {
      position: absolute;
      left: 1rem;
      top: -4rem;
      z-index: 2;
      padding: 0.75rem 1rem;
      border-radius: 0.5rem;
      background: var(--iv-color-dolmus-sarisi);
      color: var(--iv-color-lacivert);
      font-weight: 600;
    }
    .skip:focus {
      top: 0.75rem;
    }
    .bar {
      background: var(--iv-color-lacivert);
      border-bottom: 4px solid var(--iv-color-turkuaz);
      color: var(--iv-color-krem);
    }
    .inner {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem 1.5rem;
      max-width: 68rem;
      margin: 0 auto;
      padding: 0.75rem 1rem;
    }
    a {
      color: inherit;
      text-decoration: none;
      border-radius: 0.5rem;
    }
    a:focus-visible {
      outline: 3px solid var(--iv-color-turkuaz);
      outline-offset: 3px;
    }
    .brand {
      display: inline-flex;
      align-items: center;
      gap: 0.6rem;
      min-height: 48px;
    }
    .mark {
      width: 2.5rem;
      height: 2.5rem;
    }
    .word {
      font-family: var(--iv-font-display);
      font-weight: var(--iv-font-display-weight);
      font-size: 1.25rem;
      letter-spacing: 0.06em;
    }
    nav {
      display: flex;
      flex-wrap: wrap;
      gap: 0.25rem;
    }
    nav a {
      display: inline-flex;
      align-items: center;
      min-height: 44px;
      padding: 0 0.75rem;
      font-weight: 500;
    }
    nav a:hover {
      color: var(--iv-color-dolmus-sarisi);
    }
  `,
})
export class SiteHeaderComponent {
  protected readonly wordmark = FACTS.wordmark;
  protected readonly paths = FACTS.topLevelPaths;
}
