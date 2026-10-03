<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Account deletion requests (immediate deactivation, 7-day grace, then hard delete of
 * personal data). The row holds no personal data and survives the user as an audit
 * record with user_id = NULL.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('deletion_requests', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('channel', 8);
            $table->string('status', 16)->default('pending');
            $table->timestampTz('requested_at');
            $table->timestampTz('grace_until');
            $table->timestampTz('completed_at')->nullable();
            $table->timestampTz('cancelled_at')->nullable();
            $table->timestampsTz();

            $table->index('user_id');
        });

        DB::statement("ALTER TABLE deletion_requests ADD CONSTRAINT deletion_requests_channel_check CHECK (channel IN ('app', 'web'))");
        DB::statement("ALTER TABLE deletion_requests ADD CONSTRAINT deletion_requests_status_check CHECK (status IN ('pending', 'completed', 'cancelled'))");
        DB::statement('ALTER TABLE deletion_requests ADD CONSTRAINT deletion_requests_grace_check CHECK (grace_until >= requested_at)');
        DB::statement("CREATE INDEX deletion_requests_due_index ON deletion_requests (grace_until) WHERE status = 'pending'");
    }

    public function down(): void
    {
        Schema::dropIfExists('deletion_requests');
    }
};
