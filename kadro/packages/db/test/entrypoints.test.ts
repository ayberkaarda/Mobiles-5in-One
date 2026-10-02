/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';

/** Raw source of every module under src, keyed by path relative to this file. */
const sources = import.meta.glob<string>('../src/**/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
});

function resolveImport(from: string, specifier: string): string {
  const base = from.slice(0, from.lastIndexOf('/'));
  const parts = `${base}/${specifier}`.split('/');
  const stack: string[] = [];
  for (const part of parts) {
    if (part === '..' && stack.length > 0 && stack[stack.length - 1] !== '..') stack.pop();
    else if (part !== '.') stack.push(part);
  }
  return stack.join('/').replace(/\.js$/, '.ts');
}

/** Local modules reachable from an entry file through static imports and re-exports. */
function reachable(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop();
    if (file === undefined || seen.has(file)) continue;
    const source = sources[file];
    if (source === undefined) throw new Error(`unknown module ${file}`);
    seen.add(file);
    for (const match of source.matchAll(/(?:import|export)[^'"]*?from\s+'(\.[^']+)'/g)) {
      const specifier = match[1];
      if (specifier !== undefined) queue.push(resolveImport(file, specifier));
    }
  }
  return seen;
}

describe('package entry points', () => {
  it.each(['../src/index.ts', '../src/schema/index.ts', '../src/seed/index.ts'])(
    '%s stays bundleable: it never reaches the migrator or file-relative URLs',
    (entry) => {
      const modules = reachable(entry);
      expect(modules.has('../src/migrate.ts')).toBe(false);
      for (const file of modules) {
        expect(sources[file], file).not.toContain('import.meta.url');
        expect(sources[file], file).not.toContain('drizzle-orm/node-postgres/migrator');
      }
    },
  );

  it('the migrate subpath owns the migrations folder resolution', () => {
    expect(sources['../src/migrate.ts']).toContain('import.meta.url');
  });
});
