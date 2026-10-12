import { inject, InjectionToken } from '@angular/core';
import { Geolocation } from '@capacitor/geolocation';
import { IS_NATIVE_PLATFORM } from '@inecekvar/data-access';

export type LocateResult =
  { kind: 'ok'; lat: number; lng: number } | { kind: 'denied' } | { kind: 'unavailable' };

/** One foreground position fix (when-in-use, ADR-0004); nothing is watched or stored. */
export interface LocationSource {
  locate(): Promise<LocateResult>;
}

type GeolocationPlugin = Pick<
  typeof Geolocation,
  'checkPermissions' | 'requestPermissions' | 'getCurrentPosition'
>;

const PERMISSION_DENIED = 1;

export function quantizeCoord(value: number, decimals: number): number {
  return Number(value.toFixed(decimals));
}

function isDenied(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (code === PERMISSION_DENIED) return true;
  return typeof message === 'string' && /denied|permission/i.test(message);
}

/**
 * Capacitor geolocation: native shells ask for coarse location first (a refusal is final for
 * this request), the browser shows its own prompt inside `getCurrentPosition`.
 */
export class CapacitorLocationSource implements LocationSource {
  constructor(
    private readonly native: boolean,
    private readonly plugin: GeolocationPlugin = Geolocation,
  ) {}

  async locate(): Promise<LocateResult> {
    try {
      if (this.native) {
        let status = (await this.plugin.checkPermissions()).coarseLocation;
        if (status === 'prompt' || status === 'prompt-with-rationale') {
          status = (await this.plugin.requestPermissions({ permissions: ['coarseLocation'] }))
            .coarseLocation;
        }
        if (status === 'denied') return { kind: 'denied' };
      }
      const position = await this.plugin.getCurrentPosition({
        enableHighAccuracy: false,
        timeout: 10_000,
        maximumAge: 60_000,
      });
      return { kind: 'ok', lat: position.coords.latitude, lng: position.coords.longitude };
    } catch (error) {
      return isDenied(error) ? { kind: 'denied' } : { kind: 'unavailable' };
    }
  }
}

export const LOCATION_SOURCE = new InjectionToken<LocationSource>('LOCATION_SOURCE', {
  providedIn: 'root',
  factory: () => new CapacitorLocationSource(inject(IS_NATIVE_PLATFORM)),
});
