<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * One-time codes sent by mail: password reset and email verification.
 * Only an HMAC of the code is stored; a row is deleted when the code is used,
 * replaced, or exhausted by failed attempts.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('password_reset_tokens', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->foreignUuid('user_id')->constrained('users')->cascadeOnDelete();
            $table->string('purpose', 32);
            $table->char('code_hash', 64);
            $table->unsignedSmallInteger('attempts')->default(0);
            $table->timestampTz('expires_at');
            $table->timestampTz('created_at');
            $table->unique(['user_id', 'purpose']);
        });

        DB::statement("ALTER TABLE password_reset_tokens ADD CONSTRAINT password_reset_tokens_purpose_check CHECK (purpose IN ('email_verification', 'password_reset'))");
    }

    public function down(): void
    {
        Schema::dropIfExists('password_reset_tokens');
    }
};
