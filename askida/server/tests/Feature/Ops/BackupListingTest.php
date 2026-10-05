<?php

use App\Providers\BackupServiceProvider;
use App\Support\Backup\ListingMetadataAdapter;
use Illuminate\Filesystem\FilesystemAdapter;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Storage;
use League\Flysystem\Config;
use League\Flysystem\FileAttributes;
use League\Flysystem\Filesystem;
use League\Flysystem\FilesystemAdapter as FlysystemAdapter;
use Spatie\Backup\BackupDestination\Backup;
use Spatie\Backup\Notifications\Notifiable;
use Spatie\Backup\Notifications\Notifications\UnhealthyBackupWasFoundNotification;

/*
| The application key of the backup bucket may put, list and delete but not read objects.
| S3-compatible stores authorise HeadObject (existence, size, modification time) with
| s3:GetObject, so the `backups` disk answers those questions from the bucket listing.
| The bucket below is an in-memory stand-in that refuses every read and every metadata
| lookup, as the real store does for that key.
*/

/**
 * An object store that only lists, writes and deletes.
 */
final class ListOnlyBucket implements FlysystemAdapter
{
    /** @var array<string, array{size: int, modified: int}> */
    public array $objects = [];

    /** @var list<string> */
    public array $deleted = [];

    public function put(string $path, int $size, Carbon $modified): void
    {
        $this->objects[$path] = ['size' => $size, 'modified' => $modified->getTimestamp()];
    }

    public function fileExists(string $path): bool
    {
        throw new RuntimeException('HeadObject denied: '.$path);
    }

    public function directoryExists(string $path): bool
    {
        return collect(array_keys($this->objects))->contains(fn (string $key): bool => str_starts_with($key, trim($path, '/').'/'));
    }

    public function write(string $path, string $contents, Config $config): void
    {
        $this->objects[$path] = ['size' => strlen($contents), 'modified' => time()];
    }

    public function writeStream(string $path, $contents, Config $config): void
    {
        $this->write($path, (string) stream_get_contents($contents), $config);
    }

    public function read(string $path): string
    {
        throw new RuntimeException('GetObject denied: '.$path);
    }

    public function readStream(string $path)
    {
        throw new RuntimeException('GetObject denied: '.$path);
    }

    public function delete(string $path): void
    {
        unset($this->objects[$path]);
        $this->deleted[] = $path;
    }

    public function deleteDirectory(string $path): void
    {
        throw new RuntimeException('not used');
    }

    public function createDirectory(string $path, Config $config): void {}

    public function setVisibility(string $path, string $visibility): void
    {
        throw new RuntimeException('not used');
    }

    public function visibility(string $path): FileAttributes
    {
        throw new RuntimeException('GetObjectAcl denied: '.$path);
    }

    public function mimeType(string $path): FileAttributes
    {
        throw new RuntimeException('HeadObject denied: '.$path);
    }

    public function lastModified(string $path): FileAttributes
    {
        throw new RuntimeException('HeadObject denied: '.$path);
    }

    public function fileSize(string $path): FileAttributes
    {
        throw new RuntimeException('HeadObject denied: '.$path);
    }

    public function listContents(string $path, bool $deep): iterable
    {
        $prefix = trim($path, '/') === '' ? '' : trim($path, '/').'/';

        foreach ($this->objects as $key => $object) {
            $rest = substr($key, strlen($prefix));

            if (! str_starts_with($key, $prefix) || (! $deep && str_contains($rest, '/'))) {
                continue;
            }

            yield new FileAttributes($key, $object['size'], null, $object['modified']);
        }
    }

    public function move(string $source, string $destination, Config $config): void
    {
        throw new RuntimeException('not used');
    }

    public function copy(string $source, string $destination, Config $config): void
    {
        throw new RuntimeException('not used');
    }
}

function listOnlyDisk(ListOnlyBucket $bucket): FilesystemAdapter
{
    $adapter = new ListingMetadataAdapter($bucket);

    return new FilesystemAdapter(new Filesystem($adapter), $adapter);
}

function backupArchiveName(Carbon $at): string
{
    return 'askida/'.$at->format('Y-m-d-H-i-s').'.zip';
}

beforeEach(function (): void {
    config(['backup.notifications.mail.to' => 'ops@example.test']);
});

it('builds the backups disk on the listing adapter', function (): void {
    $disk = Storage::disk('backups');

    expect(config('filesystems.disks.backups.driver'))->toBe(BackupServiceProvider::DRIVER)
        ->and($disk)->toBeInstanceOf(FilesystemAdapter::class)
        ->and($disk->getAdapter())->toBeInstanceOf(ListingMetadataAdapter::class);
});

it('answers existence, size and age from the listing only', function (): void {
    $bucket = new ListOnlyBucket;
    $modified = Carbon::now()->subHours(3)->startOfSecond();
    $bucket->put('askida/2026-10-05-03-30-00.zip', 4096, $modified);
    $disk = listOnlyDisk($bucket);

    expect($disk->exists('askida/2026-10-05-03-30-00.zip'))->toBeTrue()
        ->and($disk->exists('askida/2026-10-04-03-30-00.zip'))->toBeFalse()
        ->and($disk->size('askida/2026-10-05-03-30-00.zip'))->toBe(4096)
        ->and($disk->lastModified('askida/2026-10-05-03-30-00.zip'))->toBe($modified->getTimestamp())
        ->and(fn () => $disk->get('askida/2026-10-05-03-30-00.zip'))->toThrow(RuntimeException::class, 'GetObject denied');

    $backup = new Backup($disk, 'askida/2026-10-05-03-30-00.zip');

    expect($backup->exists())->toBeTrue()
        ->and($backup->sizeInBytes())->toBe(4096.0);
});

it('lets backup:clean prune archives past the retention window without reading them', function (): void {
    $bucket = new ListOnlyBucket;
    $recent = backupArchiveName(Carbon::now()->subHour());
    $expired = backupArchiveName(Carbon::now()->subMonths(8));
    $bucket->put($recent, 2048, Carbon::now()->subHour());
    $bucket->put($expired, 2048, Carbon::now()->subMonths(8));
    Storage::set('backups', listOnlyDisk($bucket));

    $this->artisan('backup:clean')->assertSuccessful();

    expect($bucket->deleted)->toBe([$expired])
        ->and(array_keys($bucket->objects))->toBe([$recent]);
});

it('lets backup:monitor judge the newest archive without reading it', function (): void {
    Notification::fake();
    $bucket = new ListOnlyBucket;
    $bucket->put(backupArchiveName(Carbon::now()->subHours(2)), 2048, Carbon::now()->subHours(2));
    Storage::set('backups', listOnlyDisk($bucket));

    $this->artisan('backup:monitor')
        ->expectsOutputToContain('considered healthy')
        ->assertSuccessful();

    Notification::assertNotSentTo(new Notifiable, UnhealthyBackupWasFoundNotification::class);
});

it('mails an unhealthy report when the newest archive is older than a day', function (): void {
    Notification::fake();
    $bucket = new ListOnlyBucket;
    $bucket->put(backupArchiveName(Carbon::now()->subDays(2)), 2048, Carbon::now()->subDays(2));
    Storage::set('backups', listOnlyDisk($bucket));

    $this->artisan('backup:monitor');

    Notification::assertSentTo(
        new Notifiable,
        UnhealthyBackupWasFoundNotification::class,
        fn (UnhealthyBackupWasFoundNotification $notification, array $channels): bool => $channels === ['mail'],
    );
});
