<?php

namespace App\View\Components\Web;

use App\Support\Web\PurifiedHtml;
use Illuminate\Contracts\View\View;
use Illuminate\View\Component;

/**
 * `<x-web.prose :html="$purified"/>`: the reading column of guides and legal pages. The only
 * unescaped HTML output of the public web; it accepts only PurifiedHtml, the output of the
 * guide pipeline (Markdown without raw HTML, then the HTMLPurifier allowlist).
 */
final class Prose extends Component
{
    public function __construct(public PurifiedHtml $html) {}

    public function render(): View
    {
        return view('components.web.prose');
    }
}
