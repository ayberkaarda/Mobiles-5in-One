<?php

use App\Domain\Hooks\Codes\HookCode;
use App\Domain\Hooks\Codes\HookCodeGenerator;
use App\Domain\Hooks\Codes\HookCodeHasher;

/*
| Code format (security item 6) and storage as HMAC-SHA256 with HOOK_CODE_PEPPER
| (security item 11).
*/

it('uses a 32 symbol alphabet without I, L, O and U', function (): void {
    $symbols = str_split(HookCode::ALPHABET);

    expect($symbols)->toHaveCount(32)
        ->and(array_unique($symbols))->toHaveCount(32)
        ->and(array_intersect($symbols, ['I', 'L', 'O', 'U']))->toBe([]);

    foreach ($symbols as $symbol) {
        expect(preg_match('/^[0-9A-HJKMNP-TV-Z]$/', $symbol))->toBe(1);
    }
});

it('generates valid 8 character codes over the whole alphabet', function (): void {
    $generator = new HookCodeGenerator;
    $seen = [];

    foreach (range(1, 2000) as $n) {
        $code = $generator->generate();
        expect(HookCode::isValid($code))->toBeTrue();
        $seen += array_flip(str_split($code));
    }

    expect(count($seen))->toBe(32);
});

it('normalises typed input', function (string $input, string $expected): void {
    expect(HookCode::normalise($input))->toBe($expected);
})->with([
    'lower case and dash' => ['ab12-cd34', 'AB12CD34'],
    'spaces' => [' AB12 CD34 ', 'AB12CD34'],
    'I and L read as 1' => ['IL12CD34', '1112CD34'],
    'O read as 0' => ['oO12CD34', '0012CD34'],
]);

it('rejects codes outside the format', function (string $code): void {
    expect(HookCode::isValid($code))->toBeFalse();
})->with(['AB12CD3', 'AB12CD345', 'AB12CDU4', 'AB12CDI4', 'ab12cd34', 'AB12-D34']);

it('stores a code as the HMAC-SHA256 keyed with the pepper', function (): void {
    $pepper = bin2hex(random_bytes(32));
    $code = (new HookCodeGenerator)->generate();

    $hash = (new HookCodeHasher($pepper))->hash($code);

    expect($hash)->toBe(hash_hmac('sha256', $code, $pepper))
        ->and($hash)->toMatch('/^[0-9a-f]{64}$/')
        ->and($hash)->not->toBe(hash('sha256', $code))
        ->and((new HookCodeHasher(bin2hex(random_bytes(32))))->hash($code))->not->toBe($hash);
});

it('refuses to hash without a pepper of at least 32 characters', function (?string $pepper): void {
    expect(fn () => (new HookCodeHasher($pepper))->hash('AB12CD34'))->toThrow(RuntimeException::class, 'HOOK_CODE_PEPPER');
})->with([
    'missing' => [null],
    'empty' => [''],
    'blank' => [str_repeat(' ', 40)],
    'short' => [str_repeat('p', 31)],
]);
