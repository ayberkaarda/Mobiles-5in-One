import { ChangeDetectionStrategy, Component, inject, OnDestroy, OnInit } from '@angular/core';
import { PUBLIC_WEB_CONFIG } from '../public-config';
import { organization, webSite } from '../seo/json-ld';
import { JsonLdService } from '../seo/json-ld.service';
import { SeoService } from '../seo/seo.service';

@Component({
  selector: 'iv-home',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="home">
      <h1>İnecek Var</h1>
      <p class="tagline">Dolmuş nereden geçer? Mahalle bilir.</p>
      <p>
        Resmî verisi olmayan dolmuş, minibüs ve servis hatlarını mahallelinin birlikte haritaladığı,
        çevrimdışı da çalışan hat rehberi.
      </p>
    </main>
  `,
  styles: `
    .home {
      max-width: 40rem;
      margin: 0 auto;
      padding: 2rem 1rem;
    }
    .tagline {
      font-family: var(--iv-font-display);
      font-weight: var(--iv-font-display-weight);
      font-size: 1.25rem;
    }
  `,
})
export class Home implements OnInit, OnDestroy {
  private readonly config = inject(PUBLIC_WEB_CONFIG);
  private readonly seo = inject(SeoService);
  private readonly jsonLd = inject(JsonLdService);

  ngOnInit(): void {
    this.seo.apply({
      title: null,
      description:
        'Dolmuş, minibüs ve servis hatları için mahallelinin birlikte haritaladığı, ' +
        'çevrimdışı da çalışan hat rehberi.',
      path: '/',
      index: true,
      follow: true,
    });
    this.jsonLd.set('site', [
      organization(this.config.canonicalOrigin),
      webSite(this.config.canonicalOrigin),
    ]);
  }

  ngOnDestroy(): void {
    this.jsonLd.clear('site');
  }
}
