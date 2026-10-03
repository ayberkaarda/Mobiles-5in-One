<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Anonymous recipient devices. Columns are limited to the specification list: no name,
 * email, phone, advertising id, IP address or coordinates is ever stored here.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('anon_devices', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('anon_id', 64)->unique();
            $table->string('platform', 16);
            $table->timestampTz('attested_at')->nullable();
            $table->string('attestation_verdict', 32)->nullable();
            $table->timestampTz('banned_at')->nullable();
            $table->timestampTz('last_seen_at')->nullable();
            $table->timestampsTz();
        });

        DB::statement("ALTER TABLE anon_devices ADD CONSTRAINT anon_devices_platform_check CHECK (platform IN ('android', 'ios'))");
    }

    public function down(): void
    {
        Schema::dropIfExists('anon_devices');
    }
};
