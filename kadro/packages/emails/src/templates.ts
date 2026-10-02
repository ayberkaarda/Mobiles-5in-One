import { appLink, renderEmail, type RenderedEmail } from './layout.js';

/**
 * Transactional emails. User-facing copy is Turkish and addresses the reader informally ("sen").
 * Links point at the web app; tokens travel in the URL fragment, so they never reach server access
 * logs or a `Referer` header (ADR-0027, ADR-0040).
 */

/** Web app paths linked from emails. The token pages read the token from the fragment. */
export const EMAIL_LINK_PATHS = {
  verifyEmail: '/e-posta-dogrula',
  resetPassword: '/sifre-sifirla',
  login: '/giris',
  forgotPassword: '/sifremi-unuttum',
  accountDeletion: '/hesap-silme',
} as const;

export interface TokenEmailInput {
  readonly origin: string;
  readonly displayName: string;
  readonly token: string;
}

export function verifyEmailMessage(input: TokenEmailInput): RenderedEmail {
  return renderEmail({
    subject: 'Kadro: e-posta adresini doğrula',
    greetingName: input.displayName,
    intro: ['Kadro hesabını tamamlamak için e-posta adresini doğrula.'],
    links: [
      {
        label: 'E-postamı doğrula',
        href: appLink(input.origin, EMAIL_LINK_PATHS.verifyEmail, input.token),
      },
    ],
    outro: [
      'Bağlantı 24 saat geçerli ve yalnızca bir kez kullanılabilir.',
      'Bu hesabı sen açmadıysan bu e-postayı yok sayabilirsin.',
    ],
  });
}

export function passwordResetMessage(input: TokenEmailInput): RenderedEmail {
  return renderEmail({
    subject: 'Kadro: şifreni sıfırla',
    greetingName: input.displayName,
    intro: ['Şifreni sıfırlamak için aşağıdaki bağlantıyı aç.'],
    links: [
      {
        label: 'Şifremi sıfırla',
        href: appLink(input.origin, EMAIL_LINK_PATHS.resetPassword, input.token),
      },
    ],
    outro: [
      'Bağlantı 1 saat geçerli ve yalnızca bir kez kullanılabilir. Şifreni değiştirdiğinde tüm cihazlardaki oturumların kapanır.',
      'Bu isteği sen yapmadıysan bu e-postayı yok sayabilirsin; şifren değişmez.',
    ],
  });
}

export interface AccountEmailInput {
  readonly origin: string;
  readonly displayName: string;
}

export function alreadyRegisteredMessage(input: AccountEmailInput): RenderedEmail {
  return renderEmail({
    subject: 'Kadro: bu e-posta ile zaten bir hesabın var',
    greetingName: input.displayName,
    intro: [
      'Bu e-posta adresiyle yeni bir Kadro hesabı açılmak istendi, ama zaten bir hesabın var.',
    ],
    links: [
      { label: 'Giriş yap', href: appLink(input.origin, EMAIL_LINK_PATHS.login) },
      { label: 'Şifremi unuttum', href: appLink(input.origin, EMAIL_LINK_PATHS.forgotPassword) },
    ],
    outro: [
      'Bu isteği sen yapmadıysan bu e-postayı yok sayabilirsin; hesabında bir şey değişmedi.',
    ],
  });
}

export interface DeletionScheduledInput extends AccountEmailInput {
  /** End of the grace period (ADR-0032); shown in Europe/Istanbul time. */
  readonly graceUntil: Date;
}

const ISTANBUL_DATE_TIME = new Intl.DateTimeFormat('tr-TR', {
  timeZone: 'Europe/Istanbul',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/** `7 Ekim 2026 21:00` style date in the Europe/Istanbul time zone. */
export function formatIstanbulDateTime(value: Date): string {
  return ISTANBUL_DATE_TIME.format(value);
}

export function deletionScheduledMessage(input: DeletionScheduledInput): RenderedEmail {
  return renderEmail({
    subject: 'Kadro: hesabın silinecek',
    greetingName: input.displayName,
    intro: [
      'Hesabını silme isteğini aldık. Hesabın şu an kapalı ve hiçbir cihazda oturum açık değil.',
      `Hesabın ve kişisel verilerin ${formatIstanbulDateTime(input.graceUntil)} tarihinde kalıcı olarak silinecek.`,
      'Vazgeçersen bu tarihten önce giriş yapman yeterli; silme işlemi iptal olur.',
    ],
    links: [
      {
        label: 'Giriş yap ve silmeyi iptal et',
        href: appLink(input.origin, EMAIL_LINK_PATHS.login),
      },
      {
        label: 'Hesap silme hakkında',
        href: appLink(input.origin, EMAIL_LINK_PATHS.accountDeletion),
      },
    ],
    outro: [
      'Bu isteği sen yapmadıysan hemen giriş yap ve şifreni değiştir; giriş yapmak silmeyi durdurur.',
    ],
  });
}
