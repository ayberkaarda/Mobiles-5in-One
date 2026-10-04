<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Payment bookkeeping on donations: when the hooks were issued, the provider conversation
 * id used for idempotency, and one donation per provider token.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('donations', function (Blueprint $table) {
            $table->timestampTz('hooks_issued_at')->nullable();
            $table->string('conversation_id', 64)->nullable();
        });

        DB::statement('CREATE UNIQUE INDEX donations_provider_token_unique ON donations (provider_token) WHERE provider_token IS NOT NULL');
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS donations_provider_token_unique');

        Schema::table('donations', function (Blueprint $table) {
            $table->dropColumn(['hooks_issued_at', 'conversation_id']);
        });
    }
};
