<?php

namespace App\Http\Controllers\Web\Pages;

use App\Domain\Web\Contracts\CountersReader;
use App\Http\Controllers\Controller;
use App\Support\Web\Facts;
use App\Support\Web\Origin;
use App\Support\Web\PageMeta;
use Illuminate\Contracts\View\View;

/**
 * The static public pages: home (tr, en), how it works (tr, en), the three persona
 * landings, the FAQ, about and contact. Copy lives in the views and in
 * resources/content/faq.php; every number comes from Facts.
 */
class PagesController extends Controller
{
    private const TRANSLATIONS_HOME = ['tr' => '/', 'en' => '/en'];

    private const TRANSLATIONS_HOW = ['tr' => '/nasil-calisir', 'en' => '/en/how-it-works'];

    public function home(CountersReader $counters): View
    {
        $meta = PageMeta::make(
            path: '/',
            title: 'Askıda: askıda ekmek ve iyilik ağı',
            description: 'Mahalle esnafında askıya bırakılan ekmeği, çorbayı, defteri dileyen herkes hesap açmadan ve soru sorulmadan askıdan alır.',
            jsonLd: [$this->mobileApplication()],
            translations: self::TRANSLATIONS_HOME,
        );

        return view('web.pages.home', ['meta' => $meta, 'counters' => $counters->home()]);
    }

    public function homeEn(CountersReader $counters): View
    {
        $meta = PageMeta::make(
            path: '/en',
            title: 'Askıda: pay-it-forward network for local shops',
            description: 'Donors prepay bread, soup or stationery at their neighbourhood shop; anyone takes it with a one-time code, no account and no questions asked.',
            translations: self::TRANSLATIONS_HOME,
            lang: 'en',
        );

        return view('web.pages.home-en', ['meta' => $meta, 'counters' => $counters->home()]);
    }

    public function howItWorks(): View
    {
        $meta = PageMeta::make(
            path: '/nasil-calisir',
            title: 'Askıda nasıl çalışır? Bırak, askıda, al',
            description: 'Bağışçı ürünü uygulamadan askıya bırakır, dükkân askısında bekler, dileyen herkes tek kullanımlık kodla alır. Adımlar ve sınırlar.',
            breadcrumbs: [['Nasıl çalışır', '/nasil-calisir']],
            translations: self::TRANSLATIONS_HOW,
        );

        return view('web.pages.how-it-works', ['meta' => $meta]);
    }

    public function howItWorksEn(): View
    {
        $meta = PageMeta::make(
            path: '/en/how-it-works',
            title: 'How Askıda works: hang, wait, take',
            description: 'A donor prepays an item in the app, it waits on the shop rail and anyone takes it with a one-time code. The steps and the limits.',
            breadcrumbs: [['How it works', '/en/how-it-works']],
            translations: self::TRANSLATIONS_HOW,
            lang: 'en',
        );

        return view('web.pages.how-it-works-en', ['meta' => $meta]);
    }

    public function merchants(): View
    {
        $meta = PageMeta::make(
            path: '/esnaf',
            title: 'Esnaf için Askıda: dükkânınızı askıya açın',
            description: 'Fırın, lokanta, kırtasiye ve manav için: bağışlar ödeme kuruluşu üzerinden size ulaşır, kodu okutup ürünü verirsiniz. Kayıt ve doğrulama adımları.',
            breadcrumbs: [['Esnaf', '/esnaf']],
        );

        return view('web.pages.merchants', ['meta' => $meta]);
    }

    public function donors(): View
    {
        $meta = PageMeta::make(
            path: '/bagisci',
            title: 'Bağışçı için Askıda: askıya bırakmak',
            description: 'Mahalle esnafında bir ekmeği, çorbayı ya da defteri önceden ödeyin; ürün dükkânın askısında bekler. Sınırlar, ödeme ve gizlilik.',
            breadcrumbs: [['Bağışçı', '/bagisci']],
        );

        return view('web.pages.donors', ['meta' => $meta]);
    }

    public function recipients(): View
    {
        $meta = PageMeta::make(
            path: '/askidan-al',
            title: 'Askıdan almak ayıp değil: hesapsız, kimliksiz',
            description: 'Askıdan almak için hesap, kimlik ya da kesin konum gerekmez. Yakındaki dükkânı seçin, kodu alın, ürünü dükkândan teslim alın.',
            breadcrumbs: [['Askıdan al', '/askidan-al']],
        );

        return view('web.pages.recipients', ['meta' => $meta]);
    }

    public function faq(): View
    {
        /** @var list<array{0: string, 1: string}> $pairs */
        $pairs = require resource_path('content/faq.php');

        $meta = PageMeta::make(
            path: '/sss',
            title: 'Sıkça sorulan sorular | Askıda',
            description: 'Askıda hakkında 15 soru ve cevap: hesap, kod, günlük sınır, konum, komisyon, esnaf katılımı ve veri silme.',
            breadcrumbs: [['Sıkça sorulanlar', '/sss']],
            jsonLd: [[
                '@type' => 'FAQPage',
                'mainEntity' => array_map(static fn (array $pair): array => [
                    '@type' => 'Question',
                    'name' => $pair[0],
                    'acceptedAnswer' => ['@type' => 'Answer', 'text' => $pair[1]],
                ], $pairs),
            ]],
        );

        return view('web.pages.faq', ['meta' => $meta, 'pairs' => $pairs]);
    }

    public function about(): View
    {
        $meta = PageMeta::make(
            path: '/hakkinda',
            title: 'Hakkında | Askıda',
            description: 'Askıda, askıda ekmek geleneğini uygulamaya taşır: ilkeler, kullanılan sınırlar, komisyon ve kimin ne gördüğü. Örnek metindir.',
            breadcrumbs: [['Hakkında', '/hakkinda']],
        );

        return view('web.pages.about', ['meta' => $meta]);
    }

    public function contact(): View
    {
        $meta = PageMeta::make(
            path: '/iletisim',
            title: 'İletişim | Askıda',
            description: 'Askıda iletişim bilgileri: örnek adres ve işletme adı. Hesap silme ve veri talepleri için ilgili sayfalara bağlantılar. Örnek metindir.',
            breadcrumbs: [['İletişim', '/iletisim']],
        );

        return view('web.pages.contact', ['meta' => $meta, 'email' => Facts::contactEmail()]);
    }

    /**
     * @return array<string, mixed>
     */
    private function mobileApplication(): array
    {
        $block = [
            '@type' => 'MobileApplication',
            'name' => Facts::STORE_TITLE,
            'url' => Origin::url('/'),
            'applicationCategory' => 'LifestyleApplication',
            'operatingSystem' => 'Android, iOS',
            'offers' => ['@type' => 'Offer', 'price' => '0', 'priceCurrency' => 'TRY'],
        ];

        if (Facts::storeUrls() !== []) {
            $block['installUrl'] = array_values(Facts::storeUrls());
        }

        return $block;
    }
}
