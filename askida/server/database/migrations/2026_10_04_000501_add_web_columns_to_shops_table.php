<?php

use App\Support\Web\TurkishSlug;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Public web directory columns of shops: URL slugs of the province and district
 * (`/dukkanlar/{il}/{ilce}`), kept in sync with `il` / `ilce` by the Shop model, and the
 * weekly opening hours (`{mon..sun: {open: "08:00", close: "20:00"} | null}`).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('shops', function (Blueprint $table) {
            $table->string('il_slug', 64)->default('');
            $table->string('ilce_slug', 64)->default('');
            $table->jsonb('opening_hours')->nullable();
        });

        DB::table('shops')->select(['id', 'il', 'ilce'])->orderBy('id')->chunk(500, function ($shops): void {
            foreach ($shops as $shop) {
                DB::table('shops')->where('id', $shop->id)->update([
                    'il_slug' => mb_substr(TurkishSlug::make((string) $shop->il), 0, 64),
                    'ilce_slug' => mb_substr(TurkishSlug::make((string) $shop->ilce), 0, 64),
                ]);
            }
        });

        DB::statement('ALTER TABLE shops ALTER COLUMN il_slug DROP DEFAULT');
        DB::statement('ALTER TABLE shops ALTER COLUMN ilce_slug DROP DEFAULT');

        Schema::table('shops', function (Blueprint $table) {
            $table->index('il_slug');
            $table->index(['il_slug', 'ilce_slug']);
        });
    }

    public function down(): void
    {
        Schema::table('shops', function (Blueprint $table) {
            $table->dropIndex(['il_slug', 'ilce_slug']);
            $table->dropIndex(['il_slug']);
            $table->dropColumn(['il_slug', 'ilce_slug', 'opening_hours']);
        });
    }
};
