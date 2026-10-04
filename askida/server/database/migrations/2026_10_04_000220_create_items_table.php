<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('items', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('shop_id')->constrained('shops')->cascadeOnDelete();
            $table->string('name', 120);
            $table->string('category', 16);
            $table->bigInteger('price_minor');
            $table->char('currency', 3)->default('TRY');
            $table->unsignedInteger('daily_cap');
            $table->boolean('active')->default(true);
            $table->timestampsTz();

            $table->index(['shop_id', 'active']);
        });

        DB::statement("ALTER TABLE items ADD CONSTRAINT items_category_check CHECK (category IN ('ekmek', 'corba', 'yemek', 'kirtasiye', 'bebek', 'diger'))");
        DB::statement('ALTER TABLE items ADD CONSTRAINT items_price_minor_check CHECK (price_minor BETWEEN 100 AND 1000000)');
        DB::statement("ALTER TABLE items ADD CONSTRAINT items_currency_check CHECK (currency = 'TRY')");
        DB::statement('ALTER TABLE items ADD CONSTRAINT items_daily_cap_check CHECK (daily_cap > 0)');
    }

    public function down(): void
    {
        Schema::dropIfExists('items');
    }
};
