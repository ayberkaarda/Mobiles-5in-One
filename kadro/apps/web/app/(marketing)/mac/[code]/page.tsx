import { loadWebEnv } from '@kadro/config';
import { appDeepLink, webDeepLink } from '@kadro/contracts';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';

import invite from '../../../../components/content/invite.module.css';
import { buttonClassName } from '../../../../components/marketing/button';
import { KitNumeral } from '../../../../components/marketing/kit-numeral';
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
      <div className={`${styles.sectionInner} ${invite.stage}`}>
        <div className={invite.ticket}>
          <p className={invite.eyebrow}>{INVITE_TITLE}</p>
          <h1 className={invite.teamName}>{team.name}</h1>
          {team.district === null ? null : (
            <p className={invite.district}>{`Bölge: ${team.district.ilce}, ${team.district.il}`}</p>
          )}
          <div className={invite.squad}>
            <KitNumeral value={team.memberCount.toLocaleString('tr-TR')} label="oyuncu" />
          </div>
          <p className={invite.caption}>
            Bu bağlantıyla Kadro&apos;da {team.name} takımına katılabilirsin. Daveti uygulamada
            açtığında takımı görür, katılmak isteyip istemediğine sen karar verirsin; bu sayfa
            hiçbir işlem yapmaz.
          </p>
          <section className={invite.actions} aria-labelledby="davet-uygulama">
            <h2 id="davet-uygulama" className={invite.storesTitle}>
              Uygulamada aç
            </h2>
            <p className={invite.storesText}>
              Kadro telefonunda yüklüyse bu düğme daveti doğrudan uygulamada açar. Katılmak için
              e-posta adresi doğrulanmış bir hesapla giriş yapman gerekir.
            </p>
            <a
              href={appDeepLink({ kind: 'teamInvite', code: landing.code })}
              className={buttonClassName('accent')}
            >
              Daveti uygulamada aç
            </a>
          </section>
        </div>
        <section className={invite.stores} aria-labelledby="davet-indir">
          <h2 id="davet-indir" className={invite.storesTitle}>
            Uygulama yüklü değil mi?
          </h2>
          <p className={invite.storesText}>
            Kadro&apos;yu indir, giriş yap ve bu davet bağlantısını yeniden aç.
          </p>
          <StoreBadges entries={stores} />
        </section>
      </div>
    </article>
  );
}
