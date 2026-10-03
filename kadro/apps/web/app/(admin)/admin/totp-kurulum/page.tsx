import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { EnrollTotp } from '../../../../components/admin/enroll-totp';
import { AdminCard, Notice } from '../../../../components/admin/frames';
import { ADMIN_PATHS } from '../../../../components/admin/paths';
import { csrfCookieName, panelViewer } from '../../../../lib/admin/session';

export const metadata: Metadata = { title: 'Doğrulama kurulumu' };

/** First TOTP enrollment of a staff account (ADR-0064 §2); a reset is an operator action. */
export default async function AdminEnrollPage() {
  const viewer = await panelViewer();
  if (viewer.kind === 'signed_out') {
    redirect('/admin/giris');
  }
  if (viewer.kind !== 'staff') {
    return (
      <AdminCard title="Erişim yok">
        <Notice>
          {viewer.kind === 'not_staff'
            ? 'Bu alan yalnızca yetkili ekip içindir.'
            : 'Şu an hesabın okunamadı. Biraz sonra tekrar dene.'}
        </Notice>
      </AdminCard>
    );
  }
  return (
    <AdminCard
      title="Doğrulama uygulamasını kur"
      lead="Yönetim işlemleri iki adımlı doğrulama ister. Kurulum bir kez yapılır; anahtarı kaybedersen sıfırlama için sistem yöneticisine başvur."
    >
      <EnrollTotp csrfCookieName={await csrfCookieName()} />
      <p>
        <Link href={ADMIN_PATHS.stepUp}>Doğrulama sayfasına dön</Link>
      </p>
    </AdminCard>
  );
}
