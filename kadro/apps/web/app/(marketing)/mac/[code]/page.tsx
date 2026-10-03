import { loadWebEnv } from '@kadro/config';
import { appDeepLink, webDeepLink } from '@kadro/contracts';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';

import styles from '../../../../components/marketing/marketing.module.css';
import { StoreBadges } from '../../../../components/marketing/store-badges';
import { configuredStoreEntries } from '../../../../lib/server/app-links';
import { loadInviteLanding } from '../../../../lib/server/invites/landing';

interface InvitePageProps {
  readonly params: Promise<{ readonly code: string }>;
}

const INVITE_TITLE = 'Takım daveti';
const INVITE_DESCRIPTION =
  'Kadro takım daveti: uygulamayı aç, takımı gör ve katılmak isteyip istemediğine karar ver.';

/**
 * Invite metadata (ADR-0034, ADR-0058): never indexed or followed, no referrer (the code in the
 * path is a bearer secret), no canonical and no team name, so a link preview or a browser
 * history entry shows nothing about the team. With `APPLE_APP_STORE_ID` the Smart App Banner of
 * a usable invite passes the invite link to the app (`app-argument`).
 */
export async function generateMetadata({ params }: InvitePageProps): Promise<Metadata> {
  await connection();
  const { code } = await params;
  const env = loadWebEnv();
  const metadata: Metadata = {
    title: INVITE_TITLE,
    description: INVITE_DESCRIPTION,
    robots: { index: false, follow: false },
    referrer: 'no-referrer',
  };
  if (env.APPLE_APP_STORE_ID !== undefined) {
    // Only a usable invite gets the banner, so every 404 renders the same document.
    const landing = await loadInviteLanding(code);
    if (landing.state === 'found') {
      metadata.itunes = {
        appId: env.APPLE_APP_STORE_ID,
        appArgument: webDeepLink(env.WEB_ORIGIN, { kind: 'teamInvite', code: landing.code }),
      };
    }
  }
  return metadata;
}

function memberLabel(count: number): string {
  return `${count.toLocaleString('tr-TR')} oyuncu`;
}

/**
 * Team invite landing (product spec §7 `/mac/[inviteCode]`). The page only describes the invite:
 * joining needs the app, a verified account and an explicit tap (ADR-0034, ADR-0045 decision 7).
 */
export default async function InvitePage({ params }: InvitePageProps) {
  const { code } = await params;
  const landing = await loadInviteLanding(code);
  if (landing.state === 'not-found') {
    notFound();
  }
  const stores = configuredStoreEntries(loadWebEnv());
  if (landing.state === 'rate-limited') {
    return (
      <article>
        <header className={styles.sectionInner}>
          <div className={styles.pageHeader}>
            <h1 className={styles.pageTitle}>{INVITE_TITLE}</h1>
            <p className={styles.pageLead}>
              Kısa sürede çok fazla davet bağlantısı açıldı. Biraz bekleyip bağlantıyı yeniden aç.
            </p>
          </div>
        </header>
      </article>
    );
  }
  const { team } = landing;
  return (
    <article>
      <header className={styles.sectionInner}>
        <div className={styles.pageHeader}>
          <p className={styles.eyebrow}>{INVITE_TITLE}</p>
          <h1 className={styles.pageTitle}>{team.name}</h1>
          <p className={styles.pageLead}>
            Bu bağlantıyla Kadro&apos;da {team.name} takımına katılabilirsin. Daveti uygulamada
            açtığında takımı görür, katılmak isteyip istemediğine sen karar verirsin; bu sayfa
            hiçbir işlem yapmaz.
          </p>
        </div>
      </header>
      <div className={styles.sectionInner}>
        <ul className={styles.cardGrid}>
          <li className={styles.card}>
            <section aria-labelledby="davet-takim">
              <h2 id="davet-takim" className={styles.cardTitle}>
                Takım
              </h2>
              <ul className={styles.featureList}>
                {team.district === null ? null : (
                  <li>{`Bölge: ${team.district.ilce}, ${team.district.il}`}</li>
                )}
                <li>{`Kadro: ${memberLabel(team.memberCount)}`}</li>
              </ul>
            </section>
          </li>
          <li className={styles.card}>
            <section aria-labelledby="davet-uygulama">
              <h2 id="davet-uygulama" className={styles.cardTitle}>
                Uygulamada aç
              </h2>
              <p className={styles.cardText}>
                Kadro telefonunda yüklüyse bu düğme daveti doğrudan uygulamada açar. Katılmak için
                e-posta adresi doğrulanmış bir hesapla giriş yapman gerekir.
              </p>
              <div className={styles.statusActions}>
                <a
                  href={appDeepLink({ kind: 'teamInvite', code: landing.code })}
                  className={styles.buttonSolid}
                >
                  Daveti uygulamada aç
                </a>
              </div>
            </section>
          </li>
        </ul>
      </div>
      <div className={styles.section}>
        <div className={styles.sectionInner}>
          <h2 className={styles.sectionTitle}>Uygulama yüklü değil mi?</h2>
          <p className={styles.cardText}>
            Kadro&apos;yu indir, giriş yap ve bu davet bağlantısını yeniden aç.
          </p>
          <StoreBadges entries={stores} />
        </div>
      </div>
    </article>
  );
}
