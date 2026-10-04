<?php

use App\Domain\Donations\Models\Donation;
use App\Domain\Fraud\Models\AbuseFlag;
use App\Domain\Payments\Models\PaymentMismatch;
use App\Domain\Payments\Models\Payout;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

uses(RefreshDatabase::class);

/**
 * @return array<string, array{type: string, nullable: string, default: string|null}>
 */
function wiringColumns(string $table): array
{
    $rows = DB::select(
        "select column_name, udt_name, is_nullable, column_default from information_schema.columns where table_schema = 'public' and table_name = ?",
        [$table],
    );

    $columns = [];
    foreach ($rows as $row) {
        $columns[$row->column_name] = ['type' => $row->udt_name, 'nullable' => $row->is_nullable, 'default' => $row->column_default];
    }

    return $columns;
}

function wiringSqlState(Closure $callback): ?string
{
    DB::statement('savepoint wiring_probe');

    try {
        $callback();
    } catch (QueryException $e) {
        DB::statement('rollback to savepoint wiring_probe');

        return (string) $e->getCode();
    }

    DB::statement('release savepoint wiring_probe');

    return null;
}

it('adds the payment columns to donations', function (): void {
    $columns = wiringColumns('donations');

    expect($columns['hooks_issued_at'])->toMatchArray(['type' => 'timestamptz', 'nullable' => 'YES'])
        ->and($columns['conversation_id'])->toMatchArray(['type' => 'varchar', 'nullable' => 'YES']);
});

it('keeps one donation per provider token and allows many without a token', function (): void {
    $token = 'dummy-token-'.bin2hex(random_bytes(6));

    $first = Donation::factory()->create();
    $second = Donation::factory()->create();
    DB::table('donations')->where('id', $first->id)->update(['provider_token' => $token]);

    expect(wiringSqlState(fn () => DB::table('donations')->where('id', $second->id)->update(['provider_token' => $token])))
        ->toBe('23505');

    Donation::factory()->count(2)->create();
    expect(DB::table('donations')->whereNull('provider_token')->count())->toBeGreaterThanOrEqual(3);

    $index = DB::selectOne("select indexdef from pg_indexes where indexname = 'donations_provider_token_unique'");
    expect($index->indexdef)->toContain('UNIQUE')->toContain('WHERE (provider_token IS NOT NULL)');
});

it('casts the new donation and payout columns', function (): void {
    $donation = Donation::factory()->create();
    DB::table('donations')->where('id', $donation->id)->update(['hooks_issued_at' => now(), 'conversation_id' => 'conv-1']);

    $payout = Payout::factory()->create();

    expect($donation->refresh()->hooks_issued_at)->toBeInstanceOf(CarbonImmutable::class)
        ->and($donation->conversation_id)->toBe('conv-1')
        ->and($donation->toArray())->not->toHaveKey('conversation_id')
        ->and($payout->refresh()->hold)->toBeFalse()
        ->and($payout->hold_reason)->toBeNull();

    $payout->update(['hold' => true, 'hold_reason' => 'redemption rate']);

    expect($payout->refresh()->hold)->toBeTrue()->and($payout->hold_reason)->toBe('redemption rate');
});

it('adds the hold columns to payouts with a default of false', function (): void {
    $columns = wiringColumns('payouts');

    expect($columns['hold'])->toMatchArray(['type' => 'bool', 'nullable' => 'NO'])
        ->and($columns['hold']['default'])->toBe('false')
        ->and($columns['hold_reason'])->toMatchArray(['type' => 'varchar', 'nullable' => 'YES']);
});

it('creates payment_mismatches with a uuid key and the expected columns', function (): void {
    expect(Schema::hasTable('payment_mismatches'))->toBeTrue();

    $columns = wiringColumns('payment_mismatches');

    expect(array_keys($columns))->toEqualCanonicalizing([
        'id', 'donation_id', 'kind', 'ours', 'theirs', 'detected_at', 'resolved_at', 'resolved_by', 'resolution_note', 'created_at', 'updated_at',
    ])->and($columns['id']['type'])->toBe('uuid')
        ->and($columns['ours']['type'])->toBe('jsonb')
        ->and($columns['theirs']['type'])->toBe('jsonb')
        ->and($columns['detected_at']['type'])->toBe('timestamptz')
        ->and($columns['resolved_at']['nullable'])->toBe('YES');
});

it('allows one open mismatch per donation and kind', function (): void {
    $mismatch = PaymentMismatch::factory()->create();

    $duplicate = fn () => PaymentMismatch::factory()->create(['donation_id' => $mismatch->donation_id, 'kind' => $mismatch->kind]);
    expect(wiringSqlState($duplicate))->toBe('23505');

    PaymentMismatch::factory()->create(['donation_id' => $mismatch->donation_id, 'kind' => 'currency_mismatch']);

    $mismatch->forceFill(['resolved_at' => now(), 'resolution_note' => 'checked with the provider'])->save();
    PaymentMismatch::factory()->create(['donation_id' => $mismatch->donation_id, 'kind' => $mismatch->kind]);

    expect(PaymentMismatch::query()->where('donation_id', $mismatch->donation_id)->count())->toBe(3);
});

it('refuses resolution details on an unresolved mismatch', function (): void {
    $mismatch = PaymentMismatch::factory()->create();

    expect(wiringSqlState(fn () => DB::table('payment_mismatches')->where('id', $mismatch->id)->update(['resolution_note' => 'early'])))
        ->toBe('23514');
});

it('keeps the donation when a mismatch exists and nulls the resolver on user delete', function (): void {
    $resolver = User::factory()->create();
    $mismatch = PaymentMismatch::factory()->create();
    $mismatch->forceFill(['resolved_at' => now(), 'resolved_by' => $resolver->id])->save();

    expect(wiringSqlState(fn () => DB::table('donations')->where('id', $mismatch->donation_id)->delete()))->toBe('23503');

    $resolver->delete();

    expect($mismatch->refresh()->resolved_by)->toBeNull();
});

it('creates abuse_flags with a uuid key and the expected columns', function (): void {
    expect(Schema::hasTable('abuse_flags'))->toBeTrue();

    $columns = wiringColumns('abuse_flags');

    expect(array_keys($columns))->toEqualCanonicalizing(['id', 'shop_id', 'kind', 'detail', 'created_at', 'reviewed_at', 'reviewer_id'])
        ->and($columns['id']['type'])->toBe('uuid')
        ->and($columns['detail']['type'])->toBe('jsonb')
        ->and($columns['reviewed_at']['nullable'])->toBe('YES')
        ->and($columns['reviewer_id']['nullable'])->toBe('YES');
});

it('defaults abuse flag detail and creation time and rejects a reviewer without a review time', function (): void {
    $flag = AbuseFlag::factory()->create();
    $reviewer = User::factory()->create();

    expect($flag->refresh()->created_at)->not->toBeNull()
        ->and($flag->detail)->toEqual(['redeems_last_hour' => 42, 'threshold' => 30])
        ->and(wiringSqlState(fn () => DB::table('abuse_flags')->where('id', $flag->id)->update(['reviewer_id' => $reviewer->id])))
        ->toBe('23514');

    $flag->forceFill(['reviewed_at' => now(), 'reviewer_id' => $reviewer->id])->save();
    expect($flag->refresh()->reviewer_id)->toBe($reviewer->id);
});

it('creates valid rows from every factory of the wiring', function (): void {
    expect(PaymentMismatch::factory()->create()->exists)->toBeTrue()
        ->and(AbuseFlag::factory()->create()->exists)->toBeTrue()
        ->and(Payout::factory()->create()->exists)->toBeTrue();
});

it('indexes the foreign keys and the open-state lookups', function (): void {
    $names = array_map(
        fn (object $row): string => $row->indexname,
        DB::select("select indexname from pg_indexes where schemaname = 'public' and tablename in ('payment_mismatches', 'abuse_flags', 'payouts')"),
    );

    expect($names)->toContain('payment_mismatches_open_unique', 'payment_mismatches_donation_id_index', 'abuse_flags_shop_id_kind_index', 'payouts_hold_index');
});
