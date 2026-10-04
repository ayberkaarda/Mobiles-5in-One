<?php

namespace App\Http\Controllers\Web\Content;

use App\Domain\Web\Content\LegalRepository;
use App\Http\Controllers\Controller;
use App\Support\Web\Facts;
use App\Support\Web\Format;
use App\Support\Web\PageMeta;
use Illuminate\Contracts\View\View;

/**
 * `/gizlilik` and `/kvkk-aydinlatma`: the legal texts, shown as labelled samples.
 */
final class LegalController extends Controller
{
    public function __construct(private readonly LegalRepository $legal) {}

    public function show(string $slug): View
    {
        $page = $this->legal->find($slug);

        abort_if($page === null, 404);

        $path = '/'.$page->slug;

        $meta = PageMeta::make(
            path: $path,
            title: $page->title,
            description: $page->description,
            breadcrumbs: [[$page->title, $path]],
            publishedAt: $page->published,
            modifiedAt: $page->updated,
        );

        $footnote = 'Son güncelleme: '.Format::date($page->updated);

        if ($page->slug === 'kvkk-aydinlatma') {
            $footnote = 'Metin sürümü: '.Facts::KVKK_TEXT_VERSION.' · '.$footnote;
        }

        return view('web.content.legal', ['meta' => $meta, 'page' => $page, 'footnote' => $footnote]);
    }
}
