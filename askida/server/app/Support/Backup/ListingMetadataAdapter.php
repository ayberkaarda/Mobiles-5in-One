<?php

namespace App\Support\Backup;

use League\Flysystem\Config;
use League\Flysystem\FileAttributes;
use League\Flysystem\FilesystemAdapter;
use League\Flysystem\UnableToRetrieveMetadata;

/**
 * Wraps the S3 adapter of the `backups` disk so existence, size and modification time come
 * from the bucket listing (s3:ListBucket) instead of HeadObject.
 *
 * S3-compatible stores authorise HeadObject with s3:GetObject. The application identity of
 * the backup bucket deliberately lacks s3:GetObject (it must not be able to read archives
 * back), so a plain S3 disk could write archives but `backup:list`, `backup:monitor` and
 * `backup:clean` would fail on the first metadata lookup. Every other operation is passed
 * through unchanged.
 */
final class ListingMetadataAdapter implements FilesystemAdapter
{
    public function __construct(private readonly FilesystemAdapter $inner) {}

    public function fileExists(string $path): bool
    {
        return $this->listed($path) instanceof FileAttributes;
    }

    public function directoryExists(string $path): bool
    {
        return $this->inner->directoryExists($path);
    }

    public function write(string $path, string $contents, Config $config): void
    {
        $this->inner->write($path, $contents, $config);
    }

    public function writeStream(string $path, $contents, Config $config): void
    {
        $this->inner->writeStream($path, $contents, $config);
    }

    public function read(string $path): string
    {
        return $this->inner->read($path);
    }

    public function readStream(string $path)
    {
        return $this->inner->readStream($path);
    }

    public function delete(string $path): void
    {
        $this->inner->delete($path);
    }

    public function deleteDirectory(string $path): void
    {
        $this->inner->deleteDirectory($path);
    }

    public function createDirectory(string $path, Config $config): void
    {
        $this->inner->createDirectory($path, $config);
    }

    public function setVisibility(string $path, string $visibility): void
    {
        $this->inner->setVisibility($path, $visibility);
    }

    public function visibility(string $path): FileAttributes
    {
        return $this->inner->visibility($path);
    }

    public function mimeType(string $path): FileAttributes
    {
        return $this->inner->mimeType($path);
    }

    public function lastModified(string $path): FileAttributes
    {
        $attributes = $this->listed($path);

        if ($attributes === null || $attributes->lastModified() === null) {
            throw UnableToRetrieveMetadata::lastModified($path, 'not found in the bucket listing');
        }

        return $attributes;
    }

    public function fileSize(string $path): FileAttributes
    {
        $attributes = $this->listed($path);

        if ($attributes === null || $attributes->fileSize() === null) {
            throw UnableToRetrieveMetadata::fileSize($path, 'not found in the bucket listing');
        }

        return $attributes;
    }

    public function listContents(string $path, bool $deep): iterable
    {
        return $this->inner->listContents($path, $deep);
    }

    public function move(string $source, string $destination, Config $config): void
    {
        $this->inner->move($source, $destination, $config);
    }

    public function copy(string $source, string $destination, Config $config): void
    {
        $this->inner->copy($source, $destination, $config);
    }

    /**
     * The listing entry of a file, or null when the parent "directory" does not list it.
     */
    private function listed(string $path): ?FileAttributes
    {
        $path = trim($path, '/');
        $directory = str_contains($path, '/') ? substr($path, 0, (int) strrpos($path, '/')) : '';

        foreach ($this->inner->listContents($directory, false) as $item) {
            if ($item instanceof FileAttributes && $item->path() === $path) {
                return $item;
            }
        }

        return null;
    }
}
