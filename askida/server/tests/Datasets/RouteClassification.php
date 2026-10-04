<?php

namespace Tests\Datasets;

/**
 * Classification of every `/api/v1` route (RouteClassificationTest). A route that is
 * added without an entry here fails the suite, and so does an entry whose route is gone
 * or whose middleware disagrees with the classification.
 *
 * Key: "<METHOD> <uri>" exactly as the route table writes it (first method, HEAD
 * ignored; parameter names as declared).
 *
 * Classes:
 * - public: no token needed; any bearer token sent is ignored by the action;
 * - user: a user token (`donor` and/or `merchant`, listed in `abilities`);
 * - any: any API token, user or anon device (the shop directory reads, matrix 3.2);
 * - merchant: a merchant token plus a shop rule for the shop in the path:
 *   `owner` (owner only, staff 403), `member` (owner and staff), `not-staff` (any
 *   merchant that is not staff somewhere: opening a shop);
 * - anon: an anon device token only.
 *
 * `gaps`: principal => reason, for a principal the matrix allows but the route refuses
 * today. The test asserts the current refusal, so closing the gap fails the row until it
 * is removed here (the same honesty rule as the matrix `PENDING` rows).
 *
 * `query` and `payload` name the request the behaviour checks send: a valid body, so
 * that a refusal comes from authentication or authorization and never from validation.
 *
 * @phpstan-type Entry array{class: string, abilities: list<string>, shop?: string, gaps?: array<string, string>, query?: string, payload?: string}
 */
final class RouteClassification
{
    public const CLASSES = ['public', 'user', 'any', 'merchant', 'anon'];

    public const SHOP_RULES = ['owner', 'member', 'not-staff'];

    /**
     * @return array<string, Entry>
     */
    public static function routes(): array
    {
        return [
            // Identity (matrix 3.1)
            'POST api/v1/auth/register' => self::open('empty'),
            'POST api/v1/auth/login' => self::open('empty'),
            'POST api/v1/auth/apple' => self::open('empty'),
            'POST api/v1/auth/google' => self::open('empty'),
            'POST api/v1/auth/verify-email' => self::open('empty'),
            'POST api/v1/auth/forgot' => self::open('empty'),
            'POST api/v1/auth/reset' => self::open('empty'),
            'POST api/v1/auth/logout' => ['class' => 'user', 'abilities' => ['donor', 'merchant']],
            'GET api/v1/me' => ['class' => 'user', 'abilities' => ['donor', 'merchant']],
            'PATCH api/v1/me' => ['class' => 'user', 'abilities' => ['donor', 'merchant'], 'payload' => 'me'],
            'DELETE api/v1/me' => ['class' => 'user', 'abilities' => ['donor', 'merchant'], 'payload' => 'wrong-password'],
            'PUT api/v1/me/push-token' => ['class' => 'user', 'abilities' => ['donor', 'merchant'], 'payload' => 'push-token'],
            'POST api/v1/anon/attest' => self::open('empty'),
            'DELETE api/v1/anon/me' => ['class' => 'anon', 'abilities' => ['anon']],

            // Shops and catalog (matrix 3.2)
            'GET api/v1/shops' => ['class' => 'any', 'abilities' => ['donor', 'merchant', 'anon'], 'query' => 'near'],
            'GET api/v1/shops/{slug}' => ['class' => 'any', 'abilities' => ['donor', 'merchant', 'anon']],
            'POST api/v1/shops' => ['class' => 'merchant', 'abilities' => ['merchant'], 'shop' => 'not-staff', 'payload' => 'shop'],
            'PATCH api/v1/shops/{id}' => ['class' => 'merchant', 'abilities' => ['merchant'], 'shop' => 'owner', 'payload' => 'shop-change'],
            'GET api/v1/shops/{id}/items' => ['class' => 'merchant', 'abilities' => ['merchant'], 'shop' => 'member'],
            'POST api/v1/shops/{id}/items' => ['class' => 'merchant', 'abilities' => ['merchant'], 'shop' => 'owner', 'payload' => 'item'],
            'PATCH api/v1/shops/{id}/items/{itemId}' => ['class' => 'merchant', 'abilities' => ['merchant'], 'shop' => 'owner', 'payload' => 'item-change'],
            'POST api/v1/shops/{id}/documents/presign' => ['class' => 'merchant', 'abilities' => ['merchant'], 'shop' => 'owner', 'payload' => 'presign'],
            'POST api/v1/shops/{id}/documents/{documentId}/confirm' => ['class' => 'merchant', 'abilities' => ['merchant'], 'shop' => 'owner'],

            // Reservation and redemption (matrix 3.4)
            'POST api/v1/hooks/reserve' => ['class' => 'anon', 'abilities' => ['anon'], 'payload' => 'reserve'],
            'POST api/v1/shops/{shop}/redeem' => ['class' => 'merchant', 'abilities' => ['merchant'], 'shop' => 'member', 'payload' => 'redeem'],
            'GET api/v1/shops/{shop}/redemptions' => ['class' => 'merchant', 'abilities' => ['merchant'], 'shop' => 'member'],

            // Impact (matrix 3.5)
            'GET api/v1/impact' => self::open(null),
        ];
    }

    /**
     * @return Entry
     */
    private static function open(?string $payload): array
    {
        $entry = ['class' => 'public', 'abilities' => []];

        if ($payload !== null) {
            $entry['payload'] = $payload;
        }

        return $entry;
    }
}
