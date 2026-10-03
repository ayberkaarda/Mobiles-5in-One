<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('shops', function (Blueprint $table) {
            $table->uuid('id')->primary();
            // Nullable so that the account deletion flow can detach a removed owner while the
            // shop row stays as the anchor of retained donation records. RESTRICT makes that
            // detachment explicit: a user row cannot disappear from under an owned shop.
            $table->foreignUuid('owner_id')->nullable()->constrained('users')->restrictOnDelete();
            $table->string('name', 120);
            $table->string('slug', 140)->unique();
            $table->string('type', 40);
            $table->string('address', 255);
            $table->string('il', 64);
            $table->string('ilce', 64);
            $table->string('phone', 32);
            // Written through encrypted casts (APP_KEY cipher); never plaintext in the database.
            $table->text('tax_number_enc')->nullable();
            $table->text('iban_enc')->nullable();
            $table->string('sub_merchant_key', 191)->nullable()->unique();
            $table->string('verification_state', 16)->default('pending');
            $table->timestampTz('verified_at')->nullable();
            $table->boolean('listed_on_web')->default(false);
            $table->boolean('is_sample')->default(false);
            $table->timestampsTz();

            $table->index('owner_id');
            $table->index('verification_state');
            $table->index(['il', 'ilce']);
        });

        DB::statement('ALTER TABLE shops ADD COLUMN location geography(Point, 4326) NOT NULL');
        DB::statement('CREATE INDEX shops_location_gist ON shops USING GIST (location)');
        DB::statement("ALTER TABLE shops ADD CONSTRAINT shops_verification_state_check CHECK (verification_state IN ('pending', 'verified', 'rejected'))");
        DB::statement("ALTER TABLE shops ADD CONSTRAINT shops_verified_at_check CHECK (verification_state <> 'verified' OR verified_at IS NOT NULL)");
        DB::statement('ALTER TABLE shops ADD CONSTRAINT shops_location_turkiye_bbox_check CHECK (ST_X(location::geometry) BETWEEN 25.5 AND 45.0 AND ST_Y(location::geometry) BETWEEN 35.8 AND 42.2)');
    }

    public function down(): void
    {
        Schema::dropIfExists('shops');
    }
};
