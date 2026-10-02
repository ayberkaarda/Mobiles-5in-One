import { buildResources, type Resources } from './resources';

/**
 * Every `src/i18n/<language>/<namespace>.json` compiled into the bundle. Metro resolves
 * `require.context` at build time, so a namespace file added later is picked up without a code
 * change, and a namespace whose file is not present yet stays empty instead of breaking the build.
 */
export function bundledResources(): Resources {
  const context = require.context('./', true, /^\.\/(tr|en)\/[a-z]+\.json$/);
  const files = Object.fromEntries(context.keys().map((key) => [key, context(key)]));
  return buildResources(files);
}
