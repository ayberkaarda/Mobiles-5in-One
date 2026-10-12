import { ChangeDetectionStrategy, Component, inject, input, OnInit } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { PageStatus } from '../data/page-status';
import { assertPublicPath } from '../public-path';
import { SeoService } from '../seo/seo.service';

@Component({
  selector: 'iv-status-page',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="status-page">
      <h1>{{ heading }}</h1>
      <p>{{ description }}</p>
      <a routerLink="/">Ana sayfaya dön</a>
    </main>
  `,
  styles: `
    .status-page {
      max-width: 40rem;
      margin: 0 auto;
      padding: 2rem 1rem;
    }
    a {
      display: inline-block;
      padding: 0.75rem 0;
      text-underline-offset: 0.2em;
    }
    a:focus-visible {
      outline: 2px solid currentColor;
      outline-offset: 4px;
    }
  `,
})
export class StatusPageComponent implements OnInit {
  readonly kind = input.required<'not-found' | 'unavailable'>();
  private readonly status = inject(PageStatus);
  private readonly seo = inject(SeoService);
  private readonly router = inject(Router);

  get heading(): string {
    return this.kind() === 'not-found' ? 'Sayfa bulunamadı' : 'Şu anda yanıt veremiyoruz';
  }

  get description(): string {
    return this.kind() === 'not-found'
      ? 'Aradığınız sayfa taşınmış olabilir veya bu adreste bulunmuyor.'
      : 'Hizmete şu anda ulaşılamıyor. Lütfen kısa bir süre sonra yeniden deneyin.';
  }

  ngOnInit(): void {
    if (this.kind() === 'not-found') {
      this.status.notFound();
    } else {
      this.status.unavailable();
    }
    this.seo.apply({
      title: this.heading,
      description: this.description,
      path: this.currentPath(),
      index: false,
      follow: false,
    });
  }

  private currentPath(): string {
    const navigation = this.router.currentNavigation();
    const url = navigation?.finalUrl
      ? this.router.serializeUrl(navigation.finalUrl)
      : this.router.url;
    const path = url.split(/[?#]/)[0] ?? '/';
    try {
      assertPublicPath(path);
      return path;
    } catch {
      return '/';
    }
  }
}
