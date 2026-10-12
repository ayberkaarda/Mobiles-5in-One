import { inject, Injectable } from '@angular/core';
import {
  ApiError,
  CatalogApi,
  LineDetail,
  LineListItem,
  StopDetail,
  StopSummary,
} from '@inecekvar/data-access';
import { PackRegistry } from './pack-registry';

const offlineMiss = (code: string) => new ApiError('problem', 404, code, 'offline-pack');

/**
 * Catalog reads, offline first: when the city's pack is installed, line search, line and stop
 * pages, nearby stops and stop names are answered from the pack on the device with the API's
 * shapes and no request. A line or stop the pack does not have is asked from the API (it may be
 * newer than the pack); without a connection that miss is "not found". Without a pack every
 * read goes to the API as before.
 */
@Injectable({ providedIn: 'root' })
export class CatalogSource {
  private readonly api = inject(CatalogApi);
  private readonly registry = inject(PackRegistry);

  /** True when reads for `city` are served by an installed pack. */
  usesPack(city: string | null | undefined): boolean {
    return this.registry.has(city);
  }

  async lines(
    query: { city: string; q?: string | null; limit?: number },
    signal?: AbortSignal,
  ): Promise<LineListItem[]> {
    const pack = await this.registry.dataset(query.city);
    if (pack) return pack.searchLines(query.q, query.limit ?? 100);
    return this.api.lines(
      { city: query.city, q: query.q || undefined, limit: query.limit },
      signal,
    );
  }

  async line(slug: string, city: string, signal?: AbortSignal): Promise<LineDetail> {
    const pack = await this.registry.dataset(city);
    const local = pack?.line(slug);
    if (local) return local;
    if (!pack) return this.api.line(slug, city, signal);
    return this.fromApiAfterMiss(() => this.api.line(slug, city, signal), 'line.not_found');
  }

  async stop(slug: string, city: string, signal?: AbortSignal): Promise<StopDetail> {
    const pack = await this.registry.dataset(city);
    const local = pack?.stop(slug);
    if (local) return local;
    if (!pack) return this.api.stop(slug, city, signal);
    return this.fromApiAfterMiss(() => this.api.stop(slug, city, signal), 'stop.not_found');
  }

  /**
   * Stops within `radius` metres, nearest first. With a pack the distances are computed on
   * the device (haversine) and only the city's stops are returned.
   */
  async stopsNear(
    query: { lat: number; lng: number; radius: number },
    city: string | null,
    signal?: AbortSignal,
  ): Promise<StopSummary[]> {
    const pack = city ? await this.registry.dataset(city) : null;
    if (pack) return pack.stopsNear(query.lat, query.lng, query.radius);
    return this.api.stopsNear(query, signal);
  }

  /** Stop names from the pack, or `null` when the city has no installed pack. */
  async searchStops(city: string, q: string, limit: number): Promise<StopSummary[] | null> {
    const pack = await this.registry.dataset(city);
    return pack ? pack.searchStops(q, limit) : null;
  }

  private async fromApiAfterMiss<T>(read: () => Promise<T>, code: string): Promise<T> {
    try {
      return await read();
    } catch (error) {
      if (error instanceof ApiError && (error.kind === 'network' || error.kind === 'timeout')) {
        throw offlineMiss(code);
      }
      throw error;
    }
  }
}
