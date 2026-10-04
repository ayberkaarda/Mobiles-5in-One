<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('shop_documents', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('shop_id')->constrained('shops')->cascadeOnDelete();
            $table->string('kind', 32);
            // Object key on the private disk; never a public URL.
            $table->string('path', 512);
            $table->string('mime', 64);
            $table->unsignedInteger('size');
            $table->timestampTz('reviewed_at')->nullable();
            $table->timestampsTz();

            $table->index('shop_id');
        });

        DB::statement("ALTER TABLE shop_documents ADD CONSTRAINT shop_documents_kind_check CHECK (kind IN ('tax_certificate', 'business_license', 'other'))");
        DB::statement("ALTER TABLE shop_documents ADD CONSTRAINT shop_documents_mime_check CHECK (mime IN ('application/pdf', 'image/jpeg', 'image/png'))");
        DB::statement('ALTER TABLE shop_documents ADD CONSTRAINT shop_documents_size_check CHECK (size > 0 AND size <= 5242880)');
    }

    public function down(): void
    {
        Schema::dropIfExists('shop_documents');
    }
};
