<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Push registration tokens of donor and merchant devices. Anonymous devices never
 * register one. Rows go with the user (deactivation deletes them explicitly).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('device_push_tokens', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('user_id')->constrained('users')->cascadeOnDelete();
            $table->string('platform', 16);
            $table->text('token')->unique();
            $table->timestampTz('last_used_at')->nullable();
            $table->timestampsTz();

            $table->index('user_id');
        });

        DB::statement("ALTER TABLE device_push_tokens ADD CONSTRAINT device_push_tokens_platform_check CHECK (platform IN ('android', 'ios'))");
    }

    public function down(): void
    {
        Schema::dropIfExists('device_push_tokens');
    }
};
