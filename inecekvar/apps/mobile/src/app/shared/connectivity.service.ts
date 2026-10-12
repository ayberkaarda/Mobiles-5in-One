import { DestroyRef, inject, Injectable, InjectionToken, signal } from '@angular/core';
import { Network } from '@capacitor/network';

/** The part of `@capacitor/network` the app uses; tests pass a fake. */
export interface NetworkSource {
  getStatus(): Promise<{ connected: boolean }>;
  addListener(
    event: 'networkStatusChange',
    listener: (status: { connected: boolean }) => void,
  ): Promise<{ remove(): Promise<void> }>;
}

/**
 * Capacitor Network: the OS connectivity callbacks in the native shells, `navigator.onLine` and
 * the window `online`/`offline` events on the web.
 */
export const NETWORK_SOURCE = new InjectionToken<NetworkSource>('NETWORK_SOURCE', {
  providedIn: 'root',
  // A plain object, not the plugin proxy itself: the proxy answers every property (Angular
  // would take it for a service with `ngOnDestroy`).
  factory: (): NetworkSource => ({
    getStatus: () => Network.getStatus(),
    addListener: (event, listener) => Network.addListener(event, listener),
  }),
});

/**
 * Online or offline through Capacitor Network. The signal is a hint: a request can still fail
 * while it says online, so screens also treat a network error as offline.
 */
@Injectable({ providedIn: 'root' })
export class ConnectivityService {
  private readonly network = inject(NETWORK_SOURCE);

  readonly online = signal(globalThis.navigator?.onLine ?? true);

  constructor() {
    let handle: { remove(): Promise<void> } | null = null;
    let destroyed = false;
    this.network
      .getStatus()
      .then((status) => {
        if (!destroyed) this.online.set(status.connected);
      })
      .catch(() => undefined);
    this.network
      .addListener('networkStatusChange', (status) => this.online.set(status.connected))
      .then((h) => {
        if (destroyed) void h.remove();
        else handle = h;
      })
      .catch(() => undefined);
    inject(DestroyRef).onDestroy(() => {
      destroyed = true;
      void handle?.remove();
    });
  }
}
