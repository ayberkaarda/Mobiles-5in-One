<?php

use PHPUnit\Framework\AssertionFailedError;
use Tests\Security\Xss\XssSurface;

/*
| Negative controls of the sweep: the assertions must fail on markup that is actually
| dangerous. Without these a helper that silently accepts everything would make the whole
| sweep green.
*/

function ldPage(string $json): string
{
    return '<!doctype html><html lang="tr"><head><title>t</title><script type="application/ld+json">'.$json.'</script></head><body><h1>x</h1></body></html>';
}

it('accepts a clean page whose payload is only escaped text', function (): void {
    $html = ldPage((string) json_encode(['name' => '</script><script>alert(1)</script>'], JSON_HEX_TAG | JSON_HEX_AMP))
        .'';
    $html = str_replace('<h1>x</h1>', '<h1>&lt;img src=x onerror=alert(1)&gt;</h1><a href="/dukkan/a">a</a>', $html);

    $dom = XssSurface::assertInertPage($html, 1);

    XssSurface::assertNodeText($dom, '//h1', '<img src=x onerror=alert(1)>');
});

it('rejects dangerous markup', function (string $html, int $scripts): void {
    expect(fn () => XssSurface::assertInertPage($html, $scripts))->toThrow(AssertionFailedError::class);
})->with([
    'script element' => ['<html><body><script>alert(1)</script></body></html>', 0],
    'script with src' => ['<html><body><script src="/x.js"></script></body></html>', 0],
    'img onerror attribute' => ['<html><body><img src="x" onerror="alert(1)"></body></html>', 0],
    'svg onload attribute' => ['<html><body><svg onload="alert(1)"></svg></body></html>', 0],
    'javascript href' => ['<html><body><a href=" JaVa&#x09;Script:alert(1)">x</a></body></html>', 0],
    'data href' => ['<html><body><a href="data:text/html,x">x</a></body></html>', 0],
    'style element' => ['<html><body><style>@import url(//attacker.test/a.css)</style></body></html>', 0],
    'style attribute' => ['<html><body><p style="background:url(//attacker.test/a.png)">x</p></body></html>', 0],
    'external script host' => ['<html><body><a href="//attacker.test/x">x</a></body></html>', 0],
    'unexpected extra ld+json block' => [ldPage('{}').ldPage('{}'), 1],
]);

it('rejects JSON-LD that a payload could break out of', function (): void {
    // json_encode without JSON_HEX_TAG leaves "</script>" inside the block: the block ends early.
    $raw = ldPage((string) json_encode(['name' => '</script><script>alert(1)</script>']));

    expect(fn () => XssSurface::assertJsonLdBlocks($raw, 1))->toThrow(AssertionFailedError::class);

    $ampersand = ldPage((string) json_encode(['name' => 'a & b'], JSON_HEX_TAG));

    expect(fn () => XssSurface::assertJsonLdBlocks($ampersand, 1))->toThrow(AssertionFailedError::class);
});

it('detects a payload that became markup by comparing element structure', function (): void {
    $benign = '<html><body><table><tr><td>gggg</td></tr></table></body></html>';
    $injected = '<html><body><table><tr><td><img src="x" onerror="alert(1)"></td></tr></table></body></html>';

    expect(fn () => XssSurface::assertPanelInert($injected, $benign, 'control'))->toThrow(AssertionFailedError::class);

    XssSurface::assertPanelInert($benign, $benign, 'control');
});

it('rejects an XML document that a payload broke', function (): void {
    expect(fn () => XssSurface::xml('<urlset><url><loc>a</loc><x><script>alert(1)</script></url></urlset>'))->toThrow(AssertionFailedError::class);

    expect((string) XssSurface::xml('<urlset><url><loc>a&lt;b</loc></url></urlset>')->url->loc)->toBe('a<b');
});

it('rejects raw script bytes in a text surface', function (): void {
    expect(fn () => XssSurface::assertNoRawScript('hello <ScRiPt>alert(1)</ScRiPt>', 'control'))->toThrow(AssertionFailedError::class);

    XssSurface::assertNoRawScript('hello &lt;script&gt;', 'control');
});
