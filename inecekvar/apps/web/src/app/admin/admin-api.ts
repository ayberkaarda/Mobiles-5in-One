import { inject, Injectable } from '@angular/core';
import { ApiClient, type Schemas } from '@inecekvar/data-access';

export type QueueEdit = Schemas['QueueOut'];
export type EditSummary = Schemas['EditOut'];
export type VersionSummary = Schemas['VersionOut'];
export type TotpStatus = Schemas['TotpStatusOut'];
export type TotpEnrolment = Schemas['TotpEnrolOut'];
export type StepUpResult = Schemas['StepUpOut'];
export type AdminUser = Schemas['AdminUserOut'];
export type AdminUserPage = Schemas['AdminUserPage'];
export type AuditLogPage = Schemas['AuditLogPage'];
export type AuditLogRow = Schemas['AuditLogOut'];
export type AdminExport = Schemas['AdminExportOut'];
export type Role = Schemas['UserRole'];
export type CitySummary = Schemas['CityOut'];
export type LineSummary = Schemas['LineListOut'];
export type LineDetail = Schemas['LineOut'];

export const ROLES: readonly Role[] = ['user', 'contributor', 'moderator', 'admin'];
export const PAGE_SIZE = 25;

export interface AuditQuery {
  limit: number;
  offset: number;
  action?: string;
  target_type?: string;
  actor_id?: string;
  target_id?: string;
  since: string;
  until: string;
}

/**
 * The moderation, admin and TOTP routes of docs/api/openapi.json, through the shared client
 * (same-origin `/api/v1`, cookie session, CSRF header on mutations). Every permission is
 * decided by the API; nothing here checks a role.
 */
@Injectable()
export class AdminApi {
  private readonly api = inject(ApiClient);

  queue(limit = 50, offset = 0): Promise<QueueEdit[]> {
    return this.api.request({
      method: 'GET',
      path: '/moderation/edits',
      query: { state: 'pending', limit, offset },
    });
  }

  /** The caller's own proposals; the queue marks them so the reviewer cannot approve them. */
  myEdits(limit = 100): Promise<EditSummary[]> {
    return this.api.request({ method: 'GET', path: '/edits', query: { limit, offset: 0 } });
  }

  approve(id: string): Promise<EditSummary> {
    return this.api.request({
      method: 'POST',
      path: '/moderation/edits/{identity}/approve',
      params: { identity: id },
    });
  }

  reject(id: string, reason: string): Promise<EditSummary> {
    return this.api.request({
      method: 'POST',
      path: '/moderation/edits/{identity}/reject',
      params: { identity: id },
      body: { reason },
    });
  }

  rollback(lineId: string, versionNo: number): Promise<VersionSummary> {
    return this.api.request({
      method: 'POST',
      path: '/moderation/lines/{identity}/rollback',
      params: { identity: lineId },
      body: { version_no: versionNo },
    });
  }

  cities(): Promise<CitySummary[]> {
    return this.api.request({ method: 'GET', path: '/cities' });
  }

  lines(city: string, q?: string): Promise<LineSummary[]> {
    return this.api.request({
      method: 'GET',
      path: '/lines',
      query: { city, q: q || undefined, limit: 50 },
    });
  }

  line(slug: string, city: string): Promise<LineDetail> {
    return this.api.request({
      method: 'GET',
      path: '/lines/{slug}',
      params: { slug },
      query: { city },
    });
  }

  versions(slug: string, city: string): Promise<VersionSummary[]> {
    return this.api.request({
      method: 'GET',
      path: '/lines/{slug}/versions',
      params: { slug },
      query: { city },
    });
  }

  totpStatus(): Promise<TotpStatus> {
    return this.api.request({ method: 'GET', path: '/me/totp' });
  }

  enrolTotp(): Promise<TotpEnrolment> {
    return this.api.request({ method: 'POST', path: '/me/totp/enrol', body: {} });
  }

  confirmTotp(code: string): Promise<TotpStatus> {
    return this.api.request({ method: 'POST', path: '/me/totp/confirm', body: { code } });
  }

  stepUp(code: string): Promise<StepUpResult> {
    return this.api.request({ method: 'POST', path: '/auth/step-up', body: { code } });
  }

  users(offset: number, role: Role | null): Promise<AdminUserPage> {
    return this.api.request({
      method: 'GET',
      path: '/admin/users',
      query: { limit: PAGE_SIZE, offset, role },
    });
  }

  changeRole(id: string, role: Role): Promise<AdminUser> {
    return this.api.request({
      method: 'PATCH',
      path: '/admin/users/{identity}/role',
      params: { identity: id },
      body: { role },
    });
  }

  exportCity(city: string): Promise<AdminExport> {
    return this.api.request({
      method: 'POST',
      path: '/admin/exports/{city}',
      params: { city },
    });
  }

  auditLogs(query: AuditQuery): Promise<AuditLogPage> {
    return this.api.request({ method: 'GET', path: '/admin/audit-logs', query: { ...query } });
  }
}
