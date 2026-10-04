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
    | IP allowlist: a comma list of IPv4/IPv6 addresses or CIDR ranges. It runs
    | before the login page and uses the trusted-proxy-aware client address
    | (Request::ip()). Fails closed: outside local and testing an empty or
    | malformed list denies every address; `*` alone allows any address on
    | purpose. In local and testing an empty list means no restriction.
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

        // Failed codes for one user from any address (limiter `admin-totp-account`),
        // then the account's TOTP step is locked for the rest of the window.
        'account_attempts' => 10,
        'account_lockout_seconds' => 900,

        // How long a password-accepted login waits for its TOTP code.
        'challenge_ttl_seconds' => 300,

        'recovery_codes' => 10,
    ],
];
