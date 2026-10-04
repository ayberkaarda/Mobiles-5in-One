<?php

use App\Domain\Auth\Abilities\AdminRole;
use App\Domain\Shops\Documents\DocumentStorage;
use App\Domain\Shops\Models\Shop;
use App\Domain\Shops\Models\ShopDocument;
use App\Domain\Shops\Models\ShopDocumentKind;
use App\Domain\Shops\Services\DocumentUrlSigner;
use App\Models\User;
use App\Support\Problem\ProblemException;
use Database\Seeders\RolesSeeder;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Spatie\Activitylog\Models\Activity;
use Tests\Feature\Api\Shops\Support\ShopTestKit;

/*
| The only read path to a document: a 5-minute presigned GET for admin panel users with
| the document permission. The object store (real MinIO) refuses anything unsigned.
*/

uses(RefreshDatabase::class);

beforeEach(fn () => (new RolesSeeder)->run());

function storedDocument(Shop $shop, string $bytes, bool $uploaded = true): ShopDocument
{
    $id = (string) Str::uuid7();
    $path = $uploaded ? DocumentStorage::documentKey($shop->id, $id) : DocumentStorage::uploadKey($shop->id, $id);
    app(DocumentStorage::class)->disk()->put($path, $bytes);

    $document = new ShopDocument(['kind' => ShopDocumentKind::TaxCertificate]);
    $document->forceFill([
        'id' => $id,
        'shop_id' => $shop->id,
        'path' => $path,
        'mime' => 'application/pdf',
        'size' => strlen($bytes),
        'uploaded_at' => $uploaded ? now() : null,
    ])->save();

    return $document;
}

function documentViewer(AdminRole $role): User
{
    $user = User::factory()->create();
    $user->assignRole($role->value);

    return $user;
}

it('issues a 5-minute signed URL to admins and moderators that the store honours', function (AdminRole $role): void {
    $pdf = ShopTestKit::pdf();
    $document = storedDocument(ShopTestKit::shop(), $pdf);
    $viewer = documentViewer($role);

    $url = app(DocumentUrlSigner::class)->temporaryUrl($document, $viewer);

    expect($url)->toContain('X-Amz-Signature=')->toMatch('/X-Amz-Expires=(2[4-9]\d|300)(&|$)/');

    $response = Http::get($url);
    expect($response->status())->toBe(200)
        ->and($response->body())->toBe($pdf)
        ->and($response->header('Content-Disposition'))->toStartWith('attachment');

    $entry = Activity::query()->where('event', 'document.url_issued')->sole();
    expect($entry->subject_id)->toBe($document->id)
        ->and($entry->causer_id)->toBe($viewer->id)
        ->and($entry->properties->all())->toBe(['shop_id' => $document->shop_id]);
})->with([AdminRole::Admin, AdminRole::Moderator]);

it('is refused by the store without a signature, with a tampered signature and after expiry', function (): void {
    $document = storedDocument(ShopTestKit::shop(), ShopTestKit::pdf());
    $url = app(DocumentUrlSigner::class)->temporaryUrl($document, documentViewer(AdminRole::Admin));

    $unsigned = strtok($url, '?');
    expect(Http::get((string) $unsigned)->status())->toBe(403);

    $tampered = (string) preg_replace_callback(
        '/X-Amz-Signature=([0-9a-f])/',
        static fn (array $m): string => 'X-Amz-Signature='.($m[1] === 'a' ? 'b' : 'a'),
        $url,
    );
    expect($tampered)->not->toBe($url)
        ->and(Http::get($tampered)->status())->toBe(403);

    $otherObject = str_replace($document->id, (string) Str::uuid7(), $url);
    expect(Http::get($otherObject)->status())->toBe(403);

    // Signed six minutes ago with a five-minute lifetime: expired.
    $this->travel(-6)->minutes();
    $expired = app(DocumentUrlSigner::class)->temporaryUrl($document, documentViewer(AdminRole::Admin));
    $this->travelBack();
    $status = Http::get($expired)->status();
    expect($status)->toBeGreaterThanOrEqual(400)->toBeLessThan(500);
});

it('refuses every other principal', function (Closure $actor, string $exception): void {
    $document = storedDocument(ShopTestKit::shop(), ShopTestKit::pdf());

    expect(fn () => app(DocumentUrlSigner::class)->temporaryUrl($document, $actor()))->toThrow($exception);
    expect(Activity::query()->count())->toBe(0);
})->with([
    'finance' => [fn () => documentViewer(AdminRole::Finance), AuthorizationException::class],
    'shop owner' => [fn () => User::query()->findOrFail(Shop::query()->firstOrFail()->owner_id), AuthorizationException::class],
    'donor' => [fn () => ShopTestKit::donor(), AuthorizationException::class],
    'admin through an api token' => [function (): User {
        $admin = documentViewer(AdminRole::Admin);

        return $admin->withAccessToken($admin->createToken('device', [$admin->kind->ability()])->accessToken);
    }, AuthorizationException::class],
]);

it('issues nothing for a pending upload', function (): void {
    $document = storedDocument(ShopTestKit::shop(), ShopTestKit::pdf(), uploaded: false);

    expect(fn () => app(DocumentUrlSigner::class)->temporaryUrl($document, documentViewer(AdminRole::Admin)))
        ->toThrow(ProblemException::class);
});
