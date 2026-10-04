<?php

/*
|--------------------------------------------------------------------------
| Cross-origin resource sharing (security checklist item 8)
|--------------------------------------------------------------------------
|
| Only the JSON API is shared, and only with the origins in
| SECURITY_CORS_ALLOWED_ORIGINS (default: the public web impact widget at
| https://askida.app). A "*" entry is dropped: there is never a wildcard. The mobile
| app does not need CORS; browsers do. No cookies or credentials cross origins.
|
| The same origins are also given as exact, anchored patterns. With a single plain
| origin the CORS library would send that origin to every caller; with patterns present
| it answers only a matching Origin and sends nothing to the others.
|
*/

$origins = array_values(array_filter(
    array_map('trim', explode(',', (string) env('SECURITY_CORS_ALLOWED_ORIGINS', 'https://askida.app'))),
    static fn (string $origin): bool => $origin !== '' && ! str_contains($origin, '*'),
));

return [

    'paths' => ['api/*'],

    'allowed_methods' => ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],

    'allowed_origins' => $origins,

    'allowed_origins_patterns' => array_map(
        static fn (string $origin): string => '#\A'.preg_quote($origin, '#').'\z#',
        $origins,
    ),

    'allowed_headers' => ['Accept', 'Accept-Language', 'Authorization', 'Content-Type', 'X-Request-Id'],

    'exposed_headers' => ['X-Request-Id', 'Retry-After'],

    'max_age' => 600,

    'supports_credentials' => false,

];
