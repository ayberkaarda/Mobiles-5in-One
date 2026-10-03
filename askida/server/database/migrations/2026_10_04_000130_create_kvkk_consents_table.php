<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * KVKK notice acceptance records. ip_hash is an HMAC of the client IP keyed with a
 * server-side secret; the raw IP address is never stored.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('kvkk_consents', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('user_id')->constrained('users')->cascadeOnDelete();
            $table->string('text_version', 32);
            $table->timestampTz('accepted_at');
            $table->char('ip_hash', 64);
            $table->timestampsTz();
            $table->index('user_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('kvkk_consents');
    }
};
