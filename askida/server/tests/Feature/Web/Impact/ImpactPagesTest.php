<?php

use App\Domain\Hooks\Models\HookStatus;
use App\Domain\Impact\Models\ImpactSnapshot;
use App\Domain\Shops\Models\Shop;
use App\Domain\Shops\Models\ShopVerificationState;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Tests\Feature\Api\Accounts\Support\AccountsWorld;
use Tests\Feature\Web\Support\WebPage;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    WebPage::isolate();
    Cache::flush();
    config(['askida.allow_sample_shops' => false]);
    Carbon::setTestNow('2026-10-04 15:00:00');
});

afterEach(fn () => Carbon::setTestNow());

function impactWebRow(string $il, string $ilce, string $day, int $donated, int $redeemed, int $shops): void
{
    $row = new ImpactSnapshot;
    $row->forceFill(compact('il', 'ilce', 'day', 'donated', 'redeemed', 'shops'))->save();
}

/**
 * Istanbul has 4 shops over two districts (Kadikoy 3, Besiktas 1), Ankara 4 shops in one
 * district, Izmir a single shop; one old row lies outside the 30 day window.
 */
function impactWebWorld(): void
{
    impactWebRow('İstanbul', 'Kadıköy', '2026-10-03', 10, 6, 3);
    impactWebRow('İstanbul', 'Kadıköy', '2026-10-04', 5, 2, 3);
    impactWebRow('İstanbul', 'Beşiktaş', '2026-10-04', 2, 1, 1);
    impactWebRow('Ankara', 'Çankaya', '2026-10-04', 7, 4, 4);
    impactWebRow('İzmir', 'Konak', '2026-10-04', 3, 1, 1);
    impactWebRow('Ankara', 'Çankaya', '2026-08-01', 1000, 1000, 4);
}

it('shows an honest empty state when nothing is published', function (): void {
    $html = WebPage::assertPublicPage($this->get('/etki'));

    expect($html)->toContain('Henüz yayımlanacak bir sayı yok')
        ->not->toContain('<table')
        ->not->toContain('ÖRNEK');
});

it('shows the 30 day totals and one row per province without small cells', function (): void {
    impactWebWorld();

    $html = WebPage::assertPublicPage($this->get('/etki'));

    // donated 10+5+2+7+3 = 27, redeemed 6+2+1+4+1 = 14, shops: latest day per district 3+1+4+1 = 9.
    expect($html)->toContain('<p class="numeral-xl">27</p>')
        ->toContain('<p class="numeral-xl">14</p>')
        ->toContain('<p class="numeral-xl">9</p>')
        ->toContain('href="/etki/istanbul"')
        ->toContain('href="/etki/ankara"')
        ->toContain('Diğer iller')
        ->not->toContain('İzmir')
        ->not->toContain('Konak')
        ->not->toContain('1.000')
        ->not->toContain('ÖRNEK');
});

it('lists districts of a province and pools small districts', function (): void {
    impactWebWorld();

    $html = WebPage::assertPublicPage($this->get('/etki/istanbul'), budget: WebPage::BUDGET_LONG);

    // Kadikoy 15 / 8 / 3 shown, Besiktas (1 shop) pooled.
    expect($html)->toContain('Kadıköy')
        ->toContain('Diğer ilçeler')
        ->not->toContain('Beşiktaş')
        ->toContain('<p class="numeral-xl">17</p>')
        ->toContain('<p class="numeral-xl">4</p>')
        ->not->toContain('name="robots" content="noindex');
});

it('publishes no figures for a province below the threshold and keeps it out of the index', function (): void {
    impactWebWorld();

    $html = WebPage::assertPublicPage($this->get('/etki/izmir'), budget: WebPage::BUDGET_LONG);

    expect($html)->toContain('ayrı sayı yayımlanmıyor')
        ->toContain('noindex,follow')
        ->not->toContain('Konak')
        ->not->toContain('numeral-xl');
});

it('answers 404 for an unknown province, never an empty page', function (): void {
    impactWebWorld();

    $this->get('/etki/yok-boyle-bir-il')->assertNotFound();
    $this->get('/etki/'.rawurlencode('İstanbul'))->assertNotFound();
});

it('labels example figures when sample shops are allowed and nothing real exists', function (): void {
    config(['askida.allow_sample_shops' => true]);

    foreach (range(1, 3) as $i) {
        AccountsWorld::shop(null, ['is_sample' => true]);
    }

    $html = WebPage::assertPublicPage($this->get('/etki'));

    expect($html)->toContain('tag-sample')->toContain('ÖRNEK')->toContain('örnek dükkânlardan türetilmiştir')
        ->toContain('href="/etki/istanbul"');
});

it('derives example units per day from sample donations and redemptions', function (): void {
    config(['askida.allow_sample_shops' => true]);

    $shops = array_map(fn (): Shop => AccountsWorld::shop(null, ['is_sample' => true]), range(1, 3));
    $donation = AccountsWorld::donation(null, AccountsWorld::item($shops[0]), qty: 4);
    AccountsWorld::hook($donation, HookStatus::Redeemed);
    AccountsWorld::hook($donation, HookStatus::Redeemed);

    $html = WebPage::assertPublicPage($this->get('/etki'));

    expect($html)->toContain('<p class="numeral-xl">4</p>')
        ->toContain('<p class="numeral-xl">2</p>')
        ->toContain('<p class="numeral-xl">3</p>')
        ->toContain('ÖRNEK');
});

it('never counts sample shops once real figures exist or when samples are not allowed', function (): void {
    AccountsWorld::shop(null, ['is_sample' => true]);

    expect($this->get('/etki')->getContent())->toContain('Henüz yayımlanacak')->not->toContain('ÖRNEK');

    config(['askida.allow_sample_shops' => true]);
    Cache::flush();
    impactWebWorld();

    expect($this->get('/etki')->getContent())->not->toContain('ÖRNEK');
});

it('ignores unverified and pending shops in the example figures', function (): void {
    config(['askida.allow_sample_shops' => true]);

    AccountsWorld::shop(null, ['is_sample' => true, 'verification_state' => ShopVerificationState::Pending, 'verified_at' => null]);

    expect($this->get('/etki')->getContent())->toContain('Henüz yayımlanacak')->not->toContain('tag-sample');
});

it('describes the open data as a Dataset without any licence property', function (): void {
    impactWebWorld();

    $html = WebPage::assertPublicPage($this->get('/etki'));
    $dataset = collect(WebPage::jsonLd($html))->firstWhere('@type', 'Dataset');

    expect($dataset)->toBeArray()
        ->and($dataset['@context'])->toBe('https://schema.org')
        ->and($dataset)->not->toHaveKey('license')
        ->and($dataset['distribution'][0]['@type'])->toBe('DataDownload')
        ->and($dataset['distribution'][0]['contentUrl'])->toBe('https://askida.app/etki.csv')
        ->and($dataset['spatialCoverage'])->toBe('Türkiye')
        ->and($dataset['temporalCoverage'])->toBe('2026-07-07/2026-10-04')
        ->and($dataset['description'])->toEndWith('Önerilen lisans: CC BY 4.0; hukuki onay bekliyor, henüz lisans verilmemiştir.')
        ->and($html)->toContain('Önerilen lisans: CC BY 4.0; hukuki onay bekliyor, henüz lisans verilmemiştir.')
        ->and($html)->not->toContain('"license"');
});

it('adds a breadcrumb trail to the impact pages', function (): void {
    impactWebWorld();

    $blocks = WebPage::jsonLd((string) $this->get('/etki/ankara')->getContent());
    $crumbs = collect($blocks)->firstWhere('@type', 'BreadcrumbList');

    expect(array_column($crumbs['itemListElement'], 'name'))->toBe(['Askıda', 'Etki', 'Ankara']);
});

it('renders a stored shop name as text, never as markup', function (): void {
    impactWebRow('<script>alert(1)</script>', 'Merkez', '2026-10-04', 1, 1, 3);

    $html = (string) $this->get('/etki')->getContent();

    expect($html)->not->toContain('<script>alert(1)')
        ->toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
});
