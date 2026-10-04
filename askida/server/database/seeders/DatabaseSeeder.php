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
     * local and testing environments; elsewhere only the admin roles are written.
     */
    public function run(): void
    {
        // Admin roles and permissions exist in every environment.
        $this->call(RolesSeeder::class);

        if (app()->environment(SampleDataSeeder::ALLOWED_ENVIRONMENTS)) {
            $this->call(SampleDataSeeder::class);

            return;
        }

        $this->command->warn('Sample data skipped outside the local and testing environments.');
    }
}
