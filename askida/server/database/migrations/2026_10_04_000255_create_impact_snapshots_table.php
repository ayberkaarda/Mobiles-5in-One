<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Public district-level counters (units donated, units redeemed, active shops) per day.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('impact_snapshots', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('il', 64);
            $table->string('ilce', 64);
            $table->date('day');
            $table->unsignedInteger('donated')->default(0);
            $table->unsignedInteger('redeemed')->default(0);
            $table->unsignedInteger('shops')->default(0);
            $table->timestampsTz();

            $table->unique(['il', 'ilce', 'day']);
            $table->index('day');
        });

        DB::statement('ALTER TABLE impact_snapshots ADD CONSTRAINT impact_snapshots_counts_check CHECK (donated >= 0 AND redeemed >= 0 AND shops >= 0)');
    }

    public function down(): void
    {
        Schema::dropIfExists('impact_snapshots');
    }
};
