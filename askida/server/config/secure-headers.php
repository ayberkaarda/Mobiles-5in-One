<?php

/*
|--------------------------------------------------------------------------
| Security headers (security checklist item 9)
|--------------------------------------------------------------------------
|
| Read by App\Http\Middleware\SecurityHeaders, which feeds the bepsvpt/secure-headers
| builders. The top-level keys follow the package format. The `csp` block is the strict
| policy of the public web; `csp_profiles` lists the only relaxations, each scoped to one
| route class and replacing whole directives of the strict policy.
|
*/

$list = static fn (mixed $value): array => array_values(array_filter(
    array_map('trim', explode(',', is_string($value) ? $value : '')),
    static fn (string $item): bool => $item !== '',
));

$payFrameHosts = $list(env('SECURITY_CSP_FRAME_SRC_PAY'));

return [

    'server' => '',
    'x-content-type-options' => 'nosniff',
    'x-dns-prefetch-control' => 'off',
    'x-download-options' => 'noopen',
    'x-frame-options' => 'deny',
    'x-permitted-cross-domain-policies' => 'none',
    'x-powered-by' => '',
    'x-xss-protection' => '',
    'referrer-policy' => 'strict-origin-when-cross-origin',
    'cross-origin-embedder-policy' => '',
    'cross-origin-opener-policy' => 'same-origin',
    'cross-origin-resource-policy' => 'same-site',

    'clear-site-data' => ['enable' => false],
    'reporting' => [],
    'nel' => ['enable' => false],
    'expect-ct' => ['enable' => false],

    /*
     * HSTS: two years, subdomains, preload. Sent only on HTTPS requests (as seen after the
     * trusted proxy rules) unless forced, for example behind a TLS terminator that is not
     * configured as a trusted proxy.
     */
    'hsts' => [
        'enable' => true,
        'max-age' => 63072000,
        'include-sub-domains' => true,
        'preload' => true,
    ],

    'hsts_force' => (bool) env('SECURITY_HSTS_FORCE', false),

    'permissions-policy' => [
        'enable' => true,
        'geolocation' => ['none' => false, '*' => false, 'self' => true, 'origins' => []],
        'camera' => ['none' => true],
        'microphone' => ['none' => true],
    ],

    /*
     * Strict policy for the public web (Blade). Inline scripts and styles need the
     * per-request nonce (`@nonce` in Blade, Vite::cspNonce() in PHP).
     */
    'csp' => [
        'enable' => true,
        'report-only' => false,
        'default-src' => ['self' => true],
        'script-src' => ['self' => true, 'use-nonce' => true],
        'style-src' => ['self' => true, 'use-nonce' => true],
        'img-src' => ['self' => true, 'schemes' => ['data:']],
        'font-src' => ['self' => true],
        'connect-src' => ['self' => true],
        'object-src' => ['none' => true],
        'base-uri' => ['self' => true],
        'form-action' => ['self' => true],
        'frame-ancestors' => ['none' => true],
    ],

    'csp_profiles' => [

        /*
         * Filament admin panel (/admin). Each relaxation is required by the panel as
         * shipped (filament/filament 3.3):
         * - script-src 'unsafe-inline': the layout prints inline theme and Livewire config
         *   scripts without a nonce attribute.
         * - script-src 'unsafe-eval': Alpine.js (bundled with Livewire) evaluates x-data and
         *   event expressions with the Function constructor.
         * - style-src 'unsafe-inline': inline <style> blocks and style="" attributes.
         * - font-src and img-src data: only: the panel uses the system font stack and an
         *   inline initials avatar, so no third-party host is allowed on this surface.
         * No nonce is added here: a nonce would make browsers ignore 'unsafe-inline'.
         */
        'admin' => [
            'script-src' => ['self' => true, 'unsafe-inline' => true, 'unsafe-eval' => true],
            'style-src' => ['self' => true, 'unsafe-inline' => true],
            'font-src' => ['self' => true, 'schemes' => ['data:']],
            'img-src' => ['self' => true, 'schemes' => ['data:']],
        ],

        /*
         * Payment pages (/pay/*): only frame-src opens, to the provider hosts listed in
         * SECURITY_CSP_FRAME_SRC_PAY. With an empty list no frame may load.
         */
        'pay' => [
            'frame-src' => $payFrameHosts === [] ? ['none' => true] : ['allow' => $payFrameHosts],
        ],

        /*
         * JSON API: nothing may load, submit to or frame a response.
         */
        'api' => [
            'default-src' => ['none' => true],
            'script-src' => ['none' => true],
            'style-src' => ['none' => true],
            'img-src' => ['none' => true],
            'font-src' => ['none' => true],
            'connect-src' => ['none' => true],
            'form-action' => ['none' => true],
            'base-uri' => ['none' => true],
        ],
    ],

];
