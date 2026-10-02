import { z } from 'zod';

/**
 * Primitives shared by the server and mobile schemas. This module must stay free of Node built-ins
 * because the mobile bundle imports it through `@kadro/config/mobile`.
 */

export const APP_ENVIRONMENTS = ['local', 'preview', 'production'] as const;
export type AppEnvironment = (typeof APP_ENVIRONMENTS)[number];

export const NODE_ENVIRONMENTS = ['development', 'test', 'production'] as const;
export type NodeEnvironment = (typeof NODE_ENVIRONMENTS)[number];

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/** Raw key/value source, normally `process.env`. Values are never echoed back in errors. */
export type EnvSource = Readonly<Record<string, string | undefined>>;

export function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export const appEnvironmentSchema = z.enum(APP_ENVIRONMENTS);

export const httpUrlSchema = z.string().refine((value) => {
  const url = parseUrl(value);
  return url !== null && (url.protocol === 'http:' || url.protocol === 'https:');
}, 'must be an absolute http(s) URL');
