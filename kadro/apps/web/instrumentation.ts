import { warmUp } from '#auth-warm-up';

/**
 * Next.js start-up hook. On the Node.js runtime it computes the Argon2id dummy hash that login
 * verifies against for unknown and social-only accounts, so the first login of a fresh process
 * costs the same for unknown emails as for known ones (threat model T-AUTH-03). The edge build
 * resolves `#auth-warm-up` to a no-op through the `edge-light` condition (package.json
 * `imports`), so no Argon2 code reaches an edge bundle.
 */
export async function register(): Promise<void> {
  await warmUp();
}
