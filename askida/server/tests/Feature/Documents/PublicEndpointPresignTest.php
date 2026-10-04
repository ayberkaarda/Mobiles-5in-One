<?php

use App\Domain\Shops\Documents\DocumentStorage;
use App\Domain\Shops\Models\ShopDocument;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\Feature\Api\Auth\Support\AuthTestKit;
use Tests\Feature\Api\Shops\Support\ShopTestKit;

/*
| Devices reach the object store under another address than the server does (an
| Android emulator sees the host as 10.0.2.2, the compose network calls it minio).
| With AWS_PUBLIC_ENDPOINT set, upload URLs are signed for the public address and the
| store accepts them; the server's own calls keep using AWS_ENDPOINT.
|
| The test process runs inside the compose network, where the public address does not
| resolve to the store. curl's connect-to option sends the TCP connection to the
| store's internal address while the URL, and therefore the Host header the store
| checks, stay exactly as the device would send them.
*/

uses(RefreshDatabase::class);

/**
 * Public endpoint as a device on the developer machine sees it.
 */
function publicStoreEndpoint(): string
{
    $port = getenv('ASKIDA_MINIO_PORT');

    return 'http://localhost:'.(is_string($port) && $port !== '' ? $port : '59000');
}

/**
 * `host:port:target-host:target-port` for curl, from the public endpoint to the store's
 * address inside the compose network.
 */
function connectToStore(): string
{
    $public = parse_url(publicStoreEndpoint());
    $internal = parse_url((string) config('filesystems.disks.private.endpoint'));

    return sprintf(
        '%s:%d:%s:%d',
        $public['host'] ?? 'localhost',
        $public['port'] ?? 80,
        $internal['host'] ?? 'minio',
        $internal['port'] ?? 80,
    );
}

/**
 * PUTs the bytes to the URL as a device on the public address would.
 *
 * @param  array<string, string>  $headers
 */
function putThroughPublicAddress(string $url, array $headers, string $bytes): int
{
    $contentType = $headers['Content-Type'];
    unset($headers['Content-Type']);

    return Http::withOptions(['curl' => [CURLOPT_CONNECT_TO => [connectToStore()]]])
        ->withHeaders($headers)
        ->withBody($bytes, $contentType)
        ->put($url)
        ->status();
}

beforeEach(function (): void {
    AuthTestKit::boot();
    Http::allowStrayRequests([
        rtrim((string) config('filesystems.disks.private.endpoint'), '/').'/*',
        publicStoreEndpoint().'/*',
    ]);
});

it('signs upload URLs for the public endpoint and the store accepts them there', function (): void {
    config(['askida.storage.public_endpoint' => publicStoreEndpoint()]);
    $owner = ShopTestKit::merchant();
    $shop = ShopTestKit::shop($owner);
    $pdf = ShopTestKit::pdf(1);

    AuthTestKit::forgetGuards();
    $presign = $this->withToken(AuthTestKit::token($owner))
        ->postJson("/api/v1/shops/{$shop->id}/documents/presign", ['kind' => 'isletme_belgesi', 'mime' => 'application/pdf', 'size' => strlen($pdf)])
        ->assertCreated();

    $url = (string) $presign->json('data.upload.url');
    $internal = (string) config('filesystems.disks.private.endpoint');

    expect($url)->toStartWith(publicStoreEndpoint().'/')
        ->and($url)->not->toContain((string) parse_url($internal, PHP_URL_HOST))
        ->and($url)->toContain('X-Amz-Signature=');

    /** @var array<string, string> $headers */
    $headers = $presign->json('data.upload.headers');
    expect(putThroughPublicAddress($url, $headers, $pdf))->toBe(200);

    // The server itself still talks to the internal endpoint: confirm reads the object back.
    $documentId = (string) $presign->json('data.document.id');
    AuthTestKit::forgetGuards();
    $this->withToken(AuthTestKit::token($owner))
        ->postJson("/api/v1/shops/{$shop->id}/documents/{$documentId}/confirm")
        ->assertOk()
        ->assertJsonPath('data.state', 'uploaded');

    $row = ShopDocument::query()->findOrFail($documentId);
    expect(app(DocumentStorage::class)->disk()->get($row->path))->toBe($pdf);
});

it('is needed: a URL signed for the internal host is refused when sent to the public host', function (): void {
    config(['askida.storage.public_endpoint' => null]);
    $owner = ShopTestKit::merchant();
    $shop = ShopTestKit::shop($owner);
    $pdf = ShopTestKit::pdf(1);

    AuthTestKit::forgetGuards();
    $presign = $this->withToken(AuthTestKit::token($owner))
        ->postJson("/api/v1/shops/{$shop->id}/documents/presign", ['kind' => 'isletme_belgesi', 'mime' => 'application/pdf', 'size' => strlen($pdf)])
        ->assertCreated();

    $internal = rtrim((string) config('filesystems.disks.private.endpoint'), '/');
    $url = (string) $presign->json('data.upload.url');
    expect($url)->toStartWith($internal.'/');

    // Rewriting the host after signing breaks the signature: the store checks the Host header.
    $rewritten = publicStoreEndpoint().substr($url, strlen($internal));

    /** @var array<string, string> $headers */
    $headers = $presign->json('data.upload.headers');
    expect(putThroughPublicAddress($rewritten, $headers, $pdf))->toBe(403);
});

it('keeps the server disk on the internal endpoint when a public endpoint is set', function (): void {
    config(['askida.storage.public_endpoint' => publicStoreEndpoint()]);
    $storage = app(DocumentStorage::class);

    $presigned = $storage->presignDisk()->temporaryUploadUrl('shops/x/uploads/y', now()->addMinutes(5));
    $internal = rtrim((string) config('filesystems.disks.private.endpoint'), '/');

    expect($presigned['url'])->toStartWith(publicStoreEndpoint().'/')
        ->and($storage->disk()->temporaryUploadUrl('shops/x/uploads/y', now()->addMinutes(5))['url'])->toStartWith($internal.'/');
});
