import { type Entitlements, type MeResponse } from '@kadro/contracts';
import { type Database, type Transaction, type User, users } from '@kadro/db';
import { eq, sql } from 'drizzle-orm';

import { type MediaUrlOf } from '../uploads/urls';

/**
 * The caller's own profile (`GET me`, auth responses). The projection follows authorization
 * matrix §3.2 / §6: own email and linked sign-in methods, never `password_hash`,
 * `totp_secret_enc` or provider subject identifiers. `entitlements` is the server-side Pro state
 * from `subscriptions` (ADR-0065) and is part of every profile response.
 */

export type Executor = Database | Transaction;

export function toMeResponse(
  user: User,
  media: MediaUrlOf,
  entitlements: Entitlements,
): MeResponse {
  return {
    id: user.id,
    displayName: user.displayName,
    avatarUrl: media(user.avatarKey),
    position: user.position,
    level: user.level,
    email: user.email,
    emailVerified: user.emailVerifiedAt !== null,
    role: user.role,
    districtId: user.districtId,
    providers: {
      password: user.passwordHash !== null,
      apple: user.appleSub !== null,
      google: user.googleSub !== null,
    },
    createdAt: user.createdAt.toISOString(),
    entitlements,
  };
}

export async function findUserById(db: Executor, userId: string): Promise<User | undefined> {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return user;
}

/** Case-insensitive lookup through the `lower(email)` unique index. */
export async function findUserByEmail(db: Executor, email: string): Promise<User | undefined> {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(sql`lower(${users.email})`, email.toLowerCase()))
    .limit(1);
  return user;
}
