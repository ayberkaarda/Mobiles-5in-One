import { Block } from './blocks';
import { FACTS } from './facts';
import { readLineBlocks } from './guide-hat-okuma';
import { istanbulBlocks } from './guide-istanbul';
import { stopBlocks } from './guide-durak';
import { offlineBlocks } from './guide-cevrimdisi';
import { verifyBlocks } from './guide-dogrulama';

export interface Guide {
  readonly slug: string;
  readonly path: string;
  readonly h1: string;
  /** Short subject for the title; the site suffix is added by the SEO service. */
  readonly title: string;
  readonly description: string;
  readonly blocks: readonly Block[];
  readonly datePublished: string;
  readonly dateModified: string;
}

function guide(
  slug: string,
  h1: string,
  title: string,
  description: string,
  blocks: Block[],
): Guide {
  return {
    slug,
    path: `${FACTS.topLevelPaths.guides}/${slug}`,
    h1,
    title,
    description,
    blocks,
    datePublished: FACTS.contentDate,
    dateModified: FACTS.contentDate,
  };
}

export const GUIDES: readonly Guide[] = [
  guide(
    'dolmus-ve-minibus-hatti-nasil-okunur',
    'Dolmuş ve minibüs hattı nasıl okunur?',
    'Dolmuş ve minibüs hattı nasıl okunur?',
    'Bir hat sayfasındaki ad, durak sırası, ücret tarihi ve doğrulama bilgisi ne anlatır? Hattı yola çıkmadan önce okumanın kısa yolu.',
    readLineBlocks,
  ),
  guide(
    'istanbul-minibus-dolmus-farki-nasil-binilir',
    'İstanbul’da minibüs ile dolmuş farkı ve nasıl binilir',
    'Minibüs ile dolmuş farkı ve nasıl binilir',
    'Minibüs ile dolmuş arasındaki gündelik fark, ilk kez binenler için adım adım biniş ve ödeme ipuçları. Ücret ve güzergâh hat sayfasında tarihiyle yazılır.',
    istanbulBlocks,
  ),
  guide(
    'durak-yoksa-nereden-inilir-inecek-var',
    'Durak yoksa nereden inilir? "İnecek var" kültürü ve güvenli inme',
    'Durak yoksa nereden inilir? İnecek var',
    '"İnecek var" demek ne işe yarar, durak yokken nereden ve nasıl inilir? Önceden haber verme, güvenli nokta seçme ve dolu araçta inme rehberi.',
    stopBlocks,
  ),
  guide(
    'cevrimdisi-sehir-paketi-nasil-kullanilir',
    'Çevrimdışı şehir paketi nasıl kullanılır?',
    'Çevrimdışı şehir paketi nasıl kullanılır?',
    'Şehir paketini indirmek, internet olmadan hangi bilgilerin çalıştığı, güncelleme ve silme. Uygulamanın gerçek davranışına göre yazıldı.',
    offlineBlocks,
  ),
  guide(
    'hat-bilgisi-nasil-dogrulanir',
    'Hat bilgisi nasıl doğrulanır? Katkı ve moderasyon süreci',
    'Hat bilgisi nasıl doğrulanır?',
    'Bir hat önerisinin iz kaydından yayına kadar yolu: ilk ve son 200 metrenin kesilmesi, moderatör onayı, sürümler ve geri alma.',
    verifyBlocks,
  ),
];

export function guideBySlug(slug: string): Guide | undefined {
  return GUIDES.find((item) => item.slug === slug);
}
