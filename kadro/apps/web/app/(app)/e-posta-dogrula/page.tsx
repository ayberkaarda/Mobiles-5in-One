import type { Metadata } from 'next';

import { AuthShell } from '../../../components/auth/auth-shell';
import { emailLinkMetadata } from '../../../components/auth/metadata';
import { VerifyEmail } from '../../../components/auth/verify-email';

export const metadata: Metadata = emailLinkMetadata('E-postanı doğrula', { tokenPage: true });

export default function VerifyEmailPage() {
  return (
    <AuthShell title="E-postanı doğrula">
      <VerifyEmail />
    </AuthShell>
  );
}
