import type { Metadata } from 'next';

import { AuthShell } from '../../../components/auth/auth-shell';
import { ForgotPassword } from '../../../components/auth/forgot-password';
import { emailLinkMetadata } from '../../../components/auth/metadata';

export const metadata: Metadata = emailLinkMetadata('Şifreni mi unuttun?', { tokenPage: false });

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      title="Şifreni mi unuttun?"
      lead="E-posta adresini yaz, şifreni sıfırlaman için bir bağlantı gönderelim."
    >
      <ForgotPassword />
    </AuthShell>
  );
}
