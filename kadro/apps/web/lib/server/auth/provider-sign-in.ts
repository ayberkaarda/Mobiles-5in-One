import { ApiError } from '../errors';
import { type ProviderName } from '../oauth/providers';
import { type AuthServices } from './services';
import { type SignInContext, signInWithProvider } from './sign-in';

/**
 * `POST auth/apple` and `POST auth/google`: verify the identity token, then resolve the account.
 * An invalid token (signature, `alg`, `iss`, `aud`, `exp`, `iat`, nonce) is 401 `token_invalid`
 * and counts as a failed attempt; an unreachable key set is 503 so the client retries later.
 */
export async function providerSignIn(
  context: SignInContext & { readonly services: AuthServices },
  provider: ProviderName,
  input: {
    readonly token: string;
    readonly nonce?: string | undefined;
    readonly displayName?: string | undefined;
    readonly deviceLabel?: string | undefined;
  },
): Promise<Response> {
  const verifier = provider === 'apple' ? context.services.apple : context.services.google;
  const verdict = await verifier.verify(input.token, input.nonce, context.runtime.now());
  if (!verdict.ok) {
    if (verdict.reason === 'unavailable') {
      throw new ApiError('service_unavailable', { headers: { 'Retry-After': '5' } });
    }
    await context.attempts?.recordFailure();
    throw new ApiError('token_invalid');
  }
  return signInWithProvider(context, verdict.identity, {
    displayName: input.displayName,
    deviceLabel: input.deviceLabel,
  });
}
