<?php

use App\Domain\Anon\Models\DevicePlatform;
use App\Domain\Auth\Models\DevicePushToken;
use App\Domain\Hooks\Events\HooksIssued;
use App\Domain\Hooks\Models\Hook;
use App\Domain\Hooks\Models\HookStatus;
use App\Domain\Hooks\Services\HookIssuanceRefused;
use App\Domain\Hooks\Services\HookIssuer;
use App\Domain\Push\Contracts\PushTransport;
use App\Domain\Push\PushMessage;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Str;
use Tests\Feature\Api\Hooks\Support\HookWorld;

/*
| HookIssuer::issueForDonation (used by the payments phase): idempotent, paid
| donations only, shop push "Yeni askı" without donor identity.
*/

uses(RefreshDatabase::class);

it('creates qty available units once, however often it is called', function (): void {
    Event::fake([HooksIssued::class]);
    $item = HookWorld::item(HookWorld::shop());
    $donation = HookWorld::donation($item, qty: 3);

    expect(app(HookIssuer::class)->issueForDonation($donation))->toBe(3)
        ->and(app(HookIssuer::class)->issueForDonation($donation))->toBe(0);

    $hooks = Hook::query()->where('donation_id', $donation->id)->get();
    expect($hooks)->toHaveCount(3)
        ->and($hooks->every(fn (Hook $hook): bool => $hook->status === HookStatus::Available
            && $hook->shop_id === $donation->shop_id && $hook->item_id === $donation->item_id && $hook->anon_id === null))->toBeTrue();

    Event::assertDispatchedTimes(HooksIssued::class, 1);
    Event::assertDispatched(HooksIssued::class, fn (HooksIssued $event): bool => $event->count === 3 && $event->donationId === $donation->id);
});

it('tops up only the missing units', function (): void {
    $item = HookWorld::item(HookWorld::shop());
    $donation = HookWorld::donation($item, qty: 4);
    app(HookIssuer::class)->issueForDonation($donation);
    Hook::query()->where('donation_id', $donation->id)->limit(1)->get()->each(fn (Hook $hook) => $hook->delete());

    expect(app(HookIssuer::class)->issueForDonation($donation))->toBe(1)
        ->and(Hook::query()->where('donation_id', $donation->id)->count())->toBe(4);
});

it('refuses a donation that is not paid', function (): void {
    $donation = HookWorld::donation(HookWorld::item(HookWorld::shop()), qty: 2, paid: false);

    expect(fn () => app(HookIssuer::class)->issueForDonation($donation))->toThrow(HookIssuanceRefused::class)
        ->and(Hook::query()->count())->toBe(0);
});

it('tells the shop members about new units without naming the donor', function (): void {
    config(['queue.default' => 'sync']);
    $transport = new class implements PushTransport
    {
        /** @var list<array{token: string, message: PushMessage}> */
        public array $sent = [];

        public function send(DevicePlatform $platform, string $token, PushMessage $message): void
        {
            $this->sent[] = ['token' => $token, 'message' => $message];
        }
    };
    app()->instance(PushTransport::class, $transport);

    $shop = HookWorld::shop();
    $staff = HookWorld::staff($shop);
    $donor = HookWorld::donor();
    $tokens = [];
    foreach ([HookWorld::owner($shop), $staff, $donor] as $user) {
        $tokens[$user->id] = Str::random(64);
        (new DevicePushToken)->forceFill(['user_id' => $user->id, 'platform' => DevicePlatform::Android, 'token' => $tokens[$user->id]])->save();
    }
    $donation = HookWorld::donation(HookWorld::item($shop), $donor, qty: 2);

    app(HookIssuer::class)->issueForDonation($donation);

    expect(array_column($transport->sent, 'token'))->toEqualCanonicalizing([$tokens[$shop->owner_id], $tokens[$staff->id]]);

    foreach ($transport->sent as $push) {
        $text = json_encode($push['message']->toArray(), JSON_UNESCAPED_UNICODE);
        expect($push['message']->title)->toBe('Yeni askı')
            ->and($push['message']->body)->toBe('2 Ekmek askıya bırakıldı.')
            ->and($text)->not->toContain($donor->id)->not->toContain($donor->email)->not->toContain($donor->name)->not->toContain($donation->id);
    }
});
