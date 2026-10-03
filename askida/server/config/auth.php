<?php

use App\Models\User;

/*
|--------------------------------------------------------------------------
| Authentication
|--------------------------------------------------------------------------
|
| The mobile API authenticates with Sanctum personal access tokens (guard
| "sanctum", one token per device). The session guard "web" is kept for the
| admin panel. Password reset and email verification use one-time codes
| (App\Domain\Auth\Codes\OneTimeCodeService), not the framework broker.
|
*/

return [

    'defaults' => [
        'guard' => env('AUTH_GUARD', 'web'),
        'passwords' => env('AUTH_PASSWORD_BROKER', 'users'),
    ],

    'guards' => [
        'web' => [
            'driver' => 'session',
            'provider' => 'users',
        ],

        'sanctum' => [
            'driver' => 'sanctum',
            'provider' => 'users',
        ],
    ],

    'providers' => [
        'users' => [
            'driver' => 'eloquent',
            'model' => User::class,
        ],
    ],

    'passwords' => [
        'users' => [
            'provider' => 'users',
            'table' => 'password_reset_tokens',
            'expire' => 60,
            'throttle' => 60,
        ],
    ],

    'password_timeout' => env('AUTH_PASSWORD_TIMEOUT', 10800),

    /*
    |--------------------------------------------------------------------------
    | Login lockout and one-time codes
    |--------------------------------------------------------------------------
    |
    | After `lockout.attempts` failed logins for one email and IP pair, logins
    | for that pair are refused for `lockout.minutes`. Mailed codes expire after
    | `codes.ttl_minutes` and are discarded after `codes.max_attempts` misses.
    |
    */

    'lockout' => [
        'attempts' => (int) env('AUTH_LOCKOUT_ATTEMPTS', 10),
        'minutes' => (int) env('AUTH_LOCKOUT_MINUTES', 15),
    ],

    'codes' => [
        'ttl_minutes' => 60,
        'max_attempts' => 5,
    ],

];
