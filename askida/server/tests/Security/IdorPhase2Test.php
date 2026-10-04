<?php

use App\Domain\Auth\Models\DevicePushToken;
use App\Domain\Hooks\Models\HookStatus;
use App\Domain\Items\Models\Item;
use App\Domain\Shops\Models\Shop;
use App\Domain\Shops\Models\ShopDocument;
use App\Domain\Shops\Models\ShopMemberRole;
use App\Domain\Shops\Models\ShopVerificationState;
use App\Domain\Shops\Services\DocumentUrlSigner;
use App\Models\User;
use Database\Factories\UserFactory;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Testing\TestResponse;
use Tests\Feature\Api\Auth\Support\AuthTestKit;
use Tests\Feature\Api\Hooks\Support\HookWorld;
use Tests\Feature\Api\Shops\Support\ShopTestKit;
use Tests\Security\IdorHarness;

/*
| Security checklist item 4 for the Phase 2 resources, through the real routes: owner A
| never reaches merchant B's shop, catalog, documents or redemptions (404, like a
| missing id), a code of another shop is opaque, the account endpoints act on the
| token's user only, and no answer carries the other party's ids, e-mail or codes.
*/

uses(RefreshDatabase::class);

beforeEach(function (): void {
    AuthTestKit::boot();
    HookWorld::pepper();
    Http::allowStrayRequests([rtrim((string) config('filesystems.disks.private.endpoint'), '/').'/*']);
    $this->harness = new IdorHarness($this);
});

/**
 * Asserts the response body names none of the given values.
 *
 * @param  list<string|null>  $values
 */
function assertNoLeak(TestResponse $response, array $values): void
{
    $body = (string) $response->getContent();

    foreach (array_filter($values) as $value) {
        expect($body)->not->toContain((string) $value);
    }
}

/**
 * Two merchants, each owning a verified shop with an item and a pending document.
 *
 * @return array{a: User, b: User, shopA: Shop, shopB: Shop, itemA: Item, itemB: Item, docA: ShopDocument}
 */
function twoMerchants(): array
{
    $a = ShopTestKit::merchant();
    $b = ShopTestKit::merchant();
    $shopA = ShopTestKit::shop($a);
    $shopB = ShopTestKit::shop($b);

    return [
        'a' => $a,
        'b' => $b,
        'shopA' => $shopA,
        'shopB' => $shopB,
        'itemA' => ShopTestKit::item($shopA),
        'itemB' => ShopTestKit::item($shopB),
        'docA' => ShopDocument::factory()->for($shopA)->create(['uploaded_at' => null]),
    ];
}

describe('shops of another merchant', function (): void {
    it('answers 404 on every owner and member route of shop A for owner B', function (string $method, string $template, array $payload): void {
        $w = twoMerchants();
        $uri = strtr($template, ['{A}' => $w['shopA']->id, '{itemA}' => $w['itemA']->id, '{docA}' => $w['docA']->id]);
        $payload = array_map(fn (mixed $value): mixed => $value === '{code}' ? HookWorld::newCode() : $value, $payload);

        $response = $this->harness->call($method, $uri, IdorHarness::bearer($w['b']), $payload);

        IdorHarness::assertProblem($response, 404);
        assertNoLeak($response, [$w['shopA']->name, $w['shopA']->slug, $w['a']->email, $w['itemA']->id, $w['docA']->id]);

        // The same request by the owner of A reaches the action.
        $own = $this->harness->call($method, $uri, IdorHarness::bearer($w['a'], 'owner-a'), $payload);
        expect(in_array($own->status(), [401, 403, 404], true))->toBeFalse((string) $own->getContent());
    })->with([
        'update the shop' => ['PATCH', '/api/v1/shops/{A}', ['name' => 'Ele Geçirilmiş Fırın']],
        'list the catalog' => ['GET', '/api/v1/shops/{A}/items', []],
        'add an item' => ['POST', '/api/v1/shops/{A}/items', ['name' => 'Simit', 'category' => 'ekmek', 'price_minor' => 1200, 'daily_cap' => 5]],
        'change an item' => ['PATCH', '/api/v1/shops/{A}/items/{itemA}', ['price_minor' => 100]],
        'presign a document' => ['POST', '/api/v1/shops/{A}/documents/presign', ['kind' => 'vergi_levhasi', 'mime' => 'application/pdf', 'size' => 2048]],
        'confirm a document' => ['POST', '/api/v1/shops/{A}/documents/{docA}/confirm', []],
        'list redemptions' => ['GET', '/api/v1/shops/{A}/redemptions', []],
        'redeem a code' => ['POST', '/api/v1/shops/{A}/redeem', ['code' => '{code}']],
    ]);

    it('answers 404 when B pairs its own shop with an item or a document of A', function (): void {
        $w = twoMerchants();
        $tokenB = IdorHarness::bearer($w['b']);

        $item = $this->harness->call('PATCH', "/api/v1/shops/{$w['shopB']->id}/items/{$w['itemA']->id}", $tokenB, ['price_minor' => 100]);
        $doc = $this->harness->call('POST', "/api/v1/shops/{$w['shopB']->id}/documents/{$w['docA']->id}/confirm", $tokenB);

        IdorHarness::assertProblem($item, 404);
        IdorHarness::assertProblem($doc, 404);
        assertNoLeak($item, [$w['itemA']->id, $w['shopA']->name]);
        assertNoLeak($doc, [$w['docA']->id, $w['docA']->path]);

        expect($w['itemA']->fresh()?->price_minor)->toBe(1500)
            ->and(ShopDocument::query()->whereKey($w['docA']->id)->exists())->toBeTrue();
    });

    it('lets the staff of B see nothing of A and keeps A unchanged', function (): void {
        $w = twoMerchants();
        $staffB = ShopTestKit::merchant();
        ShopTestKit::join($w['shopB'], $staffB, ShopMemberRole::Staff);
        $token = IdorHarness::bearer($staffB);

        IdorHarness::assertProblem($this->harness->call('GET', "/api/v1/shops/{$w['shopA']->id}/items", $token), 404);
        IdorHarness::assertProblem($this->harness->call('GET', "/api/v1/shops/{$w['shopA']->id}/redemptions", $token), 404);
        IdorHarness::assertProblem($this->harness->call('PATCH', "/api/v1/shops/{$w['shopB']->id}", $token, ['name' => 'Personel Değişikliği']), 403);
    });
});

describe('codes and reservations', function (): void {
    it('answers a code of shop A at shop B with the opaque invalid code problem', function (): void {
        $w = twoMerchants();
        $device = HookWorld::anon();
        [$hook] = HookWorld::availableHooks($w['itemA'], 1);
        $code = HookWorld::newCode();
        HookWorld::reserve($hook, $device, $code);

        $response = $this->harness->call('POST', "/api/v1/shops/{$w['shopB']->id}/redeem", IdorHarness::bearer($w['b']), ['code' => $code]);

        $response->assertStatus(422)->assertJsonPath('code', 'hook.code_invalid');
        assertNoLeak($response, [$code, $hook->id, $w['shopA']->id, $w['shopA']->name, $w['itemA']->id, $device->anon_id]);
        expect($hook->fresh()?->status)->toBe(HookStatus::Reserved);

        // Unknown code at the same shop: identical answer apart from the request id.
        $unknown = $this->harness->call('POST', "/api/v1/shops/{$w['shopB']->id}/redeem", IdorHarness::bearer($w['b'], 'second'), ['code' => HookWorld::newCode()]);
        expect(array_diff_key((array) $unknown->json(), ['request_id' => 1]))->toBe(array_diff_key((array) $response->json(), ['request_id' => 1]));
    });

    it('refuses to reserve at a shop that is no longer verified, like a missing shop', function (ShopVerificationState $state): void {
        $owner = ShopTestKit::merchant();
        $shop = ShopTestKit::shop($owner, $state);
        $item = ShopTestKit::item($shop);
        HookWorld::availableHooks($item, 2);
        $token = HookWorld::anonToken(HookWorld::anon());

        $response = $this->harness->call('POST', '/api/v1/hooks/reserve', $token, ['shop_id' => $shop->id, 'item_id' => $item->id]);

        IdorHarness::assertProblem($response, 404);
        assertNoLeak($response, [$shop->name, $owner->email, $item->name]);
    })->with([
        'rejected' => [ShopVerificationState::Rejected],
        'pending' => [ShopVerificationState::Pending],
    ]);
});

describe('documents', function (): void {
    it('signs no URL for an API caller, the owner included, and treats a foreign id as missing', function (): void {
        $w = twoMerchants();
        $w['docA']->forceFill(['uploaded_at' => now()])->save();
        $signer = app(DocumentUrlSigner::class);

        foreach ([AuthTestKit::token($w['a']), AuthTestKit::token($w['b'])] as $plain) {
            $user = User::query()->findOrFail(Laravel\Sanctum\PersonalAccessToken::findToken($plain)?->tokenable_id);
            $user->withAccessToken(Laravel\Sanctum\PersonalAccessToken::findToken($plain));

            try {
                $signer->temporaryUrl($w['docA'], $user);
                $this->fail('A URL was signed for an API caller.');
            } catch (AuthorizationException $e) {
                expect($e->status())->toBe(404);
            }
        }
    });
});

describe('account endpoints', function (): void {
    it('registers a push token for the token user only and keeps the other user\'s tokens', function (): void {
        $a = ShopTestKit::donor();
        $b = ShopTestKit::donor();
        $tokenOfA = 'device-'.bin2hex(random_bytes(16));
        (new DevicePushToken)->forceFill(['user_id' => $a->id, 'platform' => 'android', 'token' => $tokenOfA])->save();

        $response = $this->harness->call('PUT', '/api/v1/me/push-token', IdorHarness::bearer($b), [
            'platform' => 'ios', 'token' => 'device-'.bin2hex(random_bytes(16)), 'user_id' => $a->id,
        ]);

        $response->assertNoContent();
        expect((string) $response->getContent())->toBe('')
            ->and(DevicePushToken::query()->where('user_id', $a->id)->pluck('token')->all())->toBe([$tokenOfA])
            ->and(DevicePushToken::query()->where('user_id', $b->id)->count())->toBe(1);
    });

    it('deletes the token user\'s account only, whatever ids the body names', function (): void {
        $a = ShopTestKit::donor();
        $b = ShopTestKit::donor();

        $response = $this->harness->call('DELETE', '/api/v1/me', IdorHarness::bearer($a), [
            'password' => UserFactory::PASSWORD, 'user_id' => $b->id, 'email' => $b->email,
        ]);

        $response->assertStatus(202);
        assertNoLeak($response, [$b->id, $b->email]);
        expect($a->fresh()?->deactivated_at)->not->toBeNull()
            ->and($b->fresh()?->deactivated_at)->toBeNull();

        // B's own token still works; A's was revoked.
        $this->harness->call('GET', '/api/v1/me', IdorHarness::bearer($b, 'b-device'))->assertOk()->assertJsonPath('data.id', $b->id);
    });

    it('shows the token user on me and nothing of another account', function (): void {
        $a = ShopTestKit::merchant();
        $b = ShopTestKit::merchant();
        ShopTestKit::shop($b);

        $response = $this->harness->call('GET', '/api/v1/me', IdorHarness::bearer($a))->assertOk();

        expect($response->json('data.id'))->toBe($a->id);
        assertNoLeak($response, [$b->id, $b->email, $b->name]);
    });
});

describe('impact', function (): void {
    it('is public and carries no ids, e-mails or shop names', function (): void {
        $w = twoMerchants();

        $response = $this->harness->call('GET', '/api/v1/impact?il=İstanbul', null)->assertOk();

        expect((string) $response->getContent())->not->toMatch('/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/');
        assertNoLeak($response, [$w['a']->email, $w['b']->email, $w['shopA']->name, $w['shopB']->name]);
    });
});
