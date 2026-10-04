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
     * The disk that signs upload URLs handed to devices.
     *
     * S3 signature version 4 signs the Host header, and the store checks the signature
     * against the Host it receives. A URL signed for the server's endpoint
     * (`http://minio:9000`) and rewritten to another host afterwards is therefore
     * refused. When `askida.storage.public_endpoint` is set, a second client configured
     * with that endpoint signs the URL instead: presigning needs no network call, the
     * device sends the public host, and the store accepts the signature. Every other
     * storage call keeps using disk().
     */
    public function presignDisk(): FilesystemAdapter
    {
        $endpoint = config('askida.storage.public_endpoint');

        if (! is_string($endpoint) || $endpoint === '') {
            return $this->disk();
        }

        $name = config('filesystems.private_disk', 'private');
        $config = config('filesystems.disks.'.(is_string($name) ? $name : 'private'));

        /** @var FilesystemAdapter $disk */
        $disk = Storage::build(array_merge(is_array($config) ? $config : [], ['endpoint' => $endpoint]));

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
