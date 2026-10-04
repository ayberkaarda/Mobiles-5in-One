<?php

use App\Domain\Donations\Models\DonationStatus;
use App\Domain\Hooks\Models\Hook;
use App\Domain\Payments\Contracts\SettlesPayments;
use App\Domain\Payments\Data\ProviderPaymentStatus;
use App\Domain\Payments\Data\SettlementOutcome;
use App\Domain\Payments\Exceptions\GatewayUnavailable;
use App\Domain\Payments\Gateways\FakeGateway;
use App\Domain\Payments\Jobs\SendDonationReceipt;
use App\Domain\Payments\Mail\DonationReceiptMail;
use App\Domain\Payments\Mail\SettlementMismatchMail;
use App\Domain\Payments\Models\PaymentMismatch;
use App\Domain\Payments\Services\PaymentSettlementService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Queue;
use Tests\Feature\Api\Donations\Support\PaymentWorld;

/*
| PaymentSettlementService (SettlesPayments): the single place where a provider payment
| changes a donation. Security item 17: never trusts posted state, idempotent.
*/

uses(RefreshDatabase::class);

beforeEach(function (): void {
    $this->fake = PaymentWorld::useFakeGateway();
    Queue::fake([SendDonationReceipt::class]);
    Mail::fake();
    config(['payments.finance_alert_email' => 'finance@example.test']);
    $this->item = PaymentWorld::item(PaymentWorld::payableShop());
    $this->donation = PaymentWorld::initiated($this->item, qty: 3);
    $this->token = (string) $this->donation->provider_token;
});

function settle(string $token): SettlementOutcome
{
    return app(SettlesPayments::class)->settle($token);
}

function scriptExact(object $test, ProviderPaymentStatus $status = ProviderPaymentStatus::Success): void
{
    $test->fake->scriptPayment($test->token, $status, $status === ProviderPaymentStatus::Success ? $test->donation->amount_minor : 0, 'TRY', $test->donation->conversation_id);
}

it('is the bound implementation of the settlement contract', function (): void {
    expect(app(SettlesPayments::class))->toBeInstanceOf(PaymentSettlementService::class);
});

it('marks an exactly matching success paid, issues qty units and queues the receipt', function (): void {
    scriptExact($this);

    expect(settle($this->token))->toBe(SettlementOutcome::Paid);

    $donation = $this->donation->refresh();
    expect($donation->status)->toBe(DonationStatus::Paid)
        ->and($donation->paid_at)->not->toBeNull()
        ->and($donation->provider_payment_id)->toStartWith('fake-pay-')
        ->and($donation->hooks_issued_at)->not->toBeNull()
        ->and(Hook::query()->where('donation_id', $donation->id)->count())->toBe(3);
    Queue::assertPushed(SendDonationReceipt::class, fn (SendDonationReceipt $job): bool => $job->donationId === $donation->id);
});

it('changes nothing on replays: one transition, qty units, one receipt', function (): void {
    scriptExact($this);

    $outcomes = [settle($this->token), settle($this->token), settle($this->token)];

    expect($outcomes)->toBe([SettlementOutcome::Paid, SettlementOutcome::AlreadyPaid, SettlementOutcome::AlreadyPaid])
        ->and(Hook::query()->where('donation_id', $this->donation->id)->count())->toBe(3);
    Queue::assertPushedTimes(SendDonationReceipt::class, 1);
});

it('does not ask the provider again once paid', function (): void {
    scriptExact($this);
    settle($this->token);
    $this->fake->scriptUnavailable($this->token);

    expect(settle($this->token))->toBe(SettlementOutcome::AlreadyPaid);
});

it('marks a provider failure failed and leaves a pending payment untouched', function (): void {
    scriptExact($this, ProviderPaymentStatus::Pending);
    expect(settle($this->token))->toBe(SettlementOutcome::Pending)
        ->and($this->donation->refresh()->status)->toBe(DonationStatus::Initiated);

    scriptExact($this, ProviderPaymentStatus::Failure);
    expect(settle($this->token))->toBe(SettlementOutcome::Failed)
        ->and($this->donation->refresh()->status)->toBe(DonationStatus::Failed)
        ->and(Hook::query()->count())->toBe(0);
    Queue::assertNothingPushed();
});

it('records a mismatch instead of paying, once while unresolved, with an alert and a log entry', function (Closure $script, string $kind): void {
    $script($this);

    expect(settle($this->token))->toBe(SettlementOutcome::Mismatch)
        ->and(settle($this->token))->toBe(SettlementOutcome::Mismatch);

    $rows = PaymentMismatch::query()->where('donation_id', $this->donation->id)->get();
    expect($this->donation->refresh()->status)->toBe(DonationStatus::Initiated)
        ->and(Hook::query()->count())->toBe(0)
        ->and($rows->pluck('kind')->all())->toBe([$kind])
        ->and($rows->first()->ours)->toEqual(['status' => 'initiated', 'amount_minor' => $this->donation->amount_minor, 'currency' => 'TRY'])
        ->and(json_encode($rows->first()->theirs))->not->toContain($this->token)
        ->and(DB::table('activity_log')->where('event', 'payment.mismatch')->where('subject_id', $this->donation->id)->count())->toBe(1);
    Mail::assertQueued(SettlementMismatchMail::class, 1);
    Mail::assertQueued(SettlementMismatchMail::class, fn (SettlementMismatchMail $mail): bool => $mail->hasTo('finance@example.test') && $mail->kinds === [$kind]);
    Queue::assertNothingPushed();
})->with([
    'amount' => [fn (object $t) => $t->fake->scriptPayment($t->token, ProviderPaymentStatus::Success, $t->donation->amount_minor - 1, 'TRY', $t->donation->conversation_id), 'amount_mismatch'],
    'currency' => [fn (object $t) => $t->fake->scriptPayment($t->token, ProviderPaymentStatus::Success, $t->donation->amount_minor, 'USD', $t->donation->conversation_id), 'currency_mismatch'],
    'conversation' => [fn (object $t) => $t->fake->scriptPayment($t->token, ProviderPaymentStatus::Success, $t->donation->amount_minor, 'TRY', 'someone-else'), 'conversation_mismatch'],
    'failure of another conversation' => [fn (object $t) => $t->fake->scriptPayment($t->token, ProviderPaymentStatus::Failure, 0, 'TRY', 'someone-else'), 'conversation_mismatch'],
]);

it('flags a provider success for a donation we already failed, without reviving it', function (): void {
    scriptExact($this, ProviderPaymentStatus::Failure);
    settle($this->token);
    scriptExact($this);

    expect(settle($this->token))->toBe(SettlementOutcome::Mismatch)
        ->and($this->donation->refresh()->status)->toBe(DonationStatus::Failed)
        ->and(PaymentMismatch::query()->pluck('kind')->all())->toBe(['provider_paid_ours_failed']);
});

it('answers unknown tokens without touching anything', function (): void {
    expect(settle('fake-not-a-donation'))->toBe(SettlementOutcome::UnknownToken)
        ->and(settle(''))->toBe(SettlementOutcome::UnknownToken);
});

it('lets an unavailable provider surface and changes nothing', function (): void {
    $this->fake->scriptUnavailable($this->token);

    expect(fn () => settle($this->token))->toThrow(GatewayUnavailable::class)
        ->and($this->donation->refresh()->status)->toBe(DonationStatus::Initiated);
});

it('mails a Turkish receipt with item, quantity, amount and commission, and nothing about recipients', function (): void {
    scriptExact($this);
    settle($this->token);

    (new SendDonationReceipt($this->donation->id))->handle();

    $donor = $this->donation->donor()->firstOrFail();
    Mail::assertSent(DonationReceiptMail::class, function (DonationReceiptMail $mail) use ($donor): bool {
        $html = $mail->render();

        return $mail->hasTo($donor->email)
            && str_contains($html, 'Bağış makbuzun')
            && str_contains($html, 'Ekmek')
            && str_contains($html, '45,00 ₺')
            && str_contains($html, 'Esnafa giden')
            && str_contains($html, '42,75 ₺')
            && str_contains($html, 'Platform komisyonu')
            && str_contains($html, '2,25 ₺')
            && ! str_contains($html, (string) $this->token)
            && ! str_contains(mb_strtolower($html), 'anon');
    });
});

it('sends no receipt for an unpaid, anonymised or deactivated donor', function (Closure $prepare): void {
    $prepare($this);

    (new SendDonationReceipt($this->donation->id))->handle();

    Mail::assertNothingSent();
})->with([
    'unpaid' => [fn (object $t) => null],
    'anonymised' => [function (object $t): void {
        scriptExact($t);
        settle($t->token);
        $t->donation->forceFill(['donor_id' => null])->save();
    }],
    'deactivated' => [function (object $t): void {
        scriptExact($t);
        settle($t->token);
        $t->donation->donor()->firstOrFail()->forceFill(['deactivated_at' => now()])->save();
    }],
]);
