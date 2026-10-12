import { inject, InjectionToken } from '@angular/core';
import { Geolocation } from '@capacitor/geolocation';
import { IS_NATIVE_PLATFORM } from '@inecekvar/data-access';

export interface Fix {
  lng: number;
  lat: number;
  /** Radius of 68 % confidence in metres. */
  accuracy: number;
}

export type WatchFailure = 'denied' | 'unavailable';

export interface PositionWatch {
  stop(): Promise<void>;
}

/**
 * Continuous foreground positions while a ride is recorded (when-in-use, ADR-0004). There is
 * no background mode: when the app leaves the screen the platform may stop sending fixes, and
 * the recorder keeps what it has.
 */
export interface PositionSource {
  /** Asks for permission if needed; `denied` is final for this attempt. */
  ensurePermission(): Promise<'granted' | 'denied'>;
  watch(
    onFix: (fix: Fix) => void,
    onFailure: (failure: WatchFailure) => void,
  ): Promise<PositionWatch>;
}

type GeolocationPlugin = Pick<
  typeof Geolocation,
  'checkPermissions' | 'requestPermissions' | 'watchPosition' | 'clearWatch'
>;

const PERMISSION_DENIED = 1;

export function isPermissionError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (code === PERMISSION_DENIED) return true;
  return typeof message === 'string' && /denied|permission/i.test(message);
}

export class CapacitorPositionSource implements PositionSource {
  constructor(
    private readonly native: boolean,
    private readonly plugin: GeolocationPlugin = Geolocation,
  ) {}

  async ensurePermission(): Promise<'granted' | 'denied'> {
    // The browser asks inside watchPosition; a refusal arrives as a watch failure.
    if (!this.native) return 'granted';
    try {
      let status = (await this.plugin.checkPermissions()).location;
      if (status === 'prompt' || status === 'prompt-with-rationale') {
        status = (await this.plugin.requestPermissions({ permissions: ['location'] })).location;
      }
      return status === 'granted' ? 'granted' : 'denied';
    } catch {
      return 'denied';
    }
  }

  async watch(
    onFix: (fix: Fix) => void,
    onFailure: (failure: WatchFailure) => void,
  ): Promise<PositionWatch> {
    const id = await this.plugin.watchPosition(
      { enableHighAccuracy: true, timeout: 30_000, maximumAge: 0 },
      (position, error) => {
        if (position) {
          onFix({
            lng: position.coords.longitude,
            lat: position.coords.latitude,
            accuracy: position.coords.accuracy,
          });
        } else if (error) {
          onFailure(isPermissionError(error) ? 'denied' : 'unavailable');
        }
      },
    );
    return { stop: () => this.plugin.clearWatch({ id }) };
  }
}

export const POSITION_SOURCE = new InjectionToken<PositionSource>('POSITION_SOURCE', {
  providedIn: 'root',
  factory: () => new CapacitorPositionSource(inject(IS_NATIVE_PLATFORM)),
});

/** Keeps the screen on while recording where the platform offers the Screen Wake Lock API. */
export interface WakeLockSource {
  readonly supported: boolean;
  /** Resolves to a release function, or `null` when the lock was not granted. */
  acquire(): Promise<(() => Promise<void>) | null>;
}

interface WakeLockSentinelLike {
  release(): Promise<void>;
}
interface WakeLockLike {
  request(type: 'screen'): Promise<WakeLockSentinelLike>;
}

export function browserWakeLock(nav: Navigator | undefined = globalThis.navigator): WakeLockSource {
  const lock = (nav as (Navigator & { wakeLock?: WakeLockLike }) | undefined)?.wakeLock;
  return {
    supported: !!lock,
    async acquire() {
      if (!lock) return null;
      try {
        const sentinel = await lock.request('screen');
        return () => sentinel.release().catch(() => undefined);
      } catch {
        // Refused (battery saver, page hidden): recording works without it.
        return null;
      }
    },
  };
}

export const WAKE_LOCK = new InjectionToken<WakeLockSource>('WAKE_LOCK', {
  providedIn: 'root',
  factory: () => browserWakeLock(),
});
