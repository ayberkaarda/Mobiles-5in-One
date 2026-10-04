<?php

/*
|--------------------------------------------------------------------------
| Admin panel (security checklist item 18)
|--------------------------------------------------------------------------
|
| The Filament panel at /admin. Every panel user (roles admin, moderator,
| finance) signs in with a password and then a TOTP code; the panel is
| unreachable until a TOTP secret is confirmed.
|
*/

return [

    /*
    | Optional IP allowlist: a comma list of IPv4/IPv6 addresses or CIDR ranges.
    | Empty turns the check off. It runs before the login page and uses the
    | trusted-proxy-aware client address (Request::ip()).
    */
    'ip_allowlist' => array_values(array_filter(array_map(
        'trim',
        explode(',', (string) env('ADMIN_IP_ALLOWLIST', '')),
    ), static fn (string $entry): bool => $entry !== '')),

    'two_factor' => [
        // Shown in the authenticator app next to the account e-mail.
        'issuer' => 'Askida',

        // RFC 6238 parameters. The window accepts one step before and after now.
        'period' => 30,
        'digits' => 6,
        'window' => 1,

        // Failed codes per minute for one user from one address (limiter `admin-totp`).
        'attempts_per_minute' => 5,

        // How long a password-accepted login waits for its TOTP code.
        'challenge_ttl_seconds' => 300,

        'recovery_codes' => 10,
    ],
];
