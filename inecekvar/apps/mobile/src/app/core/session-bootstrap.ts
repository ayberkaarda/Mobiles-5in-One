import { inject, Injector } from '@angular/core';
import { Router } from '@angular/router';
import { App } from '@capacitor/app';
import { IS_NATIVE_PLATFORM, SessionStore } from '@inecekvar/data-access';
import { resolveDeepLink } from './deep-link';

type UrlOpenSource = Pick<typeof App, 'addListener'>;

/**
 * Runs inside an app initializer, before the router's first navigation: the magic-link token is
 * taken out of the address bar synchronously, the session check then runs in the background so
 * the first render does not wait for the network. In the native shell, app links arrive through
 * `appUrlOpen` and are routed through the allowlist of `resolveDeepLink`: line and stop pages,
 * the magic-link page (its token is captured in memory, never routed) or the not-found page.
 *
 * The returned promise settles (never rejects) once the start-up retry of a pending trace draft
 * cleanup has finished. Start-up does not wait for it; callers that need the result can.
 */
export function bootstrapSession(appPlugin: UrlOpenSource = App): Promise<void> {
  const session = inject(SessionStore);
  const injector = inject(Injector);
  const cleanup = import('../contribute/trace-draft')
    .then(({ TraceDraftStore }) => injector.get(TraceDraftStore).retryCleanup())
    .catch(() => undefined);
  void session.init();
  if (inject(IS_NATIVE_PLATFORM)) {
    void appPlugin.addListener('appUrlOpen', ({ url }) => {
      const target = resolveDeepLink(url);
      if (target.kind === 'magic-link') session.consumeMagicLinkUrl(url);
      void injector
        .get(Router)
        .navigateByUrl(target.path)
        .catch(() => false);
    });
  }
  return cleanup;
}
