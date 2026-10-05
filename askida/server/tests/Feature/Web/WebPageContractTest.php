<?php

use PHPUnit\Framework\AssertionFailedError;
use Tests\Feature\Web\Support\WebPage;

/*
| The markup checks of the shared public page helper (WebPage::assertNoInlineStyleOrScript)
| read the DOM: escaped text that looks like an attribute passes, real attributes fail.
*/

function contractPage(string $head, string $body): string
{
    return '<!doctype html><html lang="tr"><head><meta charset="utf-8">'.$head.'</head><body>'.$body.'</body></html>';
}

it('accepts escaped markup inside attribute values and text', function (): void {
    $payload = e('"><img src=x onerror=alert(1) style="color:red">');

    WebPage::assertNoInlineStyleOrScript(contractPage(
        '<meta name="description" content="Fırın '.$payload.'"><script type="application/ld+json">'.json_encode(['name' => '<script>'], JSON_HEX_TAG).'</script>',
        '<h1>Fırın '.$payload.'</h1><p>&lt;style&gt;p{}&lt;/style&gt; onclick=x</p>',
    ));

    expect(true)->toBeTrue();
});

it('rejects real inline styles, scripts and event handlers', function (string $head, string $body): void {
    expect(fn () => WebPage::assertNoInlineStyleOrScript(contractPage($head, $body)))->toThrow(AssertionFailedError::class);
})->with([
    'style element' => ['<style>p{color:red}</style>', '<p>x</p>'],
    'style attribute' => ['', '<p style="color:red">x</p>'],
    'event handler' => ['', '<img src="/a.png" alt="" onerror="x()">'],
    'event handler on svg' => ['', '<svg onload="x()"></svg>'],
    'javascript url' => ['', '<a href=" javascript:x()">x</a>'],
    'executable script' => ['<script>x()</script>', ''],
]);
