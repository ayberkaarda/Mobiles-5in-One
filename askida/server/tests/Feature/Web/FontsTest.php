<?php

use App\Domain\Web\Contracts\CountersReader;
use App\Support\Web\Assets;
use Tests\Fakes\FakeCountersReader;
use Tests\Feature\Web\Support\WebPage;

/*
| The public web ships byte-identical copies of the brand's web fonts and logo (askida/brand,
| mounted at /var/www/brand in Docker), self-hosted under public/, referenced with the file
| hash as version; only the text font is preloaded. The image runtime can draw TrueType
| text for the Open Graph images (GD with FreeType).
*/

beforeEach(function (): void {
    WebPage::isolate();
});

function fontsTestBrandPath(string $relative): string
{
    $path = dirname(base_path()).'/brand/'.$relative;

    expect(is_file($path))->toBeTrue('Missing brand file '.$path);

    return $path;
}

it('ships byte-identical copies of the brand files', function (string $public, string $brand): void {
    $copy = public_path($public);

    expect(is_file($copy))->toBeTrue('Missing '.$public)
        ->and(sha1_file($copy))->toBe(sha1_file(fontsTestBrandPath($brand)));
})->with([
    'text font' => ['fonts/text-var.woff2', 'fonts/bricolage-grotesque/web/text-var.woff2'],
    'display 600' => ['fonts/display-600.woff2', 'fonts/bricolage-grotesque/web/display-600.woff2'],
    'display 700' => ['fonts/display-700.woff2', 'fonts/bricolage-grotesque/web/display-700.woff2'],
    'font licence' => ['fonts/OFL.txt', 'fonts/bricolage-grotesque/OFL.txt'],
    'mark' => ['logo/askida-mark.svg', 'logo/askida-mark.svg'],
    'favicon' => ['logo/askida-favicon.svg', 'logo/askida-favicon.svg'],
]);

it('references every font with its current hash and swaps on load', function (): void {
    $css = (string) file_get_contents(public_path(Assets::STYLESHEET));

    preg_match_all('/@font-face\s*\{[^}]*\}/', $css, $faces);
    $remote = array_values(array_filter($faces[0], static fn (string $face): bool => str_contains($face, 'url(')));

    expect($remote)->toHaveCount(3);

    foreach ($remote as $face) {
        expect($face)->toContain('font-display: swap')
            ->toContain('format("woff2")');
    }

    foreach (['text-var', 'display-600', 'display-700'] as $file) {
        $path = 'fonts/'.$file.'.woff2';

        expect($css)->toContain('url("/'.$path.'?v='.sha1_file(public_path($path)).'")');
    }

    expect($css)->not->toMatch('#url\(\s*["\']?(https?:)?//#i');
});

it('preloads only the text font and links the one stylesheet by hash', function (): void {
    $this->app->instance(CountersReader::class, new FakeCountersReader);

    $html = (string) $this->get('/')->assertOk()->getContent();

    preg_match_all('/<link rel="preload"[^>]*>/', $html, $preloads);
    preg_match_all('/<link rel="stylesheet"[^>]*>/', $html, $stylesheets);

    expect($preloads[0])->toBe(['<link rel="preload" href="'.Assets::url(Assets::TEXT_FONT).'" as="font" type="font/woff2" crossorigin>'])
        ->and($stylesheets[0])->toBe(['<link rel="stylesheet" href="/css/site.css?v='.sha1_file(public_path('css/site.css')).'">']);
});

it('can draw TrueType text with GD for the Open Graph images', function (): void {
    expect(extension_loaded('gd'))->toBeTrue()
        ->and(function_exists('imagettftext'))->toBeTrue()
        ->and(gd_info()['FreeType Support'] ?? false)->toBeTrue()
        ->and(gd_info()['PNG Support'] ?? false)->toBeTrue();
});
