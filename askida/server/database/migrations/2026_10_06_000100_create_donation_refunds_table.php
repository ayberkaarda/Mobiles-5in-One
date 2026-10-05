<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * One refund operation per donation, claimed before the provider is called.
 *
 * The row is the exclusive claim: a caller inserts it (or moves a `failed` row back to
 * `processing`) under the donation row lock, and only that caller talks to the provider.
 * `uncertain` means the provider may have moved money (outage or a different amount):
 * nothing retries it until finance records the provider's outcome. A `succeeded` row
 * holds the refunded amount and the refunded share of the platform commission, so the
 * ledger can aggregate what the shop and the platform keep.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('donation_refunds', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('donation_id')->unique()->constrained('donations')->restrictOnDelete();
            $table->string('status', 16);
            $table->integer('units');
            $table->bigInteger('amount_minor');
            $table->bigInteger('commission_minor');
            $table->integer('attempts')->default(1);
            $table->string('provider_refund_id', 191)->nullable();
            $table->timestampTz('claimed_at');
            $table->timestampTz('completed_at')->nullable();
            $table->timestampsTz();

            $table->index('status');
        });

        DB::statement("ALTER TABLE donation_refunds ADD CONSTRAINT donation_refunds_status_check CHECK (status IN ('processing', 'succeeded', 'failed', 'uncertain'))");
        DB::statement('ALTER TABLE donation_refunds ADD CONSTRAINT donation_refunds_units_check CHECK (units > 0)');
        DB::statement('ALTER TABLE donation_refunds ADD CONSTRAINT donation_refunds_amounts_check CHECK (amount_minor > 0 AND commission_minor >= 0 AND commission_minor <= amount_minor)');
        DB::statement('ALTER TABLE donation_refunds ADD CONSTRAINT donation_refunds_attempts_check CHECK (attempts > 0)');
        DB::statement("ALTER TABLE donation_refunds ADD CONSTRAINT donation_refunds_completed_check CHECK ((status = 'succeeded') = (completed_at IS NOT NULL))");
    }

    public function down(): void
    {
        Schema::dropIfExists('donation_refunds');
    }
};
