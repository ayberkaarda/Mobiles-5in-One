<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Sanctum personal access tokens, one per device. The token name is the device name.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('personal_access_tokens', function (Blueprint $table): void {
            $table->id();
            $table->uuidMorphs('tokenable');
            $table->string('name', 100);
            $table->string('platform', 16)->nullable();
            $table->string('token', 64)->unique();
            $table->text('abilities')->nullable();
            $table->timestampTz('last_used_at')->nullable();
            $table->timestampTz('expires_at')->nullable()->index();
            $table->timestampsTz();
            $table->index(['tokenable_type', 'tokenable_id', 'name']);
        });

        DB::statement("ALTER TABLE personal_access_tokens ADD CONSTRAINT personal_access_tokens_platform_check CHECK (platform IS NULL OR platform IN ('ios', 'android'))");
    }

    public function down(): void
    {
        Schema::dropIfExists('personal_access_tokens');
    }
};
