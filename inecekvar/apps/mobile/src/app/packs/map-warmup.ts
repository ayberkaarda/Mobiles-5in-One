import { DOCUMENT } from '@angular/common';
import { DestroyRef, effect, inject, Injectable, InjectionToken } from '@angular/core';
import { ConnectivityService } from '../shared/connectivity.service';
import { PackRegistry } from './pack-registry';

export const MAP_WARMUP = new InjectionToken<() => Promise<void>>('MAP_WARMUP', {
  providedIn: 'root',
  factory: () => {
    const baseUri = inject(DOCUMENT).baseURI;
    return async () => {
      const response = await fetch(new URL('ngsw.json', baseUri), {
        headers: { 'ngsw-bypass': 'true' },
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('map manifest unavailable');
      const manifest = (await response.json()) as {
        assetGroups: { name: string; urls: string[] }[];
      };
      const urls = manifest.assetGroups.find((group) => group.name === 'map')?.urls;
      if (!urls?.length) throw new Error('map assets unavailable');
      await Promise.all(
        urls.map(async (url) => {
          const asset = await fetch(new URL(url, baseUri), { cache: 'reload' });
          if (!asset.ok) throw new Error('map asset unavailable');
          await asset.arrayBuffer();
        }),
      );
    };
  },
});

export interface WarmupRuntime {
  controlled(): boolean;
  version(): string;
  marker(): string | null;
  saveMarker(version: string): void;
  subscribe(listener: () => void): () => void;
}

export const MAP_WARMUP_RUNTIME = new InjectionToken<WarmupRuntime>('MAP_WARMUP_RUNTIME', {
  providedIn: 'root',
  factory: () => {
    const document = inject(DOCUMENT);
    const worker = document.defaultView?.navigator.serviceWorker;
    const key = 'iv.map-warmed-version';
    return {
      controlled: () => !!worker?.controller,
      version: () =>
        Array.from(document.querySelectorAll<HTMLScriptElement>('script[src]'))
          .map((script) => script.src)
          .join('|'),
      marker: () => {
        try {
          return document.defaultView?.localStorage.getItem(key) ?? null;
        } catch {
          return null;
        }
      },
      saveMarker: (version) => {
        try {
          document.defaultView?.localStorage.setItem(key, version);
        } catch {
          // The in-memory marker still avoids repeated fetches this session.
        }
      },
      subscribe: (listener) => {
        worker?.addEventListener('controllerchange', listener);
        return () => worker?.removeEventListener('controllerchange', listener);
      },
    };
  },
});

@Injectable({ providedIn: 'root' })
export class MapWarmup {
  private readonly registry = inject(PackRegistry);
  private readonly runtime = inject(MAP_WARMUP_RUNTIME);
  private readonly warm = inject(MAP_WARMUP);
  private readonly connectivity = inject(ConnectivityService);
  private warmed: string | null = this.runtime.marker();
  private pending: Promise<boolean> | null = null;
  private requested = false;

  constructor() {
    inject(DestroyRef).onDestroy(
      this.runtime.subscribe(() => {
        this.warmed = null;
        void this.ensure();
      }),
    );
    effect(() => {
      if (this.registry.manifests().size > 0 && this.connectivity.online()) void this.ensure();
    });
    void this.registry.ready().then(() => this.ensure());
  }

  ensure(): Promise<boolean> {
    this.requested = true;
    this.pending ??= this.run().finally(() => (this.pending = null));
    return this.pending;
  }

  private async run(): Promise<boolean> {
    await this.registry.ready();
    let success = false;
    while (this.requested) {
      this.requested = false;
      if (!this.runtime.controlled() || this.registry.manifests().size === 0) return false;
      const version = this.runtime.version();
      if (this.warmed === version) return true;
      try {
        await this.warm();
        if (!this.runtime.controlled() || this.runtime.version() !== version) continue;
        this.warmed = version;
        this.runtime.saveMarker(version);
        success = true;
      } catch {
        // A controller or connectivity event will retry the unfinished warmup.
        return false;
      }
    }
    return success;
  }
}
