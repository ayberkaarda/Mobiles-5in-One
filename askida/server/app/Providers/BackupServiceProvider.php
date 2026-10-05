<?php

namespace App\Providers;

use App\Support\Backup\ListingMetadataAdapter;
use Illuminate\Filesystem\FilesystemAdapter;
use Illuminate\Filesystem\FilesystemManager;
use Illuminate\Foundation\Application;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\ServiceProvider;
use League\Flysystem\Filesystem;
use RuntimeException;

/**
 * Backups (security item 20):
 * - the `s3-backups` filesystem driver of the `backups` disk: an S3 disk whose metadata
 *   lookups use the bucket listing, because the application key has no s3:GetObject
 *   (ListingMetadataAdapter);
 * - configuration guard: outside `local` and `testing` the application refuses to boot when
 *   backups would be written unencrypted or nobody would hear about a failed backup
 *   (BACKUP_ARCHIVE_PASSWORD set and not the .env.example value, BACKUP_ALERT_EMAIL valid).
 */
class BackupServiceProvider extends ServiceProvider
{
    /**
     * Filesystem driver name used by the `backups` disk in config/filesystems.php.
     */
    public const DRIVER = 's3-backups';

    /**
     * Environments where an unencrypted local backup is tolerated.
     */
    public const LOCAL_ENVIRONMENTS = ['local', 'testing'];

    /**
     * The plain-word local default shipped in .env.example.
     */
    public const EXAMPLE_PASSWORD = 'local-development-backup-password-not-a-secret';

    public function boot(): void
    {
        self::guardConfiguration($this->app->environment());

        Storage::extend(self::DRIVER, function (Application $app, array $config): FilesystemAdapter {
            /** @var FilesystemManager $manager */
            $manager = $app->make('filesystem');
            $s3 = $manager->createS3Driver(['driver' => 's3'] + $config);
            $adapter = new ListingMetadataAdapter($s3->getAdapter());

            return new FilesystemAdapter(new Filesystem($adapter, $config), $adapter, $config);
        });
    }

    public static function guardConfiguration(string $environment): void
    {
        if (in_array($environment, self::LOCAL_ENVIRONMENTS, true)) {
            return;
        }

        $password = config('backup.backup.password');

        if (! is_string($password) || trim($password) === '') {
            throw new RuntimeException('BACKUP_ARCHIVE_PASSWORD must be set outside local and testing; backups are never written unencrypted.');
        }

        if (hash_equals(self::EXAMPLE_PASSWORD, trim($password))) {
            throw new RuntimeException('BACKUP_ARCHIVE_PASSWORD still holds the .env.example value; set a long random secret.');
        }

        $alert = config('backup.notifications.mail.to');

        if (! is_string($alert) || filter_var($alert, FILTER_VALIDATE_EMAIL) === false) {
            throw new RuntimeException('BACKUP_ALERT_EMAIL must be a valid address outside local and testing.');
        }
    }
}
