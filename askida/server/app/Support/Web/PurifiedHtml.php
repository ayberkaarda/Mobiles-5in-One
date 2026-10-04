<?php

namespace App\Support\Web;

use Stringable;

/**
 * HTML that has already been through the guide pipeline (Markdown with raw HTML stripped,
 * then the HTMLPurifier allowlist). `<x-web.prose>` accepts only this type, so the single
 * unescaped echo of the public web can only print purified markup. Construct it only from
 * the purifier's output.
 */
final readonly class PurifiedHtml implements Stringable
{
    public function __construct(public string $html) {}

    public function __toString(): string
    {
        return $this->html;
    }
}
