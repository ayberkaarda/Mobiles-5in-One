<?php

use Illuminate\Support\Facades\Hash;

it('defaults to Argon2id with the production cost when no override is set', function (): void {
    $names = ['ARGON_MEMORY', 'ARGON_TIME', 'ARGON_THREADS'];
    $saved = [];

    foreach ($names as $name) {
        $saved[$name] = [$_ENV[$name] ?? null, $_SERVER[$name] ?? null, getenv($name)];
        unset($_ENV[$name], $_SERVER[$name]);
        putenv($name);
    }

    try {
        $config = require config_path('hashing.php');
    } finally {
        foreach ($saved as $name => [$env, $server, $process]) {
            if ($env !== null) {
                $_ENV[$name] = $env;
            }
            if ($server !== null) {
                $_SERVER[$name] = $server;
            }
            if ($process !== false) {
                putenv($name.'='.$process);
            }
        }
    }

    expect($config['driver'])->toBe('argon2id')
        ->and($config['argon']['memory'])->toBe(65536)
        ->and($config['argon']['time'])->toBe(4)
        ->and($config['argon']['threads'])->toBe(1)
        ->and($config['argon']['verify'])->toBeTrue();
});

it('produces Argon2id hashes', function (): void {
    config(['hashing.argon.memory' => 1024, 'hashing.argon.time' => 1]);

    $hash = Hash::make('walnut-'.bin2hex(random_bytes(4)));

    expect($hash)->toStartWith('$argon2id$');
});
