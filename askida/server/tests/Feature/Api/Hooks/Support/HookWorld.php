<?php

namespace Tests\Feature\Api\Hooks\Support;

use App\Domain\Anon\Auth\AnonTokenIssuer;
use App\Domain\Anon\Models\AnonDevice;
use App\Domain\Anon\Models\DevicePlatform;
use App\Domain\Auth\Tokens\DeviceTokenIssuer;
use App\Domain\Donations\Models\Donation;
use App\Domain\Donations\Models\DonationStatus;
use App\Domain\Hooks\Codes\HookCodeGenerator;
use App\Domain\Hooks\Codes\HookCodeHasher;
use App\Domain\Hooks\Models\Hook;
use App\Domain\Hooks\Models\HookStatus;
use App\Domain\Items\Models\Item;
use App\Domain\Items\Models\ItemCategory;
use App\Domain\Shops\Models\GeoPoint;
use App\Domain\Shops\Models\Shop;
use App\Domain\Shops\Models\ShopMember;
use App\Domain\Shops\Models\ShopMemberRole;
use App\Domain\Shops\Models\ShopVerificationState;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Fixture builder for the hook, anon and concurrency tests. Shops and items are built
 * directly (not through their factories, whose running sequences other suites rely
 * on). Every secret-like value (pepper, codes) is created at run time.
 */
final class HookWorld
{
    private static ?string $pepper = null;

    /**
     * Sets a run-time pepper for the code hash and returns it.
     */
    public static function pepper(): string
    {
        self::$pepper ??= bin2hex(random_bytes(32));
        config(['askida.hook_code_pepper' => self::$pepper]);

        return self::$pepper;
    }

    public static function merchant(): User
    {
        return User::factory()->merchant()->create();
    }

    public static function donor(): User
    {
        return User::factory()->donor()->create();
    }

    public static function shop(bool $verified = true, ?User $owner = null): Shop
    {
        $owner ??= self::merchant();
        $suffix = Str::lower(Str::random(10));

        $shop = new Shop([
            'name' => '[ÖRNEK] Deneme Fırını '.$suffix,
            'type' => 'firin',
            'address' => '[ÖRNEK] Deneme Sokak 1',
            'il' => 'İstanbul',
            'ilce' => 'Kadıköy',
            'location' => new GeoPoint(40.99, 29.03),
            'phone' => '+90 212 000 00 00',
        ]);
        $shop->forceFill([
            'slug' => 'hooks-test-'.$suffix,
            'owner_id' => $owner->id,
            'is_sample' => true,
            'verification_state' => $verified ? ShopVerificationState::Verified : ShopVerificationState::Pending,
            'verified_at' => $verified ? now() : null,
        ])->save();

        self::join($shop, $owner, ShopMemberRole::Owner);

        return $shop;
    }

    public static function join(Shop $shop, User $user, ShopMemberRole $role): void
    {
        (new ShopMember)->forceFill(['shop_id' => $shop->id, 'user_id' => $user->id, 'role' => $role])->save();
    }

    public static function staff(Shop $shop): User
    {
        $staff = self::merchant();
        self::join($shop, $staff, ShopMemberRole::Staff);

        return $staff;
    }

    public static function owner(Shop $shop): User
    {
        return User::query()->findOrFail($shop->owner_id);
    }

    public static function item(Shop $shop, int $dailyCap = 50, bool $active = true, string $name = 'Ekmek'): Item
    {
        $item = new Item([
            'name' => $name,
            'category' => ItemCategory::Ekmek,
            'price_minor' => 1_500,
            'daily_cap' => $dailyCap,
            'active' => $active,
        ]);
        $item->forceFill(['shop_id' => $shop->id])->save();

        return $item;
    }

    public static function donation(Item $item, ?User $donor = null, int $qty = 1, bool $paid = true): Donation
    {
        $donation = new Donation;
        $donation->forceFill([
            'donor_id' => ($donor ?? self::donor())->id,
            'shop_id' => $item->shop_id,
            'item_id' => $item->id,
            'qty' => $qty,
            'amount_minor' => $item->price_minor * $qty,
            'commission_minor' => 0,
            'currency' => 'TRY',
            'provider' => 'fake',
            'status' => $paid ? DonationStatus::Paid : DonationStatus::Initiated,
            'paid_at' => $paid ? now() : null,
        ])->save();

        return $donation;
    }

    /**
     * Creates `count` AVAILABLE units of the item (one paid donation), created one
     * second apart so "oldest first" is well defined.
     *
     * @return list<Hook>
     */
    public static function availableHooks(Item $item, int $count, ?User $donor = null, ?CarbonImmutable $createdFrom = null): array
    {
        $donation = self::donation($item, $donor, max(1, min(20, $count)));
        $start = $createdFrom ?? CarbonImmutable::now()->subMinutes(30);
        $hooks = [];

        for ($i = 0; $i < $count; $i++) {
            $hook = new Hook;
            $hook->forceFill([
                'donation_id' => $donation->id,
                'shop_id' => $item->shop_id,
                'item_id' => $item->id,
                'status' => HookStatus::Available,
                'created_at' => $start->addSeconds($i),
                'updated_at' => $start->addSeconds($i),
            ])->save();
            $hooks[] = $hook;
        }

        return $hooks;
    }

    public static function anon(bool $banned = false, DevicePlatform $platform = DevicePlatform::Android): AnonDevice
    {
        $device = new AnonDevice;
        $device->forceFill([
            'anon_id' => (string) Str::uuid7(),
            'platform' => $platform,
            'attested_at' => now(),
            'attestation_verdict' => 'valid',
            'last_seen_at' => now(),
            'banned_at' => $banned ? now() : null,
        ])->save();

        return $device;
    }

    public static function anonToken(AnonDevice $device): string
    {
        return app(AnonTokenIssuer::class)->issue($device)->plainTextToken;
    }

    public static function userToken(User $user, string $device = 'hooks-test-device'): string
    {
        return app(DeviceTokenIssuer::class)->issue($user, $device, 'android')->plainTextToken;
    }

    public static function newCode(): string
    {
        return (new HookCodeGenerator)->generate();
    }

    public static function hash(string $code): string
    {
        return app(HookCodeHasher::class)->hash($code);
    }

    /**
     * Puts a unit into RESERVED for the device with the given code, as the reserve
     * engine would.
     */
    public static function reserve(Hook $hook, AnonDevice $device, string $code, ?CarbonImmutable $reservedAt = null, int $minutes = 10): Hook
    {
        $reservedAt ??= CarbonImmutable::now();

        DB::table('hooks')->where('id', $hook->id)->update([
            'status' => HookStatus::Reserved->value,
            'anon_id' => $device->anon_id,
            'code_hash' => self::hash($code),
            'reserved_at' => $reservedAt->format('Y-m-d H:i:s.uP'),
            'expires_at' => $reservedAt->addMinutes($minutes)->format('Y-m-d H:i:s.uP'),
        ]);

        return $hook->refresh();
    }
}
