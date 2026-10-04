<?php

use App\Support\Web\Assets;

/*
| public/css/site.css carries the brand tokens (askida/brand/tokens.json) as custom
| properties: every colour role of both schemes, the type scale, radius, stroke, spacing,
| motion and layout values. The brand file is the one source; this test fails when the two
| drift. The brand directory sits next to the server (mounted at /var/www/brand in Docker).
*/

function tokensCssBrand(): array
{
    $path = dirname(base_path()).'/brand/tokens.json';

    expect(is_file($path))->toBeTrue('Missing '.$path);

    return json_decode((string) file_get_contents($path), true, flags: JSON_THROW_ON_ERROR);
}

function tokensCssSource(): string
{
    return (string) file_get_contents(public_path(Assets::STYLESHEET));
}

/**
 * Custom properties declared in the first block that follows the given selector.
 *
 * @return array<string, string>
 */
function tokensCssVariables(string $css, string $selector): array
{
    $start = strpos($css, $selector.' {');

    expect($start)->not->toBeFalse('Missing block '.$selector);

    $open = strpos($css, '{', (int) $start);
    $close = strpos($css, '}', (int) $open);
    $body = substr($css, (int) $open + 1, (int) $close - (int) $open - 1);

    preg_match_all('/(--[a-z0-9-]+)\s*:\s*([^;]+);/i', $body, $matches, PREG_SET_ORDER);

    $variables = [];

    foreach ($matches as [, $name, $value]) {
        $variables[$name] = trim($value);
    }

    return $variables;
}

function tokensCssKebab(string $name): string
{
    return strtolower((string) preg_replace('/(?<=[a-z0-9])([A-Z]+)/', '-$1', $name));
}

it('declares every colour role of both schemes with the token value', function (string $scheme, string $selector): void {
    $roles = tokensCssBrand()['color']['scheme'][$scheme];
    $variables = tokensCssVariables(tokensCssSource(), $selector);

    expect($roles)->not->toBeEmpty();

    foreach ($roles as $role => $value) {
        expect(strtoupper($variables['--'.tokensCssKebab($role)] ?? ''))->toBe(strtoupper($value), "--{$role} in {$selector}");
    }
})->with([
    'light' => ['light', ':root'],
    'dark (system preference)' => ['dark', ':root:not([data-theme="light"])'],
    'dark (data-theme)' => ['dark', ':root[data-theme="dark"]'],
]);

it('declares the web type scale, radius, stroke, spacing, motion and layout tokens', function (): void {
    $tokens = tokensCssBrand();
    $root = tokensCssVariables(tokensCssSource(), ':root');
    $expected = [];

    foreach ($tokens['typography']['scale'] as $style => $definition) {
        $expected['--fs-'.tokensCssKebab($style)] = $definition['web']['size'].'px';
        $expected['--lh-'.tokensCssKebab($style)] = $definition['web']['lineHeight'].'px';
    }

    foreach ($tokens['radius'] as $name => $value) {
        $expected['--radius-'.tokensCssKebab($name)] = $value.'px';
    }

    foreach ($tokens['stroke'] as $name => $value) {
        $expected[$name === 'focusOffset' ? '--stroke-focus-offset' : '--stroke-'.tokensCssKebab($name)] = $value.'px';
    }

    foreach ($tokens['spacing'] as $step => $value) {
        $expected['--space-'.$step] = $value.'px';
    }

    foreach ($tokens['motion']['duration'] as $name => $value) {
        $expected['--motion-'.tokensCssKebab($name)] = $value.'ms';
    }

    foreach ($tokens['motion']['easing'] as $name => $points) {
        $expected['--ease-'.$name] = 'cubic-bezier('.implode(', ', $points).')';
    }

    $expected['--max-width'] = $tokens['layout']['webMaxWidth'].'px';
    $expected['--gutter'] = $tokens['layout']['webGutter'].'px';
    $expected['--page-gutter'] = $tokens['layout']['webPageGutterMobile'].'px';
    $expected['--measure'] = $tokens['layout']['bodyColumnCh'].'ch';

    foreach ($expected as $name => $value) {
        expect($root[$name] ?? null)->toBe($value, $name);
    }
});

it('uses the mobile hero size of the tokens under 640 px', function (): void {
    $hero = tokensCssBrand()['typography']['scale']['hero']['webMobile'];
    $mobile = tokensCssVariables(tokensCssSource(), "@media (max-width: 639px) {\n  :root");

    expect($mobile['--fs-hero'] ?? null)->toBe($hero['size'].'px')
        ->and($mobile['--lh-hero'] ?? null)->toBe($hero['lineHeight'].'px');
});

it('keeps the token fallback stack after the Bricolage families', function (): void {
    $root = tokensCssVariables(tokensCssSource(), ':root');
    $fallback = tokensCssBrand()['typography']['fallback']['web'];

    expect(str_replace('"BricolageTextFallback", ', '', $root['--font-text']))->toBe($fallback);
});

it('keeps the stylesheet within 14 KB gzip', function (): void {
    $size = strlen((string) gzencode(tokensCssSource(), 9));

    expect($size)->toBeLessThanOrEqual(14 * 1024);
});

it('honours reduced motion and the system colour scheme', function (): void {
    $css = tokensCssSource();

    expect($css)->toContain('@media (prefers-reduced-motion: reduce)')
        ->toContain('@media (prefers-color-scheme: dark)')
        ->toContain(':root[data-theme="dark"]');
});
