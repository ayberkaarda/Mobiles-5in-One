<?php

use App\Console\Commands\RotateAppKey;
use App\Domain\Shops\Models\Shop;
use App\Models\User;
use Illuminate\Contracts\Encryption\DecryptException;
use Illuminate\Encryption\Encrypter;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;

/*
| askida:rotate-app-key (history purge runbook, APP_KEY step): the old key is never an
| option, it comes from APP_PREVIOUS_KEYS or standard input; three columns are
| re-encrypted in one transaction; the command is idempotent and supports --dry-run.
| Keys and plaintext values are built at run time.
*/

uses(RefreshDatabase::class);

/** Command whose standard input is scripted by the test. */
final class StdinScriptedRotateAppKey extends RotateAppKey
{
    public static string $contents = '';

    public static bool $terminal = false;

    protected function stdinIsTerminal(): bool
    {
        return self::$terminal;
    }

    protected function stdinContents(): string
    {
        return self::$contents;
    }
}

function rotateKeyString(): string
{
    return 'base64:'.base64_encode(random_bytes(32));
}

function rotateEncrypter(string $key): Encrypter
{
    return new Encrypter(base64_decode(substr($key, 7)), (string) config('app.cipher'));
}

/**
 * Shop and TOTP admin whose three columns are encrypted under $oldKey.
 *
 * @return array{shop: Shop, user: User, plain: array{tax: string, iban: string, totp: string}}
 */
function rotateSeed(string $oldKey): array
{
    $old = rotateEncrypter($oldKey);
    $plain = [
        'tax' => (string) random_int(1000000000, 9999999999),
        'iban' => 'TR'.random_int(10, 99).bin2hex(random_bytes(10)),
        'totp' => strtoupper(bin2hex(random_bytes(10))),
    ];
    $shop = Shop::factory()->create();
    $user = User::factory()->create();
    DB::table('shops')->where('id', $shop->id)->update([
        'tax_number_enc' => $old->encryptString($plain['tax']),
        'iban_enc' => $old->encryptString($plain['iban']),
    ]);
    DB::table('users')->where('id', $user->id)->update(['two_factor_secret' => $old->encryptString($plain['totp'])]);

    return ['shop' => $shop, 'user' => $user, 'plain' => $plain];
}

function rotateRaw(Shop $shop, User $user): array
{
    return [
        'tax' => DB::table('shops')->where('id', $shop->id)->value('tax_number_enc'),
        'iban' => DB::table('shops')->where('id', $shop->id)->value('iban_enc'),
        'totp' => DB::table('users')->where('id', $user->id)->value('two_factor_secret'),
    ];
}

beforeEach(function (): void {
    $this->oldKey = rotateKeyString();
    config(['app.previous_keys' => []]);
});

it('has no option that could carry the old key', function (): void {
    $definition = Artisan::all()['askida:rotate-app-key']->getDefinition();
    $options = array_keys($definition->getOptions());

    expect($definition->getArguments())->toBe([])
        ->and($options)->toContain('stdin', 'dry-run')
        ->and(array_values(array_intersect($options, ['from', 'old', 'old-key', 'previous', 'key', 'app-key'])))->toBe([]);

    $signature = (new ReflectionClass(RotateAppKey::class))->getProperty('signature')->getDefaultValue();
    preg_match_all('/\{([^}]*)\}/', (string) $signature, $found);
    expect($found[1])->each->toStartWith('--');
});

it('re-encrypts the three columns from the first APP_PREVIOUS_KEYS entry', function (): void {
    config(['app.previous_keys' => [$this->oldKey]]);
    $seed = rotateSeed($this->oldKey);
    $before = rotateRaw($seed['shop'], $seed['user']);

    $this->artisan('askida:rotate-app-key')
        ->expectsOutputToContain('Rotation finished.')
        ->doesntExpectOutputToContain($seed['plain']['iban'])
        ->doesntExpectOutputToContain($seed['plain']['totp'])
        ->doesntExpectOutputToContain($this->oldKey)
        ->assertExitCode(0);

    $after = rotateRaw($seed['shop'], $seed['user']);

    foreach (['tax', 'iban', 'totp'] as $field) {
        expect($after[$field])->not->toBe($before[$field])
            ->and(Crypt::decryptString($after[$field]))->toBe($seed['plain'][$field]);
    }

    // The old key no longer opens them.
    expect(fn () => rotateEncrypter($this->oldKey)->decryptString($after['tax']))
        ->toThrow(DecryptException::class);

    // The model casts read the new ciphertext.
    expect(Shop::query()->findOrFail($seed['shop']->id)->iban_enc)->toBe($seed['plain']['iban'])
        ->and(User::query()->findOrFail($seed['user']->id)->two_factor_secret)->toBe($seed['plain']['totp']);
});

it('is idempotent: a second run changes nothing', function (): void {
    config(['app.previous_keys' => [$this->oldKey]]);
    $seed = rotateSeed($this->oldKey);

    $this->artisan('askida:rotate-app-key')->assertExitCode(0);
    $first = rotateRaw($seed['shop'], $seed['user']);

    $this->artisan('askida:rotate-app-key')->expectsOutputToContain('Rotation finished.')->assertExitCode(0);

    expect(rotateRaw($seed['shop'], $seed['user']))->toBe($first)
        ->and(Crypt::decryptString($first['tax']))->toBe($seed['plain']['tax']);
});

it('writes nothing on --dry-run', function (): void {
    config(['app.previous_keys' => [$this->oldKey]]);
    $seed = rotateSeed($this->oldKey);
    $before = rotateRaw($seed['shop'], $seed['user']);

    $this->artisan('askida:rotate-app-key --dry-run')
        ->expectsOutputToContain('Dry run: nothing was written.')
        ->assertExitCode(0);

    expect(rotateRaw($seed['shop'], $seed['user']))->toBe($before);
});

it('reads the old key from standard input with --stdin and leaves nulls alone', function (): void {
    $seed = rotateSeed($this->oldKey);
    $nullShop = Shop::factory()->create();
    DB::table('shops')->where('id', $nullShop->id)->update(['tax_number_enc' => null, 'iban_enc' => null]);
    StdinScriptedRotateAppKey::$contents = $this->oldKey."\n";
    StdinScriptedRotateAppKey::$terminal = false;
    Artisan::registerCommand(new StdinScriptedRotateAppKey);

    $this->artisan('askida:rotate-app-key --stdin')->assertExitCode(0);

    $after = rotateRaw($seed['shop'], $seed['user']);
    expect(Crypt::decryptString($after['iban']))->toBe($seed['plain']['iban'])
        ->and(DB::table('shops')->where('id', $nullShop->id)->value('tax_number_enc'))->toBeNull();
});

it('refuses an interactive terminal on --stdin', function (): void {
    $seed = rotateSeed($this->oldKey);
    $before = rotateRaw($seed['shop'], $seed['user']);
    StdinScriptedRotateAppKey::$contents = $this->oldKey;
    StdinScriptedRotateAppKey::$terminal = true;
    Artisan::registerCommand(new StdinScriptedRotateAppKey);

    $this->artisan('askida:rotate-app-key --stdin')
        ->expectsOutputToContain('Standard input is a terminal')
        ->assertExitCode(1);

    expect(rotateRaw($seed['shop'], $seed['user']))->toBe($before);
});

it('refuses empty standard input and a missing old key', function (): void {
    StdinScriptedRotateAppKey::$contents = "  \n";
    StdinScriptedRotateAppKey::$terminal = false;
    Artisan::registerCommand(new StdinScriptedRotateAppKey);

    $this->artisan('askida:rotate-app-key --stdin')->expectsOutputToContain('No old key on standard input.')->assertExitCode(1);
    $this->artisan('askida:rotate-app-key')->expectsOutputToContain('No old key')->assertExitCode(1);
});

it('refuses to run when the old key equals APP_KEY', function (): void {
    config(['app.previous_keys' => [(string) config('app.key')]]);
    $seed = rotateSeed($this->oldKey);
    $before = rotateRaw($seed['shop'], $seed['user']);

    $this->artisan('askida:rotate-app-key')->expectsOutputToContain('equals APP_KEY')->assertExitCode(1);

    expect(rotateRaw($seed['shop'], $seed['user']))->toBe($before);
});

it('aborts without writing when a value decrypts under neither key', function (): void {
    config(['app.previous_keys' => [$this->oldKey]]);
    $good = rotateSeed($this->oldKey);
    $stranger = rotateSeed(rotateKeyString());
    $goodBefore = rotateRaw($good['shop'], $good['user']);

    $this->artisan('askida:rotate-app-key')->expectsOutputToContain('decrypts under neither key')->assertExitCode(1);

    // Whatever was visited first was rolled back with the failing row.
    expect(rotateRaw($good['shop'], $good['user']))->toBe($goodBefore);
});

it('rejects a malformed old key without touching the data', function (): void {
    $seed = rotateSeed($this->oldKey);
    $before = rotateRaw($seed['shop'], $seed['user']);
    config(['app.previous_keys' => ['base64:'.base64_encode('too short')]]);

    $this->artisan('askida:rotate-app-key')->assertExitCode(1);

    expect(rotateRaw($seed['shop'], $seed['user']))->toBe($before);
});
