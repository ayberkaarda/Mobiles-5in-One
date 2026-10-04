<?php

namespace Tests\Feature\Web\Support;

use App\Support\Web\Facts;
use App\Support\Web\Format;
use App\Support\Web\Origin;
use DOMDocument;
use DOMElement;
use DOMXPath;
use Illuminate\Testing\TestResponse;
use Livewire\Livewire;
use PHPUnit\Framework\Assert;

/**
 * The contract every public page meets, checked on the rendered response:
 * 200 HTML, `<html lang>` as expected, no inline style or executable script (the only
 * inline script is `application/ld+json`), no event handler attributes, no external host in
 * href/src/content/url() except the configured store URLs, no `mailto:`, one H1 directly
 * followed by the 40-60 word answer paragraph, at most one primary button and a gzip-9 body
 * within the page's budget.
 */
final class WebPage
{
    /** Landing, directory and impact overview pages (first TCP window). */
    public const BUDGET = 14_000;

    /** Guides, FAQ, legal pages and province impact pages. */
    public const BUDGET_LONG = 24_000;

    public const ANSWER_MIN_WORDS = 40;

    public const ANSWER_MAX_WORDS = 60;

    /**
     * Resets framework state that outlives a test inside one PHP process: once any test has
     * rendered a Livewire component (the admin panel), Livewire would inject its own style and
     * script tags into every later HTML response of the run. Tests\TestCase::setUp() now does
     * this before every test; the call in `beforeEach` of the public page tests is kept as an
     * explicit, harmless second reset.
     */
    public static function isolate(): void
    {
        Livewire::flushState();
    }

    /**
     * @param  'tr'|'en'  $lang
     * @return string the HTML
     */
    public static function assertPublicPage(TestResponse $response, string $lang = 'tr', int $budget = self::BUDGET, bool $answer = true): string
    {
        $response->assertOk();

        Assert::assertStringStartsWith('text/html', (string) $response->headers->get('Content-Type'));

        $html = (string) $response->getContent();

        Assert::assertStringContainsString('<html lang="'.$lang.'">', $html, 'The page must render <html lang="'.$lang.'">.');

        self::assertNoInlineStyleOrScript($html);
        self::assertNoExternalHosts($html);
        self::assertBudget($html, $budget);
        self::assertSingleH1($html);
        self::assertAtMostOnePrimaryButton($html);

        if ($answer) {
            self::assertAnswerParagraph($html);
        }

        return $html;
    }

    public static function gzipSize(string $html): int
    {
        $compressed = gzencode($html, 9);

        Assert::assertIsString($compressed);

        return strlen($compressed);
    }

    public static function assertBudget(string $html, int $budget): void
    {
        $size = self::gzipSize($html);

        Assert::assertLessThanOrEqual($budget, $size, "The gzip-9 body is {$size} bytes, over the {$budget} byte budget.");
    }

    /**
     * Elements and attributes are read from the parsed DOM, not matched in the raw markup, so
     * escaped text that merely looks like markup (a shop called `"><img onerror=…>` renders
     * as `&quot;&gt;&lt;img onerror=…` inside an attribute value) is not mistaken for an
     * attribute.
     */
    public static function assertNoInlineStyleOrScript(string $html): void
    {
        $dom = new DOMDocument;
        $previous = libxml_use_internal_errors(true);
        $dom->loadHTML('<?xml encoding="utf-8"?>'.$html, LIBXML_NONET);
        libxml_clear_errors();
        libxml_use_internal_errors($previous);

        Assert::assertSame(0, $dom->getElementsByTagName('style')->length, 'Public pages ship no inline <style>.');

        foreach ((new DOMXPath($dom))->query('//*[@*]') ?: [] as $element) {
            if (! $element instanceof DOMElement) {
                continue;
            }

            foreach ($element->attributes as $attribute) {
                $name = strtolower($attribute->nodeName);

                Assert::assertNotSame('style', $name, 'Public pages carry no style="" attribute (on <'.$element->nodeName.'>).');
                Assert::assertDoesNotMatchRegularExpression('/^on[a-z]+$/', $name, 'Public pages carry no event handler attribute ('.$name.' on <'.$element->nodeName.'>).');

                if (in_array($name, ['href', 'src', 'action', 'formaction', 'xlink:href'], true)) {
                    Assert::assertDoesNotMatchRegularExpression('/^\s*javascript:/i', $attribute->nodeValue ?? '', 'No javascript: URL on <'.$element->nodeName.'>.');
                }
            }
        }

        Assert::assertDoesNotMatchRegularExpression('/(href|src|action)\s*=\s*["\']\s*javascript:/i', $html);

        preg_match_all('/<script\b([^>]*)>/i', $html, $scripts);

        foreach ($scripts[1] as $attributes) {
            Assert::assertMatchesRegularExpression('/^\s*type="application\/ld\+json"\s*$/', $attributes, 'The only inline script is an application/ld+json data block: <script'.$attributes.'>');
        }
    }

    public static function assertNoExternalHosts(string $html): void
    {
        $allowedHost = parse_url(Origin::base(), PHP_URL_HOST);
        $storeUrls = array_values(Facts::storeUrls());

        Assert::assertStringNotContainsStringIgnoringCase('mailto:', $html, 'No mailto: links on public pages.');

        preg_match_all('/\s(?:href|src|srcset|action|content|poster|data)\s*=\s*["\']([^"\']*)["\']/i', $html, $attributes);
        preg_match_all('/url\(\s*["\']?([^"\')]+)/i', $html, $urls);

        foreach ([...$attributes[1], ...$urls[1]] as $value) {
            $value = html_entity_decode(trim($value), ENT_QUOTES | ENT_HTML5);

            // App deep links (askida://…) open the app, not a host; only web URLs are checked.
            if (preg_match('#^(?:https?:)?//#i', $value) !== 1) {
                continue;
            }

            if (in_array($value, $storeUrls, true)) {
                continue;
            }

            $host = parse_url(str_starts_with($value, '//') ? 'https:'.$value : $value, PHP_URL_HOST);

            Assert::assertSame($allowedHost, $host, 'External host on a public page: '.$value);
        }
    }

    public static function assertSingleH1(string $html): void
    {
        Assert::assertSame(1, preg_match_all('/<h1[\s>]/i', $html), 'A public page has exactly one H1.');
    }

    public static function assertAtMostOnePrimaryButton(string $html): void
    {
        Assert::assertLessThanOrEqual(1, preg_match_all('/class="[^"]*\bbutton-primary\b/', $html), 'At most one primary button per page.');
    }

    /**
     * The answer paragraph directly under the H1, as plain text.
     */
    public static function answer(string $html): string
    {
        Assert::assertSame(1, preg_match_all('/class="answer"/', $html), 'A public page has exactly one answer paragraph.');
        Assert::assertSame(1, preg_match('#</h1>\s*<p class="answer">(.*?)</p>#s', $html, $match), 'The answer paragraph must follow the H1 directly.');

        return trim(html_entity_decode(strip_tags($match[1]), ENT_QUOTES | ENT_HTML5));
    }

    public static function assertAnswerParagraph(string $html): void
    {
        $words = Format::words(self::answer($html));

        Assert::assertGreaterThanOrEqual(self::ANSWER_MIN_WORDS, $words, "The answer paragraph has {$words} words.");
        Assert::assertLessThanOrEqual(self::ANSWER_MAX_WORDS, $words, "The answer paragraph has {$words} words.");
    }

    /**
     * The decoded JSON-LD blocks of a page, in document order.
     *
     * @return list<array<string, mixed>>
     */
    public static function jsonLd(string $html): array
    {
        preg_match_all('#<script type="application/ld\+json">(.*?)</script>#s', $html, $blocks);

        $decoded = [];

        foreach ($blocks[1] as $json) {
            $block = json_decode($json, true, flags: JSON_THROW_ON_ERROR);

            Assert::assertIsArray($block);

            /** @var array<string, mixed> $block */
            $decoded[] = $block;
        }

        return $decoded;
    }
}
