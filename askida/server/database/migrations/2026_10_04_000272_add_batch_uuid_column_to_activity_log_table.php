<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * spatie/laravel-activitylog: batch uuid column (published migration).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::connection($this->connectionName())->table($this->tableName(), function (Blueprint $table) {
            $table->uuid('batch_uuid')->nullable()->after('properties');
        });
    }

    public function down(): void
    {
        Schema::connection($this->connectionName())->table($this->tableName(), function (Blueprint $table) {
            $table->dropColumn('batch_uuid');
        });
    }

    private function connectionName(): ?string
    {
        $connection = config('activitylog.database_connection');

        return is_string($connection) ? $connection : null;
    }

    private function tableName(): string
    {
        return (string) config('activitylog.table_name', 'activity_log');
    }
};
