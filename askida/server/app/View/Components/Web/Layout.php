<?php

namespace App\View\Components\Web;

use App\Support\Web\PageMeta;
use Illuminate\Contracts\View\View;
use Illuminate\View\Component;

/**
 * `<x-web.layout :meta="$meta">…</x-web.layout>`: the public page shell (head, header
 * navigation, main, footer). `sample-notice` puts the "Örnek metin" banner at the top of
 * the page (legal, about and contact pages).
 */
final class Layout extends Component
{
    public function __construct(
        public PageMeta $meta,
        public bool $sampleNotice = false,
    ) {}

    public function render(): View
    {
        return view('web.layouts.site');
    }
}
