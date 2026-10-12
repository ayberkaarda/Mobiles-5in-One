import { computed, inject, Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { ApiError } from '@inecekvar/data-access';
import { CityStore } from '../city/city.store';
import { ConnectivityService } from '../shared/connectivity.service';

export type DetailFailure = 'not-found' | 'offline' | 'error';

/**
 * `:slug` and `?city=` of a line or stop page. Line and stop reads need the city (the API
 * scopes slugs per city); without the query parameter the stored city is used.
 */
export function detailRouteParams(): Signal<{ slug: string; city: string } | undefined> {
  const route = inject(ActivatedRoute);
  const cities = inject(CityStore);
  void cities.init();
  const params = toSignal(route.paramMap, { initialValue: route.snapshot.paramMap });
  const query = toSignal(route.queryParamMap, { initialValue: route.snapshot.queryParamMap });
  return computed(() => {
    const slug = params().get('slug');
    const city = query().get('city') ?? cities.selectedSlug();
    return slug && city ? { slug, city } : undefined;
  });
}

/** Maps a failed read to the state shown: 404 is "not found", no connection is offline. */
export function detailFailure(error: unknown, connectivity: ConnectivityService): DetailFailure {
  if (error instanceof ApiError) {
    if (error.status === 404 || error.status === 422) return 'not-found';
    if (error.kind === 'network' || error.kind === 'timeout') return 'offline';
  }
  return connectivity.online() ? 'error' : 'offline';
}
