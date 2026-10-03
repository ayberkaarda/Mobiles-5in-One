import type { Metadata } from 'next';

import { AdminCard } from '../../../../components/admin/frames';
import { AdminSignInForm } from '../../../../components/admin/sign-in-form';
import { csrfCookieName } from '../../../../lib/admin/session';

export const metadata: Metadata = { title: 'Giriş' };

/** Staff sign-in; the TOTP step-up follows on `/admin/dogrulama`. */
export default async function AdminSignInPage() {
  return (
    <AdminCard
      title="Yönetim girişi"
      lead="Yalnızca yetkili ekip içindir. Girişten sonra doğrulama uygulamandaki kodu soracağız."
    >
      <AdminSignInForm csrfCookieName={await csrfCookieName()} />
    </AdminCard>
  );
}
