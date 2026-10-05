<?php

use App\Domain\Web\Directory\OgImageRenderer;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Tests\Feature\Web\Directory\Support\DirectoryWorld;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    Storage::fake('public');
    config(['web.og_cache_disk' => 'public', 'askida.allow_sample_shops' => false]);
});

it('renders a 1200 x 630 PNG of a listed shop with a one day cache header', function (): void {
    $shop = DirectoryWorld::bakery();

    $response = $this->get('/og/dukkan/cinar-firini-kadikoy.png')
        ->assertOk()
        ->assertHeader('Content-Type', 'image/png')
        ->assertHeader('X-Robots-Tag', 'noindex');

    expect($response->headers->get('Cache-Control'))->toContain('max-age=86400')->toContain('public');

    $png = (string) $response->getContent();
    $size = getimagesizefromstring($png);

    expect($size)->not->toBeFalse()
        ->and([$size[0], $size[1], $size['mime']])->toBe([OgImageRenderer::WIDTH, OgImageRenderer::HEIGHT, 'image/png']);

    $expectedPath = 'og/shops/cinar-firini-kadikoy-'.sha1($shop->name."\n".$shop->updated_at?->toAtomString()).'.png';

    expect(Storage::disk('public')->files('og/shops'))->toBe([$expectedPath])
        ->and(Storage::disk('public')->get($expectedPath))->toBe($png);
});

it('serves the stored file on later requests instead of drawing again', function (): void {
    $shop = DirectoryWorld::bakery();
    $path = app(OgImageRenderer::class)->path($shop);
    Storage::disk('public')->put($path, 'stored-bytes');

    expect($this->get('/og/dukkan/cinar-firini-kadikoy.png')->assertOk()->getContent())->toBe('stored-bytes');
});

it('keeps one image per shop: a new variant removes the older ones', function (): void {
    $shop = DirectoryWorld::bakery();
    $other = DirectoryWorld::listed(['slug' => 'cinar-firini-kadikoy-iki']);
    $disk = Storage::disk('public');
    $stale = 'og/shops/cinar-firini-kadikoy-'.sha1('old name').'.png';
    $neighbour = 'og/shops/'.$other->slug.'-'.sha1('x').'.png';
    $disk->put($stale, 'old');
    $disk->put($neighbour, 'other shop');

    $this->get('/og/dukkan/cinar-firini-kadikoy.png')->assertOk();

    $files = $disk->files('og/shops');
    sort($files);
    $expected = [app(OgImageRenderer::class)->path($shop), $neighbour];
    sort($expected);

    expect($files)->toBe($expected);
});

it('keeps no file when the shop is unlisted while its image is drawn', function (): void {
    $shop = DirectoryWorld::bakery();

    // The request loaded the shop while it was listed; the unlisting lands before the write.
    DB::table('shops')->where('id', $shop->id)->update(['listed_on_web' => false]);

    $png = app(OgImageRenderer::class)->forShop($shop);

    expect(getimagesizefromstring($png))->not->toBeFalse()
        ->and(Storage::disk('public')->files('og/shops'))->toBe([]);
});

it('draws the brand frame: background, rail and the accent tag', function (): void {
    DirectoryWorld::bakery();

    $image = imagecreatefromstring((string) $this->get('/og/dukkan/cinar-firini-kadikoy.png')->getContent());
    expect($image)->not->toBeFalse();
    assert($image instanceof GdImage);

    $rgb = static function (int $x, int $y) use ($image): string {
        $colour = imagecolorsforindex($image, (int) imagecolorat($image, $x, $y));

        return sprintf('#%02X%02X%02X', $colour['red'], $colour['green'], $colour['blue']);
    };

    expect($rgb(10, 10))->toBe('#F4F0E8')
        ->and($rgb(600, 96))->toBe('#2B2B2B')
        ->and($rgb(1000, 200))->toBe('#C8763A');
});

it('truncates long names to 48 characters', function (): void {
    $long = str_repeat('Çok uzun bir dükkân adı ', 4);
    $short = OgImageRenderer::truncate($long);

    expect(mb_strlen($short))->toBe(OgImageRenderer::NAME_MAX)
        ->and($short)->toEndWith('…')
        ->and(OgImageRenderer::truncate("  Kısa \n ad  "))->toBe('Kısa ad');
});

it('answers 404 for an unknown slug', function (): void {
    $this->get('/og/dukkan/yok.png')->assertNotFound();
    expect(Storage::disk('public')->allFiles())->toBe([]);
});

it('ships the default share image and the command that draws it', function (): void {
    $committed = getimagesize(public_path('og/default.png'));

    expect($committed)->not->toBeFalse()
        ->and([$committed[0], $committed[1], $committed['mime']])->toBe([1200, 630, 'image/png']);

    $public = sys_get_temp_dir().'/askida-public-'.bin2hex(random_bytes(4));
    mkdir($public);
    $original = public_path();
    $this->app->usePublicPath($public);

    try {
        $this->artisan('web:og-default')->assertSuccessful();

        $drawn = getimagesize($public.'/og/default.png');
        expect($drawn)->not->toBeFalse()
            ->and([$drawn[0], $drawn[1]])->toBe([1200, 630]);
    } finally {
        $this->app->usePublicPath($original);
        @unlink($public.'/og/default.png');
        @rmdir($public.'/og');
        @rmdir($public);
    }
});

it('uses a font copied byte for byte from the brand sources', function (): void {
    $brand = dirname(base_path()).'/brand/fonts/bricolage-grotesque/BricolageGrotesque-Display-SemiBold.ttf';

    expect(hash_file('sha256', OgImageRenderer::fontPath()))->toBe(hash_file('sha256', $brand));
});
