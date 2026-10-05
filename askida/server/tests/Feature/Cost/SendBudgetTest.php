<?php

use App\Domain\Anon\Models\DevicePlatform;
use App\Domain\Auth\Models\DevicePushToken;
use App\Domain\Cost\Channel;
use App\Domain\Cost\Contracts\NonCriticalMail;
use App\Domain\Cost\Jobs\GuardDailySends;
use App\Domain\Cost\SendBudget;
use App\Domain\Cost\SendKind;
use App\Domain\Push\Contracts\PushTransport;
use App\Domain\Push\Jobs\SendPush;
use App\Domain\Push\PushMessage;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Cache\RateLimiter;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Mail\Mailable;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;

/*
| Daily send budget (security item 22): counters in Redis day keys, caps from
| askida.cost.*, critical sends never paused, one finance alert per day and channel,
| the next day starts clean. Every test runs on its own far-future day, so the shared
| Redis keys of one test can never leak into another.
*/

uses(RefreshDatabase::class);

final class CostTestNonCriticalMail extends Mailable implements NonCriticalMail
{
    public function build(): self
    {
        return $this->subject('non critical')->html('<p>non critical</p>');
    }
}

final class CostTestCriticalMail extends Mailable
{
    public function build(): self
    {
        return $this->subject('critical')->html('<p>critical</p>');
    }
}

/** Messages the array mailer has accepted so far in this test. */
function costDeliveredSubjects(): array
{
    $messages = Mail::mailer('array')->getSymfonyTransport()->messages();

    return $messages->map(fn ($m) => $m->getOriginalMessage()->getSubject())->values()->all();
}

function costFinanceAlerts(): int
{
    return count(array_filter(costDeliveredSubjects(), fn (string $s) => str_contains($s, 'daily cap reached')));
}

function costPushUser(int $devices): User
{
    $user = User::factory()->create();

    foreach (range(1, $devices) as $n) {
        DevicePushToken::factory()->create(['user_id' => $user->id, 'platform' => DevicePlatform::Android]);
    }

    return $user;
}

beforeEach(function (): void {
    $this->travelTo(CarbonImmutable::create(2040, 1, 1, 12, 0, 0, 'Europe/Istanbul')->addDays(random_int(1, 9000)));
    config([
        'askida.cost.daily_email_cap' => 3,
        'askida.cost.daily_push_cap' => 2,
        'payments.finance_alert_email' => 'finance@example.test',
    ]);
    $this->budget = app(SendBudget::class);
    $this->transport = new class implements PushTransport
    {
        /** @var list<string> */
        public array $tokens = [];

        public function send(DevicePlatform $platform, string $token, PushMessage $message): void
        {
            $this->tokens[] = $token;
        }
    };
});

it('allows non-critical sends below the cap and refuses them at the cap, critical ones never stop', function (): void {
    expect($this->budget->allows(SendKind::EmailNonCritical))->toBeTrue();

    foreach (range(1, 3) as $n) {
        expect($this->budget->record(SendKind::EmailNonCritical))->toBe($n);
    }

    expect($this->budget->sent(Channel::Email))->toBe(3)
        ->and($this->budget->allows(SendKind::EmailNonCritical))->toBeFalse()
        ->and($this->budget->allows(SendKind::EmailCritical))->toBeTrue()
        ->and($this->budget->allows(SendKind::PushNonCritical))->toBeTrue('the push channel has its own counter');
});

it('counts a whole day on the Istanbul clock and starts clean the next day', function (): void {
    foreach (range(1, 3) as $n) {
        $this->budget->record(SendKind::EmailCritical);
    }
    (new GuardDailySends)->handle($this->budget);
    expect($this->budget->isPaused(Channel::Email))->toBeTrue()
        ->and($this->budget->allows(SendKind::EmailNonCritical))->toBeFalse();

    $today = $this->budget->day();
    $this->travel(1)->days();

    expect($this->budget->day())->not->toBe($today)
        ->and($this->budget->sent(Channel::Email))->toBe(0)
        ->and($this->budget->isPaused(Channel::Email))->toBeFalse()
        ->and($this->budget->allows(SendKind::EmailNonCritical))->toBeTrue();
});

it('pauses the channel at the cap and sends exactly one finance alert per day, however often it runs', function (): void {
    foreach (range(1, 3) as $n) {
        $this->budget->record(SendKind::EmailCritical);
    }
    $before = count(costDeliveredSubjects());

    (new GuardDailySends)->handle($this->budget);
    (new GuardDailySends)->handle($this->budget);
    (new GuardDailySends)->handle($this->budget);

    expect(costFinanceAlerts())->toBe(1)
        ->and(count(costDeliveredSubjects()) - $before)->toBe(1);

    $message = Mail::mailer('array')->getSymfonyTransport()->messages()->last()->getOriginalMessage();
    expect($message->getTo()[0]->getAddress())->toBe('finance@example.test')
        ->and($message->getTextBody())->toContain('sent: 3')->toContain('cap: 3');

    // The next day alerts again, once.
    $this->travel(1)->days();
    foreach (range(1, 3) as $n) {
        $this->budget->record(SendKind::EmailCritical);
    }
    (new GuardDailySends)->handle($this->budget);
    (new GuardDailySends)->handle($this->budget);
    expect(costFinanceAlerts())->toBe(2);
});

it('does nothing below the cap', function (): void {
    $this->budget->record(SendKind::EmailCritical);
    $this->budget->record(SendKind::PushNonCritical);

    (new GuardDailySends)->handle($this->budget);

    expect($this->budget->isPaused(Channel::Email))->toBeFalse()
        ->and($this->budget->isPaused(Channel::Push))->toBeFalse()
        ->and(costFinanceAlerts())->toBe(0);
});

it('alerts once per kind: reaching the push cap does not reuse the e-mail alert', function (): void {
    foreach (range(1, 3) as $n) {
        $this->budget->record(SendKind::EmailCritical);
    }
    foreach (range(1, 2) as $n) {
        $this->budget->record(SendKind::PushNonCritical);
    }

    (new GuardDailySends)->handle($this->budget);

    $subjects = costDeliveredSubjects();
    expect(costFinanceAlerts())->toBe(2)
        ->and(implode('|', $subjects))->toContain('günlük email limiti')->toContain('günlük push limiti');
});

it('drops a non-critical mail at the cap while critical mail and the finance alert still go out', function (): void {
    Log::spy();

    Mail::to('a@example.test')->send(new CostTestNonCriticalMail);
    Mail::to('a@example.test')->send(new CostTestCriticalMail);
    Mail::to('a@example.test')->send(new CostTestCriticalMail);
    expect($this->budget->sent(Channel::Email))->toBe(3);

    // Cap reached: the non-critical mail is cancelled, not counted, not delivered.
    Mail::to('a@example.test')->send(new CostTestNonCriticalMail);
    expect($this->budget->sent(Channel::Email))->toBe(3)
        ->and(costDeliveredSubjects())->toBe(['non critical', 'critical', 'critical']);
    Log::shouldHaveReceived('warning')->with('cost.mail_dropped', ['kind' => 'email.non_critical'])->once();

    // Critical mail is still sent and counted, and so is the finance alert from the guard.
    Mail::to('a@example.test')->send(new CostTestCriticalMail);
    (new GuardDailySends)->handle($this->budget);

    expect($this->budget->sent(Channel::Email))->toBe(5)
        ->and(costDeliveredSubjects())->toHaveCount(5)
        ->and(costFinanceAlerts())->toBe(1);

    // Next day: non-critical mail flows again.
    $this->travel(1)->days();
    Mail::to('a@example.test')->send(new CostTestNonCriticalMail);
    expect(array_count_values(costDeliveredSubjects())['non critical'])->toBe(2);
});

it('drops non-critical pushes at the cap with a log line and resumes the next day', function (): void {
    Log::spy();
    $user = costPushUser(3);
    $limiter = app(RateLimiter::class);

    (new SendPush($user->id, new PushMessage('Yeni askı', 'metin')))->handle($this->transport, $limiter, $this->budget);

    // Two of the three devices were served; the third was dropped by the daily cap.
    expect($this->transport->tokens)->toHaveCount(2)
        ->and($this->budget->sent(Channel::Push))->toBe(2);
    Log::shouldHaveReceived('warning')->with('cost.push_dropped', ['kind' => 'push.non_critical'])->once();

    (new SendPush($user->id, new PushMessage('Yeni askı', 'metin')))->handle($this->transport, $limiter, $this->budget);
    expect($this->transport->tokens)->toHaveCount(2);

    $this->travel(1)->days();
    (new SendPush($user->id, new PushMessage('Yeni askı', 'metin')))->handle($this->transport, $limiter, $this->budget);
    expect($this->transport->tokens)->toHaveCount(4);
});

it('ships positive default caps and the Istanbul day', function (): void {
    $config = require base_path('config/askida.php');

    expect($config['cost']['daily_email_cap'])->toBeInt()->toBeGreaterThan(0)
        ->and($config['cost']['daily_push_cap'])->toBeInt()->toBeGreaterThan(0)
        ->and($config['cost']['timezone'])->toBe('Europe/Istanbul');
});

it('skips the alert mail but still pauses when no finance address is configured', function (): void {
    config(['payments.finance_alert_email' => '']);
    Log::spy();
    foreach (range(1, 3) as $n) {
        $this->budget->record(SendKind::EmailCritical);
    }

    (new GuardDailySends)->handle($this->budget);

    expect($this->budget->isPaused(Channel::Email))->toBeTrue()
        ->and(costFinanceAlerts())->toBe(0);
    Log::shouldHaveReceived('warning')->with('cost.alert_without_recipient', ['channel' => 'email'])->once();
});
