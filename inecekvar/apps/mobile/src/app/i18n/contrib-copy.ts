import { inject } from '@angular/core';
import { CanActivateFn } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';

let merged: Promise<void> | null = null;

/**
 * Route guard that merges the Turkish sign-in and contributor copy into the loaded Turkish
 * translation before those screens render (English already carries it). Runs once per app
 * start; a failed chunk load is retried on the next navigation.
 */
export const contributorCopy: CanActivateFn = async () => {
  const transloco = inject(TranslocoService);
  merged ??= (async () => {
    const [{ contribTr }] = await Promise.all([
      import('./contrib.tr'),
      firstValueFrom(transloco.load('tr')),
    ]);
    transloco.setTranslation(contribTr, 'tr', { merge: true, emitChange: true });
  })().catch((error: unknown) => {
    merged = null;
    throw error;
  });
  await merged;
  return true;
};
