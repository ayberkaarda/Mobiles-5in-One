<?php

namespace App\Domain\Web\Content;

use Carbon\CarbonImmutable;
use RuntimeException;

/**
 * Reads a Markdown file with a front matter block (`title`, `description`, `answer`,
 * `published`, `updated`, `slug`) into a {@see ContentPage}. Dates come only from the front
 * matter, never from the clock, so `dateModified` stays honest.
 */
final class MarkdownLoader
{
    private const REQUIRED = ['title', 'description', 'answer', 'published', 'updated', 'slug'];

    public function __construct(private readonly ContentRenderer $renderer) {}

    public function load(string $path): ContentPage
    {
        $source = is_file($path) ? file_get_contents($path) : false;

        if ($source === false) {
            throw new RuntimeException('Content file not readable: '.$path);
        }

        [$meta, $markdown] = $this->split(str_replace("\r\n", "\n", $source), $path);

        foreach (self::REQUIRED as $key) {
            if (($meta[$key] ?? '') === '') {
                throw new RuntimeException("Front matter key '{$key}' is missing in {$path}");
            }
        }

        if ($meta['slug'] !== pathinfo($path, PATHINFO_FILENAME)) {
            throw new RuntimeException('Front matter slug must equal the file name in '.$path);
        }

        $markdown = FactTokens::replace(trim($markdown));

        return new ContentPage(
            slug: $meta['slug'],
            title: FactTokens::replace($meta['title']),
            description: FactTokens::replace($meta['description']),
            answer: FactTokens::replace($meta['answer']),
            published: CarbonImmutable::parse($meta['published'], 'Europe/Istanbul'),
            updated: CarbonImmutable::parse($meta['updated'], 'Europe/Istanbul'),
            body: $this->renderer->render($markdown),
            markdown: $markdown,
        );
    }

    /**
     * @return array{0: array<string, string>, 1: string}
     */
    private function split(string $source, string $path): array
    {
        if (preg_match('/\A---\n(.*?)\n---\n(.*)\z/s', $source, $match) !== 1) {
            throw new RuntimeException('Front matter block missing in '.$path);
        }

        $meta = [];

        foreach (explode("\n", $match[1]) as $line) {
            if (trim($line) === '') {
                continue;
            }

            if (preg_match('/^([a-z_]+):\s*(.*)$/', $line, $pair) !== 1) {
                throw new RuntimeException('Malformed front matter line in '.$path.': '.$line);
            }

            $meta[$pair[1]] = trim($pair[2], " \t\"");
        }

        return [$meta, $match[2]];
    }
}
