<?php

use App\Domain\Auth\Contracts\IdentityTokenVerifier;
use App\Domain\Auth\Enums\IdentityProvider;
use App\Domain\Auth\Identity\InvalidIdentityToken;
use App\Domain\Auth\Identity\JwksIdentityTokenVerifier;
use App\Support\Problem\ProblemException;
use Illuminate\Support\Facades\Http;
use Tests\Unit\Auth\Support\IdentityTokenFactory;

beforeEach(function (): void {
    Http::preventStrayRequests();
    $this->idp = new IdentityTokenFactory;
    $this->idp->install();
    $this->verifier = app(IdentityTokenVerifier::class);
    $this->nonce = IdentityTokenFactory::nonce();
});

/**
 * Asserts that verification fails with the given internal reason.
 */
function expectRejected(callable $verify, string $reason): void
{
    try {
        $verify();
    } catch (InvalidIdentityToken $e) {
        expect($e->getMessage())->toBe($reason)
            ->and($e->status)->toBe(401)
            ->and($e->render()->getData(true)['code'])->toBe('auth.token_invalid');

        return;
    }

    throw new RuntimeException('The token was accepted.');
}

it('is the container binding of the verifier contract', function (): void {
    expect($this->verifier)->toBeInstanceOf(JwksIdentityTokenVerifier::class);
});

it('accepts a valid Google token', function (): void {
    $claims = IdentityTokenFactory::claims(IdentityProvider::Google, $this->nonce, ['email' => 'Mixed@Example.test', 'name' => 'Ali Veli']);

    $identity = $this->verifier->verify(IdentityProvider::Google, $this->idp->sign($claims), $this->nonce);

    expect($identity->sub)->toBe($claims['sub'])
        ->and($identity->email)->toBe('mixed@example.test')
        ->and($identity->emailVerified)->toBeTrue()
        ->and($identity->name)->toBe('Ali Veli');
});

it('accepts a valid Apple token with the hashed nonce and a string email_verified', function (): void {
    $claims = IdentityTokenFactory::claims(IdentityProvider::Apple, $this->nonce, ['email_verified' => 'true']);

    $identity = $this->verifier->verify(IdentityProvider::Apple, $this->idp->sign($claims), $this->nonce);

    expect($identity->emailVerified)->toBeTrue();
});

it('accepts an audience list that contains the client id', function (): void {
    $claims = IdentityTokenFactory::claims(IdentityProvider::Google, $this->nonce, ['aud' => ['other', IdentityTokenFactory::CLIENT_ID_GOOGLE]]);

    expect($this->verifier->verify(IdentityProvider::Google, $this->idp->sign($claims), $this->nonce)->sub)->toBe($claims['sub']);
});

it('reports an unverified email as unverified', function (): void {
    $claims = IdentityTokenFactory::claims(IdentityProvider::Google, $this->nonce, ['email_verified' => false]);

    expect($this->verifier->verify(IdentityProvider::Google, $this->idp->sign($claims), $this->nonce)->emailVerified)->toBeFalse();
});

it('rejects a token for another audience', function (): void {
    $token = $this->idp->sign(IdentityTokenFactory::claims(IdentityProvider::Google, $this->nonce, ['aud' => 'another-app']));

    expectRejected(fn () => $this->verifier->verify(IdentityProvider::Google, $token, $this->nonce), 'wrong_audience');
});

it('rejects every token when no client id is configured', function (): void {
    config(['services.google.client_id' => []]);
    $token = $this->idp->sign(IdentityTokenFactory::claims(IdentityProvider::Google, $this->nonce));

    expectRejected(fn () => $this->verifier->verify(IdentityProvider::Google, $token, $this->nonce), 'wrong_audience');
});

it('rejects a token from another issuer', function (): void {
    $token = $this->idp->sign(IdentityTokenFactory::claims(IdentityProvider::Google, $this->nonce, ['iss' => 'https://issuer.example']));

    expectRejected(fn () => $this->verifier->verify(IdentityProvider::Google, $token, $this->nonce), 'wrong_issuer');
});

it('rejects a Google token presented as an Apple token', function (): void {
    $token = $this->idp->sign(IdentityTokenFactory::claims(IdentityProvider::Google, $this->nonce));

    expectRejected(fn () => $this->verifier->verify(IdentityProvider::Apple, $token, $this->nonce), 'wrong_issuer');
});

it('rejects an expired token', function (): void {
    $past = now()->subHour()->getTimestamp();
    $token = $this->idp->sign(IdentityTokenFactory::claims(IdentityProvider::Google, $this->nonce, ['iat' => $past - 600, 'exp' => $past]));

    expectRejected(fn () => $this->verifier->verify(IdentityProvider::Google, $token, $this->nonce), 'expired');
});

it('rejects a token that expires while time passes', function (): void {
    $token = $this->idp->sign(IdentityTokenFactory::claims(IdentityProvider::Google, $this->nonce));

    $this->travel(15)->minutes();

    expectRejected(fn () => $this->verifier->verify(IdentityProvider::Google, $token, $this->nonce), 'expired');
});

it('rejects a token without an expiry', function (): void {
    $token = $this->idp->sign(IdentityTokenFactory::claims(IdentityProvider::Google, $this->nonce, ['exp' => null]));

    expectRejected(fn () => $this->verifier->verify(IdentityProvider::Google, $token, $this->nonce), 'missing_expiry');
});

it('rejects a token without a subject', function (): void {
    $token = $this->idp->sign(IdentityTokenFactory::claims(IdentityProvider::Google, $this->nonce, ['sub' => null]));

    expectRejected(fn () => $this->verifier->verify(IdentityProvider::Google, $token, $this->nonce), 'missing_subject');
});

it('rejects a token issued for another nonce', function (): void {
    $token = $this->idp->sign(IdentityTokenFactory::claims(IdentityProvider::Google, $this->nonce));

    expectRejected(fn () => $this->verifier->verify(IdentityProvider::Google, $token, IdentityTokenFactory::nonce()), 'nonce_mismatch');
});

it('rejects a token without a nonce', function (): void {
    $token = $this->idp->sign(IdentityTokenFactory::claims(IdentityProvider::Google, $this->nonce, ['nonce' => null]));

    expectRejected(fn () => $this->verifier->verify(IdentityProvider::Google, $token, $this->nonce), 'nonce_mismatch');
});

it('rejects an unsigned token with alg none', function (): void {
    $token = $this->idp->unsigned(IdentityTokenFactory::claims(IdentityProvider::Google, $this->nonce));

    expectRejected(fn () => $this->verifier->verify(IdentityProvider::Google, $token, $this->nonce), 'unsupported_algorithm');
});

it('rejects an HS256 token keyed with the public key', function (): void {
    $token = $this->idp->hmacWithPublicKey(IdentityTokenFactory::claims(IdentityProvider::Google, $this->nonce));

    expectRejected(fn () => $this->verifier->verify(IdentityProvider::Google, $token, $this->nonce), 'unsupported_algorithm');
});

it('rejects a token signed by a key that is not in the key set', function (): void {
    $stranger = new IdentityTokenFactory;
    $token = $stranger->sign(IdentityTokenFactory::claims(IdentityProvider::Google, $this->nonce));

    expectRejected(fn () => $this->verifier->verify(IdentityProvider::Google, $token, $this->nonce), 'unknown_key');

    // The cached set was refreshed once before giving up.
    Http::assertSentCount(2);
});

it('rejects a token signed by another key under a known key id', function (): void {
    $stranger = new IdentityTokenFactory;
    $token = $stranger->sign(IdentityTokenFactory::claims(IdentityProvider::Google, $this->nonce), $this->idp->kid);

    expectRejected(fn () => $this->verifier->verify(IdentityProvider::Google, $token, $this->nonce), 'bad_signature');
});

it('rejects malformed tokens', function (string $token): void {
    expectRejected(fn () => $this->verifier->verify(IdentityProvider::Google, $token, $this->nonce), 'malformed');
})->with([
    'one segment' => ['abc'],
    'four segments' => ['a.b.c.d'],
]);

it('rejects a token whose header is not JSON', function (): void {
    $token = rtrim(strtr(base64_encode('not-json'), '+/', '-_'), '=').'.'.rtrim(strtr(base64_encode('{}'), '+/', '-_'), '=').'.sig';

    expectRejected(fn () => $this->verifier->verify(IdentityProvider::Google, $token, $this->nonce), 'malformed');
});

it('caches the key set between verifications', function (): void {
    foreach (range(1, 3) as $i) {
        $token = $this->idp->sign(IdentityTokenFactory::claims(IdentityProvider::Google, $this->nonce));
        $this->verifier->verify(IdentityProvider::Google, $token, $this->nonce);
    }

    Http::assertSentCount(1);
});

it('fails with a server error when the key set cannot be fetched', function (): void {
    config(['services.google.jwks_url' => 'https://oauth2.example/certs']);
    Http::fake(['oauth2.example/*' => Http::response('down', 503)]);

    $token = $this->idp->sign(IdentityTokenFactory::claims(IdentityProvider::Google, $this->nonce));

    try {
        $this->verifier->verify(IdentityProvider::Google, $token, $this->nonce);
        throw new RuntimeException('The token was accepted.');
    } catch (ProblemException $e) {
        expect($e)->not->toBeInstanceOf(InvalidIdentityToken::class)
            ->and($e->status)->toBe(503)
            ->and($e->problem->value)->toBe('server_error');
    }
});

it('refuses a key set URL that is not HTTPS', function (): void {
    config(['services.google.jwks_url' => 'http://insecure.example/certs']);
    $token = $this->idp->sign(IdentityTokenFactory::claims(IdentityProvider::Google, $this->nonce));

    expect(fn () => $this->verifier->verify(IdentityProvider::Google, $token, $this->nonce))
        ->toThrow(RuntimeException::class, 'HTTPS');
});
