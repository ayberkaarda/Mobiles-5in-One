<?php

namespace App\Http\Controllers\Web\Directory;

use App\Domain\Web\Directory\DirectoryQuery;
use App\Domain\Web\Directory\OgImageRenderer;
use App\Http\Controllers\Controller;
use Illuminate\Http\Response;

/**
 * `/og/dukkan/{slug}.png`: the share image of a listed shop (brand frame and the shop's
 * name), rendered once and kept on the public disk; 404 for any shop that is not public.
 * Not indexed (also disallowed in robots.txt).
 */
final class OgImageController extends Controller
{
    public function __construct(
        private readonly DirectoryQuery $directory,
        private readonly OgImageRenderer $images,
    ) {}

    public function __invoke(string $slug): Response
    {
        $shop = $this->directory->shop($slug) ?? abort(404);

        return new Response($this->images->forShop($shop), 200, [
            'Content-Type' => 'image/png',
            'Cache-Control' => 'public, max-age=86400',
            'X-Robots-Tag' => 'noindex',
        ]);
    }
}
