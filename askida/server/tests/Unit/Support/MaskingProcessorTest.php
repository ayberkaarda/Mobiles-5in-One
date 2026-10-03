<?php

use App\Support\Logging\MaskingProcessor;
use Illuminate\Support\Collection;
use Monolog\Level;
use Monolog\LogRecord;

/*
| Security checklist item 14. Every personal value below is assembled at run time.
*/

function digits(int $length): string
{
    $out = '';

    for ($i = 0; $i < $length; $i++) {
        $out .= (string) random_int(0, 9);
    }

    return $out;
}

function record(string $message, array $context = [], array $extra = []): LogRecord
{
    return new LogRecord(new DateTimeImmutable, 'testing', Level::Info, $message, $context, $extra);
}

function mask(string $text): string
{
    return MaskingProcessor::maskText($text);
}

it('masks e-mail addresses to the first letters and the TLD', function (): void {
    $email = 'ayse.'.'yilmaz'.'@'.'posta'.'.example'.'.tr';

    expect(mask('kayit: '.$email.' tamam'))->toBe('kayit: a***@p***.tr tamam');
});

it('masks Turkish phone numbers in common formats', function (string $phone): void {
    $masked = mask('tel '.$phone.' ara');

    expect($masked)->toBe('tel [phone] ara');
})->with([
    'international spaced' => fn () => '+90 5'.digits(2).' '.digits(3).' '.digits(2).' '.digits(2),
    'international compact' => fn () => '+905'.digits(9),
    'leading zero' => fn () => '05'.digits(9),
    'bare mobile' => fn () => '5'.digits(9),
    'parentheses' => fn () => '0 (5'.digits(2).') '.digits(3).'-'.digits(2).'-'.digits(2),
    'landline' => fn () => '0212 '.digits(3).' '.digits(2).' '.digits(2),
]);

it('masks Turkish and generic IBANs', function (): void {
    $tr = 'TR'.digits(24);
    $trSpaced = 'TR'.digits(2).' '.implode(' ', str_split(digits(22), 4));
    $de = 'DE'.digits(20);

    expect(mask('iban '.$tr))->toBe('iban [iban]')
        ->and(mask('hesap '.$trSpaced.' bitti'))->toBe('hesap [iban] bitti')
        ->and(mask('konto '.$de))->toBe('konto [iban]');
});

it('masks tax numbers after a keyword', function (string $keyword): void {
    expect(mask($keyword.': '.digits(10)))->toBe($keyword.': [tax]')
        ->and(mask($keyword.' '.digits(11).' kayit'))->toBe($keyword.' [tax] kayit');
})->with(['vkn', 'tckn', 'vergi no', 'TC kimlik no', 'tax number']);

it('masks card-like digit runs', function (): void {
    $plain = '4'.digits(15);
    $grouped = implode(' ', str_split('5'.digits(15), 4));
    $dashed = implode('-', str_split('3'.digits(14), 5));

    expect(mask('kart '.$plain))->toBe('kart [card]')
        ->and(mask('kart '.$grouped.' ok'))->toBe('kart [card] ok')
        ->and(mask('kart '.$dashed))->toBe('kart [card]');
});

it('masks Authorization and cookie header values and bearer tokens', function (): void {
    $token = bin2hex(random_bytes(20));

    expect(mask("Authorization: Bearer {$token}\r\nAccept: x"))->toBe("Authorization: [redacted]\r\nAccept: x")
        ->and(mask('Cookie: a='.$token.'; b=2'))->toBe('Cookie: [redacted]')
        ->and(mask('set-cookie: s='.$token.'; path=/'))->toBe('set-cookie: [redacted]')
        ->and(mask('{"authorization":"Bearer '.$token.'","x":1}'))->toBe('{"authorization":"[redacted]","x":1}')
        ->and(mask('sent bearer '.$token))->toBe('sent Bearer [redacted]');
});

it('masks credential key=value pairs inside text', function (): void {
    $secret = bin2hex(random_bytes(8));

    expect(mask('login password='.$secret.' ok'))->toBe('login password=[redacted] ok')
        ->and(mask('/redeem?code='.$secret.'&x=1'))->toBe('/redeem?code=[redacted]&x=1')
        ->and(mask('{"reset_token": "'.$secret.'"}'))->toBe('{"reset_token": "[redacted]"}');
});

it('replaces values under sensitive keys at any depth and in any case', function (): void {
    $secret = bin2hex(random_bytes(8));

    $masked = MaskingProcessor::maskArray([
        'Password' => $secret,
        'user' => [
            'name' => 'Ayse',
            'auth' => ['access_TOKEN' => $secret, 'refresh' => ['clientSecret' => $secret]],
        ],
        'headers' => ['Authorization' => ['Bearer '.$secret], 'Cookie' => $secret, 'X-Ok' => 'yes'],
        'payout' => ['iban_enc' => $secret, 'Tax_Number' => $secret, 'amount_minor' => 1500],
        'redemption_code' => $secret,
        'passwd' => ['nested' => $secret],
    ]);

    expect($masked)->toBe([
        'Password' => '[redacted]',
        'user' => [
            'name' => 'Ayse',
            'auth' => ['access_TOKEN' => '[redacted]', 'refresh' => ['clientSecret' => '[redacted]']],
        ],
        'headers' => ['Authorization' => '[redacted]', 'Cookie' => '[redacted]', 'X-Ok' => 'yes'],
        'payout' => ['iban_enc' => '[redacted]', 'Tax_Number' => '[redacted]', 'amount_minor' => 1500],
        'redemption_code' => '[redacted]',
        'passwd' => '[redacted]',
    ]);
});

it('masks exception messages and traces and keeps the request id', function (): void {
    $email = 'mehmet'.'@'.'ornek'.'.test';
    $iban = 'TR'.digits(24);
    $previous = new InvalidArgumentException('payer '.$email);
    $exception = new RuntimeException('payout to '.$iban.' failed', 0, $previous);

    $record = (new MaskingProcessor)(record('payout failed for '.$email, [
        'exception' => $exception,
        'request_id' => 'req-'.bin2hex(random_bytes(4)),
    ]));

    $text = json_encode([$record->message, $record->context], JSON_UNESCAPED_SLASHES);

    expect($text)->not->toContain($email)
        ->and($text)->not->toContain($iban)
        ->and($record->context['exception'])->toBeString()
        ->and($record->context['exception'])->toContain('RuntimeException: payout to [iban] failed')
        ->and($record->context['exception'])->toContain('Caused by: InvalidArgumentException: payer m***@o***.test')
        ->and($record->context['request_id'])->toStartWith('req-');
});

it('masks serialisable objects and hides others', function (): void {
    $email = 'zeynep'.'@'.'ornek'.'.test';

    $masked = MaskingProcessor::maskArray([
        'model' => new Collection(['email' => $email, 'name' => 'Zeynep']),
        'opaque' => new stdClass,
    ]);

    expect($masked['model'])->toBe(['email' => 'z***@o***.test', 'name' => 'Zeynep'])
        ->and($masked['opaque'])->toBe('[object stdClass]');
});

it('masks long integers that could be phone or card numbers', function (): void {
    $masked = MaskingProcessor::maskArray(['msisdn' => (int) ('5'.digits(9)), 'count' => 42]);

    expect($masked)->toBe(['msisdn' => '[phone]', 'count' => 42]);
});

it('is idempotent', function (): void {
    $email = 'ali'.'@'.'ornek'.'.example'.'.test';
    $token = bin2hex(random_bytes(16));
    $message = implode(' | ', [
        'mail '.$email,
        'tel +90 5'.digits(9),
        'iban TR'.digits(24),
        'vkn '.digits(10),
        'kart 4'.digits(15),
        'Authorization: Bearer '.$token,
        'password='.$token,
        'code: '.$token,
    ]);
    $context = ['token' => $token, 'note' => $message, 'nested' => ['email' => $email, 'list' => [$message]]];

    $processor = new MaskingProcessor;
    $once = $processor(record($message, $context));
    $twice = $processor($once);

    expect($twice->message)->toBe($once->message)
        ->and($twice->context)->toBe($once->context)
        ->and($once->message)->not->toContain($token)
        ->and($once->message)->not->toContain($email);
});
