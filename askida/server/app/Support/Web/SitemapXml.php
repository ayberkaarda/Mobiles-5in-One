<?php

namespace App\Support\Web;

use Carbon\CarbonInterface;
use InvalidArgumentException;
use XMLWriter;

/**
 * Builder of a sitemaps.org `urlset` document, assembled in process from known URLs (no
 * crawling). Every location must be absolute on the configured origin. A single file holds
 * at most MAX_URLS entries; the site stays far below it, so no sitemap index is written.
 */
final class SitemapXml
{
    public const MAX_URLS = 50_000;

    /** @var array<string, CarbonInterface|null> */
    private array $urls = [];

    /**
     * @param  string  $location  absolute URL or a site path ("/etki")
     */
    public function add(string $location, ?CarbonInterface $lastModified = null): self
    {
        $url = str_starts_with($location, '/') ? Origin::url($location) : $location;

        if (! Origin::owns($url)) {
            throw new InvalidArgumentException('Sitemap URLs must be on the configured origin: '.$location);
        }

        if (count($this->urls) >= self::MAX_URLS && ! array_key_exists($url, $this->urls)) {
            throw new InvalidArgumentException('A sitemap holds at most '.self::MAX_URLS.' URLs.');
        }

        $this->urls[$url] = $lastModified;

        return $this;
    }

    /**
     * @return list<string>
     */
    public function locations(): array
    {
        return array_keys($this->urls);
    }

    public function toXml(): string
    {
        $xml = new XMLWriter;
        $xml->openMemory();
        $xml->startDocument('1.0', 'UTF-8');
        $xml->startElement('urlset');
        $xml->writeAttribute('xmlns', 'http://www.sitemaps.org/schemas/sitemap/0.9');

        foreach ($this->urls as $url => $lastModified) {
            $xml->startElement('url');
            $xml->writeElement('loc', $url);

            if ($lastModified !== null) {
                $xml->writeElement('lastmod', $lastModified->toAtomString());
            }

            $xml->endElement();
        }

        $xml->endElement();
        $xml->endDocument();

        return $xml->outputMemory();
    }
}
