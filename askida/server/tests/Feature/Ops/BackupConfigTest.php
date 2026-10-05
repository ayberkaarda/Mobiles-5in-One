<?php

use App\Providers\BackupServiceProvider;
use Dotenv\Dotenv;
use Illuminate\Console\Scheduling\Event;
use Illuminate\Console\Scheduling\Schedule;
use Spatie\Backup\Notifications\Notifications\BackupHasFailedNotification;
use Spatie\Backup\Notifications\Notifications\BackupWasSuccessfulNotification;
use Spatie\Backup\Notifications\Notifications\CleanupHasFailedNotification;
use Spatie\Backup\Notifications\Notifications\CleanupWasSuccessfulNotification;
use Spatie\Backup\Notifications\Notifications\HealthyBackupWasFoundNotification;
use Spatie\Backup\Notifications\Notifications\UnhealthyBackupWasFoundNotification;
use Spatie\Backup\Tasks\Monitor\HealthChecks\MaximumAgeInDays;

/*
| Security item 20: what is backed up, where to, how it is encrypted, how long it is kept,
| when it runs and who is told about problems (docs/ops/backup-restore.md).
*/

/**
 * Loads a configuration file with the given environment values in place, then restores the
 * previous values.
 *
 * @param  array<string, string>  $values
 * @return array<string, mixed>
 */
function backupConfigFileWith(string $file, array $values): array
{
    $previous = [];

    foreach ($values as $key => $value) {
        $previous[$key] = [$_ENV[$key] ?? null, $_SERVER[$key] ?? null];
        $_ENV[$key] = $value;
        $_SERVER[$key] = $value;
    }

    try {
        /** @var array<string, mixed> $config */
        $config = require config_path($file);

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

function backupScheduleEvent(string $command): Event
{
    $event = collect(app(Schedule::class)->events())
        ->first(fn (Event $event): bool => str_contains((string) $event->command, "artisan' {$command}") || str_ends_with((string) $event->command, $command));

    expect($event)->not->toBeNull("no schedule entry for {$command}");

    /** @var Event $event */
    return $event;
}

it('backs up the database and the private documents into one encrypted archive on the backups disk', function (): void {
    $backup = config('backup.backup');

    expect($backup['name'])->toBe('askida')
        ->and($backup['source']['databases'])->toBe(['pgsql'])
        ->and($backup['source']['files']['include'])->toBe([storage_path('app/private')])
        ->and($backup['source']['files']['relative_path'])->toBe(storage_path('app'))
        ->and($backup['destination']['disks'])->toBe(['backups'])
        ->and($backup['encryption'])->toBe('default');
});

it('reads the archive password and the alert address from the environment', function (): void {
    $config = backupConfigFileWith('backup.php', [
        'BACKUP_ARCHIVE_PASSWORD' => 'archive-'.bin2hex(random_bytes(8)),
        'BACKUP_ALERT_EMAIL' => 'alerts@example.test',
    ]);

    expect($config['backup']['password'])->toStartWith('archive-')
        ->and($config['notifications']['mail']['to'])->toBe('alerts@example.test');
});

it('keeps every archive for a week, then dailies, weeklies and monthlies, no yearlies', function (): void {
    expect(config('backup.cleanup.default_strategy'))->toBe([
        'keep_all_backups_for_days' => 7,
        'keep_daily_backups_for_days' => 7,
        'keep_weekly_backups_for_weeks' => 4,
        'keep_monthly_backups_for_months' => 6,
        'keep_yearly_backups_for_years' => 0,
        'delete_oldest_backups_when_using_more_megabytes_than' => null,
    ]);
});

it('monitors the backups disk for an archive younger than one day', function (): void {
    expect(config('backup.monitor_backups'))->toBe([[
        'name' => 'askida',
        'disks' => ['backups'],
        'health_checks' => [MaximumAgeInDays::class => 1],
    ]]);
});

it('mails failures and unhealthy backups only', function (): void {
    expect(config('backup.notifications.notifications'))->toBe([
        BackupHasFailedNotification::class => ['mail'],
        UnhealthyBackupWasFoundNotification::class => ['mail'],
        CleanupHasFailedNotification::class => ['mail'],
        BackupWasSuccessfulNotification::class => [],
        HealthyBackupWasFoundNotification::class => [],
        CleanupWasSuccessfulNotification::class => [],
    ]);
});

it('gives the backups disk its own bucket and its own key pair', function (): void {
    $config = backupConfigFileWith('filesystems.php', [
        'AWS_ACCESS_KEY_ID' => 'documents-key',
        'AWS_SECRET_ACCESS_KEY' => 'documents-'.bin2hex(random_bytes(6)),
        'BACKUP_AWS_ACCESS_KEY_ID' => 'backup-app-key',
        'BACKUP_AWS_SECRET_ACCESS_KEY' => 'backup-'.bin2hex(random_bytes(6)),
        'BACKUP_AWS_BUCKET' => 'askida-backups',
        'BACKUP_AWS_ENDPOINT' => 'https://backups.example.test',
    ]);
    $disk = $config['disks']['backups'];

    expect($disk['driver'])->toBe(BackupServiceProvider::DRIVER)
        ->and($disk['key'])->toBe('backup-app-key')
        ->and($disk['secret'])->toStartWith('backup-')
        ->and($disk['bucket'])->toBe('askida-backups')
        ->and($disk['endpoint'])->toBe('https://backups.example.test')
        ->and($disk['visibility'])->toBe('private')
        ->and($disk['throw'])->toBeTrue()
        ->and($disk['key'])->not->toBe($config['disks']['private']['key'])
        ->and($disk['bucket'])->not->toBe($config['disks']['private']['bucket']);
});

it('ships the backup and send budget keys in the example file', function (): void {
    $example = Dotenv::parse((string) file_get_contents(base_path('.env.example')));

    expect($example)->toHaveKeys([
        'BACKUP_AWS_ACCESS_KEY_ID',
        'BACKUP_AWS_SECRET_ACCESS_KEY',
        'BACKUP_AWS_DEFAULT_REGION',
        'BACKUP_AWS_BUCKET',
        'BACKUP_AWS_ENDPOINT',
        'BACKUP_AWS_USE_PATH_STYLE_ENDPOINT',
        'BACKUP_ARCHIVE_PASSWORD',
        'BACKUP_ALERT_EMAIL',
        'COST_DAILY_EMAIL_CAP',
        'COST_DAILY_PUSH_CAP',
    ])
        ->and($example['BACKUP_AWS_BUCKET'])->toBe('askida-backups')
        ->and($example['BACKUP_AWS_ACCESS_KEY_ID'])->not->toBe($example['AWS_ACCESS_KEY_ID'])
        ->and($example['BACKUP_ARCHIVE_PASSWORD'])->toBe(BackupServiceProvider::EXAMPLE_PASSWORD)
        ->and($example['COST_DAILY_EMAIL_CAP'])->toBe('2000')
        ->and($example['COST_DAILY_PUSH_CAP'])->toBe('20000');
});

it('schedules clean at 03:00, run at 03:30 and monitor at 04:00 Istanbul time on one server', function (): void {
    foreach (['backup:clean' => '0 3 * * *', 'backup:run' => '30 3 * * *', 'backup:monitor' => '0 4 * * *'] as $command => $expression) {
        $event = backupScheduleEvent($command);

        expect($event->expression)->toBe($expression)
            ->and($event->timezone)->toBe('Europe/Istanbul')
            ->and($event->onOneServer)->toBeTrue();
    }

    expect(backupScheduleEvent('backup:run')->withoutOverlapping)->toBeTrue()
        ->and(backupScheduleEvent('backup:clean')->withoutOverlapping)->toBeTrue();
});
