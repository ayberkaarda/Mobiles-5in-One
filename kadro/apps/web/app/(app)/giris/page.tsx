import type { Metadata } from 'next';

import { AuthShell } from '../../../components/auth/auth-shell';
import { LoginForm } from '../../../components/auth/login-form';
import { emailLinkMetadata } from '../../../components/auth/metadata';
import { afterLoginTarget } from '../../../lib/client/redirects';

export const metadata: Metadata = emailLinkMetadata('Giriş yap', { tokenPage: false });

export default async function LoginPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // `?devam=`: only an exact match of the fixed list is honoured (no open redirect).
  const { devam } = await searchParams;
  const next = afterLoginTarget(devam);
  return (
    <AuthShell
      title="Giriş yap"
      lead="Kadro hesabınla giriş yap. Silme talebin varsa giriş yapınca iptal olur."
    >
      <LoginForm next={next} />
    </AuthShell>
  );
}
