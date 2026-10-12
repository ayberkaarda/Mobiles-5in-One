import { InjectionToken } from '@angular/core';
import { browserCaches, CachePackStorage } from './cache-pack-storage';
import { FilesystemPackStorage, nativeFilesystem } from './filesystem-pack-storage';
import { choosePackStorage, PackStorage } from './pack-storage';

/** The pack storage of this runtime: Filesystem natively, Cache Storage in the PWA. */
export const PACK_STORAGE = new InjectionToken<PackStorage>('PACK_STORAGE', {
  providedIn: 'root',
  factory: () =>
    choosePackStorage({
      filesystem: () => new FilesystemPackStorage(nativeFilesystem()),
      cache: () => new CachePackStorage(browserCaches()),
    }),
});
