<?php

/*
|--------------------------------------------------------------------------
| Trusted proxies (security checklist items 5 and 10)
|--------------------------------------------------------------------------
|
| Read by Illuminate\Http\Middleware\TrustProxies on every request. Forwarded headers
| (X-Forwarded-For, -Proto, -Host, -Port, -Prefix) are honoured only when the direct peer
| is listed in TRUSTED_PROXIES (comma-separated IPs or CIDR ranges).
|
| - Empty (the default): no proxy is trusted. The value is an empty list rather than
|   null on purpose: with null the framework trusts any caller whose Host header ends in
|   a managed-hosting suffix, which a client can spoof.
| - "*": trust the direct peer, whatever it is. Only for a deployment where the app is
|   reachable exclusively through its own reverse proxy (for example a private network
|   behind Caddy); never on a host that accepts direct connections.
|
*/

$value = trim((string) env('TRUSTED_PROXIES', ''));

return [

    'proxies' => match (true) {
        $value === '' => [],
        $value === '*' => '*',
        default => array_values(array_filter(
            array_map('trim', explode(',', $value)),
            static fn (string $proxy): bool => $proxy !== '' && $proxy !== '*' && $proxy !== '**',
        )),
    },

];
