<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('donations', function (Blueprint $table) {
            $table->uuid('id')->primary();
            // Payment records outlive the donor account: deleting the user keeps the row with
            // donor_id = NULL (the deletion flow also stamps anonymized_at).
            $table->foreignUuid('donor_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignUuid('shop_id')->constrained('shops')->restrictOnDelete();
            $table->foreignUuid('item_id')->constrained('items')->restrictOnDelete();
            $table->smallInteger('qty');
            $table->bigInteger('amount_minor');
            $table->bigInteger('commission_minor')->default(0);
            $table->char('currency', 3)->default('TRY');
            $table->string('provider', 32);
            $table->string('provider_payment_id', 191)->nullable();
            $table->string('provider_token', 255)->nullable();
            $table->string('status', 16)->default('initiated');
            $table->timestampTz('paid_at')->nullable();
            $table->timestampTz('anonymized_at')->nullable();
            $table->timestampsTz();

            $table->index(['donor_id', 'created_at']);
            $table->index(['shop_id', 'status']);
            $table->index('item_id');
        });

        DB::statement('ALTER TABLE donations ADD CONSTRAINT donations_qty_check CHECK (qty BETWEEN 1 AND 20)');
        DB::statement('ALTER TABLE donations ADD CONSTRAINT donations_amount_minor_check CHECK (amount_minor > 0)');
        DB::statement('ALTER TABLE donations ADD CONSTRAINT donations_commission_minor_check CHECK (commission_minor >= 0 AND commission_minor <= amount_minor)');
        DB::statement("ALTER TABLE donations ADD CONSTRAINT donations_currency_check CHECK (currency = 'TRY')");
        DB::statement("ALTER TABLE donations ADD CONSTRAINT donations_status_check CHECK (status IN ('initiated', 'paid', 'failed', 'refunded'))");
        DB::statement("ALTER TABLE donations ADD CONSTRAINT donations_paid_at_check CHECK (status NOT IN ('paid', 'refunded') OR paid_at IS NOT NULL)");
        DB::statement('ALTER TABLE donations ADD CONSTRAINT donations_anonymized_check CHECK (anonymized_at IS NULL OR donor_id IS NULL)');
        DB::statement('CREATE UNIQUE INDEX donations_provider_payment_unique ON donations (provider, provider_payment_id) WHERE provider_payment_id IS NOT NULL');
    }

    public function down(): void
    {
        Schema::dropIfExists('donations');
    }
};
