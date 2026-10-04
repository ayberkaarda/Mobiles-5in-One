<?php

use App\Domain\Admin\Contracts\HoldsPayouts;
use App\Domain\Admin\Contracts\RefundsDonations;
use App\Domain\Auth\Abilities\AdminRole;
use App\Domain\Donations\Models\Donation;
use App\Domain\Fraud\Models\AbuseFlag;
use App\Domain\Payments\Models\PaymentMismatch;
use App\Domain\Payments\Models\Payout;
use App\Domain\Shops\Documents\DocumentStorage;
use App\Domain\Shops\Events\ShopVerified;
use App\Domain\Shops\Models\ShopDocument;
use App\Domain\Shops\Models\ShopDocumentKind;
use App\Domain\Shops\Models\ShopVerificationState;
use App\Filament\Resources\AbuseFlagResource\Pages\ListAbuseFlags;
use App\Filament\Resources\DonationResource;
use App\Filament\Resources\DonationResource\Pages\ListDonations;
use App\Filament\Resources\PaymentMismatchResource\Pages\ListPaymentMismatches;
use App\Filament\Resources\PayoutResource\Pages\ListPayouts;
use App\Filament\Resources\ShopResource;
use App\Filament\Resources\ShopResource\Pages\ListShops;
use App\Filament\Resources\ShopResource\Pages\ViewShop;
use App\Filament\Resources\ShopResource\RelationManagers\DocumentsRelationManager;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Str;
use Livewire\Livewire;
use Spatie\Activitylog\Models\Activity;
use Tests\Feature\Admin\Support\AdminTestKit;
use Tests\Feature\Admin\Support\FakeHoldsPayouts;
use Tests\Feature\Admin\Support\FakeRefundsDonations;
use Tests\Feature\Api\Shops\Support\ShopTestKit;

/*
| Panel actions: verification through the domain service, masked financial fields,
| signed document URLs, finance tools behind the admin contracts, activity log entries.
*/

uses(RefreshDatabase::class);

beforeEach(fn () => AdminTestKit::boot());

function panelDocument(string $shopId): ShopDocument
{
    $id = (string) Str::uuid7();
    $document = new ShopDocument(['kind' => ShopDocumentKind::TaxCertificate]);
    $document->forceFill([
        'id' => $id,
        'shop_id' => $shopId,
        'path' => DocumentStorage::documentKey($shopId, $id),
        'mime' => 'application/pdf',
        'size' => 2048,
        'uploaded_at' => now(),
    ])->save();

    return $document;
}

it('lists the pending queue by default and approves through the verification service', function (): void {
    Event::fake([ShopVerified::class]);
    $moderator = AdminTestKit::signIn(AdminTestKit::staff(AdminRole::Moderator));
    $pending = ShopTestKit::shop(state: ShopVerificationState::Pending);
    $verified = ShopTestKit::shop();

    Livewire::test(ListShops::class)
        ->assertCanSeeTableRecords([$pending])
        ->assertCanNotSeeTableRecords([$verified])
        ->callTableAction('approve', $pending)
        ->assertHasNoTableActionErrors();

    expect($pending->refresh()->verification_state)->toBe(ShopVerificationState::Verified);
    Event::assertDispatched(ShopVerified::class, fn (ShopVerified $e): bool => $e->shopId === $pending->id && $e->actorId === $moderator->id);
    expect(Activity::query()->where('event', 'shop.verified')->value('causer_id'))->toBe($moderator->id);
});

it('requires a reason to reject and records it in the activity log', function (): void {
    $moderator = AdminTestKit::signIn(AdminTestKit::staff(AdminRole::Moderator));
    $pending = ShopTestKit::shop(state: ShopVerificationState::Pending);

    Livewire::test(ListShops::class)
        ->callTableAction('reject', $pending, data: ['reason' => ''])
        ->assertHasTableActionErrors(['reason' => 'required']);
    expect($pending->refresh()->verification_state)->toBe(ShopVerificationState::Pending);

    Livewire::test(ListShops::class)
        ->callTableAction('reject', $pending, data: ['reason' => 'Vergi levhası okunmuyor'])
        ->assertHasNoTableActionErrors();

    expect($pending->refresh()->verification_state)->toBe(ShopVerificationState::Rejected);
    $entry = Activity::query()->where('event', 'admin.shop_rejected')->sole();
    expect($entry->causer_id)->toBe($moderator->id)
        ->and($entry->subject_id)->toBe($pending->id)
        ->and($entry->properties->all())->toBe(['reason' => 'Vergi levhası okunmuyor']);
});

it('shows tax number and IBAN masked to the last four, never in full', function (): void {
    $shop = ShopTestKit::shop(state: ShopVerificationState::Pending);
    $taxNumber = (string) $shop->tax_number_enc;
    $iban = (string) $shop->iban_enc;
    AdminTestKit::httpSession(AdminTestKit::staff(AdminRole::Moderator));

    $html = (string) $this->get(ShopResource::getUrl('view', ['record' => $shop]))->assertOk()->getContent();

    expect($html)->toContain('•••• '.substr($taxNumber, -4))
        ->and($html)->toContain('•••• '.substr($iban, -4))
        ->and($html)->not->toContain($taxNumber)
        ->and($html)->not->toContain($iban)
        ->and($html)->not->toContain(substr($iban, 4, 12));
});

it('opens a document only through a fresh 5-minute signed URL and never prints the key', function (): void {
    $moderator = AdminTestKit::staff(AdminRole::Moderator);
    $shop = ShopTestKit::shop(state: ShopVerificationState::Pending);
    $document = panelDocument($shop->id);

    AdminTestKit::httpSession($moderator);
    $html = (string) $this->get(ShopResource::getUrl('view', ['record' => $shop]))->assertOk()->getContent();
    expect($html)->toContain('Görüntüle')->not->toContain($document->path)->not->toContain('X-Amz-Signature');

    AdminTestKit::signIn($moderator);
    $component = Livewire::test(DocumentsRelationManager::class, ['ownerRecord' => $shop, 'pageClass' => ViewShop::class])
        ->callTableAction('open', $document);

    $url = (string) ($component->effects['redirect'] ?? '');
    expect($url)->toContain('X-Amz-Signature=')
        ->and($url)->toMatch('/X-Amz-Expires=300(&|$)/')
        ->and($url)->toContain('response-content-disposition=attachment');
    expect(Activity::query()->where('event', 'document.url_issued')->value('causer_id'))->toBe($moderator->id);
});

it('keeps the documents relation away from finance', function (): void {
    AdminTestKit::signIn(AdminTestKit::staff(AdminRole::Finance));

    expect(DocumentsRelationManager::canViewForRecord(ShopTestKit::shop(), ViewShop::class))->toBeFalse();
});

it('lists donations without donor, provider or recipient fields', function (): void {
    AdminTestKit::signIn(AdminTestKit::staff(AdminRole::Finance));
    $donation = Donation::factory()->paid()->create();
    $donation->forceFill(['provider_token' => 'tok-'.bin2hex(random_bytes(6)), 'conversation_id' => 'conv-'.bin2hex(random_bytes(6))])->save();

    $component = Livewire::test(ListDonations::class)->assertCanSeeTableRecords([$donation]);
    $html = $component->html();

    expect($html)->not->toContain((string) $donation->provider_token)
        ->and($html)->not->toContain((string) $donation->conversation_id)
        ->and($html)->not->toContain((string) $donation->provider_payment_id)
        ->and($html)->not->toContain((string) $donation->donor?->email);

    $columns = array_keys($component->instance()->getTable()->getColumns());
    expect($columns)->not->toContain('donor_id')->not->toContain('provider_token')->not->toContain('provider_payment_id');
});

it('refunds a paid donation only through the refund contract, with a reason', function (): void {
    $fake = new FakeRefundsDonations;
    app()->instance(RefundsDonations::class, $fake);
    $finance = AdminTestKit::signIn(AdminTestKit::staff(AdminRole::Finance));
    $donation = Donation::factory()->paid()->create();

    Livewire::test(ListDonations::class)
        ->callTableAction('refund', $donation, data: ['reason' => ''])
        ->assertHasTableActionErrors(['reason' => 'required'])
        ->callTableAction('refund', $donation, data: ['reason' => 'İşletme kapandı'])
        ->assertHasNoTableActionErrors();

    expect($fake->calls)->toBe([[$donation->id, $finance->id, 'İşletme kapandı']])
        ->and(Activity::query()->where('event', 'admin.refund_requested')->value('subject_id'))->toBe($donation->id);
});

it('holds and releases a payout through the payouts contract with a mandatory reason', function (): void {
    $fake = new FakeHoldsPayouts;
    app()->instance(HoldsPayouts::class, $fake);
    $finance = AdminTestKit::signIn(AdminTestKit::staff(AdminRole::Finance));
    $payout = Payout::factory()->create();

    Livewire::test(ListPayouts::class)
        ->assertTableActionHidden('release', $payout)
        ->callTableAction('hold', $payout, data: ['reason' => ''])
        ->assertHasTableActionErrors(['reason' => 'required'])
        ->callTableAction('hold', $payout, data: ['reason' => 'Olağandışı kullanım oranı'])
        ->assertHasNoTableActionErrors();

    expect($payout->refresh()->hold)->toBeTrue();

    Livewire::test(ListPayouts::class)
        ->assertTableActionHidden('hold', $payout)
        ->callTableAction('release', $payout, data: ['reason' => 'İnceleme tamamlandı']);

    expect($payout->refresh()->hold)->toBeFalse()
        ->and(array_column($fake->calls, 0))->toBe(['hold', 'release'])
        ->and(Activity::query()->whereIn('event', ['admin.payout_held', 'admin.payout_released'])->pluck('causer_id')->unique()->all())->toBe([$finance->id]);
});

it('hides finance tools that have no domain service bound', function (): void {
    AdminTestKit::signIn(AdminTestKit::staff(AdminRole::Admin));
    $payout = Payout::factory()->create();

    if (! app()->bound(HoldsPayouts::class)) {
        Livewire::test(ListPayouts::class)->assertTableActionHidden('hold', $payout);
    }

    expect(DonationResource::canViewAny())->toBeTrue();
});

it('resolves a payment mismatch with a note, once', function (): void {
    $finance = AdminTestKit::signIn(AdminTestKit::staff(AdminRole::Finance));
    $mismatch = PaymentMismatch::factory()->create();

    Livewire::test(ListPaymentMismatches::class)
        ->assertCanSeeTableRecords([$mismatch])
        ->callTableAction('resolve', $mismatch, data: ['note' => 'Sağlayıcı ile eşleşti'])
        ->assertHasNoTableActionErrors();

    $mismatch->refresh();
    expect($mismatch->resolved_at)->not->toBeNull()
        ->and($mismatch->resolved_by)->toBe($finance->id)
        ->and($mismatch->resolution_note)->toBe('Sağlayıcı ile eşleşti')
        ->and(Activity::query()->where('event', 'admin.mismatch_resolved')->value('subject_id'))->toBe($mismatch->id);

    Livewire::test(ListPaymentMismatches::class)->assertCanNotSeeTableRecords([$mismatch]);
});

it('marks an abuse flag reviewed with a note in the activity log', function (AdminRole $role): void {
    $reviewer = AdminTestKit::signIn(AdminTestKit::staff($role));
    $flag = AbuseFlag::factory()->create();

    Livewire::test(ListAbuseFlags::class)
        ->callTableAction('review', $flag, data: ['note' => 'Fırın yoğun saatte, olağan'])
        ->assertHasNoTableActionErrors();

    expect($flag->refresh()->reviewed_at)->not->toBeNull()
        ->and($flag->reviewer_id)->toBe($reviewer->id);
    $entry = Activity::query()->where('event', 'admin.abuse_flag_reviewed')->sole();
    expect($entry->properties->get('note'))->toBe('Fırın yoğun saatte, olağan');
})->with([AdminRole::Moderator, AdminRole::Finance]);

it('refuses moderator actions to finance even when called directly', function (): void {
    AdminTestKit::signIn(AdminTestKit::staff(AdminRole::Finance));
    $pending = ShopTestKit::shop(state: ShopVerificationState::Pending);

    Livewire::test(ListShops::class)->assertForbidden();
    Livewire::test(ViewShop::class, ['record' => $pending->id])->assertForbidden();
    expect($pending->refresh()->verification_state)->toBe(ShopVerificationState::Pending);
});
