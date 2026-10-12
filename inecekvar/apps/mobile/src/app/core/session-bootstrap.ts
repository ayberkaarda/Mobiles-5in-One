import { inject, Injector } from '@angular/core';
import { Router } from '@angular/router';
import { App } from '@capacitor/app';
import { IS_NATIVE_PLATFORM, SessionStore } from '@inecekvar/data-access';

type UrlOpenSource = Pick<typeof App, 'addListener'>;

/**
 * Runs inside an app initializer, before the router's first navigation: the magic-link token is
 * taken out of the address bar synchronously, the session check then runs in the background so
 * the first render does not wait for the network. In the native shell, links opened from mail
 * arrive through `appUrlOpen`, are captured the same way and open `/giris/baglanti`.
 */
export function bootstrapSession(appPlugin: UrlOpenSource = App): void {
  const session = inject(SessionStore);
  void session.init();
  if (inject(IS_NATIVE_PLATFORM)) {
    const injector = inject(Injector);
    void appPlugin.addListener('appUrlOpen', ({ url }) => {
      if (session.consumeMagicLinkUrl(url)) {
        void injector
          .get(Router)
          .navigateByUrl('/giris/baglanti')
          .catch(() => false);
      }
    });
  }
}
