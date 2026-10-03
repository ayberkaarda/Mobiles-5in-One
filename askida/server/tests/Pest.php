<?php

use Tests\TestCase;

/*
|--------------------------------------------------------------------------
| Test case binding
|--------------------------------------------------------------------------
|
| Feature tests boot the full application against the real PostgreSQL
| (PostGIS) and Redis services of the docker-compose stack or CI.
|
*/

pest()->extend(TestCase::class)->in('Feature', 'Unit', 'Security');
