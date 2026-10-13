import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { GUIDES } from '../../content/guides';

function guidePath(slug: string): string {
  const guide = GUIDES.find((item) => item.slug === slug);
  if (!guide) throw new Error(`unknown guide ${slug}`);
  return guide.path;
}

/**
 * The lower half of the home page: the three steps as stops on a turquoise line (the stop
 * sequence of a line page), then the offline pack and the contribution teasers.
 */
@Component({
  selector: 'iv-home-guide',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="band" aria-labelledby="steps-title">
      <div class="inner">
        <h2 id="steps-title">Nasıl çalışır</h2>
        <ol class="steps" role="list">
          <li>
            <span class="sign" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <circle cx="10.5" cy="10.5" r="6" />
                <path d="M15 15l5 5" />
              </svg>
            </span>
            <h3>Hattını bul</h3>
            <p>Şehrini seç; hat kodunu, hat adını ya da bir durağı yaz.</p>
          </li>
          <li>
            <span class="sign" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="M5 19V5M5 5h11l-2 3.5L16 12H5" /></svg>
            </span>
            <h3>Durakları ve ücreti gör</h3>
            <p>Durak sırası, ücret ve tarihi, çalışma saatleri ve ödeme tek sayfada.</p>
          </li>
          <li>
            <span class="sign" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="M4 20l4-1 11-11-3-3L5 16zM14 7l3 3" /></svg>
            </span>
            <h3>Eksik ya da yanlışsa düzelt</h3>
            <p>Önerin moderatör onayından sonra yayımlanır; her sürüm kayıtlı kalır.</p>
          </li>
        </ol>
      </div>
    </section>
    <div class="inner teasers">
      <section class="teaser" aria-labelledby="offline-title">
        <h2 id="offline-title">İnternet yokken de</h2>
        <p>
          Şehir paketini bir kez indir; hat arama, hat ve durak sayfaları, ücret ve saatler
          internetsiz de çalışır. Yeni sürüm çıkınca uygulama güncellemeyi önerir.
        </p>
        <a [routerLink]="offlineGuide">Çevrimdışı şehir paketi rehberi</a>
      </section>
      <section class="teaser dark" aria-labelledby="contribute-title">
        <h2 id="contribute-title">Mahalle bilir, sen de ekle</h2>
        <p>
          Bindiğin hattın izini kaydet ya da eskiyen ücreti düzelt. İzin ilk ve son 200 metresi
          kesilir; öneri, moderatör onayıyla yayına girer.
        </p>
        <a [routerLink]="verifyGuide">Katkı ve doğrulama nasıl işler</a>
      </section>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .inner {
      max-width: 68rem;
      margin: 0 auto;
      padding: 0 1rem;
    }
    .band {
      padding: 2rem 0 2.75rem;
      background: #f6ecd2;
      border-block: 1px solid rgba(20, 33, 61, 0.14);
    }
    h2 {
      margin: 0 0 1.25rem;
      font-size: 1.6rem;
    }
    .steps {
      position: relative;
      display: grid;
      gap: 1.5rem;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    @media (min-width: 52rem) {
      .steps {
        grid-template-columns: repeat(3, 1fr);
        gap: 2rem;
      }
      .steps::before {
        content: '';
        position: absolute;
        top: 1.6rem;
        left: 2rem;
        right: calc((100% - 4rem) / 3 - 1.6rem);
        border-top: 4px solid var(--iv-color-turkuaz);
      }
    }
    li {
      position: relative;
    }
    .sign {
      display: inline-grid;
      place-items: center;
      width: 3.25rem;
      height: 3.25rem;
      border-radius: 0.75rem;
      background: var(--iv-color-dolmus-sarisi);
      border-bottom: 5px solid var(--iv-color-turkuaz);
      box-shadow: 0 0 0 4px #f6ecd2;
    }
    svg {
      width: 1.6rem;
      height: 1.6rem;
      fill: none;
      stroke: var(--iv-color-lacivert);
      stroke-width: 2.2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    h3 {
      margin: 0.9rem 0 0.35rem;
      font-family: var(--iv-font-display);
      font-size: 1.15rem;
    }
    p {
      margin: 0;
      line-height: 1.55;
    }
    .teasers {
      display: grid;
      gap: 1.25rem;
      padding-block: 2.75rem 3.25rem;
    }
    @media (min-width: 52rem) {
      .teasers {
        grid-template-columns: 1fr 1fr;
      }
    }
    .teaser {
      display: grid;
      align-content: start;
      gap: 0.75rem;
      padding: 1.5rem;
      background: #fff;
      border: 1px solid rgba(20, 33, 61, 0.14);
      border-radius: 1.25rem;
      box-shadow: 0 6px 0 rgba(20, 33, 61, 0.14);
    }
    .teaser h2 {
      margin: 0;
      font-size: 1.3rem;
    }
    .dark {
      background: var(--iv-color-lacivert);
      color: var(--iv-color-krem);
      box-shadow: 0 6px 0 var(--iv-color-dolmus-sarisi);
    }
    a {
      justify-self: start;
      display: inline-flex;
      align-items: center;
      min-height: 44px;
      font-weight: 600;
      color: inherit;
      text-underline-offset: 0.25em;
      text-decoration-thickness: 2px;
      text-decoration-color: var(--iv-color-turkuaz);
      border-radius: 0.25rem;
    }
    a:focus-visible {
      outline: 3px solid var(--iv-color-turkuaz);
      outline-offset: 2px;
    }
  `,
})
export class HomeGuideComponent {
  protected readonly offlineGuide = guidePath('cevrimdisi-sehir-paketi-nasil-kullanilir');
  protected readonly verifyGuide = guidePath('hat-bilgisi-nasil-dogrulanir');
}
