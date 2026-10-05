<?php

/*
|--------------------------------------------------------------------------
| Public web (Blade SSR)
|--------------------------------------------------------------------------
|
| Settings of the public pages, the directory, the impact pages and the app
| linking files. Absolute URLs (canonical, hreflang, Open Graph, JSON-LD,
| sitemap) are always built from `origin`, never from the request host.
|
*/

$list = static fn (mixed $value): array => array_values(array_filter(
    array_map('trim', explode(',', is_string($value) ? $value : '')),
    static fn (string $item): bool => $item !== '',
));

return [

    'origin' => rtrim((string) env('WEB_ORIGIN', 'https://askida.app'), '/'),

    // Documented sample mailbox: the domain is not owned, so it is rendered as plain text only.
    'contact_email' => (string) env('WEB_CONTACT_EMAIL', 'iletisim@askida.app'),

    // Store pages; an empty value omits the link (and the store URL in JSON-LD).
    'store_urls' => [
        'android' => (string) env('WEB_STORE_URL_ANDROID', ''),
        'ios' => (string) env('WEB_STORE_URL_IOS', ''),
    ],

    // Numeric App Store id for the Smart App Banner; empty omits the meta tag.
    'ios_app_id' => (string) env('WEB_IOS_APP_ID', ''),

    // Comma list of SHA-256 signing certificate fingerprints for assetlinks.json.
    'android_cert_sha256' => $list(env('WEB_ANDROID_CERT_SHA256')),

    // Disk holding the rendered per-shop Open Graph images.
    'og_cache_disk' => 'public',

    // Lifetime of a cached public page, in seconds.
    'response_cache_seconds' => 300,

];
