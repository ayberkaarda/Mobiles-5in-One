<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('shop_members', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('shop_id')->constrained('shops')->cascadeOnDelete();
            $table->foreignUuid('user_id')->constrained('users')->cascadeOnDelete();
            $table->string('role', 16);
            $table->timestampsTz();

            $table->unique(['shop_id', 'user_id']);
            $table->index('user_id');
        });

        DB::statement("ALTER TABLE shop_members ADD CONSTRAINT shop_members_role_check CHECK (role IN ('owner', 'staff'))");
    }

    public function down(): void
    {
        Schema::dropIfExists('shop_members');
    }
};
