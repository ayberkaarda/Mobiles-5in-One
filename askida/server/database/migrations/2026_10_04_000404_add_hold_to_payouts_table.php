<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * A fraud hold on a payout. Setting and releasing it is a finance action with a reason.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('payouts', function (Blueprint $table) {
            $table->boolean('hold')->default(false);
            $table->string('hold_reason', 191)->nullable();
        });

        DB::statement('CREATE INDEX payouts_hold_index ON payouts (shop_id) WHERE hold');
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS payouts_hold_index');

        Schema::table('payouts', function (Blueprint $table) {
            $table->dropColumn(['hold', 'hold_reason']);
        });
    }
};
