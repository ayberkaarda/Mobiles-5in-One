<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Disagreements between our donation record and the provider (amount, currency,
 * conversation id, missed transitions). At most one unresolved row per (donation, kind).
 * `ours` and `theirs` hold small state snapshots (status, amounts), never personal data.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('payment_mismatches', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('donation_id')->constrained('donations')->restrictOnDelete();
            $table->string('kind', 48);
            $table->jsonb('ours');
            $table->jsonb('theirs');
            $table->timestampTz('detected_at');
            $table->timestampTz('resolved_at')->nullable();
            $table->foreignUuid('resolved_by')->nullable()->constrained('users')->nullOnDelete();
            $table->text('resolution_note')->nullable();
            $table->timestampsTz();

            $table->index('donation_id');
            $table->index('resolved_at');
        });

        DB::statement('CREATE UNIQUE INDEX payment_mismatches_open_unique ON payment_mismatches (donation_id, kind) WHERE resolved_at IS NULL');
        DB::statement('ALTER TABLE payment_mismatches ADD CONSTRAINT payment_mismatches_resolution_check CHECK (resolved_at IS NOT NULL OR (resolved_by IS NULL AND resolution_note IS NULL))');
    }

    public function down(): void
    {
        Schema::dropIfExists('payment_mismatches');
    }
};
