<?php

namespace App\View\Components\Web;

use App\Support\Web\Format;
use App\Support\Web\Pictograms;
use Illuminate\Contracts\View\View;
use Illuminate\View\Component;

/**
 * `<x-web.shop-card name="…" href="/dukkan/slug" district="Şişli, İstanbul" :available="3"
 * pictogram="ekmek" type-label="Fırın" :verified="true" :sample="false"/>`: one row of the
 * rail list (design section 6.2). The pictogram tag is accent when units hang on the rail,
 * secondary when none; a shop with 0 shows "—". All text is escaped. `heading` sets the
 * element of the name (h2 or h3; default h3); `href` null renders the name without a link.
 */
final class ShopCard extends Component
{
    public function __construct(
        public string $name,
        public string $district,
        public int $available,
        public ?string $href = null,
        public string $pictogram = 'diger',
        public ?string $typeLabel = null,
        public bool $verified = true,
        public bool $sample = false,
        public string $heading = 'h3',
    ) {}

    public function icon(): string
    {
        return Pictograms::path($this->pictogram);
    }

    public function check(): string
    {
        return Pictograms::path('check');
    }

    public function headingTag(): string
    {
        return in_array($this->heading, ['h2', 'h3', 'h4'], true) ? $this->heading : 'h3';
    }

    public function countLabel(): string
    {
        return $this->available > 0 ? Format::count($this->available) : '—';
    }

    public function render(): View
    {
        return view('components.web.shop-card');
    }
}
