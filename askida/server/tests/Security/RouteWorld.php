<?php

namespace Tests\Security;

use App\Domain\Anon\Models\AnonDevice;
use App\Domain\Items\Models\Item;
use App\Domain\Shops\Models\Shop;
use App\Domain\Shops\Models\ShopDocument;
use App\Domain\Shops\Models\ShopMemberRole;
use App\Models\User;
use Illuminate\Support\Facades\Http;
use InvalidArgumentException;
use Laravel\Sanctum\PersonalAccessToken;
use Tests\Feature\Api\Auth\Support\AuthTestKit;
use Tests\Feature\Api\Hooks\Support\HookWorld;
use Tests\Feature\Api\Shops\Support\ShopTestKit;

/**
 * One world for the route-level authorization checks: a verified shop with an owner and
 * a staff member, an item, a pending document, a donor and an anon device. Tokens are
 * issued by the real issuers, so the token rules run exactly as in production.
 */
final class RouteWorld
{
    public readonly Shop $shop;

    public readonly Item $item;

    public readonly ShopDocument $document;

    public readonly User $owner;

    public readonly User $staff;

    public readonly User $donor;

    public readonly AnonDevice $device;

    public function __construct()
    {
        AuthTestKit::boot();
        HookWorld::pepper();
        Http::allowStrayRequests([rtrim((string) config('filesystems.disks.private.endpoint'), '/').'/*']);

        $this->owner = ShopTestKit::merchant();
        $this->shop = ShopTestKit::shop($this->owner);
        $this->staff = ShopTestKit::merchant();
        ShopTestKit::join($this->shop, $this->staff, ShopMemberRole::Staff);
        $this->item = ShopTestKit::item($this->shop);
        $this->document = ShopDocument::factory()->for($this->shop)->create(['uploaded_at' => null]);
        $this->donor = ShopTestKit::donor();
        $this->device = HookWorld::anon();
    }

    /**
     * Bearer token for a principal, or null for a guest.
     *
     * - guest, donor, owner, staff, anon: as their names say;
     * - banned-anon: a device banned after its token was issued;
     * - deactivated: the token of a user whose account was deactivated afterwards
     *   (the owner on merchant routes, the donor elsewhere);
     * - revoked: a token deleted after issue (same choice of user).
     */
    public function token(string $principal, string $class): ?string
    {
        $userFor = fn (): User => $class === 'merchant' ? $this->owner : $this->donor;

        switch ($principal) {
            case 'guest':
                return null;
            case 'donor':
                return AuthTestKit::token($this->donor);
            case 'owner':
                return AuthTestKit::token($this->owner);
            case 'staff':
                return AuthTestKit::token($this->staff);
            case 'anon':
                return HookWorld::anonToken($this->device);
            case 'banned-anon':
                $token = HookWorld::anonToken($this->device);
                $this->device->forceFill(['banned_at' => now()])->save();

                return $token;
            case 'deactivated':
                $user = $userFor();
                $token = AuthTestKit::token($user);
                $user->forceFill(['deactivated_at' => now()])->save();

                return $token;
            case 'revoked':
                $token = AuthTestKit::token($userFor());
                PersonalAccessToken::findToken($token)?->delete();

                return $token;
            default:
                throw new InvalidArgumentException("Unknown principal {$principal}.");
        }
    }

    /**
     * The concrete URI for a route key, with the world's ids and the named query.
     */
    public function uri(string $routeUri, ?string $query): string
    {
        $uri = '/'.strtr($routeUri, [
            '{id}' => (string) $this->shop->id,
            '{shop}' => (string) $this->shop->id,
            '{slug}' => (string) $this->shop->slug,
            '{itemId}' => (string) $this->item->id,
            '{documentId}' => (string) $this->document->id,
        ]);

        return match ($query) {
            null => $uri,
            'near' => $uri.'?near='.ShopTestKit::LAT.','.ShopTestKit::LNG,
            default => throw new InvalidArgumentException("Unknown query {$query}."),
        };
    }

    /**
     * A valid body for the named payload.
     *
     * @return array<string, mixed>
     */
    public function payload(?string $name): array
    {
        return match ($name) {
            null, 'empty' => [],
            'me' => ['name' => 'Yeni Ad'],
            'wrong-password' => ['password' => 'pw-'.bin2hex(random_bytes(6))],
            'push-token' => ['platform' => 'android', 'token' => 'device-'.bin2hex(random_bytes(16))],
            'shop' => ShopTestKit::payload(),
            'shop-change' => ['name' => 'Yeni Çınar Fırını'],
            'item' => ['name' => 'Simit', 'category' => 'ekmek', 'price_minor' => 1200, 'daily_cap' => 10],
            'item-change' => ['price_minor' => 1800],
            'presign' => ['kind' => 'vergi_levhasi', 'mime' => 'application/pdf', 'size' => 2048],
            'reserve' => ['shop_id' => $this->shop->id, 'item_id' => $this->item->id],
            'redeem' => ['code' => HookWorld::newCode()],
            default => throw new InvalidArgumentException("Unknown payload {$name}."),
        };
    }
}
