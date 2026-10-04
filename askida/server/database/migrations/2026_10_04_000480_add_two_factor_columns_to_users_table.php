<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * TOTP for admin panel users (security checklist item 18).
 *
 * - two_factor_secret: the base32 secret, encrypted with the application key;
 * - two_factor_recovery_codes: JSON list of hashed single-use recovery codes;
 * - two_factor_confirmed_at: set once the user proved a code from the secret;
 * - two_factor_last_used_step: the last accepted TOTP step, so a code cannot be replayed.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->text('two_factor_secret')->nullable();
            $table->text('two_factor_recovery_codes')->nullable();
            $table->timestampTz('two_factor_confirmed_at')->nullable();
            $table->integer('two_factor_last_used_step')->nullable();
        });

        DB::statement('ALTER TABLE users ADD CONSTRAINT users_two_factor_confirmed_needs_secret_check CHECK (two_factor_confirmed_at IS NULL OR two_factor_secret IS NOT NULL)');
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE users DROP CONSTRAINT IF EXISTS users_two_factor_confirmed_needs_secret_check');

        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn([
                'two_factor_secret',
                'two_factor_recovery_codes',
                'two_factor_confirmed_at',
                'two_factor_last_used_step',
            ]);
        });
    }
};
