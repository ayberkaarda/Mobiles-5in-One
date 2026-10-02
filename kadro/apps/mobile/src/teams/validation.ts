/**
 * Client-side check of the team name. It mirrors `teamNameSchema` in `packages/contracts`
 * (trimmed, 2..60 characters, no control or format characters); a test compares the two. The
 * server stays the authority.
 */
export const TEAM_LIMITS = {
  nameMin: 2,
  nameMax: 60,
} as const;

/** Keys of the `teams` namespace (`validation.*`). */
export type TeamValidationKey =
  'validation.nameTooShort' | 'validation.nameTooLong' | 'validation.nameInvalid';

const HIDDEN_CHARACTERS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

export function teamNameIssue(raw: string): TeamValidationKey | null {
  const name = raw.trim();
  if (name.length < TEAM_LIMITS.nameMin) {
    return 'validation.nameTooShort';
  }
  if (name.length > TEAM_LIMITS.nameMax) {
    return 'validation.nameTooLong';
  }
  if (HIDDEN_CHARACTERS.test(name)) {
    return 'validation.nameInvalid';
  }
  return null;
}
