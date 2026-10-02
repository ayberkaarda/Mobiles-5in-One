import { displayNameIssue, type ValidationKey } from '../auth/validation';
import { type Level, type MeResponse, type Position, type UpdateMeRequest } from './contracts';

/** Order of the choices on the edit screen (contracts `POSITIONS`, `LEVELS`; tests compare). */
export const PROFILE_POSITIONS: readonly Position[] = ['GK', 'DEF', 'MID', 'FWD'];
export const PROFILE_LEVELS: readonly Level[] = ['casual', 'regular', 'competitive'];

/** Values of the edit form. `null` means "not set" and clears the field on the server. */
export interface ProfileValues {
  readonly displayName: string;
  readonly position: Position | null;
  readonly level: Level | null;
  readonly districtId: string | null;
}

export function profileValues(me: MeResponse): ProfileValues {
  return {
    displayName: me.displayName,
    position: me.position,
    level: me.level,
    districtId: me.districtId,
  };
}

/**
 * Field checks of the edit form; the display name follows the contract's `displayNameSchema`
 * (the same check as registration, compared with the schema in tests). The other fields are
 * choices from fixed lists and need no check.
 */
export function profileIssues(values: ProfileValues): Record<string, ValidationKey | null> {
  return { displayName: displayNameIssue(values.displayName) };
}

/**
 * The `PATCH me` body: only the fields that differ from the profile the form started from, the
 * name trimmed. `null` when nothing changed, because the contract refuses an empty body.
 */
export function changedProfileFields(
  me: MeResponse,
  values: ProfileValues,
): UpdateMeRequest | null {
  const body: {
    displayName?: string;
    position?: Position | null;
    level?: Level | null;
    districtId?: string | null;
  } = {};
  const name = values.displayName.trim();
  if (name !== me.displayName) {
    body.displayName = name;
  }
  if (values.position !== me.position) {
    body.position = values.position;
  }
  if (values.level !== me.level) {
    body.level = values.level;
  }
  if (values.districtId !== me.districtId) {
    body.districtId = values.districtId;
  }
  return Object.keys(body).length === 0 ? null : body;
}

/** Form fields the server may name in a `validation_failed` answer. */
export const PROFILE_FIELDS = ['displayName', 'position', 'level', 'districtId'] as const;
export type ProfileField = (typeof PROFILE_FIELDS)[number];

/**
 * The form field a server field error points at: its path is `body.<field>` (the API prefixes
 * the input location); anything else (`body`, nested or masked segments) names no single field.
 */
export function profileFieldOf(path: string): ProfileField | null {
  const field = path.startsWith('body.') ? path.slice('body.'.length) : null;
  return field !== null && (PROFILE_FIELDS as readonly string[]).includes(field)
    ? (field as ProfileField)
    : null;
}
