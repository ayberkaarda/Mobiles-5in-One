<?php

namespace App\Domain\Shops\Services;

use App\Domain\Auth\Abilities\AdminPermission;
use App\Domain\Shops\Events\ShopRejected;
use App\Domain\Shops\Events\ShopVerified;
use App\Domain\Shops\Exceptions\IllegalVerificationTransition;
use App\Domain\Shops\Models\Shop;
use App\Domain\Shops\Models\ShopVerificationState;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * The shop verification state machine:
 *
 *   pending  -> verified   (admin or moderator: verify)
 *   pending  -> rejected   (admin or moderator: reject)
 *   rejected -> pending    (the owner re-submits by editing the shop)
 *   verified -> pending    (the owner changed a sensitive field)
 *
 * Every other change is refused with IllegalVerificationTransition. Each transition
 * locks the shop row, writes one activity log entry holding ids and state names only,
 * and verify/reject dispatch ShopVerified/ShopRejected after the commit.
 */
final class ShopVerificationService
{
    public const LOG_NAME = 'shops';

    /**
     * Approve a pending shop. Requires the `manage-shops` gate (admin, moderator).
     */
    public function verify(Shop $shop, User $actor): Shop
    {
        Gate::forUser($actor)->authorize(AdminPermission::VerifyShops->gate());

        $shop = $this->transition($shop, ShopVerificationState::Verified, [ShopVerificationState::Pending], $actor, 'shop.verified');

        ShopVerified::dispatch($shop->id, $actor->id);

        return $shop;
    }

    /**
     * Reject a pending shop. Requires the `manage-shops` gate (admin, moderator).
     */
    public function reject(Shop $shop, User $actor): Shop
    {
        Gate::forUser($actor)->authorize(AdminPermission::VerifyShops->gate());

        $shop = $this->transition($shop, ShopVerificationState::Rejected, [ShopVerificationState::Pending], $actor, 'shop.rejected');

        ShopRejected::dispatch($shop->id, $actor->id);

        return $shop;
    }

    /**
     * A rejected shop goes back to the queue after its owner edited it. The caller has
     * already authorized the owner's edit.
     */
    public function resubmit(Shop $shop, User $owner): Shop
    {
        return $this->transition($shop, ShopVerificationState::Pending, [ShopVerificationState::Rejected], $owner, 'shop.resubmitted');
    }

    /**
     * A verified shop goes back to the queue because its owner changed a sensitive
     * field. Only the field names are logged, never the values.
     *
     * @param  list<string>  $fields
     */
    public function reopen(Shop $shop, User $owner, array $fields): Shop
    {
        return $this->transition($shop, ShopVerificationState::Pending, [ShopVerificationState::Verified], $owner, 'shop.reopened', ['fields' => $fields]);
    }

    /**
     * @param  list<ShopVerificationState>  $allowedFrom
     * @param  array<string, mixed>  $extra
     */
    private function transition(Shop $shop, ShopVerificationState $to, array $allowedFrom, User $actor, string $event, array $extra = []): Shop
    {
        return DB::transaction(function () use ($shop, $to, $allowedFrom, $actor, $event, $extra): Shop {
            /** @var Shop $locked */
            $locked = Shop::query()->whereKey($shop->getKey())->lockForUpdate()->firstOrFail();
            $from = $locked->verification_state;

            if (! in_array($from, $allowedFrom, true)) {
                throw IllegalVerificationTransition::between($from, $to);
            }

            $locked->forceFill([
                'verification_state' => $to,
                'verified_at' => $to === ShopVerificationState::Verified ? now() : null,
            ])->save();

            activity(self::LOG_NAME)
                ->performedOn($locked)
                ->causedBy($actor)
                ->event($event)
                ->withProperties(['from' => $from->value, 'to' => $to->value, ...$extra])
                ->log($event);

            return $locked;
        });
    }
}
