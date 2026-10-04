<?php

use App\Domain\Anon\Models\AnonDevice;
use App\Domain\Auth\Abilities\AdminRole;
use App\Domain\Donations\Models\Donation;
use App\Domain\Hooks\Models\Hook;
use App\Domain\Items\Models\Item;
use App\Domain\Payments\Models\Payout;
use App\Domain\Shops\Models\Shop;
use App\Domain\Shops\Models\ShopDocument;
use App\Domain\Shops\Models\ShopMember;
use App\Domain\Shops\Models\ShopMemberRole;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Str;
use Tests\Security\AuthzScenario;
use Tests\Security\IdorHarness;

/*
| Security checklist item 4: no caller reaches another caller's resource. Endpoint
| checks cover what exists in Phase 1 (GET/PATCH /me); policy checks cover shops,
| items, donations, hooks, payouts and documents, whose endpoints call these policies
| in later phases.
*/

uses(RefreshDatabase::class);

beforeEach(function (): void {
    $this->harness = new IdorHarness($this);
});

describe('me endpoints', function (): void {
    it('only ever shows the token owner', function (): void {
        $a = User::factory()->donor()->create();
        $b = User::factory()->merchant()->create();

        $tokenA = IdorHarness::bearer($a);
        IdorHarness::bearer($b);

        $response = $this->harness->call('GET', '/api/v1/me', $tokenA)->assertOk();

        expect($response->json('data.id'))->toBe($a->id)
            ->and($response->getContent())->not->toContain($b->id)
            ->and($response->getContent())->not->toContain($b->email);
    });

    it('only ever changes the token owner', function (): void {
        $a = User::factory()->donor()->create(['name' => 'Ayşe Demir']);
        $b = User::factory()->donor()->create(['name' => 'Burak Yıldız']);
        $tokenA = IdorHarness::bearer($a);

        $this->harness->call('PATCH', '/api/v1/me', $tokenA, ['name' => 'Ayşe Kaya'])->assertOk();
        $this->harness->call('PATCH', '/api/v1/me', $tokenA, ['id' => $b->id, 'name' => 'Ele geçirildi'])->assertStatus(422);

        expect($a->fresh()?->name)->toBe('Ayşe Kaya')
            ->and($b->fresh()?->name)->toBe('Burak Yıldız');
    });

    it('refuses the token of a deactivated user', function (): void {
        $user = User::factory()->donor()->create();
        $token = IdorHarness::bearer($user);

        $this->harness->call('GET', '/api/v1/me', $token)->assertOk();

        $user->forceFill(['deactivated_at' => now()])->save();

        IdorHarness::assertProblem($this->harness->call('GET', '/api/v1/me', $token), 401);
        IdorHarness::assertProblem($this->harness->call('PATCH', '/api/v1/me', $token, ['name' => 'Yeni Ad']), 401);
    });

    it('refuses a revoked token', function (): void {
        $user = User::factory()->donor()->create();
        $token = IdorHarness::bearer($user);

        $this->harness->call('POST', '/api/v1/auth/logout', $token)->assertNoContent();

        IdorHarness::assertProblem($this->harness->call('GET', '/api/v1/me', $token), 401);
    });

    it('refuses a token whose ability does not mirror the account kind', function (array $abilities): void {
        $user = User::factory()->donor()->create();
        $token = $user->createToken('forged-device', $abilities)->plainTextToken;

        IdorHarness::assertProblem($this->harness->call('GET', '/api/v1/me', $token), 401);
    })->with([
        'anon ability on a user token' => [['anon']],
        'other kind' => [['merchant']],
        'wildcard' => [['*']],
        'two abilities' => [['donor', 'merchant']],
        'no ability' => [[]],
    ]);
});

describe('shops', function (): void {
    it('hides another merchant\'s shop from changes and lets staff know it exists', function (): void {
        $world = new AuthzScenario;
        $otherOwner = AuthzScenario::merchant();
        AuthzScenario::join(Shop::factory()->verified()->create(), $otherOwner, ShopMemberRole::Owner);

        IdorHarness::assertPolicyDenies($otherOwner, 'update', $world->shop, 404);
        IdorHarness::assertPolicyDenies($world->actor('staff'), 'update', $world->shop, 403);
        IdorHarness::assertPolicyDenies($world->actor('donor'), 'update', $world->shop, 403);
        IdorHarness::assertPolicyAllows($world->actor('owner'), 'update', $world->shop);
    });

    it('shows an unverified shop to its members only', function (): void {
        $shop = Shop::factory()->create();
        $owner = AuthzScenario::merchant();
        $staff = AuthzScenario::merchant();
        AuthzScenario::join($shop, $owner, ShopMemberRole::Owner);
        AuthzScenario::join($shop, $staff, ShopMemberRole::Staff);

        IdorHarness::assertPolicyAllows($owner, 'view', $shop);
        IdorHarness::assertPolicyAllows($staff, 'view', $shop);
        IdorHarness::assertPolicyDenies(AuthzScenario::merchant(), 'view', $shop, 404);
        IdorHarness::assertPolicyDenies(AuthzScenario::donor(), 'view', $shop, 404);
        IdorHarness::assertPolicyDenies(AnonDevice::factory()->create(), 'view', $shop, 404);
    });

    it('takes access away from a removed staff member on the next check', function (): void {
        $world = new AuthzScenario;
        $staff = $world->actor('staff');

        IdorHarness::assertPolicyAllows($staff, 'redeem', [Hook::class, $world->shop]);

        ShopMember::query()->where('shop_id', $world->shop->id)->where('user_id', $staff?->getKey())->delete();

        IdorHarness::assertPolicyDenies($staff, 'redeem', [Hook::class, $world->shop], 404);
    });

    it('keeps staff accounts from opening shops of their own', function (): void {
        $world = new AuthzScenario;

        IdorHarness::assertPolicyAllows(AuthzScenario::merchant(), 'create', Shop::class);
        IdorHarness::assertPolicyDenies($world->actor('staff'), 'create', Shop::class, 403);
    });
});

describe('items', function (): void {
    it('refuses another merchant and an item id taken from another shop', function (): void {
        $world = new AuthzScenario;
        $foreignItem = Item::factory()->create();
        $otherOwner = AuthzScenario::merchant();
        AuthzScenario::join($foreignItem->shop()->firstOrFail(), $otherOwner, ShopMemberRole::Owner);

        IdorHarness::assertPolicyDenies($otherOwner, 'create', [Item::class, $world->shop], 404);
        IdorHarness::assertPolicyDenies($otherOwner, 'update', [$world->item, $world->shop], 404);
        // The owner of the path shop with an item id of another shop.
        IdorHarness::assertPolicyDenies($world->actor('owner'), 'update', [$foreignItem, $world->shop], 404);
        // The other owner pairing its own item with a shop it does not own.
        IdorHarness::assertPolicyDenies($otherOwner, 'update', [$foreignItem, $world->shop], 404);
        IdorHarness::assertPolicyDenies($world->actor('staff'), 'update', [$world->item, $world->shop], 403);
        IdorHarness::assertPolicyAllows($world->actor('owner'), 'update', [$world->item, $world->shop]);
    });
});

describe('donations', function (): void {
    it('shows a donation to its donor only', function (): void {
        $world = new AuthzScenario;

        IdorHarness::assertPolicyAllows($world->actor('donor'), 'view', $world->donation);
        IdorHarness::assertPolicyDenies(AuthzScenario::donor(), 'view', $world->donation, 404);
        IdorHarness::assertPolicyDenies($world->actor('owner'), 'view', $world->donation, 403);
        IdorHarness::assertPolicyDenies($world->actor('anon'), 'view', $world->donation, 403);
    });

    it('gives an anonymised donation to nobody', function (): void {
        $world = new AuthzScenario;
        $world->donation->forceFill(['donor_id' => null, 'anonymized_at' => now()])->save();

        IdorHarness::assertPolicyDenies($world->actor('donor'), 'view', $world->donation->fresh(), 404);
    });

    it('does not let admin roles read donor data through the API', function (): void {
        $world = new AuthzScenario;
        $adminWithDonorToken = AuthzScenario::withToken(AuthzScenario::admin(AdminRole::Admin));

        IdorHarness::assertPolicyDenies($adminWithDonorToken, 'view', $world->donation, 404);
        IdorHarness::assertPolicyDenies($world->actor('admin'), 'view', $world->donation, 403);
        IdorHarness::assertPolicyDenies($world->actor('fin'), 'view', $world->donation, 403);
        expect(Gate::forUser($adminWithDonorToken)->allows('view-donations'))->toBeFalse()
            ->and(Gate::forUser($world->actor('fin'))->allows('view-donations'))->toBeTrue();
    });

    it('answers 404 through a policy-protected route like a missing id', function (): void {
        $world = new AuthzScenario;
        Route::middleware(['api', 'auth:sanctum'])->get('api/v1/test-idor/donations/{donation}', function (Donation $donation): array {
            Gate::authorize('view', $donation);

            return ['id' => $donation->id];
        });

        $owner = $world->donation->donor()->firstOrFail();

        $this->harness->assertRouteIsolated(
            'GET',
            '/api/v1/test-idor/donations/{donation}',
            fn (User $donor): Donation => $world->donation,
            $owner,
            User::factory()->donor()->create(),
        );

        $missing = $this->harness->call('GET', '/api/v1/test-idor/donations/'.Str::uuid7(), IdorHarness::bearer($owner, 'third'));
        IdorHarness::assertProblem($missing, 404);
    });
});

describe('hooks', function (): void {
    it('keeps redemption and the redemption list inside the shop', function (): void {
        $world = new AuthzScenario;
        $otherStaff = AuthzScenario::merchant();
        AuthzScenario::join(Shop::factory()->verified()->create(), $otherStaff, ShopMemberRole::Staff);

        foreach (['redeem', 'viewRedemptions'] as $ability) {
            IdorHarness::assertPolicyAllows($world->actor('staff'), $ability, [Hook::class, $world->shop]);
            IdorHarness::assertPolicyDenies($otherStaff, $ability, [Hook::class, $world->shop], 404);
            IdorHarness::assertPolicyDenies($world->actor('donor'), $ability, [Hook::class, $world->shop], 403);
        }
    });

    it('lets only a device that is not banned reserve', function (): void {
        IdorHarness::assertPolicyAllows(AnonDevice::factory()->create(), 'reserve', Hook::class);
        expect(Gate::forUser(AnonDevice::factory()->banned()->create())->allows('reserve', Hook::class))->toBeFalse();
        IdorHarness::assertPolicyDenies(AuthzScenario::donor(), 'reserve', Hook::class, 403);
    });

    it('lets nobody edit a hook by hand', function (): void {
        $world = new AuthzScenario;

        foreach (['donor', 'owner', 'staff', 'anon', 'mod', 'fin', 'admin'] as $principal) {
            expect(Gate::forUser($world->actor($principal))->allows('update', $world->hook))->toBeFalse();
        }
    });
});

describe('payouts and documents', function (): void {
    it('shows payouts to the owner only', function (): void {
        $world = new AuthzScenario;
        $otherOwner = AuthzScenario::merchant();
        AuthzScenario::join(Shop::factory()->create(), $otherOwner, ShopMemberRole::Owner);

        IdorHarness::assertPolicyAllows($world->actor('owner'), 'viewAny', [Payout::class, $world->shop]);
        IdorHarness::assertPolicyDenies($world->actor('staff'), 'viewAny', [Payout::class, $world->shop], 403);
        IdorHarness::assertPolicyDenies($otherOwner, 'viewAny', [Payout::class, $world->shop], 404);
    });

    it('lets the owner upload and keeps every API caller away from documents', function (): void {
        $world = new AuthzScenario;
        $otherOwner = AuthzScenario::merchant();
        AuthzScenario::join(Shop::factory()->create(), $otherOwner, ShopMemberRole::Owner);

        IdorHarness::assertPolicyAllows($world->actor('owner'), 'create', [ShopDocument::class, $world->shop]);
        IdorHarness::assertPolicyDenies($otherOwner, 'create', [ShopDocument::class, $world->shop], 404);

        foreach (['donor', 'owner', 'staff', 'anon'] as $principal) {
            IdorHarness::assertPolicyDenies($world->actor($principal), 'view', $world->document, 404);
        }

        $moderatorWithToken = AuthzScenario::withToken(AuthzScenario::admin(AdminRole::Moderator));
        IdorHarness::assertPolicyDenies($moderatorWithToken, 'view', $world->document, 404);
        IdorHarness::assertPolicyAllows($world->actor('mod'), 'view', $world->document);
        IdorHarness::assertPolicyDenies($world->actor('fin'), 'view', $world->document, 403);
    });
});

describe('deactivated accounts', function (): void {
    it('denies every policy to a deactivated user even with a token in hand', function (): void {
        $world = new AuthzScenario;
        $owner = $world->actor('owner');
        $owner?->forceFill(['deactivated_at' => now()])->save();

        expect(Gate::forUser($owner)->allows('update', $world->shop))->toBeFalse()
            ->and(Gate::forUser($owner)->allows('redeem', [Hook::class, $world->shop]))->toBeFalse();

        $admin = $world->actor('admin');
        $admin?->forceFill(['deactivated_at' => now()])->save();

        expect(Gate::forUser($admin)->allows('admin'))->toBeFalse();
    });
});
