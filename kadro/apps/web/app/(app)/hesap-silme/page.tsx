import { loadWebEnv } from '@kadro/config';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import Link from 'next/link';

import styles from '../../../components/auth/auth.module.css';
import { AuthShell } from '../../../components/auth/auth-shell';
import { DeleteAccount, DeleteAccountSignedOut } from '../../../components/auth/delete-account';
import { emailLinkMetadata } from '../../../components/auth/metadata';
import { PAGE_PATHS } from '../../../lib/client/redirects';

export const metadata: Metadata = emailLinkMetadata('Hesap silme', { tokenPage: false });

/**
 * `/hesap-silme` (security checklist item 21, ADR-0032, ADR-0040): explains the deletion and the
 * 7-day grace period for everyone, and lets a signed-in web user start it. Whether a session
 * cookie is present only selects the form; the API decides whether the session is valid.
 */
export default async function DeleteAccountPage() {
  const env = loadWebEnv();
  const jar = await cookies();
  const signedIn = jar.has(env.SESSION_COOKIE_NAME);
  return (
    <AuthShell
      title="Hesap silme"
      lead="Kadro hesabını uygulamadan (Profil › Hesabı sil) ya da bu sayfadan silebilirsin."
    >
      <section className={styles.section} aria-labelledby="deletion-how">
        <h2 id="deletion-how" className={styles.subtitle}>
          Nasıl işler?
        </h2>
        <ul className={styles.list}>
          <li>Talebin alındığı anda hesabın kapanır ve tüm cihazlarda oturumun sonlanır.</li>
          <li>7 gün boyunca vazgeçebilirsin: bu süre içinde giriş yapman talebi iptal eder.</li>
          <li>
            7 gün sonra profilin, fotoğrafların, yorumların ve başvuruların kalıcı olarak silinir.
          </li>
          <li>
            Oynanan maçların geçmişi isimsiz olarak kalır. Tek üyesi olduğun takımlar silinir; diğer
            takımlarda kaptanlık başka bir üyeye geçer.
          </li>
          <li>Silme tamamlandığında e-posta adresine bir onay gönderilir.</li>
        </ul>
      </section>
      <section aria-labelledby="deletion-start">
        <h2 id="deletion-start" className={styles.subtitle}>
          Silme talebi
        </h2>
        {signedIn ? (
          <DeleteAccount csrfCookieName={env.CSRF_COOKIE_NAME} />
        ) : (
          <DeleteAccountSignedOut />
        )}
      </section>
      <p className={styles.hint}>
        Vazgeçmek için{' '}
        <Link href={PAGE_PATHS.login} className={styles.link}>
          giriş yap
        </Link>
        .
      </p>
    </AuthShell>
  );
}
