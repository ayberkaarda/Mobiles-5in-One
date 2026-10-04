<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Aggregate reserve counters per anonymous device and day (daily caps). Rows older than
 * 30 days are removed by a retention job; deleting the device removes its counters.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('anon_daily_counters', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('anon_id', 64);
            $table->date('day');
            $table->unsignedSmallInteger('count')->default(0);
            // Map of shop id to the number of units reserved there on that day.
            $table->jsonb('per_shop')->default(DB::raw("'{}'::jsonb"));
            $table->timestampsTz();

            $table->foreign('anon_id')->references('anon_id')->on('anon_devices')->cascadeOnDelete();
            $table->unique(['anon_id', 'day']);
            $table->index('day');
        });

        DB::statement('ALTER TABLE anon_daily_counters ADD CONSTRAINT anon_daily_counters_count_check CHECK (count >= 0)');
        DB::statement("ALTER TABLE anon_daily_counters ADD CONSTRAINT anon_daily_counters_per_shop_check CHECK (jsonb_typeof(per_shop) = 'object')");
    }

    public function down(): void
    {
        Schema::dropIfExists('anon_daily_counters');
    }
};
