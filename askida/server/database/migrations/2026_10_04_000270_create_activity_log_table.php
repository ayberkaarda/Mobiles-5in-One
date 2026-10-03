<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * spatie/laravel-activitylog table (published migration). Subjects and causers have UUID
 * keys, so the polymorphic columns are UUID morphs. The log row id stays a big integer
 * because the package Activity model expects an incrementing key.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::connection($this->connectionName())->create($this->tableName(), function (Blueprint $table) {
            $table->bigIncrements('id');
            $table->string('log_name')->nullable();
            $table->text('description');
            $table->nullableUuidMorphs('subject', 'subject');
            $table->nullableUuidMorphs('causer', 'causer');
            $table->json('properties')->nullable();
            $table->timestamps();
            $table->index('log_name');
        });
    }

    public function down(): void
    {
        Schema::connection($this->connectionName())->dropIfExists($this->tableName());
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
