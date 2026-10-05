<?php

use App\Domain\Web\Content\ContentRenderer;
use Tests\Datasets\XssPayloads;
use Tests\Security\Xss\XssSurface;

/*
| Stored-XSS sweep, the unescaped output sites (security checklist item 16). Blade's
| `{{ }}` escapes; the places that do not are listed here and each one has a reason. A new
| unescaped echo, a new HtmlString or a new `->html()` in the panel fails this file until
| it is reviewed and added with its justification.
*/

/**
 * @return list<string> "relative/path:line" of every match of the needle under $directory
 */
function sourceMatches(string $directory, string $needle, string $glob = '*.php'): array
{
    $root = realpath($directory);
    expect($root)->not->toBeFalse();

    $found = [];
    $files = new RecursiveIteratorIterator(new RecursiveDirectoryIterator((string) $root, FilesystemIterator::SKIP_DOTS));

    foreach ($files as $file) {
        if (! $file instanceof SplFileInfo || ! $file->isFile() || ! fnmatch($glob, $file->getFilename())) {
            continue;
        }

        foreach (file($file->getPathname(), FILE_IGNORE_NEW_LINES) ?: [] as $number => $line) {
            if (str_contains($line, $needle)) {
                $found[] = str_replace('\\', '/', substr($file->getPathname(), strlen((string) $root) + 1)).':'.($number + 1);
            }
        }
    }

    sort($found);

    return $found;
}

it('has exactly the two known unescaped echoes in the views', function (): void {
    expect(sourceMatches(resource_path('views'), '{!!', '*.blade.php'))->toBe([
        // Purified guide and legal HTML only (ContentRenderer: raw HTML stripped, unsafe links refused, allowlist).
        'components/web/prose.blade.php:2',
        // Provider checkout markup kept by PayPageStore; the nonce is added to its inline scripts by PayController.
        'web/pay/checkout.blade.php:17',
    ]);
});

it('feeds the prose component only from the content renderer', function (): void {
    $callers = sourceMatches(resource_path('views'), 'x-web.prose', '*.blade.php');

    expect($callers)->toBe(['web/content/guide.blade.php:17', 'web/content/legal.blade.php:17']);
    expect(file_get_contents(resource_path('views/web/content/guide.blade.php')))->toContain(':html="$guide->body"');
    expect(file_get_contents(resource_path('views/web/content/legal.blade.php')))->toContain(':html="$page->body"');
});

it('has no raw echo helpers or escape bypasses in the views', function (string $needle): void {
    expect(sourceMatches(resource_path('views'), $needle, '*.blade.php'))->toBe([]);
})->with([
    'php echo' => ['<?= '],
    'verbatim blocks' => ['@verbatim'],
    'raw directive' => ['@php echo'],
    'unescaped legacy echo' => ['{{{'],
]);

it('reads the request in a view only to pick the current navigation link', function (): void {
    // The path is compared with the fixed link list and never echoed.
    expect(sourceMatches(resource_path('views'), 'request()->', '*.blade.php'))->toBe(['components/web/nav.blade.php:6']);
    expect(file_get_contents(resource_path('views/components/web/nav.blade.php')))->toContain("\$current = '/'.trim(request()->getPathInfo(), '/');");
});

it('keeps the admin panel free of unescaped output', function (string $needle): void {
    $allowed = [
        // The empty stand-in of the financial reveal modal (no stored value inside).
        'HtmlString' => ['Support/RevealFinancialsAction.php:10', 'Support/RevealFinancialsAction.php:52'],
    ];

    expect(sourceMatches(app_path('Filament'), $needle))->toBe($allowed[$needle] ?? []);
})->with(['HtmlString', '->html()', 'new Htmlable', 'ViewField::make', '->renderHtml(', 'RawJs']);

it('renders markdown payloads in guides and legal pages as allowlisted markup only', function (string $payload): void {
    $renderer = new ContentRenderer;
    $markdown = "## Başlık\n\n{$payload}\n\n[bağlantı]({$payload})\n\n[js](javascript:alert(1))\n\n| a | b |\n| - | - |\n| {$payload} | x |\n";

    $html = (string) $renderer->render($markdown);
    $dom = XssSurface::dom($html);

    XssSurface::assertNoDangerousAttributes($dom);

    $allowed = ['html', 'body', 'p', 'h2', 'h3', 'ul', 'ol', 'li', 'a', 'strong', 'em', 'blockquote', 'code', 'pre', 'table', 'thead', 'tbody', 'tr', 'th', 'td'];

    foreach (XssSurface::xpath($dom)->query('//*') ?: [] as $element) {
        expect($allowed)->toContain($element->nodeName);

        if ($element instanceof DOMElement && $element->nodeName !== 'a') {
            expect($element->attributes->length)->toBe(0);
        }
    }

    foreach (XssSurface::xpath($dom)->query('//a') ?: [] as $anchor) {
        assert($anchor instanceof DOMElement);
        expect(strtolower($anchor->getAttribute('href')))->not->toStartWith('javascript:')->not->toStartWith('data:');
    }
})->with(XssPayloads::everything());
