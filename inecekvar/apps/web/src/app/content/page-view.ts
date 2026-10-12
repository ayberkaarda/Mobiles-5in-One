import { DestroyRef, Directive, inject, OnDestroy, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { PageStatus } from '../data/page-status';
import { PUBLIC_WEB_CONFIG } from '../public-config';
import { JsonLdNode } from '../seo/json-ld';
import { JsonLdService } from '../seo/json-ld.service';
import { PageSeo } from '../seo/seo';
import { SeoService } from '../seo/seo.service';
import { PageData } from './page-data';

@Directive()
export abstract class PageView<T> implements OnDestroy {
  protected readonly config = inject(PUBLIC_WEB_CONFIG);
  protected readonly data = signal<PageData<T>>({ state: 'not_found' });
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly status = inject(PageStatus);
  private readonly seo = inject(SeoService);
  private readonly jsonLd = inject(JsonLdService);

  protected connect(
    seo: (value: T) => PageSeo,
    nodes: (origin: string, value: T) => JsonLdNode[],
  ): void {
    this.route.data.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((resolved) => {
      const value = resolved['page'] as PageData<T>;
      this.jsonLd.clear('content');
      this.data.set(value);
      if (value.state === 'ok') {
        this.seo.apply(seo(value));
        this.jsonLd.set('content', nodes(this.config.canonicalOrigin, value));
      } else if (value.state === 'not_found') {
        this.status.notFound();
      } else {
        this.status.unavailable();
      }
    });
  }

  ngOnDestroy(): void {
    this.jsonLd.clear('content');
  }
}
