import { Component } from '@angular/core';

@Component({
  selector: 'iv-home',
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
export class Home {}
