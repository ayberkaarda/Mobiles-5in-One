import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { exportUrlTemplate, FACTS } from '../../../content/facts';
import { DeletionSlot } from '../../deletion-entry';
import { GUIDES } from '../../../content/guides';
import { StatusPageComponent } from '../../pages/status-page.component';
import { formatTurkishDate } from '../format';
import { PageView } from '../page-view';
import { blockToc, ContentBlocksComponent } from './content-blocks.component';
import { contentJsonLd, contentSeo } from './content-seo';
import { ContentData } from './content-view';
import { SiteFooterComponent } from '../../home/site-footer.component';
import { SiteHeaderComponent } from '../../home/site-header.component';

@Component({
  selector: 'iv-content-page',
  standalone: true,
  imports: [
    RouterLink,
    StatusPageComponent,
    ContentBlocksComponent,
    DeletionSlot,
    SiteHeaderComponent,
    SiteFooterComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let page = data();
    @if (page.state === 'ok') {
      @let view = page.content;
      <iv-site-header />
      <main id="icerik" class="iv-wrap">
        <article [class.guide]="view.kind === 'guide'">
          <div class="head">
            @if (view.kind === 'guide') {
              <p class="iv-crumbs">
                <a [routerLink]="guidesPath">Rehberler</a>
              </p>
            }
            <h1>{{ view.h1 }}</h1>
            @if (view.status) {
              <p class="status" role="note">{{ view.status }}</p>
            }
            <p class="meta">Son güncelleme: {{ updated(view.dateModified) }}</p>
          </div>
          <div class="columns">
            @if (toc(view.blocks); as entries) {
              @if (view.kind === 'guide' && entries.length > 2) {
                <nav class="toc" aria-label="İçindekiler">
                  <p class="toc-title">İçindekiler</p>
                  <ol>
                    @for (entry of entries; track entry.id) {
                      <li>
                        <a [href]="'#' + entry.id">{{ entry.text }}</a>
                      </li>
                    }
                  </ol>
                </nav>
              }
            }
            <div class="body">
              <iv-content-blocks [blocks]="view.blocks" />
              @if (view.path === deletionPath) {
                <iv-deletion-slot />
              }
              @if (view.faq; as items) {
                @for (item of items; track $index) {
                  <section class="faq">
                    <h2>{{ item.question }}</h2>
                    <p>{{ item.answer }}</p>
                  </section>
                }
              }
              @if (view.kind === 'index') {
                <ul class="guides" role="list">
                  @for (guide of guides; track guide.slug; let i = $index) {
                    <li>
                      <span class="stop" aria-hidden="true">{{ i + 1 }}</span>
                      <a [routerLink]="guide.path">{{ guide.h1 }}</a>
                      <span class="summary">{{ guide.description }}</span>
                    </li>
                  }
                </ul>
              }
              @if (view.showExport) {
                <section>
                  <h2>Dışa aktarım adresi</h2>
                  <p>
                    Bir şehrin son dışa aktarımı şu adreste yayımlanır;
                    <em>{{ '{sehir}' }}</em> yerine şehir adresini yaz:
                  </p>
                  <p>
                    <code>{{ exportTemplate }}</code>
                  </p>
                  <p>
                    Şehir adreslerini
                    <a routerLink="/">ana sayfadaki şehir listesinde</a> bulabilirsin.
                  </p>
                </section>
              }
            </div>
          </div>
        </article>
      </main>
      <iv-site-footer />
    } @else if (page.state === 'not_found') {
      <iv-status-page kind="not-found" />
    } @else {
      <iv-status-page kind="unavailable" />
    }
  `,
  styles: `
    article {
      padding-top: 1rem;
    }
    .head {
      max-width: 52rem;
      padding: 1.5rem 0 1.75rem;
      border-bottom: 4px solid var(--iv-ink);
      box-shadow: 0 6px 0 var(--iv-accent);
      margin-bottom: 2.5rem;
    }
    h1 {
      margin: 0;
      font-size: clamp(2rem, 5.5vw, 3.4rem);
      line-height: 1.04;
      letter-spacing: -0.03em;
    }
    .status {
      display: inline-block;
      margin: 1rem 0 0;
      padding: 0.6rem 0.9rem;
      border-radius: 0.6rem;
      background: var(--iv-board);
      color: var(--iv-board-sign);
      font-weight: 600;
    }
    .meta {
      margin: 0.75rem 0 0;
      color: var(--iv-ink-muted);
      font-size: 0.92rem;
    }
    .columns {
      display: grid;
      gap: 2rem;
    }
    @media (min-width: 62rem) {
      .guide .columns {
        grid-template-columns: 15rem minmax(0, 1fr);
        gap: 3.5rem;
      }
      .toc {
        position: sticky;
        top: 1.5rem;
        align-self: start;
      }
    }
    .toc {
      padding: 1rem 1.1rem;
      border-radius: 1rem;
      background: var(--iv-surface);
      border: 1px solid var(--iv-line);
      font-size: 0.95rem;
    }
    .toc-title {
      margin: 0 0 0.5rem;
      font-family: var(--iv-font-display);
      font-weight: 700;
    }
    .toc ol {
      margin: 0;
      padding-left: 1.25rem;
      display: grid;
      gap: 0.4rem;
    }
    .toc a {
      color: var(--iv-ink);
      text-decoration-color: var(--iv-stripe);
    }
    .body {
      max-width: var(--iv-measure);
      font-size: 1.1rem;
      line-height: 1.7;
    }
    .faq {
      padding: 1.25rem 0;
      border-bottom: 1px solid var(--iv-line);
    }
    .faq h2 {
      margin: 0 0 0.4rem;
      font-size: 1.25rem;
      line-height: 1.3;
    }
    .faq p {
      margin: 0;
    }
    .guides {
      display: grid;
      gap: 0.85rem;
      margin: 1.5rem 0 0;
      padding: 0;
      list-style: none;
    }
    .guides li {
      position: relative;
      display: grid;
      gap: 0.3rem;
      padding: 1.1rem 1.25rem 1.1rem 4.25rem;
      border-radius: 1rem;
      background: var(--iv-surface);
      border: 1px solid var(--iv-line);
      box-shadow: var(--iv-shadow-hard);
    }
    .stop {
      position: absolute;
      left: 1.1rem;
      top: 1.05rem;
      display: grid;
      place-items: center;
      width: 2.1rem;
      height: 2.1rem;
      box-sizing: border-box;
      border-radius: 50%;
      background: var(--iv-plate);
      border: 3px solid var(--iv-rail-casing);
      color: var(--iv-plate-ink);
      font-family: var(--iv-font-display);
      font-weight: 700;
      font-size: 0.95rem;
    }
    .guides a {
      font-family: var(--iv-font-display);
      font-weight: 700;
      font-size: 1.2rem;
      line-height: 1.25;
    }
    .summary {
      color: var(--iv-ink-muted);
      font-size: 0.98rem;
    }
    code {
      overflow-wrap: anywhere;
      padding: 0.15rem 0.35rem;
      border-radius: 0.3rem;
      background: var(--iv-surface-sunk);
    }
  `,
})
export class ContentPage extends PageView<ContentData> {
  protected readonly guides = GUIDES;
  protected readonly guidesPath = FACTS.topLevelPaths.guides;
  protected readonly toc = blockToc;
  protected readonly deletionPath = FACTS.topLevelPaths.deletion;
  protected readonly exportTemplate = exportUrlTemplate(this.config.apiPublicBaseUrl);
  protected readonly updated = (date: string): string => formatTurkishDate(`${date}T12:00:00Z`);

  constructor() {
    super();
    this.connect(
      (value) => contentSeo(value.content),
      (origin, value) => contentJsonLd(origin, value.content),
    );
  }
}
