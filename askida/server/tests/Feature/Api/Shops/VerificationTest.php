<?php

use App\Domain\Auth\Abilities\AdminRole;
use App\Domain\Shops\Events\ShopRejected;
use App\Domain\Shops\Events\ShopVerified;
use App\Domain\Shops\Exceptions\IllegalVerificationTransition;
use App\Domain\Shops\Models\Shop;
use App\Domain\Shops\Models\ShopVerificationState;
use App\Domain\Shops\Services\ShopVerificationService;
use App\Models\User;
use Database\Seeders\RolesSeeder;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Event;
use Spatie\Activitylog\Models\Activity;
use Tests\Feature\Api\Shops\Support\ShopTestKit;

uses(RefreshDatabase::class);

beforeEach(fn () => (new RolesSeeder)->run());

function verificationActor(AdminRole $role): User
{
    $user = User::factory()->create();
    $user->assignRole($role->value);

    return $user;
}

function freshShop(Shop $shop): Shop
{
    return Shop::query()->findOrFail($shop->id);
}

it('lets admins and moderators verify a pending shop', function (AdminRole $role): void {
    Event::fake([ShopVerified::class, ShopRejected::class]);
    $actor = verificationActor($role);
    $shop = ShopTestKit::shop(state: ShopVerificationState::Pending);

    $result = app(ShopVerificationService::class)->verify($shop, $actor);

    expect($result->verification_state)->toBe(ShopVerificationState::Verified)
        ->and(freshShop($shop)->verification_state)->toBe(ShopVerificationState::Verified)
        ->and(freshShop($shop)->verified_at)->not->toBeNull();

    Event::assertDispatched(ShopVerified::class, fn (ShopVerified $event): bool => $event->shopId === $shop->id && $event->actorId === $actor->id);
    Event::assertNotDispatched(ShopRejected::class);

    $entry = Activity::query()->where('event', 'shop.verified')->sole();
    expect($entry->subject_id)->toBe($shop->id)
        ->and($entry->causer_id)->toBe($actor->id)
        ->and($entry->properties->all())->toBe(['from' => 'pending', 'to' => 'verified']);
})->with([AdminRole::Admin, AdminRole::Moderator]);

it('lets admins and moderators reject a pending shop', function (AdminRole $role): void {
    Event::fake([ShopVerified::class, ShopRejected::class]);
    $actor = verificationActor($role);
    $shop = ShopTestKit::shop(state: ShopVerificationState::Pending);

    app(ShopVerificationService::class)->reject($shop, $actor);

    expect(freshShop($shop)->verification_state)->toBe(ShopVerificationState::Rejected)
        ->and(freshShop($shop)->verified_at)->toBeNull();
    Event::assertDispatched(ShopRejected::class, fn (ShopRejected $event): bool => $event->shopId === $shop->id);
    Event::assertNotDispatched(ShopVerified::class);
    expect(Activity::query()->where('event', 'shop.rejected')->sole()->properties->all())->toBe(['from' => 'pending', 'to' => 'rejected']);
})->with([AdminRole::Admin, AdminRole::Moderator]);

it('refuses finance, merchants, donors and admins acting through an API token', function (User $user): void {
    Event::fake([ShopVerified::class, ShopRejected::class]);
    $shop = ShopTestKit::shop(state: ShopVerificationState::Pending);

    expect(fn () => app(ShopVerificationService::class)->verify($shop, $user))->toThrow(AuthorizationException::class)
        ->and(fn () => app(ShopVerificationService::class)->reject($shop, $user))->toThrow(AuthorizationException::class);

    expect(freshShop($shop)->verification_state)->toBe(ShopVerificationState::Pending)
        ->and(Activity::query()->count())->toBe(0);
    Event::assertNothingDispatched();
})->with([
    'finance' => fn () => verificationActor(AdminRole::Finance),
    'merchant' => fn () => ShopTestKit::merchant(),
    'donor' => fn () => ShopTestKit::donor(),
    'admin with an api token' => function (): User {
        $admin = verificationActor(AdminRole::Admin);

        return $admin->withAccessToken($admin->createToken('device', [$admin->kind->ability()])->accessToken);
    },
]);

it('refuses illegal transitions', function (ShopVerificationState $from, string $action): void {
    Event::fake([ShopVerified::class, ShopRejected::class]);
    $actor = verificationActor(AdminRole::Admin);
    $owner = ShopTestKit::merchant();
    $shop = ShopTestKit::shop($owner, $from);
    $service = app(ShopVerificationService::class);

    $call = match ($action) {
        'verify' => fn () => $service->verify($shop, $actor),
        'reject' => fn () => $service->reject($shop, $actor),
        'resubmit' => fn () => $service->resubmit($shop, $owner),
        'reopen' => fn () => $service->reopen($shop, $owner, ['iban']),
    };

    expect($call)->toThrow(IllegalVerificationTransition::class);
    expect(freshShop($shop)->verification_state)->toBe($from)
        ->and(Activity::query()->count())->toBe(0);
    Event::assertNothingDispatched();
})->with([
    'verified -> verified' => [ShopVerificationState::Verified, 'verify'],
    'verified -> rejected' => [ShopVerificationState::Verified, 'reject'],
    'rejected -> verified' => [ShopVerificationState::Rejected, 'verify'],
    'rejected -> rejected' => [ShopVerificationState::Rejected, 'reject'],
    'pending -> pending by resubmit' => [ShopVerificationState::Pending, 'resubmit'],
    'verified -> pending by resubmit' => [ShopVerificationState::Verified, 'resubmit'],
    'pending -> pending by reopen' => [ShopVerificationState::Pending, 'reopen'],
    'rejected -> pending by reopen' => [ShopVerificationState::Rejected, 'reopen'],
]);

it('moves rejected and verified shops back to pending', function (): void {
    $owner = ShopTestKit::merchant();
    $rejected = ShopTestKit::shop($owner, ShopVerificationState::Rejected);
    $verified = ShopTestKit::shop($owner, ShopVerificationState::Verified);
    $service = app(ShopVerificationService::class);

    $service->resubmit($rejected, $owner);
    $service->reopen($verified, $owner, ['tax_number']);

    expect(freshShop($rejected)->verification_state)->toBe(ShopVerificationState::Pending)
        ->and(freshShop($verified)->verification_state)->toBe(ShopVerificationState::Pending)
        ->and(freshShop($verified)->verified_at)->toBeNull()
        ->and(Activity::query()->where('event', 'shop.reopened')->sole()->properties->all())
        ->toBe(['from' => 'verified', 'to' => 'pending', 'fields' => ['tax_number']]);
});

it('verifies and rejects through the artisan command for an admin or moderator actor', function (): void {
    Event::fake([ShopVerified::class, ShopRejected::class]);
    $moderator = verificationActor(AdminRole::Moderator);
    $toVerify = ShopTestKit::shop(state: ShopVerificationState::Pending);
    $toReject = ShopTestKit::shop(state: ShopVerificationState::Pending);

    $this->artisan('shops:verify', ['shop' => $toVerify->slug, '--actor' => $moderator->email])
        ->expectsOutputToContain('verified')
        ->assertSuccessful();

    $this->artisan('shops:verify', ['shop' => $toReject->id, '--reject' => true, '--actor' => strtoupper($moderator->email)])
        ->expectsOutputToContain('rejected')
        ->assertSuccessful();

    expect(freshShop($toVerify)->verification_state)->toBe(ShopVerificationState::Verified)
        ->and(freshShop($toReject)->verification_state)->toBe(ShopVerificationState::Rejected)
        ->and(Activity::query()->where('causer_id', $moderator->id)->count())->toBe(2);
    Event::assertDispatched(ShopVerified::class);
    Event::assertDispatched(ShopRejected::class);
});

it('refuses the command without an allowed actor or for a shop that is not pending', function (): void {
    $shop = ShopTestKit::shop(state: ShopVerificationState::Pending);
    $finance = verificationActor(AdminRole::Finance);
    $admin = verificationActor(AdminRole::Admin);

    $this->artisan('shops:verify', ['shop' => $shop->slug])->assertFailed();
    $this->artisan('shops:verify', ['shop' => $shop->slug, '--actor' => 'nobody@example.test'])->assertFailed();
    $this->artisan('shops:verify', ['shop' => $shop->slug, '--actor' => $finance->email])
        ->expectsOutputToContain('not allowed')
        ->assertFailed();
    $this->artisan('shops:verify', ['shop' => $shop->slug, '--actor' => ShopTestKit::merchant()->email])->assertFailed();
    $this->artisan('shops:verify', ['shop' => 'no-such-shop', '--actor' => $admin->email])->assertFailed();

    expect(freshShop($shop)->verification_state)->toBe(ShopVerificationState::Pending);

    $verified = ShopTestKit::shop(state: ShopVerificationState::Verified);
    $this->artisan('shops:verify', ['shop' => $verified->slug, '--reject' => true, '--actor' => $admin->email])
        ->expectsOutputToContain('not pending')
        ->assertFailed();

    expect(freshShop($verified)->verification_state)->toBe(ShopVerificationState::Verified);
});
