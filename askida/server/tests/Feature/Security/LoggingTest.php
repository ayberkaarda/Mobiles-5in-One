<?php

use App\Support\Logging\MaskSensitiveData;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Route;
use Tests\Unit\Support\TemporaryEnv;

/*
| Security checklist item 14: a log sample of register, donate and redeem style events
| written through the real channel configuration contains no personal data or secrets.
| Every value is assembled at run time.
*/

beforeEach(function (): void {
    $this->logPath = storage_path('logs/test-masking-'.bin2hex(random_bytes(4)).'.log');

    config([
        'logging.default' => 'stack',
        'logging.channels.stack.channels' => ['single'],
        'logging.channels.single.path' => $this->logPath,
        'logging.channels.single.level' => 'debug',
    ]);
    app('log')->forgetChannel('stack');
    app('log')->forgetChannel('single');

    Route::middleware('api')->get('api/v1/test-log/items/{item}', fn (string $item) => ['ok' => true]);
    Route::middleware('api')->post('api/v1/test-log/fail', function (Request $request): never {
        throw new RuntimeException('payout failed for '.$request->string('email').' to '.$request->string('iban'));
    });
});

afterEach(function (): void {
    File::delete($this->logPath);
});

function sampleDigits(int $length): string
{
    $out = '';

    for ($i = 0; $i < $length; $i++) {
        $out .= (string) random_int(0, 9);
    }

    return $out;
}

function sampleCode(): string
{
    $alphabet = str_split('0123456789ABCDEFGHJKMNPQRSTVWXYZ');
    $code = '';

    for ($i = 0; $i < 8; $i++) {
        $code .= $alphabet[random_int(0, count($alphabet) - 1)];
    }

    return $code;
}

function logText(string $path): string
{
    return File::exists($path) ? (string) File::get($path) : '';
}

it('writes a register, donate and redeem sample without personal data or secrets', function (): void {
    $email = 'elif.'.'kaya'.'@'.'ornek'.'.example'.'.test';
    $password = 'pw-'.bin2hex(random_bytes(6));
    $token = bin2hex(random_bytes(20));
    $iban = 'TR'.sampleDigits(24);
    $card = '4'.sampleDigits(15);
    $phone = '+90 5'.sampleDigits(2).' '.sampleDigits(3).' '.sampleDigits(2).' '.sampleDigits(2);
    $taxNumber = sampleDigits(10);
    $code = sampleCode();

    // Register: the request body never reaches the log; the app event is masked.
    $this->postJson('/api/v1/auth/register', [
        'email' => $email, 'password' => $password, 'device_name' => 'pixel', 'phone' => $phone,
    ]);
    Log::info('auth.registered '.$email, ['email' => $email, 'password' => $password, 'phone' => $phone]);
    Log::info('auth.token_issued', ['plain_text_token' => $token, 'headers' => ['Authorization' => 'Bearer '.$token]]);

    // Donate: payer and merchant payout details.
    Log::info('donation.created', [
        'donor' => ['email' => $email, 'phone' => $phone],
        'payment' => ['card' => $card, 'note' => 'card '.$card.' charged'],
        'merchant' => ['iban' => $iban, 'tax_number' => $taxNumber, 'note' => 'vkn '.$taxNumber.' iban '.$iban],
    ]);

    // Redeem: the code is secret until used.
    Log::info('hook.redeem attempt code='.$code, ['code' => $code, 'hook' => ['redemption_code' => $code]]);
    Log::warning('upstream said Authorization: Bearer '.$token.' cookie: s='.$token);

    // An unexpected failure carrying personal data in its message.
    $this->postJson('/api/v1/test-log/fail', ['email' => $email, 'iban' => $iban])->assertStatus(500);

    $log = logText($this->logPath);

    expect($log)->not->toBe('');

    foreach ([$email, $password, $token, $iban, $card, $phone, $taxNumber, $code] as $secret) {
        expect($log)->not->toContain($secret);
    }

    expect($log)->toContain('e***@o***.test')
        ->and($log)->toContain('[redacted]')
        ->and($log)->toContain('payout failed for e***@o***.test to [iban]');
});

it('logs one line per request with the route pattern and never the URL or body', function (): void {
    $email = 'can'.'@'.'ornek'.'.test';
    $item = (string) random_int(100000, 999999);

    $response = $this->getJson('/api/v1/test-log/items/'.$item.'?email='.urlencode($email));
    // An auth request with credentials in the body (matched or not, depending on which
    // routes exist) and a path that never matches a route.
    $this->postJson('/api/v1/auth/login', ['email' => $email, 'password' => 'pw-'.bin2hex(random_bytes(4))]);
    $this->getJson('/api/v1/test-log/no-such-route');

    $log = logText($this->logPath);
    $requestId = (string) $response->headers->get('X-Request-Id');

    expect($log)->toContain('http.request')
        ->and($log)->toContain('"route":"api/v1/test-log/items/{item}"')
        ->and($log)->toContain('"method":"GET"')
        ->and($log)->toContain('"status":200')
        ->and($log)->toContain('"request_id":"'.$requestId.'"')
        ->and($log)->toContain('"duration_ms":')
        ->and($log)->toContain('"route":"unmatched"')
        ->and($log)->not->toContain($item)
        ->and($log)->not->toContain($email)
        ->and($log)->not->toContain('email=')
        ->and($log)->not->toContain('password')
        ->and($log)->not->toContain('no-such-route');

    expect(substr_count($log, 'http.request'))->toBe(3);
});

it('configures the daily channel with masking, level info and 30 days', function (): void {
    $config = TemporaryEnv::run(
        ['LOG_CHANNEL' => null, 'LOG_STACK' => null, 'LOG_LEVEL' => null],
        fn (): array => require config_path('logging.php'),
    );

    expect($config['default'])->toBe('stack')
        ->and($config['channels']['stack']['channels'])->toBe(['daily'])
        ->and($config['channels']['daily']['level'])->toBe('info')
        ->and($config['channels']['daily']['days'])->toBe(30)
        ->and($config['channels']['daily']['tap'])->toBe([MaskSensitiveData::class])
        ->and($config['channels']['stack']['tap'])->toBe([MaskSensitiveData::class]);

    foreach ($config['channels'] as $name => $channel) {
        if (in_array($name, ['null', 'emergency'], true)) {
            continue;
        }

        expect($channel['tap'] ?? [])->toContain(MaskSensitiveData::class);
    }
});
