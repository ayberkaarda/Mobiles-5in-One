<?php

namespace App\Http\Controllers\Web\Impact;

use App\Domain\Web\Impact\ImpactRollup;
use App\Domain\Web\Impact\ImpactWebReader;
use App\Http\Controllers\Controller;
use App\Support\Web\JsonLd;
use App\Support\Web\Origin;
use App\Support\Web\PageMeta;
use Illuminate\View\View;

/**
 * GET /etki: the last 30 days per province (counts of item units and shops) and the open
 * data download.
 */
class ImpactController extends Controller
{
    public const LICENCE_SENTENCE = 'Önerilen lisans: CC BY 4.0; hukuki onay bekliyor, henüz lisans verilmemiştir.';

    public function __invoke(ImpactWebReader $reader): View
    {
        $overview = $reader->overview();
        ['from' => $csvFrom, 'to' => $csvTo] = $reader->window(ImpactWebReader::CSV_DAYS);

        $description = 'Askıda etki sayıları: son 90 günde askıya bırakılan ve askıdan alınan ürün birimleri ile doğrulanmış dükkân sayısı, günlük ve il bazında. '
            .self::LICENCE_SENTENCE;

        $meta = PageMeta::make(
            path: '/etki',
            title: 'Askıda etki: ürün ve dükkân sayıları',
            description: 'Son 30 günde askıya bırakılan ve askıdan alınan ürün birimleri ile doğrulanmış dükkân sayısı, il il. Açık veri olarak indirilebilir.',
            breadcrumbs: [['Etki', '/etki']],
            jsonLd: [[
                '@context' => JsonLd::CONTEXT,
                '@type' => 'Dataset',
                'name' => 'Askıda etki sayıları',
                'description' => $description,
                'url' => Origin::url('/etki'),
                'inLanguage' => 'tr-TR',
                'isAccessibleForFree' => true,
                'creator' => JsonLd::organizationRef(),
                'temporalCoverage' => $csvFrom->toDateString().'/'.$csvTo->toDateString(),
                'spatialCoverage' => 'Türkiye',
                'distribution' => [[
                    '@type' => 'DataDownload',
                    'encodingFormat' => 'text/csv',
                    'contentUrl' => Origin::url('/etki.csv'),
                ]],
            ]],
        );

        return view('web.impact.index', [
            'meta' => $meta,
            'overview' => $overview,
            'csvDays' => ImpactWebReader::CSV_DAYS,
            'windowDays' => ImpactWebReader::WINDOW_DAYS,
            'licence' => self::LICENCE_SENTENCE,
            'minShops' => ImpactRollup::MIN_SHOPS,
        ]);
    }
}
