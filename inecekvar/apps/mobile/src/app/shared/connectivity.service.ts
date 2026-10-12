import { DOCUMENT } from '@angular/common';
import { DestroyRef, inject, Injectable, signal } from '@angular/core';

/**
 * Online or offline, from `navigator.onLine` and the window events. The signal is a hint: a
 * request can still fail while it says online, so screens also treat a network error as offline.
 */
@Injectable({ providedIn: 'root' })
export class ConnectivityService {
  private readonly window = inject(DOCUMENT).defaultView;

  readonly online = signal(this.window?.navigator?.onLine ?? true);

  constructor() {
    const up = () => this.online.set(true);
    const down = () => this.online.set(false);
    this.window?.addEventListener('online', up);
    this.window?.addEventListener('offline', down);
    inject(DestroyRef).onDestroy(() => {
      this.window?.removeEventListener('online', up);
      this.window?.removeEventListener('offline', down);
    });
  }
}
