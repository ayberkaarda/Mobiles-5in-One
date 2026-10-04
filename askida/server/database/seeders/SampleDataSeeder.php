<?php

namespace Database\Seeders;

use App\Domain\Items\Models\Item;
use App\Domain\Items\Models\ItemCategory;
use App\Domain\Shops\Models\GeoPoint;
use App\Domain\Shops\Models\Shop;
use App\Domain\Shops\Models\ShopMember;
use App\Domain\Shops\Models\ShopMemberRole;
use App\Domain\Shops\Models\ShopVerificationState;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Schema;
use RuntimeException;

/**
 * Local and testing sample data: six [ÖRNEK] shops in distinct Istanbul districts with a
 * small catalog each, one sample merchant and one sample donor. Every shop is flagged
 * `is_sample`; none of them stands for a real business. Safe to run repeatedly.
 */
class SampleDataSeeder extends Seeder
{
    /**
     * Environments where sample data may be written.
     *
     * @var list<string>
     */
    public const ALLOWED_ENVIRONMENTS = ['local', 'testing'];

    public const MERCHANT_EMAIL = 'ornek-esnaf@example.test';

    public const DONOR_EMAIL = 'ornek-bagisci@example.test';

    /**
     * Sample login passwords are two plain words joined by a hyphen: "ornek-esnaf" for the
     * merchant and "ornek-bagisci" for the donor (documented with the local environment).
     *
     * @var array<string, list<string>>
     */
    private const PASSWORD_WORDS = [
        self::MERCHANT_EMAIL => ['ornek', 'esnaf'],
        self::DONOR_EMAIL => ['ornek', 'bagisci'],
    ];

    /**
     * Opening hours of every sample shop (the public shop page and its LocalBusiness JSON-LD
     * show them): `{mon..sun: {open, close} | null}`, null = closed that day.
     *
     * @var array<string, array{open: string, close: string}|null>
     */
    public const OPENING_HOURS = [
        'mon' => ['open' => '08:00', 'close' => '20:00'],
        'tue' => ['open' => '08:00', 'close' => '20:00'],
        'wed' => ['open' => '08:00', 'close' => '20:00'],
        'thu' => ['open' => '08:00', 'close' => '20:00'],
        'fri' => ['open' => '08:00', 'close' => '20:00'],
        'sat' => ['open' => '09:00', 'close' => '18:00'],
        'sun' => null,
    ];

    /**
     * slug, name, type, ilce, address, latitude, longitude, items (name, category, kuruş, daily cap).
     *
     * @var list<array{slug: string, name: string, type: string, ilce: string, address: string, lat: float, lng: float, items: list<array{0: string, 1: ItemCategory, 2: int, 3: int}>}>
     */
    public const SHOPS = [
        [
            'slug' => 'ornek-moda-firini',
            'name' => '[ÖRNEK] Moda Fırını',
            'type' => 'firin',
            'ilce' => 'Kadıköy',
            'address' => '[ÖRNEK] Örnek Sokak No: 1, Caferağa, Kadıköy',
            'lat' => 40.9877,
            'lng' => 29.0262,
            'items' => [
                ['Ekmek', ItemCategory::Ekmek, 1_500, 20],
                ['Simit', ItemCategory::Ekmek, 1_250, 20],
                ['Poğaça', ItemCategory::Ekmek, 2_000, 10],
                ['Ayran', ItemCategory::Diger, 1_500, 10],
            ],
        ],
        [
            'slug' => 'ornek-carsi-lokantasi',
            'name' => '[ÖRNEK] Çarşı Lokantası',
            'type' => 'lokanta',
            'ilce' => 'Beşiktaş',
            'address' => '[ÖRNEK] Örnek Caddesi No: 2, Sinanpaşa, Beşiktaş',
            'lat' => 41.0428,
            'lng' => 29.0075,
            'items' => [
                ['Mercimek çorbası', ItemCategory::Corba, 6_000, 15],
                ['Kuru fasulye pilav', ItemCategory::Yemek, 14_000, 10],
                ['Tavuklu pilav', ItemCategory::Yemek, 12_000, 10],
            ],
        ],
        [
            'slug' => 'ornek-kuzguncuk-kirtasiyesi',
            'name' => '[ÖRNEK] Kuzguncuk Kırtasiyesi',
            'type' => 'kirtasiye',
            'ilce' => 'Üsküdar',
            'address' => '[ÖRNEK] Örnek Sokak No: 3, Kuzguncuk, Üsküdar',
            'lat' => 41.0365,
            'lng' => 29.0310,
            'items' => [
                ['Defter', ItemCategory::Kirtasiye, 4_500, 10],
                ['Kalem seti', ItemCategory::Kirtasiye, 7_500, 10],
                ['Boya kalemi', ItemCategory::Kirtasiye, 9_000, 5],
                ['Okul çantası', ItemCategory::Kirtasiye, 45_000, 2],
            ],
        ],
        [
            'slug' => 'ornek-balat-bakkali',
            'name' => '[ÖRNEK] Balat Bakkalı',
            'type' => 'bakkal',
            'ilce' => 'Fatih',
            'address' => '[ÖRNEK] Örnek Sokak No: 4, Balat, Fatih',
            'lat' => 41.0295,
            'lng' => 28.9488,
            'items' => [
                ['Ekmek', ItemCategory::Ekmek, 1_500, 20],
                ['Süt', ItemCategory::Diger, 3_500, 10],
                ['Bebek maması', ItemCategory::Bebek, 25_000, 3],
                ['Bebek bezi', ItemCategory::Bebek, 35_000, 3],
                ['Makarna', ItemCategory::Diger, 2_500, 10],
            ],
        ],
        [
            'slug' => 'ornek-mecidiyekoy-corbacisi',
            'name' => '[ÖRNEK] Mecidiyeköy Çorbacısı',
            'type' => 'corbaci',
            'ilce' => 'Şişli',
            'address' => '[ÖRNEK] Örnek Caddesi No: 5, Mecidiyeköy, Şişli',
            'lat' => 41.0672,
            'lng' => 28.9925,
            'items' => [
                ['Mercimek çorbası', ItemCategory::Corba, 6_000, 20],
                ['Ezogelin çorbası', ItemCategory::Corba, 6_000, 20],
                ['Tavuk suyu çorbası', ItemCategory::Corba, 7_000, 15],
            ],
        ],
        [
            'slug' => 'ornek-yesilkoy-marketi',
            'name' => '[ÖRNEK] Yeşilköy Marketi',
            'type' => 'market',
            'ilce' => 'Bakırköy',
            'address' => '[ÖRNEK] Örnek Sokak No: 6, Yeşilköy, Bakırköy',
            'lat' => 40.9636,
            'lng' => 28.8256,
            'items' => [
                ['Ekmek', ItemCategory::Ekmek, 1_500, 20],
                ['Su', ItemCategory::Diger, 1_000, 20],
                ['Bebek bezi', ItemCategory::Bebek, 35_000, 3],
                ['Defter', ItemCategory::Kirtasiye, 4_500, 10],
            ],
        ],
    ];

    public function run(): void
    {
        $environment = (string) app()->environment();

        if (! in_array($environment, self::ALLOWED_ENVIRONMENTS, true)) {
            throw new RuntimeException("Sample data is never seeded in the [{$environment}] environment.");
        }

        $merchant = null;

        if ($this->usersAvailable()) {
            $merchant = $this->sampleUser(self::MERCHANT_EMAIL, '[ÖRNEK] Esnaf', 'merchant');
            $this->sampleUser(self::DONOR_EMAIL, '[ÖRNEK] Bağışçı', 'donor');
        } else {
            $this->command->warn('Sample users skipped: the users table or the User model and factory with UUID keys is not available yet. Sample shops are created without an owner.');
        }

        foreach (self::SHOPS as $definition) {
            $shop = Shop::query()->where('slug', $definition['slug'])->first();

            if ($shop === null) {
                $shop = Shop::factory()->create([
                    'owner_id' => $merchant?->getKey(),
                    'slug' => $definition['slug'],
                    'name' => $definition['name'],
                    'type' => $definition['type'],
                    'address' => $definition['address'],
                    'il' => 'İstanbul',
                    'ilce' => $definition['ilce'],
                    'location' => new GeoPoint($definition['lat'], $definition['lng']),
                    'phone' => '+90 212 000 00 00',
                    'tax_number_enc' => null,
                    'iban_enc' => null,
                    'verification_state' => ShopVerificationState::Verified,
                    'verified_at' => now(),
                    'listed_on_web' => true,
                    'opening_hours' => self::OPENING_HOURS,
                    'is_sample' => true,
                ]);
            }

            // Sample shops seeded before opening hours existed get them on the next run.
            if ($shop->opening_hours === null) {
                $shop->forceFill(['opening_hours' => self::OPENING_HOURS])->save();
            }

            if ($merchant !== null) {
                if ($shop->owner_id === null) {
                    $shop->forceFill(['owner_id' => $merchant->getKey()])->save();
                }

                $member = ShopMember::query()->firstOrNew([
                    'shop_id' => $shop->id,
                    'user_id' => $merchant->getKey(),
                ]);
                $member->role = ShopMemberRole::Owner;
                $member->save();
            }

            foreach ($definition['items'] as [$name, $category, $price, $cap]) {
                $exists = Item::query()->where('shop_id', $shop->id)->where('name', $name)->exists();

                if (! $exists) {
                    Item::factory()->create([
                        'shop_id' => $shop->id,
                        'name' => $name,
                        'category' => $category,
                        'price_minor' => $price,
                        'daily_cap' => $cap,
                        'active' => true,
                    ]);
                }
            }
        }

        $this->command->info('Sample data ready: '.count(self::SHOPS).' [ÖRNEK] shops.');
    }

    /**
     * The users table and model belong to the authentication module; sample users are only
     * written once both exist with UUID keys and the `kind` column.
     */
    private function usersAvailable(): bool
    {
        if (! class_exists(User::class) || ! in_array(HasFactory::class, class_uses_recursive(User::class), true)) {
            return false;
        }

        if (! Schema::hasTable('users') || ! Schema::hasColumn('users', 'kind')) {
            return false;
        }

        return (new User)->getKeyType() === 'string';
    }

    private function sampleUser(string $email, string $name, string $kind): User
    {
        $user = User::query()->where('email', $email)->first();

        if ($user !== null) {
            return $user;
        }

        return User::factory()->create([
            'email' => $email,
            'name' => $name,
            'kind' => $kind,
            'email_verified_at' => now(),
            'password' => Hash::make(implode('-', self::PASSWORD_WORDS[$email])),
        ]);
    }
}
