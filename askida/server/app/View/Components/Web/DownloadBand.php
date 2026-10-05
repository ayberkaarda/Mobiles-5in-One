<?php

namespace App\View\Components\Web;

use App\Support\Web\Facts;
use Illuminate\Contracts\View\View;
use Illuminate\View\Component;

/**
 * `<x-web.download-band/>`: the band before the footer with the store links from
 * config('web.store_urls') (an empty URL omits its link; with none configured a line says
 * the links come with the release). `deep-link` adds an app link such as
 * `askida://shop/{slug}`; `primary` makes that link the page's one primary button.
 */
final class DownloadBand extends Component
{
    public function __construct(
        public string $heading = 'Askıda cebinizde',
        public string $text = 'Askıya bırakmak için uygulamayı kullanın. Askıdan almak için hesap gerekmez.',
        public ?string $deepLink = null,
        public string $deepLinkLabel = 'Uygulamada aç',
        public bool $primary = false,
    ) {}

    /**
     * @return array<string, string> label => URL
     */
    public function stores(): array
    {
        $labels = ['android' => 'Google Play', 'ios' => 'App Store'];
        $stores = [];

        foreach (Facts::storeUrls() as $platform => $url) {
            $stores[$labels[$platform]] = $url;
        }

        return $stores;
    }

    public function render(): View
    {
        return view('components.web.download-band');
    }
}
