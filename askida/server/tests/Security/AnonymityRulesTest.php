<?php

use App\Domain\Anon\Models\AnonDevice;
use App\Domain\Anon\Models\DevicePlatform;
use App\Domain\Auth\Abilities\AdminPermission;
use App\Domain\Auth\Abilities\AdminRole;
use App\Domain\Auth\Models\DevicePushToken;
use App\Domain\Hooks\Models\Hook;
use App\Domain\Hooks\Models\HookStatus;
use App\Domain\Items\Models\Item;
use App\Domain\Push\Contracts\PushTransport;
use App\Domain\Push\PushMessage;
use App\Domain\Shops\Models\Shop;
use App\Domain\Shops\Models\ShopMemberRole;
use App\Models\User;
use Database\Seeders\RolesSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Route;
use Illuminate\Testing\TestResponse;
use Tests\Feature\Api\Auth\Support\AuthTestKit;
use Tests\Feature\Api\Hooks\Support\HookWorld;
use Tests\Feature\Api\Shops\Support\ShopTestKit;
use Tests\Security\IdorHarness;

/*
| Anonymity invariants AN-1..AN-8 of the authorization matrix (section 5) as executable
| checks over one real flow: a donor's unit is reserved by an anon device through
| POST hooks/reserve and redeemed by the shop through POST shops/{shop}/redeem.
*/

uses(RefreshDatabase::class);

/**
 * Push transport that keeps what it was asked to send.
 */
function anonymityPushRecorder(): PushTransport
{
    return new class implements PushTransport
    {
        /** @var list<array{platform: string, token: string, message: PushMessage}> */
        public array $sent = [];

        public function send(DevicePlatform $platform, string $token, PushMessage $message): void
        {
            $this->sent[] = ['platform' => $platform->value, 'token' => $token, 'message' => $message];
        }
    };
}

/**
 * Values that identify the recipient or its reservation: none may reach a donor, a
 * merchant, an admin page or a log line.
 *
 * @return list<string>
 */
function recipientTraces(AnonDevice $device, Hook $hook, string $code): array
{
    $hook->refresh();

    return array_values(array_filter([
        $device->anon_id,
        (string) $device->id,
        $code,
        HookWorld::hash($code),
        $hook->reserved_at?->toIso8601String(),
        $hook->expires_at?->toIso8601String(),
    ]));
}

/**
 * @param  list<string>  $traces
 */
function assertNoRecipientTrace(TestResponse|string $subject, array $traces): void
{
    $body = $subject instanceof TestResponse ? (string) $subject->getContent() : $subject;

    foreach ($traces as $trace) {
        expect($body)->not->toContain($trace);
    }

    expect($body)->not->toContain('anon_id')->not->toContain('code_hash')->not->toContain('reserved_at');
}

beforeEach(function (): void {
    AuthTestKit::boot();
    HookWorld::pepper();
    config(['queue.default' => 'sync']);
    $this->push = anonymityPushRecorder();
    app()->instance(PushTransport::class, $this->push);
    $this->harness = new IdorHarness($this);

    // The flow: donor -> unit of a verified shop -> reserved by a device -> redeemed by staff.
    $this->owner = ShopTestKit::merchant();
    $this->shop = ShopTestKit::shop($this->owner);
    $this->staff = ShopTestKit::merchant();
    ShopTestKit::join($this->shop, $this->staff, ShopMemberRole::Staff);
    $this->item = ShopTestKit::item($this->shop);
    $this->donor = ShopTestKit::donor();
    (new DevicePushToken)->forceFill(['user_id' => $this->donor->id, 'platform' => 'android', 'token' => 'device-'.bin2hex(random_bytes(16))])->save();
    [$this->hook] = HookWorld::availableHooks($this->item, 1, $this->donor);
    $this->device = HookWorld::anon();
    $this->anonToken = HookWorld::anonToken($this->device);
});

/**
 * Reserves through the API and returns the plaintext code (shown only here).
 */
function reserveThroughApi(object $test): string
{
    /** @var Shop $shop */
    $shop = $test->shop;
    /** @var Item $item */
    $item = $test->item;

    $response = $test->harness->call('POST', '/api/v1/hooks/reserve', $test->anonToken, ['shop_id' => $shop->id, 'item_id' => $item->id]);
    $response->assertCreated();

    // Later steps happen minutes after the reservation, as in a shop, so a reservation
    // time leaking into a later answer cannot hide behind the redemption time.
    $test->travel(3)->minutes();

    return (string) $response->json('code');
}

it('AN-1, AN-7: tells the donor that the unit was taken and nothing about who or when', function (): void {
    $code = reserveThroughApi($this);
    $traces = recipientTraces($this->device, $this->hook, $code);

    $this->harness->call('POST', "/api/v1/shops/{$this->shop->id}/redeem", IdorHarness::bearer($this->staff), ['code' => $code])->assertOk();

    expect($this->push->sent)->toHaveCount(1);
    $message = $this->push->sent[0]['message'];
    expect($message->title)->toBe('Askın alındı')
        ->and(array_keys($message->data))->toBe(['item', 'shop']);
    assertNoRecipientTrace(json_encode($message->toArray(), JSON_THROW_ON_ERROR), array_merge($traces, [$this->staff->name, $this->staff->email]));

    // Everything a donor can call today.
    $donorToken = IdorHarness::bearer($this->donor, 'donor-phone');
    foreach (['/api/v1/me', '/api/v1/shops/'.$this->shop->slug, '/api/v1/impact', '/api/v1/shops?near='.ShopTestKit::LAT.','.ShopTestKit::LNG] as $uri) {
        assertNoRecipientTrace($this->harness->call('GET', $uri, $donorToken)->assertOk(), $traces);
    }
});

it('AN-2: gives the merchant the item only, also on a losing second redeem and in the list', function (): void {
    $code = reserveThroughApi($this);
    $traces = recipientTraces($this->device, $this->hook, $code);

    $redeem = $this->harness->call('POST', "/api/v1/shops/{$this->shop->id}/redeem", IdorHarness::bearer($this->staff), ['code' => $code])->assertOk();
    $again = $this->harness->call('POST', "/api/v1/shops/{$this->shop->id}/redeem", IdorHarness::bearer($this->owner, 'owner'), ['code' => $code]);
    $list = $this->harness->call('GET', "/api/v1/shops/{$this->shop->id}/redemptions", IdorHarness::bearer($this->owner, 'owner-2'))->assertOk();

    expect(array_keys((array) $redeem->json()))->toBe(['message', 'item', 'redeemed_at'])
        ->and($again->json('code'))->toBe('hook.code_invalid');

    foreach ([$redeem, $again, $list] as $response) {
        assertNoRecipientTrace($response, $traces);
        expect((string) $response->getContent())->not->toContain('android')->not->toContain('platform');
    }
});

it('AN-3: keeps the anon tables to the allowed columns, none of them personal', function (string $table, array $allowed): void {
    $columns = DB::table('information_schema.columns')
        ->where('table_schema', 'public')
        ->where('table_name', $table)
        ->orderBy('column_name')
        ->pluck('column_name')
        ->all();

    sort($allowed);
    expect($columns)->toBe($allowed);

    foreach ($columns as $column) {
        expect($column)->not->toMatch('/(^|_)(email|phone|name|ip|lat|lng|latitude|longitude|location|advertising|address|nonce)(_|$)/');
    }
})->with([
    'anon_devices' => ['anon_devices', ['id', 'anon_id', 'platform', 'attested_at', 'attestation_verdict', 'banned_at', 'last_seen_at', 'created_at', 'updated_at']],
    'anon_daily_counters' => ['anon_daily_counters', ['id', 'anon_id', 'day', 'count', 'per_shop', 'created_at', 'updated_at']],
]);

it('AN-4: lets no admin role read anon data through any HTTP route', function (): void {
    $code = reserveThroughApi($this);
    $traces = recipientTraces($this->device, $this->hook, $code);
    // Admin roles live on the web guard; the API calls above switched the default guard.
    app('auth')->shouldUse('web');
    (new RolesSeeder)->run();

    $sessions = [];
    foreach (AdminRole::cases() as $role) {
        $admin = User::factory()->create();
        $admin->assignRole($role->value);
        $sessions[] = $admin;
    }

    $checked = 0;

    foreach (Route::getRoutes()->getRoutes() as $route) {
        if (! in_array('GET', $route->methods(), true) || str_contains($route->uri(), '{')) {
            continue;
        }

        foreach ($sessions as $admin) {
            app('auth')->forgetGuards();
            $response = $this->actingAs($admin, 'web')->get('/'.ltrim($route->uri(), '/'));
            $body = (string) $response->getContent();

            // Horizon's jobs API reports the queue's own bookkeeping field `reserved_at` (false or an
            // epoch float) for every job. That is not the hook column, whose value is an ISO date.
            if (str_starts_with($route->uri(), 'horizon/api/')) {
                $body = (string) preg_replace('/"reserved_at":(?:false|null|"?\d+(?:\.\d+)?"?)(?=[,}])/', '"queue_field":0', $body);
            }

            assertNoRecipientTrace($body, array_slice($traces, 0, 4));
            $checked++;
        }
    }

    expect($checked)->toBeGreaterThan(10);

    // The only admin power over devices is the ban, which works on anon_id alone.
    $anonGates = array_values(array_filter(array_keys(Gate::abilities()), fn (string $name): bool => str_contains($name, 'anon')));
    $anonPermissions = array_values(array_filter(array_map(fn (AdminPermission $p): string => $p->value, AdminPermission::cases()), fn (string $name): bool => str_contains($name, 'anon')));

    expect($anonGates)->toBe(['ban-anon-devices'])
        ->and(count($anonPermissions))->toBeLessThanOrEqual(1);
});

it('AN-5: stores no coordinates outside shops and logs no near query, code or device id', function (): void {
    $coordinateColumns = DB::table('information_schema.columns')
        ->where('table_schema', 'public')
        ->where(function ($query): void {
            $query->whereIn('udt_name', ['geography', 'geometry'])
                ->orWhereIn('column_name', ['lat', 'lng', 'latitude', 'longitude', 'location', 'coordinates']);
        })
        ->orderBy('table_name')
        ->get(['table_name', 'column_name'])
        ->map(fn (object $row): string => $row->table_name.'.'.$row->column_name)
        ->all();

    expect($coordinateColumns)->toBe(['shops.location']);

    $logPath = storage_path('logs/test-anonymity-'.bin2hex(random_bytes(4)).'.log');
    config([
        'logging.default' => 'stack',
        'logging.channels.stack.channels' => ['single'],
        'logging.channels.single.path' => $logPath,
        'logging.channels.single.level' => 'debug',
    ]);
    app('log')->forgetChannel('stack');
    app('log')->forgetChannel('single');

    try {
        $near = '41.0371,28.9850';
        $this->harness->call('GET', '/api/v1/shops/'.$this->shop->slug, IdorHarness::bearer($this->donor, 'donor-phone'))->assertOk();
        $this->harness->call('GET', '/api/v1/shops?near='.$near, IdorHarness::bearer($this->donor, 'donor-phone-2'))->assertOk();
        $code = reserveThroughApi($this);
        $traces = recipientTraces($this->device, $this->hook, $code);
        $this->harness->call('POST', "/api/v1/shops/{$this->shop->id}/redeem", IdorHarness::bearer($this->staff), ['code' => $code])->assertOk();

        $log = File::exists($logPath) ? (string) File::get($logPath) : '';

        expect($log)->toContain('http.request')
            ->and($log)->not->toContain('41.0371')
            ->and($log)->not->toContain('28.9850')
            ->and($log)->not->toContain($this->anonToken)
            ->and($log)->not->toContain(explode('|', $this->anonToken)[1] ?? $this->anonToken);

        foreach ($traces as $trace) {
            expect($log)->not->toContain($trace);
        }
    } finally {
        File::delete($logPath);
    }
});

it('AN-6: forgets the device, its counters and its reservation on DELETE anon/me', function (): void {
    reserveThroughApi($this);

    expect(DB::table('anon_daily_counters')->where('anon_id', $this->device->anon_id)->count())->toBe(1);

    $this->harness->call('DELETE', '/api/v1/anon/me', $this->anonToken)->assertNoContent();

    expect(DB::table('anon_devices')->where('anon_id', $this->device->anon_id)->exists())->toBeFalse()
        ->and(DB::table('anon_daily_counters')->where('anon_id', $this->device->anon_id)->exists())->toBeFalse()
        ->and(DB::table('hooks')->where('anon_id', $this->device->anon_id)->exists())->toBeFalse()
        ->and($this->hook->fresh()?->status)->toBe(HookStatus::Available);
});

it('AN-8: shows the code once and stores it nowhere in plain text', function (): void {
    $code = reserveThroughApi($this);

    $columns = DB::table('information_schema.columns')
        ->where('table_schema', 'public')
        ->whereIn('data_type', ['text', 'character varying', 'character', 'json', 'jsonb'])
        ->get(['table_name', 'column_name']);

    expect($columns->count())->toBeGreaterThan(20);

    foreach ($columns as $column) {
        $hits = DB::table($column->table_name)->whereRaw('cast('.DB::getQueryGrammar()->wrap($column->column_name).' as text) like ?', ['%'.$code.'%'])->count();
        expect($hits)->toBe(0, "{$column->table_name}.{$column->column_name} holds the code");
    }

    expect($this->hook->fresh()?->code_hash)->toBe(HookWorld::hash($code));

    $redeem = $this->harness->call('POST', "/api/v1/shops/{$this->shop->id}/redeem", IdorHarness::bearer($this->owner), ['code' => $code])->assertOk();
    $later = [
        $redeem,
        $this->harness->call('GET', "/api/v1/shops/{$this->shop->id}/redemptions", IdorHarness::bearer($this->owner, 'owner-2')),
        $this->harness->call('GET', '/api/v1/shops/'.$this->shop->slug, IdorHarness::bearer($this->donor)),
    ];

    foreach ($later as $response) {
        expect((string) $response->getContent())->not->toContain($code);
    }
});

it('never returns owner contact data in the public directory', function (): void {
    $donorToken = IdorHarness::bearer($this->donor);

    foreach (['/api/v1/shops?near='.ShopTestKit::LAT.','.ShopTestKit::LNG, '/api/v1/shops/'.$this->shop->slug] as $uri) {
        $body = (string) $this->harness->call('GET', $uri, $donorToken)->assertOk()->getContent();

        expect($body)->not->toContain($this->owner->email)
            ->not->toContain($this->owner->name)
            ->not->toContain((string) $this->owner->id)
            ->not->toContain((string) $this->shop->phone)
            ->not->toContain('phone')
            ->not->toContain('tax_number')
            ->not->toContain('iban');
    }
});
