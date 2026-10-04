<?php

use App\Domain\Impact\Models\ImpactSnapshot;
use App\Domain\Web\Contracts\CountersReader;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Fakes\FakeCountersReader;
use Tests\Feature\Web\Support\WebPage;

uses(RefreshDatabase::class);

/*
| HTML budget of the public pages: the gzip-9 body must fit the first TCP window
| (WebPage::BUDGET, 14 000 bytes) on landing, directory and impact overview pages and
| WebPage::BUDGET_LONG (24 000 bytes) on guides, the FAQ, legal pages and /etki/{il}; every
| row also runs the whole public page contract of WebPage::assertPublicPage().
|
| Row: name => [path, budget, lang]. The path may be a closure (run after beforeEach, with
| the test case as $this) that creates the rows it needs and returns the path. Each area
| adds rows only inside its own region.
*/
dataset('public pages within budget', [
    // region shell
    'home' => ['/', WebPage::BUDGET, 'tr'],
    // endregion shell

    // region pages
    'home en' => ['/en', WebPage::BUDGET, 'en'],
    'how it works' => ['/nasil-calisir', WebPage::BUDGET, 'tr'],
    'how it works en' => ['/en/how-it-works', WebPage::BUDGET, 'en'],
    'merchants' => ['/esnaf', WebPage::BUDGET, 'tr'],
    'donors' => ['/bagisci', WebPage::BUDGET, 'tr'],
    'recipients' => ['/askidan-al', WebPage::BUDGET, 'tr'],
    'faq' => ['/sss', WebPage::BUDGET_LONG, 'tr'],
    'about' => ['/hakkinda', WebPage::BUDGET, 'tr'],
    'contact' => ['/iletisim', WebPage::BUDGET, 'tr'],
    // endregion pages

    // region content
    'guide askida-ekmek-gelenegi-nedir' => ['/rehber/askida-ekmek-gelenegi-nedir', WebPage::BUDGET_LONG, 'tr'],
    'guide esnaf-icin-askida-sistemi-nasil-isler' => ['/rehber/esnaf-icin-askida-sistemi-nasil-isler', WebPage::BUDGET_LONG, 'tr'],
    'guide bagisiniz-nereye-gidiyor' => ['/rehber/bagisiniz-nereye-gidiyor', WebPage::BUDGET_LONG, 'tr'],
    'guide askidan-almak-ayip-degil' => ['/rehber/askidan-almak-ayip-degil', WebPage::BUDGET_LONG, 'tr'],
    'guide isletmenizi-nasil-dogrulariz' => ['/rehber/isletmenizi-nasil-dogrulariz', WebPage::BUDGET_LONG, 'tr'],
    'privacy' => ['/gizlilik', WebPage::BUDGET_LONG, 'tr'],
    'kvkk' => ['/kvkk-aydinlatma', WebPage::BUDGET_LONG, 'tr'],
    // endregion content

    // region directory
    // endregion directory

    // region impact
    'impact' => ['/etki', WebPage::BUDGET, 'tr'],
    'impact province' => [
        function (): string {
            foreach ([['İstanbul', 'Kadıköy', 3], ['İstanbul', 'Beşiktaş', 1], ['Ankara', 'Çankaya', 4]] as [$il, $ilce, $shops]) {
                $row = new ImpactSnapshot;
                $row->forceFill(['il' => $il, 'ilce' => $ilce, 'day' => now()->toDateString(), 'donated' => 4, 'redeemed' => 2, 'shops' => $shops])->save();
            }

            return '/etki/istanbul';
        },
        WebPage::BUDGET_LONG,
        'tr',
    ],
    // endregion impact
]);

beforeEach(function (): void {
    WebPage::isolate();
    $this->app->instance(CountersReader::class, new FakeCountersReader);
});

it('renders the page within its gzip budget and the public page contract', function (string $path, int $budget, string $lang): void {
    WebPage::assertPublicPage($this->get($path), $lang, $budget);
})->with('public pages within budget');
