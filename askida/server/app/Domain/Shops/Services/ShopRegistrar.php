<?php

namespace App\Domain\Shops\Services;

use App\Domain\Shops\Models\GeoPoint;
use App\Domain\Shops\Models\Shop;
use App\Domain\Shops\Models\ShopMember;
use App\Domain\Shops\Models\ShopMemberRole;
use App\Domain\Shops\Models\ShopVerificationState;
use App\Models\User;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;

/**
 * Creates and edits shops for their owners.
 *
 * Input arrays carry the validated request fields: name, type, address, il, ilce, lat,
 * lng, phone, tax_number, iban, listed_on_web. The tax number and IBAN are written
 * through the model's encrypted casts only.
 */
final class ShopRegistrar
{
    /**
     * Changing one of these sends a verified shop back to `pending` (draft rule D-2).
     */
    public const SENSITIVE_FIELDS = ['address', 'il', 'ilce', 'location', 'tax_number', 'iban'];

    private const SLUG_ATTEMPTS = 3;

    public function __construct(
        private readonly ShopSlugger $slugger,
        private readonly ShopVerificationService $verification,
    ) {}

    /**
     * @param  array<string, mixed>  $data
     */
    public function register(User $owner, array $data): Shop
    {
        $name = (string) $data['name'];
        $ilce = (string) $data['ilce'];

        for ($attempt = 1; ; $attempt++) {
            $slug = $attempt === 1
                ? $this->slugger->unique($name, $ilce)
                : $this->slugger->withRandomSuffix($name, $ilce);

            try {
                return DB::transaction(function () use ($owner, $data, $slug): Shop {
                    $shop = new Shop;
                    $this->fillEditable($shop, $data);
                    $shop->forceFill([
                        'owner_id' => $owner->id,
                        'slug' => $slug,
                        'verification_state' => ShopVerificationState::Pending,
                        'verified_at' => null,
                        'is_sample' => false,
                        'listed_on_web' => (bool) $data['listed_on_web'],
                    ])->save();

                    $member = new ShopMember(['role' => ShopMemberRole::Owner]);
                    $member->forceFill(['shop_id' => $shop->id, 'user_id' => $owner->id])->save();

                    return $shop;
                });
            } catch (UniqueConstraintViolationException $exception) {
                if ($attempt >= self::SLUG_ATTEMPTS) {
                    throw $exception;
                }
            }
        }
    }

    /**
     * Applies an owner's edit. A real change to a sensitive field is recorded (field
     * names only) and sends a verified shop back to `pending`; any real change to a
     * rejected shop re-submits it. The slug stays stable so published links keep working.
     *
     * @param  array<string, mixed>  $data
     */
    public function update(Shop $shop, User $owner, array $data): Shop
    {
        return DB::transaction(function () use ($shop, $owner, $data): Shop {
            /** @var Shop $locked */
            $locked = Shop::query()->whereKey($shop->getKey())->lockForUpdate()->firstOrFail();

            $changed = $this->fillEditable($locked, $data);

            if (array_key_exists('listed_on_web', $data) && (bool) $data['listed_on_web'] !== $locked->listed_on_web) {
                $locked->forceFill(['listed_on_web' => (bool) $data['listed_on_web']]);
                $changed[] = 'listed_on_web';
            }

            if ($changed === []) {
                return $locked;
            }

            $locked->save();

            $sensitive = array_values(array_intersect(self::SENSITIVE_FIELDS, $changed));

            if ($sensitive !== []) {
                activity(ShopVerificationService::LOG_NAME)
                    ->performedOn($locked)
                    ->causedBy($owner)
                    ->event('shop.sensitive_change')
                    ->withProperties(['fields' => $sensitive])
                    ->log('shop.sensitive_change');
            }

            return match (true) {
                $locked->verification_state === ShopVerificationState::Verified && $sensitive !== [] => $this->verification->reopen($locked, $owner, $sensitive),
                $locked->verification_state === ShopVerificationState::Rejected => $this->verification->resubmit($locked, $owner),
                default => $locked,
            };
        });
    }

    /**
     * Writes the client-editable fields present in $data and returns the names of the
     * fields whose value actually changed.
     *
     * @param  array<string, mixed>  $data
     * @return list<string>
     */
    private function fillEditable(Shop $shop, array $data): array
    {
        $changed = [];

        foreach (['name', 'type', 'address', 'il', 'ilce', 'phone'] as $field) {
            if (array_key_exists($field, $data) && $shop->getAttribute($field) !== (string) $data[$field]) {
                $shop->setAttribute($field, (string) $data[$field]);
                $changed[] = $field;
            }
        }

        if (array_key_exists('lat', $data) && array_key_exists('lng', $data)) {
            $point = new GeoPoint((float) $data['lat'], (float) $data['lng']);
            $current = $shop->exists ? $shop->location : null;

            if ($current === null
                || abs($current->latitude - $point->latitude) > 1e-7
                || abs($current->longitude - $point->longitude) > 1e-7) {
                $shop->location = $point;
                $changed[] = 'location';
            }
        }

        $encrypted = ['tax_number' => 'tax_number_enc', 'iban' => 'iban_enc'];

        foreach ($encrypted as $field => $column) {
            if (array_key_exists($field, $data) && $shop->getAttribute($column) !== (string) $data[$field]) {
                $shop->setAttribute($column, (string) $data[$field]);
                $changed[] = $field;
            }
        }

        return $changed;
    }
}
