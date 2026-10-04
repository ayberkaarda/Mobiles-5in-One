<?php

use App\Domain\Web\Contracts\CountersReader;
use App\Domain\Web\Directory\DirectoryQuery;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Fakes\FakeCountersReader;
use Tests\Feature\Web\Directory\Support\DirectoryWorld;
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
    // endregion pages

    // region content
    // endregion content

    // region directory
    'shop page' => [function (): string {
        $shop = DirectoryWorld::bakery();

        for ($i = 1; $i <= 12; $i++) {
            DirectoryWorld::item($shop, $i % 4, ['name' => 'Askı ürünü '.$i]);
        }

        return '/dukkan/'.$shop->slug;
    }, WebPage::BUDGET, 'tr'],
    'district page (full page of shops)' => [function (): string {
        for ($i = 1; $i <= DirectoryQuery::PER_PAGE; $i++) {
            DirectoryWorld::listed(['slug' => 'butce-firini-'.$i, 'name' => 'Mahalle Fırını ve Simitçisi '.$i]);
        }

        return '/dukkanlar/istanbul/kadikoy';
    }, WebPage::BUDGET, 'tr'],
    'province page' => [function (): string {
        foreach (['Kadıköy', 'Beşiktaş', 'Üsküdar', 'Şişli', 'Fatih', 'Bakırköy', 'Sarıyer', 'Beyoğlu'] as $i => $ilce) {
            DirectoryWorld::listed(['slug' => 'il-butcesi-'.$i, 'ilce' => $ilce]);
        }

        return '/dukkanlar/istanbul';
    }, WebPage::BUDGET, 'tr'],
    // endregion directory

    // region impact
    // endregion impact
]);

beforeEach(function (): void {
    WebPage::isolate();
    $this->app->instance(CountersReader::class, new FakeCountersReader);
});

it('renders the page within its gzip budget and the public page contract', function (string $path, int $budget, string $lang): void {
    WebPage::assertPublicPage($this->get($path), $lang, $budget);
})->with('public pages within budget');
