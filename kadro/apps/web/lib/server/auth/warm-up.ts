import { warmUpPasswordHashing } from '@kadro/auth';

/** Node.js runtime: computes the Argon2id dummy hash ahead of the first login (T-AUTH-03). */
export function warmUp(): Promise<void> {
  return warmUpPasswordHashing();
}
