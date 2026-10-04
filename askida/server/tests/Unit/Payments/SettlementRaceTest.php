<?php

use App\Domain\Donations\Models\Donation;
use App\Domain\Donations\Models\DonationStatus;
use App\Domain\Hooks\Models\Hook;
use App\Domain\Payments\Data\ProviderPaymentStatus;
use Illuminate\Support\Facades\DB;
use Tests\Feature\Api\Donations\Support\PaymentWorld;
use Tests\Feature\Api\Hooks\Support\HookWorld;
use Tests\Security\Concurrency\ConcurrencyHarness;

/*
| Security items 4, 17 and 23: parallel settle() calls for one provider token, each in
| its own OS process with its own database session (the callback, the webhook job and
| the reconciliation job can all arrive at once). Exactly one transition, exactly qty
| units, at most one mismatch row. No RefreshDatabase: the workers must see committed
| fixtures; afterEach removes them with id-scoped deletes.
*/

const SETTLE_WORKERS = 8;

beforeEach(function (): void {
    ConcurrencyHarness::ensureSchema();
    HookWorld::pepper();
    $this->shops = [];
});

afterEach(function (): void {
    $donationIds = DB::table('donations')->whereIn('shop_id', $this->shops)->pluck('id')->all();
    DB::table('payment_mismatches')->whereIn('donation_id', $donationIds)->delete();
    DB::table('activity_log')->whereIn('subject_id', $donationIds)->delete();
    ConcurrencyHarness::cleanup($this->shops, []);
});

afterAll(function (): void {
    ConcurrencyHarness::shutdown();
});

/**
 * @return list<array{scenario: string, args: array<string, string>}>
 */
function settleJobs(Donation $donation, int $paid, string $currency = 'TRY'): array
{
    return array_fill(0, SETTLE_WORKERS, ['scenario' => 'settle', 'args' => [
        'token' => (string) $donation->provider_token,
        'status' => ProviderPaymentStatus::Success->value,
        'paid' => (string) $paid,
        'currency' => $currency,
        'conversation' => (string) $donation->conversation_id,
    ]]);
}

/**
 * @param  list<array<string, mixed>>  $results
 * @return array<string, int>
 */
function settleOutcomes(array $results): array
{
    $counts = [];

    foreach ($results as $result) {
        $key = ($result['ok'] ?? false) ? (string) $result['outcome'] : (string) ($result['code'] ?? 'unknown');
        $counts[$key] = ($counts[$key] ?? 0) + 1;
    }

    ksort($counts);

    return $counts;
}

it('settles one token once under parallel calls and issues exactly qty units', function (): void {
    $shop = PaymentWorld::payableShop();
    $this->shops[] = $shop->id;
    $donation = PaymentWorld::initiated(PaymentWorld::item($shop), qty: 4);

    $results = ConcurrencyHarness::run(settleJobs($donation, $donation->amount_minor), SETTLE_WORKERS);

    expect(settleOutcomes($results))->toBe(['already_paid' => SETTLE_WORKERS - 1, 'paid' => 1])
        ->and($donation->refresh()->status)->toBe(DonationStatus::Paid)
        ->and(Hook::query()->where('donation_id', $donation->id)->count())->toBe(4);
});

it('records one mismatch row under parallel calls with a wrong amount and pays nothing', function (): void {
    $shop = PaymentWorld::payableShop();
    $this->shops[] = $shop->id;
    $donation = PaymentWorld::initiated(PaymentWorld::item($shop), qty: 2);

    $results = ConcurrencyHarness::run(settleJobs($donation, $donation->amount_minor + 100), SETTLE_WORKERS);

    expect(settleOutcomes($results))->toBe(['mismatch' => SETTLE_WORKERS])
        ->and($donation->refresh()->status)->toBe(DonationStatus::Initiated)
        ->and(DB::table('payment_mismatches')->where('donation_id', $donation->id)->count())->toBe(1)
        ->and(DB::table('activity_log')->where('subject_id', $donation->id)->where('event', 'payment.mismatch')->count())->toBe(1)
        ->and(Hook::query()->where('donation_id', $donation->id)->count())->toBe(0);
});
