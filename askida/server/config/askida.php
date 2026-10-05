<?php

/*
|--------------------------------------------------------------------------
| Askida domain settings
|--------------------------------------------------------------------------
|
| Every environment value the domain code needs is read here, so that the
| rest of the application only calls config('askida.*').
|
*/

return [

    'hook_code_pepper' => env('HOOK_CODE_PEPPER'),

    // Sample (`is_sample`) shops appear in listings only outside production and only when on.
    'allow_sample_shops' => (bool) env('ALLOW_SAMPLE_SHOPS', false),

    /*
    | Hook reservation engine. A reserved unit is held for `reservation_minutes`;
    | caps count reservations per Europe/Istanbul calendar day. Counters and
    | unredeemed reservation links older than `retention_days` are purged.
    */
    'hooks' => [
        'reservation_minutes' => (int) env('HOOK_RESERVATION_MINUTES', 10),
        'anon_daily_cap' => 2,
        'anon_shop_daily_cap' => 1,
        'code_attempts' => 5,
        'retention_days' => 30,
        'release_batch_size' => 500,
    ],

    /*
    | Named rate limiters of the anonymous and hook endpoints (security item 5).
    */
    'limits' => [
        'anon_attest_per_day' => 3,
        'hooks_reserve_per_hour_anon' => 5,
        'hooks_reserve_per_hour_ip' => 60,
        'redeem_per_minute_shop' => 30,
    ],

    'payment' => [
        'provider' => env('PAYMENT_PROVIDER', 'fake'),

        'iyzico' => [
            'base_url' => env('IYZICO_BASE_URL', 'https://sandbox-api.iyzipay.com'),
            'api_key' => env('IYZICO_API_KEY'),
            'secret_key' => env('IYZICO_SECRET_KEY'),
        ],
    ],

    /*
    | Device attestation. Driver `fake` (local and tests only; refused in every
    | other environment) or `real` (Play Integrity on Android, DeviceCheck on
    | iOS). Provider endpoints must be HTTPS. A successful verdict is kept for
    | `verdict_cache_days`, the lifetime of the anon token.
    */
    'attestation' => [
        'driver' => env('ATTESTATION_DRIVER', 'fake'),
        'verdict_cache_days' => 30,
        'token_days' => 30,
        'http_timeout_seconds' => 5,
        'max_token_age_seconds' => 600,

        'play_integrity' => [
            'project' => env('PLAY_INTEGRITY_PROJECT'),
            'package_name' => env('PLAY_INTEGRITY_PACKAGE_NAME'),
            // The service account key file content (JSON), never a committed file.
            'service_account_json' => env('PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON'),
            'decode_url' => 'https://playintegrity.googleapis.com/v1/{package}:decodeIntegrityToken',
            'oauth_token_url' => 'https://oauth2.googleapis.com/token',
            'scope' => 'https://www.googleapis.com/auth/playintegrity',
        ],

        'device_check' => [
            'team_id' => env('APPLE_TEAM_ID'),
            'key_id' => env('APPLE_DEVICECHECK_KEY_ID'),
            // The .p8 key content (PEM), never a committed file.
            'private_key' => env('APPLE_DEVICECHECK_P8'),
            // `production` or `development`; `sandbox` is accepted as Apple's name for the latter.
            'environment' => env('APPLE_DEVICECHECK_ENVIRONMENT', 'production') === 'sandbox'
                ? 'development'
                : env('APPLE_DEVICECHECK_ENVIRONMENT', 'production'),
            'urls' => [
                'production' => 'https://api.devicecheck.apple.com/v1/validate_device_token',
                'development' => 'https://api.development.devicecheck.apple.com/v1/validate_device_token',
            ],
        ],
    ],

    /*
    | Push delivery. Driver `log` writes the message shape to the masked log
    | (local and tests only; refused in every other environment). Jobs run on
    | the `push` queue; at most `hourly_fanout_cap` deliveries per hour, sends
    | above the cap are dropped with a warning.
    */
    'push' => [
        'driver' => env('PUSH_DRIVER', 'log'),
        'queue' => 'push',
        'hourly_fanout_cap' => (int) env('PUSH_HOURLY_FANOUT_CAP', 2000),
    ],

    /*
    | Object storage as seen by devices. When set, presigned upload URLs are signed
    | for this endpoint (scheme, host and port) instead of the server's own
    | AWS_ENDPOINT, so a device that reaches the store under another address gets a
    | URL the store accepts. The server keeps using AWS_ENDPOINT for its own calls.
    */
    'storage' => [
        'public_endpoint' => env('AWS_PUBLIC_ENDPOINT') ?: null,
    ],

    /*
    | Cost guards (security item 22). Daily send caps per channel, counted in Redis
    | on the `timezone` day: once reached, non-critical sends (the "Yeni askı" and
    | "Askın alındı" pushes) pause until the next day and finance gets one alert mail.
    | Critical sends (verification, password reset, receipt, deletion confirmation,
    | finance alerts) are never paused.
    */
    'cost' => [
        'daily_email_cap' => (int) env('COST_DAILY_EMAIL_CAP', 2000),
        'daily_push_cap' => (int) env('COST_DAILY_PUSH_CAP', 20000),
        'timezone' => 'Europe/Istanbul',
    ],

    'sentry_dsn' => env('SENTRY_LARAVEL_DSN'),

];
