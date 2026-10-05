<?php

namespace App\Domain\Web\Content;

use App\Support\Web\Origin;
use App\Support\Web\PurifiedHtml;
use HTMLPurifier;
use HTMLPurifier_Config;
use League\CommonMark\Environment\Environment;
use League\CommonMark\Extension\CommonMark\CommonMarkCoreExtension;
use League\CommonMark\Extension\Table\TableExtension;
use League\CommonMark\MarkdownConverter;

/**
 * The guide pipeline: facts are filled in, Markdown is converted with raw HTML stripped and
 * unsafe link schemes refused, and the result goes through the HTMLPurifier allowlist. The
 * returned {@see PurifiedHtml} is the only input `<x-web.prose>` prints unescaped.
 */
final class ContentRenderer
{
    public const ALLOWED_TAGS = 'p,h2,h3,ul,ol,li,a[href],strong,em,blockquote,code,pre,table,thead,tbody,tr,th,td';

    private ?MarkdownConverter $converter = null;

    private ?HTMLPurifier $purifier = null;

    public function render(string $markdown): PurifiedHtml
    {
        $html = $this->converter()->convert(FactTokens::replace($markdown))->getContent();

        return new PurifiedHtml($this->purifier()->purify($html));
    }

    private function converter(): MarkdownConverter
    {
        if ($this->converter === null) {
            $environment = new Environment([
                'html_input' => 'strip',
                'allow_unsafe_links' => false,
            ]);
            $environment->addExtension(new CommonMarkCoreExtension);
            $environment->addExtension(new TableExtension);

            $this->converter = new MarkdownConverter($environment);
        }

        return $this->converter;
    }

    private function purifier(): HTMLPurifier
    {
        if ($this->purifier === null) {
            $config = HTMLPurifier_Config::createDefault();
            $config->set('Core.Encoding', 'UTF-8');
            $config->set('HTML.Doctype', 'HTML 4.01 Transitional');
            $config->set('HTML.Allowed', self::ALLOWED_TAGS);
            // Definition caching would write into the vendor directory; the documents are small.
            $config->set('Cache.DefinitionImpl', null);
            // Relative links and links on the own host only, never mailto: or tel:.
            $config->set('URI.AllowedSchemes', ['http' => true, 'https' => true]);
            $config->set('URI.Host', (string) parse_url(Origin::base(), PHP_URL_HOST));
            $config->set('URI.DisableExternal', true);
            $config->set('AutoFormat.RemoveEmpty', true);

            $this->purifier = new HTMLPurifier($config);
        }

        return $this->purifier;
    }
}
