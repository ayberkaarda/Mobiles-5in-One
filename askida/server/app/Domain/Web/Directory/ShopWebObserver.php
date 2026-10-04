<?php

namespace App\Domain\Web\Directory;

use App\Domain\Shops\Models\Shop;
use App\Domain\Shops\Models\ShopVerificationState;
use App\Support\Web\ResponseCache\PageCache;
use Illuminate\Support\Facades\DB;

/**
 * Keeps the public web in step with a shop. When a shop that is or was public changes,
 * the cached pages that show it (its page, its short link, its province and district
 * pages, the sitemap) are dropped; when it stops being public (unlisted, no longer
 * verified, deleted) its rendered share images are deleted as well. Nothing waits for a
 * cache lifetime, so an unlisted shop disappears from the public web at once. The work
 * runs after the surrounding transaction commits, so a concurrent request cannot cache
 * the pre-commit state again.
 */
final class ShopWebObserver
{
    public function __construct(
        private readonly PageCache $pages,
        private readonly OgImageRenderer $images,
    ) {}

    public function saved(Shop $shop): void
    {
        // `saved` runs before the model syncs its original attributes, so these are the
        // values before this save (none on an insert).
        $wasPublic = self::listed($shop->getOriginal('verification_state'), $shop->getOriginal('listed_on_web'));
        $isPublic = DirectoryQuery::isListed($shop);

        if (! $wasPublic && ! $isPublic) {
            return;
        }

        $paths = [
            ...self::paths((string) $shop->getOriginal('slug', $shop->slug), (string) $shop->getOriginal('il_slug', $shop->il_slug), (string) $shop->getOriginal('ilce_slug', $shop->ilce_slug)),
            ...self::paths($shop->slug, $shop->il_slug, $shop->ilce_slug),
        ];
        $slug = (string) $shop->getOriginal('slug', $shop->slug);
        // A renamed shop gets a new share image (its file name hashes the name); the old
        // one is removed rather than left behind.
        $dropImages = ! $isPublic || $shop->wasChanged('name');

        DB::afterCommit(function () use ($paths, $dropImages, $slug): void {
            $this->pages->forget(...array_values(array_unique($paths)));

            if ($dropImages) {
                $this->images->forget($slug);
            }
        });
    }

    public function deleted(Shop $shop): void
    {
        $paths = self::paths($shop->slug, $shop->il_slug, $shop->ilce_slug);
        $slug = $shop->slug;

        DB::afterCommit(function () use ($paths, $slug): void {
            $this->pages->forget(...$paths);
            $this->images->forget($slug);
        });
    }

    /**
     * Paths of every public page that shows the shop.
     *
     * @return list<string>
     */
    public static function paths(string $slug, string $ilSlug, string $ilceSlug): array
    {
        return [
            '/dukkan/'.$slug,
            '/d/'.$slug,
            '/dukkanlar/'.$ilSlug,
            '/dukkanlar/'.$ilSlug.'/'.$ilceSlug,
            '/sitemap.xml',
        ];
    }

    private static function listed(mixed $state, mixed $listed): bool
    {
        $state = $state instanceof ShopVerificationState ? $state : ShopVerificationState::tryFrom(is_string($state) ? $state : '');

        return $state === ShopVerificationState::Verified && (bool) $listed;
    }
}
