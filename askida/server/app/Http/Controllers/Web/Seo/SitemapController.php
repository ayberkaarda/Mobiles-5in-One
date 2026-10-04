<?php

namespace App\Http\Controllers\Web\Seo;

use App\Domain\Web\Directory\SitemapEntries;
use App\Http\Controllers\Controller;
use Illuminate\Http\Response;

/**
 * `/sitemap.xml`: one sitemaps.org `urlset` built in process from the known pages (the
 * site stays far below the 50 000 URL limit, so there is no sitemap index). Kept in the
 * page cache for an hour; a shop change drops it at once (Directory\ShopWebObserver).
 */
final class SitemapController extends Controller
{
    public function __invoke(SitemapEntries $entries): Response
    {
        return new Response($entries->build()->toXml(), 200, [
            'Content-Type' => 'application/xml; charset=utf-8',
        ]);
    }
}
