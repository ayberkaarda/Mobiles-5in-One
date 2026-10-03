<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('users', function (Blueprint $table): void {
            $table->uuid('id')->primary();
            $table->string('email', 254);
            $table->timestampTz('email_verified_at')->nullable();
            $table->string('password')->nullable();
            $table->string('apple_sub', 255)->nullable()->unique();
            $table->string('google_sub', 255)->nullable()->unique();
            $table->string('name', 100);
            $table->string('kind', 16);
            $table->timestampTz('deactivated_at')->nullable();
            $table->timestampsTz();
        });

        DB::statement("ALTER TABLE users ADD CONSTRAINT users_kind_check CHECK (kind IN ('donor', 'merchant'))");
        DB::statement('ALTER TABLE users ADD CONSTRAINT users_email_lowercase_check CHECK (email = lower(email))');
        DB::statement('CREATE UNIQUE INDEX users_email_lower_unique ON users (lower(email))');
    }

    public function down(): void
    {
        Schema::dropIfExists('users');
    }
};
