<?php

namespace App\Http\Controllers\Web\Seo;

use App\Http\Controllers\Controller;
use App\Support\Web\Origin;
use Illuminate\Http\Response;

/**
 * `/robots.txt`: everything is open to crawlers except the admin panel, the payment
 * pages, the account deletion page and the share images; the sitemap is on the
 * configured origin.
 */
final class RobotsController extends Controller
{
    public const DISALLOW = ['/admin', '/pay/', '/hesap-silme', '/og/'];

    public function __invoke(): Response
    {
        $lines = ['User-agent: *', 'Allow: /'];

        foreach (self::DISALLOW as $path) {
            $lines[] = 'Disallow: '.$path;
        }

        $lines[] = '';
        $lines[] = 'Sitemap: '.Origin::url('/sitemap.xml');

        return new Response(implode("\n", $lines)."\n", 200, [
            'Content-Type' => 'text/plain; charset=utf-8',
        ]);
    }
}
