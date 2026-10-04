<?php

use App\Domain\Push\Jobs\SendPush;
use App\Domain\Push\PushMessage;
use Illuminate\Support\Str;

/*
| Every queue the application dispatches to must be consumed by a Horizon supervisor
| in every environment, or its jobs wait forever outside the test suite.
*/

/**
 * Queues consumed per environment, read from the configuration file itself (defaults
 * merged with the environment overrides the way Horizon merges them).
 *
 * @return array<string, list<string>>
 */
function horizonQueuesByEnvironment(): array
{
    /** @var array{defaults: array<string, array<string, mixed>>, environments: array<string, array<string, array<string, mixed>>>} $config */
    $config = require base_path('config/horizon.php');
    $result = [];

    foreach ($config['environments'] as $environment => $supervisors) {
        $queues = [];

        foreach (array_replace_recursive($config['defaults'], $supervisors) as $supervisor) {
            $connection = $supervisor['connection'] ?? null;
            $names = $supervisor['queue'] ?? [];

            if ($connection === 'redis' && is_array($names)) {
                $queues = array_merge($queues, array_values(array_filter($names, 'is_string')));
            }
        }

        $result[$environment] = array_values(array_unique($queues));
    }

    return $result;
}

it('consumes the default, push and payments queues in every environment', function (): void {
    $environments = horizonQueuesByEnvironment();

    expect($environments)->toHaveKeys(['production', 'local']);

    foreach ($environments as $environment => $queues) {
        foreach (['default', 'push', 'payments'] as $queue) {
            expect(in_array($queue, $queues, true))->toBeTrue("{$environment} does not consume {$queue}");
        }
    }
});

it('consumes the queue the push job is dispatched to', function (): void {
    $job = new SendPush((string) Str::uuid7(), new PushMessage('Başlık', 'Metin'));

    expect($job->queue)->toBe(config('askida.push.queue'));

    foreach (horizonQueuesByEnvironment() as $queues) {
        expect($queues)->toContain($job->queue);
    }
});
