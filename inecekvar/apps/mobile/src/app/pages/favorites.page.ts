import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular';
import { StateComponent } from '@inecekvar/ui';
import { FavoritesStore } from '../core/favorites.store';
import { TPipe, TpPipe } from '../i18n/i18n';
import { LineItem, LineListComponent } from '../shared/line-list.component';

/**
 * `/favoriler`: the guest list on this device with a sign-in prompt, or the account list once
 * signed in, with the merge of this device's favourites and its failures.
 */
@Component({
  selector: 'iv-favorites-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    RouterLink,
    LineListComponent,
    StateComponent,
    TPipe,
    TpPipe,
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ 'tabs.favorites' | t }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      <div class="iv-page">
        <header class="iv-hero iv-board">
          <p class="iv-kicker">{{ 'favorites.kicker' | t }}</p>
          <h1 class="iv-heading">{{ 'favorites.heading' | t }}</h1>
          <p class="iv-lead">{{ 'favorites.lead' | t }}</p>
        </header>
        @if (favorites.storageError()) {
          <p class="note note--warn" role="alert">{{ 'favorites.storageError' | t }}</p>
        }

        @if (favorites.signedIn()) {
          @switch (favorites.merge().kind) {
            @case ('running') {
              <p class="note" role="status">{{ 'favorites.merging' | t }}</p>
            }
            @case ('done') {
              @if (mergedCount() > 0) {
                <p class="note note--ok" role="status">
                  {{ 'favorites.merged' | tp: mergedCount() }}
                </p>
              }
            }
            @case ('partial') {
              <div class="note note--warn" role="alert">
                <span>{{ 'favorites.mergePartial' | tp: mergeFailed() }}</span>
                <button type="button" class="inline-action" (click)="favorites.retrySync()">
                  {{ 'favorites.retry' | t }}
                </button>
              </div>
            }
          }
          @if (favorites.toggleFailed()) {
            <p class="note note--warn" role="alert">{{ 'favorites.toggleFailed' | t }}</p>
          }
          <section class="iv-section" data-list="account">
            @switch (favorites.accountStatus()) {
              @case ('error') {
                <iv-state
                  kind="error"
                  [heading]="'favorites.loadError' | t"
                  [actionLabel]="'favorites.retry' | t"
                  (action)="favorites.retrySync()"
                />
              }
              @case ('ready') {
                @if (lines().length > 0) {
                  <h2 class="iv-section-title">
                    {{ 'favorites.accountTitle' | t }}
                    <small>{{ 'favorites.count' | tp: lines().length }}</small>
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
              }
              @default {
                <p class="note" role="status">{{ 'favorites.loading' | t }}</p>
              }
            }
          </section>
        } @else {
          <section class="iv-section" data-list="guest">
            @if (lines().length > 0) {
              <h2 class="iv-section-title">
                {{ 'favorites.guestTitle' | t }}
                <small>{{ 'favorites.count' | tp: lines().length }}</small>
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
          <aside class="signin" [attr.aria-label]="'favorites.signInTitle' | t">
            <h2>{{ 'favorites.signInTitle' | t }}</h2>
            <p>{{ 'favorites.signInBody' | t }}</p>
            <a class="iv-button" routerLink="/giris">{{ 'favorites.signInAction' | t }}</a>
          </aside>
        }
      </div>
    </ion-content>
  `,
  styles: `
    .note {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px 12px;
      margin: var(--iv-space-4) 0 0;
      padding: 10px 12px;
      border-left: 4px solid var(--iv-line-strong);
      border-radius: var(--iv-radius-s);
      background: var(--iv-surface-sunk);
      font-size: 14px;
      line-height: 1.4;
      color: var(--iv-ink);
    }
    .note--ok {
      border-left-color: var(--iv-success);
    }
    .note--warn {
      border-left-color: var(--iv-accent);
    }
    .inline-action {
      min-height: 32px;
      padding: 0 12px;
      border: 1.5px solid var(--iv-ink);
      border-radius: var(--iv-radius-pill);
      background: transparent;
      color: var(--iv-ink);
      font: inherit;
      font-size: 13px;
      font-weight: var(--iv-font-body-weight-600);
      cursor: pointer;
    }
    .signin {
      display: grid;
      gap: 10px;
      justify-items: start;
      margin-top: var(--iv-space-5);
      padding: var(--iv-space-4);
      border: 1px solid var(--iv-line);
      border-left: 6px solid var(--iv-stripe);
      border-radius: var(--iv-radius-l);
      background: var(--iv-surface);
    }
    .signin h2 {
      margin: 0;
      font-family: var(--iv-font-display);
      font-weight: var(--iv-font-display-weight);
      font-size: 19px;
      line-height: 1.2;
      color: var(--iv-ink);
    }
    .signin p {
      margin: 0;
      font-size: 14px;
      line-height: 1.5;
      color: var(--iv-ink-muted);
    }
    .signin a {
      text-decoration: none;
    }
  `,
})
export class FavoritesPage {
  private readonly router = inject(Router);
  protected readonly favorites = inject(FavoritesStore);

  /** The account list when signed in, else this device's guest list. */
  protected readonly lines = computed<LineItem[]>(() => [...this.favorites.all()]);

  protected readonly mergedCount = computed(() => {
    const merge = this.favorites.merge();
    return merge.kind === 'done' ? merge.added : 0;
  });
  protected readonly mergeFailed = computed(() => {
    const merge = this.favorites.merge();
    return merge.kind === 'partial' ? merge.failed : 0;
  });

  protected goToSearch(): void {
    void this.router.navigateByUrl('/ara');
  }
}
