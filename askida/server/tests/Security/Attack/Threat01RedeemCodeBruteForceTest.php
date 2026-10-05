<?php

use App\Domain\Hooks\Codes\HookCode;
use App\Domain\Hooks\Models\Hook;
use App\Domain\Hooks\Models\HookStatus;
use App\Domain\Shops\Models\Shop;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Testing\TestResponse;
use Tests\Feature\Api\Hooks\Support\HookWorld;
use Tests\Security\Attack\AttackKit;

/*
| Threat 4.1, redemption code brute force. A shop member guesses codes against the shop's
| live units; the defences are the code space (32^8), the per-shop limiter (30 a minute
| for members, a separate bucket for outsiders) and opaque failures. The limiter runs at
| its configured production value here, so the measured guess rate is the real one.
*/

uses(RefreshDatabase::class);

beforeEach(function (): void {
    HookWorld::pepper();
    $this->travelTo(CarbonImmutable::parse('2026-10-05 12:00:00', 'Europe/Istanbul'));
});

/**
 * @return array{shop: Shop, hook: Hook, code: string}
 */
function attack01LiveUnit(): array
{
    $shop = HookWorld::shop();
    [$hook] = HookWorld::availableHooks(HookWorld::item($shop), 1);
    $code = HookWorld::newCode();
    HookWorld::reserve($hook, HookWorld::anon(), $code);

    return ['shop' => $shop, 'hook' => $hook, 'code' => $code];
}

/**
 * A syntactically valid code that is not the live one.
 */
function attack01Guess(string $live): string
{
    do {
        $guess = HookWorld::newCode();
    } while ($guess === $live);

    return $guess;
}

function attack01Redeem(string $shopPath, string $token, mixed $code): TestResponse
{
    return AttackKit::json('POST', "/api/v1/shops/{$shopPath}/redeem", $token, ['code' => $code]);
}

it('stops a member after 30 guesses a minute, even for the right code, and lets it through after the window', function (): void {
    $limit = (int) config('askida.limits.redeem_per_minute_shop');
    expect($limit)->toBe(30);

    $unit = attack01LiveUnit();
    $token = HookWorld::userToken(HookWorld::staff($unit['shop']));

    for ($i = 0; $i < $limit; $i++) {
        AttackKit::assertProblem(attack01Redeem($unit['shop']->id, $token, attack01Guess($unit['code'])), 422, 'hook.code_invalid');
    }

    // The 31st request in the minute carries the right code: it is refused all the same.
    $blocked = attack01Redeem($unit['shop']->id, $token, $unit['code']);
    AttackKit::assertProblem($blocked, 429, 'rate_limited');
    expect((int) $blocked->headers->get('Retry-After'))->toBeGreaterThan(0)->toBeLessThanOrEqual(60)
        ->and($unit['hook']->fresh()?->status)->toBe(HookStatus::Reserved);

    // Measured guess rate: 30 guesses a minute against one live unit of 32^8 codes.
    $perMinuteOdds = $limit / (strlen(HookCode::ALPHABET) ** HookCode::LENGTH);
    expect($perMinuteOdds)->toBeLessThan(3e-11);

    // Negative control: once the window has passed, the right code redeems.
    $this->travel(61)->seconds();
    attack01Redeem($unit['shop']->id, $token, $unit['code'])->assertOk()->assertJsonPath('message', '1 ekmek verildi');
    expect($unit['hook']->fresh()?->status)->toBe(HookStatus::Redeemed);
});

it('does not open a new limiter bucket when the shop id in the path changes letter case', function (): void {
    $unit = attack01LiveUnit();
    $token = HookWorld::userToken(HookWorld::owner($unit['shop']));
    $id = $unit['shop']->id;
    expect($id)->toMatch('/[a-f]/');

    for ($i = 0; $i < 30; $i++) {
        AttackKit::assertProblem(attack01Redeem($id, $token, attack01Guess($unit['code'])), 422, 'hook.code_invalid');
    }

    // The same shop spelled in upper case (the router and PostgreSQL accept it) must share the bucket.
    AttackKit::assertProblem(attack01Redeem(strtoupper($id), $token, $unit['code']), 429, 'rate_limited');
    AttackKit::assertProblem(attack01Redeem(strtoupper(substr($id, 0, 18)).substr($id, 18), $token, $unit['code']), 429, 'rate_limited');
    expect($unit['hook']->fresh()?->status)->toBe(HookStatus::Reserved);
});

it('gives the same answer for an unknown, a used and another shop\'s live code', function (): void {
    $unit = attack01LiveUnit();
    $used = attack01LiveUnit();
    $token = HookWorld::userToken(HookWorld::owner($unit['shop']));
    $usedToken = HookWorld::userToken(HookWorld::owner($used['shop']));

    attack01Redeem($used['shop']->id, $usedToken, $used['code'])->assertOk();

    $usedShopToken = HookWorld::userToken(HookWorld::owner($used['shop']), 'second-device');
    $answers = [
        'unknown' => attack01Redeem($unit['shop']->id, $token, attack01Guess($unit['code'])),
        'used' => attack01Redeem($used['shop']->id, $usedShopToken, $used['code']),
        'foreign live code' => attack01Redeem($used['shop']->id, $usedShopToken, $unit['code']),
    ];

    $bodies = [];

    foreach ($answers as $answer) {
        AttackKit::assertProblem($answer, 422, 'hook.code_invalid');
        $body = $answer->json();
        unset($body['request_id']);
        $bodies[] = $body;
    }

    expect(array_unique(array_map('json_encode', $bodies)))->toHaveCount(1)
        ->and($unit['hook']->fresh()?->status)->toBe(HookStatus::Reserved);
});

it('rejects malformed codes before any lookup and never echoes them', function (mixed $code): void {
    $unit = attack01LiveUnit();
    $token = HookWorld::userToken(HookWorld::owner($unit['shop']));

    $response = attack01Redeem($unit['shop']->id, $token, $code);

    AttackKit::assertProblem($response, 422, 'validation.failed');
    expect($response->json('errors.0.field'))->toBe('code')
        ->and((string) $response->getContent())->not->toContain('%')
        ->and($unit['hook']->fresh()?->status)->toBe(HookStatus::Reserved);
})->with([
    'wildcard' => ['%%%%%%%%'],
    'too long' => [str_repeat('A', 40)],
    'sql fragment' => ["' OR 1=1--"],
    'array' => [['A', 'B']],
]);

it('stores codes only as a keyed hash, so a database dump does not reveal or test them', function (): void {
    // The code comes from the production reserve endpoint, not from a fixture.
    $shop = HookWorld::shop();
    $item = HookWorld::item($shop);
    [$hook] = HookWorld::availableHooks($item, 1);
    $reserved = AttackKit::json('POST', '/api/v1/hooks/reserve', HookWorld::anonToken(HookWorld::anon()), ['shop_id' => $shop->id, 'item_id' => $item->id])
        ->assertCreated();
    $code = (string) $reserved->json('code');
    expect($code)->toMatch(HookCode::PATTERN);

    $row = (array) Hook::query()->toBase()->where('id', $hook->id)->first();

    expect($row['status'])->toBe(HookStatus::Reserved->value)
        ->and($row['code_hash'])->toBe(hash_hmac('sha256', $code, HookWorld::pepper()))
        ->and($row['code_hash'])->not->toBe(hash('sha256', $code))
        ->and(json_encode($row))->not->toContain($code);
});
