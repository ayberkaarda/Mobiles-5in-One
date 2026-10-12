import { DOCUMENT } from '@angular/common';
import { inject, Injectable, RendererFactory2 } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { PUBLIC_WEB_CONFIG } from '../public-config';
import { BRAND, clampText, DESCRIPTION_MAX, PageSeo, pagePath, pageTitle, siteUrl } from './seo';

@Injectable({ providedIn: 'root' })
export class SeoService {
  private readonly document = inject(DOCUMENT);
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);
  private readonly renderer = inject(RendererFactory2).createRenderer(null, null);
  private readonly config = inject(PUBLIC_WEB_CONFIG);
  private readonly initialTitle = this.title.getTitle();

  apply(seo: PageSeo): void {
    // Validate every path before changing the current page metadata.
    const pagedUrl = (path: string, page?: number) => {
      siteUrl(this.config.canonicalOrigin, path);
      return this.config.canonicalOrigin + pagePath(path, page);
    };
    const canonical = pagedUrl(seo.path, seo.page);
    const english =
      seo.alternates?.en === undefined ? undefined : pagedUrl(seo.alternates.en, seo.page);
    const previous = seo.pagination?.prevPage;
    const next = seo.pagination?.nextPage;
    const previousUrl = previous == null ? null : pagedUrl(seo.path, previous);
    const nextUrl = next == null ? null : pagedUrl(seo.path, next);
    const image =
      seo.ogImagePath === undefined
        ? undefined
        : siteUrl(this.config.canonicalOrigin, seo.ogImagePath);
    const title = pageTitle(seo.title);
    const description = clampText(seo.description, DESCRIPTION_MAX);
    const index = seo.index ?? true;
    const follow = seo.follow ?? true;
    this.reset();
    this.title.setTitle(title);
    const titleElement = this.document.head.querySelector('title');
    if (titleElement) {
      this.renderer.setAttribute(titleElement, 'data-iv-seo', '');
    }
    this.setMeta('name', 'description', description);
    this.setMeta(
      'name',
      'robots',
      `${index ? 'index' : 'noindex'},${follow ? 'follow' : 'nofollow'}` +
        (index ? ',max-image-preview:large' : ''),
    );
    this.setLink('canonical', canonical);
    if (previousUrl) this.setLink('prev', previousUrl);
    if (nextUrl) this.setLink('next', nextUrl);
    this.setLink('alternate', canonical, 'tr-TR');
    this.setLink('alternate', canonical, 'x-default');
    if (english) {
      this.setLink('alternate', english, 'en');
    }
    for (const [name, value] of Object.entries({
      'og:title': title,
      'og:description': description,
      'og:url': canonical,
      'og:type': seo.ogType ?? 'website',
      'og:site_name': BRAND,
      'og:locale': 'tr_TR',
      ...(image ? { 'og:image': image } : {}),
    })) {
      this.setMeta('property', name, value);
    }
    this.setMeta('name', 'twitter:card', image ? 'summary_large_image' : 'summary');
    this.setMeta('name', 'twitter:title', title);
    this.setMeta('name', 'twitter:description', description);
    if (seo.appBanner && this.config.appStoreId) {
      this.setMeta(
        'name',
        'apple-itunes-app',
        `app-id=${this.config.appStoreId}, app-argument=${canonical}`,
      );
    }
  }

  reset(): void {
    for (const element of this.document.head.querySelectorAll('[data-iv-seo]')) {
      if (element.tagName.toLowerCase() === 'title') {
        this.renderer.removeAttribute(element, 'data-iv-seo');
      } else {
        this.renderer.removeChild(this.document.head, element);
      }
    }
    this.title.setTitle(this.initialTitle);
  }

  private setMeta(attribute: 'name' | 'property', name: string, content: string): void {
    for (const element of this.meta.getTags(`${attribute}="${name}"`)) {
      this.meta.removeTagElement(element);
    }
    const element = this.renderer.createElement('meta');
    this.renderer.setAttribute(element, attribute, name);
    this.renderer.setAttribute(element, 'content', content);
    this.renderer.setAttribute(element, 'data-iv-seo', '');
    this.renderer.appendChild(this.document.head, element);
  }

  private setLink(rel: string, href: string, language?: string): void {
    const selector = language ? `link[rel="${rel}"][hreflang="${language}"]` : `link[rel="${rel}"]`;
    for (const element of this.document.head.querySelectorAll(selector)) {
      this.renderer.removeChild(this.document.head, element);
    }
    const element = this.renderer.createElement('link');
    this.renderer.setAttribute(element, 'rel', rel);
    this.renderer.setAttribute(element, 'href', href);
    this.renderer.setAttribute(element, 'data-iv-seo', '');
    if (language) {
      this.renderer.setAttribute(element, 'hreflang', language);
    }
    this.renderer.appendChild(this.document.head, element);
  }
}
