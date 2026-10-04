<?php

use App\Domain\Admin\Contracts\HoldsPayouts;
use App\Domain\Admin\Contracts\RefundsDonations;
use App\Domain\Auth\Abilities\AdminRole;
use App\Domain\Donations\Models\Donation;
use App\Domain\Donations\Models\DonationStatus;
use App\Domain\Hooks\Models\Hook;
use App\Domain\Payments\Contracts\PaymentGateway;
use App\Domain\Payments\Exceptions\GatewayUnavailable;
use App\Domain\Payments\Models\DonationRefund;
use App\Domain\Payments\Models\DonationRefundStatus;
use App\Domain\Payments\Models\Payout;
use App\Domain\Payments\Models\PayoutStatus;
use App\Domain\Payouts\Exceptions\PayoutNotHoldable;
use App\Filament\Resources\DonationResource\Pages\ListDonations;
use App\Filament\Resources\PayoutResource\Pages\ListPayouts;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Livewire\Livewire;
use Spatie\Activitylog\Models\Activity;
use Tests\Feature\Admin\Support\AdminTestKit;
use Tests\Support\ScriptedPaymentGateway;

/*
| The finance tools of the panel run on the production domain services: refunds through
| RefundService, hold and release through the payouts domain, each authorized by the
| admin gates and transactional.
*/

uses(RefreshDatabase::class);

beforeEach(function (): void {
    AdminTestKit::boot();
    Mail::fake();
    $this->gateway = new ScriptedPaymentGateway;
    $this->app->instance(PaymentGateway::class, $this->gateway);
});

function financeDonation(): Donation
{
    $donation = Donation::factory()->paid()->create(['qty' => 2, 'amount_minor' => 3_000, 'commission_minor' => 150]);
    Hook::factory()->count(2)->state(['donation_id' => $donation->id])->create();

    return $donation;
}

it('binds the panel contracts to the domain services', function (): void {
    expect(app()->bound(RefundsDonations::class))->toBeTrue()
        ->and(app()->bound(HoldsPayouts::class))->toBeTrue();
});

it('refunds a paid donation from the panel through the refund service', function (): void {
    $finance = AdminTestKit::signIn(AdminTestKit::staff(AdminRole::Finance));
    $donation = financeDonation();

    Livewire::test(ListDonations::class)
        ->callTableAction('refund', $donation, data: ['reason' => 'İşletme kapandı'])
        ->assertHasNoTableActionErrors();

    expect($donation->refresh()->status)->toBe(DonationStatus::Refunded)
        ->and($this->gateway->refunds)->toHaveCount(1)
        ->and($this->gateway->refunds[0]->amountMinor)->toBe(3_000)
        ->and(Activity::query()->where('event', 'donation.refunded')->sole()->causer_id)->toBe($finance->id);
});

it('keeps the panel working when the provider is down during a refund', function (): void {
    AdminTestKit::signIn(AdminTestKit::staff(AdminRole::Finance));
    $donation = financeDonation();
    $this->gateway->nextRefund = new GatewayUnavailable;

    Livewire::test(ListDonations::class)
        ->callTableAction('refund', $donation, data: ['reason' => 'İşletme kapandı'])
        ->assertHasNoTableActionErrors();

    expect($donation->refresh()->status)->toBe(DonationStatus::Paid)
        ->and(DonationRefund::query()->sole()->status)->toBe(DonationRefundStatus::Uncertain);
});

it('records the provider outcome of an uncertain refund from the panel', function (bool $refundedAtProvider, DonationStatus $status, int $providerCalls): void {
    $finance = AdminTestKit::signIn(AdminTestKit::staff(AdminRole::Finance));
    $donation = financeDonation();
    // The provider times out: whether the refund happened is unknown.
    $this->gateway->nextRefund = new GatewayUnavailable;
    app(RefundsDonations::class)->refund($donation, $finance, 'İşletme kapandı');
    $this->gateway->nextRefund = null;

    Livewire::test(ListDonations::class)
        ->assertTableActionHidden('refund', $donation)
        ->callTableAction('resolve_refund', $donation, data: ['refunded' => $refundedAtProvider ? '1' : '0', 'note' => 'Sağlayıcı panelinde kontrol edildi'])
        ->assertHasNoTableActionErrors();

    if (! $refundedAtProvider) {
        // Not refunded at the provider: the refund can be claimed again.
        app(RefundsDonations::class)->refund($donation->refresh(), $finance, 'İkinci deneme');
    }

    expect($donation->refresh()->status)->toBe($status)
        ->and($this->gateway->refunds)->toHaveCount($providerCalls)
        ->and(Activity::query()->where('event', 'admin.refund_outcome_recorded')->value('causer_id'))->toBe($finance->id);
})->with([
    'refunded at the provider' => [true, DonationStatus::Refunded, 1],
    'not refunded at the provider' => [false, DonationStatus::Refunded, 2],
]);

it('refuses refunds and refund outcomes to users without the refund gate', function (): void {
    $moderator = AdminTestKit::staff(AdminRole::Moderator);
    $donation = financeDonation();

    expect(fn () => app(RefundsDonations::class)->refund($donation, $moderator, 'no access'))->toThrow(AuthorizationException::class)
        ->and($this->gateway->refunds)->toBe([])
        ->and($donation->refresh()->status)->toBe(DonationStatus::Paid);
});

it('holds a pending payout and releases it from the panel with the domain service', function (): void {
    $finance = AdminTestKit::signIn(AdminTestKit::staff(AdminRole::Finance));
    $payout = Payout::factory()->create(['status' => PayoutStatus::Pending]);

    Livewire::test(ListPayouts::class)
        ->callTableAction('hold', $payout, data: ['reason' => 'Olağandışı kullanım oranı'])
        ->assertHasNoTableActionErrors();

    expect($payout->refresh())
        ->hold->toBeTrue()
        ->status->toBe(PayoutStatus::Held)
        ->hold_reason->toBe('manual: Olağandışı kullanım oranı')
        ->and(Activity::query()->where('log_name', 'payouts')->where('event', 'payout.held')->sole()->causer_id)->toBe($finance->id);

    Livewire::test(ListPayouts::class)
        ->callTableAction('release', $payout, data: ['reason' => 'İnceleme tamamlandı'])
        ->assertHasNoTableActionErrors();

    expect($payout->refresh())
        ->hold->toBeFalse()
        ->status->toBe(PayoutStatus::Pending)
        ->and(Activity::query()->where('log_name', 'payouts')->where('event', 'payout.released')->sole()->causer_id)->toBe($finance->id);
});

it('does not offer or allow a manual hold of a settled or failed payout', function (PayoutStatus $status): void {
    $finance = AdminTestKit::signIn(AdminTestKit::staff(AdminRole::Finance));
    $payout = Payout::factory()->create(['status' => $status]);

    Livewire::test(ListPayouts::class)->assertTableActionHidden('hold', $payout);

    expect(fn () => app(HoldsPayouts::class)->hold($payout, $finance, 'Olağandışı kullanım'))->toThrow(PayoutNotHoldable::class)
        ->and($payout->refresh()->hold)->toBeFalse();
})->with([PayoutStatus::Settled, PayoutStatus::Failed]);

it('refuses hold and release to users without the payout gate', function (): void {
    $moderator = AdminTestKit::staff(AdminRole::Moderator);
    $payout = Payout::factory()->create(['status' => PayoutStatus::Pending]);

    expect(fn () => app(HoldsPayouts::class)->hold($payout, $moderator, 'no access here'))->toThrow(AuthorizationException::class)
        ->and($payout->refresh()->hold)->toBeFalse();
});
