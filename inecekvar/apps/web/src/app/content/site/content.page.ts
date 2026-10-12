import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { exportUrlTemplate } from '../../../content/facts';
import { GUIDES } from '../../../content/guides';
import { StatusPageComponent } from '../../pages/status-page.component';
import { formatTurkishDate } from '../format';
import { PageView } from '../page-view';
import { ContentBlocksComponent } from './content-blocks.component';
import { contentJsonLd, contentSeo } from './content-seo';
import { ContentData } from './content-view';

@Component({
  selector: 'iv-content-page',
  standalone: true,
  imports: [RouterLink, StatusPageComponent, ContentBlocksComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let page = data();
    @if (page.state === 'ok') {
      @let view = page.content;
      <main>
        <article>
          <h1>{{ view.h1 }}</h1>
          @if (view.status) {
            <p class="status" role="note">{{ view.status }}</p>
          }
          <p class="meta">Son güncelleme: {{ updated(view.dateModified) }}</p>
          <iv-content-blocks [blocks]="view.blocks" />
          @if (view.faq; as items) {
            @for (item of items; track $index) {
              <section>
                <h2>{{ item.question }}</h2>
                <p>{{ item.answer }}</p>
              </section>
            }
          }
          @if (view.kind === 'index') {
            <ul class="guides">
              @for (guide of guides; track guide.slug) {
                <li>
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
                Bir şehrin son dışa aktarımı şu adreste yayımlanır; <em>{{ '{sehir}' }}</em> yerine
                şehir adresini yaz:
              </p>
              <p>
                <code>{{ exportTemplate }}</code>
              </p>
              <p>
                Şehir adreslerini <a routerLink="/">ana sayfadaki şehir listesinde</a> bulabilirsin.
              </p>
            </section>
          }
        </article>
      </main>
    } @else if (page.state === 'not_found') {
      <iv-status-page kind="not-found" />
    } @else {
      <iv-status-page kind="unavailable" />
    }
  `,
  styles: `
    main {
      max-width: 44rem;
      margin: auto;
      padding: 2rem 1rem;
    }
    .status {
      border-left: 0.25rem solid var(--iv-color-dolmus-sarisi);
      padding: 0.75rem;
      font-weight: 600;
    }
    .meta {
      color: var(--iv-color-yol-grisi);
      font-size: 0.9rem;
    }
    h2 {
      margin: 2rem 0 0.5rem;
      font-size: 1.35rem;
    }
    p,
    li {
      line-height: 1.6;
    }
    .guides {
      list-style: none;
      padding: 0;
    }
    .guides li {
      padding: 0.75rem 0;
    }
    .summary {
      display: block;
    }
    code {
      overflow-wrap: anywhere;
    }
  `,
})
export class ContentPage extends PageView<ContentData> {
  protected readonly guides = GUIDES;
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
