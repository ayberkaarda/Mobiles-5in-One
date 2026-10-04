<?php

namespace App\Domain\Web\Directory;

use App\Domain\Shops\Models\Shop;
use Illuminate\Contracts\Filesystem\Filesystem;
use Illuminate\Support\Facades\Storage;
use Intervention\Image\Drivers\Gd\Driver as GdDriver;
use Intervention\Image\Format;
use Intervention\Image\Geometry\Factories\CircleFactory;
use Intervention\Image\Geometry\Factories\RectangleFactory;
use Intervention\Image\ImageManager;
use Intervention\Image\Interfaces\ImageInterface;
use Intervention\Image\Typography\FontFactory;

/**
 * Open Graph images (1200 x 630 PNG) of the public web: the brand frame (the rail and one
 * accent tag) with a single line of text drawn by GD. A shop image carries the shop's name
 * (truncated) and the wordmark, nothing else: no address, no counts, no people. GD draws
 * the name as glyphs, so markup in a name is inert. Shop images are cached on the
 * configured public disk as `og/shops/<slug>-<sha1(name, updated_at)>.png`.
 */
final class OgImageRenderer
{
    public const WIDTH = 1200;

    public const HEIGHT = 630;

    public const NAME_MAX = 48;

    public const DIRECTORY = 'og/shops';

    private const BACKGROUND = '#F4F0E8';

    private const INK = '#2B2B2B';

    private const ACCENT = '#C8763A';

    private const MARGIN = 80;

    public function __construct(private readonly DirectoryQuery $directory) {}

    /**
     * PNG bytes of a public shop's image, rendered once per name and update time. Writing a
     * new image removes the shop's older variants (one file per shop on disk). The listing
     * is checked again after the write: a shop unlisted while its image was being drawn
     * (the unlisting cleanup may already have run) keeps no file behind.
     */
    public function forShop(Shop $shop): string
    {
        $path = $this->path($shop);
        $disk = $this->disk();

        if ($disk->exists($path)) {
            return (string) $disk->get($path);
        }

        $png = $this->render(self::truncate($shop->name), 76, wordmark: true);
        $disk->put($path, $png);
        $this->forget($shop->slug, except: $path);

        if ($this->directory->shop($shop->slug) === null) {
            $disk->delete($path);
        }

        return $png;
    }

    public function path(Shop $shop): string
    {
        $stamp = $shop->updated_at?->toAtomString() ?? '';

        return self::DIRECTORY.'/'.$shop->slug.'-'.sha1($shop->name."\n".$stamp).'.png';
    }

    /**
     * Deletes every cached image of the shop with this slug (exactly `<slug>-<sha1>.png`,
     * so a shop whose slug starts with another shop's slug is never touched), except the
     * given path.
     */
    public function forget(string $slug, ?string $except = null): void
    {
        $disk = $this->disk();
        $pattern = '#^'.preg_quote(self::DIRECTORY.'/'.$slug, '#').'-[0-9a-f]{40}\.png$#';

        foreach ($disk->files(self::DIRECTORY) as $file) {
            if ($file !== $except && preg_match($pattern, $file) === 1) {
                $disk->delete($file);
            }
        }
    }

    /**
     * The site-wide default image: the brand frame and the tagline only.
     */
    public function defaultImage(string $tagline): string
    {
        return $this->render($tagline, 84, wordmark: false);
    }

    public static function truncate(string $name): string
    {
        $name = trim((string) preg_replace('/\s+/u', ' ', $name));

        if (mb_strlen($name) <= self::NAME_MAX) {
            return $name;
        }

        return rtrim(mb_substr($name, 0, self::NAME_MAX - 1)).'…';
    }

    public static function fontPath(): string
    {
        return resource_path('fonts/BricolageGrotesque-Display-SemiBold.ttf');
    }

    private function render(string $text, int $size, bool $wordmark): string
    {
        $image = ImageManager::usingDriver(GdDriver::class)->createImage(self::WIDTH, self::HEIGHT);
        $image->fill(self::BACKGROUND);

        $this->frame($image);

        $image->text($text, self::MARGIN, 200, static function (FontFactory $font) use ($size): void {
            $font->filepath(self::fontPath());
            $font->size($size);
            $font->color(self::INK);
            $font->align('left', 'top');
            $font->lineHeight(1.25);
            $font->wrap(self::WIDTH - 2 * self::MARGIN - 160);
        });

        if ($wordmark) {
            $image->text('askıda', self::MARGIN, self::HEIGHT - self::MARGIN, static function (FontFactory $font): void {
                $font->filepath(self::fontPath());
                $font->size(44);
                $font->color(self::INK);
                $font->align('left', 'bottom');
            });
        }

        return $image->encodeUsingFormat(Format::PNG)->toString();
    }

    /**
     * The rail across the top and one accent tag hanging from it (brand mark geometry:
     * flat tag, radius a quarter of its width, punched hole).
     */
    private function frame(ImageInterface $image): void
    {
        $railY = 96;
        $image->drawRectangle(static fn (RectangleFactory $r) => $r->at(self::MARGIN, $railY - 2)->size(self::WIDTH - 2 * self::MARGIN, 4)->background(self::INK));

        $centre = self::WIDTH - self::MARGIN - 120;
        $tieLength = 28;
        $image->drawRectangle(static fn (RectangleFactory $r) => $r->at($centre - 2, $railY)->size(4, $tieLength)->background(self::INK));

        $width = 96;
        $height = 128;
        $radius = 24;
        $left = $centre - intdiv($width, 2);
        $top = $railY + $tieLength;

        $image->drawRectangle(static fn (RectangleFactory $r) => $r->at($left, $top + $radius)->size($width, $height - 2 * $radius)->background(self::ACCENT));
        $image->drawRectangle(static fn (RectangleFactory $r) => $r->at($left + $radius, $top)->size($width - 2 * $radius, $height)->background(self::ACCENT));

        foreach ([[$left + $radius, $top + $radius], [$left + $width - $radius, $top + $radius], [$left + $radius, $top + $height - $radius], [$left + $width - $radius, $top + $height - $radius]] as [$x, $y]) {
            $image->drawCircle(static fn (CircleFactory $c) => $c->at($x, $y)->radius($radius)->background(self::ACCENT));
        }

        $image->drawCircle(static fn (CircleFactory $c) => $c->at($centre, $top + 28)->radius(10)->background(self::BACKGROUND));
    }

    private function disk(): Filesystem
    {
        $disk = config('web.og_cache_disk', 'public');

        return Storage::disk(is_string($disk) ? $disk : 'public');
    }
}
