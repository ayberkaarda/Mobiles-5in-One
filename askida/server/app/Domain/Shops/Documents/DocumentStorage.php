<?php

namespace App\Domain\Shops\Documents;

use Illuminate\Filesystem\FilesystemAdapter;
use Illuminate\Support\Facades\Storage;

/**
 * The private disk that holds verification documents (S3-compatible; MinIO locally).
 */
final class DocumentStorage
{
    public function disk(): FilesystemAdapter
    {
        $name = config('filesystems.private_disk', 'private');

        /** @var FilesystemAdapter $disk */
        $disk = Storage::disk(is_string($name) ? $name : 'private');

        return $disk;
    }

    /**
     * Where the client uploads through the presigned URL.
     */
    public static function uploadKey(string $shopId, string $documentId): string
    {
        return "shops/{$shopId}/uploads/{$documentId}";
    }

    /**
     * Where the inspected bytes live after confirmation. The presigned URL cannot write
     * here, so an upload repeated after the check never replaces the checked content.
     */
    public static function documentKey(string $shopId, string $documentId): string
    {
        return "shops/{$shopId}/documents/{$documentId}";
    }
}
