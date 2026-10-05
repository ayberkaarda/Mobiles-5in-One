<?php

use App\Domain\Auth\Abilities\AdminRole;
use App\Domain\Donations\Models\Donation;
use App\Domain\Donations\Models\DonationStatus;
use App\Domain\Hooks\Models\Hook;
use App\Domain\Hooks\Models\HookStatus;
use App\Domain\Items\Models\Item;
use App\Domain\Payments\Contracts\PaymentGateway;
use App\Domain\Payments\Data\RefundResult;
use App\Domain\Payments\Exceptions\GatewayUnavailable;
use App\Domain\Payments\Listeners\OnShopRejectedRefund;
use App\Domain\Payments\Mail\DonationRefundedMail;
use App\Domain\Payments\Mail\PaymentMismatchAlertMail;
use App\Domain\Payments\Models\DonationRefund;
use App\Domain\Payments\Models\DonationRefundStatus;
use App\Domain\Payments\Models\PaymentMismatch;
use App\Domain\Payments\Services\RefundOutcome;
use App\Domain\Payments\Services\RefundService;
use App\Domain\Shops\Events\ShopRejected;
use App\Domain\Shops\Models\Shop;
use App\Models\User;
use Database\Seeders\RolesSeeder;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Spatie\Activitylog\Models\Activity;
use Tests\Support\ScriptedPaymentGateway;

/*
| RefundService: refunds the unredeemed units of a paid donation once, expires its open
| units (releasing reservations), never touches redeemed units, and changes the status
| only after the provider confirmed.
*/

uses(RefreshDatabase::class);

beforeEach(function (): void {
    Mail::fake();
    config(['payments.finance_alert_email' => 'finance-'.Str::lower(Str::random(6)).'@example.test']);
    $this->gateway = new ScriptedPaymentGateway;
    $this->app->instance(PaymentGateway::class, $this->gateway);
});

/**
 * A paid donation of `qty` units at 1500 kuruş with units in the given states.
 *
 * @param  list<string>  $states  available|reserved|redeemed per unit
 */
function refundableDonation(array $states, int $qty = 4): Donation
{
    $item = Item::factory()->create(['price_minor' => 1500]);
    $donation = Donation::factory()->paid()->create([
        'item_id' => $item->id,
        'qty' => $qty,
        'amount_minor' => 1500 * $qty,
        'commission_minor' => 75 * $qty,
    ]);

    foreach ($states as $state) {
        $factory = Hook::factory()->state(['donation_id' => $donation->id]);
        $factory = match ($state) {
            'reserved' => $factory->reserved(),
            'redeemed' => $factory->redeemed(),
            default => $factory,
        };
        $factory->create();
    }

    return $donation;
}

/**
 * @return array<string, int>
 */
function hookStates(Donation $donation): array
{
    return Hook::query()->where('donation_id', $donation->id)->get()
        ->countBy(fn (Hook $hook): string => $hook->status->value)
        ->sortKeys()
        ->all();
}

function refunds(): RefundService
{
    return app(RefundService::class);
}

function refundFinance(): User
{
    (new RolesSeeder)->run();
    $finance = User::factory()->create();
    $finance->assignRole(AdminRole::Finance->value);

    return $finance;
}

it('refunds only the unredeemed units of a mixed donation and expires the open ones', function (): void {
    $donation = refundableDonation(['available', 'available', 'reserved', 'redeemed']);
    $finance = User::factory()->create();
    $redeemedBefore = Hook::query()->where('donation_id', $donation->id)->where('status', 'REDEEMED')->sole();

    $outcome = refunds()->refundDonation($donation, 'shop_rejected', $finance);

    expect($outcome)->toBe(RefundOutcome::Refunded)
        ->and($donation->fresh()?->status)->toBe(DonationStatus::Refunded)
        ->and(hookStates($donation))->toBe(['EXPIRED' => 3, 'REDEEMED' => 1])
        ->and($this->gateway->refunds)->toHaveCount(1)
        ->and($this->gateway->refunds[0]->amountMinor)->toBe(3 * 1500)
        ->and($this->gateway->refunds[0]->idempotencyKey)->toBe('refund:'.$donation->id)
        ->and($this->gateway->refunds[0]->providerPaymentId)->toBe($donation->provider_payment_id);

    $redeemedAfter = $redeemedBefore->fresh();
    expect($redeemedAfter?->status)->toBe(HookStatus::Redeemed)
        ->and($redeemedAfter?->code_hash)->toBe($redeemedBefore->code_hash)
        ->and($redeemedAfter?->redeemed_at?->equalTo($redeemedBefore->redeemed_at))->toBeTrue();

    // The reservation is released consistently: no reservation column survives.
    $expired = Hook::query()->where('donation_id', $donation->id)->where('status', 'EXPIRED')->get();
    foreach ($expired as $hook) {
        expect($hook->anon_id)->toBeNull()
            ->and($hook->code_hash)->toBeNull()
            ->and($hook->reserved_at)->toBeNull()
            ->and($hook->expires_at)->toBeNull();
    }

    $log = Activity::query()->where('log_name', 'payments')->where('event', 'donation.refunded')->sole();
    expect($log->causer_id)->toBe($finance->id)
        ->and($log->properties->toArray())->toMatchArray(['donation_id' => $donation->id, 'units' => 3, 'refunded_minor' => 4500, 'reason' => 'shop_rejected']);

    Mail::assertQueued(DonationRefundedMail::class, fn (DonationRefundedMail $mail): bool => $mail->hasTo((string) $donation->donor?->email)
        && $mail->units === 3
        && $mail->amountMinor === 4500);
});

it('does nothing on a second call', function (): void {
    $donation = refundableDonation(['available', 'reserved']);

    expect(refunds()->refundDonation($donation, 'finance', null))->toBe(RefundOutcome::Refunded)
        ->and(refunds()->refundDonation($donation->fresh() ?? $donation, 'finance', null))->toBe(RefundOutcome::AlreadyRefunded)
        ->and($this->gateway->refunds)->toHaveCount(1)
        ->and(Activity::query()->where('event', 'donation.refunded')->count())->toBe(1);

    Mail::assertQueued(DonationRefundedMail::class, 1);
});

it('keeps the status and records a mismatch when the provider refuses', function (): void {
    $donation = refundableDonation(['available', 'reserved', 'redeemed'], 3);
    $this->gateway->nextRefund = new RefundResult(false, null, 0);

    expect(refunds()->refundDonation($donation, 'finance', null))->toBe(RefundOutcome::Failed)
        ->and($donation->fresh()?->status)->toBe(DonationStatus::Paid)
        ->and(hookStates($donation))->toBe(['EXPIRED' => 2, 'REDEEMED' => 1]);

    $mismatch = PaymentMismatch::query()->sole();
    expect($mismatch->kind)->toBe('refund_failed')
        ->and($mismatch->ours)->toMatchArray(['status' => 'paid', 'refund_minor' => 3000, 'units' => 2, 'cause' => 'refused'])
        ->and($mismatch->theirs)->toMatchArray(['succeeded' => false]);

    Mail::assertQueued(PaymentMismatchAlertMail::class, 1);
    Mail::assertNotQueued(DonationRefundedMail::class);

    // Finance retries later: the expired units are still refunded with the same key.
    $this->gateway->nextRefund = null;
    expect(refunds()->refundDonation($donation->fresh() ?? $donation, 'finance', null))->toBe(RefundOutcome::Refunded)
        ->and($this->gateway->refunds[1]->amountMinor)->toBe(3000)
        ->and($this->gateway->refunds[1]->idempotencyKey)->toBe('refund:'.$donation->id);
});

it('keeps the status, records a mismatch and rethrows while the provider is unavailable', function (): void {
    $donation = refundableDonation(['available']);
    $this->gateway->nextRefund = new GatewayUnavailable;

    expect(fn () => refunds()->refundDonation($donation, 'finance', null))->toThrow(GatewayUnavailable::class);

    expect($donation->fresh()?->status)->toBe(DonationStatus::Paid)
        ->and(PaymentMismatch::query()->sole()->ours['cause'])->toBe('provider_unavailable')
        ->and(hookStates($donation))->toBe(['EXPIRED' => 1]);
});

it('treats a confirmed refund of another amount as a failure', function (): void {
    $donation = refundableDonation(['available', 'available']);
    $this->gateway->nextRefund = new RefundResult(true, 'sample-refund-x', 1500);

    expect(refunds()->refundDonation($donation, 'finance', null))->toBe(RefundOutcome::Failed)
        ->and($donation->fresh()?->status)->toBe(DonationStatus::Paid)
        ->and(PaymentMismatch::query()->sole()->ours['cause'])->toBe('amount_differs');
});

it('refunds nothing when every unit was redeemed', function (): void {
    $donation = refundableDonation(['redeemed', 'redeemed'], 2);

    expect(refunds()->refundDonation($donation, 'finance', null))->toBe(RefundOutcome::NothingToRefund)
        ->and($donation->fresh()?->status)->toBe(DonationStatus::Paid)
        ->and($this->gateway->refunds)->toBe([])
        ->and(hookStates($donation))->toBe(['REDEEMED' => 2]);
});

it('refuses donations that are not paid', function (string $status): void {
    $donation = Donation::factory()->create(['status' => $status]);

    expect(refunds()->refundDonation($donation, 'finance', null))->toBe(RefundOutcome::NotRefundable)
        ->and($this->gateway->refunds)->toBe([]);
})->with(['initiated', 'failed']);

it('records a mismatch when the donation has no provider payment id', function (): void {
    $donation = refundableDonation(['available'], 1);
    DB::table('donations')->where('id', $donation->id)->update(['provider_payment_id' => null]);

    expect(refunds()->refundDonation($donation, 'finance', null))->toBe(RefundOutcome::Failed)
        ->and($this->gateway->refunds)->toBe([])
        ->and(PaymentMismatch::query()->sole()->ours['cause'])->toBe('missing_payment_id');
});

it('stops a reserved code from being redeemed after the refund expired it', function (): void {
    $donation = refundableDonation(['reserved'], 1);
    $hook = Hook::query()->where('donation_id', $donation->id)->sole();

    refunds()->refundDonation($donation, 'finance', null);

    // The redeem engine only redeems RESERVED rows: the expired unit no longer qualifies.
    $redeemed = DB::table('hooks')->where('id', $hook->id)->where('status', 'RESERVED')
        ->update(['status' => 'REDEEMED', 'redeemed_at' => now()]);

    expect($redeemed)->toBe(0)
        ->and($hook->fresh()?->status)->toBe(HookStatus::Expired);
});

it('skips the donor mail for an anonymised donation', function (): void {
    $donation = refundableDonation(['available'], 1);
    DB::table('donations')->where('id', $donation->id)->update(['donor_id' => null, 'anonymized_at' => now()]);

    expect(refunds()->refundDonation($donation, 'finance', null))->toBe(RefundOutcome::Refunded);
    Mail::assertNotQueued(DonationRefundedMail::class);
});

it('refunds the open donations of a rejected shop through the queued listener', function (): void {
    $open = refundableDonation(['available', 'reserved', 'redeemed']);
    $shop = Shop::query()->findOrFail($open->shop_id);
    $otherItem = Item::factory()->create(['shop_id' => $shop->id, 'price_minor' => 1500]);
    $done = Donation::factory()->paid()->create(['item_id' => $otherItem->id, 'qty' => 1, 'amount_minor' => 1500]);
    Hook::factory()->redeemed()->create(['donation_id' => $done->id]);
    $elsewhere = refundableDonation(['available'], 1);
    $moderator = User::factory()->create();

    expect(Event::hasListeners(ShopRejected::class))->toBeTrue()
        ->and(in_array(ShouldQueue::class, class_implements(OnShopRejectedRefund::class), true))->toBeTrue();

    app(OnShopRejectedRefund::class)->handle(new ShopRejected($shop->id, $moderator->id));

    expect($open->fresh()?->status)->toBe(DonationStatus::Refunded)
        ->and($done->fresh()?->status)->toBe(DonationStatus::Paid)
        ->and($elsewhere->fresh()?->status)->toBe(DonationStatus::Paid)
        ->and($this->gateway->refunds)->toHaveCount(1)
        ->and(Activity::query()->where('event', 'donation.refunded')->sole()->causer_id)->toBe($moderator->id);
});

it('picks up a donation whose units an earlier attempt already expired once finance recorded the outage outcome', function (): void {
    $donation = refundableDonation(['available', 'redeemed'], 2);
    $this->gateway->nextRefund = new GatewayUnavailable;
    $listener = app(OnShopRejectedRefund::class);
    $event = new ShopRejected($donation->shop_id, User::factory()->create()->id);

    expect(fn () => $listener->handle($event))->toThrow(GatewayUnavailable::class);

    // The queue retries the listener: the outcome at the provider is unknown, so no call.
    $this->gateway->nextRefund = null;
    $listener->handle($event);
    expect($this->gateway->refunds)->toHaveCount(1)
        ->and($donation->fresh()?->status)->toBe(DonationStatus::Paid);

    // Finance checks the provider: nothing was refunded. The next run refunds the unit.
    expect(refunds()->resolveUnresolved($donation, refundFinance(), false, 'Sağlayıcıda iade görünmüyor'))->toBe(RefundOutcome::Failed);
    $listener->handle($event);

    expect($donation->fresh()?->status)->toBe(DonationStatus::Refunded)
        ->and($this->gateway->refunds)->toHaveCount(2)
        ->and(end($this->gateway->refunds)->amountMinor)->toBe(1500);
});

it('completes an open refund that finance found refunded at the provider, with the commission share', function (): void {
    $donation = refundableDonation(['available', 'available', 'available', 'redeemed']);
    $this->gateway->nextRefund = new GatewayUnavailable;
    expect(fn () => refunds()->refundDonation($donation, 'finance', null))->toThrow(GatewayUnavailable::class);
    $finance = refundFinance();

    expect(refunds()->hasUnresolved($donation))->toBeTrue()
        ->and(refunds()->resolveUnresolved($donation, $finance, true, 'Sağlayıcı panelinde iade var'))->toBe(RefundOutcome::Refunded)
        ->and(refunds()->hasUnresolved($donation))->toBeFalse()
        ->and($donation->fresh()?->status)->toBe(DonationStatus::Refunded)
        ->and($this->gateway->refunds)->toHaveCount(1);

    $claim = DonationRefund::query()->sole();
    // 4 units, 300 commission: the platform keeps the commission of the redeemed unit (75).
    expect($claim->status)->toBe(DonationRefundStatus::Succeeded)
        ->and($claim->amount_minor)->toBe(4500)
        ->and($claim->commission_minor)->toBe(225)
        ->and(Activity::query()->where('event', 'donation.refunded')->sole()->causer_id)->toBe($finance->id);
});

it('refuses to record a refund outcome without the refund gate', function (): void {
    $donation = refundableDonation(['available'], 1);

    expect(fn () => refunds()->resolveUnresolved($donation, User::factory()->create(), true, 'not allowed'))
        ->toThrow(AuthorizationException::class);
});

it('lets only one of two overlapping calls reach the provider', function (): void {
    // A 4-unit donation with three redeemed units: one unit (1500 kuruş) is refundable.
    $donation = refundableDonation(['redeemed', 'redeemed', 'redeemed', 'available']);
    $overlapping = null;
    $this->gateway->duringRefund = function () use ($donation, &$overlapping): void {
        $overlapping = refunds()->refundDonation(Donation::query()->findOrFail($donation->id), 'finance', null);
    };

    $outcome = refunds()->refundDonation($donation, 'finance', null);

    expect($this->gateway->refunds)->toHaveCount(1)
        ->and(array_sum(array_map(fn ($request): int => $request->amountMinor, $this->gateway->refunds)))->toBe(1500)
        ->and($outcome)->toBe(RefundOutcome::Refunded)
        ->and($overlapping)->toBe(RefundOutcome::Unresolved)
        ->and($donation->fresh()?->status)->toBe(DonationStatus::Refunded);
});

it('does not call the provider again after an uncertain outcome until finance records it', function (Closure $first, string $cause): void {
    $donation = refundableDonation(['available', 'available']);
    $first($this->gateway);

    try {
        refunds()->refundDonation($donation, 'finance', null);
    } catch (GatewayUnavailable) {
        // An outage after the request may have left: the provider outcome is unknown.
    }

    $this->gateway->nextRefund = null;

    expect(refunds()->refundDonation($donation->fresh() ?? $donation, 'finance', null))->toBe(RefundOutcome::Unresolved)
        ->and($this->gateway->refunds)->toHaveCount(1)
        ->and($donation->fresh()?->status)->toBe(DonationStatus::Paid)
        ->and(PaymentMismatch::query()->sole()->ours['cause'])->toBe($cause);
})->with([
    'outage' => [fn (ScriptedPaymentGateway $g) => $g->nextRefund = new GatewayUnavailable, 'provider_unavailable'],
    'another amount' => [fn (ScriptedPaymentGateway $g) => $g->nextRefund = new RefundResult(true, 'sample-refund-x', 1500), 'amount_differs'],
]);
