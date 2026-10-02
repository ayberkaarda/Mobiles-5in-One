import { createBreachChecker, type FetchLike, type PasswordBreachChecker } from '@kadro/auth';

import { type JwksFetch } from '../oauth/jwks';
import {
  createProviderVerifiers,
  type ProviderTokenVerifier,
  type ProviderVerifiers,
} from '../oauth/providers';
import { type ServerRuntime } from '../runtime';

/**
 * Collaborators of the auth endpoints that talk to the outside world: the Have I Been Pwned range
 * API and the Apple and Google key sets. Emails are not sent from the web process; they are
 * `email.send` jobs (ADR-0029, `lib/server/jobs/email.ts`). Services are built lazily per runtime
 * from its validated configuration; tests install stubs with {@link installAuthServices}.
 */

export interface AuthServices {
  readonly breachChecker: PasswordBreachChecker;
  readonly apple: ProviderTokenVerifier;
  readonly google: ProviderTokenVerifier;
}

const globalFetch = (url: string, init: RequestInit) => fetch(url, init);

export function createAuthServices(runtime: ServerRuntime): AuthServices {
  const verifiers: ProviderVerifiers = createProviderVerifiers(runtime.env, {
    fetch: globalFetch as JwksFetch,
    onStaleKeys: ({ state, url }) => {
      const metric = state === 'stale' ? 'jwks_stale_keys' : 'jwks_keys_expired';
      runtime.metrics.increment(metric);
      runtime.logger.warn({ metric, jwksUrl: url }, 'provider key set refresh failing');
    },
  });
  return {
    breachChecker: createBreachChecker({ fetch: globalFetch as FetchLike }),
    apple: verifiers.apple,
    google: verifiers.google,
  };
}

const SERVICES = new WeakMap<ServerRuntime, AuthServices>();

export function authServices(runtime: ServerRuntime): AuthServices {
  let services = SERVICES.get(runtime);
  if (services === undefined) {
    services = createAuthServices(runtime);
    SERVICES.set(runtime, services);
  }
  return services;
}

/** Replaces the services of a runtime (tests: stub fetches). */
export function installAuthServices(runtime: ServerRuntime, services: AuthServices): void {
  SERVICES.set(runtime, services);
}
