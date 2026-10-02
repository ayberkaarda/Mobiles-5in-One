import { evaluateNewPassword } from '@kadro/auth';

import { ApiError } from '../errors';
import { type Logger } from '../logging';
import { type ServerRuntime } from '../runtime';
import { validationError } from '../validate';
import { type AuthServices } from './services';

/**
 * Password rule for registration and reset (security checklist item 11): the length rule from
 * `@kadro/contracts` and the Have I Been Pwned range check. The check fails open (ADR-0018): an
 * unreachable service accepts the password, and every check is counted so the alert can compare
 * `password_breach_check_unavailable` with `password_breach_check`. Neither the password nor its
 * hash prefix is logged.
 */
export async function assertAcceptableNewPassword(
  runtime: ServerRuntime,
  services: AuthServices,
  logger: Logger,
  password: string,
): Promise<void> {
  const verdict = await evaluateNewPassword(password, services.breachChecker);
  if (!verdict.ok && verdict.code === 'validation_failed') {
    throw validationError('body', 'too_small', 'password');
  }
  runtime.metrics.increment('password_breach_check');
  if (!verdict.ok) {
    logger.info({ metric: 'password_breach_check', outcome: 'breached' }, 'password breach check');
    throw new ApiError('password_breached');
  }
  if (verdict.breachCheck === 'unavailable') {
    runtime.metrics.increment('password_breach_check_unavailable');
    logger.warn(
      {
        metric: 'password_breach_check_unavailable',
        outcome: 'unavailable',
        reason: verdict.breachCheckReason,
      },
      'password breach check unavailable, password accepted',
    );
    return;
  }
  logger.info({ metric: 'password_breach_check', outcome: 'clean' }, 'password breach check');
}
