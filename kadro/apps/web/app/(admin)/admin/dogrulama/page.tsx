import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { AdminCard, Notice } from '../../../../components/admin/frames';
import { ADMIN_PATHS } from '../../../../components/admin/paths';
import { StepUpForm } from '../../../../components/admin/step-up-form';
import { csrfCookieName, panelViewer } from '../../../../lib/admin/session';

export const metadata: Metadata = { title: 'Doğrulama' };

/** TOTP step-up of the current web session (15 minutes, ADR-0066 §5). */
export default async function AdminStepUpPage() {
  const viewer = await panelViewer();
  if (viewer.kind === 'signed_out') {
    redirect('/admin/giris');
  }
  if (viewer.kind === 'not_staff') {
    return (
      <AdminCard title="Erişim yok">
        <Notice>Bu alan yalnızca yetkili ekip içindir.</Notice>
        <Link href="/">Ana sayfaya dön</Link>
      </AdminCard>
    );
  }
  if (viewer.kind === 'unavailable') {
    return (
      <AdminCard title="Doğrulama">
        <Notice>Şu an hesabın okunamadı. Biraz sonra tekrar dene.</Notice>
      </AdminCard>
    );
  }
  return (
    <AdminCard
      title="Kimliğini doğrula"
      lead="Yönetim işlemleri için doğrulama uygulamandaki kodu gir. Doğrulama bu oturumda 15 dakika geçerli."
    >
      <StepUpForm csrfCookieName={await csrfCookieName()} />
      <p>
        <Link href={ADMIN_PATHS.venues}>Panele dön</Link>
      </p>
    </AdminCard>
  );
}
