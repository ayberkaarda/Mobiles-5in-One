<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * A document row is created when the upload URL is issued; `uploaded_at` is set only
     * after the stored object passed the server-side checks. Rows without it are pending.
     */
    public function up(): void
    {
        Schema::table('shop_documents', function (Blueprint $table) {
            $table->timestampTz('uploaded_at')->nullable();
            $table->index(['shop_id', 'uploaded_at']);
        });
    }

    public function down(): void
    {
        Schema::table('shop_documents', function (Blueprint $table) {
            $table->dropIndex(['shop_id', 'uploaded_at']);
            $table->dropColumn('uploaded_at');
        });
    }
};
