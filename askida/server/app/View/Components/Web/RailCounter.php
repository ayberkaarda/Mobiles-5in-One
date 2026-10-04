<?php

namespace App\View\Components\Web;

use App\Support\Web\Format;
use Carbon\CarbonInterface;
use Illuminate\Contracts\View\View;
use Illuminate\View\Component;

/**
 * `<x-web.rail-counter :count="12" label="askıda" :as-of="$date" :sample="false"/>`: the
 * rail counter of design section 6.3 as inline SVG (geometry of
 * brand/devices/askida-rail-counter-*.svg): a 2 px rail with one accent tag per item up to
 * CAP, then one secondary "+" tag; the sentence under it ("Bugün 12 askıda") with the date.
 * Counts are of items, never of people; no target, bar or percentage.
 */
final class RailCounter extends Component
{
    public const CAP = 12;

    public const PITCH = 20;

    public const FIRST_X = 22;

    public function __construct(
        public int $count,
        public string $label = 'askıda',
        public string $prefix = 'Bugün',
        public ?CarbonInterface $asOf = null,
        public bool $sample = false,
        public ?string $note = null,
    ) {}

    public function shown(): int
    {
        return max(0, min($this->count, self::CAP));
    }

    public function overflows(): bool
    {
        return $this->count > self::CAP;
    }

    /**
     * Tie strokes of every hanging tag (accent ones and the "+" tag).
     */
    public function tiesPath(): string
    {
        $d = '';

        foreach ($this->slots() as $x) {
            $d .= 'M'.$x.' 6V11';
        }

        return $d;
    }

    public function tagsPath(): string
    {
        $d = '';

        for ($i = 0; $i < $this->shown(); $i++) {
            $d .= self::tag(self::FIRST_X + $i * self::PITCH);
        }

        return $d;
    }

    public function moreTagPath(): string
    {
        return self::tag(self::FIRST_X + self::CAP * self::PITCH);
    }

    public function plusPath(): string
    {
        $x = self::FIRST_X + self::CAP * self::PITCH;

        return 'M'.$x.' 19V23.5M'.($x - 2.25).' 21.25H'.($x + 2.25);
    }

    public function formattedCount(): string
    {
        return Format::count($this->count);
    }

    public function formattedDate(): ?string
    {
        return $this->asOf === null ? null : Format::date($this->asOf);
    }

    public function render(): View
    {
        return view('components.web.rail-counter');
    }

    /**
     * @return list<int>
     */
    private function slots(): array
    {
        $slots = [];
        $count = $this->shown() + ($this->overflows() ? 1 : 0);

        for ($i = 0; $i < $count; $i++) {
            $slots[] = self::FIRST_X + $i * self::PITCH;
        }

        return $slots;
    }

    /**
     * A 12 x 16 tag with radius 3 hanging at x, with the punched hole (evenodd).
     */
    private static function tag(int $x): string
    {
        return 'M'.($x - 3).' 11H'.($x + 3).'A3 3 0 0 1 '.($x + 6).' 14V24A3 3 0 0 1 '.($x + 3).' 27H'.($x - 3)
            .'A3 3 0 0 1 '.($x - 6).' 24V14A3 3 0 0 1 '.($x - 3).' 11Z'
            .'M'.($x - 1.6).' 15.2A1.6 1.6 0 1 0 '.($x + 1.6).' 15.2A1.6 1.6 0 1 0 '.($x - 1.6).' 15.2Z';
    }
}
