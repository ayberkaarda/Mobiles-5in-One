/**
 * Entity facts. Every page, guide, JSON-LD block, llms.txt and the ASO notes take the name, the
 * tagline, the description and the status lines from here, so they cannot drift apart.
 */
export const FACTS = {
  name: 'İnecek Var',
  wordmark: 'İNECEK VAR',
  tagline: 'Dolmuş nereden geçer? Mahalle bilir.',
  description:
    'Resmî verisi olmayan dolmuş, minibüs ve servis hatlarını mahallelinin birlikte haritaladığı, çevrimdışı da çalışan hat rehberi.',
  legalName: 'İnecek Var Teknoloji',
  domain: 'inecekvar.app',
  appDomain: 'app.inecekvar.app',
  apiDomain: 'api.inecekvar.app',
  applicationId: 'app.inecekvar.mobile',
  storeTitle: 'İnecek Var: Dolmuş & Minibüs Hatları',
  storeSubtitle: 'Hat, durak, ücret; çevrimdışı',
  /** Cities the project aims at. Coverage is whatever a city page shows as published lines. */
  targetCities: ['İstanbul', 'İzmir', 'Ankara', 'Bursa', 'Antalya'],
  language: 'tr-TR',
  contentDate: '2026-10-12',
  export: {
    format: 'GeoJSON',
    cadence: 'haftalık (her pazartesi 03:00, İstanbul saati)',
    pathTemplate: '/export/{sehir}/latest.geojson',
    attribution: 'İnecek Var katkıcıları',
  },
  licence: {
    proposed: 'CC BY 4.0',
    statusLine: 'CC BY 4.0 önerilmiştir; hukuki onay bekleniyor, henüz verilmiş bir lisans yok.',
  },
  trace: {
    trimMetres: 200,
    retentionDays: 30,
  },
  deletion: {
    graceDays: 7,
  },
  contact: {
    statusLine:
      'İletişim kanalı kurulum aşamasında; bu sayfada yayımlanmış bir iletişim adresi henüz yok.',
  },
  topLevelPaths: {
    home: '/',
    guides: '/rehber',
    faq: '/sss',
    data: '/veri',
    licence: '/veri-lisansi',
    about: '/hakkinda',
    privacy: '/gizlilik',
    kvkk: '/kvkk-aydinlatma',
    deletion: '/hesap-silme',
    contact: '/iletisim',
  },
} as const;

export function exportUrlTemplate(apiBase: string): string {
  return apiBase.replace(/\/+$/, '') + FACTS.export.pathTemplate;
}
