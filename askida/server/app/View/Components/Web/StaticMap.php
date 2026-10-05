<?php

namespace App\View\Components\Web;

use Illuminate\Contracts\View\View;
use Illuminate\View\Component;

/**
 * `<x-web.static-map :lat="41.0" :lng="29.0" label="Kadıköy, İstanbul"/>`: a plain frame
 * with a light grid and one accent tag hanging at the centre, and the place and its
 * coordinates as text. Inline SVG only: no tile server, no external request.
 */
final class StaticMap extends Component
{
    public const WIDTH = 640;

    public const HEIGHT = 240;

    public const GRID = 40;

    public function __construct(
        public string $label,
        public ?float $lat = null,
        public ?float $lng = null,
    ) {}

    public function gridPath(): string
    {
        $d = '';

        for ($x = self::GRID; $x < self::WIDTH; $x += self::GRID) {
            $d .= 'M'.$x.' 0V'.self::HEIGHT;
        }

        for ($y = self::GRID; $y < self::HEIGHT; $y += self::GRID) {
            $d .= 'M0 '.$y.'H'.self::WIDTH;
        }

        return $d;
    }

    /**
     * "41,0082° K, 28,9784° D" (Turkish hemisphere letters), or null without a point.
     */
    public function coordinates(): ?string
    {
        if ($this->lat === null || $this->lng === null) {
            return null;
        }

        $lat = number_format(abs($this->lat), 4, ',', '').'° '.($this->lat >= 0 ? 'K' : 'G');
        $lng = number_format(abs($this->lng), 4, ',', '').'° '.($this->lng >= 0 ? 'D' : 'B');

        return $lat.', '.$lng;
    }

    public function render(): View
    {
        return view('components.web.static-map');
    }
}
