<?php

namespace App\Domain\Web\Directory\Console;

use App\Domain\Web\Directory\OgImageRenderer;
use App\Support\Web\Facts;
use Illuminate\Console\Command;

/**
 * Writes the site-wide Open Graph image `public/og/default.png` (1200 x 630: the brand
 * frame and the tagline, no other text). Run once after a brand change and commit the
 * file; pages without their own image point at it.
 */
final class OgDefaultCommand extends Command
{
    protected $signature = 'web:og-default';

    protected $description = 'Render the default Open Graph image to public/og/default.png';

    public function handle(OgImageRenderer $images): int
    {
        $path = public_path('og/default.png');

        if (! is_dir(dirname($path)) && ! mkdir(dirname($path), 0755, true) && ! is_dir(dirname($path))) {
            $this->error('Cannot create '.dirname($path));

            return self::FAILURE;
        }

        $bytes = file_put_contents($path, $images->defaultImage(Facts::TAGLINE));

        if ($bytes === false) {
            $this->error('Cannot write '.$path);

            return self::FAILURE;
        }

        $this->info('Wrote public/og/default.png ('.$bytes.' bytes).');

        return self::SUCCESS;
    }
}
