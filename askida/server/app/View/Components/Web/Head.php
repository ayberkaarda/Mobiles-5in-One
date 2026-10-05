<?php

namespace App\View\Components\Web;

use App\Support\Web\Assets;
use App\Support\Web\PageMeta;
use Illuminate\Contracts\View\View;
use Illuminate\View\Component;

/**
 * `<x-web.head :meta="$meta"/>`: everything inside `<head>`: title, description, robots,
 * canonical, hreflang alternates, the preloaded text font, the one stylesheet, Open Graph,
 * theme colours, the Smart App Banner (only with config('web.ios_app_id')) and the JSON-LD
 * data blocks (Organization first). No executable script and no inline style.
 */
final class Head extends Component
{
    public function __construct(public PageMeta $meta) {}

    public function stylesheet(): string
    {
        return Assets::url(Assets::STYLESHEET);
    }

    public function textFont(): string
    {
        return Assets::url(Assets::TEXT_FONT);
    }

    public function iosAppId(): ?string
    {
        $id = config('web.ios_app_id');

        return is_string($id) && preg_match('/^\d+$/', $id) === 1 ? $id : null;
    }

    public function render(): View
    {
        return view('components.web.head');
    }
}
