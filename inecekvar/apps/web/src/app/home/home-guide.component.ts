import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { GUIDES } from '../../content/guides';

function guidePath(slug: string): string {
  const guide = GUIDES.find((item) => item.slug === slug);
  if (!guide) throw new Error(`unknown guide ${slug}`);
  return guide.path;
}

/**
 * The lower half of the home page: the three steps as stops on the route rail (the same rail as
 * the line diagram), then the offline pack and the contribution teasers.
 */
@Component({
  selector: 'iv-home-guide',
  standalone: true,
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="band" aria-labelledby="steps-title">
      <div class="inner">
        <h2 id="steps-title" class="iv-section-head">Nasıl çalışır</h2>
        <ol class="steps" role="list">
          <li>
            <span class="stop" aria-hidden="true"></span>
            <h3>Hattını bul</h3>
            <p>Şehrini seç; hat kodunu, hat adını ya da bir durağı yaz.</p>
          </li>
          <li>
            <span class="stop" aria-hidden="true"></span>
            <h3>Durakları ve ücreti gör</h3>
            <p>Durak sırası, ücret ve tarihi, çalışma saatleri ve ödeme tek sayfada.</p>
          </li>
          <li>
            <span class="stop" aria-hidden="true"></span>
            <h3>Eksik ya da yanlışsa düzelt</h3>
            <p>Önerin moderatör onayından sonra yayımlanır; her sürüm kayıtlı kalır.</p>
          </li>
        </ol>
      </div>
    </section>
    <div class="inner teasers">
      <section class="teaser offline" aria-labelledby="offline-title">
        <svg class="pack" viewBox="0 0 64 64" aria-hidden="true">
          <rect x="16" y="6" width="32" height="52" rx="6" />
          <rect class="screen" x="20" y="13" width="24" height="34" rx="2" />
          <path class="arrow" d="M32 18 L32 36 M25 30 L32 37 L39 30" />
        </svg>
        <h2 id="offline-title">İnternet yokken de</h2>
        <p>
          Şehir paketini bir kez indir; hat arama, hat ve durak sayfaları, ücret ve saatler
          internetsiz de çalışır. Yeni sürüm çıkınca uygulama güncellemeyi önerir.
        </p>
        <a [routerLink]="offlineGuide">Çevrimdışı şehir paketi rehberi</a>
      </section>
      <section class="teaser dark" aria-labelledby="contribute-title">
        <span class="bell" aria-hidden="true">İNECEK VAR</span>
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
      max-width: var(--iv-wide);
      margin: 0 auto;
      padding: 0 1rem;
    }
    .band {
      margin-top: 3.5rem;
      padding: 2.5rem 0 3rem;
      background: var(--iv-bg-deep);
    }
    .steps {
      position: relative;
      display: grid;
      gap: 1.75rem;
      margin: 0;
      padding: 0 0 0 2.5rem;
      list-style: none;
    }
    .steps::before {
      content: '';
      position: absolute;
      left: 0.6rem;
      top: 0.5rem;
      bottom: 0.5rem;
      width: 6px;
      background: var(--iv-rail);
      box-shadow:
        -3px 0 0 var(--iv-rail-casing),
        3px 0 0 var(--iv-rail-casing);
    }
    @media (min-width: 52rem) {
      .steps {
        grid-template-columns: repeat(3, 1fr);
        gap: 2.5rem;
        padding: 2.75rem 0 0;
      }
      .steps::before {
        left: 0.75rem;
        right: 30%;
        top: 0.55rem;
        bottom: auto;
        width: auto;
        height: 6px;
        box-shadow:
          0 -3px 0 var(--iv-rail-casing),
          0 3px 0 var(--iv-rail-casing);
      }
    }
    li {
      position: relative;
    }
    .stop {
      position: absolute;
      left: -2.5rem;
      top: 0.15rem;
      width: 1.6rem;
      height: 1.6rem;
      box-sizing: border-box;
      border-radius: 50%;
      background: var(--iv-stop-fill);
      border: 4px solid var(--iv-rail-casing);
    }
    li:first-child .stop,
    li:last-child .stop {
      background: var(--iv-plate);
    }
    @media (min-width: 52rem) {
      .stop {
        left: 0;
        top: -2.75rem;
      }
    }
    h3 {
      margin: 0 0 0.35rem;
      font-family: var(--iv-font-display);
      font-size: 1.2rem;
      line-height: 1.2;
    }
    p {
      margin: 0;
      line-height: 1.55;
    }
    .teasers {
      display: grid;
      gap: 1.25rem;
      padding-block: 3rem 0;
    }
    @media (min-width: 52rem) {
      .teasers {
        grid-template-columns: 1fr 1fr;
      }
    }
    .teaser {
      display: grid;
      align-content: start;
      justify-items: start;
      gap: 0.75rem;
      padding: 1.75rem;
      background: var(--iv-surface);
      border: 1px solid var(--iv-line);
      border-radius: var(--iv-radius-xs);
      box-shadow: none;
    }
    .teaser h2 {
      margin: 0;
      font-size: 1.45rem;
      line-height: 1.15;
    }
    .pack {
      width: 3.5rem;
      height: 3.5rem;
    }
    .pack rect {
      fill: var(--iv-board);
    }
    .pack .screen {
      fill: var(--iv-plate);
    }
    .pack .arrow {
      fill: none;
      stroke: var(--iv-plate-ink);
      stroke-width: 4;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .dark {
      background: var(--iv-board);
      color: var(--iv-board-ink);
      border-color: var(--iv-board-edge);
      border-bottom: 3px solid var(--iv-stripe);
    }
    .bell {
      display: inline-flex;
      align-items: center;
      min-height: 2.25rem;
      padding: 0 1rem;
      border-radius: 999px;
      background: var(--iv-signal);
      color: var(--iv-signal-ink);
      font-family: var(--iv-font-display);
      font-weight: 700;
      font-size: 0.9rem;
      letter-spacing: 0.1em;
    }
    a {
      display: inline-flex;
      align-items: center;
      min-height: 44px;
      font-weight: 650;
      color: inherit;
      text-underline-offset: 0.25em;
      text-decoration-thickness: 2px;
      text-decoration-color: var(--iv-stripe);
      border-radius: 0.25rem;
    }
  `,
})
export class HomeGuideComponent {
  protected readonly offlineGuide = guidePath('cevrimdisi-sehir-paketi-nasil-kullanilir');
  protected readonly verifyGuide = guidePath('hat-bilgisi-nasil-dogrulanir');
}
