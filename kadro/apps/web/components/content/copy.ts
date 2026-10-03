/**
 * Turkish copy of the blog index, the legal pages and the contact page (ADR-0080). Product copy
 * states only the MVP scope of product spec §3 and makes no claim about users, prices or store
 * availability.
 */

export const BLOG_META = {
  title: 'Blog',
  description:
    'Halı saha organizasyonu için kısa rehberler: kadro kurma, eksik oyuncu bulma, saha seçme, ücret bölme ve 7v7 diziliş.',
} as const;

/** Answer-first paragraph of the blog index: 40 to 60 words, names Kadro. */
export const BLOG_INTRO =
  'Kadro, halı saha maçını organize etmeye ve eksik oyuncuyu mahallenden bulmaya yarayan bir mobil uygulamadır. ' +
  'Bu blogda maç organizasyonunun günlük sorularını yanıtlıyoruz: kadro nasıl kurulur, eksik oyuncu nasıl bulunur, saha nasıl seçilir, ücret nasıl bölünür ve 7v7 maçta hangi diziliş işe yarar.';

export const SAMPLE_NOTICE_TITLE = 'Örnek metin';

/** Visible on every legal page: the project is a portfolio piece (review checklist). */
export const SAMPLE_NOTICE_TEXT =
  'Kadro bir portfolyo projesidir. Bu sayfa örnek bir metindir; gerçek bir hizmetin hukuki metni, ' +
  'aydınlatma yükümlülüğünün yerine getirildiği veya mağaza ve OAuth başvurularına hazır bir politika olduğu anlamına gelmez. ' +
  'Gerçek veri sorumlusu ve başvuru kanalı belirlenmemiştir.';

export const CONTACT_META = {
  title: 'İletişim',
  description:
    'Kadro portfolyo projesi için örnek iletişim sayfası: gerçek bir başvuru kanalı yok; hesap silme ve gizlilik sayfalarına bağlantılar.',
} as const;

/** Answer-first paragraph of the contact page: 40 to 60 words, names Kadro. */
export const CONTACT_INTRO =
  'Kadro, halı saha maçı organize etmeye ve eksik oyuncu bulmaya yarayan bir portfolyo projesidir. ' +
  'Bu sayfa yalnızca bir örnektir: gerçek bir destek, iletişim veya kişisel veri başvuru kanalı belirlenmemiştir. ' +
  'Hesabını silmek ya da verilerin nasıl kullanıldığını okumak istersen aşağıdaki sayfalara bakabilirsin.';

export const CONTACT_NOTE =
  'Gerçek bir yayında bu sayfada veri sorumlusunun kimliği, adresi ve başvuru kanalı yer alır. ' +
  'Bu örnekte bunlar uydurulmamıştır.';
