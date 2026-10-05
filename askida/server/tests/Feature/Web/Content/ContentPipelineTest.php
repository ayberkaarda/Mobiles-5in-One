<?php

use App\Domain\Web\Content\ContentRenderer;
use App\Domain\Web\Content\FactTokens;
use App\Domain\Web\Content\MarkdownLoader;
use App\Support\Web\PurifiedHtml;

/*
| The guide pipeline: Markdown without raw HTML, then the HTMLPurifier allowlist. The
| renderer is the only producer of the PurifiedHtml that the prose component prints.
*/

function renderMarkdown(string $markdown): string
{
    return app(ContentRenderer::class)->render($markdown)->html;
}

it('returns the type that the prose component accepts', function (): void {
    expect(app(ContentRenderer::class)->render('Merhaba'))->toBeInstanceOf(PurifiedHtml::class);
});

it('keeps the allowlisted markup', function (): void {
    $html = renderMarkdown(<<<'MD'
## Soru?

Bir **kalın** ve *eğik* metin, `kod` ve [iç bağlantı](/sss).

- bir
- iki

1. üç

> alıntı

| a | b |
|---|---|
| 1 | 2 |

```
blok
```
MD);

    expect($html)->toContain('<h2>Soru?</h2>')
        ->toContain('<strong>kalın</strong>')
        ->toContain('<em>eğik</em>')
        ->toContain('<code>kod</code>')
        ->toContain('<a href="/sss">iç bağlantı</a>')
        ->toContain('<ul>')
        ->toContain('<ol>')
        ->toContain('<blockquote>')
        ->toContain('<table>')
        ->toContain('<thead>')
        ->toContain('<tbody>')
        ->toContain('<pre>');
});

it('strips raw HTML, scripts, handlers and styles', function (): void {
    $html = renderMarkdown(<<<'MD'
Önce <script>alert(1)</script> sonra <img src=x onerror=alert(1)> ve <b style="color:red" onclick="x()">kalın</b>.

<div class="x">blok</div>

<iframe src="https://example.test"></iframe>
MD);

    expect($html)->not->toMatch('/<script|<img|<iframe|<div|<b\b|onerror|onclick|style=/i')
        ->not->toContain('alert(1)</script>');
});

it('refuses unsafe link schemes and mail links', function (string $link): void {
    $html = renderMarkdown('[tıkla]('.$link.')');

    expect($html)->not->toMatch('/javascript:|data:|vbscript:|mailto:|tel:/i')
        ->toContain('tıkla');
})->with([
    'javascript' => 'javascript:alert(1)',
    'mixed case' => 'JaVaScRiPt:alert(1)',
    'data' => 'data:text/html;base64,PHNjcmlwdD4=',
    'vbscript' => 'vbscript:x',
    'mail' => 'mailto:biri@example.test',
    'tel' => 'tel:+900000000000',
]);

it('drops links to other hosts and keeps links on the own host', function (): void {
    $external = renderMarkdown('[dış](https://example.test/yol)');
    $own = renderMarkdown('[iç](https://askida.app/sss)');

    expect($external)->not->toContain('example.test')
        ->and($own)->toContain('href="https://askida.app/sss"');
});

it('removes headings above H2 and below H3 from the allowlist', function (): void {
    $html = renderMarkdown("# Bir\n\n#### Dört\n\nmetin");

    expect($html)->not->toMatch('/<h1|<h4/')
        ->toContain('metin');
});

it('fills the fact tokens and rejects unknown ones', function (): void {
    config(['payments.commission_bps' => 750]);

    expect(FactTokens::replace('{{commission}} ve {{ code_length }}'))->toBe('%7,5 (örnek oran) ve 8')
        ->and(FactTokens::replace('{{radius_default_km}} {{radius_max_km}}'))->toBe('3 5')
        ->and(fn () => FactTokens::replace('{{bilinmeyen}}'))->toThrow(InvalidArgumentException::class, 'Unknown fact token: bilinmeyen');
});

it('rejects a content file without front matter, with a missing key or a wrong slug', function (): void {
    $dir = sys_get_temp_dir().'/content-'.bin2hex(random_bytes(4));
    mkdir($dir);

    $write = static function (string $name, string $contents) use ($dir): string {
        file_put_contents($dir.'/'.$name.'.md', $contents);

        return $dir.'/'.$name.'.md';
    };

    $loader = app(MarkdownLoader::class);
    $front = "title: T\ndescription: D\nanswer: A\npublished: 2026-10-04\nupdated: 2026-10-04\n";

    $none = $write('none', "metin\n");
    $missing = $write('missing', "---\n{$front}---\nmetin\n");
    $wrong = $write('wrong', "---\nslug: baska\n{$front}---\nmetin\n");
    $ok = $write('ok', "---\nslug: ok\n{$front}---\nmetin {{code_length}}\n");

    try {
        expect(fn () => $loader->load($none))->toThrow(RuntimeException::class, 'Front matter block missing')
            ->and(fn () => $loader->load($missing))->toThrow(RuntimeException::class, "Front matter key 'slug' is missing")
            ->and(fn () => $loader->load($wrong))->toThrow(RuntimeException::class, 'slug must equal the file name')
            ->and(fn () => $loader->load($dir.'/absent.md'))->toThrow(RuntimeException::class, 'not readable');

        $page = $loader->load($ok);

        expect($page->slug)->toBe('ok')
            ->and($page->updated->toDateString())->toBe('2026-10-04')
            ->and($page->markdown)->toBe('metin 8')
            ->and($page->body->html)->toContain('metin 8');
    } finally {
        array_map('unlink', glob($dir.'/*.md') ?: []);
        rmdir($dir);
    }
});

it('prints a script in a document body as text, never as markup, on a rendered page', function (): void {
    $dir = resource_path('content/guides');
    $source = (string) file_get_contents($dir.'/askida-ekmek-gelenegi-nedir.md');

    // The pipeline is exercised on the same shape as a guide: front matter plus hostile body.
    $path = sys_get_temp_dir().'/askida-ekmek-gelenegi-nedir.md';
    file_put_contents($path, preg_replace('/\n---\n.*\z/s', "\n---\n## Soru?\n\n<script>alert(1)</script> [x](javascript:alert(1))\n", $source));

    try {
        $page = app(MarkdownLoader::class)->load($path);

        expect($page->body->html)->not->toContain('<script')->not->toContain('javascript:');
    } finally {
        unlink($path);
    }
});
