<?php

use App\Domain\Anon\Models\AnonDailyCounter;
use App\Domain\Anon\Models\AnonDevice;
use App\Domain\Donations\Models\Donation;
use App\Domain\Hooks\Models\Hook;
use App\Domain\Hooks\Models\HookStatus;
use App\Domain\Impact\Models\ImpactSnapshot;
use App\Domain\Items\Models\Item;
use App\Domain\Payments\Models\PaymentEvent;
use App\Domain\Payments\Models\Payout;
use App\Domain\Shops\Models\Shop;
use App\Domain\Shops\Models\ShopMember;
use App\Models\User;
use Database\Factories\HookFactory;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;

uses(RefreshDatabase::class);

/**
 * Runs the statement inside a savepoint and returns the SQLSTATE it failed with, or null
 * when it succeeded. The savepoint keeps the surrounding test transaction usable.
 */
function dataSqlState(Closure $statement): ?string
{
    try {
        DB::transaction($statement);
    } catch (QueryException $exception) {
        return (string) $exception->getCode();
    }

    return null;
}

const CHECK_VIOLATION = '23514';
const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';

it('rejects out-of-range item prices, caps, categories and currencies', function (array $change) {
    $item = Item::factory()->create();

    expect(dataSqlState(fn () => DB::table('items')->where('id', $item->id)->update($change)))->toBe(CHECK_VIOLATION);
})->with([
    'price below 100 kuruş' => [['price_minor' => 99]],
    'price above 1 000 000 kuruş' => [['price_minor' => 1_000_001]],
    'negative price' => [['price_minor' => -100]],
    'daily cap zero' => [['daily_cap' => 0]],
    'unknown category' => [['category' => 'ilac']],
    'foreign currency' => [['currency' => 'EUR']],
]);

it('accepts the price bounds themselves', function () {
    $item = Item::factory()->create();

    expect(dataSqlState(fn () => DB::table('items')->where('id', $item->id)->update(['price_minor' => 100])))->toBeNull()
        ->and(dataSqlState(fn () => DB::table('items')->where('id', $item->id)->update(['price_minor' => 1_000_000])))->toBeNull();
});

it('rejects invalid donation rows', function (array $change) {
    $donation = Donation::factory()->create();

    expect(dataSqlState(fn () => DB::table('donations')->where('id', $donation->id)->update($change)))->toBe(CHECK_VIOLATION);
})->with([
    'qty 0' => [['qty' => 0]],
    'qty 21' => [['qty' => 21]],
    'negative amount' => [['amount_minor' => -1]],
    'zero amount' => [['amount_minor' => 0]],
    'negative commission' => [['commission_minor' => -1]],
    'commission above amount' => [['commission_minor' => 100_000_000]],
    'unknown status' => [['status' => 'pending']],
    'paid without paid_at' => [['status' => 'paid', 'paid_at' => null]],
    'anonymized with a donor' => [['anonymized_at' => now()]],
    'foreign currency' => [['currency' => 'USD']],
]);

it('accepts qty 1 and 20', function () {
    $donation = Donation::factory()->create();

    foreach ([1, 20] as $qty) {
        expect(dataSqlState(fn () => DB::table('donations')->where('id', $donation->id)->update(['qty' => $qty])))->toBeNull();
    }
});

it('rejects invalid states of other tables', function (string $table, Closure $factory, array $change) {
    $id = $factory()->getKey();

    expect(dataSqlState(fn () => DB::table($table)->where('id', $id)->update($change)))->toBe(CHECK_VIOLATION);
})->with([
    'shop state' => ['shops', fn () => Shop::factory()->create(), ['verification_state' => 'approved']],
    'verified shop without verified_at' => ['shops', fn () => Shop::factory()->create(), ['verification_state' => 'verified', 'verified_at' => null]],
    'member role' => ['shop_members', fn () => ShopMember::factory()->create(), ['role' => 'admin']],
    'hook status' => ['hooks', fn () => Hook::factory()->create(), ['status' => 'USED']],
    'payout negative amount' => ['payouts', fn () => Payout::factory()->create(), ['amount_minor' => -1]],
    'payout status' => ['payouts', fn () => Payout::factory()->create(), ['status' => 'paid']],
    'anon platform' => ['anon_devices', fn () => AnonDevice::factory()->create(), ['platform' => 'web']],
    'counter negative' => ['anon_daily_counters', fn () => AnonDailyCounter::factory()->create(), ['count' => -1]],
    'impact negative' => ['impact_snapshots', fn () => ImpactSnapshot::factory()->create(), ['redeemed' => -1]],
]);

it('rejects shop locations outside Türkiye', function () {
    $shop = Shop::factory()->create();

    $state = dataSqlState(fn () => DB::update(
        'update shops set location = ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography where id = ?',
        [2.3522, 48.8566, $shop->id],
    ));

    expect($state)->toBe(CHECK_VIOLATION);
});

it('rejects hooks whose columns do not match their status', function (array $change) {
    $hook = Hook::factory()->create();

    expect(dataSqlState(fn () => DB::table('hooks')->where('id', $hook->id)->update($change)))->toBe(CHECK_VIOLATION);
})->with([
    'available with a code' => [['code_hash' => str_repeat('a', 64)]],
    'reserved without a code' => [['status' => 'RESERVED', 'reserved_at' => now(), 'expires_at' => now()->addMinutes(10)]],
    'reserved with expiry before reservation' => [['status' => 'RESERVED', 'code_hash' => str_repeat('b', 64), 'reserved_at' => now(), 'expires_at' => now()->subMinute()]],
    'redeemed without redeemed_at' => [['status' => 'REDEEMED', 'code_hash' => str_repeat('c', 64)]],
    'code hash not hex' => [['status' => 'RESERVED', 'code_hash' => str_repeat('Z', 64), 'reserved_at' => now(), 'expires_at' => now()->addMinutes(10)]],
]);

it('blocks a second REDEEMED unit for the same code at the same shop', function () {
    $first = Hook::factory()->redeemed()->create();
    $second = Hook::factory()->create([
        'donation_id' => $first->donation_id,
    ]);

    $state = dataSqlState(fn () => DB::table('hooks')->where('id', $second->id)->update([
        'status' => 'REDEEMED',
        'code_hash' => $first->code_hash,
        'reserved_at' => now()->subMinute(),
        'expires_at' => now()->addMinutes(9),
        'redeemed_at' => now(),
    ]));

    expect($state)->toBe(UNIQUE_VIOLATION);
});

it('blocks two live reservations with the same code at one shop', function () {
    $first = Hook::factory()->reserved()->create();
    $second = Hook::factory()->create(['donation_id' => $first->donation_id]);

    $state = dataSqlState(fn () => DB::table('hooks')->where('id', $second->id)->update([
        'status' => 'RESERVED',
        'code_hash' => $first->code_hash,
        'reserved_at' => now(),
        'expires_at' => now()->addMinutes(10),
    ]));

    expect($state)->toBe(UNIQUE_VIOLATION);
});

it('allows the same code hash at a different shop', function () {
    $first = Hook::factory()->reserved()->create();
    $other = Hook::factory()->create();

    expect($other->shop_id)->not->toBe($first->shop_id);

    $state = dataSqlState(fn () => DB::table('hooks')->where('id', $other->id)->update([
        'status' => 'RESERVED',
        'code_hash' => $first->code_hash,
        'reserved_at' => now(),
        'expires_at' => now()->addMinutes(10),
    ]));

    expect($state)->toBeNull();
});

it('keeps REDEEMED final', function (array $change) {
    $hook = Hook::factory()->redeemed()->create();

    expect(dataSqlState(fn () => DB::table('hooks')->where('id', $hook->id)->update($change)))->toBe(CHECK_VIOLATION);
})->with([
    'redeem again with a new time' => [['redeemed_at' => now()->addMinute()]],
    'back to available' => [['status' => 'AVAILABLE', 'code_hash' => null, 'reserved_at' => null, 'expires_at' => null, 'redeemed_at' => null]],
    'to expired' => [['status' => 'EXPIRED', 'redeemed_at' => null]],
    'different code' => [['code_hash' => str_repeat('d', 64)]],
]);

it('lets exactly one of two RESERVED to REDEEMED transitions win', function () {
    $hook = Hook::factory()->reserved()->create();

    $redeem = fn () => DB::update(
        "update hooks set status = 'REDEEMED', redeemed_at = now() where id = ? and status = 'RESERVED'",
        [$hook->id],
    );

    expect($redeem())->toBe(1)
        ->and($redeem())->toBe(0)
        ->and($hook->fresh()?->status)->toBe(HookStatus::Redeemed);
});

it('keeps donations and clears donor_id when the donor is deleted', function () {
    $donation = Donation::factory()->paid()->create();
    $donorId = $donation->donor_id;

    DB::table('users')->where('id', $donorId)->delete();

    $row = DB::table('donations')->where('id', $donation->id)->first();
    expect($row)->not->toBeNull()
        ->and($row->donor_id)->toBeNull();
});

it('refuses to delete a user who still owns a shop', function () {
    $shop = Shop::factory()->create();

    expect(dataSqlState(fn () => DB::table('users')->where('id', $shop->owner_id)->delete()))->toBe(FOREIGN_KEY_VIOLATION);
});

it('clears anon links and counters when an anonymous device is removed', function () {
    $hook = Hook::factory()->reserved()->create();
    $anonId = (string) $hook->anon_id;
    AnonDailyCounter::factory()->create(['anon_id' => $anonId]);

    AnonDevice::query()->where('anon_id', $anonId)->delete();

    expect(DB::table('hooks')->where('id', $hook->id)->value('anon_id'))->toBeNull()
        ->and(DB::table('anon_daily_counters')->where('anon_id', $anonId)->count())->toBe(0)
        ->and(DB::table('hooks')->where('id', $hook->id)->value('status'))->toBe('RESERVED');
});

it('anonymises a redeemed hook when the redeeming user is removed', function () {
    $staff = User::factory()->create();
    $hook = Hook::factory()->redeemed()->create(['redeemed_by_user_id' => $staff->getKey()]);

    DB::table('users')->where('id', $staff->getKey())->delete();

    expect(DB::table('hooks')->where('id', $hook->id)->value('redeemed_by_user_id'))->toBeNull()
        ->and(DB::table('hooks')->where('id', $hook->id)->value('status'))->toBe('REDEEMED');
});

it('makes payment events unique per provider and event id', function () {
    $event = PaymentEvent::factory()->create();

    expect(dataSqlState(fn () => PaymentEvent::factory()->create([
        'provider' => $event->provider,
        'event_id' => $event->event_id,
    ])))->toBe(UNIQUE_VIOLATION);

    expect(dataSqlState(fn () => PaymentEvent::factory()->create([
        'provider' => 'other',
        'event_id' => $event->event_id,
    ])))->toBeNull();
});

it('makes shop membership unique per user and shop', function () {
    $member = ShopMember::factory()->create();

    expect(dataSqlState(fn () => ShopMember::factory()->create([
        'shop_id' => $member->shop_id,
        'user_id' => $member->user_id,
    ])))->toBe(UNIQUE_VIOLATION);
});

it('makes impact snapshots unique per district and day', function () {
    $snapshot = ImpactSnapshot::factory()->create();

    expect(dataSqlState(fn () => ImpactSnapshot::factory()->create([
        'il' => $snapshot->il,
        'ilce' => $snapshot->ilce,
        'day' => $snapshot->day->toDateString(),
    ])))->toBe(UNIQUE_VIOLATION);
});

it('derives digest-shaped sample code hashes', function () {
    expect(HookFactory::sampleCodeHash())->toMatch('/^[0-9a-f]{64}$/');
});
