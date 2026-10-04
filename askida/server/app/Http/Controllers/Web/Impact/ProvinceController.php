<?php

namespace App\Http\Controllers\Web\Impact;

use App\Domain\Web\Impact\ImpactRollup;
use App\Domain\Web\Impact\ImpactWebReader;
use App\Http\Controllers\Controller;
use App\Support\Web\PageMeta;
use Illuminate\View\View;

/**
 * GET /etki/{il}: one province, district rows of the last 30 days. Unknown slug: 404. A
 * province below the small-cell threshold answers 200 without figures and is not indexed.
 */
class ProvinceController extends Controller
{
    public function __invoke(string $il, ImpactWebReader $reader): View
    {
        $province = $reader->province($il);

        abort_if($province === null, 404);

        $meta = PageMeta::make(
            path: '/etki/'.$province->slug,
            title: $province->name.' etki sayıları',
            description: $province->name.' için son 30 günde askıya bırakılan ve askıdan alınan ürün birimleri ile doğrulanmış dükkân sayısı, ilçe ilçe.',
            breadcrumbs: [['Etki', '/etki'], [$province->name, '/etki/'.$province->slug]],
            robots: $province->listed ? 'index,follow' : 'noindex,follow',
        );

        return view('web.impact.province', [
            'meta' => $meta,
            'province' => $province,
            'windowDays' => ImpactWebReader::WINDOW_DAYS,
            'minShops' => ImpactRollup::MIN_SHOPS,
        ]);
    }
}
