<?php

use App\Domain\Hooks\Codes\HookCodeHasher;
use Dotenv\Dotenv;

/*
| Every environment key the code reads ships in .env.example with a working local
| value, and the configuration files read it (env() is called only in config files).
*/

/**
 * @return array<string, string|null>
 */
function envExample(): array
{
    return Dotenv::parse((string) file_get_contents(base_path('.env.example')));
}

/**
 * Loads config/askida.php with the given environment values in place, then restores
 * the previous values.
 *
 * @param  array<string, string>  $values
 * @return array<string, mixed>
 */
function askidaConfigWith(array $values): array
{
    $previous = [];

    foreach ($values as $key => $value) {
        $previous[$key] = [$_ENV[$key] ?? null, $_SERVER[$key] ?? null];
        $_ENV[$key] = $value;
        $_SERVER[$key] = $value;
    }

    try {
        /** @var array<string, mixed> $config */
        $config = require base_path('config/askida.php');

        return $config;
    } finally {
        foreach ($previous as $key => [$env, $server]) {
            if ($env === null) {
                unset($_ENV[$key]);
            } else {
                $_ENV[$key] = $env;
            }

            if ($server === null) {
                unset($_SERVER[$key]);
            } else {
                $_SERVER[$key] = $server;
            }
        }
    }
}

it('ships the attestation, push, pepper and public storage keys in the example file', function (): void {
    $example = envExample();

    expect($example)->toHaveKeys([
        'PLAY_INTEGRITY_PACKAGE_NAME',
        'APPLE_DEVICECHECK_ENVIRONMENT',
        'PUSH_HOURLY_FANOUT_CAP',
        'HOOK_CODE_PEPPER',
        'AWS_PUBLIC_ENDPOINT',
    ])
        ->and($example['APPLE_DEVICECHECK_ENVIRONMENT'])->toBe('sandbox')
        ->and($example['PUSH_HOURLY_FANOUT_CAP'])->toBe('500')
        ->and($example['AWS_PUBLIC_ENDPOINT'])->toBe('');
});

it('gives local development a plain-word pepper that the hasher accepts', function (): void {
    $pepper = (string) envExample()['HOOK_CODE_PEPPER'];

    expect($pepper)->toMatch('/^[a-z]+(-[a-z]+)+$/')
        ->and(HookCodeHasher::requirePepper($pepper))->toBe($pepper)
        ->and((new HookCodeHasher($pepper))->hash('ABCD2345'))->toMatch('/^[0-9a-f]{64}$/');
});

it('reads the new keys in the configuration file', function (): void {
    $config = askidaConfigWith([
        'PLAY_INTEGRITY_PACKAGE_NAME' => 'app.askida.mobile',
        'APPLE_DEVICECHECK_ENVIRONMENT' => 'sandbox',
        'PUSH_HOURLY_FANOUT_CAP' => '500',
        'AWS_PUBLIC_ENDPOINT' => 'http://10.0.2.2:59000',
    ]);

    expect(data_get($config, 'attestation.play_integrity.package_name'))->toBe('app.askida.mobile')
        ->and(data_get($config, 'attestation.device_check.environment'))->toBe('development')
        ->and(data_get($config, 'attestation.device_check.urls.development'))->toBeString()
        ->and(data_get($config, 'push.hourly_fanout_cap'))->toBe(500)
        ->and(data_get($config, 'storage.public_endpoint'))->toBe('http://10.0.2.2:59000');
});

it('keeps the production device check endpoint and an unset public endpoint', function (): void {
    $config = askidaConfigWith(['APPLE_DEVICECHECK_ENVIRONMENT' => 'production', 'AWS_PUBLIC_ENDPOINT' => '']);

    expect(data_get($config, 'attestation.device_check.environment'))->toBe('production')
        ->and(data_get($config, 'storage.public_endpoint'))->toBeNull();
});
