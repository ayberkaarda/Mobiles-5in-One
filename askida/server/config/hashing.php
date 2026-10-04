<?php

/*
|--------------------------------------------------------------------------
| Password hashing
|--------------------------------------------------------------------------
|
| Passwords are hashed with Argon2id. The defaults below are the production
| cost (memory 64 MiB, time 4, one thread); the ARGON_* variables exist only
| so the test environment can lower the cost. The driver is not configurable.
|
*/

return [

    'driver' => 'argon2id',

    'bcrypt' => [
        'rounds' => env('BCRYPT_ROUNDS', 12),
        'verify' => true,
        'limit' => null,
    ],

    'argon' => [
        'memory' => (int) env('ARGON_MEMORY', 65536),
        'threads' => (int) env('ARGON_THREADS', 1),
        'time' => (int) env('ARGON_TIME', 4),
        'verify' => true,
    ],

    'rehash_on_login' => true,

];
