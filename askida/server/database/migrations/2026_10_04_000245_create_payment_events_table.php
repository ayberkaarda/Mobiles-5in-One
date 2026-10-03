<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Provider webhook deliveries. The unique (provider, event_id) pair makes processing
 * idempotent; only a hash of the payload is kept.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('payment_events', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('provider', 32);
            $table->string('event_id', 191);
            $table->char('payload_hash', 64);
            $table->timestampTz('received_at');
            $table->timestampTz('processed_at')->nullable();
            $table->timestampsTz();

            $table->unique(['provider', 'event_id']);
            $table->index('processed_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('payment_events');
    }
};
