<?php

use App\Domain\Anon\Models\DevicePlatform;
use App\Domain\Auth\Models\DevicePushToken;
use App\Domain\Hooks\Events\HookRedeemed;
use App\Domain\Hooks\Listeners\NotifyDonorRedeemed;
use App\Domain\Push\Contracts\PushTransport;
use App\Domain\Push\Jobs\SendPush;
use App\Domain\Push\PushMessage;
use App\Domain\Push\Transports\LogPushTransport;
use App\Models\User;
use Illuminate\Cache\RateLimiter;
use Illuminate\Events\CallQueuedListener;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use Tests\Feature\Api\Hooks\Support\HookWorld;

/*
| Donor push "Askın alındı" (story 6, rules AN-1/AN-7) and the push transport (ADR-0004,
| security item 22: hourly fan-out cap).
*/

uses(RefreshDatabase::class);

final class RecordingPushTransport implements PushTransport
{
    /** @var list<array{platform: string, token: string, message: PushMessage}> */
    public array $sent = [];

    public function send(DevicePlatform $platform, string $token, PushMessage $message): void
    {
        $this->sent[] = ['platform' => $platform->value, 'token' => $token, 'message' => $message];
    }
}

beforeEach(function (): void {
    HookWorld::pepper();
    $this->transport = new RecordingPushTransport;
    app()->instance(PushTransport::class, $this->transport);
});

function pushToken(User $user, DevicePlatform $platform = DevicePlatform::Android): string
{
    $value = Str::random(64);
    (new DevicePushToken)->forceFill(['user_id' => $user->id, 'platform' => $platform, 'token' => $value])->save();

    return $value;
}

it('pushes "Askın alındı" to the donor with the item and shop names only', function (): void {
    Queue::fake();
    $donor = HookWorld::donor();
    pushToken($donor);
    $shop = HookWorld::shop();
    $item = HookWorld::item($shop);
    [$hook] = HookWorld::availableHooks($item, 1, $donor);
    $device = HookWorld::anon();
    $code = HookWorld::newCode();
    HookWorld::reserve($hook, $device, $code);

    $this->postJson("/api/v1/shops/{$shop->id}/redeem", ['code' => $code], ['Authorization' => 'Bearer '.HookWorld::userToken(HookWorld::owner($shop))])->assertOk();

    // The listener is queued on the push queue with ids only.
    Queue::assertPushedOn('push', CallQueuedListener::class, fn ($job): bool => $job->class === NotifyDonorRedeemed::class);

    (new NotifyDonorRedeemed)->handle(new HookRedeemed($hook->id, $hook->donation_id, $shop->id, $item->id));

    Queue::assertPushedOn('push', SendPush::class, function (SendPush $job) use ($donor, $device, $code, $hook, $shop): bool {
        $serialized = serialize($job);

        return $job->userId === $donor->id
            && $job->message->title === 'Askın alındı'
            && $job->message->data === ['item' => 'Ekmek', 'shop' => $shop->name]
            && ! str_contains($serialized, $device->anon_id)
            && ! str_contains($serialized, $device->id)
            && ! str_contains($serialized, $code)
            && ! str_contains($serialized, HookWorld::hash($code))
            && ! str_contains($serialized, $hook->id)
            && ! str_contains($serialized, 'android')
            && ! str_contains($serialized, 'redeemed_at');
    });
});

it('delivers to every device of the donor through the transport', function (): void {
    config(['queue.default' => 'sync']);
    $donor = HookWorld::donor();
    $first = pushToken($donor);
    $second = pushToken($donor, DevicePlatform::Ios);
    pushToken(HookWorld::donor());
    $shop = HookWorld::shop();
    $item = HookWorld::item($shop);
    [$hook] = HookWorld::availableHooks($item, 1, $donor);

    event(new HookRedeemed($hook->id, $hook->donation_id, $shop->id, $item->id));

    expect(array_column($this->transport->sent, 'token'))->toBe([$first, $second])
        ->and($this->transport->sent[0]['message']->toArray())->toBe([
            'title' => 'Askın alındı',
            'body' => "{$shop->name} içindeki askından 1 Ekmek alındı.",
            'data' => ['item' => 'Ekmek', 'shop' => $shop->name],
        ]);
});

it('sends nothing for an anonymised donation', function (): void {
    config(['queue.default' => 'sync']);
    $shop = HookWorld::shop();
    $item = HookWorld::item($shop);
    [$hook] = HookWorld::availableHooks($item, 1);
    DB::table('donations')->where('id', $hook->donation_id)->update(['donor_id' => null, 'anonymized_at' => now()]);

    event(new HookRedeemed($hook->id, $hook->donation_id, $shop->id, $item->id));

    expect($this->transport->sent)->toBe([]);
});

it('stops at the hourly fan-out cap', function (): void {
    config(['askida.push.hourly_fanout_cap' => 3]);
    $user = HookWorld::donor();
    foreach (range(1, 5) as $n) {
        pushToken($user);
    }

    (new SendPush($user->id, new PushMessage('Askın alındı', 'metin')))->handle($this->transport, app(RateLimiter::class));
    expect($this->transport->sent)->toHaveCount(3);

    (new SendPush($user->id, new PushMessage('Askın alındı', 'metin')))->handle($this->transport, app(RateLimiter::class));
    expect($this->transport->sent)->toHaveCount(3);

    $this->travel(61)->minutes();
    (new SendPush($user->id, new PushMessage('Askın alındı', 'metin')))->handle($this->transport, app(RateLimiter::class));
    expect($this->transport->sent)->toHaveCount(6);
});

it('queues push jobs on the push queue', function (): void {
    Bus::fake();

    SendPush::dispatch((string) Str::uuid7(), new PushMessage('Yeni askı', 'metin'));

    Bus::assertDispatched(SendPush::class, fn (SendPush $job): bool => $job->queue === 'push');
});

it('logs the message shape through the masked log without the device token', function (): void {
    $path = storage_path('logs/push-transport-test-'.Str::random(8).'.log');
    config(['logging.channels.push_test' => array_merge(config('logging.channels.single'), ['path' => $path])]);
    $token = Str::random(64);

    (new LogPushTransport(Log::channel('push_test')))->send(DevicePlatform::Android, $token, new PushMessage('Askın alındı', 'Gövde', ['item' => 'Ekmek']));

    $written = (string) file_get_contents($path);
    @unlink($path);

    expect($written)->toContain('push.sent')->toContain('Ekmek')->not->toContain($token);
});
