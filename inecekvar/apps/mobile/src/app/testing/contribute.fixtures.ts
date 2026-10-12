import { Provider } from '@angular/core';
import {
  Fix,
  PositionSource,
  POSITION_SOURCE,
  WAKE_LOCK,
  WakeLockSource,
  WatchFailure,
} from '../contribute/position-source';
import { APP_NOW } from '../shared/countdown';

/** A position source the test drives: `emit` sends a fix, `fail` a watch failure. */
export class FakePositions implements PositionSource {
  permission: 'granted' | 'denied' = 'granted';
  watching = false;
  watchCount = 0;
  failWatch = false;
  private onFix: ((fix: Fix) => void) | null = null;
  private onFailure: ((failure: WatchFailure) => void) | null = null;

  async ensurePermission() {
    return this.permission;
  }

  async watch(onFix: (fix: Fix) => void, onFailure: (failure: WatchFailure) => void) {
    if (this.failWatch) throw new Error('no location service');
    this.onFix = onFix;
    this.onFailure = onFailure;
    this.watching = true;
    this.watchCount += 1;
    return {
      stop: async () => {
        this.watching = false;
        this.onFix = null;
        this.onFailure = null;
      },
    };
  }

  emit(lng: number, lat: number, accuracy = 8): void {
    this.onFix?.({ lng, lat, accuracy });
  }

  fail(failure: WatchFailure): void {
    this.onFailure?.(failure);
  }
}

export class FakeWakeLock implements WakeLockSource {
  supported = true;
  held = 0;
  releases = 0;

  async acquire() {
    this.held += 1;
    return async () => {
      this.releases += 1;
    };
  }
}

export class FakeClock {
  constructor(public now = Date.parse('2026-10-12T08:00:00Z')) {}
  advance(ms: number): void {
    this.now += ms;
  }
}

/** Points walking east from the sample city's west edge, about 16 m apart. */
export function walk(count: number, from: [number, number] = [34.01, 42.53]): [number, number][] {
  return Array.from(
    { length: count },
    (_, i) => [from[0] + i * 0.0002, from[1]] as [number, number],
  );
}

export function contributeTesting(
  positions: FakePositions,
  wakeLock: FakeWakeLock,
  clock: FakeClock,
): Provider[] {
  return [
    { provide: POSITION_SOURCE, useValue: positions },
    { provide: WAKE_LOCK, useValue: wakeLock },
    { provide: APP_NOW, useValue: () => clock.now },
  ];
}
