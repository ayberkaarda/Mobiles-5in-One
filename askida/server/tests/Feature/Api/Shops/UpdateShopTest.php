<?php

use App\Domain\Shops\Models\Shop;
use App\Domain\Shops\Models\ShopMemberRole;
use App\Domain\Shops\Models\ShopVerificationState;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Spatie\Activitylog\Models\Activity;
use Tests\Feature\Api\Auth\Support\AuthTestKit;
use Tests\Feature\Api\Shops\Support\ShopTestKit;

uses(RefreshDatabase::class);

beforeEach(fn () => AuthTestKit::boot());

it('lets the owner edit non-sensitive fields without leaving verification', function (): void {
    $owner = ShopTestKit::merchant();
    $shop = ShopTestKit::shop($owner);

    $this->withToken(AuthTestKit::token($owner))
        ->patchJson("/api/v1/shops/{$shop->id}", ['name' => 'Yeni Ad', 'phone' => '+90 216 555 99 88', 'listed_on_web' => false])
        ->assertOk()
        ->assertJsonPath('data.name', 'Yeni Ad')
        ->assertJsonPath('data.phone', '+902165559988')
        ->assertJsonPath('data.listed_on_web', false)
        ->assertJsonPath('data.verification_state', 'verified')
        ->assertJsonPath('data.slug', $shop->slug);

    expect(Activity::query()->where('event', 'shop.sensitive_change')->exists())->toBeFalse();
});

it('sends a verified shop back to pending when a sensitive field changes', function (string $field, Closure $value): void {
    $owner = ShopTestKit::merchant();
    $shop = ShopTestKit::shop($owner);
    $payload = $value();

    $this->withToken(AuthTestKit::token($owner))
        ->patchJson("/api/v1/shops/{$shop->id}", $payload)
        ->assertOk()
        ->assertJsonPath('data.verification_state', 'pending')
        ->assertJsonPath('data.verified_at', null);

    $fresh = Shop::query()->findOrFail($shop->id);
    expect($fresh->verification_state)->toBe(ShopVerificationState::Pending)->and($fresh->verified_at)->toBeNull();

    $change = Activity::query()->where('event', 'shop.sensitive_change')->sole();
    expect($change->subject_id)->toBe($shop->id)
        ->and($change->causer_id)->toBe($owner->id)
        ->and($change->properties->get('fields'))->toBe([$field]);

    $reopened = Activity::query()->where('event', 'shop.reopened')->sole();
    expect($reopened->properties->get('from'))->toBe('verified')->and($reopened->properties->get('to'))->toBe('pending');

    // The log holds ids, state names and field names only: never the new values.
    $logged = json_encode(Activity::query()->get()->map->getAttributes()->all());
    foreach ($payload as $sent) {
        expect((string) $logged)->not->toContain((string) $sent);
    }
})->with([
    'tax number' => ['tax_number', fn () => ['tax_number' => ShopTestKit::taxNumber()]],
    'iban' => ['iban', fn () => ['iban' => ShopTestKit::iban()]],
    'address' => ['address', fn () => ['address' => 'Bahariye Caddesi No: 44']],
    'location' => ['location', fn () => ['lat' => 41.0012, 'lng' => 29.0411]],
]);

it('does not reset verification when a sensitive field is sent unchanged', function (): void {
    $owner = ShopTestKit::merchant();
    $shop = ShopTestKit::shop($owner);

    $this->withToken(AuthTestKit::token($owner))
        ->patchJson("/api/v1/shops/{$shop->id}", ['tax_number' => $shop->tax_number_enc, 'address' => $shop->address])
        ->assertOk()
        ->assertJsonPath('data.verification_state', 'verified');
});

it('re-submits a rejected shop when its owner edits it', function (): void {
    $owner = ShopTestKit::merchant();
    $shop = ShopTestKit::shop($owner, ShopVerificationState::Rejected);

    $this->withToken(AuthTestKit::token($owner))
        ->patchJson("/api/v1/shops/{$shop->id}", ['name' => 'Düzeltilmiş Ad'])
        ->assertOk()
        ->assertJsonPath('data.verification_state', 'pending');

    expect(Activity::query()->where('event', 'shop.resubmitted')->sole()->properties->get('from'))->toBe('rejected');
});

it('refuses staff with 403 and other merchants with 404', function (): void {
    $owner = ShopTestKit::merchant();
    $shop = ShopTestKit::shop($owner);
    $staff = ShopTestKit::merchant();
    ShopTestKit::join($shop, $staff, ShopMemberRole::Staff);
    $stranger = ShopTestKit::merchant();
    ShopTestKit::shop($stranger);

    AuthTestKit::assertProblem(
        $this->withToken(AuthTestKit::token($staff))->patchJson("/api/v1/shops/{$shop->id}", ['name' => 'Ele geçirildi']),
        403,
        'forbidden',
    );

    AuthTestKit::forgetGuards();

    AuthTestKit::assertProblem(
        $this->withToken(AuthTestKit::token($stranger))->patchJson("/api/v1/shops/{$shop->id}", ['name' => 'Ele geçirildi']),
        404,
        'not_found',
    );

    AuthTestKit::forgetGuards();

    AuthTestKit::assertProblem(
        $this->withToken(AuthTestKit::token(ShopTestKit::donor()))->patchJson("/api/v1/shops/{$shop->id}", ['name' => 'Ele geçirildi']),
        403,
        'forbidden',
    );

    expect(Shop::query()->findOrFail($shop->id)->name)->toBe($shop->name);
});

it('answers a missing and a malformed id like a foreign one', function (): void {
    $token = AuthTestKit::token(ShopTestKit::merchant());

    AuthTestKit::assertProblem(
        $this->withToken($token)->patchJson('/api/v1/shops/0199a000-0000-7000-8000-000000000000', ['name' => 'X Y']),
        404,
        'not_found',
    );

    // A non-UUID path never reaches a lookup; it only matches the GET slug route.
    AuthTestKit::assertProblem($this->withToken($token)->patchJson('/api/v1/shops/not-a-uuid', ['name' => 'X Y']), 405, 'method_not_allowed');
});

it('refuses server-controlled fields on edit', function (): void {
    $owner = ShopTestKit::merchant();
    $shop = ShopTestKit::shop($owner, ShopVerificationState::Pending);

    AuthTestKit::assertProblem(
        $this->withToken(AuthTestKit::token($owner))->patchJson("/api/v1/shops/{$shop->id}", ['verification_state' => 'verified']),
        422,
        'validation.failed',
        [['field' => 'verification_state', 'code' => 'prohibited']],
    );

    expect(Shop::query()->findOrFail($shop->id)->verification_state)->toBe(ShopVerificationState::Pending);
});

it('requires latitude and longitude together', function (): void {
    $owner = ShopTestKit::merchant();
    $shop = ShopTestKit::shop($owner);

    AuthTestKit::assertProblem(
        $this->withToken(AuthTestKit::token($owner))->patchJson("/api/v1/shops/{$shop->id}", ['lat' => 41.0]),
        422,
        'validation.failed',
        [['field' => 'lng', 'code' => 'required_with']],
    );
});
