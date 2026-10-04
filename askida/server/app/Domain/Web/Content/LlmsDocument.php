<?php

namespace App\Domain\Web\Content;

use App\Support\Web\Facts;
use App\Support\Web\Format;
use App\Support\Web\Origin;

/**
 * The plain-text summaries of the site for crawlers: `/llms.txt` (short, at most 2 KB)
 * and `/llms-full.txt` (the full prose of the about text, the FAQ, the guides and the legal
 * sample texts). Every number comes from {@see Facts}; the guides and legal texts are the
 * same Markdown sources the pages render, so the surfaces cannot drift.
 */
final class LlmsDocument
{
    public const SHORT_MAX_BYTES = 2048;

    /** Paths of the ten links in llms.txt, with their labels. */
    private const LINKS = [
        '/nasil-calisir' => 'Nasıl çalışır',
        '/esnaf' => 'Esnaf için',
        '/bagisci' => 'Bağışçı için',
        '/askidan-al' => 'Askıdan almak',
        '/sss' => 'Sıkça sorulan sorular',
        '/hakkinda' => 'Hakkında',
        '/etki' => 'Etki ve açık veri',
        '/rehber/askida-ekmek-gelenegi-nedir' => 'Askıda ekmek geleneği',
        '/llms-full.txt' => 'Tam metin',
        '/iletisim' => 'İletişim',
    ];

    public function __construct(
        private readonly GuideRepository $guides,
        private readonly LegalRepository $legal,
    ) {}

    public function short(): string
    {
        $radius = FactTokens::values();
        $links = [];

        foreach (self::LINKS as $path => $label) {
            $links[] = '- '.$label.': '.Origin::url($path);
        }

        $lines = [
            '# '.Facts::BRAND,
            '',
            '> '.Facts::BRAND.', askıda ekmek geleneğini uygulamaya taşıyan bir iyilik ağıdır. Bağışçı mahalle esnafında ekmek, çorba ya da defter bırakır; dileyen herkes hesap açmadan, soru sorulmadan askıdan alır. Yasal ad: '.Facts::LEGAL_NAME.'. Alan adı: '.Facts::DOMAIN.'.',
            '',
            '## Kimler için',
            '- Bağışçı: uygulamadan dükkân ve ürün seçer, ödemeyi yapar, ürün askıya düşer.',
            '- Esnaf: dükkânını doğrulatır, ürünlerini tanımlar, kodu okutarak teslim eder.',
            '- Alan: hesapsız, yakındaki dükkândan tek kullanımlık kod alır.',
            '',
            '## Askıdan alma',
            Facts::codeLength().' karakterli kod '.Facts::codeValidMinutes().' dakika geçerlidir. Günde en çok '.Facts::anonDailyCap().' ürün, aynı dükkândan günde '.Facts::anonShopDailyCap().' ürün alınır. Dükkânlar varsayılan '.$radius['radius_default_km'].' km, en çok '.$radius['radius_max_km'].' km çevrede aranır. Esnaf kodu okutunca ürün teslim edilir.',
            '',
            '## Gizlilik güvencesi',
            'Alan için hesap, kimlik, puan ve geçmiş yoktur; kimin aldığı kaydedilmez. Yalnızca 30 günlük toplam sayaçlar tutulur. Konum yakındaki dükkânları göstermek içindir.',
            '',
            '## Komisyon',
            'Komisyon oranı '.Facts::commissionLabel().'; yayın öncesi belirlenir. Platform bağışı tutmaz, ödeme esnafa ödeme kuruluşu üzerinden ulaşır.',
            '',
            '## Bağlantılar',
            ...$links,
            '',
            'İletişim adresi: '.Facts::contactEmail().' (örnek adres, aktif değil)',
            '',
        ];

        return implode("\n", $lines);
    }

    public function full(): string
    {
        $parts = [
            '# '.Facts::BRAND.' (tam metin)',
            '',
            '> '.Facts::TAGLINE.' Bu dosya, '.Origin::url('/').' adresindeki içeriğin düz metin özetidir.',
            '',
            $this->about(),
        ];

        $faq = $this->faq();

        if ($faq !== []) {
            $parts[] = '## Sıkça sorulan sorular';
            $parts[] = '';

            foreach ($faq as [$question, $answer]) {
                $parts[] = '### '.$question;
                $parts[] = '';
                $parts[] = $answer;
                $parts[] = '';
            }
        }

        $parts[] = '## Rehberler';
        $parts[] = '';

        foreach ($this->guides->all() as $guide) {
            $parts[] = '### '.$guide->title;
            $parts[] = '';
            $parts[] = 'Adres: '.Origin::url('/rehber/'.$guide->slug).' | Güncelleme: '.$guide->updated->toDateString();
            $parts[] = '';
            $parts[] = $this->demote($guide->markdown);
            $parts[] = '';
        }

        $parts[] = '## Hukuki metinler (örnek taslaklar)';
        $parts[] = '';
        $parts[] = Facts::SAMPLE_NOTICE;
        $parts[] = '';

        foreach ($this->legal->all() as $page) {
            $parts[] = '### '.$page->title;
            $parts[] = '';
            $parts[] = 'Adres: '.Origin::url('/'.$page->slug).' | Güncelleme: '.$page->updated->toDateString();
            $parts[] = '';
            $parts[] = $this->demote($page->markdown);
            $parts[] = '';
        }

        return implode("\n", $parts);
    }

    private function about(): string
    {
        return implode("\n", [
            '## Hakkında',
            '',
            Facts::BRAND.', '.Facts::LEGAL_NAME.' tarafından işletilir. Alan adı '.Facts::DOMAIN.', uygulama kimliği '.Facts::APP_ID.'.',
            'Bağışçı uygulamadan bir dükkân ve ürün seçip ödeme yapar; ürün o dükkânda askıya düşer. Alan kişi hesap açmadan yakındaki bir dükkândan '.Facts::codeLength().' karakterli, '.Facts::codeValidMinutes().' dakika geçerli, tek kullanımlık bir kod alır ve dükkânda teslim alır.',
            'Günlük sınırlar: bir cihaz günde en çok '.Facts::anonDailyCap().' ürün, aynı dükkândan günde '.Facts::anonShopDailyCap().' ürün alabilir; bir bağış en çok '.Facts::qtyMax().' adettir, tek işlem sınırı '.Format::money(Facts::txCapMinor()).', bağışçı başına günlük sınır '.Format::money(Facts::dayCapMinor()).'.',
            'Komisyon oranı '.Facts::commissionLabel().'; yayın öncesi belirlenir.',
            '',
        ]);
    }

    /**
     * @return list<array{0: string, 1: string}>
     */
    private function faq(): array
    {
        $path = resource_path('content/faq.php');

        if (! is_file($path)) {
            return [];
        }

        $items = require $path;
        $pairs = [];

        if (! is_array($items)) {
            return [];
        }

        foreach ($items as $key => $item) {
            if (is_array($item) && isset($item['question'], $item['answer'])) {
                $pairs[] = [(string) $item['question'], (string) $item['answer']];
            } elseif (is_array($item) && isset($item['q'], $item['a'])) {
                $pairs[] = [(string) $item['q'], (string) $item['a']];
            } elseif (is_array($item) && count($item) === 2 && isset($item[0], $item[1])) {
                $pairs[] = [(string) $item[0], (string) $item[1]];
            } elseif (is_string($key) && is_string($item)) {
                $pairs[] = [$key, $item];
            }
        }

        return $pairs;
    }

    /**
     * Shifts Markdown headings two levels down so they nest under the section headings.
     */
    private function demote(string $markdown): string
    {
        return (string) preg_replace('/^(#{1,4}) /m', '$1## ', $markdown);
    }
}
