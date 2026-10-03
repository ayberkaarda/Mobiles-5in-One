<?php

namespace Database\Seeders;

use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    use WithoutModelEvents;

    /**
     * Seed the application's database.
     *
     * Sample data (is_sample = true, names prefixed with [ÖRNEK]) is written only in the
     * local and testing environments; elsewhere this seeder writes nothing.
     */
    public function run(): void
    {
        if (app()->environment(SampleDataSeeder::ALLOWED_ENVIRONMENTS)) {
            $this->call(SampleDataSeeder::class);

            return;
        }

        $this->command->warn('Sample data skipped outside the local and testing environments.');
    }
}
