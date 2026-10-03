<?php

use App\Domain\Auth\Enums\IdentityProvider;
use App\Mail\EmailVerificationCodeMail;
use App\Mail\PasswordResetCodeMail;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Log\Events\MessageLogged;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use Tests\Feature\Api\Auth\Support\AuthTestKit;
use Tests\Unit\Auth\Support\IdentityTokenFactory;

uses(RefreshDatabase::class);

it('never writes a password or a mailed code to the log during the auth flows', function (): void {
    AuthTestKit::boot(cleanBreachService: false);
    // Unreachable breach service: the fail-open warning is part of what gets logged.
    Http::fake(['api.pwnedpasswords.com/*' => fn () => throw new ConnectionException('unreachable')]);

    $log = '';
    Event::listen(MessageLogged::class, function (MessageLogged $event) use (&$log): void {
        $log .= $event->level.' '.$event->message.' '.json_encode($event->context)."\n";
    });

    $payload = AuthTestKit::registerPayload();
    $this->postJson('/api/v1/auth/register', $payload)->assertCreated();

    $verifyCode = '';
    Mail::assertQueued(EmailVerificationCodeMail::class, function (EmailVerificationCodeMail $mail) use (&$verifyCode): bool {
        $verifyCode = $mail->code;

        return true;
    });

    $wrongPassword = 'wrong-'.AuthTestKit::password();
    $this->postJson('/api/v1/auth/login', ['email' => $payload['email'], 'password' => $wrongPassword, 'device_name' => 'd', 'platform' => 'ios'])
        ->assertUnauthorized();
    $this->postJson('/api/v1/auth/verify-email', ['email' => $payload['email'], 'code' => $verifyCode])->assertOk();
    $this->postJson('/api/v1/auth/forgot', ['email' => $payload['email']])->assertStatus(202);

    $resetCode = '';
    Mail::assertQueued(PasswordResetCodeMail::class, function (PasswordResetCodeMail $mail) use (&$resetCode): bool {
        $resetCode = $mail->code;

        return true;
    });

    AuthTestKit::resetLimits();
    $newPassword = AuthTestKit::password();
    $this->postJson('/api/v1/auth/reset', ['email' => $payload['email'], 'code' => $resetCode, 'password' => $newPassword])
        ->assertNoContent();

    expect($log)->toContain('Breached password check unavailable')
        ->and($log)->not->toContain($payload['password'])
        ->and($log)->not->toContain($wrongPassword)
        ->and($log)->not->toContain($newPassword)
        ->and($log)->not->toContain($verifyCode)
        ->and($log)->not->toContain($resetCode);
});

it('never returns passwords, hashes or provider subjects in any auth response', function (): void {
    AuthTestKit::boot();
    $idp = new IdentityTokenFactory;
    $idp->install();

    $payload = AuthTestKit::registerPayload();
    $responses = [];
    $responses[] = $this->postJson('/api/v1/auth/register', $payload);
    $responses[] = $this->postJson('/api/v1/auth/login', [
        'email' => $payload['email'], 'password' => $payload['password'], 'device_name' => 'd2', 'platform' => 'ios',
    ]);

    // A verified account keeps its password and tokens when Google is linked.
    User::query()->where('email', $payload['email'])->update(['email_verified_at' => now()]);

    $sub = 'google-'.bin2hex(random_bytes(5));
    $nonce = IdentityTokenFactory::nonce();
    $responses[] = $this->postJson('/api/v1/auth/google', [
        'id_token' => $idp->sign(IdentityTokenFactory::claims(IdentityProvider::Google, $nonce, ['sub' => $sub, 'email' => $payload['email']])),
        'nonce' => $nonce,
        'device_name' => 'd3',
        'platform' => 'android',
    ]);

    $token = $responses[0]->json('token');
    AuthTestKit::forgetGuards();
    $responses[] = $this->withToken($token)->getJson('/api/v1/me');
    AuthTestKit::forgetGuards();
    $responses[] = $this->withToken($token)->patchJson('/api/v1/me', ['name' => 'Yeni']);

    $hash = (string) User::query()->where('email', $payload['email'])->value('password');

    foreach ($responses as $response) {
        expect($response->status())->toBeLessThan(300);
        $content = (string) $response->getContent();

        expect($content)->not->toContain($payload['password'])
            ->not->toContain($hash)
            ->not->toContain($sub)
            ->not->toContain('"password"')
            ->not->toContain('apple_sub')
            ->not->toContain('google_sub');
    }

    expect(DB::table('users')->where('google_sub', $sub)->count())->toBe(1);
});
