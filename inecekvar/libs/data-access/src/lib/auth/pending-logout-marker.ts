import { InjectionToken } from '@angular/core';

export interface PendingLogoutMarker {
  isSet(): boolean;
  set(): void;
  clear(): void;
}

export const PENDING_LOGOUT_MARKER = new InjectionToken<PendingLogoutMarker>(
  'PENDING_LOGOUT_MARKER',
  {
    providedIn: 'root',
    factory: () => {
      let pending = false;
      let storageFailed = false;
      const key = 'iv.logout_pending';
      return {
        isSet: () => {
          try {
            const stored = globalThis.localStorage.getItem(key) === '1';
            if (!storageFailed) pending = stored;
          } catch {
            storageFailed = true;
          }
          return pending;
        },
        set: () => {
          pending = true;
          try {
            globalThis.localStorage.setItem(key, '1');
            storageFailed = false;
          } catch {
            storageFailed = true;
          }
        },
        clear: () => {
          pending = false;
          try {
            globalThis.localStorage.removeItem(key);
            storageFailed = false;
          } catch {
            storageFailed = true;
          }
        },
      };
    },
  },
);
