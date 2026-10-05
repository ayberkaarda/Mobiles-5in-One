<?php

namespace Tests\Security\Xss;

use App\Domain\Items\Models\Item;
use App\Domain\Shops\Models\Shop;
use App\Domain\Shops\Models\ShopVerificationState;
use App\Models\User;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Assert;
use Tests\Datasets\XssPayloads;
use Tests\Feature\Api\Auth\Support\AuthTestKit;
use Tests\Feature\Api\Hooks\Support\HookWorld;
use Tests\Feature\Api\Shops\Support\ShopTestKit;

/**
 * Writes payloads through the real write paths (POST shops, POST items, PATCH me) of the
 * HTTP API as an authenticated merchant or donor, then reads the stored rows back. The
 * only direct writes are the verification and listing state, which are staff decisions
 * and never client-writable.
 */
final class XssWorld
{
    public const NAME_MAX = 120;

    public const ADDRESS_MAX = 255;

    public const AREA_MAX = 64;

    public const ME_NAME_MAX = 100;

    /**
     * A shop registered through POST /api/v1/shops with the payload in name, address, il
     * and ilce, an item added through POST /api/v1/shops/{id}/items with the payload in its
     * name and units hanging on it, then verified and listed.
     *
     * @return array{shop: Shop, item: Item, owner: User, token: string}
     */
    public static function listedShop(object $test, string $payload, ShopVerificationState $state = ShopVerificationState::Verified): array
    {
        $owner = ShopTestKit::merchant();
        $token = AuthTestKit::token($owner);

        $created = $test->withToken($token)->postJson('/api/v1/shops', ShopTestKit::payload([
            'name' => XssPayloads::fit($payload, self::NAME_MAX),
            'address' => XssPayloads::fit($payload, self::ADDRESS_MAX, 'Sokak'),
            'il' => XssPayloads::fit($payload, self::AREA_MAX, 'İl'),
            'ilce' => XssPayloads::fit($payload, self::AREA_MAX, 'İlçe'),
            'listed_on_web' => true,
        ]));
        $created->assertCreated();

        $shop = Shop::query()->findOrFail($created->json('data.id'));
        $shop->forceFill([
            'verification_state' => $state,
            'verified_at' => $state === ShopVerificationState::Verified ? now() : null,
        ])->save();

        $addedItem = $test->withToken($token)->postJson("/api/v1/shops/{$shop->id}/items", [
            'name' => XssPayloads::fit($payload, self::NAME_MAX, 'Ürün'),
            'category' => 'ekmek',
            'price_minor' => 1500,
            'daily_cap' => 20,
        ]);
        $addedItem->assertCreated();

        $item = Item::query()->findOrFail($addedItem->json('data.id'));
        HookWorld::availableHooks($item, 2);

        return ['shop' => $shop->refresh(), 'item' => $item, 'owner' => $owner, 'token' => $token];
    }

    /**
     * A listed shop with benign texts and a chosen slug, for structure baselines.
     *
     * @return array{shop: Shop, item: Item, owner: User, token: string}
     */
    public static function benignShop(object $test): array
    {
        return self::listedShop($test, 'Güvenli metin');
    }

    /**
     * The response of a surface, asserted 200 with the expected content type prefix.
     */
    public static function ok(TestResponse $response, string $contentType): string
    {
        $response->assertOk();
        Assert::assertStringStartsWith($contentType, (string) $response->headers->get('Content-Type'));

        return (string) $response->getContent();
    }
}
