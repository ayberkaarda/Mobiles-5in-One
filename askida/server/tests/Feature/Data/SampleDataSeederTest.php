<?php

use App\Domain\Items\Models\Item;
use App\Domain\Shops\Models\Shop;
use App\Domain\Shops\Models\ShopMember;
use App\Domain\Shops\Models\ShopMemberRole;
use App\Domain\Shops\Models\ShopVerificationState;
use App\Models\User;
use Database\Seeders\DatabaseSeeder;
use Database\Seeders\SampleDataSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;

uses(RefreshDatabase::class);

it('seeds six verified [ÖRNEK] sample shops in distinct Istanbul districts', function () {
    $this->seed(SampleDataSeeder::class);

    $shops = Shop::query()->get();

    expect($shops)->toHaveCount(6)
        ->and($shops->pluck('ilce')->unique())->toHaveCount(6)
        ->and($shops->every(fn (Shop $shop) => $shop->is_sample))->toBeTrue()
        ->and($shops->every(fn (Shop $shop) => str_starts_with($shop->name, '[ÖRNEK] ')))->toBeTrue()
        ->and($shops->every(fn (Shop $shop) => $shop->il === 'İstanbul'))->toBeTrue()
        ->and($shops->every(fn (Shop $shop) => $shop->verification_state === ShopVerificationState::Verified))->toBeTrue();

    foreach ($shops as $shop) {
        // Türkiye bounding box, and the Istanbul area in particular.
        expect($shop->location->latitude)->toBeGreaterThan(40.8)->toBeLessThan(41.3)
            ->and($shop->location->longitude)->toBeGreaterThan(28.5)->toBeLessThan(29.5);
    }
});

it('seeds three to five items per shop with kuruş prices inside the allowed bounds', function () {
    $this->seed(SampleDataSeeder::class);

    foreach (Shop::query()->withCount('items')->get() as $shop) {
        expect($shop->items_count)->toBeGreaterThanOrEqual(3)->toBeLessThanOrEqual(5);
    }

    foreach (Item::query()->get() as $item) {
        expect($item->price_minor)->toBeGreaterThanOrEqual(100)->toBeLessThanOrEqual(1_000_000)
            ->and($item->currency)->toBe('TRY')
            ->and($item->daily_cap)->toBeGreaterThan(0)
            ->and($item->active)->toBeTrue();
    }
});

it('creates the sample merchant as owner of every sample shop and a sample donor', function () {
    $this->seed(SampleDataSeeder::class);

    $merchant = User::query()->where('email', SampleDataSeeder::MERCHANT_EMAIL)->firstOrFail();
    $donor = User::query()->where('email', SampleDataSeeder::DONOR_EMAIL)->firstOrFail();

    expect($merchant->getAttribute('kind'))->toBe('merchant')
        ->and($donor->getAttribute('kind'))->toBe('donor')
        ->and(Hash::check(implode('-', ['ornek', 'esnaf']), (string) $merchant->getAttribute('password')))->toBeTrue()
        ->and(Hash::check(implode('-', ['ornek', 'bagisci']), (string) $donor->getAttribute('password')))->toBeTrue()
        ->and(Shop::query()->where('owner_id', $merchant->getKey())->count())->toBe(6)
        ->and(ShopMember::query()->where('user_id', $merchant->getKey())->where('role', ShopMemberRole::Owner->value)->count())->toBe(6);
});

it('is safe to run more than once', function () {
    $this->seed(SampleDataSeeder::class);
    $this->seed(SampleDataSeeder::class);

    expect(Shop::query()->count())->toBe(6)
        ->and(Item::query()->count())->toBe(collect(SampleDataSeeder::SHOPS)->sum(fn (array $shop) => count($shop['items'])))
        ->and(ShopMember::query()->count())->toBe(6)
        ->and(User::query()->whereIn('email', [SampleDataSeeder::MERCHANT_EMAIL, SampleDataSeeder::DONOR_EMAIL])->count())->toBe(2);
});

it('runs from the database seeder', function () {
    $this->seed(DatabaseSeeder::class);

    expect(Shop::query()->count())->toBe(6);
});

it('refuses to seed sample data in production', function () {
    app()->detectEnvironment(fn () => 'production');

    try {
        expect(fn () => $this->artisan('db:seed', ['--class' => SampleDataSeeder::class, '--force' => true])->run())
            ->toThrow(RuntimeException::class, 'Sample data is never seeded in the [production] environment.');

        $this->artisan('db:seed', ['--class' => DatabaseSeeder::class, '--force' => true])
            ->expectsOutputToContain('Sample data skipped')
            ->assertSuccessful();
    } finally {
        app()->detectEnvironment(fn () => 'testing');
    }

    expect(Shop::query()->count())->toBe(0);
});
