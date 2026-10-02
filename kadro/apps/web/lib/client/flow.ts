import { type ApiOutcome, type PageEndpoint } from './api';

/**
 * Request state machine shared by the email-link pages. One request can be in flight at a time;
 * success is terminal; an invalid or expired link is terminal (the user needs a new email).
 */

export type Failure =
  | 'link_invalid'
  | 'invalid_credentials'
  | 'account_deactivated'
  | 'password_breached'
  | 'validation'
  | 'signed_out'
  | 'reauth_failed'
  | 'step_up_required'
  | 'deletion_pending'
  | 'last_admin'
  | 'rate_limited'
  | 'network'
  | 'unavailable';

export type FlowState =
  | { readonly status: 'idle' }
  | { readonly status: 'pending' }
  | { readonly status: 'success'; readonly body: unknown }
  | {
      readonly status: 'failure';
      readonly failure: Failure;
      readonly retryAfterSeconds: number | null;
    };

export type FlowEvent =
  | { readonly type: 'submit' }
  | { readonly type: 'settled'; readonly outcome: ApiOutcome; readonly endpoint: PageEndpoint }
  | { readonly type: 'link_rejected' };

export const IDLE: FlowState = Object.freeze({ status: 'idle' });
export const PENDING: FlowState = Object.freeze({ status: 'pending' });

const TERMINAL_FAILURES: ReadonlySet<Failure> = new Set(['link_invalid', 'deletion_pending']);

/** Maps an API outcome of `endpoint` to the failure the page shows; `null` means success. */
export function failureFor(endpoint: PageEndpoint, outcome: ApiOutcome): Failure | null {
  switch (outcome.kind) {
    case 'ok':
      return null;
    case 'network':
      return 'network';
    case 'rate_limited':
      return 'rate_limited';
    case 'problem':
      break;
  }
  const { status, code } = outcome;
  if (status >= 500 || status === 404 || status === 405) {
    return 'unavailable';
  }
  switch (endpoint) {
    case 'verifyEmail':
      // A token the server does not accept and a token it cannot parse look the same (T-WEB-03).
      return status === 400 || code === 'token_invalid' ? 'link_invalid' : 'unavailable';
    case 'reset':
      if (code === 'token_invalid') {
        return 'link_invalid';
      }
      if (code === 'password_breached') {
        return 'password_breached';
      }
      return status === 400 ? 'validation' : 'unavailable';
    case 'forgot':
      return status === 400 ? 'validation' : 'unavailable';
    case 'login':
      if (code === 'invalid_credentials') {
        return 'invalid_credentials';
      }
      if (code === 'account_deactivated') {
        return 'account_deactivated';
      }
      return status === 400 ? 'validation' : 'unavailable';
    case 'deleteAccount':
      switch (code) {
        case 'unauthenticated':
        case 'account_deactivated':
        case 'csrf_failed':
          return 'signed_out';
        case 'reauth_required':
        case 'invalid_credentials':
          return 'reauth_failed';
        case 'step_up_required':
          return 'step_up_required';
        case 'deletion_pending':
          return 'deletion_pending';
        case 'last_admin':
          return 'last_admin';
        default:
          return status === 400 ? 'validation' : 'unavailable';
      }
  }
}

/** True when a new request may start from `state`. */
export function canSubmit(state: FlowState): boolean {
  if (state.status === 'idle') {
    return true;
  }
  return state.status === 'failure' && !TERMINAL_FAILURES.has(state.failure);
}

export function flowReducer(state: FlowState, event: FlowEvent): FlowState {
  switch (event.type) {
    case 'submit':
      return canSubmit(state) ? PENDING : state;
    case 'link_rejected':
      return state.status === 'success'
        ? state
        : { status: 'failure', failure: 'link_invalid', retryAfterSeconds: null };
    case 'settled': {
      if (state.status !== 'pending') {
        return state;
      }
      const failure = failureFor(event.endpoint, event.outcome);
      if (failure === null) {
        return { status: 'success', body: event.outcome.kind === 'ok' ? event.outcome.body : null };
      }
      return {
        status: 'failure',
        failure,
        retryAfterSeconds:
          event.outcome.kind === 'rate_limited' ? event.outcome.retryAfterSeconds : null,
      };
    }
  }
}
