<?php

use App\Domain\Shops\Documents\DocumentRules;
use App\Domain\Shops\Documents\DocumentStorage;
use App\Domain\Shops\Models\Shop;
use App\Domain\Shops\Models\ShopDocument;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Testing\TestResponse;
use Tests\Feature\Api\Auth\Support\AuthTestKit;
use Tests\Feature\Api\Shops\Support\ShopTestKit;
use Tests\Security\Attack\AttackKit;

/*
| Upload abuse against the document pipeline (threat 4.7 tampering row, security item 7),
| with the real private bucket. Oversized request bodies are refused by the application
| (413), an oversized or disguised object is refused at confirmation and removed from the
| bucket and the table, scripted PDFs are refused however the name is hidden, and the
| per-shop count and daily presign quota hold, also when the shop id changes letter case.
*/

uses(RefreshDatabase::class);

beforeEach(function (): void {
    AuthTestKit::boot();
    Http::allowStrayRequests([rtrim((string) config('filesystems.disks.private.endpoint'), '/').'/*']);
    $this->owner = ShopTestKit::merchant();
    $this->shop = ShopTestKit::shop($this->owner);
    $this->token = AuthTestKit::token($this->owner);
});

function attack14Presign(string $token, string $shopPath, string $mime, int $size): TestResponse
{
    return AttackKit::json('POST', "/api/v1/shops/{$shopPath}/documents/presign", $token, ['kind' => 'vergi_levhasi', 'mime' => $mime, 'size' => $size]);
}

/**
 * Presigns with the declared type and size, PUTs the given bytes and confirms.
 */
function attack14Upload(string $token, Shop $shop, string $declaredMime, int $declaredSize, string $bytes): TestResponse
{
    $presign = attack14Presign($token, $shop->id, $declaredMime, $declaredSize)->assertCreated();
    $upload = $presign->json('data.upload');
    $headers = $upload['headers'];
    unset($headers['Content-Type']);

    expect(Http::withHeaders($headers)->withBody($bytes, $declaredMime)->put($upload['url'])->status())->toBe(200);

    return AttackKit::json('POST', "/api/v1/shops/{$shop->id}/documents/{$presign->json('data.document.id')}/confirm", $token);
}

function attack14AssertNothingKept(Shop $shop): void
{
    expect(ShopDocument::query()->where('shop_id', $shop->id)->count())->toBe(0)
        ->and(app(DocumentStorage::class)->disk()->allFiles('shops/'.$shop->id))->toBe([]);
}

it('refuses request bodies above 6 MB on the document routes and above 1 MB elsewhere', function (): void {
    $documents = AttackKit::raw('POST', "/api/v1/shops/{$this->shop->id}/documents/presign", str_repeat('a', 6 * 1024 * 1024 + 1), ['Authorization' => 'Bearer '.$this->token]);
    AttackKit::assertProblem($documents, 413, 'payload_too_large');

    $other = AttackKit::raw('PATCH', '/api/v1/me', '{"name":"'.str_repeat('a', 1024 * 1024).'"}', ['Authorization' => 'Bearer '.$this->token]);
    AttackKit::assertProblem($other, 413, 'payload_too_large');

    expect(ShopDocument::query()->count())->toBe(0)
        ->and($this->owner->fresh()?->name)->not->toStartWith('aaaa');
});

it('refuses a declared size above 5 MB before any URL is issued', function (): void {
    $response = attack14Presign($this->token, $this->shop->id, 'application/pdf', DocumentRules::MAX_BYTES + 1);

    AttackKit::assertProblem($response, 422, 'validation.failed');
    expect(AttackKit::errorPairs($response))->toBe(['size:max'])
        ->and(ShopDocument::query()->count())->toBe(0);
});

it('removes a 6 MB object sent to a URL presigned for 5 MB', function (): void {
    $bytes = ShopTestKit::pdf();
    $bytes .= str_repeat('%', 6 * 1024 * 1024 - strlen($bytes));

    $response = attack14Upload($this->token, $this->shop, 'application/pdf', DocumentRules::MAX_BYTES, $bytes);

    AttackKit::assertProblem($response, 413, 'payload_too_large');
    expect(AttackKit::errorPairs($response))->toBe(['document:too_large']);
    attack14AssertNothingKept($this->shop);
});

it('refuses disguised and scripted files at confirmation and keeps nothing', function (string $mime, Closure $bytes, int $status, string $code, string $reason): void {
    $content = $bytes();

    $response = attack14Upload($this->token, $this->shop, $mime, strlen($content), $content);

    AttackKit::assertProblem($response, $status, $code);
    expect(AttackKit::errorPairs($response))->toBe(['document:'.$reason]);
    attack14AssertNothingKept($this->shop);
})->with([
    'executable renamed to pdf' => ['application/pdf', fn (): string => ShopTestKit::executable(), 415, 'unsupported_media_type', 'mime_mismatch'],
    'executable with a pdf header' => ['application/pdf', fn (): string => '%PDF-1.4'."\n".ShopTestKit::executable(), 422, 'validation.failed', 'pdf_malformed'],
    'pdf declared as png' => ['image/png', fn (): string => ShopTestKit::pdf(), 415, 'unsupported_media_type', 'mime_mismatch'],
    'png declared as pdf' => ['application/pdf', fn (): string => ShopTestKit::png(), 415, 'unsupported_media_type', 'mime_mismatch'],
    'pdf with javascript' => ['application/pdf', fn (): string => ShopTestKit::pdf(1, '/OpenAction << /S /JavaScript /JS (app.alert(1)) >>'), 422, 'validation.failed', 'pdf_active_content'],
    'javascript name hex-escaped' => ['application/pdf', fn (): string => ShopTestKit::pdf(1, '/OpenAction << /S /J#61vaScript /J#53 (app.alert(1)) >>'), 422, 'validation.failed', 'pdf_active_content'],
    'javascript in a compressed stream' => ['application/pdf', function (): string {
        $hidden = (string) gzcompress('<< /S /JavaScript /JS (app.alert(1)) >>');

        return ShopTestKit::pdf(1, '', '<< /Length '.strlen($hidden).' /Filter /FlateDecode >>'."\nstream\n".$hidden."\nendstream");
    }, 422, 'validation.failed', 'pdf_active_content'],
    'launch action' => ['application/pdf', fn (): string => ShopTestKit::pdf(1, '/OpenAction << /S /Launch /F (cmd.exe) >>'), 422, 'validation.failed', 'pdf_active_content'],
]);

it('negative control: a clean PDF is confirmed and kept under the document key only', function (): void {
    $pdf = ShopTestKit::pdf();

    attack14Upload($this->token, $this->shop, 'application/pdf', strlen($pdf), $pdf)->assertOk();

    $document = ShopDocument::query()->where('shop_id', $this->shop->id)->sole();
    expect($document->uploaded_at)->not->toBeNull()
        ->and(app(DocumentStorage::class)->disk()->allFiles('shops/'.$this->shop->id))->toBe([$document->path]);
});

it('refuses a 4th document of a shop', function (): void {
    for ($i = 0; $i < DocumentRules::MAX_DOCUMENTS_PER_SHOP; $i++) {
        attack14Presign($this->token, $this->shop->id, 'application/pdf', 2048)->assertCreated();
    }

    AttackKit::assertProblem(attack14Presign($this->token, $this->shop->id, 'application/pdf', 2048), 409, 'conflict');
    expect(ShopDocument::query()->where('shop_id', $this->shop->id)->count())->toBe(DocumentRules::MAX_DOCUMENTS_PER_SHOP);
});

it('stops the 11th presign of the day, also through an upper-case shop id', function (): void {
    for ($i = 0; $i < DocumentRules::PRESIGNS_PER_SHOP_PER_DAY; $i++) {
        $status = attack14Presign($this->token, $this->shop->id, 'application/pdf', 2048)->status();
        expect($status)->toBeIn([201, 409]);
    }

    $upper = strtoupper($this->shop->id);
    expect($upper)->not->toBe($this->shop->id);

    AttackKit::assertProblem(attack14Presign($this->token, $this->shop->id, 'application/pdf', 2048), 429, 'rate_limited');
    AttackKit::assertProblem(attack14Presign($this->token, $upper, 'application/pdf', 2048), 429, 'rate_limited');

    // Negative control: another shop of the same owner has its own quota.
    $second = ShopTestKit::shop($this->owner);
    attack14Presign($this->token, $second->id, 'application/pdf', 2048)->assertCreated();
});

it('does not let another merchant use up a shop\'s presign quota', function (): void {
    $intruder = AuthTestKit::token(ShopTestKit::merchant());

    for ($i = 0; $i < DocumentRules::PRESIGNS_PER_SHOP_PER_DAY + 2; $i++) {
        AttackKit::assertProblem(attack14Presign($intruder, $this->shop->id, 'application/pdf', 2048), 404, 'not_found');
    }

    // Negative control: the owner still has the full quota.
    attack14Presign($this->token, $this->shop->id, 'application/pdf', 2048)->assertCreated();
    expect(ShopDocument::query()->where('shop_id', $this->shop->id)->count())->toBe(1);
});
