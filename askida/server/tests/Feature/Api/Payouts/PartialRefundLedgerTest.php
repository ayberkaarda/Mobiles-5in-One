<?php

use App\Domain\Donations\Models\Donation;
use App\Domain\Hooks\Models\Hook;
use App\Domain\Payments\Contracts\PaymentGateway;
use App\Domain\Payments\Services\RefundOutcome;
use App\Domain\Payments\Services\RefundService;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Tests\Feature\Api\Hooks\Support\HookWorld;
use Tests\Support\ScriptedPaymentGateway;

/*
| The owner ledger after a partial refund: the redeemed units stay with the shop (and
| their commission with the platform); only the refunded units leave the totals.
*/

uses(RefreshDatabase::class);

beforeEach(function (): void {
    HookWorld::pepper();
    Mail::fake();
    $this->travelTo(CarbonImmutable::parse('2026-10-04 12:00:00', 'Europe/Istanbul'));
    $this->app->instance(PaymentGateway::class, new ScriptedPaymentGateway);
});

/**
 * A paid four-unit donation (1500 kuruş per unit, 75 commission per unit) with the given
 * number of redeemed units; the rest are available.
 */
function ledgerRefundDonation(int $redeemed): Donation
{
    $shop = HookWorld::shop();
    $item = HookWorld::item($shop);
    $donation = Donation::factory()->paid()->create([
        'item_id' => $item->id,
        'qty' => 4,
        'amount_minor' => 6_000,
        'commission_minor' => 300,
    ]);

    for ($i = 0; $i < 4; $i++) {
        $factory = Hook::factory()->state(['donation_id' => $donation->id]);
        ($i < $redeemed ? $factory->redeemed() : $factory)->create();
    }

    return $donation;
}

function ledgerToday(Donation $donation): array
{
    $shop = $donation->shop()->firstOrFail();
    app('auth')->forgetGuards();

    $response = test()->getJson("/api/v1/shops/{$shop->id}/payouts", ['Authorization' => 'Bearer '.HookWorld::userToken(HookWorld::owner($shop))])->assertOk();

    return collect($response->json('data'))->firstWhere('date', '2026-10-04') ?? [];
}

it('keeps the redeemed unit and its commission in the ledger after refunding the other three', function (): void {
    $donation = ledgerRefundDonation(redeemed: 1);

    expect(app(RefundService::class)->refundDonation($donation, 'finance', null))->toBe(RefundOutcome::Refunded);

    expect(ledgerToday($donation))->toMatchArray([
        'donated_minor' => 1_500,
        'commission_minor' => 75,
        'net_minor' => 1_425,
    ]);
});

it('drops a fully refunded donation from the totals', function (): void {
    $donation = ledgerRefundDonation(redeemed: 0);

    expect(app(RefundService::class)->refundDonation($donation, 'finance', null))->toBe(RefundOutcome::Refunded);

    $day = ledgerToday($donation);
    expect($day['donated_minor'] ?? 0)->toBe(0)
        ->and($day['commission_minor'] ?? 0)->toBe(0);
});
