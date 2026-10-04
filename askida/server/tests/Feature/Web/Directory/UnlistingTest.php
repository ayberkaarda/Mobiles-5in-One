<?php

use App\Domain\Shops\Models\Shop;
use App\Domain\Shops\Models\ShopVerificationState;
use App\Domain\Web\Directory\OgImageRenderer;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Storage;
use Tests\Feature\Api\Auth\Support\AuthTestKit;
use Tests\Feature\Web\Directory\Support\DirectoryWorld;
use Tests\Feature\Web\Support\WebPage;

uses(RefreshDatabase::class);

/*
| Unlisting invalidation: the public pages are cached (page cache) and the share image is
| kept on the public disk, yet a shop that stops being public disappears from the public
| web at once, without waiting for any cache lifetime. Each case primes every surface
| (cache misses become hits), changes the shop, and checks the surfaces right away.
*/

beforeEach(function (): void {
    WebPage::isolate();
    AuthTestKit::boot();
    Storage::fake('public');
    config([
        'web.origin' => 'https://askida.app',
        'askida.allow_sample_shops' => false,
        'responsecache.enabled' => true,
        'responsecache.store' => 'array',
    ]);
    Cache::store('array')->flush();
});

/**
 * Two listed shops in Kadıköy (the second keeps the district pages alive) with every
 * public surface of the first one cached.
 */
function primedShop(): Shop
{
    $shop = DirectoryWorld::bakery();
    DirectoryWorld::listed(['slug' => 'komsu-firin', 'name' => 'Komşu Fırın']);

    $test = test();

    foreach (['/dukkan/cinar-firini-kadikoy', '/dukkanlar/istanbul', '/dukkanlar/istanbul/kadikoy', '/sitemap.xml'] as $path) {
        $test->get($path)->assertOk()->assertHeader('X-Page-Cache', 'miss');
        $test->get($path)->assertOk()->assertHeader('X-Page-Cache', 'hit');
    }

    $test->get('/og/dukkan/cinar-firini-kadikoy.png')->assertOk();
    expect(Storage::disk('public')->files(OgImageRenderer::DIRECTORY))->toHaveCount(1);

    return $shop;
}

/**
 * The shop is gone from every public surface right away.
 */
function assertGoneFromPublicWeb(): void
{
    $test = test();

    $test->get('/dukkan/cinar-firini-kadikoy')->assertNotFound();
    $test->get('/d/cinar-firini-kadikoy')->assertNotFound();
    $test->get('/og/dukkan/cinar-firini-kadikoy.png')->assertNotFound();

    expect(Storage::disk('public')->files(OgImageRenderer::DIRECTORY))->toBe([]);

    $sitemap = $test->get('/sitemap.xml')->assertOk()->assertHeader('X-Page-Cache', 'miss');
    expect((string) $sitemap->getContent())->not->toContain('cinar-firini-kadikoy')
        ->toContain('/dukkan/komsu-firin');

    $district = $test->get('/dukkanlar/istanbul/kadikoy')->assertOk()->assertHeader('X-Page-Cache', 'miss');
    expect((string) $district->getContent())->not->toContain('Çınar Fırını')->toContain('Komşu Fırın');

    $province = $test->get('/dukkanlar/istanbul')->assertOk()->assertHeader('X-Page-Cache', 'miss');
    expect(WebPage::answer((string) $province->getContent()))->toContain('1 doğrulanmış dükkân');
}

it('removes the shop at once when its owner unlists it through the API', function (): void {
    $shop = primedShop();
    $owner = $shop->owner;
    assert($owner instanceof User);

    $this->withToken(AuthTestKit::token($owner))
        ->patchJson("/api/v1/shops/{$shop->id}", ['listed_on_web' => false])
        ->assertOk()
        ->assertJsonPath('data.listed_on_web', false);

    AuthTestKit::forgetGuards();
    $this->flushHeaders();

    assertGoneFromPublicWeb();
});

it('removes the shop at once when it leaves the verified state', function (): void {
    $shop = primedShop();
    $owner = $shop->owner;
    assert($owner instanceof User);

    // A sensitive change sends a verified shop back to pending (draft rule D-2).
    $this->withToken(AuthTestKit::token($owner))
        ->patchJson("/api/v1/shops/{$shop->id}", ['address' => 'Yeni Adres Sokak No: 3'])
        ->assertOk()
        ->assertJsonPath('data.verification_state', 'pending');

    AuthTestKit::forgetGuards();
    $this->flushHeaders();

    expect(Shop::query()->findOrFail($shop->id)->verification_state)->toBe(ShopVerificationState::Pending);

    assertGoneFromPublicWeb();
});

it('removes the shop at once when it is deleted', function (): void {
    $shop = primedShop();
    $shop->members()->delete();
    $shop->items()->each(function ($item): void {
        $item->hooks()->delete();
    });
    $shop->hooks()->delete();
    $shop->donations()->delete();
    $shop->items()->delete();
    $shop->delete();

    assertGoneFromPublicWeb();
});

it('drops the cached pages when a listed shop is renamed and renders a new share image', function (): void {
    $shop = primedShop();
    $old = Storage::disk('public')->files(OgImageRenderer::DIRECTORY);

    $shop->name = 'Çınar Fırını Moda';
    $shop->save();

    $this->get('/dukkan/cinar-firini-kadikoy')->assertOk()->assertHeader('X-Page-Cache', 'miss')->assertSee('Çınar Fırını Moda');
    expect(Storage::disk('public')->files(OgImageRenderer::DIRECTORY))->toBe([]);

    $this->get('/og/dukkan/cinar-firini-kadikoy.png')->assertOk();
    expect(Storage::disk('public')->files(OgImageRenderer::DIRECTORY))->toHaveCount(1)->not->toBe($old);
});

it('publishes a shop at once when it becomes listed', function (): void {
    DirectoryWorld::listed(['slug' => 'komsu-firin']);
    $hidden = DirectoryWorld::listed(['slug' => 'yeni-firin', 'name' => 'Yeni Fırın'], ShopVerificationState::Pending);

    $this->get('/sitemap.xml')->assertHeader('X-Page-Cache', 'miss');
    $this->get('/dukkanlar/istanbul/kadikoy')->assertHeader('X-Page-Cache', 'miss');

    // The state change ShopVerificationService::verify() makes.
    $hidden->forceFill(['verification_state' => ShopVerificationState::Verified, 'verified_at' => now()])->save();

    expect((string) $this->get('/sitemap.xml')->assertHeader('X-Page-Cache', 'miss')->getContent())->toContain('/dukkan/yeni-firin');
    $this->get('/dukkanlar/istanbul/kadikoy')->assertHeader('X-Page-Cache', 'miss')->assertSee('Yeni Fırın');
    $this->get('/dukkan/yeni-firin')->assertOk();
});

it('never deletes the share images of a shop whose slug only starts with the same text', function (): void {
    $shop = primedShop();
    $other = DirectoryWorld::listed(['slug' => 'cinar-firini-kadikoy-iki', 'name' => 'Çınar Fırını İki']);
    $this->get('/og/dukkan/'.$other->slug.'.png')->assertOk();

    $shop->forceFill(['listed_on_web' => false])->save();

    $files = Storage::disk('public')->files(OgImageRenderer::DIRECTORY);
    expect($files)->toHaveCount(1)
        ->and($files[0])->toStartWith(OgImageRenderer::DIRECTORY.'/cinar-firini-kadikoy-iki-');
});
