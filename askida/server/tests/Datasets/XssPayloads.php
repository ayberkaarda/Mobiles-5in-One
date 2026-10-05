<?php

namespace Tests\Datasets;

/**
 * The stored-XSS payload dataset of the Phase 6 sweep: twelve general payloads and two
 * JSON-LD breakout cases. Every payload is merchant or account input that reaches a
 * rendering surface (web pages, admin panel, API, mail, push, activity log).
 *
 * Usage: `->with(XssPayloads::all())`, and `XssPayloads::fit($payload, $max)` to cut a
 * payload to the column or validation limit of the field it is written to (the 1 000
 * character payload is cut to the limit; the over-limit refusal is tested separately).
 */
final class XssPayloads
{
    public const LONG_LENGTH = 1000;

    /**
     * @return array<string, array{string}>
     */
    public static function all(): array
    {
        return [
            'script element' => ['<script>alert(1)</script>'],
            'img onerror' => ['<img src=x onerror=alert(1)>'],
            'javascript href' => ['<a href="javascript:alert(1)">tikla</a>'],
            'svg onload' => ['<svg onload=alert(1)>'],
            'attribute breakout' => ['"><svg/onload=alert(1)>'],
            'template syntax' => ['{{ 7*7 }} @{{ 7*7 }} {!! 7*7 !!}'],
            'js template literal' => ['${7*7}'],
            'markdown javascript link' => ['[tikla](javascript:alert(1))'],
            'entity double encoding' => ['&amp;lt;script&amp;gt;alert(1)&amp;lt;/script&amp;gt;'],
            'style import' => ['<style>@import url(//attacker.test/a.css)</style>'],
            'long payload' => [str_repeat('<b onmouseover=alert(1)>x</b>', 40)],
            'rtl override' => ["\u{202E}<script>alert(1)</script>\u{202D}"],
        ];
    }

    /**
     * The two JSON-LD breakout cases: a closing script tag and an HTML comment opener
     * that, unescaped inside `<script type="application/ld+json">`, end the data block.
     *
     * @return array<string, array{string}>
     */
    public static function jsonLd(): array
    {
        return [
            'closing script tag' => ['</script><script>alert(1)</script>'],
            'comment opener' => ['<!--<script>'],
        ];
    }

    /**
     * Every payload (12 + 2).
     *
     * @return array<string, array{string}>
     */
    public static function everything(): array
    {
        return self::all() + self::jsonLd();
    }

    /**
     * "<prefix> <payload>" cut to $max characters. The prefix keeps the value sluggable
     * (a name made only of symbols has no slug) and readable.
     */
    public static function fit(string $payload, int $max, string $prefix = 'Fırın'): string
    {
        return mb_substr(trim($prefix.' '.$payload), 0, $max);
    }
}
