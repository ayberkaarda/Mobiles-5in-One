<?php

use App\Domain\Shops\Documents\DocumentStorage;
use App\Domain\Shops\Models\Shop;
use App\Domain\Shops\Models\ShopDocument;
use App\Domain\Shops\Models\ShopDocumentKind;
use App\Domain\Shops\Models\ShopMemberRole;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Testing\TestResponse;
use Tests\Feature\Api\Auth\Support\AuthTestKit;
use Tests\Feature\Api\Shops\Support\ShopTestKit;

/*
| Security checklist item 7 against the real private disk (MinIO in the compose stack):
| presigned uploads, server-side checks at confirmation, per-shop limits.
*/

uses(RefreshDatabase::class);

beforeEach(function (): void {
    AuthTestKit::boot();
    // The object store of the compose stack is the only real host these tests may call.
    Http::allowStrayRequests([rtrim((string) config('filesystems.disks.private.endpoint'), '/').'/*']);
});

function presignDocument(User $owner, Shop $shop, string $mime, int $size, string $kind = 'vergi_levhasi'): TestResponse
{
    AuthTestKit::forgetGuards();

    return test()->withToken(AuthTestKit::token($owner))
        ->postJson("/api/v1/shops/{$shop->id}/documents/presign", ['kind' => $kind, 'mime' => $mime, 'size' => $size]);
}

function confirmDocument(User $owner, Shop $shop, string $documentId): TestResponse
{
    AuthTestKit::forgetGuards();

    return test()->withToken(AuthTestKit::token($owner))
        ->postJson("/api/v1/shops/{$shop->id}/documents/{$documentId}/confirm");
}

/**
 * PUT the bytes to the presigned URL exactly as a client would.
 *
 * @param  array<string, mixed>  $upload
 */
function uploadTo(array $upload, string $bytes): int
{
    $headers = $upload['headers'];
    $contentType = (string) $headers['Content-Type'];
    unset($headers['Content-Type']);

    return Http::withHeaders($headers)->withBody($bytes, $contentType)->put($upload['url'])->status();
}

/**
 * Presign, upload and confirm in one go.
 */
function uploadDocument(User $owner, Shop $shop, string $mime, string $bytes): TestResponse
{
    $presign = presignDocument($owner, $shop, $mime, strlen($bytes))->assertCreated();
    expect(uploadTo($presign->json('data.upload'), $bytes))->toBe(200);

    return confirmDocument($owner, $shop, (string) $presign->json('data.document.id'));
}

it('presigns, uploads and confirms a PDF, then keeps it only under the document key', function (): void {
    $owner = ShopTestKit::merchant();
    $shop = ShopTestKit::shop($owner);
    $pdf = ShopTestKit::pdf(2);

    $presign = presignDocument($owner, $shop, 'application/pdf', strlen($pdf))
        ->assertCreated()
        ->assertJsonPath('data.document.kind', 'vergi_levhasi')
        ->assertJsonPath('data.document.state', 'pending')
        ->assertJsonPath('data.upload.method', 'PUT')
        ->assertJsonPath('data.upload.headers.Content-Type', 'application/pdf');

    $expires = new DateTimeImmutable((string) $presign->json('data.upload.expires_at'));
    expect($expires->getTimestamp() - time())->toBeGreaterThan(240)->toBeLessThanOrEqual(300)
        ->and((string) $presign->json('data.upload.url'))->toContain('X-Amz-Signature=')->toMatch('/X-Amz-Expires=(2[4-9]\d|300)(&|$)/');

    $documentId = (string) $presign->json('data.document.id');
    $row = ShopDocument::query()->findOrFail($documentId);
    expect($row->uploaded_at)->toBeNull()
        ->and($row->kind)->toBe(ShopDocumentKind::TaxCertificate)
        ->and($row->path)->toBe(DocumentStorage::uploadKey($shop->id, $documentId));

    expect(uploadTo($presign->json('data.upload'), $pdf))->toBe(200);

    $confirm = confirmDocument($owner, $shop, $documentId)
        ->assertOk()
        ->assertJsonPath('data.state', 'uploaded')
        ->assertJsonPath('data.size', strlen($pdf));
    expect((string) $confirm->getContent())->not->toContain('shops/')->not->toContain('http');

    $row = ShopDocument::query()->findOrFail($documentId);
    $disk = app(DocumentStorage::class)->disk();
    expect($row->uploaded_at)->not->toBeNull()
        ->and($row->path)->toBe(DocumentStorage::documentKey($shop->id, $documentId))
        ->and($disk->get($row->path))->toBe($pdf)
        ->and($disk->exists(DocumentStorage::uploadKey($shop->id, $documentId)))->toBeFalse();

    // A repeated PUT through the still valid URL lands on the upload key only.
    expect(uploadTo($presign->json('data.upload'), ShopTestKit::executable().str_repeat("\x00", strlen($pdf) - strlen(ShopTestKit::executable()))))->toBe(200)
        ->and($disk->get($row->path))->toBe($pdf);

    AuthTestKit::assertProblem(confirmDocument($owner, $shop, $documentId), 409, 'conflict');
});

it('accepts JPEG and PNG documents', function (string $mime, Closure $bytes): void {
    $owner = ShopTestKit::merchant();
    $shop = ShopTestKit::shop($owner);

    uploadDocument($owner, $shop, $mime, $bytes())->assertOk()->assertJsonPath('data.mime', $mime);
})->with([
    'jpeg' => ['image/jpeg', fn () => ShopTestKit::jpeg()],
    'png' => ['image/png', fn () => ShopTestKit::png()],
]);

it('rejects content that does not match the declared type and deletes object and row', function (string $mime, Closure $bytes, int $status, string $code): void {
    $owner = ShopTestKit::merchant();
    $shop = ShopTestKit::shop($owner);
    $content = $bytes();

    $presign = presignDocument($owner, $shop, $mime, strlen($content))->assertCreated();
    $documentId = (string) $presign->json('data.document.id');
    expect(uploadTo($presign->json('data.upload'), $content))->toBe(200);

    AuthTestKit::assertProblem(confirmDocument($owner, $shop, $documentId), $status, $code === 'mime_mismatch' ? 'unsupported_media_type' : 'validation.failed', [
        ['field' => 'document', 'code' => $code],
    ]);

    expect(ShopDocument::query()->find($documentId))->toBeNull()
        ->and(app(DocumentStorage::class)->disk()->exists(DocumentStorage::uploadKey($shop->id, $documentId)))->toBeFalse();
})->with([
    'renamed executable as pdf' => ['application/pdf', fn () => ShopTestKit::executable(), 415, 'mime_mismatch'],
    'renamed executable as png' => ['image/png', fn () => ShopTestKit::executable(), 415, 'mime_mismatch'],
    'png declared as jpeg' => ['image/jpeg', fn () => ShopTestKit::png(), 415, 'mime_mismatch'],
    'pdf with javascript' => ['application/pdf', fn () => ShopTestKit::pdf(1, '/OpenAction << /S /JavaScript /JS (app.alert(1)) >>'), 422, 'pdf_active_content'],
    'pdf with a launch action' => ['application/pdf', fn () => ShopTestKit::pdf(1, '/OpenAction << /S /Launch /F (calc.exe) >>'), 422, 'pdf_active_content'],
    'pdf with 11 pages' => ['application/pdf', fn () => ShopTestKit::pdf(11), 422, 'pdf_page_limit'],
]);

it('rejects an upload whose size differs from the declared size', function (): void {
    $owner = ShopTestKit::merchant();
    $shop = ShopTestKit::shop($owner);
    $pdf = ShopTestKit::pdf();

    $presign = presignDocument($owner, $shop, 'application/pdf', strlen($pdf))->assertCreated();
    $documentId = (string) $presign->json('data.document.id');

    // A presigned PUT cannot bind the length, so the store accepts the longer body;
    // confirmation measures the stored object and refuses it.
    expect(uploadTo($presign->json('data.upload'), $pdf.'padding'))->toBe(200);

    AuthTestKit::assertProblem(confirmDocument($owner, $shop, $documentId), 422, 'validation.failed', [
        ['field' => 'document', 'code' => 'size_mismatch'],
    ]);
    expect(ShopDocument::query()->find($documentId))->toBeNull();
});

it('rejects an object above 5 MB at confirmation', function (): void {
    $owner = ShopTestKit::merchant();
    $shop = ShopTestKit::shop($owner);

    $presign = presignDocument($owner, $shop, 'application/pdf', 1000)->assertCreated();
    $documentId = (string) $presign->json('data.document.id');
    app(DocumentStorage::class)->disk()->put(DocumentStorage::uploadKey($shop->id, $documentId), str_repeat('A', 5 * 1024 * 1024 + 1));

    AuthTestKit::assertProblem(confirmDocument($owner, $shop, $documentId), 413, 'payload_too_large', [
        ['field' => 'document', 'code' => 'too_large'],
    ]);
    expect(ShopDocument::query()->find($documentId))->toBeNull()
        ->and(app(DocumentStorage::class)->disk()->exists(DocumentStorage::uploadKey($shop->id, $documentId)))->toBeFalse();
});

it('confirms nothing when the object was never uploaded', function (): void {
    $owner = ShopTestKit::merchant();
    $shop = ShopTestKit::shop($owner);
    $presign = presignDocument($owner, $shop, 'image/png', 100)->assertCreated();
    $documentId = (string) $presign->json('data.document.id');

    AuthTestKit::assertProblem(confirmDocument($owner, $shop, $documentId), 422, 'validation.failed', [
        ['field' => 'document', 'code' => 'missing_object'],
    ]);
    expect(ShopDocument::query()->find($documentId))->toBeNull();
});

it('validates the presign request', function (array $body, string $field, string $code): void {
    $owner = ShopTestKit::merchant();
    $shop = ShopTestKit::shop($owner);

    AuthTestKit::assertProblem(
        $this->withToken(AuthTestKit::token($owner))->postJson("/api/v1/shops/{$shop->id}/documents/presign", array_merge(['kind' => 'vergi_levhasi', 'mime' => 'application/pdf', 'size' => 1000], $body)),
        422,
        'validation.failed',
        [['field' => $field, 'code' => $code]],
    );

    expect(ShopDocument::query()->count())->toBe(0);
})->with([
    'over 5 MB' => [['size' => 5 * 1024 * 1024 + 1], 'size', 'max'],
    'empty' => [['size' => 0], 'size', 'min'],
    'executable mime' => [['mime' => 'application/x-msdownload'], 'mime', 'in'],
    'svg' => [['mime' => 'image/svg+xml'], 'mime', 'in'],
    'unknown kind' => [['kind' => 'kimlik'], 'kind', 'enum'],
]);

it('allows at most three documents per shop', function (): void {
    $owner = ShopTestKit::merchant();
    $shop = ShopTestKit::shop($owner);

    presignDocument($owner, $shop, 'image/png', 100)->assertCreated();
    presignDocument($owner, $shop, 'image/png', 100, 'isletme_belgesi')->assertCreated();
    presignDocument($owner, $shop, 'image/png', 100)->assertCreated();

    AuthTestKit::assertProblem(presignDocument($owner, $shop, 'image/png', 100), 409, 'conflict');
    expect(ShopDocument::query()->where('shop_id', $shop->id)->count())->toBe(3);
});

it('frees the slot of a pending upload whose URL expired', function (): void {
    $owner = ShopTestKit::merchant();
    $shop = ShopTestKit::shop($owner);

    foreach (range(1, 3) as $n) {
        presignDocument($owner, $shop, 'image/png', 100)->assertCreated();
    }

    $this->travel(7)->minutes();

    presignDocument($owner, $shop, 'image/png', 100)->assertCreated();
    expect(ShopDocument::query()->where('shop_id', $shop->id)->count())->toBe(1);
});

it('limits presigns to 10 per shop per day with Retry-After', function (): void {
    $owner = ShopTestKit::merchant();
    $shop = ShopTestKit::shop($owner);

    for ($n = 1; $n <= 10; $n++) {
        // Expire the pending rows so the 3-document limit does not interfere.
        presignDocument($owner, $shop, 'image/png', 100)->assertCreated();
        $this->travel(7)->minutes();
    }

    $limited = presignDocument($owner, $shop, 'image/png', 100);
    AuthTestKit::assertProblem($limited, 429, 'rate_limited');
    expect((int) $limited->headers->get('Retry-After'))->toBeGreaterThan(0);

    // Another shop has its own quota.
    $other = ShopTestKit::shop($owner);
    presignDocument($owner, $other, 'image/png', 100)->assertCreated();
});

it('keeps presign and confirm owner-only without spending the quota of the shop', function (): void {
    $owner = ShopTestKit::merchant();
    $shop = ShopTestKit::shop($owner);
    $staff = ShopTestKit::merchant();
    ShopTestKit::join($shop, $staff, ShopMemberRole::Staff);
    $stranger = ShopTestKit::merchant();
    ShopTestKit::shop($stranger);

    for ($n = 0; $n < 12; $n++) {
        AuthTestKit::assertProblem(presignDocument($stranger, $shop, 'image/png', 100), 404, 'not_found');
    }

    AuthTestKit::assertProblem(presignDocument($staff, $shop, 'image/png', 100), 403, 'forbidden');
    AuthTestKit::assertProblem(presignDocument(ShopTestKit::donor(), $shop, 'image/png', 100), 403, 'forbidden');

    $presign = presignDocument($owner, $shop, 'image/png', strlen(ShopTestKit::png()))->assertCreated();
    $documentId = (string) $presign->json('data.document.id');
    uploadTo($presign->json('data.upload'), ShopTestKit::png());

    AuthTestKit::assertProblem(confirmDocument($stranger, $shop, $documentId), 404, 'not_found');
    AuthTestKit::assertProblem(confirmDocument($staff, $shop, $documentId), 403, 'forbidden');

    // A document id under another shop path looks missing, even to an owner of that shop.
    $strangerShop = Shop::query()->where('owner_id', $stranger->id)->sole();
    AuthTestKit::assertProblem(confirmDocument($stranger, $strangerShop, $documentId), 404, 'not_found');

    expect(ShopDocument::query()->findOrFail($documentId)->uploaded_at)->toBeNull();
    confirmDocument($owner, $shop, $documentId)->assertOk();
});
