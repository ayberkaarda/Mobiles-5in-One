import { type AuthClient } from '@kadro/contracts';

import { type RequestContext } from '../http';
import { type ServerRuntime } from '../runtime';
import { type FlowContext } from './account-flows';
import { authServices, type AuthServices } from './services';
import { type SignInContext } from './sign-in';

/** Builds the context objects of the auth services from a route handler's request context. */

export function flowContext(runtime: ServerRuntime, ctx: RequestContext): FlowContext {
  return {
    runtime,
    services: authServices(runtime),
    logger: ctx.logger,
    ip: ctx.ip,
    requestId: ctx.requestId,
  };
}

/** The validated `x-kadro-client`; auth endpoints are never exempt from the header. */
export function requestClient(ctx: RequestContext): AuthClient {
  if (ctx.client === null) {
    throw new Error('auth endpoints require x-kadro-client');
  }
  return ctx.client;
}

export function signInContext(
  runtime: ServerRuntime,
  ctx: RequestContext,
): SignInContext & { readonly services: AuthServices } {
  return {
    runtime,
    services: authServices(runtime),
    client: requestClient(ctx),
    ip: ctx.ip,
    attempts: ctx.authAttempts,
  };
}
