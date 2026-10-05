<?php

namespace App\Http\Controllers\Web\Directory;

use App\Domain\Web\Directory\DirectoryCopy;
use App\Domain\Web\Directory\DirectoryQuery;
use App\Domain\Web\Directory\OpeningHours;
use App\Domain\Web\Directory\ShopJsonLd;
use App\Domain\Web\Directory\ShopKind;
use App\Http\Controllers\Controller;
use App\Support\Web\Origin;
use App\Support\Web\PageMeta;
use App\Support\Web\Pictograms;
use Illuminate\Http\RedirectResponse;
use Illuminate\View\View;

/**
 * `/dukkan/{slug}`: the public page of one listed shop, and `/d/{slug}`, its short link.
 * A shop that is not verified and listed (or a sample shop where samples are off) does
 * not exist here: 404, never 403.
 */
final class ShopPageController extends Controller
{
    public function __construct(private readonly DirectoryQuery $directory) {}

    public function show(string $slug): View
    {
        $shop = $this->directory->shop($slug) ?? abort(404);
        $items = $this->directory->items($shop);
        $available = 0;

        foreach ($items as $item) {
            $available += (int) $item->getAttribute('available_count');
        }

        $meta = PageMeta::make(
            path: '/dukkan/'.$shop->slug,
            title: DirectoryCopy::shopTitle($shop->name, $shop->ilce),
            description: DirectoryCopy::shopDescription($shop->name, $shop->ilce, $shop->il),
            breadcrumbs: [
                [$shop->il, '/dukkanlar/'.$shop->il_slug],
                [$shop->ilce, '/dukkanlar/'.$shop->il_slug.'/'.$shop->ilce_slug],
                [$shop->name, '/dukkan/'.$shop->slug],
            ],
            jsonLd: [ShopJsonLd::for($shop)],
            ogImage: Origin::url('/og/dukkan/'.$shop->slug.'.png'),
            ogType: 'business.business',
        );

        return view('web.directory.shop', [
            'meta' => $meta,
            'shop' => $shop,
            'items' => $items,
            'available' => $available,
            'typeLabel' => ShopKind::label($shop->type),
            'pictogram' => Pictograms::forShopType(ShopKind::of($shop->type)),
            'hours' => OpeningHours::rows($shop->opening_hours),
            'phone' => ShopJsonLd::telephone($shop->phone),
            'answer' => DirectoryCopy::shopAnswer($shop->name, $shop->ilce, $shop->il),
        ]);
    }

    public function shortLink(string $slug): RedirectResponse
    {
        $shop = $this->directory->shop($slug) ?? abort(404);

        return redirect('/dukkan/'.$shop->slug, 301);
    }
}
