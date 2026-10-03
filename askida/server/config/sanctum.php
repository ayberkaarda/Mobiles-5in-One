<?php

use Illuminate\Cookie\Middleware\EncryptCookies;
use Illuminate\Foundation\Http\Middleware\ValidateCsrfToken;
use Laravel\Sanctum\Http\Middleware\AuthenticateSession;

/*
|--------------------------------------------------------------------------
| Sanctum
|--------------------------------------------------------------------------
|
| Only bearer personal access tokens are accepted: the API has no first-party
| SPA, so there are no stateful domains and no session guards are consulted.
| Tokens expire after SANCTUM_TOKEN_EXPIRATION_MINUTES (30 days by default).
|
*/

return [

    'stateful' => [],

    'guard' => [],

    'expiration' => (int) env('SANCTUM_TOKEN_EXPIRATION_MINUTES', 43200),

    'token_prefix' => env('SANCTUM_TOKEN_PREFIX', ''),

    'middleware' => [
        'authenticate_session' => AuthenticateSession::class,
        'encrypt_cookies' => EncryptCookies::class,
        'validate_csrf_token' => ValidateCsrfToken::class,
    ],

];
