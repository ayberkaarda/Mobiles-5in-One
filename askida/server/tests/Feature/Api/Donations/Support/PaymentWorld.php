<?php

namespace Tests\Feature\Api\Donations\Support;

use App\Domain\Donations\Models\Donation;
use App\Domain\Donations\Models\DonationStatus;
use App\Domain\Items\Models\Item;
use App\Domain\Payments\Gateways\FakeGateway;
use App\Domain\Shops\Models\Shop;
use App\Models\User;
use Illuminate\Support\Str;
use Tests\Feature\Api\Hooks\Support\HookWorld;

/**
 * Fixtures for the donation, pay page and settlement tests. Built on HookWorld (shops
 * and items without their factories); provider keys and tokens are made at run time.
 */
final class PaymentWorld
{
    public static function useFakeGateway(): FakeGateway
    {
        config(['payments.provider' => 'fake', 'app.url' => 'https://askida.test']);

        return app(FakeGateway::class);
    }

    public static function payableShop(): Shop
    {
        $shop = HookWorld::shop();
        $shop->forceFill(['sub_merchant_key' => 'test-sm-'.Str::lower(Str::random(12))])->save();

        return $shop;
    }

    public static function item(Shop $shop, int $priceMinor = 1_500, bool $active = true): Item
    {
        $item = HookWorld::item($shop, active: $active);
        $item->forceFill(['price_minor' => $priceMinor])->save();

        return $item;
    }

    public static function donor(): User
    {
        return HookWorld::donor();
    }

    public static function token(User $user): string
    {
        return HookWorld::userToken($user, 'payments-test-device');
    }

    /**
     * An initiated donation with a provider token and conversation id, as POST donations
     * leaves it (the checkout itself is opened by the caller when needed).
     */
    public static function initiated(Item $item, ?User $donor = null, int $qty = 2): Donation
    {
        $donation = HookWorld::donation($item, $donor, $qty, paid: false);
        $conversation = (string) Str::uuid7();
        $donation->forceFill([
            'conversation_id' => $conversation,
            'provider_token' => FakeGateway::tokenFor($conversation),
            'commission_minor' => intdiv($donation->amount_minor * 500, 10_000),
            'status' => DonationStatus::Initiated,
        ])->save();

        return $donation->refresh();
    }

    /**
     * A run-time secret for webhook signing and the gateway keys.
     */
    public static function providerKeys(): void
    {
        config([
            'services.iyzico.base_url' => 'https://sandbox-api.iyzipay.test',
            'services.iyzico.api_key' => 'test-api-'.bin2hex(random_bytes(8)),
            'services.iyzico.secret_key' => 'test-sec-'.bin2hex(random_bytes(8)),
        ]);
    }
}
