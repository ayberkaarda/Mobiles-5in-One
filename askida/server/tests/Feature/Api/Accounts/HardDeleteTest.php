<?php

use App\Domain\Accounts\Jobs\HardDeleteAccounts;
use App\Domain\Accounts\Services\AccountDeletionService;
use App\Domain\Auth\Consent\KvkkConsentRecorder;
use App\Domain\Auth\Models\DeletionChannel;
use App\Domain\Auth\Models\DeletionRequest;
use App\Domain\Auth\Models\DevicePushToken;
use App\Domain\Donations\Models\Donation;
use App\Domain\Hooks\Models\Hook;
use App\Domain\Hooks\Models\HookStatus;
use App\Domain\Items\Models\Item;
use App\Domain\Shops\Models\Shop;
use App\Domain\Shops\Models\ShopDocument;
use App\Domain\Shops\Models\ShopMember;
use App\Domain\Shops\Models\ShopMemberRole;
use App\Models\User;
use App\Support\Problem\ProblemException;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Spatie\Activitylog\Models\Activity;
use Spatie\Permission\Models\Role;
use Tests\Feature\Api\Accounts\Support\AccountsWorld;
use Tests\Feature\Api\Auth\Support\AuthTestKit;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    AuthTestKit::boot();
    Storage::fake((string) config('filesystems.private_disk'));
});

/**
 * A rich account: KVKK consent with an IP hash, two device tokens, push tokens, a
 * one-time code, a role link, donations (one redeemed by a merchant) and an activity
 * entry that carelessly recorded personal values.
 *
 * @return array{user: User, needles: array<string, string>}
 */
function richAccount(string $kind): array
{
    $suffix = bin2hex(random_bytes(5));
    $ip = '198.51.100.'.random_int(1, 254);
    $iban = AccountsWorld::iban();
    $tax = AccountsWorld::taxNumber();

    $user = User::factory()->create([
        'email' => 'residual-'.$suffix.'@example.test',
        'name' => 'Residual Person '.$suffix,
        'kind' => $kind,
    ]);
    $user->forceFill(['apple_sub' => 'apple-residual-'.$suffix, 'google_sub' => 'google-residual-'.$suffix])->save();

    app(KvkkConsentRecorder::class)->record($user, AuthTestKit::KVKK_VERSION, $ip);
    AuthTestKit::token($user);
    AuthTestKit::token($user, 'tablet');
    $push = new DevicePushToken(['platform' => 'android', 'token' => 'reg-residual-'.$suffix]);
    $push->user_id = $user->id;
    $push->save();
    DB::table('password_reset_tokens')->insert([
        'id' => (string) Str::uuid7(),
        'user_id' => $user->id,
        'purpose' => 'password_reset',
        'code_hash' => hash('sha256', 'residual-'.$suffix),
        'expires_at' => Carbon::now()->addHour()->toIso8601String(),
        'created_at' => Carbon::now()->toIso8601String(),
    ]);
    Role::findOrCreate('moderator', 'web');
    $user->assignRole('moderator');

    activity('shops')->causedBy($user)->withProperties([
        'shop_id' => (string) Str::uuid7(),
        'email' => $user->email,
        'iban' => $iban,
        'details' => ['tax_number' => $tax, 'count' => 3],
    ])->log('shop.updated');

    return [
        'user' => $user,
        'needles' => [
            'email' => $user->email,
            'name' => $user->name,
            'apple_sub' => (string) $user->apple_sub,
            'google_sub' => (string) $user->google_sub,
            'ip' => $ip,
            'ip_hash' => KvkkConsentRecorder::hashIp($ip),
            'iban' => $iban,
            'tax_number' => $tax,
        ],
    ];
}

/**
 * Walks every text, varchar, char and json column of every table in the schema and
 * counts the rows that contain each value.
 *
 * @param  array<string, string>  $needles
 * @return array<string, int> hits per "needle@table.column"
 */
function residualHits(array $needles): array
{
    $columns = DB::select(
        "SELECT table_name, column_name FROM information_schema.columns
         WHERE table_schema = current_schema()
           AND data_type IN ('text', 'character varying', 'character', 'json', 'jsonb')
         ORDER BY table_name, column_name"
    );
    $grammar = DB::connection()->getQueryGrammar();
    $hits = [];

    foreach ($columns as $column) {
        foreach ($needles as $label => $needle) {
            $count = DB::selectOne(
                sprintf('SELECT count(*) AS n FROM %s WHERE CAST(%s AS text) ILIKE ?', $grammar->wrapTable($column->table_name), $grammar->wrap($column->column_name)),
                ['%'.str_replace(['\\', '%', '_'], ['\\\\', '\%', '\_'], $needle).'%'],
            )->n;

            if ($count > 0) {
                $hits[$label.'@'.$column->table_name.'.'.$column->column_name] = (int) $count;
            }
        }
    }

    return $hits;
}

function requestAndExpire(User $user): DeletionRequest
{
    $deletion = app(AccountDeletionService::class)->request($user, DeletionChannel::App);
    Carbon::setTestNow(Carbon::now()->addDays(AccountDeletionService::GRACE_DAYS)->addMinute());

    return $deletion;
}

afterEach(fn () => Carbon::setTestNow());

it('leaves no residual PII for a donor', function (): void {
    ['user' => $donor, 'needles' => $needles] = richAccount('donor');
    $merchant = User::factory()->merchant()->create();
    $shop = AccountsWorld::shop($merchant);
    $item = AccountsWorld::item($shop);
    $kept = AccountsWorld::donation($donor, $item, qty: 2);
    AccountsWorld::hook($kept, HookStatus::Redeemed, $merchant);

    // The walk itself must see the values before the erasure.
    expect(array_keys(residualHits($needles)))->toContain(
        'email@users.email', 'name@users.name', 'apple_sub@users.apple_sub', 'google_sub@users.google_sub',
        'ip_hash@kvkk_consents.ip_hash', 'iban@activity_log.properties', 'tax_number@activity_log.properties',
    );

    $deletion = requestAndExpire($donor);
    (new HardDeleteAccounts)->handle(app(AccountDeletionService::class));

    expect(residualHits($needles))->toBe([])
        ->and(User::query()->whereKey($donor->id)->exists())->toBeFalse()
        ->and(DB::table('kvkk_consents')->where('user_id', $donor->id)->count())->toBe(0)
        ->and(DB::table('personal_access_tokens')->where('tokenable_id', $donor->id)->count())->toBe(0)
        ->and(DB::table('password_reset_tokens')->where('user_id', $donor->id)->count())->toBe(0)
        ->and(DB::table('model_has_roles')->where('model_id', $donor->id)->count())->toBe(0)
        ->and(DevicePushToken::query()->count())->toBe(0);

    $kept->refresh();
    expect($kept->donor_id)->toBeNull()
        ->and($kept->anonymized_at)->not->toBeNull()
        ->and($kept->amount_minor)->toBe(3_000)
        ->and(Hook::query()->where('donation_id', $kept->id)->count())->toBe(1);

    $deletion->refresh();
    expect($deletion->status->value)->toBe('completed')
        ->and($deletion->completed_at)->not->toBeNull()
        ->and($deletion->user_id)->toBeNull();
});

it('leaves no residual PII for a merchant and releases the shops', function (): void {
    ['user' => $merchant, 'needles' => $needles] = richAccount('merchant');
    $disk = Storage::disk((string) config('filesystems.private_disk'));

    // A shop with no financial history: removed with items, members and documents.
    $empty = AccountsWorld::shop($merchant);
    $emptyItem = AccountsWorld::item($empty);
    $emptyDocument = AccountsWorld::document($empty);
    AccountsWorld::member($empty, User::factory()->merchant()->create(), ShopMemberRole::Staff);

    // A shop with retained donations: stays as an ownerless closed anchor.
    $anchor = AccountsWorld::shop($merchant, ['tax_number_enc' => $needles['tax_number'], 'iban_enc' => $needles['iban']]);
    $anchorDocument = AccountsWorld::document($anchor);
    $donation = AccountsWorld::donation(User::factory()->create(), AccountsWorld::item($anchor));
    AccountsWorld::hook($donation, HookStatus::Redeemed, $merchant);

    // A co-owned shop passes to the other owner.
    $partner = User::factory()->merchant()->create();
    $coOwned = AccountsWorld::shop($merchant);
    AccountsWorld::member($coOwned, $partner, ShopMemberRole::Owner);

    // Staff membership in somebody else's shop.
    $foreign = AccountsWorld::shop(User::factory()->merchant()->create());
    AccountsWorld::member($foreign, $merchant, ShopMemberRole::Staff);

    requestAndExpire($merchant);
    $summary = app(AccountDeletionService::class)->hardDeleteDue();

    expect($summary)->toBe(['completed' => 1, 'deferred' => 0])
        ->and(residualHits($needles))->toBe([]);

    expect(Shop::query()->whereKey($empty->id)->exists())->toBeFalse()
        ->and(Item::query()->whereKey($emptyItem->id)->exists())->toBeFalse()
        ->and(ShopDocument::query()->count())->toBe(0)
        ->and($disk->exists($emptyDocument->path))->toBeFalse()
        ->and($disk->exists($anchorDocument->path))->toBeFalse()
        ->and(ShopMember::query()->where('shop_id', $empty->id)->count())->toBe(0)
        ->and(ShopMember::query()->where('user_id', $merchant->id)->count())->toBe(0);

    $anchor->refresh();
    expect($anchor->owner_id)->toBeNull()
        ->and($anchor->verification_state->value)->toBe('rejected')
        ->and($anchor->listed_on_web)->toBeFalse()
        ->and($anchor->phone)->toBe('')
        ->and(ShopMember::query()->where('shop_id', $anchor->id)->count())->toBe(0)
        ->and(Donation::query()->whereKey($donation->id)->exists())->toBeTrue()
        ->and(Hook::query()->where('donation_id', $donation->id)->value('redeemed_by_user_id'))->toBeNull();

    expect($coOwned->refresh()->owner_id)->toBe($partner->id)
        ->and(Shop::query()->whereKey($foreign->id)->exists())->toBeTrue();
});

it('refuses the hard delete while a solely owned shop has open units and retries later', function (HookStatus $status): void {
    $merchant = User::factory()->merchant()->create();
    $shop = AccountsWorld::shop($merchant);
    $item = AccountsWorld::item($shop);
    $deletion = requestAndExpire($merchant);

    // A unit issued during the grace period blocks the erasure.
    $open = AccountsWorld::hook(AccountsWorld::donation(null, $item), $status);

    expect(fn () => app(AccountDeletionService::class)->hardDelete($deletion->id))
        ->toThrow(fn (ProblemException $e) => expect($e->problem->value)->toBe('shop.has_open_hooks')->and($e->status)->toBe(409));

    expect(app(AccountDeletionService::class)->hardDeleteDue())->toBe(['completed' => 0, 'deferred' => 1])
        ->and(User::query()->whereKey($merchant->id)->exists())->toBeTrue()
        ->and(Shop::query()->whereKey($shop->id)->exists())->toBeTrue()
        ->and($deletion->refresh()->status->value)->toBe('pending')
        ->and(Activity::query()->where('description', 'account.hard_delete_deferred')->count())->toBe(1);

    // Once the unit is redeemed the next run completes.
    DB::table('hooks')->where('id', $open->id)->update([
        'status' => 'REDEEMED',
        'code_hash' => hash('sha256', 'later-'.bin2hex(random_bytes(4))),
        'reserved_at' => Carbon::now()->subMinute(),
        'expires_at' => Carbon::now()->addMinutes(9),
        'redeemed_at' => Carbon::now(),
        'anon_id' => null,
    ]);

    expect(app(AccountDeletionService::class)->hardDeleteDue())->toBe(['completed' => 1, 'deferred' => 0])
        ->and(User::query()->whereKey($merchant->id)->exists())->toBeFalse();
})->with([HookStatus::Available, HookStatus::Reserved]);

it('does nothing before the grace period ends or after a cancellation', function (): void {
    $user = User::factory()->create();
    $deletion = app(AccountDeletionService::class)->request($user, DeletionChannel::Web);

    Carbon::setTestNow(Carbon::now()->addDays(AccountDeletionService::GRACE_DAYS)->subMinute());
    expect(app(AccountDeletionService::class)->hardDeleteDue())->toBe(['completed' => 0, 'deferred' => 0])
        ->and(User::query()->whereKey($user->id)->exists())->toBeTrue();

    expect(app(AccountDeletionService::class)->cancelPending($user))->toBeTrue();
    Carbon::setTestNow(Carbon::now()->addDays(30));

    expect(app(AccountDeletionService::class)->hardDeleteDue())->toBe(['completed' => 0, 'deferred' => 0])
        ->and(User::query()->whereKey($user->id)->exists())->toBeTrue()
        ->and($deletion->refresh()->status->value)->toBe('cancelled');
});

it('keeps identifiers only in the activity log', function (): void {
    ['user' => $user, 'needles' => $needles] = richAccount('merchant');
    $deletion = requestAndExpire($user);
    app(AccountDeletionService::class)->hardDeleteDue();

    $log = Activity::query()->get();
    $dump = $log->map(fn (Activity $a): string => $a->description.' '.json_encode($a->properties))->implode("\n");

    expect($dump)->not->toContain($needles['email'])
        ->not->toContain($needles['iban'])
        ->not->toContain($needles['tax_number'])
        ->not->toContain($needles['name']);

    $careless = $log->firstWhere('description', 'shop.updated');
    expect($careless?->properties->toArray())->toBe(['shop_id' => $careless?->properties['shop_id'], 'details' => ['count' => 3]])
        ->and($log->pluck('description')->all())->toContain('account.deletion_requested', 'account.hard_deleted')
        ->and($log->firstWhere('description', 'account.hard_deleted')?->properties->toArray())
        ->toBe(['deletion_request_id' => $deletion->id, 'user_id' => $user->id]);
});

it('schedules the hard delete job every hour', function (): void {
    $events = collect(app(Schedule::class)->events())->filter(fn ($event): bool => $event->description === HardDeleteAccounts::NAME);

    expect($events)->toHaveCount(1)
        ->and($events->first()->expression)->toBe('0 * * * *');
});
