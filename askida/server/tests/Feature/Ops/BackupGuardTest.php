<?php

use App\Providers\BackupServiceProvider;

/*
| Outside local and testing the application refuses to boot when backups would be written
| unencrypted (empty or example password) or when failures would reach nobody.
*/

beforeEach(function (): void {
    config([
        'backup.backup.password' => 'archive-'.bin2hex(random_bytes(12)),
        'backup.notifications.mail.to' => 'ops@example.test',
    ]);
});

it('boots a production-like environment with a password and an alert address', function (string $environment): void {
    expect(fn () => BackupServiceProvider::guardConfiguration($environment))->not->toThrow(Throwable::class);
})->with(['production', 'staging']);

it('refuses an empty archive password outside local and testing', function (?string $password): void {
    config(['backup.backup.password' => $password]);

    expect(fn () => BackupServiceProvider::guardConfiguration('production'))
        ->toThrow(RuntimeException::class, 'BACKUP_ARCHIVE_PASSWORD must be set');
})->with([null, '', '   ']);

it('refuses the example archive password outside local and testing', function (): void {
    config(['backup.backup.password' => BackupServiceProvider::EXAMPLE_PASSWORD]);

    expect(fn () => BackupServiceProvider::guardConfiguration('production'))
        ->toThrow(RuntimeException::class, 'still holds the .env.example value');
});

it('refuses a missing or malformed alert address outside local and testing', function (?string $address): void {
    config(['backup.notifications.mail.to' => $address]);

    expect(fn () => BackupServiceProvider::guardConfiguration('production'))
        ->toThrow(RuntimeException::class, 'BACKUP_ALERT_EMAIL must be a valid address');
})->with([null, '', 'not-an-address']);

it('refuses the undeliverable default alert address outside local and testing', function (): void {
    config(['backup.notifications.mail.to' => BackupServiceProvider::DEFAULT_ALERT_EMAIL]);

    expect(fn () => BackupServiceProvider::guardConfiguration('production'))
        ->toThrow(RuntimeException::class, 'BACKUP_ALERT_EMAIL is unset');
});

it('falls back to the undeliverable default when the alert address is unset', function (?string $value): void {
    $key = 'BACKUP_ALERT_EMAIL';
    $previous = [$_ENV[$key] ?? null, $_SERVER[$key] ?? null, getenv($key)];
    unset($_ENV[$key], $_SERVER[$key]);
    putenv($key);

    if ($value !== null) {
        $_ENV[$key] = $_SERVER[$key] = $value;
        putenv("{$key}={$value}");
    }

    try {
        /** @var array<string, mixed> $config */
        $config = require config_path('backup.php');
    } finally {
        unset($_ENV[$key], $_SERVER[$key]);
        putenv($key);

        if ($previous[0] !== null) {
            $_ENV[$key] = $previous[0];
        }

        if ($previous[1] !== null) {
            $_SERVER[$key] = $previous[1];
        }

        if ($previous[2] !== false) {
            putenv("{$key}={$previous[2]}");
        }
    }

    expect(data_get($config, 'notifications.mail.to'))->toBe(BackupServiceProvider::DEFAULT_ALERT_EMAIL);
})->with([null, '']);

it('tolerates an empty password in local and testing', function (string $environment): void {
    config(['backup.backup.password' => null, 'backup.notifications.mail.to' => null]);

    expect(fn () => BackupServiceProvider::guardConfiguration($environment))->not->toThrow(Throwable::class);
})->with(['local', 'testing']);

it('is registered as a provider', function (): void {
    expect(app()->getProviders(BackupServiceProvider::class))->not->toBeEmpty();
});
