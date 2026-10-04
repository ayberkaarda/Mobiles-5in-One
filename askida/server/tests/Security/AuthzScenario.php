<?php

namespace Tests\Security;

use App\Domain\Anon\Models\AnonDevice;
use App\Domain\Auth\Abilities\AdminRole;
use App\Domain\Donations\Models\Donation;
use App\Domain\Hooks\Models\Hook;
use App\Domain\Items\Models\Item;
use App\Domain\Shops\Models\Shop;
use App\Domain\Shops\Models\ShopDocument;
use App\Domain\Shops\Models\ShopMember;
use App\Domain\Shops\Models\ShopMemberRole;
use App\Models\User;
use Database\Seeders\RolesSeeder;
use InvalidArgumentException;

/**
 * One shop world for authorization tests: a verified target shop with an owner and a
 * staff member, an item and a hook of that shop, a donor with a donation to it, a
 * document of the shop, an anon device and the three admin roles.
 *
 * API actors carry a real personal access token with the ability of their kind (never
 * a transient token, which would pass every ability check). Admin actors have no token:
 * they stand for a panel session.
 */
final class AuthzScenario
{
    public readonly Shop $shop;

    public readonly Item $item;

    public readonly Donation $donation;

    public readonly Hook $hook;

    public readonly ShopDocument $document;

    /** @var array<string, User|AnonDevice|null> */
    private array $actors;

    public function __construct()
    {
        (new RolesSeeder)->run();

        $this->shop = Shop::factory()->verified()->create();
        $owner = self::merchant();
        $staff = self::merchant();
        self::join($this->shop, $owner, ShopMemberRole::Owner);
        self::join($this->shop, $staff, ShopMemberRole::Staff);

        $donor = self::donor();
        $this->item = Item::factory()->for($this->shop)->create();
        $this->donation = Donation::factory()->paid()->for($this->item)->for($donor, 'donor')->create();
        $this->hook = Hook::factory()->for($this->donation)->create();
        $this->document = ShopDocument::factory()->for($this->shop)->create();

        $this->actors = [
            'guest' => null,
            'donor' => $donor,
            'owner' => $owner,
            'staff' => $staff,
            'anon' => AnonDevice::factory()->create(),
            'mod' => self::admin(AdminRole::Moderator),
            'fin' => self::admin(AdminRole::Finance),
            'admin' => self::admin(AdminRole::Admin),
        ];
    }

    public function actor(string $principal): User|AnonDevice|null
    {
        if (! array_key_exists($principal, $this->actors)) {
            throw new InvalidArgumentException("Unknown principal {$principal}.");
        }

        return $this->actors[$principal];
    }

    /**
     * Resolves dataset arguments: fixture names become models, class strings stay.
     *
     * @param  list<string>  $args
     * @return list<mixed>
     */
    public function arguments(array $args): array
    {
        return array_map(fn (string $arg): mixed => match ($arg) {
            'shop' => $this->shop,
            'item' => $this->item,
            'donation' => $this->donation,
            'hook' => $this->hook,
            'document' => $this->document,
            default => $arg,
        }, $args);
    }

    public static function donor(): User
    {
        return self::withToken(User::factory()->donor()->create());
    }

    public static function merchant(): User
    {
        return self::withToken(User::factory()->merchant()->create());
    }

    /**
     * Attaches a real personal access token carrying exactly the kind's ability, as the
     * device token issuer does.
     */
    public static function withToken(User $user): User
    {
        $token = $user->createToken('authz-test', [$user->kind->ability()])->accessToken;

        return $user->withAccessToken($token);
    }

    public static function admin(AdminRole $role): User
    {
        $user = User::factory()->create();
        $user->assignRole($role->value);

        return $user;
    }

    public static function join(Shop $shop, User $user, ShopMemberRole $role): void
    {
        ShopMember::factory()->for($shop)->for($user)->state(['role' => $role])->create();
    }
}
