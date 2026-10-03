<?php

namespace Database\Factories;

use App\Domain\Shops\Models\GeoPoint;
use App\Domain\Shops\Models\Shop;
use App\Domain\Shops\Models\ShopVerificationState;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * Deterministic sample shops: every row is flagged `is_sample` and its name carries the
 * [ÖRNEK] prefix, so factory data can never pass for a real business.
 *
 * @extends Factory<Shop>
 */
class ShopFactory extends Factory
{
    protected $model = Shop::class;

    private static int $sequence = 0;

    /**
     * Shop type, display noun and a district centre (il, ilce, latitude, longitude).
     *
     * @var list<array{0: string, 1: string, 2: string, 3: float, 4: float}>
     */
    private const PROFILES = [
        ['firin', 'Fırını', 'Kadıköy', 40.9903, 29.0290],
        ['lokanta', 'Lokantası', 'Beşiktaş', 41.0430, 29.0070],
        ['kirtasiye', 'Kırtasiyesi', 'Üsküdar', 41.0260, 29.0150],
        ['bakkal', 'Bakkalı', 'Fatih', 41.0190, 28.9490],
        ['corbaci', 'Çorbacısı', 'Şişli', 41.0600, 28.9870],
        ['market', 'Marketi', 'Bakırköy', 40.9800, 28.8720],
    ];

    /**
     * @var list<string>
     */
    private const NAMES = ['Çınar', 'Lale', 'Defne', 'Ilgaz', 'Mavi', 'Güneş', 'Kardelen', 'Serin'];

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $n = ++self::$sequence;
        [$type, $noun, $ilce, $lat, $lng] = self::PROFILES[$n % count(self::PROFILES)];
        $name = self::NAMES[$n % count(self::NAMES)];
        // Small deterministic offset (< 1 km) so rows of the same district do not overlap.
        $offset = ($n % 9) * 0.001;

        return [
            'owner_id' => User::factory()->state(['kind' => 'merchant']),
            'name' => "[ÖRNEK] {$name} {$noun} {$n}",
            'slug' => "ornek-{$type}-{$n}",
            'type' => $type,
            'address' => "[ÖRNEK] Örnek Sokak No: {$n}, {$ilce}",
            'il' => 'İstanbul',
            'ilce' => $ilce,
            'location' => new GeoPoint($lat + $offset, $lng + $offset),
            'phone' => sprintf('+90 212 000 %02d %02d', intdiv($n, 100) % 100, $n % 100),
            'tax_number_enc' => sprintf('99%08d', $n),
            'iban_enc' => sprintf('TR00%022d', $n),
            'sub_merchant_key' => null,
            'verification_state' => ShopVerificationState::Pending,
            'verified_at' => null,
            'listed_on_web' => false,
            'is_sample' => true,
        ];
    }

    public function verified(): static
    {
        return $this->state(fn () => [
            'verification_state' => ShopVerificationState::Verified,
            'verified_at' => now(),
        ]);
    }

    public function rejected(): static
    {
        return $this->state(fn () => [
            'verification_state' => ShopVerificationState::Rejected,
            'verified_at' => null,
        ]);
    }

    public function at(float $latitude, float $longitude): static
    {
        return $this->state(fn () => [
            'location' => new GeoPoint($latitude, $longitude),
        ]);
    }
}
