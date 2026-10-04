<?php

use App\Domain\Fraud\Models\AbuseFlag;
use App\Domain\Payments\Exceptions\GatewayUnavailable;
use App\Domain\Payouts\Exceptions\OnboardingFailed;
use App\Domain\Payouts\Jobs\OnboardSubMerchant;
use App\Domain\Shops\Events\ShopVerified;
use App\Domain\Shops\Listeners\OnboardSubMerchantOnVerified;
use App\Domain\Shops\Models\Shop;
use App\Domain\Shops\Models\ShopVerificationState;
use App\Domain\Shops\Services\ShopVerificationService;
use App\Models\User;
use Database\Seeders\RolesSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Log\Events\MessageLogged;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Queue;
use Tests\Feature\Api\Hooks\Support\HookWorld;
use Tests\Support\Payouts\PayoutWorld;
use Tests\Support\Payouts\ScriptedPayoutGateway;

/*
| Sub-merchant onboarding: ShopVerified -> OnboardSubMerchant (queue payments). The tax
| number and IBAN are decrypted only inside the job and never reach logs, payloads,
| exception messages or failure records.
*/

uses(RefreshDatabase::class);

beforeEach(function (): void {
    $this->gateway = ScriptedPayoutGateway::bind();
});

function runOnboarding(Shop $shop): void
{
    app()->call([new OnboardSubMerchant($shop->id), 'handle']);
}

it('queues onboarding on the payments queue when a moderator verifies a shop', function (): void {
    Queue::fake();
    $this->seed(RolesSeeder::class);
    $moderator = User::factory()->create();
    $moderator->assignRole('moderator');
    ['shop' => $shop] = PayoutWorld::shopWithFinancials(verified: false);

    app(ShopVerificationService::class)->verify($shop, $moderator);

    Queue::assertPushedOn('payments', OnboardSubMerchant::class, fn (OnboardSubMerchant $job): bool => $job->shopId === $shop->id);
});

it('listens to ShopVerified', function (): void {
    Event::fake();

    Event::assertListening(ShopVerified::class, OnboardSubMerchantOnVerified::class);
});

it('creates the sub-merchant with the decrypted data and stores the key', function (): void {
    ['shop' => $shop, 'tax' => $tax, 'iban' => $iban] = PayoutWorld::shopWithFinancials();
    $key = PayoutWorld::key();
    $this->gateway->subMerchantOutcomes = [$key];

    runOnboarding($shop);

    expect($this->gateway->subMerchantCalls)->toHaveCount(1)
        ->and($this->gateway->subMerchantCalls[0]->externalId)->toBe($shop->id)
        ->and($this->gateway->subMerchantCalls[0]->taxNumber)->toBe($tax)
        ->and($this->gateway->subMerchantCalls[0]->iban)->toBe($iban)
        ->and($this->gateway->subMerchantCalls[0]->email)->toBe(HookWorld::owner($shop)->email)
        ->and($shop->refresh()->sub_merchant_key)->toBe($key)
        ->and(DB::table('activity_log')->where('event', 'payout.sub_merchant_onboarded')->where('subject_id', $shop->id)->count())->toBe(1);
});

it('is idempotent: a shop with a key is never sent again', function (): void {
    $existing = PayoutWorld::key();
    ['shop' => $shop] = PayoutWorld::shopWithFinancials(subMerchantKey: $existing);
    $this->gateway->subMerchantOutcomes = [PayoutWorld::key()];

    runOnboarding($shop);

    expect($this->gateway->subMerchantCalls)->toBe([])
        ->and($shop->refresh()->sub_merchant_key)->toBe($existing);
});

it('calls the provider once when the job runs twice', function (): void {
    ['shop' => $shop] = PayoutWorld::shopWithFinancials();

    runOnboarding($shop);
    runOnboarding($shop);

    expect($this->gateway->subMerchantCalls)->toHaveCount(1);
});

it('skips a shop that is not verified', function (): void {
    ['shop' => $shop] = PayoutWorld::shopWithFinancials(verified: false);

    runOnboarding($shop);

    expect($this->gateway->subMerchantCalls)->toBe([])
        ->and($shop->refresh()->sub_merchant_key)->toBeNull();
});

it('keeps the key when a verified shop goes back to pending, and re-verification does not onboard again', function (): void {
    $existing = PayoutWorld::key();
    ['shop' => $shop] = PayoutWorld::shopWithFinancials(subMerchantKey: $existing);

    app(ShopVerificationService::class)->reopen($shop, HookWorld::owner($shop), ['iban']);

    expect($shop->refresh()->verification_state)->toBe(ShopVerificationState::Pending)
        ->and($shop->sub_merchant_key)->toBe($existing);

    $shop->forceFill(['verification_state' => ShopVerificationState::Verified, 'verified_at' => now()])->save();
    runOnboarding($shop);

    expect($this->gateway->subMerchantCalls)->toBe([])
        ->and($shop->refresh()->sub_merchant_key)->toBe($existing);
});

it('rethrows a provider outage as a sanitised failure for the queue to retry', function (): void {
    ['shop' => $shop, 'tax' => $tax, 'iban' => $iban] = PayoutWorld::shopWithFinancials();
    $this->gateway->subMerchantOutcomes = [new GatewayUnavailable('upstream said '.$tax.' '.$iban)];

    $thrown = null;

    try {
        runOnboarding($shop);
    } catch (Throwable $e) {
        $thrown = $e;
    }

    expect($thrown)->toBeInstanceOf(OnboardingFailed::class)
        ->and($thrown?->getPrevious())->toBeNull()
        ->and($thrown?->getMessage())->toContain($shop->id)
        ->and((string) $thrown)->not->toContain($tax)->not->toContain($iban)
        ->and($shop->refresh()->sub_merchant_key)->toBeNull()
        ->and(AbuseFlag::query()->count())->toBe(0);
});

it('retries with the configured attempts and backoff', function (): void {
    config(['payments.onboarding.max_attempts' => 4, 'payments.onboarding.backoff_seconds' => [10, 20, 30]]);

    $job = new OnboardSubMerchant('00000000-0000-4000-8000-000000000001');

    expect($job->tries)->toBe(4)
        ->and($job->backoff())->toBe([10, 20, 30])
        ->and($job->queue)->toBe('payments');
});

it('flags finance once after the last attempt', function (): void {
    ['shop' => $shop] = PayoutWorld::shopWithFinancials();
    $job = new OnboardSubMerchant($shop->id);

    $job->failed(OnboardingFailed::forShop($shop->id, 'provider_unavailable'));
    $job->failed(OnboardingFailed::forShop($shop->id, 'provider_unavailable'));

    $flags = AbuseFlag::query()->where('shop_id', $shop->id)->get();

    expect($flags)->toHaveCount(1)
        ->and($flags[0]->kind)->toBe('onboarding_failed')
        ->and($flags[0]->detail)->toBe(['reason' => 'attempts_exhausted', 'max_attempts' => $job->tries])
        ->and(DB::table('activity_log')->where('event', 'payout.onboarding_failed')->where('subject_id', $shop->id)->count())->toBe(1);
});

it('flags finance without a provider call when the shop data is incomplete', function (): void {
    ['shop' => $shop] = PayoutWorld::shopWithFinancials();
    DB::table('shops')->where('id', $shop->id)->update(['iban_enc' => null]);

    runOnboarding($shop);

    expect($this->gateway->subMerchantCalls)->toBe([])
        ->and(AbuseFlag::query()->where('shop_id', $shop->id)->value('kind'))->toBe('onboarding_failed');
});

it('keeps the tax number and IBAN out of the job payload, logs, exceptions and records', function (): void {
    ['shop' => $shop, 'tax' => $tax, 'iban' => $iban] = PayoutWorld::shopWithFinancials();
    $logged = [];
    Event::listen(MessageLogged::class, function (MessageLogged $event) use (&$logged): void {
        $logged[] = $event->message.' '.json_encode($event->context);
    });

    // The queued payload as the queue stores it.
    Queue::fake();
    OnboardSubMerchant::dispatch($shop->id);
    $payloads = [];
    Queue::assertPushed(OnboardSubMerchant::class, function (OnboardSubMerchant $job) use (&$payloads): bool {
        $payloads[] = serialize($job);

        return true;
    });

    // A failing attempt and the failure handler.
    $this->gateway->subMerchantOutcomes = [new RuntimeException('provider echoed '.$tax.' and '.$iban)];
    $thrown = null;

    try {
        runOnboarding($shop);
    } catch (Throwable $e) {
        $thrown = $e;
    }

    (new OnboardSubMerchant($shop->id))->failed($thrown);

    $haystacks = [
        ...$payloads,
        ...$logged,
        (string) $thrown,
        (string) $thrown?->getMessage(),
        (string) json_encode(DB::table('activity_log')->get()),
        (string) json_encode(DB::table('abuse_flags')->get()),
    ];

    expect($thrown)->toBeInstanceOf(OnboardingFailed::class)
        ->and($payloads)->not->toBe([])
        ->and($logged)->not->toBe([]);

    foreach ($haystacks as $haystack) {
        expect($haystack)->not->toContain($tax)->not->toContain($iban);
    }
});
