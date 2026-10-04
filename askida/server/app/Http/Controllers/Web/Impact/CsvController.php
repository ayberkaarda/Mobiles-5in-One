<?php

namespace App\Http\Controllers\Web\Impact;

use App\Domain\Web\Impact\ImpactWebReader;
use App\Http\Controllers\Controller;
use Illuminate\Support\Facades\Cache;
use Symfony\Component\HttpFoundation\Response;

/**
 * GET /etki.csv: the open data of the impact pages, one row per day and district of the last
 * 90 days (`day,il,ilce,donated,redeemed,shops`), small cells pooled. Cached for an hour in
 * the application cache; not served through the page cache.
 */
class CsvController extends Controller
{
    public const CACHE_SECONDS = 3600;

    public function __invoke(ImpactWebReader $reader): Response
    {
        $key = 'web:impact:csv:v1:'.((bool) config('askida.allow_sample_shops') ? 's' : 'r');

        /** @var string $body */
        $body = Cache::remember($key, self::CACHE_SECONDS, fn (): string => $this->render($reader));

        return response($body, 200, [
            'Content-Type' => 'text/csv; charset=utf-8',
            'Content-Disposition' => 'inline; filename="askida-etki.csv"',
            'Cache-Control' => 'public, max-age='.self::CACHE_SECONDS,
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }

    private function render(ImpactWebReader $reader): string
    {
        $out = fopen('php://temp', 'r+');
        assert($out !== false);

        fputcsv($out, ImpactWebReader::CSV_HEADER, ',', '"', '', "\n");

        foreach ($reader->csvRows() as $row) {
            fputcsv($out, [
                $row['day'],
                self::safe($row['il']),
                self::safe($row['ilce']),
                $row['donated'],
                $row['redeemed'],
                $row['shops'],
            ], ',', '"', '', "\n");
        }

        rewind($out);

        return (string) stream_get_contents($out);
    }

    /**
     * Place names are typed by shop owners: a leading formula character is neutralised so a
     * spreadsheet never evaluates a cell.
     */
    private static function safe(string $value): string
    {
        return preg_match('/^[=+\-@\t\r]/', $value) === 1 ? "'".$value : $value;
    }
}
