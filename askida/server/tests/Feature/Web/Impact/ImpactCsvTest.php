<?php

use App\Domain\Impact\Models\ImpactSnapshot;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Tests\Feature\Api\Accounts\Support\AccountsWorld;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    Cache::flush();
    config(['askida.allow_sample_shops' => false, 'responsecache.enabled' => true, 'responsecache.store' => 'array']);
    Carbon::setTestNow('2026-10-04 15:00:00');
});

afterEach(fn () => Carbon::setTestNow());

function impactCsvRow(string $il, string $ilce, string $day, int $donated, int $redeemed, int $shops): void
{
    $row = new ImpactSnapshot;
    $row->forceFill(compact('il', 'ilce', 'day', 'donated', 'redeemed', 'shops'))->save();
}

/**
 * @return list<list<string|null>>
 */
function impactCsvLines(string $body): array
{
    return array_map(fn (string $line): array => str_getcsv($line, ',', '"', ''), array_values(array_filter(explode("\n", $body), fn (string $line): bool => $line !== '')));
}

it('serves the header and nothing else when there is no data', function (): void {
    $response = $this->get('/etki.csv');

    $response->assertOk();

    expect($response->headers->get('Content-Type'))->toBe('text/csv; charset=utf-8')
        ->and($response->getContent())->toBe("day,il,ilce,donated,redeemed,shops\n");
});

it('lists one row per day and district of the last 90 days', function (): void {
    impactCsvRow('İstanbul', 'Kadıköy', '2026-10-04', 5, 2, 3);
    impactCsvRow('İstanbul', 'Kadıköy', '2026-10-03', 10, 6, 3);
    impactCsvRow('İstanbul', 'Kadıköy', '2026-07-07', 1, 1, 3);
    impactCsvRow('İstanbul', 'Kadıköy', '2026-07-06', 99, 99, 3);

    $response = $this->get('/etki.csv');
    $lines = impactCsvLines((string) $response->getContent());

    expect($lines)->toBe([
        ['day', 'il', 'ilce', 'donated', 'redeemed', 'shops'],
        ['2026-07-07', 'İstanbul', 'Kadıköy', '1', '1', '3'],
        ['2026-10-03', 'İstanbul', 'Kadıköy', '10', '6', '3'],
        ['2026-10-04', 'İstanbul', 'Kadıköy', '5', '2', '3'],
    ]);
});

it('pools districts below three shops per day and never names them', function (): void {
    impactCsvRow('İstanbul', 'Kadıköy', '2026-10-04', 5, 2, 3);
    impactCsvRow('İstanbul', 'Beşiktaş', '2026-10-04', 2, 1, 1);
    impactCsvRow('İstanbul', 'Şişli', '2026-10-04', 4, 3, 2);
    impactCsvRow('İzmir', 'Konak', '2026-10-04', 3, 1, 1);

    $body = (string) $this->get('/etki.csv')->getContent();
    $lines = impactCsvLines($body);

    expect($lines)->toBe([
        ['day', 'il', 'ilce', 'donated', 'redeemed', 'shops'],
        ['2026-10-04', 'İstanbul', 'Kadıköy', '5', '2', '3'],
        ['2026-10-04', 'İstanbul', 'Diğer ilçeler', '6', '4', '3'],
        ['2026-10-04', 'Diğer iller', 'Diğer ilçeler', '3', '1', '1'],
    ])->and($body)->not->toContain('Beşiktaş')->not->toContain('Konak');
});

it('neutralises spreadsheet formulas in typed place names', function (): void {
    impactCsvRow('=HYPERLINK("x")', '@cmd', '2026-10-04', 1, 1, 3);

    $lines = impactCsvLines((string) $this->get('/etki.csv')->getContent());

    expect($lines[1][1])->toBe("'=HYPERLINK(\"x\")")->and($lines[1][2])->toBe("'@cmd");
});

it('keeps the file for an hour, public, and outside the page cache', function (): void {
    impactCsvRow('İstanbul', 'Kadıköy', '2026-10-04', 5, 2, 3);

    $first = $this->get('/etki.csv');
    impactCsvRow('Ankara', 'Çankaya', '2026-10-04', 7, 4, 4);
    $second = $this->get('/etki.csv');

    expect($second->getContent())->toBe($first->getContent())
        ->and($first->headers->get('Cache-Control'))->toContain('public')->toContain('max-age=3600')
        ->and($first->headers->has('X-Page-Cache'))->toBeFalse();

    Carbon::setTestNow('2026-10-04 16:01:00');

    expect($this->get('/etki.csv')->getContent())->toContain('Ankara');
});

it('never publishes example figures as data', function (): void {
    config(['askida.allow_sample_shops' => true]);

    foreach (range(1, 3) as $i) {
        AccountsWorld::shop(null, ['is_sample' => true]);
    }

    expect($this->get('/etki.csv')->getContent())->toBe('day,il,ilce,donated,redeemed,shops
');
});
