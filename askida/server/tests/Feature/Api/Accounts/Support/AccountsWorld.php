<?php

namespace Tests\Feature\Api\Accounts\Support;

use App\Domain\Donations\Models\Donation;
use App\Domain\Donations\Models\DonationStatus;
use App\Domain\Hooks\Models\Hook;
use App\Domain\Hooks\Models\HookStatus;
use App\Domain\Items\Models\Item;
use App\Domain\Items\Models\ItemCategory;
use App\Domain\Shops\Models\GeoPoint;
use App\Domain\Shops\Models\Shop;
use App\Domain\Shops\Models\ShopDocument;
use App\Domain\Shops\Models\ShopDocumentKind;
use App\Domain\Shops\Models\ShopMember;
use App\Domain\Shops\Models\ShopMemberRole;
use App\Domain\Shops\Models\ShopVerificationState;
use App\Models\User;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Storage;

/**
 * Builds shops, items, donations, hooks and documents directly (never through the
 * shop factory, whose running sequence the seeder and geography tests depend on).
 * Tax numbers and IBANs are checksum-valid values assembled at run time.
 */
final class AccountsWorld
{
    /**
     * @param  array<string, mixed>  $overrides
     */
    public static function shop(?User $owner, array $overrides = []): Shop
    {
        $suffix = bin2hex(random_bytes(4));

        $shop = new Shop;
        $shop->forceFill(array_merge([
            'name' => 'Accounts test shop '.$suffix,
            'type' => 'bakery',
            'address' => 'Test Street '.$suffix,
            'il' => 'İstanbul',
            'ilce' => 'Kadıköy',
            'location' => new GeoPoint(40.99, 29.03),
            'phone' => '+90 212 000 00 00',
            'tax_number_enc' => self::taxNumber(),
            'iban_enc' => self::iban(),
            'slug' => 'accounts-test-shop-'.$suffix,
            'owner_id' => $owner?->id,
            'verification_state' => ShopVerificationState::Verified,
            'verified_at' => Carbon::now(),
            'is_sample' => false,
        ], $overrides));
        $shop->save();

        if ($owner !== null) {
            self::member($shop, $owner, ShopMemberRole::Owner);
        }

        return $shop;
    }

    public static function member(Shop $shop, User $user, ShopMemberRole $role): ShopMember
    {
        $member = new ShopMember;
        $member->forceFill(['shop_id' => $shop->id, 'user_id' => $user->id, 'role' => $role])->save();

        return $member;
    }

    public static function item(Shop $shop): Item
    {
        $item = new Item;
        $item->forceFill([
            'shop_id' => $shop->id,
            'name' => 'Ekmek',
            'category' => ItemCategory::Ekmek,
            'price_minor' => 1_500,
            'daily_cap' => 10,
        ])->save();

        return $item;
    }

    public static function donation(?User $donor, Item $item, DonationStatus $status = DonationStatus::Paid, int $qty = 1, ?Carbon $paidAt = null): Donation
    {
        $donation = new Donation;
        $donation->forceFill([
            'donor_id' => $donor?->id,
            'shop_id' => $item->shop_id,
            'item_id' => $item->id,
            'qty' => $qty,
            'amount_minor' => $item->price_minor * $qty,
            'provider' => 'fake',
            'status' => $status,
            'paid_at' => in_array($status, [DonationStatus::Paid, DonationStatus::Refunded], true) ? ($paidAt ?? Carbon::now()) : null,
        ])->save();

        return $donation;
    }

    public static function hook(Donation $donation, HookStatus $status, ?User $redeemedBy = null, ?Carbon $at = null): Hook
    {
        $at ??= Carbon::now();
        $attributes = [
            'donation_id' => $donation->id,
            'shop_id' => $donation->shop_id,
            'item_id' => $donation->item_id,
            'status' => $status,
        ];

        if ($status === HookStatus::Reserved) {
            $attributes += [
                'code_hash' => hash('sha256', 'accounts-code-'.bin2hex(random_bytes(8))),
                'reserved_at' => $at,
                'expires_at' => $at->copy()->addMinutes(10),
            ];
        }

        if ($status === HookStatus::Redeemed) {
            $attributes += [
                'code_hash' => hash('sha256', 'accounts-code-'.bin2hex(random_bytes(8))),
                'reserved_at' => $at->copy()->subMinutes(2),
                'expires_at' => $at->copy()->addMinutes(8),
                'redeemed_at' => $at,
                'redeemed_by_user_id' => $redeemedBy?->id,
            ];
        }

        $hook = new Hook;
        $hook->forceFill($attributes)->save();

        return $hook;
    }

    /**
     * A stored verification document: object on the (faked) private disk plus its row.
     */
    public static function document(Shop $shop): ShopDocument
    {
        $path = 'shops/'.$shop->id.'/documents/'.bin2hex(random_bytes(8)).'.pdf';
        Storage::disk((string) config('filesystems.private_disk'))->put($path, "%PDF-1.4\n%%EOF\n");

        $document = new ShopDocument;
        $document->forceFill([
            'shop_id' => $shop->id,
            'kind' => ShopDocumentKind::cases()[0],
            'path' => $path,
            'mime' => 'application/pdf',
            'size' => 16,
        ])->save();

        return $document;
    }

    /**
     * A 10-digit Turkish tax number (VKN) with a valid check digit.
     */
    public static function taxNumber(): string
    {
        $digits = [random_int(1, 9)];

        for ($i = 1; $i < 9; $i++) {
            $digits[] = random_int(0, 9);
        }

        $sum = 0;

        foreach ($digits as $i => $digit) {
            $tmp = ($digit + 9 - $i) % 10;
            $sum += $tmp === 9 ? 9 : ($tmp * (2 ** (9 - $i))) % 9;
        }

        $digits[] = (10 - ($sum % 10)) % 10;

        return implode('', $digits);
    }

    /**
     * A 26-character TR IBAN with valid ISO 7064 check digits.
     */
    public static function iban(): string
    {
        $bban = sprintf('%05d', random_int(1, 99_999)).'0';

        for ($i = 0; $i < 16; $i++) {
            $bban .= (string) random_int(0, 9);
        }

        // "TR" -> 29 27, check digits 00 while computing.
        $numeric = $bban.'292700';
        $remainder = 0;

        foreach (str_split($numeric, 7) as $chunk) {
            $remainder = (int) ($remainder.$chunk) % 97;
        }

        return 'TR'.sprintf('%02d', 98 - $remainder).$bban;
    }
}
