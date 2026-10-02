import { type Application, type OpenCall } from '@kadro/contracts';
import { openCallApplications, openCalls, users } from '@kadro/db';
import { eq } from 'drizzle-orm';

import { type DbReader } from '../domain/relations';
import { type MediaUrlOf } from '../uploads/urls';

/**
 * Read projections of open calls and applications (authorization matrix §6, footnotes 18 and 33,
 * ADR-0041). An application shows the applicant's public card only (id, display name, avatar,
 * position, level); email, district and other applications are never selected.
 */

export const OPEN_CALL_COLUMNS = {
  id: openCalls.id,
  matchId: openCalls.matchId,
  missingCount: openCalls.missingCount,
  position: openCalls.position,
  level: openCalls.level,
  districtId: openCalls.districtId,
  status: openCalls.status,
  expiresAt: openCalls.expiresAt,
  createdAt: openCalls.createdAt,
};

export interface OpenCallRow {
  readonly id: string;
  readonly matchId: string;
  readonly missingCount: number;
  readonly position: OpenCall['position'];
  readonly level: OpenCall['level'];
  readonly districtId: string;
  readonly status: OpenCall['status'];
  readonly expiresAt: Date;
  readonly createdAt: Date;
}

/** The call as its team staff see it (publish and close responses). */
export function toOpenCall(row: OpenCallRow): OpenCall {
  return {
    id: row.id,
    matchId: row.matchId,
    missingCount: row.missingCount,
    position: row.position,
    level: row.level,
    districtId: row.districtId,
    status: row.status,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

export async function loadOpenCall(db: DbReader, openCallId: string): Promise<OpenCall> {
  const [row] = await db
    .select(OPEN_CALL_COLUMNS)
    .from(openCalls)
    .where(eq(openCalls.id, openCallId))
    .limit(1);
  if (row === undefined) {
    throw new Error('open call is not visible after its write');
  }
  return toOpenCall(row);
}

/** Columns of an application joined to `users` (the applicant's public card only). */
export const APPLICATION_COLUMNS = {
  id: openCallApplications.id,
  openCallId: openCallApplications.openCallId,
  message: openCallApplications.message,
  status: openCallApplications.status,
  createdAt: openCallApplications.createdAt,
  updatedAt: openCallApplications.updatedAt,
  applicantId: users.id,
  displayName: users.displayName,
  avatarKey: users.avatarKey,
  position: users.position,
  level: users.level,
};

export interface ApplicationRow {
  readonly id: string;
  readonly openCallId: string;
  readonly message: string | null;
  readonly status: Application['status'];
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly applicantId: string;
  readonly displayName: string;
  readonly avatarKey: string | null;
  readonly position: Application['applicant']['position'];
  readonly level: Application['applicant']['level'];
}

export function toApplication(row: ApplicationRow, media: MediaUrlOf): Application {
  return {
    id: row.id,
    openCallId: row.openCallId,
    applicant: {
      id: row.applicantId,
      displayName: row.displayName,
      avatarUrl: media(row.avatarKey),
      position: row.position,
      level: row.level,
    },
    message: row.message,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function loadApplication(
  db: DbReader,
  applicationId: string,
  media: MediaUrlOf,
): Promise<Application> {
  const [row] = await db
    .select(APPLICATION_COLUMNS)
    .from(openCallApplications)
    .innerJoin(users, eq(users.id, openCallApplications.userId))
    .where(eq(openCallApplications.id, applicationId))
    .limit(1);
  if (row === undefined) {
    throw new Error('application is not visible after its write');
  }
  return toApplication(row, media);
}
