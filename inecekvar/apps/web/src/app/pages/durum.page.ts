import { ChangeDetectionStrategy, Component, inject, OnInit } from '@angular/core';
import { ActivatedRoute, ResolveFn, RouterLink } from '@angular/router';
import { HealthStatus, isHealthStatus } from '@inecekvar/domain';
import { PublicApiClient, PublicApiResult } from '../data/public-api.client';
import { SeoService } from '../seo/seo.service';
import { StatusPageComponent } from './status-page.component';

export const durumResolver: ResolveFn<PublicApiResult<HealthStatus>> = () =>
  inject(PublicApiClient).get('/health', undefined, isHealthStatus);

@Component({
  selector: 'iv-durum-page',
  standalone: true,
  imports: [RouterLink, StatusPageComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (health.ok) {
      <main class="service-status">
        <h1>Hizmet çalışıyor</h1>
        <p>İnecek Var hizmetine erişilebiliyor.</p>
        <a routerLink="/">Ana sayfaya dön</a>
      </main>
    } @else {
      <iv-status-page kind="unavailable" />
    }
  `,
  styles: `
    .service-status {
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
export class DurumPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  protected readonly health = this.route.snapshot.data['health'] as PublicApiResult<HealthStatus>;
  private readonly seo = inject(SeoService);

  ngOnInit(): void {
    this.seo.apply({
      title: 'Hizmet durumu',
      description: 'İnecek Var hizmetinin güncel erişim durumu.',
      path: '/durum',
      index: false,
      follow: false,
    });
  }
}
