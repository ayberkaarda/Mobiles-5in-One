<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Contracts\Encryption\DecryptException;
use Illuminate\Encryption\Encrypter;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;

/**
 * php artisan askida:rotate-app-key [--stdin] [--dry-run]
 *
 * Re-encrypts the three columns that hold application-key ciphertext (shops.tax_number_enc,
 * shops.iban_enc, users.two_factor_secret) from the OLD key to the current APP_KEY, after
 * the key was replaced (history purge runbook, step APP_KEY).
 *
 * The old key is never a command option: arguments leak through process lists and shell
 * history. It is read from the first entry of APP_PREVIOUS_KEYS (the variable Laravel
 * itself reads for decryption fallback) or, when that is empty, from standard input with
 * --stdin. Standard input must be a pipe or a file: an interactive terminal is refused,
 * so the key is never typed or echoed.
 *
 * Runs in one transaction and is idempotent: a value that already decrypts under the
 * current key is left alone; a value that decrypts under neither key aborts the whole
 * run (nothing is written). --dry-run does the same checks and writes nothing. Output
 * holds counts only, never keys or values.
 */
class RotateAppKey extends Command
{
    /** @var array<string, string> table => comma-separated ciphertext columns */
    public const TARGETS = [
        'shops' => 'tax_number_enc,iban_enc',
        'users' => 'two_factor_secret',
    ];

    protected $signature = 'askida:rotate-app-key
        {--stdin : Read the old key from standard input (a pipe or file, never a terminal)}
        {--dry-run : Check every value and report counts without writing}';

    protected $description = 'Re-encrypt shop tax number, shop IBAN and admin TOTP secrets from the previous app key to the current one';

    public function handle(): int
    {
        try {
            $oldKey = $this->oldKey();
            $newKey = $this->parseKey((string) config('app.key'));
            $cipher = (string) config('app.cipher');

            if ($newKey === '') {
                throw new RuntimeException('APP_KEY is empty.');
            }

            if (hash_equals($newKey, $oldKey)) {
                throw new RuntimeException('The old key equals APP_KEY: nothing to rotate.');
            }

            $old = new Encrypter($oldKey, $cipher);
            $new = new Encrypter($newKey, $cipher);
            $dry = (bool) $this->option('dry-run');

            $rows = [];
            DB::transaction(function () use ($old, $new, $dry, &$rows): void {
                foreach (self::TARGETS as $table => $columns) {
                    foreach (explode(',', $columns) as $column) {
                        $rows[] = [$table, $column, ...$this->rotateColumn($table, $column, $old, $new, $dry)];
                    }
                }
            });
        } catch (RuntimeException $e) {
            $this->error($e->getMessage());

            return self::FAILURE;
        }

        $this->table(['table', 'column', 'rotated', 'already current', 'empty'], $rows);
        $this->info($this->option('dry-run') ? 'Dry run: nothing was written.' : 'Rotation finished.');

        return self::SUCCESS;
    }

    /**
     * @return array{int, int, int} rotated, already current, empty
     */
    private function rotateColumn(string $table, string $column, Encrypter $old, Encrypter $new, bool $dry): array
    {
        $rotated = $current = $empty = 0;

        DB::table($table)->select(['id', $column])->orderBy('id')->lazyById(500, 'id')->each(
            function (object $row) use ($table, $column, $old, $new, $dry, &$rotated, &$current, &$empty): void {
                $value = $row->{$column};

                if ($value === null || $value === '') {
                    $empty++;

                    return;
                }

                try {
                    $plain = $old->decryptString((string) $value);
                } catch (DecryptException) {
                    try {
                        $new->decryptString((string) $value);
                        $current++;

                        return;
                    } catch (DecryptException) {
                        throw new RuntimeException("A value in {$table}.{$column} decrypts under neither key (row id {$row->id}); nothing was written.");
                    }
                }

                if (! $dry) {
                    DB::table($table)->where('id', $row->id)->update([$column => $new->encryptString($plain)]);
                }

                $rotated++;
            },
        );

        return [$rotated, $current, $empty];
    }

    private function oldKey(): string
    {
        $previous = config('app.previous_keys');
        $first = is_array($previous) ? ($previous[0] ?? null) : null;

        if (is_string($first) && $first !== '') {
            return $this->parseKey($first);
        }

        if (! $this->option('stdin')) {
            throw new RuntimeException('No old key: set APP_PREVIOUS_KEYS or pipe the old key in with --stdin.');
        }

        $raw = $this->readStdin();

        if ($raw === '') {
            throw new RuntimeException('No old key on standard input.');
        }

        return $this->parseKey($raw);
    }

    /** The old key from standard input; refuses an interactive terminal. */
    private function readStdin(): string
    {
        if ($this->stdinIsTerminal()) {
            throw new RuntimeException('Standard input is a terminal: pipe the old key in (the key is never prompted for or echoed).');
        }

        return trim($this->stdinContents());
    }

    protected function stdinIsTerminal(): bool
    {
        return stream_isatty(STDIN);
    }

    protected function stdinContents(): string
    {
        return (string) stream_get_contents(STDIN);
    }

    private function parseKey(string $key): string
    {
        $key = trim($key);

        if (Str::startsWith($key, 'base64:')) {
            $decoded = base64_decode(Str::after($key, 'base64:'), true);

            if ($decoded === false) {
                throw new RuntimeException('A key is not valid base64.');
            }

            return $decoded;
        }

        return $key;
    }
}
