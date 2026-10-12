import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular';
import { StateComponent } from '@inecekvar/ui';
import { FavoritesStore } from '../core/favorites.store';
import { TPipe } from '../i18n/i18n';
import { SAMPLE_CITY_LINES } from '../sample/sample-lines';
import { LineListComponent } from '../shared/line-list.component';

@Component({
  selector: 'iv-favorites-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IonHeader, IonToolbar, IonTitle, IonContent, LineListComponent, StateComponent, TPipe],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ 'tabs.favorites' | t }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      <div class="iv-page">
        <p class="iv-kicker">{{ 'favorites.kicker' | t }}</p>
        <h1 class="iv-heading">{{ 'favorites.heading' | t }}</h1>
        <p class="iv-lead">{{ 'favorites.lead' | t }}</p>
        <section class="iv-section">
          @if (lines().length > 0) {
            <h2 class="iv-section-title">
              {{ 'favorites.heading' | t }}
              <small>{{ 'favorites.count' | t: { count: lines().length } }}</small>
            </h2>
            <iv-line-list [lines]="lines()" />
          } @else {
            <iv-state
              [heading]="'favorites.emptyTitle' | t"
              [message]="'favorites.emptyBody' | t"
              [actionLabel]="'favorites.emptyAction' | t"
              (action)="goToSearch()"
            />
          }
        </section>
      </div>
    </ion-content>
  `,
})
export class FavoritesPage {
  private readonly router = inject(Router);
  private readonly favorites = inject(FavoritesStore);

  /** Favourited lines that this device can resolve; today that is the labelled sample set. */
  protected readonly lines = computed(() => {
    const slugs = this.favorites.all();
    return SAMPLE_CITY_LINES.filter((line) => slugs.includes(line.slug));
  });

  protected goToSearch(): void {
    void this.router.navigateByUrl('/ara');
  }
}
