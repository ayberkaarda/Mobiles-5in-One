import { inject, Injectable } from '@angular/core';
import { CatalogApi, City, StopSummary } from '@inecekvar/data-access';
import { distanceMeters, fold, inBbox } from '../shared/format';

/** `GET stops/near` accepts at most 2 km. */
const SAMPLE_RADIUS_M = 2000;
/** Cell size of the sampling grid; with a 2 km radius neighbouring circles overlap. */
const CELL_M = 2500;
/** At most 3 × 3 calls per city and session. */
const MAX_CELLS_PER_SIDE = 3;

/**
 * Interim stop name search. The API has no `stops?city=&q=` route yet, so the stops of the
 * selected city are gathered once per session from `stops/near` calls on a small grid over the
 * city bbox (at most 9 calls), kept to the bbox and matched on the device. Large cities are only
 * partly covered; the offline pack (package 3E) or a stop search route replaces this.
 */
@Injectable({ providedIn: 'root' })
export class StopIndex {
  private readonly api = inject(CatalogApi);
  private readonly cache = new Map<string, Promise<StopSummary[]>>();

  async search(city: City, query: string, limit = 8): Promise<StopSummary[]> {
    const needle = fold(query);
    if (needle.length < 2) return [];
    const stops = await this.stopsOf(city);
    return stops.filter((stop) => fold(stop.name).includes(needle)).slice(0, limit);
  }

  stopsOf(city: City): Promise<StopSummary[]> {
    let pending = this.cache.get(city.slug);
    if (!pending) {
      pending = this.collect(city);
      pending.catch(() => this.cache.delete(city.slug));
      this.cache.set(city.slug, pending);
    }
    return pending;
  }

  private async collect(city: City): Promise<StopSummary[]> {
    const pages = await Promise.all(
      samplePoints(city.bbox).map(([lng, lat]) =>
        this.api.stopsNear({ lat, lng, radius: SAMPLE_RADIUS_M }),
      ),
    );
    const byId = new Map<string, StopSummary>();
    for (const stop of pages.flat()) {
      if (inBbox(stop.location, city.bbox)) byId.set(stop.id, stop);
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  }
}

/** Centres of an n × n grid over `[minLng, minLat, maxLng, maxLat]`, n between 1 and 3. */
export function samplePoints(bbox: readonly number[]): [number, number][] {
  const [minLng = 0, minLat = 0, maxLng = 0, maxLat = 0] = bbox;
  const width = distanceMeters([minLng, minLat], [maxLng, minLat]);
  const height = distanceMeters([minLng, minLat], [minLng, maxLat]);
  const n = Math.min(MAX_CELLS_PER_SIDE, Math.max(1, Math.ceil(Math.max(width, height) / CELL_M)));
  const points: [number, number][] = [];
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      points.push([
        minLng + ((col + 0.5) * (maxLng - minLng)) / n,
        minLat + ((row + 0.5) * (maxLat - minLat)) / n,
      ]);
    }
  }
  return points;
}
