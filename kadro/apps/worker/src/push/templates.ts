import { type NotificationType } from '@kadro/contracts';

/**
 * Fixed Turkish notification texts (ADR-0031). Lock screens are visible to anyone near the phone,
 * so the only variable parts are the team name, the match date and time, and counts: never another
 * person's name, email, phone, message text, venue address or fee amount.
 */

export type NotificationVariant =
  | 'default'
  /** `match.updated` for a cancelled match. */
  | 'cancelled'
  /** `application.decided` outcomes. */
  | 'accepted'
  | 'rejected';

export interface PushTemplateInput {
  readonly teamName: string;
  /** Match start, when the notification is about a match. */
  readonly startsAt?: Date;
  /** Confirmed players, pending applications or team members, depending on the type. */
  readonly count?: number;
  readonly variant?: NotificationVariant;
}

export interface PushContent {
  readonly title: string;
  readonly body: string;
}

const TIME = new Intl.DateTimeFormat('tr-TR', {
  timeZone: 'Europe/Istanbul',
  hour: '2-digit',
  minute: '2-digit',
});
const DATE_TIME = new Intl.DateTimeFormat('tr-TR', {
  timeZone: 'Europe/Istanbul',
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatTime(value: Date): string {
  return TIME.format(value);
}

/** `8 Ekim 21:00` in Europe/Istanbul time. */
export function formatDateTime(value: Date): string {
  return DATE_TIME.format(value);
}

/** Longest team name in a notification; longer names are shortened with an ellipsis. */
const TEAM_NAME_MAX = 40;

function team(input: PushTemplateInput): string {
  const name = input.teamName.trim();
  return name.length > TEAM_NAME_MAX ? `${name.slice(0, TEAM_NAME_MAX - 1)}…` : name;
}

function when(input: PushTemplateInput): string {
  return input.startsAt ? formatDateTime(input.startsAt) : '';
}

export function renderPush(type: NotificationType, input: PushTemplateInput): PushContent {
  switch (type) {
    case 'match.reminder_24h':
      return {
        title: `Maç yarın, saat ${input.startsAt ? formatTime(input.startsAt) : ''}`,
        body: `${team(input)} maçına geliyor musun? Kadronu kontrol et.`,
      };
    case 'match.reminder_2h':
      return {
        title: 'Maça 2 saat kaldı',
        body: `${team(input)} maçı saat ${input.startsAt ? formatTime(input.startsAt) : ''}. Sahada görüşürüz!`,
      };
    case 'match.updated':
      return input.variant === 'cancelled'
        ? { title: 'Maç iptal edildi', body: `${team(input)} maçı (${when(input)}) iptal edildi.` }
        : {
            title: 'Maç bilgileri değişti',
            body: `${team(input)} maçının saati veya sahası güncellendi: ${when(input)}. Kontrol et.`,
          };
    case 'rsvp.changed':
      return {
        title: 'Katılım listesi değişti',
        body: `${team(input)} maçı (${when(input)}) için ${input.count ?? 0} oyuncu geliyor.`,
      };
    case 'rsvp.promoted':
      return {
        title: 'Kadroya girdin!',
        body: `Yedekten ${team(input)} maçının kadrosuna alındın (${when(input)}).`,
      };
    case 'lineup.slot_free':
      return {
        title: 'Kadroda yer açıldı',
        body: `${team(input)} maçından (${when(input)}) bir oyuncu ayrıldı. Eksik var!`,
      };
    case 'application.received':
      return {
        title: 'Eksik Var çağrına başvuru var',
        body: `${team(input)} maçı (${when(input)}) için ${input.count ?? 0} bekleyen başvuru var.`,
      };
    case 'application.decided':
      return input.variant === 'accepted'
        ? {
            title: 'Başvurun kabul edildi',
            body: `${team(input)} maçına (${when(input)}) katılıyorsun. İyi maçlar!`,
          }
        : {
            title: 'Başvurun sonuçlandı',
            body: `${team(input)} maçı (${when(input)}) için başvurun kabul edilmedi.`,
          };
    case 'team.member_joined':
      return {
        title: 'Kadroya yeni oyuncu katıldı',
        body: `${team(input)} kadrosu ${input.count ?? 0} kişi oldu.`,
      };
  }
}

/** Deep-link key of each type's `refId` in the notification `data` (ADR-0031). */
export const PUSH_REF_KEY: Readonly<
  Record<NotificationType, 'matchId' | 'teamId' | 'applicationId'>
> = {
  'match.reminder_24h': 'matchId',
  'match.reminder_2h': 'matchId',
  'match.updated': 'matchId',
  'rsvp.changed': 'matchId',
  'rsvp.promoted': 'matchId',
  'lineup.slot_free': 'matchId',
  'application.received': 'applicationId',
  'application.decided': 'applicationId',
  'team.member_joined': 'teamId',
};
