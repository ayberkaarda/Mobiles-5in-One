<?php

namespace App\Http\Controllers\Web\Directory;

use App\Domain\Web\Directory\DirectoryCopy;
use App\Domain\Web\Directory\DirectoryQuery;
use App\Domain\Web\Directory\ShopKind;
use App\Http\Controllers\Controller;
use App\Support\Web\PageMeta;
use App\Support\Web\Pictograms;
use Illuminate\Http\Request;
use Illuminate\View\View;

/**
 * `/dukkanlar/{il}`: the districts of a province that have listed shops, with shop
 * counts; `/dukkanlar/{il}/{ilce}`: the listed shops of one district as shop cards with
 * their AVAILABLE units (`?sayfa=N` beyond the first page). Unknown or empty slugs 404.
 */
final class DistrictController extends Controller
{
    public function __construct(private readonly DirectoryQuery $directory) {}

    public function province(string $il): View
    {
        $province = $this->directory->province($il) ?? abort(404);
        $shops = array_sum(array_column($province['districts'], 'shops'));
        $available = array_sum(array_column($province['districts'], 'available'));

        $meta = PageMeta::make(
            path: '/dukkanlar/'.$il,
            title: DirectoryCopy::provinceTitle($province['il']),
            description: DirectoryCopy::provinceDescription($province['il']),
            breadcrumbs: [[$province['il'], '/dukkanlar/'.$il]],
        );

        return view('web.directory.province', [
            'meta' => $meta,
            'il' => $province['il'],
            'ilSlug' => $il,
            'districts' => $province['districts'],
            'available' => $available,
            'answer' => DirectoryCopy::provinceAnswer($province['il'], $shops, count($province['districts'])),
        ]);
    }

    public function district(Request $request, string $il, string $ilce): View
    {
        $page = $this->page($request);
        $district = $this->directory->district($il, $ilce, $page) ?? abort(404);
        $shops = $district['shops'];

        if ($page > $shops->lastPage()) {
            abort(404);
        }

        $path = '/dukkanlar/'.$il.'/'.$ilce;

        $meta = PageMeta::make(
            path: $page > 1 ? $path.'?sayfa='.$page : $path,
            title: DirectoryCopy::districtTitle($district['ilce'], $district['il']),
            description: DirectoryCopy::districtDescription($district['ilce'], $district['il']),
            breadcrumbs: [
                [$district['il'], '/dukkanlar/'.$il],
                [$district['ilce'], $path],
            ],
        );

        $cards = [];

        foreach ($shops->items() as $shop) {
            $cards[] = [
                'name' => $shop->name,
                'href' => '/dukkan/'.$shop->slug,
                'available' => (int) $shop->getAttribute('available_count'),
                'typeLabel' => ShopKind::label($shop->type),
                'pictogram' => Pictograms::forShopType(ShopKind::of($shop->type)),
                'sample' => $shop->is_sample,
            ];
        }

        return view('web.directory.district', [
            'meta' => $meta,
            'il' => $district['il'],
            'ilce' => $district['ilce'],
            'ilSlug' => $il,
            'path' => $path,
            'available' => $district['available'],
            'cards' => $cards,
            'page' => $page,
            'lastPage' => $shops->lastPage(),
            'answer' => DirectoryCopy::districtAnswer($district['ilce'], $district['il'], $shops->total()),
        ]);
    }

    private function page(Request $request): int
    {
        $raw = $request->query('sayfa');

        if ($raw === null) {
            return 1;
        }

        if (! is_string($raw) || preg_match('/^[1-9]\d{0,3}$/', $raw) !== 1) {
            abort(404);
        }

        return (int) $raw;
    }
}
