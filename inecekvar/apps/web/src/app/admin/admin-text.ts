// Turkish copy of the admin area. The web app has no translation mechanism (ADR-0040); like the
// public pages, the admin keeps its text in TypeScript constants.

export const ROLE_LABELS: Readonly<Record<string, string>> = {
  user: 'Kullanıcı',
  contributor: 'Katkıcı',
  moderator: 'Moderatör',
  admin: 'Yönetici',
};

export const AUDIT_ACTION_LABELS: Readonly<Record<string, string>> = {
  'moderation.approve': 'Öneri onayı',
  'moderation.reject': 'Öneri reddi',
  'moderation.rollback': 'Sürüm geri alma',
  'admin.user_role': 'Rol değişikliği',
  'admin.export': 'Yönetici dışa aktarımı',
  'admin.users_read': 'Kullanıcı listesi okundu',
  'admin.audit_read': 'Denetim kaydı okundu',
  'auth.step_up': 'Ek doğrulama',
  'auth.step_up_failed': 'Hatalı doğrulama kodu',
  'totp.enrol': 'TOTP kurulumu başladı',
  'totp.confirm': 'TOTP açıldı',
  'totp.confirm_failed': 'Hatalı TOTP onayı',
  'totp.disable': 'TOTP kapatıldı',
};

const timeFormat = new Intl.DateTimeFormat('tr-TR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Istanbul',
});

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? '—' : timeFormat.format(at);
}
