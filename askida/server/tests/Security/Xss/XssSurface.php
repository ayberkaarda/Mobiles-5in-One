<?php

namespace Tests\Security\Xss;

use App\Support\Web\Facts;
use App\Support\Web\Origin;
use DOMDocument;
use DOMElement;
use DOMNode;
use DOMXPath;
use PHPUnit\Framework\Assert;
use SimpleXMLElement;

/**
 * Rendering-context aware assertions of the stored-XSS sweep. Nothing here greps the raw
 * markup for a payload substring: escaped text such as `&lt;img onerror=` legitimately
 * contains `onerror=`. HTML is parsed into a DOM and the checks read elements and
 * attributes; XML is parsed and read through text nodes; JSON is decoded.
 */
final class XssSurface
{
    /** Attributes whose value is a URL the browser may navigate to or load. */
    private const URL_ATTRIBUTES = ['href', 'src', 'action', 'formaction', 'xlink:href', 'poster', 'data', 'srcset'];

    public static function dom(string $html): DOMDocument
    {
        $dom = new DOMDocument;
        $previous = libxml_use_internal_errors(true);
        $dom->loadHTML('<?xml encoding="utf-8"?>'.$html, LIBXML_NONET);
        libxml_clear_errors();
        libxml_use_internal_errors($previous);

        return $dom;
    }

    public static function xpath(DOMDocument $dom): DOMXPath
    {
        return new DOMXPath($dom);
    }

    /**
     * A public page is inert: the only script elements are JSON-LD data blocks (exactly
     * $ldBlocks of them), no `<style>` element, no attribute named `on*`, and no URL
     * attribute whose value starts with `javascript:` or `data:`.
     */
    public static function assertInertPage(string $html, int $ldBlocks): DOMDocument
    {
        $dom = self::dom($html);

        $scripts = $dom->getElementsByTagName('script');
        Assert::assertSame($ldBlocks, $scripts->length, 'Unexpected number of <script> elements.');

        foreach ($scripts as $script) {
            Assert::assertInstanceOf(DOMElement::class, $script);
            Assert::assertSame('application/ld+json', $script->getAttribute('type'), 'Only JSON-LD script blocks are allowed.');
            Assert::assertFalse($script->hasAttribute('src'));
        }

        Assert::assertSame(0, $dom->getElementsByTagName('style')->length, 'No <style> element is allowed.');

        self::assertNoDangerousAttributes($dom);
        self::assertNoExternalReferences($dom);
        self::assertJsonLdBlocks($html, $ldBlocks);

        return $dom;
    }

    /**
     * Read from attributes only (escaped text such as `url(//attacker.test/a.css)` inside a
     * text node is not a reference): no `style` attribute, and every URL attribute is relative,
     * an app deep link, a configured store URL, or on the own host.
     */
    public static function assertNoExternalReferences(DOMDocument $dom): void
    {
        $ownHost = parse_url(Origin::base(), PHP_URL_HOST);
        $storeUrls = array_values(Facts::storeUrls());

        foreach (self::xpath($dom)->query('//*[@*]') ?: [] as $element) {
            Assert::assertInstanceOf(DOMElement::class, $element);

            foreach ($element->attributes as $attribute) {
                $name = strtolower($attribute->nodeName);
                $value = trim((string) $attribute->nodeValue);

                Assert::assertNotSame('style', $name, "style attribute on <{$element->nodeName}>.");

                if (! in_array($name, self::URL_ATTRIBUTES, true) || preg_match('#^(?:https?:)?//#i', $value) !== 1 || in_array($value, $storeUrls, true)) {
                    continue;
                }

                $host = parse_url(str_starts_with($value, '//') ? 'https:'.$value : $value, PHP_URL_HOST);

                Assert::assertSame($ownHost, $host, "External reference {$value} in {$name} on <{$element->nodeName}>.");
            }
        }
    }

    /**
     * No attribute named `on*` and no javascript:/data: URL on any element (also valid for
     * panel pages, whose own script elements are checked by structure instead).
     */
    public static function assertNoDangerousAttributes(DOMDocument $dom): void
    {
        foreach (self::xpath($dom)->query('//*') ?: [] as $element) {
            Assert::assertInstanceOf(DOMElement::class, $element);

            foreach ($element->attributes as $attribute) {
                $name = strtolower($attribute->nodeName);

                Assert::assertFalse(str_starts_with($name, 'on'), "Event handler attribute {$name} on <{$element->nodeName}>.");

                if (in_array($name, self::URL_ATTRIBUTES, true)) {
                    $value = strtolower((string) preg_replace('/\s+/', '', (string) $attribute->nodeValue));

                    Assert::assertFalse(str_starts_with($value, 'javascript:'), "javascript: URL in {$name} on <{$element->nodeName}>.");
                    Assert::assertFalse(str_starts_with($value, 'data:'), "data: URL in {$name} on <{$element->nodeName}>.");
                }
            }
        }
    }

    /**
     * JSON-LD blocks must not be breakable: every `<script` in the markup is a parsed
     * JSON-LD block (a breakout would add a script element or leave a stray closing tag),
     * `</script` appears once per block, and the JSON text of each block contains no raw
     * `<`, `>` or `&` (JSON_HEX_TAG | JSON_HEX_AMP) and decodes.
     */
    public static function assertJsonLdBlocks(string $html, int $expected): void
    {
        $dom = self::dom($html);
        $blocks = self::xpath($dom)->query('//script[@type="application/ld+json"]');

        Assert::assertNotFalse($blocks);
        Assert::assertSame($expected, $blocks->length);
        Assert::assertSame($expected, substr_count(strtolower($html), '<script'), 'A <script start that is not a JSON-LD block.');
        Assert::assertSame($expected, substr_count(strtolower($html), '</script'), 'A </script end that is not a JSON-LD block end.');

        foreach ($blocks as $block) {
            $json = $block->textContent;

            Assert::assertStringNotContainsString('</script', strtolower($json));
            Assert::assertDoesNotMatchRegularExpression('/[<>&]/', $json, 'JSON-LD must encode <, > and & as unicode escapes.');
            json_decode($json, true, flags: JSON_THROW_ON_ERROR);
        }
    }

    /**
     * The decoded JSON-LD blocks, in document order.
     *
     * @return list<array<string, mixed>>
     */
    public static function jsonLd(string $html): array
    {
        $blocks = self::xpath(self::dom($html))->query('//script[@type="application/ld+json"]');
        $decoded = [];

        foreach ($blocks ?: [] as $block) {
            $value = json_decode($block->textContent, true, flags: JSON_THROW_ON_ERROR);
            Assert::assertIsArray($value);
            /** @var array<string, mixed> $value */
            $decoded[] = $value;
        }

        return $decoded;
    }

    /**
     * The payload is displayed as text: the text content of the first node matching the
     * XPath query equals the stored string exactly.
     */
    public static function assertNodeText(DOMDocument $dom, string $query, string $expected): void
    {
        $nodes = self::xpath($dom)->query($query);

        Assert::assertNotFalse($nodes);
        Assert::assertGreaterThan(0, $nodes->length, "No node for {$query}.");
        Assert::assertSame($expected, $nodes->item(0)?->textContent, "Text of {$query}.");
    }

    /**
     * The document's text content contains the value, i.e. it was rendered as characters.
     * $limit cuts the value for fields that the surface truncates itself.
     */
    public static function assertDisplayedAsText(DOMDocument $dom, string $value, ?int $limit = null): void
    {
        $needle = $limit === null ? $value : mb_substr($value, 0, $limit);

        Assert::assertStringContainsString($needle, (string) $dom->textContent, 'The value is not displayed as text.');
    }

    /**
     * Element structure: one entry per element in document order, the element name and its
     * sorted attribute names (values and text left out). Rendering the same surface with a
     * benign value and with a payload must give the same structure: a payload that
     * becomes markup adds elements or attributes.
     *
     * @return list<string>
     */
    public static function structure(string $html): array
    {
        $dom = self::dom($html);
        $structure = [];

        $walk = static function (DOMNode $node) use (&$walk, &$structure): void {
            if ($node instanceof DOMElement) {
                $names = [];

                foreach ($node->attributes as $attribute) {
                    $names[] = $attribute->nodeName;
                }

                sort($names);
                $structure[] = $node->nodeName.'['.implode(',', $names).']';
            }

            foreach ($node->childNodes as $child) {
                $walk($child);
            }
        };

        $walk($dom);

        return $structure;
    }

    public static function assertSameStructure(string $payloadHtml, string $baselineHtml, string $surface): void
    {
        $actual = self::structure($payloadHtml);
        $baseline = self::structure($baselineHtml);

        Assert::assertSame(
            $baseline,
            $actual,
            "{$surface}: the payload changed the element structure; extra: ".json_encode(array_values(array_diff($actual, $baseline))).' missing: '.json_encode(array_values(array_diff($baseline, $actual))),
        );
    }

    /**
     * Dangerous URL schemes (javascript:, data:) found in URL attributes, as "name=scheme".
     * Panel pages legitimately use a few data: URLs (inline images), so they are compared
     * with a benign rendering instead of being forbidden outright; javascript: is never allowed.
     *
     * @return list<string>
     */
    public static function urlSchemes(string $html): array
    {
        $found = [];

        foreach (self::xpath(self::dom($html))->query('//*[@*]') ?: [] as $element) {
            Assert::assertInstanceOf(DOMElement::class, $element);

            foreach ($element->attributes as $attribute) {
                $name = strtolower($attribute->nodeName);
                $value = strtolower((string) preg_replace('/\s+/', '', (string) $attribute->nodeValue));

                if (in_array($name, self::URL_ATTRIBUTES, true) && (str_starts_with($value, 'javascript:') || str_starts_with($value, 'data:'))) {
                    $found[] = $name.'='.explode(':', $value, 2)[0];
                }
            }
        }

        sort($found);

        return $found;
    }

    /**
     * Panel surfaces: same element structure, same dangerous URL attributes as the benign
     * rendering, no javascript: URL, no `on*` attribute that the benign rendering lacks.
     */
    public static function assertPanelInert(string $payloadHtml, string $baselineHtml, string $surface): void
    {
        self::assertSameStructure($payloadHtml, $baselineHtml, $surface);

        $schemes = self::urlSchemes($payloadHtml);

        Assert::assertSame(self::urlSchemes($baselineHtml), $schemes, "{$surface}: dangerous URL attributes changed.");
        Assert::assertNotContains('href=javascript', $schemes);

        foreach (self::structure($payloadHtml) as $entry) {
            Assert::assertDoesNotMatchRegularExpression('/[\[,]on[a-z]+[\],]/i', $entry, "{$surface}: event handler attribute in {$entry}.");
        }
    }

    /**
     * XML surfaces: the document parses (a payload that broke out of a text node would not).
     */
    public static function xml(string $xml): SimpleXMLElement
    {
        $previous = libxml_use_internal_errors(true);
        $document = simplexml_load_string($xml, options: LIBXML_NONET);
        $errors = libxml_get_errors();
        libxml_clear_errors();
        libxml_use_internal_errors($previous);

        Assert::assertNotFalse($document, 'The XML does not parse: '.json_encode(array_map(static fn ($e): string => trim($e->message), $errors)));

        return $document;
    }

    /**
     * Plain text and mail text parts: the raw `<script` byte sequence is absent.
     */
    public static function assertNoRawScript(string $text, string $surface): void
    {
        Assert::assertStringNotContainsStringIgnoringCase('<script', $text, "{$surface}: raw <script in a text surface.");
    }
}
