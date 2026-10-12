import { computed, DestroyRef, inject, InjectionToken, signal } from '@angular/core';

/** Wall clock in epoch milliseconds; tests replace it to drive countdowns and ride times. */
export const APP_NOW = new InjectionToken<() => number>('APP_NOW', {
  providedIn: 'root',
  factory: () => () => Date.now(),
});

/**
 * Seconds left of a `Retry-After` wait, as a signal. Ticks four times a second while running
 * and stops itself at zero. Create it in an injection context; it cleans up on destroy.
 */
export class Countdown {
  private readonly now = inject(APP_NOW);
  private readonly until = signal<number | null>(null);
  private readonly tick = signal(0);
  private timer: ReturnType<typeof setInterval> | null = null;

  /** Whole seconds left; 0 when not waiting. */
  readonly seconds = computed(() => {
    this.tick();
    const until = this.until();
    if (until === null) return 0;
    return Math.max(0, Math.ceil((until - this.now()) / 1000));
  });
  readonly active = computed(() => this.seconds() > 0);

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stop());
  }

  start(seconds: number | null | undefined): void {
    const wait = Math.max(1, Math.min(seconds ?? 60, 24 * 3600));
    this.until.set(this.now() + wait * 1000);
    this.tick.update((n) => n + 1);
    if (this.timer === null) {
      this.timer = setInterval(() => {
        this.tick.update((n) => n + 1);
        if (this.seconds() === 0) this.stop();
      }, 250);
    }
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.until.set(null);
  }

  /** Re-reads the clock now (tests move the fake clock, then call this). */
  refresh(): void {
    this.tick.update((n) => n + 1);
  }
}
