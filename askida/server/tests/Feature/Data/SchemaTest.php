<?php

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

uses(RefreshDatabase::class);

/**
 * Expected columns per domain table (spec section 5 plus id and timestamps).
 */
dataset('domain tables', [
    'shops' => ['shops', ['id', 'owner_id', 'name', 'slug', 'type', 'address', 'il', 'ilce', 'location', 'phone', 'tax_number_enc', 'iban_enc', 'sub_merchant_key', 'verification_state', 'verified_at', 'listed_on_web', 'is_sample', 'created_at', 'updated_at']],
    'shop_documents' => ['shop_documents', ['id', 'shop_id', 'kind', 'path', 'mime', 'size', 'reviewed_at', 'uploaded_at', 'created_at', 'updated_at']],
    'shop_members' => ['shop_members', ['id', 'shop_id', 'user_id', 'role', 'created_at', 'updated_at']],
    'items' => ['items', ['id', 'shop_id', 'name', 'category', 'price_minor', 'currency', 'daily_cap', 'active', 'created_at', 'updated_at']],
    'donations' => ['donations', ['id', 'donor_id', 'shop_id', 'item_id', 'qty', 'amount_minor', 'commission_minor', 'currency', 'provider', 'provider_payment_id', 'provider_token', 'status', 'paid_at', 'anonymized_at', 'created_at', 'updated_at']],
    'hooks' => ['hooks', ['id', 'donation_id', 'shop_id', 'item_id', 'status', 'anon_id', 'code_hash', 'reserved_at', 'expires_at', 'redeemed_at', 'redeemed_by_user_id', 'created_at', 'updated_at']],
    'anon_devices' => ['anon_devices', ['id', 'anon_id', 'platform', 'attested_at', 'attestation_verdict', 'banned_at', 'last_seen_at', 'created_at', 'updated_at']],
    'anon_daily_counters' => ['anon_daily_counters', ['id', 'anon_id', 'day', 'count', 'per_shop', 'created_at', 'updated_at']],
    'payment_events' => ['payment_events', ['id', 'provider', 'event_id', 'payload_hash', 'received_at', 'processed_at', 'created_at', 'updated_at']],
    'payouts' => ['payouts', ['id', 'shop_id', 'provider_settlement_id', 'amount_minor', 'currency', 'status', 'period', 'created_at', 'updated_at']],
    'impact_snapshots' => ['impact_snapshots', ['id', 'il', 'ilce', 'day', 'donated', 'redeemed', 'shops', 'created_at', 'updated_at']],
    'device_push_tokens' => ['device_push_tokens', ['id', 'user_id', 'platform', 'token', 'last_used_at', 'created_at', 'updated_at']],
    'deletion_requests' => ['deletion_requests', ['id', 'user_id', 'channel', 'status', 'requested_at', 'grace_until', 'completed_at', 'cancelled_at', 'created_at', 'updated_at']],
]);

/**
 * @return list<string>
 */
function dataColumns(string $table): array
{
    return array_map(
        fn (object $row): string => $row->column_name,
        DB::select("select column_name from information_schema.columns where table_schema = 'public' and table_name = ? order by column_name", [$table]),
    );
}

function dataColumnType(string $table, string $column): string
{
    $row = DB::selectOne(
        "select udt_name from information_schema.columns where table_schema = 'public' and table_name = ? and column_name = ?",
        [$table, $column],
    );

    return $row->udt_name;
}

/**
 * @return list<string>
 */
function dataConstraintNames(string $table, string $type): array
{
    return array_map(
        fn (object $row): string => $row->conname,
        DB::select('select conname from pg_constraint where conrelid = ?::regclass and contype = ? order by conname', [$table, $type]),
    );
}

function dataIndexDefinition(string $index): ?string
{
    $row = DB::selectOne("select indexdef from pg_indexes where schemaname = 'public' and indexname = ?", [$index]);

    return $row?->indexdef;
}

it('creates every domain table with exactly the expected columns', function (string $table, array $columns) {
    expect(Schema::hasTable($table))->toBeTrue();

    $expected = $columns;
    sort($expected);

    expect(dataColumns($table))->toBe($expected);
})->with('domain tables');

it('uses uuid primary keys on every domain table', function (string $table) {
    expect(dataColumnType($table, 'id'))->toBe('uuid');

    $primary = DB::selectOne(
        'select a.attname from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey) where i.indrelid = ?::regclass and i.indisprimary',
        [$table],
    );
    expect($primary->attname)->toBe('id');
})->with([
    'shops', 'shop_documents', 'shop_members', 'items', 'donations', 'hooks', 'anon_devices',
    'anon_daily_counters', 'payment_events', 'payouts', 'impact_snapshots', 'device_push_tokens',
    'deletion_requests',
]);

it('stores money as bigint minor units', function (string $table, string $column) {
    expect(dataColumnType($table, $column))->toBe('int8');
})->with([
    ['items', 'price_minor'],
    ['donations', 'amount_minor'],
    ['donations', 'commission_minor'],
    ['payouts', 'amount_minor'],
]);

it('stores shop locations as a geography point with a GiST index', function () {
    $column = DB::selectOne(
        "select type, srid from geography_columns where f_table_name = 'shops' and f_geography_column = 'location'",
    );

    expect($column->type)->toBe('Point')
        ->and((int) $column->srid)->toBe(4326);

    expect(dataIndexDefinition('shops_location_gist'))->toContain('USING gist (location)');
});

it('declares the check constraints', function (string $table, array $names) {
    $present = dataConstraintNames($table, 'c');

    foreach ($names as $name) {
        expect($present)->toContain($name);
    }
})->with([
    ['shops', ['shops_verification_state_check', 'shops_verified_at_check', 'shops_location_turkiye_bbox_check']],
    ['shop_documents', ['shop_documents_kind_check', 'shop_documents_mime_check', 'shop_documents_size_check']],
    ['shop_members', ['shop_members_role_check']],
    ['items', ['items_category_check', 'items_price_minor_check', 'items_currency_check', 'items_daily_cap_check']],
    ['donations', ['donations_qty_check', 'donations_amount_minor_check', 'donations_commission_minor_check', 'donations_currency_check', 'donations_status_check', 'donations_paid_at_check', 'donations_anonymized_check']],
    ['hooks', ['hooks_status_check', 'hooks_code_hash_format_check', 'hooks_state_shape_check']],
    ['anon_devices', ['anon_devices_platform_check']],
    ['anon_daily_counters', ['anon_daily_counters_count_check', 'anon_daily_counters_per_shop_check']],
    ['payouts', ['payouts_amount_minor_check', 'payouts_currency_check', 'payouts_status_check']],
    ['impact_snapshots', ['impact_snapshots_counts_check']],
    ['device_push_tokens', ['device_push_tokens_platform_check']],
    ['deletion_requests', ['deletion_requests_channel_check', 'deletion_requests_status_check', 'deletion_requests_grace_check']],
]);

it('declares the unique and lookup indexes', function (string $index, string $fragment) {
    expect(dataIndexDefinition($index))->not->toBeNull()->toContain($fragment);
})->with([
    ['shops_slug_unique', 'UNIQUE INDEX'],
    ['shops_sub_merchant_key_unique', 'UNIQUE INDEX'],
    ['shop_members_shop_id_user_id_unique', '(shop_id, user_id)'],
    ['donations_provider_payment_unique', 'WHERE (provider_payment_id IS NOT NULL)'],
    ['hooks_shop_code_hash_unique', "WHERE ((status)::text = ANY ((ARRAY['RESERVED'::character varying, 'REDEEMED'::character varying])::text[]))"],
    ['hooks_available_pick_index', "WHERE ((status)::text = 'AVAILABLE'::text)"],
    ['hooks_reserved_expiry_index', "WHERE ((status)::text = 'RESERVED'::text)"],
    ['hooks_redeemed_day_index', "WHERE ((status)::text = 'REDEEMED'::text)"],
    ['hooks_anon_reserved_index', 'WHERE (anon_id IS NOT NULL)'],
    ['anon_devices_anon_id_unique', 'UNIQUE INDEX'],
    ['anon_daily_counters_anon_id_day_unique', '(anon_id, day)'],
    ['payment_events_provider_event_id_unique', '(provider, event_id)'],
    ['payouts_shop_settlement_unique', 'WHERE (provider_settlement_id IS NOT NULL)'],
    ['impact_snapshots_il_ilce_day_unique', '(il, ilce, day)'],
    ['device_push_tokens_token_unique', 'UNIQUE INDEX'],
    ['deletion_requests_due_index', "WHERE ((status)::text = 'pending'::text)"],
]);

it('declares the foreign keys with the deletion semantics', function (string $table, string $column, string $target, string $onDelete) {
    $row = DB::selectOne(
        'select confrelid::regclass::text as target, confdeltype from pg_constraint c
         join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
         where c.contype = ? and c.conrelid = ?::regclass and a.attname = ?',
        ['f', $table, $column],
    );

    expect($row)->not->toBeNull()
        ->and($row->target)->toBe($target)
        ->and($row->confdeltype)->toBe($onDelete);
})->with([
    // a = no action, r = restrict, c = cascade, n = set null
    ['shops', 'owner_id', 'users', 'r'],
    ['shop_documents', 'shop_id', 'shops', 'c'],
    ['shop_members', 'shop_id', 'shops', 'c'],
    ['shop_members', 'user_id', 'users', 'c'],
    ['items', 'shop_id', 'shops', 'c'],
    ['donations', 'donor_id', 'users', 'n'],
    ['donations', 'shop_id', 'shops', 'r'],
    ['donations', 'item_id', 'items', 'r'],
    ['hooks', 'donation_id', 'donations', 'r'],
    ['hooks', 'shop_id', 'shops', 'r'],
    ['hooks', 'item_id', 'items', 'r'],
    ['hooks', 'anon_id', 'anon_devices', 'n'],
    ['hooks', 'redeemed_by_user_id', 'users', 'n'],
    ['anon_daily_counters', 'anon_id', 'anon_devices', 'c'],
    ['payouts', 'shop_id', 'shops', 'r'],
    ['device_push_tokens', 'user_id', 'users', 'c'],
    ['deletion_requests', 'user_id', 'users', 'n'],
]);

it('keeps the anonymous device tables free of personal data columns (AN-3)', function () {
    expect(dataColumns('anon_devices'))->toBe(['anon_id', 'attestation_verdict', 'attested_at', 'banned_at', 'created_at', 'id', 'last_seen_at', 'platform', 'updated_at'])
        ->and(dataColumns('anon_daily_counters'))->toBe(['anon_id', 'count', 'created_at', 'day', 'id', 'per_shop', 'updated_at']);
});

it('creates the package tables for roles and the activity log with uuid model keys', function () {
    foreach (['permissions', 'roles', 'model_has_permissions', 'model_has_roles', 'role_has_permissions', 'activity_log'] as $table) {
        expect(Schema::hasTable($table))->toBeTrue();
    }

    expect(dataColumnType('model_has_roles', 'model_id'))->toBe('uuid')
        ->and(dataColumnType('model_has_permissions', 'model_id'))->toBe('uuid')
        ->and(dataColumnType('activity_log', 'subject_id'))->toBe('uuid')
        ->and(dataColumnType('activity_log', 'causer_id'))->toBe('uuid')
        ->and(Schema::hasColumns('activity_log', ['event', 'batch_uuid']))->toBeTrue();
});

it('installs the trigger that keeps REDEEMED final', function () {
    $trigger = DB::selectOne(
        "select tgname from pg_trigger where tgrelid = 'hooks'::regclass and tgname = 'hooks_redeemed_is_final'",
    );

    expect($trigger)->not->toBeNull();
});
