<?php

/*
|--------------------------------------------------------------------------
| Public page response cache
|--------------------------------------------------------------------------
|
| Route middleware `cacheResponse:<seconds>` (App\Support\Web\ResponseCache)
| keeps the body of successful anonymous GET responses of the public web.
| Only the body and its content headers are stored: the security headers,
| including a fresh CSP nonce, and the session cookie are added on every
| request, so public pages must not depend on the nonce (they ship no
| inline script or style). Off by default under tests so that one test's
| page never answers another's; tests that exercise the cache turn it on.
|
*/

return [

    'enabled' => (bool) env('RESPONSE_CACHE_ENABLED', env('APP_ENV') !== 'testing'),

    // Cache store holding the pages (the shared Redis store).
    'store' => env('RESPONSE_CACHE_STORE', 'redis'),

    // Prefix of every key; bump to drop all cached pages at once after a deploy.
    'prefix' => 'web-page:v1:',

    // Lifetime used when the middleware is given no parameter, in seconds.
    'default_seconds' => 300,

    // Response header naming the outcome (`hit` or `miss`).
    'header' => 'X-Page-Cache',

];
