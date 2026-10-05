<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Default Filesystem Disk
    |--------------------------------------------------------------------------
    |
    | Here you may specify the default filesystem disk that should be used
    | by the framework. The "local" disk, as well as a variety of cloud
    | based disks are available to your application for file storage.
    |
    */

    'default' => env('FILESYSTEM_DISK', 'local'),

    /*
    |--------------------------------------------------------------------------
    | Private Document Disk
    |--------------------------------------------------------------------------
    |
    | Name of the disk that holds shop documents. It must never be publicly
    | readable; documents are only reachable through short-lived signed URLs.
    |
    */

    'private_disk' => env('FILESYSTEM_PRIVATE_DISK', 'private'),

    /*
    |--------------------------------------------------------------------------
    | Filesystem Disks
    |--------------------------------------------------------------------------
    |
    | Below you may configure as many filesystem disks as necessary, and you
    | may even configure multiple disks for the same driver. Examples for
    | most supported storage drivers are configured here for reference.
    |
    | Supported drivers: "local", "ftp", "sftp", "s3"
    |
    */

    'disks' => [

        'local' => [
            'driver' => 'local',
            'root' => storage_path('app/private'),
            'serve' => true,
            'throw' => false,
            'report' => false,
        ],

        'public' => [
            'driver' => 'local',
            'root' => storage_path('app/public'),
            'url' => rtrim((string) env('APP_URL', 'http://localhost'), '/').'/storage',
            'visibility' => 'public',
            'throw' => false,
            'report' => false,
        ],

        // Shop documents (S3-compatible, MinIO locally): never publicly readable, no public URL.
        // Needs the flysystem S3 adapter package, which the shops work adds to composer.
        'private' => [
            'driver' => 's3',
            'key' => env('AWS_ACCESS_KEY_ID'),
            'secret' => env('AWS_SECRET_ACCESS_KEY'),
            'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
            'bucket' => env('AWS_BUCKET_PRIVATE', 'askida-private'),
            'endpoint' => env('AWS_ENDPOINT'),
            'use_path_style_endpoint' => env('AWS_USE_PATH_STYLE_ENDPOINT', true),
            'visibility' => 'private',
            'throw' => true,
            'report' => false,
        ],

        // Shop documents and backups: never publicly readable.
        's3_private' => [
            'driver' => 's3',
            'key' => env('AWS_ACCESS_KEY_ID'),
            'secret' => env('AWS_SECRET_ACCESS_KEY'),
            'region' => env('AWS_DEFAULT_REGION'),
            'bucket' => env('AWS_BUCKET_PRIVATE'),
            'endpoint' => env('AWS_ENDPOINT'),
            'use_path_style_endpoint' => env('AWS_USE_PATH_STYLE_ENDPOINT', false),
            'visibility' => 'private',
            'throw' => false,
            'report' => false,
        ],

        // Encrypted backup archives (config/backup.php). Own bucket and own key pair: the
        // application identity may put, list and delete objects but not read them; restores
        // use a separate read identity outside the application (docs/ops/backup-restore.md).
        // Driver `s3-backups` (App\Providers\BackupServiceProvider) is the S3 driver with
        // metadata read from the bucket listing, since HeadObject needs s3:GetObject.
        'backups' => [
            'driver' => 's3-backups',
            'key' => env('BACKUP_AWS_ACCESS_KEY_ID'),
            'secret' => env('BACKUP_AWS_SECRET_ACCESS_KEY'),
            'region' => env('BACKUP_AWS_DEFAULT_REGION', 'us-east-1'),
            'bucket' => env('BACKUP_AWS_BUCKET', 'askida-backups'),
            'endpoint' => env('BACKUP_AWS_ENDPOINT'),
            'use_path_style_endpoint' => env('BACKUP_AWS_USE_PATH_STYLE_ENDPOINT', true),
            'visibility' => 'private',
            'throw' => true,
            'report' => false,
        ],

        // Re-encoded shop photos served to the public web and the app.
        's3_public' => [
            'driver' => 's3',
            'key' => env('AWS_ACCESS_KEY_ID'),
            'secret' => env('AWS_SECRET_ACCESS_KEY'),
            'region' => env('AWS_DEFAULT_REGION'),
            'bucket' => env('AWS_BUCKET_PUBLIC'),
            'endpoint' => env('AWS_ENDPOINT'),
            'use_path_style_endpoint' => env('AWS_USE_PATH_STYLE_ENDPOINT', false),
            'visibility' => 'public',
            'throw' => false,
            'report' => false,
        ],

    ],

    /*
    |--------------------------------------------------------------------------
    | Symbolic Links
    |--------------------------------------------------------------------------
    |
    | Here you may configure the symbolic links that will be created when the
    | `storage:link` Artisan command is executed. The array keys should be
    | the locations of the links and the values should be their targets.
    |
    */

    'links' => [
        public_path('storage') => storage_path('app/public'),
    ],

];
