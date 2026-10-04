<?php

/*
|--------------------------------------------------------------------------
| Third party services
|--------------------------------------------------------------------------
|
| Credentials and endpoints of external services. Client ids accept a
| comma-separated list (for example the iOS, Android and web Google clients).
|
*/

$list = static fn (mixed $value): array => array_values(array_filter(
    array_map('trim', explode(',', is_string($value) ? $value : '')),
    static fn (string $item): bool => $item !== '',
));

return [

    'postmark' => [
        'key' => env('POSTMARK_API_KEY'),
    ],

    'resend' => [
        'key' => env('RESEND_API_KEY'),
    ],

    'ses' => [
        'key' => env('AWS_ACCESS_KEY_ID'),
        'secret' => env('AWS_SECRET_ACCESS_KEY'),
        'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
    ],

    'slack' => [
        'notifications' => [
            'bot_user_oauth_token' => env('SLACK_BOT_USER_OAUTH_TOKEN'),
            'channel' => env('SLACK_BOT_USER_DEFAULT_CHANNEL'),
        ],
    ],

    /*
    | iyzico payment gateway. Used only when PAYMENT_PROVIDER=iyzico. Never log the keys.
    */
    'iyzico' => [
        'base_url' => env('IYZICO_BASE_URL', 'https://sandbox-api.iyzipay.com'),
        'api_key' => env('IYZICO_API_KEY'),
        'secret_key' => env('IYZICO_SECRET_KEY'),
    ],

    /*
    | Sign in with Apple: the identity token audience is the app bundle id (or
    | the Services ID). Apple puts the SHA-256 of the client nonce in the token.
    */
    'apple' => [
        'client_id' => $list(env('APPLE_CLIENT_ID', '')),
        // Apple Developer team id (also used by DeviceCheck): prefix of the app id in
        // /.well-known/apple-app-site-association; empty renders the bare app id.
        'team_id' => (string) env('APPLE_TEAM_ID', ''),
        'issuers' => ['https://appleid.apple.com'],
        'jwks_url' => 'https://appleid.apple.com/auth/keys',
        'nonce_hashed' => true,
    ],

    /*
    | Google Sign-In: the audience is one of the OAuth client ids of the app.
    */
    'google' => [
        'client_id' => $list(env('GOOGLE_CLIENT_ID', '')),
        'issuers' => ['https://accounts.google.com', 'accounts.google.com'],
        'jwks_url' => 'https://www.googleapis.com/oauth2/v3/certs',
        'nonce_hashed' => false,
    ],

    /*
    | Shared settings of the identity token verifier.
    */
    'identity_tokens' => [
        'jwks_cache_seconds' => 3600,
        'http_timeout_seconds' => 5,
        'leeway_seconds' => 60,
    ],

    /*
    | Breached password check (k-anonymity range API). When disabled or
    | unreachable the check is skipped and a warning is logged (fail open).
    */
    'breached_passwords' => [
        'enabled' => (bool) env('BREACHED_PASSWORD_CHECK', true),
        'url' => 'https://api.pwnedpasswords.com/range/',
        'timeout_seconds' => 3,
    ],

];
