import type { Metadata } from 'next';

import { AuthShell } from '../../../components/auth/auth-shell';
import { emailLinkMetadata } from '../../../components/auth/metadata';
import { ResetPassword } from '../../../components/auth/reset-password';

export const metadata: Metadata = emailLinkMetadata('Yeni şifre belirle', { tokenPage: true });

export default function ResetPasswordPage() {
  return (
    <AuthShell
      title="Yeni şifre belirle"
      lead="Yeni şifreni belirle. Kaydettiğinde tüm cihazlardaki oturumların kapanır."
    >
      <ResetPassword />
    </AuthShell>
  );
}
