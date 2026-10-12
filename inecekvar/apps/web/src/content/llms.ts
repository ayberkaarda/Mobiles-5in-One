import { blocksText } from './blocks';
import { FACTS } from './facts';
import { FAQ } from './faq';
import { GUIDES } from './guides';
import { STATIC_PAGES } from './pages';

const paths = FACTS.topLevelPaths;

function link(origin: string, path: string, label: string, note?: string): string {
  return `- [${label}](${origin}${path})${note ? `: ${note}` : ''}`;
}

function coreFacts(origin: string): string[] {
  return [
    `# ${FACTS.name}`,
    '',
    `> ${FACTS.description}`,
    '',
    `Slogan: ${FACTS.tagline}`,
    '',
    '## Tanım',
    '',
    `${FACTS.name}, resmî verisi olmayan dolmuş, minibüs ve servis hatlarını mahallelinin birlikte haritaladığı bir hat rehberidir. Hat sayfası hat izini, sıralı durakları, tarihli ücreti, saatleri, ödeme yöntemini, durdurma notunu ve son doğrulama tarihini gösterir. Çevrimdışı şehir paketi bu bilgiyi internetsiz de açar. ${FACTS.name} resmî bir kurum değildir.`,
    '',
    '## Kapsam',
    '',
    `Hedef şehirler: ${FACTS.targetCities.join(', ')}. Bir şehrin kapsamı, o şehrin sayfasında yazan yayımlanmış hat sayısıdır; kapsam garantisi verilmez. Sıfır yayımlanmış hatlı şehirler dizine alınmaz. Örnek veri taşıyan sayfalar işaretlenir ve dizine alınmaz.`,
    '',
    '## Veri nasıl doğrulanır',
    '',
    'Katkıcılar hat, durak, ücret ve saat önerir. Bir moderatör öneriyi onaylayınca hat değiştirilemez yeni bir sürüm olur; kimse kendi önerisini onaylayamaz. Sürüş kayıtlarından türetilen hat izinde ilk ve son 200 metre kesilir; ham kayıtlar özeldir ve herkese açık hiçbir yerde yer almaz. Sayfalarda sürüm numarası, sürüm tarihi, ücretin güncelleme tarihi, katkıcı sayısı ve son doğrulama tarihi yazılır.',
    '',
    '## Lisans durumu',
    '',
    `${FACTS.licence.statusLine} Bu nedenle verinin yeniden kullanım koşulları şu an belli değildir. Önerilen atıf: "${FACTS.export.attribution}".`,
    '',
    '## Güncelleme sıklığı',
    '',
    `Açık veri dışa aktarımı ${FACTS.export.cadence} üretilir (${FACTS.export.format}). Hat sayfalarındaki tarihler daha günceldir ve her bilginin yanında yazılır.`,
    '',
    '## Bağlantılar',
    '',
    link(origin, paths.home, 'Ana sayfa ve şehir listesi'),
    link(origin, paths.about, 'Hakkında'),
    link(origin, paths.guides, 'Rehberler'),
    ...GUIDES.map((guide) => link(origin, guide.path, guide.h1)),
    link(origin, paths.faq, 'Sıkça sorulan sorular', `${FAQ.length} soru`),
    link(origin, paths.data, 'Açık veri', 'şehir başına haftalık GeoJSON'),
    link(origin, paths.licence, 'Veri lisansı', 'önerilen, onay bekliyor'),
    link(origin, paths.privacy, 'Gizlilik'),
    link(origin, paths.kvkk, 'KVKK aydınlatma metni', 'taslak, hukuki inceleme bekliyor'),
    link(origin, paths.deletion, 'Hesap silme'),
    link(origin, paths.contact, 'İletişim', 'kanal kurulum aşamasında'),
    link(origin, '/sitemap.xml', 'Site haritası'),
  ];
}

/** `/llms.txt`: the short entity description and the links. */
export function llmsTxt(origin: string): string {
  return coreFacts(origin).join('\n') + '\n';
}

/** `/llms-full.txt`: the same facts with the guides and the questions written out. */
export function llmsFullTxt(origin: string): string {
  const lines = [...coreFacts(origin), '', '## Sıkça sorulan sorular', ''];
  for (const item of FAQ) {
    lines.push(`### ${item.question}`, '', item.answer, '');
  }
  lines.push('## Rehberler', '');
  for (const guide of GUIDES) {
    lines.push(
      `### ${guide.h1}`,
      '',
      `Adres: ${origin}${guide.path}`,
      '',
      blocksText(guide.blocks),
      '',
    );
  }
  const open = STATIC_PAGES.filter((page) => page.kind === 'legal' || page.kind === 'info');
  lines.push('## Hukuki ve bilgi sayfaları', '');
  for (const page of open) {
    lines.push(
      `### ${page.h1}`,
      '',
      ...(page.status ? [`Durum: ${page.status}`, ''] : []),
      blocksText(page.blocks),
      '',
    );
  }
  return (
    lines
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trimEnd() + '\n'
  );
}
