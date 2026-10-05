<?php

use App\Domain\Auth\Abilities\AdminRole;
use App\Domain\Shops\Documents\DocumentStorage;
use App\Domain\Shops\Models\Shop;
use App\Domain\Shops\Models\ShopDocument;
use App\Domain\Shops\Models\ShopDocumentKind;
use App\Domain\Shops\Services\DocumentUrlSigner;
use App\Models\User;
use Database\Seeders\RolesSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Tests\Feature\Api\Auth\Support\AuthTestKit;
use Tests\Feature\Api\Shops\Support\ShopTestKit;
use Tests\Security\Attack\AttackKit;

/*
| Threat 4.7, private document leak, against the real private bucket (MinIO of the compose
| stack). The only read path is a 5-minute presigned GET issued to an admin; every
| tampered form of it (altered signature, another object, an expired one, the bare object
| URL) is refused by the store with 403, the application serves no storage path, and no API
| answer carries a URL or a storage key of a document.
*/

uses(RefreshDatabase::class);

beforeEach(function (): void {
    (new RolesSeeder)->run();
    Http::allowStrayRequests([rtrim((string) config('filesystems.disks.private.endpoint'), '/').'/*']);
    $this->pdf = ShopTestKit::pdf();
});

function attack07Document(Shop $shop, string $bytes): ShopDocument
{
    $id = (string) Str::uuid7();
    $path = DocumentStorage::documentKey($shop->id, $id);
    app(DocumentStorage::class)->disk()->put($path, $bytes);

    $document = new ShopDocument(['kind' => ShopDocumentKind::TaxCertificate]);
    $document->forceFill([
        'id' => $id,
        'shop_id' => $shop->id,
        'path' => $path,
        'mime' => 'application/pdf',
        'size' => strlen($bytes),
        'uploaded_at' => now(),
    ])->save();

    return $document;
}

function attack07Admin(): User
{
    $admin = User::factory()->create();
    $admin->assignRole(AdminRole::Admin->value);

    return $admin;
}

it('serves the document through a fresh signed URL and nothing else', function (): void {
    $document = attack07Document(ShopTestKit::shop(), $this->pdf);
    $url = app(DocumentUrlSigner::class)->temporaryUrl($document, attack07Admin());

    // Negative control: the signed URL works.
    $ok = Http::get($url);
    expect($ok->status())->toBe(200)->and($ok->body())->toBe($this->pdf);

    $flip = static fn (string $hex): string => $hex === 'a' ? 'b' : 'a';
    $tampered = (string) preg_replace_callback('/(X-Amz-Signature=[0-9a-f]{63})([0-9a-f])/', fn (array $m): string => $m[1].$flip($m[2]), $url);
    $unsigned = (string) strtok($url, '?');
    $longer = (string) preg_replace('/X-Amz-Expires=\d+/', 'X-Amz-Expires=604800', $url);

    foreach (['altered signature' => $tampered, 'bare object' => $unsigned, 'stretched lifetime' => $longer] as $case => $attempt) {
        expect($attempt)->not->toBe($url);
        $response = Http::get($attempt);
        expect($response->status())->toBe(403, $case)
            ->and($response->body())->not->toContain('%PDF');
    }
});

it('does not let a signed URL of one document open another one', function (): void {
    $shop = ShopTestKit::shop();
    $mine = attack07Document($shop, $this->pdf);
    $other = attack07Document(ShopTestKit::shop(), ShopTestKit::pdf(2));
    $url = app(DocumentUrlSigner::class)->temporaryUrl($mine, attack07Admin());

    $swapped = str_replace(rawurlencode($mine->path), rawurlencode($other->path), $url);
    $swapped = str_replace($mine->path, $other->path, $swapped);
    expect($swapped)->not->toBe($url);

    $response = Http::get($swapped);
    expect($response->status())->toBe(403)->and($response->body())->not->toContain('%PDF');
});

it('refuses a signed URL once its five minutes are over', function (): void {
    $document = attack07Document(ShopTestKit::shop(), $this->pdf);

    // The signer issues five-minute URLs.
    $url = app(DocumentUrlSigner::class)->temporaryUrl($document, attack07Admin());
    expect($url)->toMatch('/X-Amz-Expires=(29\d|300)(&|$)/');

    // The same five-minute URL, signed six minutes ago (the store's clock decides).
    $disk = app(DocumentStorage::class)->disk();
    $client = $disk->getClient();
    $command = $client->getCommand('GetObject', [
        'Bucket' => (string) config('filesystems.disks.'.config('filesystems.private_disk', 'private').'.bucket'),
        'Key' => $document->path,
    ]);
    $expired = (string) $client->createPresignedRequest($command, '+300 seconds', ['start_time' => time() - 360])->getUri();
    $fresh = (string) $client->createPresignedRequest($command, '+300 seconds')->getUri();

    $response = Http::get($expired);
    expect($response->status())->toBe(403)
        ->and($response->body())->toContain('AccessDenied')
        ->and($response->body())->not->toContain('%PDF');

    // Negative control: the same request signed now is served.
    expect(Http::get($fresh)->status())->toBe(200);
});

it('serves no document through the application paths', function (string $prefix): void {
    $document = attack07Document(ShopTestKit::shop(), $this->pdf);

    $response = $this->get($prefix.$document->path);

    // 404, or 403 from the framework's signed local-disk route under /storage (no signature).
    expect($response->status())->toBeIn([403, 404])
        ->and((string) $response->getContent())->not->toContain('%PDF');
})->with(['/storage/', '/', '/private/', '/askida-private/']);

it('gives the shop owner no URL and no storage key in any document answer', function (): void {
    AuthTestKit::boot();
    Http::allowStrayRequests([rtrim((string) config('filesystems.disks.private.endpoint'), '/').'/*']);
    $owner = ShopTestKit::merchant();
    $shop = ShopTestKit::shop($owner);
    $bytes = $this->pdf;

    $presign = AttackKit::json('POST', "/api/v1/shops/{$shop->id}/documents/presign", AuthTestKit::token($owner), [
        'kind' => 'vergi_levhasi', 'mime' => 'application/pdf', 'size' => strlen($bytes),
    ])->assertCreated();
    $upload = $presign->json('data.upload');
    $headers = $upload['headers'];
    unset($headers['Content-Type']);
    expect(Http::withHeaders($headers)->withBody($bytes, 'application/pdf')->put($upload['url'])->status())->toBe(200);

    $confirm = AttackKit::json('POST', "/api/v1/shops/{$shop->id}/documents/{$presign->json('data.document.id')}/confirm", AuthTestKit::token($owner))->assertOk();
    $document = ShopDocument::query()->findOrFail($presign->json('data.document.id'));

    foreach ([$presign->json('data.document'), $confirm->json('data')] as $resource) {
        expect(json_encode($resource))->not->toContain('http')
            ->not->toContain($document->path)
            ->not->toContain('X-Amz');
    }

    // The upload URL cannot read: the object now lives under the document key only.
    $read = Http::get($upload['url']);
    expect($read->status())->toBe(403)->and($read->body())->not->toContain('%PDF');
});
