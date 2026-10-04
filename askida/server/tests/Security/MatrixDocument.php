<?php

namespace Tests\Security;

use RuntimeException;
use Tests\Datasets\AuthorizationMatrix;

/**
 * Reads the endpoint tables (section 3) and the admin table (section 4) of
 * docs/security/authorization-matrix.md into `row key => principal => cell`.
 */
final class MatrixDocument
{
    public static function path(): string
    {
        return dirname(base_path()).'/docs/security/authorization-matrix.md';
    }

    /**
     * @return array<string, array<string, string>>
     */
    public static function rows(?string $markdown = null): array
    {
        if ($markdown === null) {
            $path = self::path();

            if (! is_file($path)) {
                throw new RuntimeException("Authorization matrix not found at {$path}.");
            }

            $markdown = (string) file_get_contents($path);
        }

        $rows = [];
        $header = null;

        foreach (preg_split('/\R/', $markdown) ?: [] as $line) {
            $line = trim($line);

            if (! str_starts_with($line, '|')) {
                $header = null;

                continue;
            }

            $columns = array_map('trim', explode('|', trim($line, '|')));

            if ($header === null) {
                $header = $columns;

                continue;
            }

            if (preg_match('/^:?-{3,}:?$/', $columns[0]) === 1) {
                continue;
            }

            if ($header[0] === 'Method' && ($header[1] ?? null) === 'Path') {
                $key = $columns[0].' '.trim($columns[1], '`');
                $rows[$key] = self::cells($header, $columns, AuthorizationMatrix::API_PRINCIPALS);
            } elseif ($header[0] === 'Operation') {
                $rows[$columns[0]] = self::cells($header, $columns, AuthorizationMatrix::ADMIN_PRINCIPALS);
            }
        }

        return $rows;
    }

    /**
     * @param  list<string>  $header
     * @param  list<string>  $columns
     * @param  list<string>  $principals
     * @return array<string, string>
     */
    private static function cells(array $header, array $columns, array $principals): array
    {
        $cells = [];

        foreach ($principals as $principal) {
            $index = array_search($principal, $header, true);

            if ($index !== false) {
                $cells[$principal] = $columns[$index] ?? '';
            }
        }

        return $cells;
    }
}
