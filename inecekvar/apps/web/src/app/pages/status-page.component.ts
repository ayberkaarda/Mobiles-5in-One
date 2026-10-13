import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  input,
  OnInit,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter } from 'rxjs';
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
      <svg class="art" viewBox="0 0 120 96" aria-hidden="true" focusable="false">
        <rect class="road" x="8" y="86" width="104" height="4" rx="2" />
        <g transform="rotate(-14 60 88)">
          <rect class="pole" x="57" y="34" width="6" height="54" rx="2" />
          <circle class="sign" cx="60" cy="30" r="22" />
          <circle class="ring" cx="60" cy="30" r="10" />
          <rect class="stripe" x="44" y="44" width="32" height="5" rx="2.5" />
        </g>
      </svg>
      <h1>{{ heading }}</h1>
      <p>{{ description }}</p>
      <a routerLink="/">Ana sayfaya dön</a>
    </main>
  `,
  styles: `
    .status-page {
      max-width: 40rem;
      margin: 0 auto;
      padding: 4rem 1rem;
      text-align: center;
    }
    .art {
      width: 8rem;
      height: 6.5rem;
    }
    .road {
      fill: var(--iv-line-strong);
    }
    .pole {
      fill: var(--iv-ink-muted);
    }
    .sign {
      fill: var(--iv-accent);
      stroke: var(--iv-ink);
      stroke-width: 3;
    }
    .ring {
      fill: none;
      stroke: #14213d;
      stroke-width: 4;
    }
    .stripe {
      fill: var(--iv-stripe);
    }
    h1 {
      margin: 1rem 0 0.5rem;
      font-size: clamp(2rem, 6vw, 3rem);
      line-height: 1.05;
      letter-spacing: -0.025em;
    }
    p {
      margin: 0 auto;
      max-width: 34ch;
      color: var(--iv-ink-muted);
    }
    a {
      display: inline-flex;
      align-items: center;
      min-height: 48px;
      margin-top: 1.5rem;
      padding: 0 1.35rem;
      border-radius: 0.875rem;
      background: var(--iv-accent);
      color: var(--iv-accent-ink);
      font-weight: 650;
      text-decoration: none;
      box-shadow: 0 4px 0 var(--iv-board-edge);
    }
    a:focus-visible {
      outline: 3px solid var(--iv-stripe);
      outline-offset: 3px;
    }
  `,
})
export class StatusPageComponent implements OnInit {
  readonly kind = input.required<'not-found' | 'unavailable'>();
  private readonly status = inject(PageStatus);
  private readonly seo = inject(SeoService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  get heading(): string {
    return this.kind() === 'not-found' ? 'Sayfa bulunamadı' : 'Şu anda yanıt veremiyoruz';
  }

  get description(): string {
    return this.kind() === 'not-found'
      ? 'Aradığınız sayfa taşınmış olabilir veya bu adreste bulunmuyor.'
      : 'Hizmete şu anda ulaşılamıyor. Lütfen kısa bir süre sonra yeniden deneyin.';
  }

  ngOnInit(): void {
    this.applyStatus();
    this.router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => this.applyStatus());
  }

  private applyStatus(): void {
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
