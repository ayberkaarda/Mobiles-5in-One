<?php

use Spatie\Backup\Notifications\Notifiable;
use Spatie\Backup\Notifications\Notifications\BackupHasFailedNotification;
use Spatie\Backup\Notifications\Notifications\BackupWasSuccessfulNotification;
use Spatie\Backup\Notifications\Notifications\CleanupHasFailedNotification;
use Spatie\Backup\Notifications\Notifications\CleanupWasSuccessfulNotification;
use Spatie\Backup\Notifications\Notifications\HealthyBackupWasFoundNotification;
use Spatie\Backup\Notifications\Notifications\UnhealthyBackupWasFoundNotification;
use Spatie\Backup\Tasks\Cleanup\Strategies\DefaultStrategy;
use Spatie\Backup\Tasks\Monitor\HealthChecks\MaximumAgeInDays;

/*
| Backups (security item 20, docs/ops/backup-restore.md).
|
| One encrypted zip per run: the PostgreSQL dump plus storage/app/private, written to the
| `backups` disk (config/filesystems.php), an S3-compatible bucket reached with its own key
| pair. That key may put, list and delete archives but not read them; restores use a
| separate read identity held outside the application. Schedule: routes/console.php.
*/

return [

    'backup' => [
        // Archives live under "<name>/" in the bucket; the restore drill looks there.
        'name' => 'askida',

        'source' => [
            'files' => [
                'include' => [
                    storage_path('app/private'),
                ],

                'exclude' => [],

                'follow_links' => false,

                'ignore_unreadable_directories' => false,

                // Archive entries become "private/..." instead of absolute container paths.
                'relative_path' => storage_path('app'),
            ],

            'databases' => [
                'pgsql',
            ],
        ],

        'database_dump_compressor' => null,

        'database_dump_file_timestamp_format' => null,

        // The dump is stored as db-dumps/postgresql-<database>.sql inside the archive.
        'database_dump_filename_base' => 'database',

        'database_dump_file_extension' => '',

        'destination' => [
            'compression_method' => ZipArchive::CM_DEFAULT,

            'compression_level' => 9,

            'filename_prefix' => '',

            'disks' => [
                'backups',
            ],

            'continue_on_failure' => false,
        ],

        'temporary_directory' => storage_path('app/backup-temp'),

        // Required outside local and testing: App\Providers\BackupServiceProvider refuses to
        // boot with an empty value or the .env.example value there.
        'password' => env('BACKUP_ARCHIVE_PASSWORD'),

        // AES-256 whenever a password is set.
        'encryption' => 'default',

        'verify_backup' => false,

        'tries' => 1,

        'retry_delay' => 0,
    ],

    /*
    | Only problems are mailed: failed backups, failed cleanups and unhealthy backups.
    | Successful runs and healthy checks stay in the log.
    */
    'notifications' => [
        'notifications' => [
            BackupHasFailedNotification::class => ['mail'],
            UnhealthyBackupWasFoundNotification::class => ['mail'],
            CleanupHasFailedNotification::class => ['mail'],
            BackupWasSuccessfulNotification::class => [],
            HealthyBackupWasFoundNotification::class => [],
            CleanupWasSuccessfulNotification::class => [],
        ],

        'notifiable' => Notifiable::class,

        'mail' => [
            'to' => env('BACKUP_ALERT_EMAIL'),

            'from' => [
                'address' => env('MAIL_FROM_ADDRESS', 'no-reply@askida.test'),
                'name' => env('MAIL_FROM_NAME', 'Askida'),
            ],
        ],

        'slack' => [
            'webhook_url' => '',
            'channel' => null,
            'username' => null,
            'icon' => null,
        ],

        'discord' => [
            'webhook_url' => '',
            'username' => '',
            'avatar_url' => '',
        ],

        'webhook' => [
            'url' => '',
        ],
    ],

    'log_channel' => null,

    /*
    | backup:monitor: the newest archive must be younger than one day. Archive sizes are not
    | checked here: the application key cannot read object metadata, so the bucket owner
    | watches storage through the provider's quota and lifecycle settings.
    */
    'monitor_backups' => [
        [
            'name' => 'askida',
            'disks' => ['backups'],
            'health_checks' => [
                MaximumAgeInDays::class => 1,
            ],
        ],
    ],

    'cleanup' => [
        'strategy' => DefaultStrategy::class,

        // Retention: every archive for 7 days, then one per day for 7 days, one per week for
        // 4 weeks and one per month for 6 months; no yearly archives.
        'default_strategy' => [
            'keep_all_backups_for_days' => 7,

            'keep_daily_backups_for_days' => 7,

            'keep_weekly_backups_for_weeks' => 4,

            'keep_monthly_backups_for_months' => 6,

            'keep_yearly_backups_for_years' => 0,

            // Size-based pruning needs object metadata the application key cannot read; the
            // bucket quota is the storage limit instead.
            'delete_oldest_backups_when_using_more_megabytes_than' => null,
        ],

        'tries' => 1,

        'retry_delay' => 0,
    ],

];
