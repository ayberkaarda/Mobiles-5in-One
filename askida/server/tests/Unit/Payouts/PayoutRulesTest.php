<?php

use App\Domain\Fraud\Models\AbuseFlagKind;
use App\Domain\Payments\Models\PayoutStatus;
use App\Domain\Payouts\Data\LedgerDay;
use App\Domain\Payouts\Services\PayoutSynchronizer;
use Carbon\CarbonImmutable;

it('maps the provider settlement states to the database vocabulary', function (): void {
    expect(PayoutSynchronizer::STATUS_MAP)->toBe([
        'pending' => PayoutStatus::Pending,
        'paid' => PayoutStatus::Settled,
        'failed' => PayoutStatus::Failed,
    ]);
});

it('computes the net amount from the stored commission', function (): void {
    expect((new LedgerDay('2026-10-04', 14_001, 700, 2, 'none', null))->netMinor())->toBe(13_301)
        ->and((new LedgerDay('2026-10-04', 0, 0, 0, 'none', null))->netMinor())->toBe(0);
});

it('holds payouts only for the fraud kinds', function (): void {
    expect(AbuseFlagKind::fraudKinds())->not->toContain(AbuseFlagKind::OnboardingFailed)
        ->and(AbuseFlagKind::RedeemRate->holdReason())->toBe('fraud.redeem_rate');
});

it('covers the last fourteen Istanbul days up to today', function (): void {
    $period = PayoutSynchronizer::period(CarbonImmutable::parse('2026-10-03 22:30:00', 'UTC'));

    expect($period->getStartDate()->toDateString())->toBe('2026-09-20')
        ->and($period->getEndDate()?->toDateString())->toBe('2026-10-04');
});
