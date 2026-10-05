<?php

use Illuminate\Support\Facades\File;

/*
| Design guardrails (design decision section 8) and copy rules of the public web, checked
| on the sources: Blade views of the public web and its components, the guide and legal
| Markdown/PHP content and the stylesheet. A directory that does not exist yet contributes
| no files.
*/

/**
 * @param  list<string>  $directories  paths relative to the server root
 * @return array<string, string> relative path => contents
 */
function guardrailFiles(array $directories, array $except = []): array
{
    $files = [];

    foreach ($directories as $directory) {
        $absolute = base_path($directory);

        if (is_file($absolute)) {
            $files[$directory] = (string) file_get_contents($absolute);

            continue;
        }

        if (! is_dir($absolute)) {
            continue;
        }

        foreach (File::allFiles($absolute) as $file) {
            $relative = $directory.'/'.str_replace('\\', '/', $file->getRelativePathname());

            foreach ($except as $prefix) {
                if (str_starts_with($relative, $prefix)) {
                    continue 2;
                }
            }

            $files[$relative] = $file->getContents();
        }
    }

    return $files;
}

/**
 * Public web copy and markup: views, components, content and the stylesheet. The payment
 * pages are the provider's flow, not public web copy.
 *
 * @return array<string, string>
 */
function guardrailPublicSources(): array
{
    return guardrailFiles(
        ['resources/views/web', 'resources/views/components/web', 'resources/content', 'public/css/site.css'],
        ['resources/views/web/pay/'],
    );
}

it('finds the public web sources it guards', function (): void {
    expect(array_keys(guardrailPublicSources()))
        ->toContain('public/css/site.css')
        ->toContain('resources/views/web/layouts/site.blade.php')
        ->toContain('resources/views/components/web/head.blade.php');
});

it('never uses pity words in public copy', function (): void {
    foreach (guardrailPublicSources() as $path => $contents) {
        expect($contents)->not->toMatch('/muhtaç|fakir|yoksul|ihtiyaç sahibi/iu', $path);
    }
});

it('keeps the stylesheet flat and never transforms case', function (): void {
    $css = (string) file_get_contents(public_path('css/site.css'));

    expect($css)->not->toMatch('/text-transform\s*:\s*uppercase/i')
        ->not->toMatch('/linear-gradient|radial-gradient|conic-gradient/i')
        ->not->toMatch('/backdrop-filter/i')
        ->not->toMatch('/(?<![\w-])filter\s*:/i');

    preg_match_all('/([^{}]*)\{[^{}]*box-shadow[^{}]*\}/i', $css, $rules);

    foreach ($rules[1] as $selector) {
        expect(trim($selector))->toMatch('/^(\.sheet|\.dialog)\b/', 'box-shadow outside .sheet / .dialog: '.trim($selector));
    }
});

it('draws no textures, people, hands or hearts in markup', function (): void {
    foreach (guardrailPublicSources() as $path => $contents) {
        expect($contents)->not->toMatch('/<pattern\b|feTurbulence|<image\b/i', $path)
            ->not->toMatch('/\bid="[^"]*(hand|heart|person|people)[^"]*"/i', $path);
    }

    foreach (['public/logo', 'public/fonts', 'resources/views/components/web', 'resources/views/web'] as $directory) {
        foreach (array_keys(guardrailFiles([$directory])) as $path) {
            expect(basename($path))->not->toMatch('/hand|heart|person|people/i', $path);
        }
    }
});

it('links no external host and no mailbox from the sources', function (): void {
    foreach (guardrailPublicSources() as $path => $contents) {
        expect($contents)->not->toMatch('#(href|src)\s*=\s*["\']\s*(https?:)?//#i', $path)
            ->not->toMatch('#url\(\s*["\']?(https?:)?//#i', $path)
            ->not->toMatch('/mailto:/i', $path);
    }
});

it('keeps placeholders out of the public web', function (): void {
    $sources = guardrailFiles([
        'resources/views/web',
        'resources/views/components/web',
        'resources/content',
        'public/css/site.css',
        'app/Support/Web',
        'app/Domain/Web',
        'app/View/Components/Web',
        'app/Http/Controllers/Web',
    ]);

    // Built from parts so that this file does not trip the repository's own marker grep.
    $markers = '/\b('.implode('|', ['TO'.'DO', 'FIX'.'ME', 'XX'.'X', 'lo'.'rem']).')\b|YOUR'.'_/i';

    foreach ($sources as $path => $contents) {
        expect($contents)->not->toMatch($markers, $path);
    }
});

it('prints unescaped HTML only in the prose component and the provider checkout', function (): void {
    $allowed = ['resources/views/components/web/prose.blade.php', 'resources/views/web/pay/checkout.blade.php'];

    foreach (guardrailFiles(['resources/views']) as $path => $contents) {
        if (in_array($path, $allowed, true)) {
            continue;
        }

        expect($contents)->not->toContain('{!!', $path);
    }

    expect(substr_count((string) file_get_contents(resource_path('views/components/web/prose.blade.php')), '{!!'))->toBe(1);
});
