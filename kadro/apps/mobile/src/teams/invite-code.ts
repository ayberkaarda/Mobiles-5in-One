/** Invite codes are 22 base64url characters (128 bits, ADR-0011; `LIMITS.inviteCode`). */
export const INVITE_CODE_LENGTH = 22;

const INVITE_CODE = /^[A-Za-z0-9_-]{22}$/;
/** `/mac/<code>` inside a pasted link: https://kadro.app/mac/<code>, kadro://mac/<code>. */
const INVITE_LINK = /(?:^|\/)mac\/([A-Za-z0-9_-]{22})(?=$|[/?#])/;
const MAX_INPUT_LENGTH = 512;

export function isInviteCode(value: string): boolean {
  return INVITE_CODE.test(value);
}

/**
 * The invite code in what a user typed or pasted: the code itself or an invite link that carries
 * it. Anything else is `null`, and nothing is sent to the server for it.
 */
export function parseInviteInput(raw: string): string | null {
  const input = raw.trim();
  if (input.length === 0 || input.length > MAX_INPUT_LENGTH) {
    return null;
  }
  if (isInviteCode(input)) {
    return input;
  }
  return INVITE_LINK.exec(input)?.[1] ?? null;
}
