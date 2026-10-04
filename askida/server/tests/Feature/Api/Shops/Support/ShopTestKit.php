<?php

namespace Tests\Feature\Api\Shops\Support;

use App\Domain\Donations\Models\Donation;
use App\Domain\Hooks\Models\Hook;
use App\Domain\Hooks\Models\HookStatus;
use App\Domain\Items\Models\Item;
use App\Domain\Items\Models\ItemCategory;
use App\Domain\Shops\Models\GeoPoint;
use App\Domain\Shops\Models\Shop;
use App\Domain\Shops\Models\ShopMember;
use App\Domain\Shops\Models\ShopMemberRole;
use App\Domain\Shops\Models\ShopVerificationState;
use App\Domain\Shops\Support\TurkishIban;
use App\Domain\Shops\Support\TurkishTaxNumber;
use App\Models\User;
use Illuminate\Support\Str;

/**
 * Fixtures for the shop, item and document tests.
 *
 * Shops are built directly instead of through ShopFactory: the factory keeps a static
 * sequence that other suites (seeder, geography) depend on. Tax numbers and IBANs are
 * random and checksum-valid, computed at run time, so no real-looking identifier lives
 * in the repository.
 */
final class ShopTestKit
{
    /**
     * Kadıköy (İstanbul) centre, inside the Türkiye bounding box.
     */
    public const LAT = 40.9903;

    public const LNG = 29.0290;

    public static function taxNumber(): string
    {
        $firstNine = '';

        for ($i = 0; $i < 9; $i++) {
            $firstNine .= (string) random_int(0, 9);
        }

        return $firstNine.TurkishTaxNumber::checkDigit($firstNine);
    }

    public static function iban(): string
    {
        $bban = sprintf('%05d', random_int(1, 99999)).'0';

        for ($i = 0; $i < 16; $i++) {
            $bban .= (string) random_int(0, 9);
        }

        return 'TR'.TurkishIban::checkDigits($bban).$bban;
    }

    /**
     * A valid POST shops body.
     *
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    public static function payload(array $overrides = []): array
    {
        return array_merge([
            'name' => 'Çınar Fırını',
            'type' => 'bakery',
            'address' => 'Moda Caddesi No: 12',
            'il' => 'İstanbul',
            'ilce' => 'Kadıköy',
            'lat' => self::LAT,
            'lng' => self::LNG,
            'phone' => '0216 555 01 02',
            'tax_number' => self::taxNumber(),
            'iban' => self::iban(),
            'listed_on_web' => true,
        ], $overrides);
    }

    public static function merchant(): User
    {
        return User::factory()->merchant()->create();
    }

    public static function donor(): User
    {
        return User::factory()->donor()->create();
    }

    /**
     * @param  array<string, mixed>  $attributes
     */
    public static function shop(?User $owner = null, ShopVerificationState $state = ShopVerificationState::Verified, array $attributes = []): Shop
    {
        $owner ??= self::merchant();
        $suffix = strtolower(Str::random(8));
        $location = $attributes['location'] ?? new GeoPoint(self::LAT, self::LNG);
        unset($attributes['location']);

        $shop = new Shop;
        $shop->forceFill(array_merge([
            'owner_id' => $owner->id,
            'name' => 'Test Fırını '.$suffix,
            'slug' => 'test-firini-'.$suffix,
            'type' => 'bakery',
            'address' => 'Test Sokak No: 1',
            'il' => 'İstanbul',
            'ilce' => 'Kadıköy',
            'phone' => '+902165550102',
            'tax_number_enc' => self::taxNumber(),
            'iban_enc' => self::iban(),
            'verification_state' => $state,
            'verified_at' => $state === ShopVerificationState::Verified ? now() : null,
            'listed_on_web' => true,
            'is_sample' => false,
        ], $attributes));
        $shop->location = $location;
        $shop->save();

        self::join($shop, $owner, ShopMemberRole::Owner);

        return $shop;
    }

    public static function join(Shop $shop, User $user, ShopMemberRole $role): void
    {
        $member = new ShopMember(['role' => $role]);
        $member->forceFill(['shop_id' => $shop->id, 'user_id' => $user->id])->save();
    }

    /**
     * @param  array<string, mixed>  $attributes
     */
    public static function item(Shop $shop, array $attributes = []): Item
    {
        $item = new Item(array_merge([
            'name' => 'Ekmek',
            'category' => ItemCategory::Ekmek,
            'price_minor' => 1500,
            'daily_cap' => 20,
            'active' => true,
        ], $attributes));
        $item->forceFill(['shop_id' => $shop->id])->save();

        return $item;
    }

    /**
     * A paid donation for $qty units with that many hooks in the given status.
     */
    public static function hooks(Shop $shop, Item $item, int $qty, HookStatus $status = HookStatus::Available): Donation
    {
        $donation = Donation::factory()->paid()->create([
            'donor_id' => self::donor()->id,
            'shop_id' => $shop->id,
            'item_id' => $item->id,
            'qty' => $qty,
            'amount_minor' => $item->price_minor * $qty,
        ]);

        $factory = Hook::factory()->count($qty);

        if ($status === HookStatus::Redeemed) {
            $factory = $factory->redeemed();
        } elseif ($status === HookStatus::Reserved) {
            $factory = $factory->reserved();
        }

        $factory->create([
            'donation_id' => $donation->id,
            'shop_id' => $shop->id,
            'item_id' => $item->id,
        ]);

        return $donation;
    }

    /**
     * A minimal well-formed PDF with the given number of pages; $catalogExtra is placed
     * inside the catalog dictionary.
     */
    public static function pdf(int $pages = 1, string $catalogExtra = '', string $trailingObject = ''): string
    {
        $kids = [];
        $objects = [];

        for ($i = 0; $i < $pages; $i++) {
            $kids[] = (3 + $i).' 0 R';
        }

        $objects[] = "<< /Type /Catalog /Pages 2 0 R {$catalogExtra} >>";
        $objects[] = '<< /Type /Pages /Kids ['.implode(' ', $kids)."] /Count {$pages} >>";

        for ($i = 0; $i < $pages; $i++) {
            $objects[] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>';
        }

        if ($trailingObject !== '') {
            $objects[] = $trailingObject;
        }

        $body = "%PDF-1.4\n";
        $offsets = [];

        foreach ($objects as $index => $object) {
            $offsets[] = strlen($body);
            $body .= ($index + 1)." 0 obj\n{$object}\nendobj\n";
        }

        $xref = strlen($body);
        $body .= 'xref'."\n0 ".(count($objects) + 1)."\n0000000000 65535 f \n";

        foreach ($offsets as $offset) {
            $body .= sprintf("%010d 00000 n \n", $offset);
        }

        return $body.'trailer << /Size '.(count($objects) + 1)." /Root 1 0 R >>\nstartxref\n{$xref}\n%%EOF\n";
    }

    /**
     * A 1x1 PNG image.
     */
    public static function png(): string
    {
        $chunk = static fn (string $type, string $data): string => pack('N', strlen($data)).$type.$data.pack('N', crc32($type.$data));

        return "\x89PNG\r\n\x1A\n"
            .$chunk('IHDR', pack('NNCCCCC', 1, 1, 8, 2, 0, 0, 0))
            .$chunk('IDAT', (string) gzcompress("\x00\xFF\xFF\xFF"))
            .$chunk('IEND', '');
    }

    /**
     * A minimal JFIF header followed by the end-of-image marker.
     */
    public static function jpeg(): string
    {
        return "\xFF\xD8\xFF\xE0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00\xFF\xD9";
    }

    /**
     * The start of a Windows executable (DOS stub + PE signature), as a file renamed to
     * .pdf would contain.
     */
    public static function executable(): string
    {
        $header = 'MZ'.str_repeat("\x00", 58).pack('V', 64);

        return $header.'PE'."\x00\x00".str_repeat("\x00", 200);
    }
}
