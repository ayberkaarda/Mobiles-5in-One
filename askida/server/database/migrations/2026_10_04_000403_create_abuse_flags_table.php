<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Fraud scan findings per shop. `detail` carries counters and thresholds only, no personal
 * data. Review is a moderator or finance action in the admin panel.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('abuse_flags', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('shop_id')->constrained('shops')->restrictOnDelete();
            $table->string('kind', 48);
            $table->jsonb('detail')->default(DB::raw("'{}'::jsonb"));
            $table->timestampTz('created_at')->useCurrent();
            $table->timestampTz('reviewed_at')->nullable();
            $table->foreignUuid('reviewer_id')->nullable()->constrained('users')->nullOnDelete();

            $table->index(['shop_id', 'kind']);
            $table->index('reviewed_at');
        });

        DB::statement('ALTER TABLE abuse_flags ADD CONSTRAINT abuse_flags_review_check CHECK (reviewer_id IS NULL OR reviewed_at IS NOT NULL)');
    }

    public function down(): void
    {
        Schema::dropIfExists('abuse_flags');
    }
};
