import { type MeResponse, type UpdateMeRequest } from '@kadro/contracts';
import { districts, type NewUser, users } from '@kadro/db';
import { eq } from 'drizzle-orm';

import { loadEntitlements } from '../billing/entitlements';
import { ApiError } from '../errors';
import { type ServerRuntime } from '../runtime';
import { mediaUrlBuilder } from '../uploads/urls';
import { validationError } from '../validate';
import { findUserById, toMeResponse } from './profile';

/**
 * `GET me` / `PATCH me` (matrix §3.2, field rules §4.1). The body schema is strict and lists only
 * the self-writable fields; this module maps exactly those fields onto columns, so `role`,
 * `email`, `email_verified_at`, `password_hash`, provider subjects, `totp_secret_enc` and
 * `deactivated_at` have no write path here even if the schema were loosened.
 */

export async function readMe(runtime: ServerRuntime, userId: string): Promise<MeResponse> {
  const user = await findUserById(runtime.db, userId);
  if (user === undefined) {
    throw new ApiError('unauthenticated');
  }
  const entitlements = await loadEntitlements(runtime.db, user.id, runtime.now());
  return toMeResponse(user, mediaUrlBuilder(runtime.env), entitlements);
}

type SelfWritable = Partial<Pick<NewUser, 'displayName' | 'position' | 'level' | 'districtId'>>;

function selfWritableChanges(body: UpdateMeRequest): SelfWritable {
  const changes: SelfWritable = {};
  if (body.displayName !== undefined) {
    changes.displayName = body.displayName;
  }
  if (body.position !== undefined) {
    changes.position = body.position;
  }
  if (body.level !== undefined) {
    changes.level = body.level;
  }
  if (body.districtId !== undefined) {
    changes.districtId = body.districtId;
  }
  return changes;
}

export async function updateMe(
  runtime: ServerRuntime,
  userId: string,
  body: UpdateMeRequest,
): Promise<MeResponse> {
  const changes = selfWritableChanges(body);
  if (changes.districtId !== undefined && changes.districtId !== null) {
    const [district] = await runtime.db
      .select({ id: districts.id })
      .from(districts)
      .where(eq(districts.id, changes.districtId))
      .limit(1);
    if (district === undefined) {
      throw validationError('body', 'not_found', 'districtId');
    }
  }
  const [updated] = await runtime.db
    .update(users)
    .set(changes)
    .where(eq(users.id, userId))
    .returning();
  if (updated === undefined) {
    throw new ApiError('unauthenticated');
  }
  const entitlements = await loadEntitlements(runtime.db, updated.id, runtime.now());
  return toMeResponse(updated, mediaUrlBuilder(runtime.env), entitlements);
}
