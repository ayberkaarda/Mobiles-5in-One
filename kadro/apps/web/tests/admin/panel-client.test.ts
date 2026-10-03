import { type ErrorCode } from '@kadro/contracts';
import { describe, expect, it } from 'vitest';

import { groupedSecret } from '../../components/admin/enroll-totp';
import { auditActionLabel, issueLabel, roleLabel } from '../../components/admin/labels';
import { currentSection } from '../../components/admin/panel-nav';
import { ADMIN_PATHS, importStatusPath, withQuery } from '../../components/admin/paths';
import { pendingSummary } from '../../components/admin/user-actions';
import { csvFileProblem } from '../../components/admin/venue-import-form';
import {
  adminFailure,
  type AdminMutation,
  buildAdminRequest,
  mutationTarget,
  normalizeTotpCode,
} from '../../lib/admin/client-api';
import { type ApiOutcome } from '../../lib/client/api';

/**
 * Browser side of the staff panel (ADR-0068): fixed same-origin targets, the CSRF header on every
 * signed-in mutation, ids that cannot change a path, and messages chosen by problem code only.
 */

const ID = '0192a5e4-7b3c-7d2e-8f10-123456789abc';

describe('admin mutation requests', () => {
  it('maps every mutation to a fixed /api/v1 path and method', () => {
    const cases: [AdminMutation, string, string][] = [
      [{ kind: 'login', body: { email: 'a@b.co', password: 'x' } }, '/api/v1/auth/login', 'POST'],
      [{ kind: 'logout', body: {} }, '/api/v1/auth/logout', 'POST'],
      [{ kind: 'stepUp', body: { totpCode: '123456' } }, '/api/v1/admin/step-up', 'POST'],
      [{ kind: 'totpEnroll', body: { password: 'x' } }, '/api/v1/admin/totp/enroll', 'POST'],
      [{ kind: 'totpConfirm', body: { totpCode: '1' } }, '/api/v1/admin/totp/confirm', 'POST'],
      [
        { kind: 'verifyVenue', id: ID, body: { verified: true } },
        `/api/v1/admin/venues/${ID}`,
        'PATCH',
      ],
      [
        { kind: 'importVenues', body: { csv: 'a', dryRun: true } },
        '/api/v1/admin/venues/import',
        'POST',
      ],
      [
        { kind: 'setRole', id: ID.toUpperCase(), body: { role: 'admin', totpCode: '1' } },
        `/api/v1/admin/users/${ID}/role`,
        'PATCH',
      ],
      [
        { kind: 'setDeactivated', id: ID, body: { deactivated: true, totpCode: '1' } },
        `/api/v1/admin/users/${ID}/deactivate`,
        'PATCH',
      ],
    ];
    for (const [mutation, path, method] of cases) {
      expect(mutationTarget(mutation)).toEqual({ path, method });
    }
  });

  it('refuses ids that would change the path', () => {
    for (const id of ['../me', `${ID}/../x`, `${ID}?a=1`, '', 'not-an-id', `${ID}%2f`]) {
      expect(() => mutationTarget({ kind: 'verifyVenue', id, body: { verified: true } })).toThrow(
        TypeError,
      );
    }
  });

  it('sends the web client header, JSON and the CSRF header on signed-in mutations', () => {
    const request = buildAdminRequest(
      { kind: 'setRole', id: ID, body: { role: 'moderator', totpCode: '123456' } },
      'csrf-value',
    );
    const headers = new Headers(request.init.headers);
    expect(request.url).toBe(`/api/v1/admin/users/${ID}/role`);
    expect(request.init.method).toBe('PATCH');
    expect(headers.get('x-kadro-client')).toBe('web');
    expect(headers.get('x-csrf-token')).toBe('csrf-value');
    expect(headers.get('content-type')).toBe('application/json');
    expect(request.init.credentials).toBe('same-origin');
    expect(request.init.mode).toBe('same-origin');
    expect(request.init.redirect).toBe('error');
    expect(request.init.referrerPolicy).toBe('no-referrer');
    expect(JSON.parse(String(request.init.body))).toEqual({
      role: 'moderator',
      totpCode: '123456',
    });
  });

  it('requires the CSRF token except for sign-in, which never sends it', () => {
    expect(() => buildAdminRequest({ kind: 'stepUp', body: { totpCode: '1' } }, null)).toThrow(
      TypeError,
    );
    expect(() => buildAdminRequest({ kind: 'logout', body: {} }, '')).toThrow(TypeError);
    const login = buildAdminRequest(
      { kind: 'login', body: { email: 'a@b.co', password: 'x' } },
      'csrf-value',
    );
    expect(new Headers(login.init.headers).has('x-csrf-token')).toBe(false);
  });
});

describe('admin failure messages', () => {
  const problem = (status: number, code: ErrorCode | null): ApiOutcome => ({
    kind: 'problem',
    status,
    code,
  });

  it('succeeds without a message', () => {
    expect(adminFailure('stepUp', { kind: 'ok', status: 200, body: {} })).toBeNull();
  });

  it('sends expired sessions to sign-in and expired windows to the step-up page', () => {
    expect(adminFailure('setRole', problem(401, 'unauthenticated'))?.action).toBe('sign_in');
    expect(adminFailure('setRole', problem(403, 'csrf_failed'))?.action).toBe('sign_in');
    expect(adminFailure('verifyVenue', problem(401, 'step_up_required'))?.action).toBe('step_up');
    expect(adminFailure('login', problem(401, 'account_deactivated'))?.action).toBe('none');
  });

  it('explains TOTP, permission and conflict outcomes in Turkish', () => {
    expect(adminFailure('stepUp', problem(401, 'totp_invalid'))?.message).toMatch(/Kod hatalı/);
    expect(adminFailure('stepUp', problem(409, 'totp_not_enrolled'))?.message).toMatch(
      /kurulmamış/,
    );
    expect(adminFailure('totpConfirm', problem(409, 'totp_not_enrolled'))?.message).toMatch(
      /baştan/,
    );
    expect(adminFailure('totpEnroll', problem(401, 'reauth_required'))?.message).toMatch(
      /Şifren doğrulanamadı/,
    );
    expect(adminFailure('setRole', problem(403, 'forbidden'))?.message).toBe(
      'Bu işlem için yetkin yok.',
    );
    expect(adminFailure('setRole', problem(409, 'last_admin'))?.message).toMatch(/Son aktif/);
    expect(adminFailure('setDeactivated', problem(409, 'deletion_pending'))?.message).toMatch(
      /silme talebi/,
    );
    expect(adminFailure('totpEnroll', problem(503, 'service_unavailable'))?.message).toMatch(
      /yapılandırılmamış/,
    );
    expect(adminFailure('importVenues', problem(400, null))?.message).toMatch(/kontrol edip/);
    expect(adminFailure('importVenues', problem(500, 'internal_error'))?.message).toMatch(
      /tamamlayamadık/,
    );
  });

  it('turns rate limits and network failures into messages without server text', () => {
    expect(
      adminFailure('stepUp', { kind: 'rate_limited', retryAfterSeconds: 120 })?.message,
    ).toMatch(/2 dakika/);
    expect(adminFailure('stepUp', { kind: 'network' })?.message).toMatch(/Bağlantı/);
  });
});

describe('panel helpers', () => {
  it('normalizes six-digit codes only', () => {
    expect(normalizeTotpCode('123 456')).toBe('123456');
    expect(normalizeTotpCode(' 012345 ')).toBe('012345');
    for (const value of ['12345', '1234567', '12a456', '', '١٢٣٤٥٦']) {
      expect(normalizeTotpCode(value), value).toBeNull();
    }
  });

  it('builds import status paths from ids only', () => {
    expect(importStatusPath(ID.toUpperCase())).toBe(`/admin/sahalar/ice-aktar/${ID}`);
    expect(importStatusPath('../denetim')).toBeNull();
  });

  it('adds only non-empty query entries to panel links', () => {
    expect(withQuery(ADMIN_PATHS.users, { q: 'Ali Veli', role: '', cursor: undefined })).toBe(
      '/admin/kullanicilar?q=Ali+Veli',
    );
    expect(withQuery(ADMIN_PATHS.auditLog, {})).toBe('/admin/denetim');
  });

  it('marks the section of the current path', () => {
    expect(currentSection('/admin/sahalar')).toBe('/admin/sahalar');
    expect(currentSection(`/admin/sahalar/ice-aktar/${ID}`)).toBe('/admin/sahalar/ice-aktar');
    expect(currentSection('/admin/kullanicilarx')).toBeNull();
  });

  it('checks the CSV file before reading it', () => {
    expect(csvFileProblem(null)).toMatch(/CSV/);
    expect(csvFileProblem({ name: 'liste.xlsx', size: 10 })).toMatch(/\.csv/);
    expect(csvFileProblem({ name: 'liste.csv', size: 0 })).toMatch(/boş/);
    expect(csvFileProblem({ name: 'liste.CSV', size: 900_001 })).toMatch(/büyük/);
    expect(csvFileProblem({ name: 'liste.csv', size: 900_000 })).toBeNull();
  });

  it('formats labels and summaries in Turkish', () => {
    expect(groupedSecret('JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP')).toBe(
      'JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP',
    );
    expect(roleLabel('moderator')).toBe('Moderatör');
    expect(issueLabel('unknown_district')).toBe('İl / ilçe bulunamadı.');
    expect(issueLabel('something_new')).toBe('something_new');
    expect(auditActionLabel('venue.verified')).toBe('Saha onaylandı');
    expect(auditActionLabel('team.created')).toBe('team.created');
    expect(pendingSummary('Ayşe', { kind: 'role', role: 'admin' })).toBe(
      'Ayşe için rol "Yönetici" olacak.',
    );
    expect(pendingSummary('Ayşe', { kind: 'deactivate', deactivated: true })).toMatch(
      /engellenecek/,
    );
  });
});
