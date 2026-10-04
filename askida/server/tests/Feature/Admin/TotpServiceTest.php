<?php

use App\Domain\Admin\Services\Base32;
use App\Domain\Admin\Services\TotpService;

/*
| RFC 6238 (TOTP over RFC 4226 HOTP, SHA-1). The RFC test key is the ASCII digits
| 1..9,0 twice; it is built here at run time, never stored as a literal secret.
*/

function rfcKey(): string
{
    return str_repeat(implode('', range(1, 9)).'0', 2);
}

it('matches the RFC 6238 SHA-1 test vectors', function (int $time, string $eightDigits): void {
    $totp = new TotpService;
    $secret = Base32::encode(rfcKey());

    expect(TotpService::hotp(rfcKey(), intdiv($time, 30), 8))->toBe($eightDigits)
        ->and($totp->codeAt($secret, $time))->toBe(substr($eightDigits, -6));
})->with([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
]);

it('round-trips base32 and creates 160-bit secrets that differ each time', function (): void {
    $totp = new TotpService;
    $a = $totp->generateSecret();
    $b = $totp->generateSecret();

    expect(strlen(Base32::decode($a)))->toBe(20)
        ->and($a)->toMatch('/\A[A-Z2-7]{32}\z/')
        ->and($a)->not->toBe($b)
        ->and(Base32::decode(Base32::encode(rfcKey())))->toBe(rfcKey());
});

it('accepts one step before and after now and nothing further', function (int $offset, bool $accepted): void {
    $totp = new TotpService;
    $secret = $totp->generateSecret();
    $now = 1_800_000_015;
    $code = $totp->codeAt($secret, $now + 30 * $offset);

    expect($totp->verify($secret, $code, null, $now) !== null)->toBe($accepted);
})->with([
    'two steps early' => [-2, false],
    'one step early' => [-1, true],
    'current' => [0, true],
    'one step late' => [1, true],
    'two steps late' => [2, false],
]);

it('refuses the same step twice and any step not newer than the last one used', function (): void {
    $totp = new TotpService;
    $secret = $totp->generateSecret();
    $now = 1_800_000_015;
    $code = $totp->codeAt($secret, $now);

    $step = $totp->verify($secret, $code, null, $now);
    expect($step)->toBe(intdiv($now, 30))
        ->and($totp->verify($secret, $code, $step, $now))->toBeNull()
        ->and($totp->verify($secret, $totp->codeAt($secret, $now - 30), $step, $now))->toBeNull()
        ->and($totp->verify($secret, $totp->codeAt($secret, $now + 30), $step, $now))->toBe($step + 1);
});

it('refuses malformed and wrong codes', function (string $code): void {
    $totp = new TotpService;
    $secret = $totp->generateSecret();

    expect($totp->verify($secret, $code, null, 1_800_000_015))->toBeNull();
})->with(['', '12345', '1234567', 'abcdef', '12 34 5x']);

it('compares codes in constant time', function (): void {
    $source = (string) file_get_contents(app_path('Domain/Admin/Services/TotpService.php'));

    expect($source)->toContain('hash_equals(')
        ->and($source)->not->toMatch('/===\s*\$code|\$code\s*===/');
});

it('builds an otpauth provisioning URI with the issuer, account and parameters', function (): void {
    $totp = new TotpService;
    $secret = $totp->generateSecret();
    $uri = $totp->provisioningUri($secret, 'staff@example.test', 'Askida');

    expect($uri)->toStartWith('otpauth://totp/Askida:staff%40example.test?')
        ->and($uri)->toContain('secret='.$secret)
        ->and($uri)->toContain('issuer=Askida')
        ->and($uri)->toContain('digits=6')
        ->and($uri)->toContain('period=30');
});
