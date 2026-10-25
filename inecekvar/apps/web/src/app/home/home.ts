import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FACTS } from '../../content/facts';
import { HomeData } from '../content/page-data';
import { PageView } from '../content/page-view';
import { CityOut } from '../content/public-types';
import { StatusPageComponent } from '../pages/status-page.component';
import { breadcrumbList, JsonLdNode, organization, webSite } from '../seo/json-ld';
import { PageSeo } from '../seo/seo';
import { CitySceneComponent, PLACARD_STYLES, SIGN_TEXT_STYLES } from '@inecekvar/ui';
import { RouteSearchComponent } from './route-search.component';
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

/** Plate letters for a city card: the first letters of its first two words, [ÖRNEK] skipped. */
export function cityInitials(name: string): string {
  const words = name
    .replace(/\[[^\]]*\]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 0);
  const letters = words.slice(0, 2).map((word) => Array.from(word)[0] ?? '');
  return letters.join('').toLocaleUpperCase('tr-TR') || '·';
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
    RouteSearchComponent,
    CitySceneComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let page = data();
    @if (page.state === 'ok') {
      <iv-site-header />
      <main id="icerik">
        <div class="hero">
          <div class="iv-wrap hero-grid">
            <div class="copy">
              <h1 class="title">İnecek Var</h1>
              <p class="lead">{{ description }}</p>
              <p class="tagline">
                <span class="row iv-flip">Dolmuş nereden geçer? </span
                ><span class="row answer iv-flip iv-flip--1">Mahalle bilir.</span>
              </p>
              <div class="ctas">
                @if (featured(page.cities); as city) {
                  <a class="btn primary iv-cta" [routerLink]="['/', city.slug]">
                    {{ city.is_sample ? 'Örnek şehri gez' : 'Hatlara göz at' }}
                  </a>
                }
                <a class="btn secondary iv-cta iv-cta--ghost" [href]="appUrl">Uygulamayı aç</a>
              </div>
              <p class="hint">
                Uygulama tarayıcıda açılır ve ana ekrana eklenebilir; şehir paketiyle internetsiz de
                çalışır.
              </p>
            </div>
            <div class="windshield">
              <span class="strap left" aria-hidden="true"></span>
              <span class="strap right" aria-hidden="true"></span>

              <iv-route-search [cities]="page.cities" />
            </div>
          </div>
          <div class="street">
            <iv-city-scene class="scene" />
          </div>
        </div>
        <section class="iv-wrap cities" aria-labelledby="cities-title">
          <h2 id="cities-title" class="iv-section-head">Şehirler</h2>
          <ul role="list">
            @for (city of page.cities; track city.slug) {
              <li class="city">
                <span class="plate iv-placard" aria-hidden="true">{{ initials(city.name) }}</span>
                <span class="city-body">
                  <a class="city-name" [routerLink]="['/', city.slug]">{{ city.name }}</a>
                  <span class="facts">
                    <span class="count">{{ city.published_line_count }} yayımlanmış hat</span>
                    @if (city.pack_version > 0) {
                      <span class="count">Şehir paketi sürüm {{ city.pack_version }}</span>
                    }
                    @if (city.is_sample) {
                      <span class="badge iv-tape">örnek veri</span>
                    }
                  </span>
                </span>
              </li>
            } @empty {
              <li class="city empty">Henüz yayımlanmış bir şehir yok.</li>
            }
          </ul>
        </section>
        <iv-home-guide />
      </main>
      <iv-site-footer />
    } @else if (page.state === 'not_found') {
      <iv-status-page kind="not-found" />
    } @else {
      <iv-status-page kind="unavailable" />
    }
  `,
  styles: [
    PLACARD_STYLES,
    SIGN_TEXT_STYLES,
    `
      main {
        display: block;
      }
      .hero {
        overflow: hidden;
        padding-top: clamp(2rem, 5vw, 3.5rem);
        background: var(--iv-bg);
      }
      .hero-grid {
        display: grid;
        gap: 2rem;
        align-items: center;
      }
      @media (min-width: 56rem) {
        .hero-grid {
          grid-template-columns: 1.1fr 1fr;
          gap: 3rem;
        }
      }
      .title {
        margin: 0;
        font-size: clamp(3.25rem, 11vw, 6.25rem);
        line-height: 0.92;
        letter-spacing: -0.045em;
        color: var(--iv-ink);
      }
      .lead {
        max-width: 33rem;
        margin: 1.25rem 0 0;
        font-size: 1.15rem;
        line-height: 1.55;
      }
      .ctas {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
        margin-top: 1.75rem;
      }
      .hint {
        max-width: 30rem;
        margin: 1rem 0 0;
        font-size: 0.92rem;
        line-height: 1.5;
        color: var(--iv-ink-muted);
      }
      .windshield {
        position: relative;
        padding-top: 2.25rem;
      }
      .strap {
        position: absolute;
        top: 0;
        width: 0.5rem;
        height: 2.6rem;
        border-radius: 0.25rem;
        background: var(--iv-ink-muted);
      }
      .left {
        left: 18%;
      }
      .right {
        right: 18%;
      }
      .tagline {
        display: grid;
        gap: 0.4rem;
        margin: 0;
        padding: 1rem 0 0;
        border-radius: 1.25rem;
        font-family: var(--iv-font-display);
        font-weight: var(--iv-font-display-weight);
        font-size: 1rem;
        line-height: 1.08;
        letter-spacing: -0.01em;
        color: var(--iv-board-ink);
      }
      .answer {
        color: var(--iv-board-sign);
        text-shadow: var(--iv-board-glow);
      }
      /* The road of the scene runs on across the full width of the page. */
      .street {
        --scene-w: min(64rem, calc(100vw - 2rem));
        position: relative;
        margin-top: 1.5rem;
      }
      .street::before {
        content: '';
        position: absolute;
        left: 0;
        right: 0;
        bottom: 0;
        height: calc(var(--scene-w) * 0.0584);
        border-top: calc(var(--scene-w) * 0.0167) solid var(--iv-scene-curb);
        background: var(--iv-scene-road);
      }
      .scene {
        position: relative;
        max-width: 64rem;
        margin: 0 auto;
        padding: 0 1rem;
      }
      .cities {
        padding-top: 3rem;
      }
      ul {
        display: grid;
        gap: 1rem;
        margin: 0;
        padding: 0;
        list-style: none;
      }
      @media (min-width: 48rem) {
        ul {
          grid-template-columns: repeat(2, 1fr);
        }
      }
      .city {
        background: var(--iv-surface);
        border-bottom: 1px solid var(--iv-line);
        color: var(--iv-ink);
        display: flex;
        align-items: flex-start;
        gap: 1rem;
        padding: 1.25rem 1.25rem 1.6rem;
      }
      .city-body {
        display: grid;
        gap: 0.5rem;
        min-width: 0;
      }
      .city-name {
        font-family: var(--iv-font-display);
        font-weight: var(--iv-font-display-weight);
        font-size: 1.45rem;
        line-height: 1.15;
        color: var(--iv-board-ink);
      }
      .facts {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0.5rem 0.9rem;
        color: var(--iv-board-muted);
        font-size: 0.95rem;
      }
      .empty {
        padding: 1.25rem;
      }
    `,
  ],
})
export class Home extends PageView<HomeData> {
  protected readonly description = FACTS.description;
  protected readonly appUrl = this.config.appOrigin + '/';
  protected readonly featured = featuredCity;
  protected readonly initials = cityInitials;

  constructor() {
    super();
    this.connect(homeSeo, (origin) => homeJsonLd(origin));
  }
}
