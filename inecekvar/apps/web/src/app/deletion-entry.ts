import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  createEnvironmentInjector,
  DestroyRef,
  EnvironmentInjector,
  inject,
  InjectionToken,
  type Provider,
  signal,
  type Type,
  viewChild,
  ViewContainerRef,
} from '@angular/core';

/** What the lazy deletion chunk hands to the public page. */
export interface DeletionPanelModule {
  readonly component: Type<unknown>;
  readonly providers: Provider[];
}

export type DeletionPanelLoader = () => Promise<DeletionPanelModule>;

/**
 * Loads the web account deletion panel (ADR-0057). Only the browser entry (main.ts) provides a
 * loader, so the server bundle and every public chunk stay free of the session client, as for
 * `/admin` (ADR-0041); on the server and in unit tests the token is null and the page keeps its
 * server-rendered text.
 */
export const DELETION_PANEL_LOADER = new InjectionToken<DeletionPanelLoader | null>(
  'DELETION_PANEL_LOADER',
  { providedIn: 'root', factory: () => null },
);

/**
 * The slot on `/hesap-silme`. The server renders the explanation below; after hydration the
 * browser loads the panel into the slot, with its own cookie client in a child injector.
 */
@Component({
  selector: 'iv-deletion-slot',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="slot" aria-labelledby="iv-web-deletion-heading">
      <h2 id="iv-web-deletion-heading">Web üzerinden silme</h2>
      @if (state() !== 'ready') {
        <p data-deletion-fallback>
          @if (state() === 'failed') {
            Silme paneli yüklenemedi. Sayfayı yenileyip yeniden dene ya da silmeyi uygulamadan yap.
          } @else {
            Silme paneli tarayıcıda açılır ve JavaScript gerektirir. JavaScript kapalıysa silmeyi
            uygulamadan yapabilirsin.
          }
        </p>
      }
      <ng-container #host />
    </section>
  `,
  styles: `
    .slot {
      margin-top: 2rem;
      padding-top: 0.5rem;
      border-top: 1px solid currentColor;
    }
  `,
})
export class DeletionSlot {
  private readonly loader = inject(DELETION_PANEL_LOADER);
  private readonly environment = inject(EnvironmentInjector);
  private readonly host = viewChild.required('host', { read: ViewContainerRef });
  protected readonly state = signal<'waiting' | 'ready' | 'failed'>('waiting');

  constructor() {
    const destroyRef = inject(DestroyRef);
    let child: EnvironmentInjector | null = null;
    let destroyed = false;
    destroyRef.onDestroy(() => {
      destroyed = true;
      child?.destroy();
    });
    afterNextRender(() => {
      const load = this.loader;
      if (load === null) return;
      load()
        .then((panel) => {
          if (destroyed) return;
          child = createEnvironmentInjector(panel.providers, this.environment);
          this.host().createComponent(panel.component, { environmentInjector: child });
          this.state.set('ready');
        })
        .catch(() => {
          if (!destroyed) this.state.set('failed');
        });
    });
  }
}
