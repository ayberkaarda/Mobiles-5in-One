import { DestroyRef, effect, inject, Signal, signal, untracked } from '@angular/core';

/**
 * A copy of `source` that follows it after `ms` of quiet. An empty value passes at once, so
 * clearing a search field never waits. Call it in an injection context.
 */
export function debounced(source: Signal<string>, ms: number): Signal<string> {
  const out = signal(untracked(source));
  let timer: ReturnType<typeof setTimeout> | undefined;
  effect(() => {
    const value = source();
    clearTimeout(timer);
    if (value.trim() === '' || ms <= 0) {
      out.set(value);
      return;
    }
    timer = setTimeout(() => out.set(value), ms);
  });
  inject(DestroyRef).onDestroy(() => clearTimeout(timer));
  return out.asReadonly();
}
