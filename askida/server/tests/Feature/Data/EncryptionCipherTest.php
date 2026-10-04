<?php

use App\Domain\Shops\Models\GeoPoint;
use App\Domain\Shops\Models\Shop;
use App\Models\User;
use Illuminate\Contracts\Encryption\DecryptException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;

uses(RefreshDatabase::class);

// Built without the shop factory so its running sequence stays untouched for the seeder tests.
function encryptedShop(string $tax = '1234567890', string $iban = 'TR00000000000000000000000'): Shop
{
    $shop = new Shop([
        'name' => 'Cipher test shop',
        'type' => 'bakery',
        'address' => 'Test Street 1',
        'il' => 'Istanbul',
        'ilce' => 'Kadikoy',
        'location' => new GeoPoint(40.99, 29.03),
        'phone' => '+90 212 000 00 00',
        'tax_number_enc' => $tax,
        'iban_enc' => $iban,
    ]);
    $shop->slug = 'cipher-test-shop';
    $shop->owner_id = User::factory()->create(['kind' => 'merchant'])->id;
    $shop->save();

    return $shop;
}

it('uses AES-256-GCM for encrypted values', function (): void {
    expect(config('app.cipher'))->toBe('AES-256-GCM');
});

it('stores encrypted columns as ciphertext and decrypts them back', function (): void {
    $tax = '1234567890';
    $iban = 'TR'.str_repeat('7', 24);

    $shop = encryptedShop($tax, $iban);

    $raw = DB::table('shops')->where('id', $shop->id)->first(['tax_number_enc', 'iban_enc']);

    expect($raw->tax_number_enc)->not->toContain($tax)->not->toBe($tax)
        ->and($raw->iban_enc)->not->toContain($iban)->not->toBe($iban);

    $payload = json_decode(base64_decode((string) $raw->tax_number_enc), true);
    expect($payload)->toHaveKeys(['iv', 'value', 'mac', 'tag']);

    $fresh = Shop::query()->findOrFail($shop->id);
    expect($fresh->tax_number_enc)->toBe($tax)
        ->and($fresh->iban_enc)->toBe($iban);
});

it('refuses to decrypt a tampered ciphertext', function (): void {
    $shop = encryptedShop();

    $raw = (string) DB::table('shops')->where('id', $shop->id)->value('iban_enc');
    $payload = json_decode(base64_decode($raw), true);
    $payload['value'] = base64_encode('x'.base64_decode($payload['value']));
    $tampered = base64_encode(json_encode($payload));

    expect(fn () => Crypt::decryptString($tampered))->toThrow(DecryptException::class);

    DB::table('shops')->where('id', $shop->id)->update(['iban_enc' => $tampered]);

    expect(fn () => Shop::query()->findOrFail($shop->id)->iban_enc)->toThrow(DecryptException::class);
});
