import { inject, Injectable } from '@angular/core';
import { CatalogApi, City, StopSummary } from '@inecekvar/data-access';
import { CatalogSource } from '../packs/catalog-source';
import { distanceMeters, fold, inBbox } from '../shared/format';

/** `GET stops/near` accepts at most 2 km. */
const SAMPLE_RADIUS_M = 2000;
/** Cell size of the sampling grid; with a 2 km radius neighbouring circles overlap. */
const CELL_M = 2500;
/** At most 3 × 3 calls per city and session. */
const MAX_CELLS_PER_SIDE = 3;

/**
 * Stop name search for the Ara tab and the planner suggestions. With the city's pack installed
 * the pack's complete stop list answers (`CatalogSource.searchStops`) and no request is made.
 * Without a pack, and only while online, the interim fallback of package 3C remains: the API
 * has no `stops?city=&q=` route, so the stops are gathered once per session from `stops/near`
 * calls on a small grid over the city bbox (at most 9 calls); large cities are only partly
 * covered there, which the Ara tab's pack prompt points out.
 */
@Injectable({ providedIn: 'root' })
export class StopIndex {
  private readonly api = inject(CatalogApi);
  private readonly source = inject(CatalogSource);
  private readonly cache = new Map<string, Promise<StopSummary[]>>();

  async search(city: City, query: string, limit = 8): Promise<StopSummary[]> {
    const needle = fold(query);
    if (needle.length < 2) return [];
    const packed = await this.source.searchStops(city.slug, query, limit);
    if (packed) return packed;
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
