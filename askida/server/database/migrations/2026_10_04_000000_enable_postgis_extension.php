<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * Shop locations are stored as PostGIS geography values.
     */
    public function up(): void
    {
        DB::statement('CREATE EXTENSION IF NOT EXISTS postgis');
    }

    /**
     * The extension is left in place: dropping it would destroy spatial data.
     */
    public function down(): void
    {
        //
    }
};
