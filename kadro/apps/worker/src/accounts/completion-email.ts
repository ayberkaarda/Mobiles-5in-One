import { EMAIL_LINK_PATHS, type RenderedEmail, appLink, renderEmail } from '@kadro/emails';

/**
 * `deletion_completed` (ADR-0032): sent by the hard-delete job itself, after the user row is gone
 * and before the transaction commits, because the address must never enter a job payload.
 */
export function deletionCompletedMessage(input: {
  readonly origin: string;
  readonly displayName: string;
}): RenderedEmail {
  return renderEmail({
    subject: 'Kadro: hesabın silindi',
    greetingName: input.displayName,
    intro: [
      'Kadro hesabın ve kişisel verilerin kalıcı olarak silindi.',
      'Oynadığın maçların skor ve katılım geçmişi takımlarında "Silinmiş oyuncu" olarak, adın olmadan kalır.',
    ],
    links: [
      {
        label: 'Hesap silme hakkında',
        href: appLink(input.origin, EMAIL_LINK_PATHS.accountDeletion),
      },
    ],
    outro: [
      'Bu e-postadan sonra sana başka bir e-posta göndermeyeceğiz.',
      'Kadro’ya yeniden katılmak istersen aynı e-posta adresiyle yeni bir hesap açabilirsin.',
    ],
  });
}
