<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Settlement records read from the payment provider. The platform never holds funds:
 * these rows mirror the provider's sub-merchant settlements for display and reconciliation.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('payouts', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('shop_id')->constrained('shops')->restrictOnDelete();
            $table->string('provider_settlement_id', 191)->nullable();
            $table->bigInteger('amount_minor');
            $table->char('currency', 3)->default('TRY');
            $table->string('status', 16)->default('pending');
            // Settlement day as reported by the provider.
            $table->date('period');
            $table->timestampsTz();

            $table->index(['shop_id', 'period']);
        });

        DB::statement('ALTER TABLE payouts ADD CONSTRAINT payouts_amount_minor_check CHECK (amount_minor >= 0)');
        DB::statement("ALTER TABLE payouts ADD CONSTRAINT payouts_currency_check CHECK (currency = 'TRY')");
        DB::statement("ALTER TABLE payouts ADD CONSTRAINT payouts_status_check CHECK (status IN ('pending', 'held', 'settled', 'failed'))");
        DB::statement('CREATE UNIQUE INDEX payouts_shop_settlement_unique ON payouts (shop_id, provider_settlement_id) WHERE provider_settlement_id IS NOT NULL');
    }

    public function down(): void
    {
        Schema::dropIfExists('payouts');
    }
};
