/**
 * Public build values only (spec section 6.1): no key, secret or credential belongs here, since
 * everything in this file ships in the JavaScript bundle.
 */
export interface AppEnvironment {
  /**
   * Web and PWA: the same-origin path Caddy proxies to the API, so the session cookie stays
   * first-party (`https://app.inecekvar.app/api/*` in production, `http://127.0.0.1:8081/api/*`
   * through the compose proxy locally).
   */
  readonly webApiBase: string;
  /** Native shell: the API host; Capacitor origins are bearer-only (ADR-0012). */
  readonly nativeApiBase: string;
  /** PMTiles CDN for the offline map tiles. */
  readonly tilesBase: string;
}

export const environment: AppEnvironment = {
  webApiBase: '/api/v1',
  nativeApiBase: 'https://api.inecekvar.app/v1',
  tilesBase: 'https://tiles.inecekvar.app',
};

export function apiBaseFor(env: AppEnvironment, native: boolean): string {
  return native ? env.nativeApiBase : env.webApiBase;
}
