<?php

use App\Domain\Anon\Models\AnonDailyCounter;
use App\Domain\Anon\Models\AnonDevice;
use App\Domain\Anon\Models\DevicePlatform;
use App\Domain\Auth\Models\DeletionChannel;
use App\Domain\Auth\Models\DeletionRequest;
use App\Domain\Auth\Models\DeletionRequestStatus;
use App\Domain\Auth\Models\DevicePushToken;
use App\Domain\Auth\Models\KvkkConsent;
use App\Domain\Donations\Models\Donation;
use App\Domain\Donations\Models\DonationStatus;
use App\Domain\Hooks\Models\Hook;
use App\Domain\Hooks\Models\HookStatus;
use App\Domain\Impact\Models\ImpactSnapshot;
use App\Domain\Items\Models\Item;
use App\Domain\Items\Models\ItemCategory;
use App\Domain\Payments\Models\PaymentEvent;
use App\Domain\Payments\Models\Payout;
use App\Domain\Payments\Models\PayoutStatus;
use App\Domain\Shops\Models\Shop;
use App\Domain\Shops\Models\ShopDocument;
use App\Domain\Shops\Models\ShopDocumentKind;
use App\Domain\Shops\Models\ShopMember;
use App\Domain\Shops\Models\ShopMemberRole;
use App\Domain\Shops\Models\ShopVerificationState;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

uses(RefreshDatabase::class);

dataset('domain models', [
    'Shop' => [Shop::class],
    'ShopMember' => [ShopMember::class],
    'ShopDocument' => [ShopDocument::class],
    'Item' => [Item::class],
    'Donation' => [Donation::class],
    'Hook' => [Hook::class],
    'AnonDevice' => [AnonDevice::class],
    'AnonDailyCounter' => [AnonDailyCounter::class],
    'PaymentEvent' => [PaymentEvent::class],
    'Payout' => [Payout::class],
    'ImpactSnapshot' => [ImpactSnapshot::class],
    'KvkkConsent' => [KvkkConsent::class],
    'DeletionRequest' => [DeletionRequest::class],
    'DevicePushToken' => [DevicePushToken::class],
]);

it('builds a valid persisted row from every factory', function (string $class) {
    /** @var class-string<Model> $class */
    $model = $class::factory()->create();

    expect($model->exists)->toBeTrue()
        ->and(DB::table($model->getTable())->where('id', $model->getKey())->exists())->toBeTrue();
})->with('domain models');

it('assigns version 7 uuid primary keys', function (string $class) {
    /** @var class-string<Model> $class */
    $first = $class::factory()->create();
    $second = $class::factory()->create();

    expect(Str::isUuid($first->getKey(), 7))->toBeTrue()
        ->and(Str::isUuid($second->getKey(), 7))->toBeTrue()
        ->and(substr((string) $first->getKey(), 14, 1))->toBe('7')
        // Time-ordered: a later row sorts after an earlier one.
        ->and(strcmp((string) $second->getKey(), (string) $first->getKey()))->toBeGreaterThan(0);
})->with('domain models');

it('stores tax number and IBAN encrypted and hides them from serialization', function () {
    $taxNumber = '99'.str_repeat('1', 8);
    $iban = 'TR00'.str_repeat('0', 21).'7';

    $shop = Shop::factory()->create(['tax_number_enc' => $taxNumber, 'iban_enc' => $iban]);

    $raw = DB::table('shops')->where('id', $shop->id)->first();

    expect($raw->tax_number_enc)->not->toContain($taxNumber)
        ->and($raw->iban_enc)->not->toContain($iban)
        ->and($raw->tax_number_enc)->not->toBe($raw->iban_enc);

    $fresh = Shop::query()->findOrFail($shop->id);

    expect($fresh->tax_number_enc)->toBe($taxNumber)
        ->and($fresh->iban_enc)->toBe($iban)
        ->and($fresh->toArray())->not->toHaveKeys(['tax_number_enc', 'iban_enc', 'sub_merchant_key']);
});

it('hides recipient-linked and secret-derived columns from serialization', function () {
    expect(Hook::factory()->reserved()->create()->toArray())->not->toHaveKeys(['anon_id', 'code_hash'])
        ->and(Donation::factory()->create(['provider_token' => 'checkout-'.Str::lower(Str::random(8))])->toArray())->not->toHaveKey('provider_token')
        ->and(DevicePushToken::factory()->create()->toArray())->not->toHaveKey('token')
        ->and(KvkkConsent::factory()->create()->toArray())->not->toHaveKey('ip_hash')
        ->and(ShopDocument::factory()->create()->toArray())->not->toHaveKey('path');
});

it('casts status and kind columns to backed enums', function () {
    expect(Shop::factory()->verified()->create()->fresh()?->verification_state)->toBe(ShopVerificationState::Verified)
        ->and(ShopMember::factory()->owner()->create()->fresh()?->role)->toBe(ShopMemberRole::Owner)
        ->and(ShopDocument::factory()->create()->fresh()?->kind)->toBe(ShopDocumentKind::TaxCertificate)
        ->and(Item::factory()->create(['category' => ItemCategory::Corba])->fresh()?->category)->toBe(ItemCategory::Corba)
        ->and(Donation::factory()->paid()->create()->fresh()?->status)->toBe(DonationStatus::Paid)
        ->and(Hook::factory()->reserved()->create()->fresh()?->status)->toBe(HookStatus::Reserved)
        ->and(Payout::factory()->create()->fresh()?->status)->toBe(PayoutStatus::Pending)
        ->and(AnonDevice::factory()->create()->fresh()?->platform)->toBeInstanceOf(DevicePlatform::class)
        ->and(DeletionRequest::factory()->create()->fresh()?->channel)->toBe(DeletionChannel::App)
        ->and(DeletionRequest::factory()->create()->fresh()?->status)->toBe(DeletionRequestStatus::Pending);
});

it('fills database defaults on new models', function () {
    $shop = Shop::factory()->make();
    $fresh = new Shop;

    expect($fresh->verification_state)->toBe(ShopVerificationState::Pending)
        ->and($fresh->is_sample)->toBeFalse()
        ->and($fresh->listed_on_web)->toBeFalse()
        ->and((new Hook)->status)->toBe(HookStatus::Available)
        ->and((new Donation)->status)->toBe(DonationStatus::Initiated)
        ->and((new Item)->currency)->toBe('TRY')
        ->and($shop->is_sample)->toBeTrue();
});

it('keeps server-controlled columns out of mass assignment', function () {
    $shop = new Shop([
        'name' => 'x',
        'verification_state' => 'verified',
        'is_sample' => true,
        'listed_on_web' => true,
        'owner_id' => (string) Str::uuid7(),
        'sub_merchant_key' => 'sub-merchant',
    ]);

    expect($shop->getAttributes())->toHaveKey('name')
        ->not->toHaveKeys(['owner_id', 'sub_merchant_key'])
        ->and($shop->verification_state)->toBe(ShopVerificationState::Pending)
        ->and($shop->is_sample)->toBeFalse()
        ->and($shop->listed_on_web)->toBeFalse();

    $donation = new Donation(['qty' => 2, 'amount_minor' => 1, 'donor_id' => (string) Str::uuid7(), 'status' => 'paid']);

    expect($donation->getAttributes())->toHaveKey('qty')
        ->not->toHaveKeys(['amount_minor', 'donor_id'])
        ->and($donation->status)->toBe(DonationStatus::Initiated);

    expect((new Hook)->getFillable())->toBe([]);
});

it('wires the relationships', function () {
    $hook = Hook::factory()->reserved()->create();
    $shop = $hook->shop;

    expect($shop)->toBeInstanceOf(Shop::class)
        ->and($hook->donation?->is($hook->donation))->toBeTrue()
        ->and($hook->item?->shop_id)->toBe($shop?->id)
        ->and($hook->anonDevice?->anon_id)->toBe($hook->anon_id)
        ->and($shop?->hooks()->count())->toBe(1)
        ->and($shop?->items()->count())->toBe(1)
        ->and($shop?->donations()->count())->toBe(1)
        ->and($shop?->owner)->not->toBeNull()
        ->and($hook->donation?->donor)->not->toBeNull()
        ->and($hook->anonDevice?->hooks()->count())->toBe(1);

    $counter = AnonDailyCounter::factory()->create(['per_shop' => [(string) $shop?->id => 1], 'count' => 1]);

    expect($counter->device)->toBeInstanceOf(AnonDevice::class)
        ->and($counter->fresh()?->per_shop)->toBe([(string) $shop?->id => 1])
        ->and($counter->device?->dailyCounters()->count())->toBe(1);
});
