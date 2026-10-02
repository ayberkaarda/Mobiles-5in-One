/**
 * The few Node.js built-ins the scripts use. The package has no runtime dependency on Node.js
 * types, so the scripts declare exactly what they call.
 */
declare module 'node:fs' {
  export function mkdirSync(path: string, options: { recursive: true }): string | undefined;
  export function writeFileSync(path: string, data: string): void;
}

interface ImportMeta {
  /** Directory of the current module (Node.js 20.11+). */
  readonly dirname: string;
}
