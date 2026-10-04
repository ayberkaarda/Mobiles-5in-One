<?php

use App\Domain\Payments\Services\CommissionCalculator;

it('floors the commission at the rounding boundaries (5 percent)', function (int $amount, int $commission): void {
    $calculator = new CommissionCalculator(500);

    expect($calculator->commission($amount))->toBe($commission)
        ->and($calculator->net($amount))->toBe($amount - $commission);
})->with([
    'one kurus' => [1, 0],
    '99 kurus' => [99, 4],
    '100 kurus' => [100, 5],
    '101 kurus' => [101, 5],
    '999 kurus' => [999, 49],
    'the transaction cap' => [200_000, 10_000],
    'the day cap' => [500_000, 25_000],
    'zero' => [0, 0],
]);

it('never books a commission above the amount or below zero', function (): void {
    $calculator = new CommissionCalculator(500);

    foreach ([1, 7, 19, 99, 101, 12_345, 200_000] as $amount) {
        expect($calculator->commission($amount))->toBeGreaterThanOrEqual(0)
            ->and($calculator->commission($amount))->toBeLessThanOrEqual($amount)
            ->and($calculator->commission($amount) + $calculator->net($amount))->toBe($amount);
    }
});

it('takes nothing at zero basis points', function (int $amount): void {
    $calculator = new CommissionCalculator(0);

    expect($calculator->commission($amount))->toBe(0)
        ->and($calculator->net($amount))->toBe($amount);
})->with([1, 99, 200_000]);

it('takes everything at 10000 basis points', function (int $amount): void {
    $calculator = new CommissionCalculator(10_000);

    expect($calculator->commission($amount))->toBe($amount)
        ->and($calculator->net($amount))->toBe(0);
})->with([1, 99, 200_000]);

it('rejects negative amounts', function (): void {
    $calculator = new CommissionCalculator(500);

    expect(fn () => $calculator->commission(-1))->toThrow(InvalidArgumentException::class)
        ->and(fn () => $calculator->net(-100))->toThrow(InvalidArgumentException::class);
});

it('rejects basis points outside 0..10000', function (int $bps): void {
    expect(fn () => new CommissionCalculator($bps))->toThrow(InvalidArgumentException::class);
})->with([-1, 10_001]);

it('is built from the configured rate', function (): void {
    config(['payments.commission_bps' => 250]);
    app()->forgetInstance(CommissionCalculator::class);

    expect(app(CommissionCalculator::class)->basisPoints())->toBe(250)
        ->and(app(CommissionCalculator::class)->commission(1_000))->toBe(25);
});

it('ships the sample rate of 5 percent as the default', function (): void {
    expect(config('payments.commission_bps'))->toBe(500);
});
