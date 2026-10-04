<?php

use App\Domain\Anon\Models\AnonDevice;
use App\Domain\Auth\Abilities\AdminRole;
use App\Domain\Payments\Models\Payout;
use App\Domain\Shops\Models\ShopVerificationState;
use App\Filament\Resources\AnonDeviceResource;
use App\Filament\Resources\AnonDeviceResource\Pages\ListAnonDevices;
use App\Filament\Resources\PayoutResource\Pages\ListPayouts;
use App\Filament\Resources\ShopResource\Pages\ViewShop;
use App\Filament\Support\RevealFinancialsAction;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Livewire\Livewire;
use Spatie\Activitylog\Models\Activity;
use Tests\Feature\Admin\Support\AdminTestKit;
use Tests\Feature\Api\Shops\Support\ShopTestKit;

/*
| Reveal of the decrypted tax number and IBAN (matrix: finance, admin) and the anonymous
| device ban screen (matrix: moderator, admin).
*/

uses(RefreshDatabase::class);

beforeEach(fn () => AdminTestKit::boot());

it('reveals the decrypted values in the modal once, after writing the audit entry', function (AdminRole $role): void {
    $user = AdminTestKit::signIn(AdminTestKit::staff($role));
    $shop = ShopTestKit::shop(state: ShopVerificationState::Pending);
    $payout = Payout::factory()->for($shop)->create();
    $taxNumber = (string) $shop->tax_number_enc;
    $iban = (string) $shop->iban_enc;

    $list = Livewire::test(ListPayouts::class);
    expect($list->html())->not->toContain($taxNumber)->and($list->html())->not->toContain($iban);
    expect(Activity::query()->where('event', RevealFinancialsAction::EVENT)->count())->toBe(0);

    $list->mountTableAction('reveal_financials', $payout);

    expect(Activity::query()->where('event', RevealFinancialsAction::EVENT)->count())->toBe(1);
    $list->assertSee($taxNumber)->assertSee($iban);

    $entry = Activity::query()->where('event', RevealFinancialsAction::EVENT)->sole();
    expect($entry->causer_id)->toBe($user->id)
        ->and($entry->subject_id)->toBe($shop->id)
        ->and($entry->properties->all())->toBe(['shop_id' => $shop->id]);

    // The decrypted values are neither in the component state nor in any stored row.
    expect(json_encode($list->snapshot))->not->toContain($taxNumber)->and(json_encode($list->snapshot))->not->toContain($iban)
        ->and(Activity::query()->get()->toJson())->not->toContain($taxNumber)->not->toContain($iban);
})->with([AdminRole::Finance, AdminRole::Admin]);

it('does not reveal to a moderator, who cannot even see the action', function (): void {
    AdminTestKit::signIn(AdminTestKit::staff(AdminRole::Moderator));
    $shop = ShopTestKit::shop(state: ShopVerificationState::Pending);

    $view = Livewire::test(ViewShop::class, ['record' => $shop->id]);
    $view->assertActionHidden('reveal_financials');
    expect(fn () => $view->mountAction('reveal_financials')->html())->not->toThrow(Throwable::class);
    expect(Activity::query()->where('event', RevealFinancialsAction::EVENT)->count())->toBe(0)
        ->and($view->html())->not->toContain((string) $shop->tax_number_enc);
});

it('lets an admin reveal from the shop page too', function (): void {
    AdminTestKit::signIn(AdminTestKit::staff(AdminRole::Admin));
    $shop = ShopTestKit::shop(state: ShopVerificationState::Pending);

    Livewire::test(ViewShop::class, ['record' => $shop->id])
        ->assertActionVisible('reveal_financials')
        ->mountAction('reveal_financials')
        ->assertSee((string) $shop->iban_enc);

    expect(Activity::query()->where('event', RevealFinancialsAction::EVENT)->count())->toBe(1);
});

it('lists anonymous devices with the five allowed columns only', function (): void {
    AdminTestKit::signIn(AdminTestKit::staff(AdminRole::Moderator));
    $device = AnonDevice::factory()->create();

    $component = Livewire::test(ListAnonDevices::class)->assertCanSeeTableRecords([$device]);

    expect(array_keys($component->instance()->getTable()->getColumns()))
        ->toBe(['anon_id', 'platform', 'attestation_verdict', 'today_count', 'banned_at']);
});

it('bans and unbans a device, audits both and refuses a repeat', function (AdminRole $role): void {
    $user = AdminTestKit::signIn(AdminTestKit::staff($role));
    $device = AnonDevice::factory()->create();

    Livewire::test(ListAnonDevices::class)->assertTableActionHidden('unban', $device)
        ->callTableAction('ban', $device)->assertHasNoTableActionErrors();
    expect($device->refresh()->banned_at)->not->toBeNull();

    Livewire::test(ListAnonDevices::class)->assertTableActionHidden('ban', $device)
        ->callTableAction('unban', $device)->assertHasNoTableActionErrors();
    expect($device->refresh()->banned_at)->toBeNull();

    $entries = Activity::query()->whereIn('event', ['admin.anon_device_banned', 'admin.anon_device_unbanned'])->orderBy('id')->get();
    expect($entries->pluck('event')->all())->toBe(['admin.anon_device_banned', 'admin.anon_device_unbanned'])
        ->and($entries->pluck('causer_id')->unique()->all())->toBe([$user->id])
        ->and($entries->pluck('subject_id')->unique()->all())->toBe([$device->id])
        ->and($entries->every(fn (Activity $a): bool => $a->properties->isEmpty()))->toBeTrue();
})->with([AdminRole::Moderator, AdminRole::Admin]);

it('keeps the anonymous device screen closed to finance', function (): void {
    AdminTestKit::signIn(AdminTestKit::staff(AdminRole::Finance));

    expect(AnonDeviceResource::canViewAny())->toBeFalse();
    Livewire::test(ListAnonDevices::class)->assertForbidden();
});
