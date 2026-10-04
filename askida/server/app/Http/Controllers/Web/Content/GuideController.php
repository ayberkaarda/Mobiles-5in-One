<?php

namespace App\Http\Controllers\Web\Content;

use App\Domain\Web\Content\ContentPage;
use App\Domain\Web\Content\GuideRepository;
use App\Http\Controllers\Controller;
use App\Support\Web\JsonLd;
use App\Support\Web\Origin;
use App\Support\Web\PageMeta;
use Illuminate\Contracts\View\View;

/**
 * `/rehber/{slug}`: one of the five guides, an Article with honest dates from its front matter.
 */
final class GuideController extends Controller
{
    public function __construct(private readonly GuideRepository $guides) {}

    public function show(string $slug): View
    {
        $guide = $this->guides->find($slug);

        abort_if($guide === null, 404);

        $path = '/rehber/'.$guide->slug;

        $meta = PageMeta::make(
            path: $path,
            title: $guide->title,
            description: $guide->description,
            breadcrumbs: [[$guide->title, $path]],
            jsonLd: [$this->article($guide, $path)],
            ogType: 'article',
            publishedAt: $guide->published,
            modifiedAt: $guide->updated,
        );

        return view('web.content.guide', [
            'meta' => $meta,
            'guide' => $guide,
            'others' => array_values(array_filter(
                $this->guides->all(),
                static fn (ContentPage $other): bool => $other->slug !== $guide->slug,
            )),
        ]);
    }

    /**
     * @return array<string, mixed>
     */
    private function article(ContentPage $guide, string $path): array
    {
        return [
            '@type' => 'Article',
            'headline' => $guide->title,
            'description' => $guide->description,
            'datePublished' => $guide->published->toDateString(),
            'dateModified' => $guide->updated->toDateString(),
            'inLanguage' => 'tr-TR',
            'wordCount' => $guide->wordCount(),
            'mainEntityOfPage' => Origin::url($path),
            'author' => JsonLd::organizationRef(),
            'publisher' => JsonLd::organizationRef(),
        ];
    }
}
