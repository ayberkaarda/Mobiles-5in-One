import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FACTS } from '../../content/facts';
import { HomeData } from '../content/page-data';
import { PageView } from '../content/page-view';
import { CityOut } from '../content/public-types';
import { StatusPageComponent } from '../pages/status-page.component';
import { breadcrumbList, JsonLdNode, organization, webSite } from '../seo/json-ld';
import { PageSeo } from '../seo/seo';
import { HomeGuideComponent } from './home-guide.component';
import { SiteFooterComponent } from './site-footer.component';
import { SiteHeaderComponent } from './site-header.component';

export function homeSeo(): PageSeo {
  return {
    title: null,
    path: '/',
    index: true,
    follow: true,
    description: FACTS.description,
  };
}
export function homeJsonLd(origin: string, name = 'İnecek Var'): JsonLdNode[] {
  return [
    organization(origin, { name, path: '/' }),
    webSite(origin, { name, path: '/' }),
    breadcrumbList(origin, [{ name, path: '/' }]),
  ];
}

/** The city the main call to action opens: the first one with published lines, else the first. */
export function featuredCity(cities: readonly CityOut[]): CityOut | null {
  return cities.find((city) => city.published_line_count > 0) ?? cities[0] ?? null;
}

@Component({
  selector: 'iv-home',
  standalone: true,
  imports: [
    RouterLink,
    StatusPageComponent,
    SiteHeaderComponent,
    SiteFooterComponent,
    HomeGuideComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let page = data();
    @if (page.state === 'ok') {
      <iv-site-header />
      <main id="icerik">
        <div class="hero">
          <div class="copy">
            <p class="kicker">Dolmuş · minibüs · servis</p>
            <h1>İnecek Var</h1>
            <p class="tagline">Dolmuş nereden geçer? <span class="answer">Mahalle bilir.</span></p>
            <p class="lead">{{ description }}</p>
            <div class="ctas">
              @if (featured(page.cities); as city) {
                <a class="btn primary" [routerLink]="['/', city.slug]">
                  {{ city.is_sample ? 'Örnek şehri gez' : 'Hatlara göz at' }}
                  <svg class="arrow" viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M2 8h11M9 4l4 4-4 4" />
                  </svg>
                </a>
              }
              <a class="btn secondary" [href]="appUrl">Uygulamayı aç</a>
            </div>
            <p class="hint">
              Uygulama tarayıcıda açılır ve ana ekrana eklenebilir; şehir paketiyle internetsiz de
              çalışır.
            </p>
          </div>
          <section class="cities" aria-labelledby="cities-title">
            <h2 id="cities-title">Şehirler</h2>
            <ul role="list">
              @for (city of page.cities; track city.slug) {
                <li class="city">
                  <svg class="route" viewBox="0 0 280 56" aria-hidden="true">
                    <path d="M12 40 C60 40 70 14 118 14 S190 42 268 18" />
                    <circle cx="12" cy="40" r="6" />
                    <circle cx="118" cy="14" r="6" />
                    <circle cx="196" cy="32" r="6" />
                    <circle cx="268" cy="18" r="6" />
                  </svg>
                  <a class="city-name" [routerLink]="['/', city.slug]">{{ city.name }}</a>
                  <span class="facts">
                    <span class="count">{{ city.published_line_count }} yayımlanmış hat</span>
                    @if (city.pack_version > 0) {
                      <span class="count">Şehir paketi sürüm {{ city.pack_version }}</span>
                    }
                    @if (city.is_sample) {
                      <span class="badge">örnek veri</span>
                    }
                  </span>
                </li>
              } @empty {
                <li class="city empty">Henüz yayımlanmış bir şehir yok.</li>
              }
            </ul>
          </section>
        </div>
        <iv-home-guide />
      </main>
      <iv-site-footer />
    } @else if (page.state === 'not_found') {
      <iv-status-page kind="not-found" />
    } @else {
      <iv-status-page kind="unavailable" />
    }
  `,
  styles: `
    main {
      display: block;
    }
    .hero {
      display: grid;
      gap: 2rem;
      max-width: 68rem;
      margin: 0 auto;
      padding: 2.5rem 1rem 3rem;
    }
    @media (min-width: 52rem) {
      .hero {
        grid-template-columns: 1.15fr 1fr;
        align-items: center;
        gap: 3rem;
        padding-top: 2.25rem;
      }
    }
    .kicker {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin: 0 0 0.75rem;
      font-size: 0.8rem;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .kicker::before {
      content: '';
      width: 1.5rem;
      height: 0.3rem;
      border-radius: 0.2rem;
      background: var(--iv-color-turkuaz);
    }
    h1 {
      margin: 0;
      font-size: clamp(2.5rem, 7vw, 3.75rem);
      line-height: 1;
      letter-spacing: -0.02em;
    }
    .tagline {
      margin: 0.75rem 0 0;
      font-family: var(--iv-font-display);
      font-weight: var(--iv-font-display-weight);
      font-size: clamp(1.4rem, 3.6vw, 1.9rem);
      line-height: 1.2;
    }
    .answer {
      display: block;
      width: fit-content;
      text-decoration: underline;
      text-decoration-color: var(--iv-color-dolmus-sarisi);
      text-decoration-thickness: 0.28em;
      text-underline-offset: 0.05em;
      text-decoration-skip-ink: none;
    }
    .lead {
      max-width: 34rem;
      margin: 1rem 0 0;
      font-size: 1.075rem;
      line-height: 1.6;
    }
    .ctas {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
      margin-top: 1.75rem;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      min-height: 48px;
      padding: 0 1.4rem;
      border-radius: 0.875rem;
      font-weight: 600;
      text-decoration: none;
      color: var(--iv-color-lacivert);
    }
    .primary {
      background: var(--iv-color-dolmus-sarisi);
      box-shadow: 0 4px 0 var(--iv-color-lacivert);
    }
    .arrow {
      width: 1rem;
      height: 1rem;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .secondary {
      background: #fff;
      box-shadow: inset 0 0 0 2px var(--iv-color-lacivert);
    }
    .btn:focus-visible,
    .city-name:focus-visible {
      outline: 3px solid var(--iv-color-turkuaz);
      outline-offset: 3px;
    }
    .hint {
      max-width: 30rem;
      margin: 1rem 0 0;
      font-size: 0.9rem;
      line-height: 1.5;
      color: #4f5866;
    }
    .cities h2 {
      margin: 0 0 0.75rem;
      font-size: 1.1rem;
    }
    ul {
      display: grid;
      gap: 1rem;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .city {
      display: grid;
      gap: 0.6rem;
      padding: 1.25rem;
      background: #fff;
      border: 1px solid rgba(20, 33, 61, 0.14);
      border-top: 6px solid var(--iv-color-dolmus-sarisi);
      border-radius: 1.25rem;
      box-shadow: 0 6px 0 rgba(20, 33, 61, 0.14);
    }
    .route {
      width: 100%;
      height: auto;
      padding: 0.5rem;
      box-sizing: border-box;
      border-radius: 0.75rem;
      background: #f6ecd2;
    }
    .route path {
      fill: none;
      stroke: var(--iv-color-turkuaz);
      stroke-width: 5;
      stroke-linecap: round;
    }
    .route circle {
      fill: var(--iv-color-krem);
      stroke: var(--iv-color-lacivert);
      stroke-width: 2.5;
    }
    .city-name {
      font-family: var(--iv-font-display);
      font-weight: var(--iv-font-display-weight);
      font-size: 1.35rem;
      color: var(--iv-color-lacivert);
      text-underline-offset: 0.2em;
      border-radius: 0.25rem;
    }
    .facts {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.5rem 0.75rem;
    }
    .badge {
      padding: 0.2rem 0.6rem;
      border-radius: 999px;
      background: var(--iv-color-lacivert);
      color: var(--iv-color-krem);
      font-size: 0.8rem;
      font-weight: 600;
    }
  `,
})
export class Home extends PageView<HomeData> {
  protected readonly description = FACTS.description;
  protected readonly appUrl = this.config.appOrigin + '/';
  protected readonly featured = featuredCity;

  constructor() {
    super();
    this.connect(homeSeo, (origin) => homeJsonLd(origin));
  }
}
