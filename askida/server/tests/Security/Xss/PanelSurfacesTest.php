<?php

use App\Domain\Admin\Contracts\HoldsPayouts;
use App\Domain\Auth\Abilities\AdminRole;
use App\Domain\Donations\Models\Donation;
use App\Domain\Fraud\Models\AbuseFlag;
use App\Domain\Payments\Models\PaymentMismatch;
use App\Domain\Payments\Models\Payout;
use App\Domain\Shops\Models\Shop;
use App\Domain\Shops\Models\ShopVerificationState;
use App\Filament\Resources\AbuseFlagResource\Pages\ListAbuseFlags;
use App\Filament\Resources\ActivityLogResource\Pages\ListActivities;
use App\Filament\Resources\DonationResource\Pages\ListDonations;
use App\Filament\Resources\PaymentMismatchResource\Pages\ListPaymentMismatches;
use App\Filament\Resources\PayoutResource\Pages\ListPayouts;
use App\Filament\Resources\ShopResource\Pages\ListShops;
use App\Filament\Resources\ShopResource\Pages\ViewShop;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Livewire\Livewire;
use Spatie\Activitylog\Models\Activity;
use Tests\Datasets\XssPayloads;
use Tests\Feature\Admin\Support\AdminTestKit;
use Tests\Feature\Admin\Support\FakeHoldsPayouts;
use Tests\Security\Xss\XssSurface;
use Tests\Security\Xss\XssWorld;

uses(RefreshDatabase::class);

/*
| Stored-XSS sweep, admin panel surfaces (security checklist item 16): the shop queue and
| shop view, donations, payouts (hold reason), abuse flags, payment mismatches (resolution
| note) and the activity log. Panel pages carry the framework's own scripts, so they are not
| compared with the public page rules; each surface is rendered with the payload and again
| with benign text in the very same rows, and the two element structures must be identical:
| a payload that became markup would add an element or an attribute. The payload must also be
| displayed as characters.
*/

beforeEach(function (): void {
    AdminTestKit::boot();
    $this->holds = new FakeHoldsPayouts;
    app()->instance(HoldsPayouts::class, $this->holds);
});

/**
 * A pending shop (queue), its donation, payout, abuse flag and mismatch, all carrying the payload
 * through the real write paths where one exists (API for shop and item, panel actions for
 * reasons and notes); the abuse flag detail and mismatch snapshots are written by the
 * fraud scan and the settlement job and are seeded as those jobs store them.
 *
 * @return array{shop: Shop, donation: Donation, payout: Payout, flag: AbuseFlag, mismatch: PaymentMismatch}
 */
function panelWorld(object $test, string $payload): array
{
    $world = XssWorld::listedShop($test, $payload, ShopVerificationState::Pending);
    $shop = $world['shop'];

    $donation = Donation::factory()->paid()->create(['shop_id' => $shop->id, 'item_id' => $world['item']->id]);
    $payout = Payout::factory()->create(['shop_id' => $shop->id]);
    $flag = AbuseFlag::factory()->create(['shop_id' => $shop->id, 'detail' => ['note' => $payload, 'redeems_last_hour' => 42]]);
    $mismatch = PaymentMismatch::factory()->create([
        'donation_id' => $donation->id,
        'ours' => ['status' => $payload],
        'theirs' => ['status' => $payload],
    ]);

    return ['shop' => $shop, 'donation' => $donation, 'payout' => $payout, 'flag' => $flag, 'mismatch' => $mismatch];
}

/**
 * Writes the finance and review texts through the panel actions (the real write path).
 */
function panelWrites(string $payload, array $world): void
{
    $hold = XssPayloads::fit($payload, 191, 'Gerekçe');
    $note = XssPayloads::fit($payload, 500, 'Not');

    Livewire::test(ListPayouts::class)->callTableAction('hold', $world['payout'], data: ['reason' => $hold])->assertHasNoTableActionErrors();
    Livewire::test(ListAbuseFlags::class)->callTableAction('review', $world['flag'], data: ['note' => $note])->assertHasNoTableActionErrors();
    Livewire::test(ListPaymentMismatches::class)->callTableAction('resolve', $world['mismatch'], data: ['note' => $note])->assertHasNoTableActionErrors();
}

/**
 * Renders every panel surface of the world.
 *
 * @return array<string, string>
 */
function panelRender(array $world): array
{
    return [
        'shop queue' => Livewire::test(ListShops::class)->html(),
        'shop view' => Livewire::test(ViewShop::class, ['record' => $world['shop']->id])->html(),
        'donations' => Livewire::test(ListDonations::class)->html(),
        'payouts' => Livewire::test(ListPayouts::class)->html(),
        'abuse flags (all)' => Livewire::test(ListAbuseFlags::class)->removeTableFilter('open')->html(),
        'mismatches (all)' => Livewire::test(ListPaymentMismatches::class)->removeTableFilter('open')->html(),
        'activity log' => Livewire::test(ListActivities::class)->html(),
    ];
}

/**
 * Replaces every payload in the world's rows with benign text of the same fields, so the
 * second rendering differs only in text.
 */
function panelBenign(array $world): void
{
    // Same length as the stored value: the panel adds a tooltip to truncated cells, so a
    // shorter benign text would differ in structure for a reason that has nothing to do with the payload.
    $same = static fn (mixed $value): string => str_repeat('g', mb_strlen((string) $value));

    $shop = $world['shop']->refresh();
    $shop->forceFill([
        'name' => $same($shop->name),
        'address' => $same($shop->address),
        'il' => $same($shop->il),
        'ilce' => $same($shop->ilce),
    ])->save();

    $item = $world['donation']->item;
    $item?->forceFill(['name' => $same($item->name)])->save();

    $payout = $world['payout']->refresh();
    $payout->forceFill(['hold_reason' => $same($payout->hold_reason)])->save();

    $flag = $world['flag']->refresh();
    $flag->forceFill(['detail' => ['note' => $same($flag->detail['note'] ?? ''), 'redeems_last_hour' => 42]])->save();

    $mismatch = $world['mismatch']->refresh();
    $mismatch->forceFill([
        'ours' => ['status' => $same($mismatch->ours['status'] ?? '')],
        'theirs' => ['status' => $same($mismatch->theirs['status'] ?? '')],
        'resolution_note' => $same($mismatch->resolution_note),
    ])->save();

    foreach (Activity::query()->get() as $entry) {
        $properties = $entry->properties->all();

        foreach (['reason', 'note'] as $key) {
            if (array_key_exists($key, $properties)) {
                $properties[$key] = $same($properties[$key]);
            }
        }

        $entry->forceFill(['properties' => $properties])->save();
    }
}

it('renders payloads on every admin surface as text with an unchanged element structure', function (string $payload): void {
    $moderator = AdminTestKit::signIn(AdminTestKit::staff(AdminRole::Admin));
    $world = panelWorld($this, $payload);
    panelWrites($payload, $world);
    AdminTestKit::signIn($moderator);

    $withPayload = panelRender($world);

    // Displayed as characters: the stored values reach the text of the surfaces that show them.
    $shop = $world['shop']->refresh();
    $item = $world['donation']->item;
    $hold = $world['payout']->refresh()->hold_reason;

    XssSurface::assertDisplayedAsText(XssSurface::dom($withPayload['shop queue']), $shop->name);
    XssSurface::assertDisplayedAsText(XssSurface::dom($withPayload['shop view']), $shop->address);
    XssSurface::assertDisplayedAsText(XssSurface::dom($withPayload['shop view']), $shop->ilce);
    XssSurface::assertDisplayedAsText(XssSurface::dom($withPayload['donations']), (string) $item?->name);
    XssSurface::assertDisplayedAsText(XssSurface::dom($withPayload['payouts']), (string) $hold, 40);
    XssSurface::assertDisplayedAsText(XssSurface::dom($withPayload['mismatches (all)']), (string) $world['mismatch']->refresh()->resolution_note, 40);
    XssSurface::assertDisplayedAsText(XssSurface::dom($withPayload['activity log']), XssPayloads::fit($payload, 500, 'Not'), 40);

    panelBenign($world);

    $benign = panelRender($world);

    foreach ($withPayload as $surface => $html) {
        XssSurface::assertPanelInert($html, $benign[$surface], $surface);
    }
})->with(XssPayloads::everything());

it('stores the rejection reason of a shop and shows it in the activity log as text', function (string $payload): void {
    AdminTestKit::signIn(AdminTestKit::staff(AdminRole::Admin));
    $shop = XssWorld::listedShop($this, 'Guvenli metin', ShopVerificationState::Pending)['shop'];
    $reason = XssPayloads::fit($payload, 500, 'Ret');

    Livewire::test(ListShops::class)->callTableAction('reject', $shop, data: ['reason' => $reason])->assertHasNoTableActionErrors();

    $entry = Activity::query()->where('event', 'admin.shop_rejected')->sole();
    expect($entry->properties->get('reason'))->toBe($reason);

    $withPayload = Livewire::test(ListActivities::class)->html();
    XssSurface::assertDisplayedAsText(XssSurface::dom($withPayload), $reason, 40);

    $entry->forceFill(['properties' => ['reason' => str_repeat('g', mb_strlen($reason))]])->save();

    XssSurface::assertPanelInert($withPayload, Livewire::test(ListActivities::class)->html(), 'activity log');
})->with(XssPayloads::everything());
