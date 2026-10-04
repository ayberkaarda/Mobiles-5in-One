<?php

use App\Domain\Admin\Contracts\HoldsPayouts;
use App\Domain\Admin\Contracts\RefundsDonations;
use App\Domain\Anon\Models\AnonDevice;
use App\Domain\Auth\Abilities\AdminRole;
use App\Domain\Donations\Models\Donation;
use App\Domain\Fraud\Models\AbuseFlag;
use App\Domain\Payments\Models\PaymentMismatch;
use App\Domain\Payments\Models\Payout;
use App\Domain\Shops\Models\ShopVerificationState;
use App\Filament\Resources\ShopResource\Pages\ViewShop;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Livewire\Livewire;
use Tests\Datasets\AuthorizationMatrix;
use Tests\Feature\Admin\Support\AdminTestKit;
use Tests\Feature\Admin\Support\FakeHoldsPayouts;
use Tests\Feature\Admin\Support\FakeRefundsDonations;
use Tests\Feature\Api\Shops\Support\ShopTestKit;

/*
| Authorization matrix section 4, cell by cell, against the panel itself: the screen or
| action named by each row's `panel` check must be reachable exactly for the principals
| whose cell is `Y`.
*/

uses(RefreshDatabase::class);

beforeEach(function (): void {
    AdminTestKit::boot();
    app()->instance(HoldsPayouts::class, new FakeHoldsPayouts);
    app()->instance(RefundsDonations::class, new FakeRefundsDonations);
});

/**
 * @return array<string, array{string, AdminRole, bool, array<int, mixed>}>
 */
function matrixPanelCells(): array
{
    $roles = ['mod' => AdminRole::Moderator, 'fin' => AdminRole::Finance, 'admin' => AdminRole::Admin];
    $cases = [];

    foreach (AuthorizationMatrix::rows() as $key => $row) {
        foreach ($row['checks'] as $check) {
            if ($check[0] !== 'panel') {
                continue;
            }

            $label = class_basename($check[1]).' '.($check[2] ?? '').' '.($check[3] ?? '');

            foreach ($row['cells'] as $principal => $cell) {
                $cases["{$key} | {$label} | {$principal} = {$cell}"] = [$key, $roles[$principal], $cell === 'Y', $check];
            }
        }
    }

    return $cases;
}

/**
 * A record on which the action is applicable.
 */
function matrixPanelRecord(string $resource, string $action = ''): Model
{
    return match (class_basename($resource)) {
        'ShopResource' => ShopTestKit::shop(state: ShopVerificationState::Pending),
        'DonationResource' => Donation::factory()->paid()->create(),
        'PayoutResource' => Payout::factory()->create(),
        'PaymentMismatchResource' => PaymentMismatch::factory()->create(),
        'AbuseFlagResource' => AbuseFlag::factory()->create(),
        'UserResource' => AdminTestKit::staff(AdminRole::Moderator),
        'AnonDeviceResource' => $action === 'unban' ? AnonDevice::factory()->banned()->create() : AnonDevice::factory()->create(),
        default => throw new LogicException('No record for '.$resource),
    };
}

it('has panel checks on the admin rows', function (): void {
    expect(count(matrixPanelCells()))->toBe(3 * 19);
});

it('enforces the admin panel cell', function (string $key, AdminRole $role, bool $allowed, array $check): void {
    AdminTestKit::signIn(AdminTestKit::staff($role));

    if ($check[2] === 'relation') {
        expect($check[1]::canViewForRecord(ShopTestKit::shop(), ViewShop::class))->toBe($allowed);

        return;
    }

    $resource = $check[1];

    if ($check[2] === 'viewAny') {
        expect($resource::canViewAny())->toBe($allowed);

        return;
    }

    $record = matrixPanelRecord($resource, (string) ($check[3] ?? ''));

    if (! $resource::canViewAny()) {
        expect($allowed)->toBeFalse();

        return;
    }

    $list = Livewire::test($resource::getPages()['index']->getPage());
    $allowed
        ? $list->assertTableActionVisible($check[3], $record)
        : $list->assertTableActionHidden($check[3], $record);
})->with(matrixPanelCells());
