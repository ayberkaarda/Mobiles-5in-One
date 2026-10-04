<?php

use App\Domain\Shops\Support\TurkishIban;
use App\Domain\Shops\Support\TurkishTaxNumber;
use Tests\Feature\Api\Shops\Support\ShopTestKit;

it('accepts random checksum-valid tax numbers and rejects every single-digit change of the check digit', function (): void {
    for ($run = 0; $run < 50; $run++) {
        $tax = ShopTestKit::taxNumber();
        expect(TurkishTaxNumber::isValid($tax))->toBeTrue();

        for ($delta = 1; $delta <= 9; $delta++) {
            $wrong = substr($tax, 0, 9).(((int) $tax[9] + $delta) % 10);
            expect(TurkishTaxNumber::isValid($wrong))->toBeFalse();
        }
    }
});

it('computes the VKN check digit with the published weights', function (): void {
    // 000000000: every shifted digit is 9 - i, so the weighted values are fixed by hand.
    $sum = 0;
    for ($i = 0; $i < 9; $i++) {
        $shifted = (9 - $i) % 10;
        $weighted = ($shifted * (2 ** (9 - $i))) % 9;
        $sum += ($shifted !== 0 && $weighted === 0) ? 9 : $weighted;
    }

    expect(TurkishTaxNumber::checkDigit('000000000'))->toBe((10 - $sum % 10) % 10);
});

it('rejects malformed tax numbers', function (string $value): void {
    expect(TurkishTaxNumber::isValid($value))->toBeFalse();
})->with(['', '123', '12345678901', '12345abcde', ' 123456789']);

it('accepts random checksum-valid IBANs and rejects altered ones', function (): void {
    for ($run = 0; $run < 50; $run++) {
        $iban = ShopTestKit::iban();
        expect(TurkishIban::isValid($iban))->toBeTrue();

        $position = random_int(4, 25);
        $altered = substr_replace($iban, (string) (((int) $iban[$position] + 1) % 10), $position, 1);
        expect(TurkishIban::isValid($altered))->toBeFalse();

        $swapped = substr_replace($iban, $iban[5].$iban[4], 4, 2);
        if ($iban[4] !== $iban[5]) {
            expect(TurkishIban::isValid($swapped))->toBeFalse();
        }
    }
});

it('rejects non-Turkish or malformed IBANs', function (string $value): void {
    expect(TurkishIban::isValid($value))->toBeFalse();
})->with([
    'other country' => 'DE'.str_repeat('0', 24),
    'too short' => 'TR'.str_repeat('0', 20),
    'letters in the account' => 'TR'.str_repeat('0', 20).'ABCD',
]);

it('normalises spaces, dashes and case', function (): void {
    $iban = ShopTestKit::iban();

    expect(TurkishIban::normalise(strtolower(implode(' ', str_split($iban, 4)))))->toBe($iban)
        ->and(TurkishIban::normalise(implode('-', str_split($iban, 4))))->toBe($iban);
});

it('masks to the last four digits', function (): void {
    expect(TurkishTaxNumber::mask('1234567890'))->toBe('******7890')
        ->and(TurkishTaxNumber::mask(null))->toBeNull()
        ->and(TurkishIban::mask('TR'.str_repeat('1', 20).'9876'))->toBe('TR'.str_repeat('*', 20).'9876')
        ->and(TurkishIban::mask(null))->toBeNull();
});
