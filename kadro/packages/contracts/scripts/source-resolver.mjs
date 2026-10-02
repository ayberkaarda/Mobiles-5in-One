import { registerHooks } from 'node:module';

/**
 * Lets Node.js run the TypeScript sources directly (type stripping): the sources import siblings
 * as `./name.js`, as required by NodeNext resolution, so a relative `.js` specifier that does not
 * exist falls back to the `.ts` file next to it.
 */
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (specifier.startsWith('.') && specifier.endsWith('.js')) {
        return nextResolve(`${specifier.slice(0, -3)}.ts`, context);
      }
      throw error;
    }
  },
});
