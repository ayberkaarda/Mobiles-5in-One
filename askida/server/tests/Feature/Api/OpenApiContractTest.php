<?php

use App\Domain\Auth\Codes\OneTimeCodeService;
use App\Domain\Auth\Enums\IdentityProvider;
use App\Domain\Auth\Enums\OneTimeCodePurpose;
use App\Domain\Impact\Services\ImpactSnapshotService;
use App\Domain\Payments\Gateways\Iyzico\IyzicoSigner;
use App\Domain\Shops\Models\ShopVerificationState;
use App\Models\User;
use App\Support\Problem\ProblemCode;
use cebe\openapi\spec\Response as SpecResponse;
use cebe\openapi\spec\Schema;
use Database\Factories\UserFactory;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use League\OpenAPIValidation\Schema\Exception\SchemaMismatch;
use League\OpenAPIValidation\Schema\SchemaValidator;
use PHPUnit\Framework\Assert;
use Tests\Feature\Api\Donations\Support\PaymentWorld;
use Tests\Feature\Api\Shops\Support\ShopTestKit;
use Tests\Support\OpenApi\ContractWorld as W;
use Tests\Support\OpenApi\OpenApiContract as Spec;
use Tests\Unit\Auth\Support\IdentityTokenFactory;

/*
| askida/docs/api/openapi.yaml against the running application: the document is valid
| OpenAPI 3.1, documents exactly the registered /api/v1 routes, and every documented
| operation answers real calls (happy path and its denial classes) with responses that
| validate against the documented status, headers and body.
*/

uses(RefreshDatabase::class);

beforeEach(function (): void {
    W::boot();
});

describe('the document', function (): void {
    it('is a valid OpenAPI 3.1 document', function (): void {
        $spec = Spec::spec();

        expect($spec->openapi)->toStartWith('3.1.')
            ->and($spec->validate())->toBeTrue(implode("\n", $spec->getErrors()));

        // The request validator resolves every reference while it is built.
        expect(Spec::requests()->getSchema()->paths->count())->toBeGreaterThan(0);
    });

    it('documents every /api/v1 route and nothing else', function (): void {
        $documented = Spec::documentedOperations();
        $routed = Spec::routedOperations();

        $undocumented = array_values(array_diff($routed, $documented));
        $unrouted = array_values(array_diff($documented, $routed));

        expect($undocumented)->toBe([], "Routes missing from openapi.yaml:\n".implode("\n", $undocumented))
            ->and($unrouted)->toBe([], "Documented operations without a route:\n".implode("\n", $unrouted));
    });

    it('lists exactly the ProblemCode values, in order', function (): void {
        $schema = Spec::spec()->components?->schemas['ProblemCode'] ?? null;
        expect($schema)->toBeInstanceOf(Schema::class);

        /** @var Schema $schema */
        expect($schema->enum)->toBe(array_map(static fn (ProblemCode $code): string => $code->value, ProblemCode::cases()));
    });

    it('carries examples that validate against their schemas', function (): void {
        $validator = new SchemaValidator(SchemaValidator::VALIDATE_AS_RESPONSE);
        $checked = 0;

        $components = Spec::spec()->components;
        expect($components)->not->toBeNull();

        foreach ($components->responses ?? [] as $name => $response) {
            if (! $response instanceof SpecResponse) {
                continue;
            }

            foreach ($response->content as $media) {
                if ($media->example === null || ! $media->schema instanceof Schema) {
                    continue;
                }

                try {
                    $validator->validate(json_decode((string) json_encode($media->example), true), $media->schema);
                } catch (SchemaMismatch $e) {
                    Assert::fail("Example of response {$name}: ".$e->getMessage());
                }

                $checked++;
            }
        }

        expect($checked)->toBeGreaterThan(3);
    });
});

describe('auth', function (): void {
    it('register', function (): void {
        $body = [
            'email' => 'contract-'.bin2hex(random_bytes(3)).'@example.test',
            'password' => 'walnut-'.bin2hex(random_bytes(6)),
            'name' => 'Deniz Kaya',
            'kind' => 'donor',
            'device_name' => 'pixel-8',
            'platform' => 'android',
            'kvkk_text_version' => '2026-10',
        ];

        Spec::assertResponse('POST', '/auth/register', W::send('POST', '/api/v1/auth/register', $body)->assertCreated());

        W::resetLimits();
        $taken = W::call('POST', '/api/v1/auth/register', $body);
        Spec::assertProblem('POST', '/auth/register', $taken, 422, 'validation.failed');
        expect($taken->json('errors'))->toContain(['field' => 'email', 'code' => 'unique']);
    });

    it('login', function (): void {
        $user = User::factory()->donor()->create();
        $body = ['email' => $user->email, 'password' => UserFactory::PASSWORD, 'device_name' => 'pixel-8', 'platform' => 'android'];

        Spec::assertResponse('POST', '/auth/login', W::send('POST', '/api/v1/auth/login', $body)->assertOk());

        $wrong = W::call('POST', '/api/v1/auth/login', [...$body, 'password' => 'not-the-'.bin2hex(random_bytes(4))]);
        Spec::assertProblem('POST', '/auth/login', $wrong, 401, 'auth.invalid_credentials');
    });

    it('apple and google', function (IdentityProvider $provider): void {
        $idp = new IdentityTokenFactory;
        $idp->install();
        $path = '/auth/'.$provider->value;
        $nonce = IdentityTokenFactory::nonce();
        $claims = IdentityTokenFactory::claims($provider, $nonce);
        $body = [
            'id_token' => $idp->sign($claims),
            'nonce' => $nonce,
            'device_name' => 'iphone-15',
            'platform' => 'ios',
            'name' => 'Ayşe Demir',
            'kind' => 'donor',
            'kvkk_text_version' => '2026-10',
        ];

        Spec::assertResponse('POST', $path, W::send('POST', '/api/v1'.$path, $body)->assertCreated());

        W::resetLimits();
        $again = ['id_token' => $idp->sign($claims), 'nonce' => $nonce, 'device_name' => 'iphone-15', 'platform' => 'ios'];
        Spec::assertResponse('POST', $path, W::send('POST', '/api/v1'.$path, $again)->assertOk());

        W::resetLimits();
        $unsigned = W::call('POST', '/api/v1'.$path, [...$again, 'id_token' => $idp->unsigned($claims)]);
        Spec::assertProblem('POST', $path, $unsigned, 401, 'auth.token_invalid');

        W::resetLimits();
        $email = 'linked-'.bin2hex(random_bytes(3)).'@example.test';
        User::factory()->donor()->create(['email' => $email]);
        $unverified = IdentityTokenFactory::claims($provider, $nonce, ['email' => $email, 'email_verified' => false]);
        $conflict = W::call('POST', '/api/v1'.$path, [...$again, 'id_token' => $idp->sign($unverified)]);
        Spec::assertProblem('POST', $path, $conflict, 409, 'conflict');
    })->with([IdentityProvider::Apple, IdentityProvider::Google]);

    it('verify-email', function (): void {
        $user = User::factory()->unverified()->create();
        $code = app(OneTimeCodeService::class)->issue($user, OneTimeCodePurpose::EmailVerification);
        $wrong = str_pad((string) (((int) $code + 1) % 1_000_000), 6, '0', STR_PAD_LEFT);

        $invalid = W::call('POST', '/api/v1/auth/verify-email', ['email' => $user->email, 'code' => $wrong]);
        Spec::assertProblem('POST', '/auth/verify-email', $invalid, 422, 'auth.token_invalid');

        W::resetLimits();
        $response = W::send('POST', '/api/v1/auth/verify-email', ['email' => $user->email, 'code' => $code])->assertOk();
        Spec::assertResponse('POST', '/auth/verify-email', $response);
    });

    it('forgot, with the auth limiter', function (): void {
        $user = User::factory()->donor()->create();

        Spec::assertResponse('POST', '/auth/forgot', W::send('POST', '/api/v1/auth/forgot', ['email' => $user->email])->assertStatus(202));

        $malformed = W::call('POST', '/api/v1/auth/forgot', ['email' => 'not-an-email']);
        Spec::assertProblem('POST', '/auth/forgot', $malformed, 422, 'validation.failed');
        expect($malformed->json('errors'))->toBe([['field' => 'email', 'code' => 'email']]);

        W::resetLimits();

        for ($i = 0; $i < 5; $i++) {
            W::call('POST', '/api/v1/auth/forgot', ['email' => $user->email])->assertStatus(202);
        }

        $limited = W::call('POST', '/api/v1/auth/forgot', ['email' => $user->email]);
        Spec::assertProblem('POST', '/auth/forgot', $limited, 429, 'rate_limited');
        expect($limited->headers->get('Retry-After'))->toMatch('/^\d+$/');
    });

    it('reset', function (): void {
        $user = User::factory()->donor()->create();
        $code = app(OneTimeCodeService::class)->issue($user, OneTimeCodePurpose::PasswordReset);
        $password = 'hazel-'.bin2hex(random_bytes(6));
        $wrong = str_pad((string) (((int) $code + 1) % 1_000_000), 6, '0', STR_PAD_LEFT);

        $invalid = W::call('POST', '/api/v1/auth/reset', ['email' => $user->email, 'code' => $wrong, 'password' => $password]);
        Spec::assertProblem('POST', '/auth/reset', $invalid, 422, 'auth.token_invalid');

        W::resetLimits();
        $response = W::send('POST', '/api/v1/auth/reset', ['email' => $user->email, 'code' => $code, 'password' => $password]);
        Spec::assertResponse('POST', '/auth/reset', $response->assertNoContent());
    });

    it('logout', function (): void {
        $token = W::token(User::factory()->donor()->create());

        Spec::assertResponse('POST', '/auth/logout', W::send('POST', '/api/v1/auth/logout', null, $token)->assertNoContent());
        Spec::assertProblem('POST', '/auth/logout', W::call('POST', '/api/v1/auth/logout', null, $token), 401, 'auth.unauthenticated');
        Spec::assertProblem('POST', '/auth/logout', W::call('POST', '/api/v1/auth/logout', null, W::anonToken()), 401, 'auth.unauthenticated');
    });
});

describe('me', function (): void {
    it('read and update', function (): void {
        $user = User::factory()->donor()->create();
        $login = W::call('POST', '/api/v1/auth/login', [
            'email' => $user->email, 'password' => UserFactory::PASSWORD, 'device_name' => 'pixel-8', 'platform' => 'android',
        ])->assertOk();
        $token = (string) $login->json('token');

        Spec::assertResponse('GET', '/me', W::send('GET', '/api/v1/me', null, $token)->assertOk());
        Spec::assertProblem('GET', '/me', W::call('GET', '/api/v1/me'), 401, 'auth.unauthenticated');

        Spec::assertResponse('PATCH', '/me', W::send('PATCH', '/api/v1/me', ['name' => 'Deniz K.'], $token)->assertOk());

        $prohibited = W::call('PATCH', '/api/v1/me', ['kind' => 'merchant'], $token);
        Spec::assertProblem('PATCH', '/me', $prohibited, 422, 'validation.failed');
        expect($prohibited->json('errors'))->toBe([['field' => 'kind', 'code' => 'prohibited']]);
    });

    it('delete', function (): void {
        $donor = User::factory()->donor()->create();
        $token = W::token($donor);

        $wrong = W::call('DELETE', '/api/v1/me', ['password' => 'not-the-'.bin2hex(random_bytes(4))], $token);
        Spec::assertProblem('DELETE', '/me', $wrong, 401, 'auth.invalid_credentials');

        W::resetLimits();
        $missing = W::call('DELETE', '/api/v1/me', [], $token);
        Spec::assertProblem('DELETE', '/me', $missing, 422, 'validation.failed');
        expect($missing->json('errors'))->toBe([['field' => 'password', 'code' => 'required']]);

        W::resetLimits();
        $response = W::send('DELETE', '/api/v1/me', ['password' => UserFactory::PASSWORD], $token)->assertStatus(202);
        Spec::assertResponse('DELETE', '/me', $response);

        W::resetLimits();
        $shop = W::shop();
        W::availableUnits(W::item($shop), 1);
        $open = W::call('DELETE', '/api/v1/me', ['password' => UserFactory::PASSWORD], W::token(W::owner($shop)));
        Spec::assertProblem('DELETE', '/me', $open, 409, 'shop.has_open_hooks');
    });

    it('push token', function (): void {
        $token = W::token(User::factory()->donor()->create());
        $body = ['platform' => 'ios', 'token' => 'push-'.bin2hex(random_bytes(8))];

        Spec::assertResponse('PUT', '/me/push-token', W::send('PUT', '/api/v1/me/push-token', $body, $token)->assertNoContent());

        $missing = W::call('PUT', '/api/v1/me/push-token', ['platform' => 'ios'], $token);
        Spec::assertProblem('PUT', '/me/push-token', $missing, 422, 'validation.failed');

        Spec::assertProblem('PUT', '/me/push-token', W::call('PUT', '/api/v1/me/push-token', $body, W::anonToken()), 401, 'auth.unauthenticated');
    });
});

describe('anon', function (): void {
    it('attest, with its limiter and provider outcomes', function (): void {
        $nonce = W::deviceNonce();
        $body = ['platform' => 'android', 'token' => 'attestation-'.bin2hex(random_bytes(4)), 'device_nonce' => $nonce];

        Spec::assertResponse('POST', '/anon/attest', W::send('POST', '/api/v1/anon/attest', $body)->assertOk());

        $rejected = W::call('POST', '/api/v1/anon/attest', [...$body, 'token' => 'reject-'.bin2hex(random_bytes(4))]);
        Spec::assertProblem('POST', '/anon/attest', $rejected, 401, 'auth.token_invalid');

        $outage = W::call('POST', '/api/v1/anon/attest', [...$body, 'token' => 'unavailable-'.bin2hex(random_bytes(4))]);
        Spec::assertProblem('POST', '/anon/attest', $outage, 503, 'service_unavailable');

        $limited = W::call('POST', '/api/v1/anon/attest', $body);
        Spec::assertProblem('POST', '/anon/attest', $limited, 429, 'rate_limited');

        W::resetLimits();
        $invalid = W::call('POST', '/api/v1/anon/attest', [...$body, 'device_nonce' => 'short']);
        Spec::assertProblem('POST', '/anon/attest', $invalid, 422, 'validation.failed');
        expect($invalid->json('errors'))->toBe([['field' => 'device_nonce', 'code' => 'regex']]);
    });

    it('delete', function (): void {
        $userToken = W::token(User::factory()->donor()->create());
        Spec::assertProblem('DELETE', '/anon/me', W::call('DELETE', '/api/v1/anon/me', null, $userToken), 403, 'forbidden');

        $anon = W::anonToken();
        Spec::assertResponse('DELETE', '/anon/me', W::send('DELETE', '/api/v1/anon/me', null, $anon)->assertNoContent());
        Spec::assertProblem('DELETE', '/anon/me', W::call('DELETE', '/api/v1/anon/me', null, $anon), 401, 'auth.unauthenticated');
    });
});

describe('shops', function (): void {
    it('list', function (): void {
        $shop = W::shop();
        W::availableUnits(W::item($shop), 2);
        $token = W::token(W::donor());
        $near = ShopTestKit::LAT.','.ShopTestKit::LNG;

        $response = W::send('GET', "/api/v1/shops?near={$near}&radius=3000&hasAvailable=1&limit=1", null, $token)->assertOk();
        Spec::assertResponse('GET', '/shops', $response);
        expect($response->json('data.0.available_count'))->toBe(2);

        $missing = W::call('GET', '/api/v1/shops', null, $token);
        Spec::assertProblem('GET', '/shops', $missing, 422, 'validation.failed');

        $cursor = W::call('GET', "/api/v1/shops?near={$near}&cursor=not-a-cursor", null, $token);
        Spec::assertProblem('GET', '/shops', $cursor, 422, 'validation.failed');

        Spec::assertProblem('GET', '/shops', W::call('GET', "/api/v1/shops?near={$near}"), 401, 'auth.unauthenticated');
        Spec::assertResponse('GET', '/shops', W::send('GET', "/api/v1/shops?near={$near}&radius=3000", null, W::anonToken())->assertOk());
    });

    it('create', function (): void {
        $body = ShopTestKit::payload();

        $created = W::send('POST', '/api/v1/shops', $body, W::token(W::merchant()))->assertCreated();
        Spec::assertResponse('POST', '/shops', $created);
        expect($created->json('data.verification_state'))->toBe('pending');

        Spec::assertProblem('POST', '/shops', W::call('POST', '/api/v1/shops', $body, W::token(W::donor())), 403, 'forbidden');

        $badIban = W::call('POST', '/api/v1/shops', ShopTestKit::payload(['iban' => 'TR'.str_repeat('0', 24)]), W::token(W::merchant()));
        Spec::assertProblem('POST', '/shops', $badIban, 422, 'validation.failed');
        expect($badIban->json('errors.0.field'))->toBe('iban');
    });

    it('show', function (): void {
        $shop = W::shop();
        W::availableUnits(W::item($shop), 1);

        $public = W::send('GET', "/api/v1/shops/{$shop->slug}", null, W::token(W::donor()))->assertOk();
        Spec::assertResponse('GET', '/shops/{shop}', $public);
        expect($public->json('data.items.0.available_count'))->toBe(1);

        $owner = W::send('GET', "/api/v1/shops/{$shop->slug}", null, W::token(W::owner($shop)))->assertOk();
        Spec::assertResponse('GET', '/shops/{shop}', $owner);
        expect($owner->json('data.verification_state'))->toBe('verified');

        $pending = W::shop(state: ShopVerificationState::Pending);
        Spec::assertProblem('GET', '/shops/{shop}', W::call('GET', "/api/v1/shops/{$pending->slug}", null, W::token(W::donor())), 404, 'not_found');
        Spec::assertProblem('GET', '/shops/{shop}', W::call('GET', "/api/v1/shops/{$shop->slug}"), 401, 'auth.unauthenticated');
        Spec::assertResponse('GET', '/shops/{shop}', W::send('GET', "/api/v1/shops/{$shop->slug}", null, W::anonToken())->assertOk());
    });

    it('update', function (): void {
        $shop = W::shop();

        $response = W::send('PATCH', "/api/v1/shops/{$shop->id}", ['name' => 'Çınar Fırını Moda'], W::token(W::owner($shop)))->assertOk();
        Spec::assertResponse('PATCH', '/shops/{shop}', $response);

        Spec::assertProblem('PATCH', '/shops/{shop}', W::call('PATCH', "/api/v1/shops/{$shop->id}", ['name' => 'Başka'], W::token(W::staff($shop))), 403, 'forbidden');
        Spec::assertProblem('PATCH', '/shops/{shop}', W::call('PATCH', "/api/v1/shops/{$shop->id}", ['name' => 'Başka'], W::token(W::merchant())), 404, 'not_found');
        Spec::assertProblem('PATCH', '/shops/{shop}', W::call('PATCH', '/api/v1/shops/not-a-uuid', ['name' => 'Başka'], W::token(W::owner($shop))), 405, 'method_not_allowed');

        $invalid = W::call('PATCH', "/api/v1/shops/{$shop->id}", ['lat' => 41.0], W::token(W::owner($shop)));
        Spec::assertProblem('PATCH', '/shops/{shop}', $invalid, 422, 'validation.failed');
        expect($invalid->json('errors'))->toBe([['field' => 'lng', 'code' => 'required_with']]);
    });
});

describe('items', function (): void {
    it('list', function (): void {
        $shop = W::shop();
        W::item($shop);

        Spec::assertResponse('GET', '/shops/{shop}/items', W::send('GET', "/api/v1/shops/{$shop->id}/items", null, W::token(W::staff($shop)))->assertOk());
        Spec::assertProblem('GET', '/shops/{shop}/items', W::call('GET', "/api/v1/shops/{$shop->id}/items", null, W::token(W::donor())), 403, 'forbidden');
        Spec::assertProblem('GET', '/shops/{shop}/items', W::call('GET', "/api/v1/shops/{$shop->id}/items", null, W::token(W::merchant())), 404, 'not_found');
        $unknown = '00000000-0000-4000-8000-000000000000';
        Spec::assertProblem('GET', '/shops/{shop}/items', W::call('GET', "/api/v1/shops/{$unknown}/items", null, W::token(W::donor())), 404, 'not_found');
    });

    it('create', function (): void {
        $shop = W::shop();
        $owner = W::token(W::owner($shop));
        $body = ['name' => 'Mercimek çorbası', 'category' => 'corba', 'price_minor' => 4500, 'daily_cap' => 10];

        Spec::assertResponse('POST', '/shops/{shop}/items', W::send('POST', "/api/v1/shops/{$shop->id}/items", $body, $owner)->assertCreated());

        $cheap = W::call('POST', "/api/v1/shops/{$shop->id}/items", [...$body, 'price_minor' => 99], $owner);
        Spec::assertProblem('POST', '/shops/{shop}/items', $cheap, 422, 'validation.failed');
        expect($cheap->json('errors'))->toBe([['field' => 'price_minor', 'code' => 'min']]);

        Spec::assertProblem('POST', '/shops/{shop}/items', W::call('POST', "/api/v1/shops/{$shop->id}/items", $body, W::token(W::staff($shop))), 403, 'forbidden');
    });

    it('update', function (): void {
        $shop = W::shop();
        $item = W::item($shop);
        $foreign = W::item(W::shop());
        $owner = W::token(W::owner($shop));

        Spec::assertResponse('PATCH', '/shops/{shop}/items/{item}', W::send('PATCH', "/api/v1/shops/{$shop->id}/items/{$item->id}", ['price_minor' => 1750], $owner)->assertOk());
        Spec::assertProblem('PATCH', '/shops/{shop}/items/{item}', W::call('PATCH', "/api/v1/shops/{$shop->id}/items/{$foreign->id}", ['price_minor' => 1750], $owner), 404, 'not_found');

        $invalid = W::call('PATCH', "/api/v1/shops/{$shop->id}/items/{$item->id}", ['category' => 'kebap'], $owner);
        Spec::assertProblem('PATCH', '/shops/{shop}/items/{item}', $invalid, 422, 'validation.failed');
    });
});

describe('documents', function (): void {
    it('presign and confirm against the private store', function (): void {
        // The object store of the compose stack (or CI) is the only real host allowed.
        Http::allowStrayRequests([rtrim((string) config('filesystems.disks.private.endpoint'), '/').'/*']);

        $shop = W::shop();
        $owner = W::token(W::owner($shop));
        $png = ShopTestKit::png();

        $presign = W::send('POST', "/api/v1/shops/{$shop->id}/documents/presign", ['kind' => 'isletme_belgesi', 'mime' => 'image/png', 'size' => strlen($png)], $owner)
            ->assertCreated();
        Spec::assertResponse('POST', '/shops/{shop}/documents/presign', $presign);

        /** @var array{url: string, headers: array<string, string>} $upload */
        $upload = $presign->json('data.upload');
        $headers = $upload['headers'];
        $contentType = $headers['Content-Type'];
        unset($headers['Content-Type']);
        expect(Http::withHeaders($headers)->withBody($png, $contentType)->put($upload['url'])->status())->toBe(200);

        $documentId = (string) $presign->json('data.document.id');
        $confirmPath = "/api/v1/shops/{$shop->id}/documents/{$documentId}/confirm";

        $confirmed = W::send('POST', $confirmPath, null, $owner)->assertOk();
        Spec::assertResponse('POST', '/shops/{shop}/documents/{document}/confirm', $confirmed);
        expect($confirmed->json('data.state'))->toBe('uploaded');

        Spec::assertProblem('POST', '/shops/{shop}/documents/{document}/confirm', W::call('POST', $confirmPath, null, $owner), 409, 'conflict');

        $other = W::shop();
        Spec::assertProblem(
            'POST',
            '/shops/{shop}/documents/{document}/confirm',
            W::call('POST', "/api/v1/shops/{$other->id}/documents/{$documentId}/confirm", null, W::token(W::owner($other))),
            404,
            'not_found',
        );

        $pending = W::call('POST', "/api/v1/shops/{$shop->id}/documents/presign", ['kind' => 'vergi_levhasi', 'mime' => 'application/pdf', 'size' => 1200], $owner)->assertCreated();
        $missing = W::call('POST', "/api/v1/shops/{$shop->id}/documents/{$pending->json('data.document.id')}/confirm", null, $owner);
        Spec::assertProblem('POST', '/shops/{shop}/documents/{document}/confirm', $missing, 422, 'validation.failed');
        expect($missing->json('errors'))->toBe([['field' => 'document', 'code' => 'missing_object']]);

        Spec::assertProblem(
            'POST',
            '/shops/{shop}/documents/{document}/confirm',
            W::call('POST', $confirmPath, null, W::token(W::staff($shop))),
            403,
            'forbidden',
        );
    });

    it('presign limits', function (): void {
        $shop = W::shop();
        $owner = W::token(W::owner($shop));
        $path = "/api/v1/shops/{$shop->id}/documents/presign";
        $body = ['kind' => 'vergi_levhasi', 'mime' => 'application/pdf', 'size' => 1200];

        $invalid = W::call('POST', $path, [...$body, 'mime' => 'text/html'], W::token(W::owner($shop)));
        Spec::assertProblem('POST', '/shops/{shop}/documents/presign', $invalid, 422, 'validation.failed');
        expect($invalid->json('errors'))->toBe([['field' => 'mime', 'code' => 'in']]);

        for ($i = 0; $i < 3; $i++) {
            W::call('POST', $path, $body, $owner)->assertCreated();
        }

        Spec::assertProblem('POST', '/shops/{shop}/documents/presign', W::call('POST', $path, $body, $owner), 409, 'conflict');

        // The daily quota (10) counts every authorized presign, refused ones included.
        for ($i = 0; $i < 6; $i++) {
            W::call('POST', $path, $body, $owner)->assertStatus(409);
        }

        Spec::assertProblem('POST', '/shops/{shop}/documents/presign', W::call('POST', $path, $body, $owner), 429, 'rate_limited');
        Spec::assertProblem('POST', '/shops/{shop}/documents/presign', W::call('POST', $path, $body, W::token(W::staff($shop))), 403, 'forbidden');
        Spec::assertProblem('POST', '/shops/{shop}/documents/presign', W::call('POST', $path, $body, W::token(W::merchant())), 404, 'not_found');
    });
});

describe('hooks', function (): void {
    it('reserve, redeem and list redemptions', function (): void {
        $shop = W::shop();
        $item = W::item($shop);
        W::availableUnits($item, 2);
        $anon = W::anonToken();

        $reserved = W::send('POST', '/api/v1/hooks/reserve', ['shop_id' => $shop->id, 'item_id' => $item->id], $anon)->assertCreated();
        Spec::assertResponse('POST', '/hooks/reserve', $reserved);

        $again = W::call('POST', '/api/v1/hooks/reserve', ['shop_id' => $shop->id, 'item_id' => $item->id], $anon);
        Spec::assertProblem('POST', '/hooks/reserve', $again, 409, 'anon.shop_cap');

        $code = (string) $reserved->json('code');
        $staff = W::token(W::staff($shop));
        $formatted = substr($code, 0, 4).'-'.strtolower(substr($code, 4));

        $redeemed = W::send('POST', "/api/v1/shops/{$shop->id}/redeem", ['code' => $formatted], $staff)->assertOk();
        Spec::assertResponse('POST', '/shops/{shop}/redeem', $redeemed);
        expect($redeemed->json('message'))->toBe('1 ekmek verildi');

        $used = W::call('POST', "/api/v1/shops/{$shop->id}/redeem", ['code' => $code], $staff);
        Spec::assertProblem('POST', '/shops/{shop}/redeem', $used, 422, 'hook.code_invalid');

        $list = W::send('GET', "/api/v1/shops/{$shop->id}/redemptions", null, $staff)->assertOk();
        Spec::assertResponse('GET', '/shops/{shop}/redemptions', $list);
        expect($list->json('meta.count'))->toBe(1)
            ->and($list->json('data.0.redeemed_by_role'))->toBe('staff');

        $day = W::send('GET', "/api/v1/shops/{$shop->id}/redemptions?day=2026-01-01", null, W::token(W::owner($shop)))->assertOk();
        Spec::assertResponse('GET', '/shops/{shop}/redemptions', $day);
    });

    it('reserve denials', function (): void {
        $shop = W::shop();
        $item = W::item($shop);
        $pending = W::shop(state: ShopVerificationState::Pending);
        $pendingItem = W::item($pending);
        $anon = W::anonToken();

        $userToken = W::token(W::donor());
        Spec::assertProblem('POST', '/hooks/reserve', W::call('POST', '/api/v1/hooks/reserve', ['shop_id' => $shop->id, 'item_id' => $item->id], $userToken), 403, 'forbidden');
        Spec::assertProblem('POST', '/hooks/reserve', W::call('POST', '/api/v1/hooks/reserve', ['shop_id' => $shop->id, 'item_id' => $item->id]), 401, 'auth.unauthenticated');
        Spec::assertProblem('POST', '/hooks/reserve', W::call('POST', '/api/v1/hooks/reserve', ['shop_id' => $pending->id, 'item_id' => $pendingItem->id], $anon), 404, 'not_found');
        Spec::assertProblem('POST', '/hooks/reserve', W::call('POST', '/api/v1/hooks/reserve', ['shop_id' => $shop->id, 'item_id' => $item->id], $anon), 409, 'hook.none_available');

        $invalid = W::call('POST', '/api/v1/hooks/reserve', ['shop_id' => $shop->id, 'item_id' => 'not-a-uuid'], $anon);
        Spec::assertProblem('POST', '/hooks/reserve', $invalid, 422, 'validation.failed');
        expect($invalid->json('errors'))->toBe([['field' => 'item_id', 'code' => 'uuid']]);

        W::call('POST', '/api/v1/hooks/reserve', [], $anon)->assertStatus(422);
        W::call('POST', '/api/v1/hooks/reserve', [], $anon)->assertStatus(422);
        Spec::assertProblem('POST', '/hooks/reserve', W::call('POST', '/api/v1/hooks/reserve', [], $anon), 429, 'rate_limited');
    });

    it('redeem and redemption denials', function (): void {
        $shop = W::shop();
        $owner = W::token(W::owner($shop));
        $code = Str::upper(Str::random(8));

        Spec::assertProblem('POST', '/shops/{shop}/redeem', W::call('POST', "/api/v1/shops/{$shop->id}/redeem", ['code' => 'ABCDEFGH'], W::token(W::donor())), 403, 'forbidden');
        Spec::assertProblem('POST', '/shops/{shop}/redeem', W::call('POST', "/api/v1/shops/{$shop->id}/redeem", ['code' => 'ABCDEFGH'], W::token(W::merchant())), 404, 'not_found');
        Spec::assertProblem('POST', '/shops/{shop}/redeem', W::call('POST', "/api/v1/shops/{$shop->id}/redeem", ['code' => 'ABCDEFGH'], W::anonToken()), 401, 'auth.unauthenticated');

        $invalid = W::call('POST', "/api/v1/shops/{$shop->id}/redeem", ['code' => 'U'.$code], $owner);
        Spec::assertProblem('POST', '/shops/{shop}/redeem', $invalid, 422, 'validation.failed');
        expect($invalid->json('errors'))->toBe([['field' => 'code', 'code' => 'regex']]);

        W::resetLimits();

        for ($i = 0; $i < 30; $i++) {
            W::call('POST', "/api/v1/shops/{$shop->id}/redeem", ['code' => 'ABCDEFGH'], $owner)->assertStatus(422);
        }

        Spec::assertProblem('POST', '/shops/{shop}/redeem', W::call('POST', "/api/v1/shops/{$shop->id}/redeem", ['code' => 'ABCDEFGH'], $owner), 429, 'rate_limited');

        $redemptions = "/api/v1/shops/{$shop->id}/redemptions";
        Spec::assertProblem('GET', '/shops/{shop}/redemptions', W::call('GET', $redemptions, null, W::token(W::donor())), 403, 'forbidden');
        Spec::assertProblem('GET', '/shops/{shop}/redemptions', W::call('GET', $redemptions, null, W::token(W::merchant())), 404, 'not_found');
        Spec::assertProblem('GET', '/shops/{shop}/redemptions', W::call('GET', $redemptions.'?day=04.10.2026', null, $owner), 422, 'validation.failed');
    });
});

describe('impact', function (): void {
    it('reads the latest snapshot', function (): void {
        Spec::assertResponse('GET', '/impact', W::send('GET', '/api/v1/impact')->assertOk());

        $shop = W::shop();
        W::availableUnits(W::item($shop), 2);
        app(ImpactSnapshotService::class)->snapshot();
        W::resetLimits();

        $response = W::send('GET', '/api/v1/impact?il='.rawurlencode('İstanbul').'&ilce='.rawurlencode('Kadıköy'))->assertOk();
        Spec::assertResponse('GET', '/impact', $response);
        expect($response->json('data.day'))->not->toBeNull();

        $invalid = W::call('GET', '/api/v1/impact?ilce='.rawurlencode('Kadıköy'));
        Spec::assertProblem('GET', '/impact', $invalid, 422, 'validation.failed');
        expect($invalid->json('errors'))->toBe([['field' => 'il', 'code' => 'required_with']]);
    });
});

describe('donations', function (): void {
    it('creates, lists and shows a donation of the calling donor', function (): void {
        PaymentWorld::useFakeGateway();
        $shop = W::shop();
        $shop->forceFill(['sub_merchant_key' => 'test-sm-'.bin2hex(random_bytes(6))])->save();
        $item = W::item($shop);
        $donor = W::donor();
        $token = W::token($donor);

        $created = W::send('POST', '/api/v1/donations', ['shop_id' => $shop->id, 'item_id' => $item->id, 'qty' => 2], $token)->assertCreated();
        Spec::assertResponse('POST', '/donations', $created);
        $id = (string) $created->json('donation_id');

        $list = W::send('GET', '/api/v1/donations?limit=5', null, $token)->assertOk();
        Spec::assertResponse('GET', '/donations', $list);
        expect($list->json('data.0.id'))->toBe($id)
            ->and($list->json('data.0.status'))->toBe('initiated')
            ->and($list->json('data.0.amount_minor'))->toBe($item->price_minor * 2);

        $shown = W::send('GET', "/api/v1/donations/{$id}", null, $token)->assertOk();
        Spec::assertResponse('GET', '/donations/{donation}', $shown);
        expect($shown->json('data.id'))->toBe($id);

        Spec::assertProblem('GET', '/donations/{donation}', W::call('GET', "/api/v1/donations/{$id}", null, W::token(W::donor())), 404, 'not_found');
    });

    it('denies and refuses donation calls', function (): void {
        PaymentWorld::useFakeGateway();
        $shop = W::shop();
        $item = W::item($shop);
        $body = ['shop_id' => $shop->id, 'item_id' => $item->id, 'qty' => 1];
        $donor = W::token(W::donor());
        $merchant = W::token(W::merchant());

        Spec::assertProblem('POST', '/donations', W::call('POST', '/api/v1/donations', $body), 401, 'auth.unauthenticated');
        Spec::assertProblem('POST', '/donations', W::call('POST', '/api/v1/donations', $body, $merchant), 403, 'forbidden');
        Spec::assertProblem('GET', '/donations', W::call('GET', '/api/v1/donations', null, $merchant), 403, 'forbidden');
        Spec::assertProblem('GET', '/donations/{donation}', W::call('GET', '/api/v1/donations/'.Str::uuid(), null, $merchant), 403, 'forbidden');
        Spec::assertProblem('GET', '/donations/{donation}', W::call('GET', '/api/v1/donations/'.Str::uuid(), null, $donor), 404, 'not_found');
        Spec::assertProblem('POST', '/donations', W::call('POST', '/api/v1/donations', $body, $donor), 409, 'shop.not_payable');

        $invalid = W::call('POST', '/api/v1/donations', [...$body, 'amount_minor' => 1], $donor);
        Spec::assertProblem('POST', '/donations', $invalid, 422, 'validation.failed');
        expect($invalid->json('errors'))->toBe([['field' => 'amount_minor', 'code' => 'prohibited']]);

        $shop->forceFill(['sub_merchant_key' => 'test-sm-'.bin2hex(random_bytes(6))])->save();
        $item->forceFill(['price_minor' => 15_000])->save();
        $big = W::call('POST', '/api/v1/donations', [...$body, 'qty' => 20], $donor);
        Spec::assertProblem('POST', '/donations', $big, 422, 'donation.tx_cap_exceeded');

        Spec::assertProblem('GET', '/donations', W::call('GET', '/api/v1/donations?limit=0', null, $donor), 422, 'validation.failed');
    });
});

describe('payouts', function (): void {
    it('lists the ledger for the owner and refuses everyone else', function (): void {
        $shop = W::shop();
        $path = "/api/v1/shops/{$shop->id}/payouts";

        $ledger = W::send('GET', $path, null, W::token(W::owner($shop)))->assertOk();
        Spec::assertResponse('GET', '/shops/{shop}/payouts', $ledger);
        expect($ledger->json('meta.currency'))->toBe('TRY')
            ->and($ledger->json('meta.commission.text_key'))->toBe('payouts.commission.transparent');

        Spec::assertProblem('GET', '/shops/{shop}/payouts', W::call('GET', $path), 401, 'auth.unauthenticated');
        Spec::assertProblem('GET', '/shops/{shop}/payouts', W::call('GET', $path, null, W::token(W::staff($shop))), 403, 'forbidden');
        Spec::assertProblem('GET', '/shops/{shop}/payouts', W::call('GET', $path, null, W::token(W::donor())), 403, 'forbidden');
        Spec::assertProblem('GET', '/shops/{shop}/payouts', W::call('GET', $path, null, W::token(W::merchant())), 404, 'not_found');
        Spec::assertProblem('GET', '/shops/{shop}/payouts', W::call('GET', $path.'?limit=0', null, W::token(W::owner($shop))), 422, 'validation.failed');
    });
});

describe('webhooks', function (): void {
    it('accepts a signed delivery once and refuses a bad signature', function (): void {
        Queue::fake();
        PaymentWorld::useFakeGateway();
        PaymentWorld::providerKeys();

        $payload = [
            'iyziEventType' => 'CHECKOUT_FORM_AUTH',
            'iyziEventTime' => (int) (microtime(true) * 1000),
            'iyziPaymentId' => (string) random_int(100000, 999999),
            'token' => 'tok-'.bin2hex(random_bytes(8)),
            'paymentConversationId' => (string) Str::uuid(),
            'status' => 'SUCCESS',
        ];
        $signature = IyzicoSigner::webhookSignature((string) config('services.iyzico.secret_key'), $payload);
        $headers = ['X-IYZ-SIGNATURE-V3' => $signature];
        $deliver = static function (array $headers) use ($payload) {
            W::case()->flushHeaders();
            app('auth')->forgetGuards();

            return W::case()->postJson('/api/v1/webhooks/iyzico', $payload, $headers);
        };

        Spec::assertRequest('POST', '/api/v1/webhooks/iyzico', null, $headers);

        $first = $deliver($headers)->assertOk();
        Spec::assertResponse('POST', '/webhooks/iyzico', $first);
        expect($first->json('status'))->toBe('accepted');

        $again = $deliver($headers)->assertOk();
        Spec::assertResponse('POST', '/webhooks/iyzico', $again);
        expect($again->json('status'))->toBe('duplicate');

        $forged = $deliver(['X-IYZ-SIGNATURE-V3' => str_repeat('0', 64)]);
        Spec::assertProblem('POST', '/webhooks/iyzico', $forged, 401, 'auth.token_invalid');

        $unsigned = $deliver([]);
        Spec::assertProblem('POST', '/webhooks/iyzico', $unsigned, 401, 'auth.token_invalid');
    });
});

/*
| Request examples against the real Form Requests: each documented example passes
| validation (the answer is never a validation.failed problem), and removing any field
| the document marks as required gives 422 validation.failed naming that field.
*/

const OPENAPI_BODY_OPERATIONS = [
    'attestDevice', 'createDonation', 'createShop', 'createShopItem', 'deleteMe', 'forgotPassword', 'login', 'presignShopDocument',
    'putPushToken', 'redeemHook', 'register', 'reserveHook', 'resetPassword', 'signInWithApple', 'signInWithGoogle',
    'updateMe', 'updateShop', 'updateShopItem', 'verifyEmail',
];

/**
 * Concrete URI and token for an operation's documented request.
 *
 * @return array{uri: string, token: string|null}
 */
function openApiRequestContext(string $operationId): array
{
    $shop = W::shop();
    $owner = static fn (): string => W::token(W::owner($shop));

    return match ($operationId) {
        'attestDevice' => ['uri' => '/api/v1/anon/attest', 'token' => null],
        'createDonation' => ['uri' => '/api/v1/donations', 'token' => W::token(W::donor())],
        'createShop' => ['uri' => '/api/v1/shops', 'token' => W::token(W::merchant())],
        'createShopItem' => ['uri' => "/api/v1/shops/{$shop->id}/items", 'token' => $owner()],
        'deleteMe' => ['uri' => '/api/v1/me', 'token' => W::token(W::donor())],
        'forgotPassword' => ['uri' => '/api/v1/auth/forgot', 'token' => null],
        'login' => ['uri' => '/api/v1/auth/login', 'token' => null],
        'presignShopDocument' => ['uri' => "/api/v1/shops/{$shop->id}/documents/presign", 'token' => $owner()],
        'putPushToken' => ['uri' => '/api/v1/me/push-token', 'token' => W::token(W::donor())],
        'redeemHook' => ['uri' => "/api/v1/shops/{$shop->id}/redeem", 'token' => $owner()],
        'register' => ['uri' => '/api/v1/auth/register', 'token' => null],
        'reserveHook' => ['uri' => '/api/v1/hooks/reserve', 'token' => W::anonToken()],
        'resetPassword' => ['uri' => '/api/v1/auth/reset', 'token' => null],
        'signInWithApple' => ['uri' => '/api/v1/auth/apple', 'token' => null],
        'signInWithGoogle' => ['uri' => '/api/v1/auth/google', 'token' => null],
        'updateMe' => ['uri' => '/api/v1/me', 'token' => W::token(W::donor())],
        'updateShop' => ['uri' => "/api/v1/shops/{$shop->id}", 'token' => $owner()],
        'updateShopItem' => ['uri' => "/api/v1/shops/{$shop->id}/items/".W::item($shop)->id, 'token' => $owner()],
        'verifyEmail' => ['uri' => '/api/v1/auth/verify-email', 'token' => null],
        default => throw new LogicException("No request context for {$operationId}."),
    };
}

it('covers every operation with a request body in the example checks', function (): void {
    expect(array_keys(Spec::operationsWithBody()))->toBe(OPENAPI_BODY_OPERATIONS);
});

it('accepts each documented request example and requires each documented required field', function (string $operationId): void {
    ['method' => $method, 'path' => $path] = Spec::operationsWithBody()[$operationId];
    $operation = Spec::operation($method, $path);
    $example = Spec::requestExample($operation);

    // The tax number and IBAN examples are format samples (the secret scanner forbids
    // checksum-valid identifiers in the repository); real values are made at run time.
    if ($operationId === 'createShop') {
        $example = [...$example, 'tax_number' => ShopTestKit::taxNumber(), 'iban' => ShopTestKit::iban()];
    }

    ['uri' => $uri, 'token' => $token] = openApiRequestContext($operationId);

    W::resetLimits();
    $accepted = W::send($method, $uri, $example, $token);
    $code = $accepted->getContent() === '' ? null : $accepted->json('code');
    expect($code)->not->toBe('validation.failed', "{$operationId} example was refused: ".$accepted->getContent());
    Spec::assertResponse($method, $path, $accepted);

    foreach (Spec::requiredFields($operation) as $field) {
        $body = $example;
        unset($body[$field]);

        W::resetLimits();
        $refused = W::call($method, $uri, $body, $token);
        Spec::assertProblem($method, $path, $refused, 422, 'validation.failed');
        expect($refused->json('errors'))->toContain(['field' => $field, 'code' => 'required']);
    }
})->with(OPENAPI_BODY_OPERATIONS);
