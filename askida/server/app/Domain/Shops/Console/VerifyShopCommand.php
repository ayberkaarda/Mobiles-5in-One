<?php

namespace App\Domain\Shops\Console;

use App\Domain\Shops\Exceptions\IllegalVerificationTransition;
use App\Domain\Shops\Models\Shop;
use App\Domain\Shops\Services\ShopVerificationService;
use App\Models\User;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Console\Command;
use Illuminate\Support\Str;

/**
 * Approves (or with --reject, rejects) a pending shop on behalf of an admin or moderator
 * account named by --actor. The account's roles are checked through the same gate the
 * admin panel uses; anyone else is refused.
 */
final class VerifyShopCommand extends Command
{
    /**
     * @var string
     */
    protected $signature = 'shops:verify
        {shop : Shop id or slug}
        {--reject : Reject instead of approve}
        {--actor= : Email of the admin or moderator account acting}';

    /**
     * @var string
     */
    protected $description = 'Approve or reject a pending shop as an admin or moderator';

    public function handle(ShopVerificationService $verification): int
    {
        $actorEmail = $this->option('actor');

        if (! is_string($actorEmail) || trim($actorEmail) === '') {
            $this->error('The --actor option (an admin or moderator email) is required.');

            return self::FAILURE;
        }

        $actor = User::query()->where('email', Str::lower(trim($actorEmail)))->first();

        if (! $actor instanceof User) {
            $this->error('No account with that email.');

            return self::FAILURE;
        }

        $shop = $this->findShop((string) $this->argument('shop'));

        if (! $shop instanceof Shop) {
            $this->error('No shop with that id or slug.');

            return self::FAILURE;
        }

        try {
            $shop = $this->option('reject')
                ? $verification->reject($shop, $actor)
                : $verification->verify($shop, $actor);
        } catch (AuthorizationException) {
            $this->error('The account is not allowed to verify shops.');

            return self::FAILURE;
        } catch (IllegalVerificationTransition) {
            $this->error('The shop is not pending verification.');

            return self::FAILURE;
        }

        $this->info("Shop {$shop->id} is now {$shop->verification_state->value}.");

        return self::SUCCESS;
    }

    private function findShop(string $value): ?Shop
    {
        $query = Shop::query();

        if (Str::isUuid($value)) {
            return $query->whereKey($value)->first();
        }

        return $query->where('slug', $value)->first();
    }
}
