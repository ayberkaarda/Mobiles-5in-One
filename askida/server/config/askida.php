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

    'payment' => [
        'provider' => env('PAYMENT_PROVIDER', 'fake'),

        'iyzico' => [
            'base_url' => env('IYZICO_BASE_URL', 'https://sandbox-api.iyzipay.com'),
            'api_key' => env('IYZICO_API_KEY'),
            'secret_key' => env('IYZICO_SECRET_KEY'),
        ],
    ],

    'attestation' => [
        'play_integrity' => [
            'project' => env('PLAY_INTEGRITY_PROJECT'),
            'service_account_json' => env('PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON'),
        ],

        'device_check' => [
            'team_id' => env('APPLE_TEAM_ID'),
            'key_id' => env('APPLE_DEVICECHECK_KEY_ID'),
            'private_key' => env('APPLE_DEVICECHECK_P8'),
        ],
    ],

    'sentry_dsn' => env('SENTRY_LARAVEL_DSN'),

];
