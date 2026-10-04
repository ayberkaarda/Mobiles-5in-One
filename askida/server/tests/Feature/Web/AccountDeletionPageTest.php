<?php

use App\Domain\Accounts\Mail\AccountDeletionRequestedMail;
use App\Domain\Auth\Models\DeletionRequest;
use App\Domain\Hooks\Models\HookStatus;
use App\Models\User;
use Database\Factories\UserFactory;
use Illuminate\Foundation\Http\Middleware\PreventRequestForgery;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Illuminate\Testing\TestResponse;
use Tests\Feature\Api\Accounts\Support\AccountsWorld;
use Tests\Feature\Api\Auth\Support\AuthTestKit;

uses(RefreshDatabase::class);

beforeEach(function (): void {
    AuthTestKit::boot();
    AuthTestKit::resetLimits();
});

/**
 * The page body with the per-request nonce and CSRF token taken out, so two answers can
 * be compared for their shape.
 */
function deletionPageShape(TestResponse $response): string
{
    return (string) preg_replace(
        ['/nonce="[^"]*"/', '/name="_token"[^>]*value="[^"]*"/', '/value="[^"]*"([^>]*name="_token")/'],
        ['nonce=""', 'name="_token" value=""', 'value=""$1'],
        (string) $response->getContent(),
    );
}

it('renders the page in Turkish with a nonce on every style block and no script', function (): void {
    $response = $this->get('/hesap-silme');

    $response->assertOk()
        ->assertSee('Hesabını sil')
        ->assertSee('7 gün içinde yeniden giriş yaparsan')
        ->assertSee('Esnaf hesapları')
        ->assertSee('askıda bekleyen ya da ayrılmış ürün varsa hesap silinemez')
        ->assertSee('Apple veya Google ile giriş yaptıysan')
        ->assertSee('name="_token"', false);

    $csp = (string) $response->headers->get('Content-Security-Policy');
    expect(preg_match("/style-src [^;]*'nonce-([A-Za-z0-9+\\/=]+)'/", $csp, $match))->toBe(1)
        ->and($csp)->toContain("form-action 'self'")
        ->and($csp)->toContain("object-src 'none'")
        ->and($csp)->not->toContain('unsafe-inline');

    $html = (string) $response->getContent();
    preg_match_all('/<style\b[^>]*>/', $html, $styles);
    preg_match_all('/<script\b[^>]*>/', $html, $scripts);

    expect($styles[0])->not->toBeEmpty()
        ->and($html)->not->toContain('style="')
        ->and($html)->not->toMatch('/\son[a-z]+=/i');

    foreach ($styles[0] as $tag) {
        expect($tag)->toContain('nonce="'.$match[1].'"');
    }

    foreach ($scripts[0] as $tag) {
        expect($tag)->toContain('nonce="'.$match[1].'"');
    }
});

it('rejects a post without a CSRF token', function (): void {
    $this->app->bind(PreventRequestForgery::class, fn ($app) => new class($app, $app['encrypter']) extends PreventRequestForgery
    {
        protected function runningUnitTests()
        {
            return false;
        }
    });
    $user = User::factory()->create();

    $this->post('/hesap-silme', ['email' => $user->email, 'password' => UserFactory::PASSWORD])->assertStatus(419);
    expect($user->fresh()?->deactivated_at)->toBeNull();

    $this->withSession(['_token' => 'csrf-page-check'])
        ->post('/hesap-silme', ['_token' => 'csrf-page-check', 'email' => $user->email, 'password' => UserFactory::PASSWORD])
        ->assertOk();
    expect($user->fresh()?->deactivated_at)->not->toBeNull();
});

it('deactivates a password account and confirms by mail', function (): void {
    $user = User::factory()->create();
    AuthTestKit::token($user);

    $this->post('/hesap-silme', ['email' => '  '.strtoupper($user->email).' ', 'password' => UserFactory::PASSWORD])
        ->assertOk()
        ->assertSee('Silme talebin alındı')
        ->assertDontSee('<form', false);

    $deletion = DeletionRequest::query()->sole();
    expect($user->fresh()?->deactivated_at)->not->toBeNull()
        ->and($user->tokens()->count())->toBe(0)
        ->and($deletion->channel->value)->toBe('web')
        ->and($deletion->user_id)->toBe($user->id);
    Mail::assertQueued(AccountDeletionRequestedMail::class, fn (AccountDeletionRequestedMail $mail): bool => $mail->hasTo($user->email));
});

it('refuses a wrong password without closing the account', function (): void {
    $user = User::factory()->create();

    $this->post('/hesap-silme', ['email' => $user->email, 'password' => 'wrong-'.bin2hex(random_bytes(4))])
        ->assertStatus(422)
        ->assertSee('E-posta adresi veya şifre hatalı');

    expect($user->fresh()?->deactivated_at)->toBeNull()
        ->and(DeletionRequest::query()->count())->toBe(0);
    Mail::assertNothingQueued();
});

it('explains the merchant restriction when a shop has open units', function (): void {
    $merchant = User::factory()->merchant()->create();
    $shop = AccountsWorld::shop($merchant);
    AccountsWorld::hook(AccountsWorld::donation(null, AccountsWorld::item($shop)), HookStatus::Available);

    $this->post('/hesap-silme', ['email' => $merchant->email, 'password' => UserFactory::PASSWORD])
        ->assertStatus(409)
        ->assertSee('Hesabın şu an silinemiyor')
        ->assertSee('henüz kullanılmamış ürünler var');

    expect($merchant->fresh()?->deactivated_at)->toBeNull()
        ->and(DeletionRequest::query()->count())->toBe(0);
});

it('answers unknown, wrong, provider-only, closed and malformed input with the same page', function (): void {
    $known = User::factory()->create();
    $appleOnly = User::factory()->appleOnly()->create();
    $closed = User::factory()->deactivated()->create();

    $attempts = [
        ['email' => 'nobody-'.bin2hex(random_bytes(3)).'@example.test', 'password' => UserFactory::PASSWORD],
        ['email' => $known->email, 'password' => 'wrong-'.bin2hex(random_bytes(4))],
        ['email' => $appleOnly->email, 'password' => UserFactory::PASSWORD],
        ['email' => $closed->email, 'password' => UserFactory::PASSWORD],
        ['email' => 'not-an-email', 'password' => UserFactory::PASSWORD],
    ];

    $shapes = [];

    foreach ($attempts as $attempt) {
        AuthTestKit::resetLimits();
        $response = $this->post('/hesap-silme', $attempt);
        $response->assertStatus(422);
        $shapes[] = deletionPageShape($response);
    }

    expect(array_unique($shapes))->toHaveCount(1)
        ->and($shapes[0])->not->toContain($known->email)
        ->and(DeletionRequest::query()->count())->toBe(0);
});

it('limits attempts with the sign-in limiter', function (): void {
    $user = User::factory()->create();

    for ($i = 0; $i < 5; $i++) {
        $this->post('/hesap-silme', ['email' => $user->email, 'password' => 'wrong-'.$i.bin2hex(random_bytes(3))])->assertStatus(422);
    }

    $this->post('/hesap-silme', ['email' => $user->email, 'password' => UserFactory::PASSWORD])
        ->assertStatus(429)
        ->assertHeader('Retry-After');

    expect($user->fresh()?->deactivated_at)->toBeNull();
});
