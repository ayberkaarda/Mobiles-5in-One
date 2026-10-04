<?php

use App\Domain\Anon\Models\DevicePlatform;
use App\Domain\Auth\Models\DeletionChannel;
use App\Domain\Auth\Models\DeletionRequestStatus;
use App\Domain\Donations\Models\DonationStatus;
use App\Domain\Hooks\Models\HookStatus;
use App\Domain\Items\Models\ItemCategory;
use App\Domain\Payments\Models\PayoutStatus;
use App\Domain\Shops\Models\ShopDocumentKind;
use App\Domain\Shops\Models\ShopMemberRole;
use App\Domain\Shops\Models\ShopVerificationState;

/**
 * The enum values must stay identical to the CHECK constraints of the migrations.
 */
it('mirrors the database value lists', function (string $enum, array $values) {
    /** @var class-string<BackedEnum> $enum */
    expect(array_map(fn (BackedEnum $case) => $case->value, $enum::cases()))->toBe($values);
})->with([
    'ShopVerificationState' => [ShopVerificationState::class, ['pending', 'verified', 'rejected']],
    'ShopMemberRole' => [ShopMemberRole::class, ['owner', 'staff']],
    'ShopDocumentKind' => [ShopDocumentKind::class, ['tax_certificate', 'business_license', 'other']],
    'ItemCategory' => [ItemCategory::class, ['ekmek', 'corba', 'yemek', 'kirtasiye', 'bebek', 'diger']],
    'DonationStatus' => [DonationStatus::class, ['initiated', 'paid', 'failed', 'refunded']],
    'HookStatus' => [HookStatus::class, ['AVAILABLE', 'RESERVED', 'REDEEMED', 'EXPIRED']],
    'PayoutStatus' => [PayoutStatus::class, ['pending', 'held', 'settled', 'failed']],
    'DevicePlatform' => [DevicePlatform::class, ['android', 'ios']],
    'DeletionChannel' => [DeletionChannel::class, ['app', 'web']],
    'DeletionRequestStatus' => [DeletionRequestStatus::class, ['pending', 'completed', 'cancelled']],
]);

it('labels item categories in Turkish', function () {
    expect(ItemCategory::Corba->label())->toBe('Çorba')
        ->and(ItemCategory::Kirtasiye->label())->toBe('Kırtasiye')
        ->and(ItemCategory::Diger->label())->toBe('Diğer');
});
