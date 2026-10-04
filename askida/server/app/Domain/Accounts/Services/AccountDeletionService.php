<?php

namespace App\Domain\Accounts\Services;

use App\Domain\Accounts\Mail\AccountDeletionRequestedMail;
use App\Domain\Auth\Models\DeletionChannel;
use App\Domain\Auth\Models\DeletionRequest;
use App\Domain\Auth\Models\DeletionRequestStatus;
use App\Domain\Auth\Models\KvkkConsent;
use App\Domain\Donations\Models\Donation;
use App\Domain\Hooks\Models\Hook;
use App\Domain\Hooks\Models\HookStatus;
use App\Domain\Payments\Models\Payout;
use App\Domain\Shops\Models\Shop;
use App\Domain\Shops\Models\ShopDocument;
use App\Domain\Shops\Models\ShopMember;
use App\Domain\Shops\Models\ShopMemberRole;
use App\Domain\Shops\Models\ShopVerificationState;
use App\Models\User;
use App\Support\Problem\ProblemCode;
use App\Support\Problem\ProblemException;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Storage;
use Spatie\Activitylog\Models\Activity;

/**
 * Account deletion (security checklist item 21).
 *
 * 1. request(): the caller has already re-authenticated the user. The account is
 *    deactivated at once (every access token and push token removed), a pending
 *    deletion request with a GRACE_DAYS grace period is stored and a confirmation
 *    mail is queued. A merchant whose solely owned shop still has AVAILABLE or
 *    RESERVED units is refused with `shop.has_open_hooks`.
 * 2. cancelPending(): a sign-in during the grace period cancels the request and
 *    reactivates the account (see SignInReactivation).
 * 3. hardDelete(): after the grace period the personal data is erased: the user row,
 *    KVKK consents, access tokens, one-time codes, push tokens and role links are
 *    removed; donations stay with donor_id = NULL and anonymized_at set; solely owned
 *    shops lose their documents (objects and rows) and members, and are removed when
 *    no financial record points at them, otherwise they stay as an ownerless, closed
 *    accounting anchor. Activity log entries of the user keep identifiers only.
 */
class AccountDeletionService
{
    public const GRACE_DAYS = 7;

    public const LOG_NAME = 'accounts';

    public function __construct(private readonly PushTokenRegistry $pushTokens) {}

    /**
     * @throws ProblemException `shop.has_open_hooks` (409) for a merchant with open units
     */
    public function request(User $user, DeletionChannel $channel): DeletionRequest
    {
        $deletion = DB::transaction(function () use ($user, $channel): DeletionRequest {
            /** @var User $locked */
            $locked = User::query()->whereKey($user->getKey())->lockForUpdate()->firstOrFail();

            $this->assertNoOpenHooks($locked);

            $now = Carbon::now();

            $locked->forceFill(['deactivated_at' => $now])->save();
            $locked->tokens()->delete();
            $this->pushTokens->forgetAll($locked);

            $deletion = new DeletionRequest;
            $deletion->user_id = $locked->id;
            $deletion->channel = $channel;
            $deletion->status = DeletionRequestStatus::Pending;
            $deletion->requested_at = $now->toImmutable();
            $deletion->grace_until = $now->toImmutable()->addDays(self::GRACE_DAYS);
            $deletion->save();

            activity(self::LOG_NAME)
                ->performedOn($deletion)
                ->causedBy($locked)
                ->event('deletion_requested')
                ->withProperties(['deletion_request_id' => $deletion->id, 'channel' => $channel->value])
                ->log('account.deletion_requested');

            Mail::to($locked->email)->queue(new AccountDeletionRequestedMail($locked->name, $deletion->grace_until));

            return $deletion;
        });

        $user->forceFill(['deactivated_at' => $deletion->requested_at])->syncOriginal();

        return $deletion;
    }

    /**
     * Cancels the user's pending request when its grace period is still running and
     * reactivates the account. Accounts deactivated for any other reason stay closed.
     */
    public function cancelPending(User $user): bool
    {
        $cancelled = DB::transaction(function () use ($user): bool {
            $deletion = DeletionRequest::query()
                ->where('user_id', $user->id)
                ->where('status', DeletionRequestStatus::Pending->value)
                ->where('grace_until', '>', Carbon::now())
                ->lockForUpdate()
                ->first();

            if ($deletion === null) {
                return false;
            }

            $deletion->status = DeletionRequestStatus::Cancelled;
            $deletion->cancelled_at = Carbon::now()->toImmutable();
            $deletion->save();

            User::query()->whereKey($user->getKey())->update(['deactivated_at' => null]);

            activity(self::LOG_NAME)
                ->performedOn($deletion)
                ->causedBy($user)
                ->event('deletion_cancelled')
                ->withProperties(['deletion_request_id' => $deletion->id])
                ->log('account.deletion_cancelled');

            return true;
        });

        if ($cancelled) {
            $user->forceFill(['deactivated_at' => null])->syncOriginal();
        }

        return $cancelled;
    }

    /**
     * Runs every request whose grace period is over. A request that is refused (open
     * units) stays pending and is tried again on the next run.
     *
     * @return array{completed: int, deferred: int}
     */
    public function hardDeleteDue(): array
    {
        $summary = ['completed' => 0, 'deferred' => 0];

        $due = DeletionRequest::query()
            ->where('status', DeletionRequestStatus::Pending->value)
            ->where('grace_until', '<=', Carbon::now())
            ->orderBy('grace_until')
            ->pluck('id');

        foreach ($due as $id) {
            try {
                if ($this->hardDelete((string) $id)) {
                    $summary['completed']++;
                }
            } catch (ProblemException $refusal) {
                if ($refusal->problem !== ProblemCode::ShopHasOpenHooks) {
                    throw $refusal;
                }

                $summary['deferred']++;

                activity(self::LOG_NAME)
                    ->event('hard_delete_deferred')
                    ->withProperties(['deletion_request_id' => (string) $id, 'reason' => $refusal->problem->value])
                    ->log('account.hard_delete_deferred');

                Log::info('account hard delete deferred', ['deletion_request_id' => (string) $id]);
            }
        }

        return $summary;
    }

    /**
     * Erases the personal data of one due request.
     *
     * @return bool true when the request was completed by this call
     *
     * @throws ProblemException `shop.has_open_hooks` (409) while a solely owned shop has open units
     */
    public function hardDelete(string $deletionRequestId): bool
    {
        return DB::transaction(function () use ($deletionRequestId): bool {
            $deletion = DeletionRequest::query()
                ->whereKey($deletionRequestId)
                ->where('status', DeletionRequestStatus::Pending->value)
                ->where('grace_until', '<=', Carbon::now())
                ->lock('FOR UPDATE SKIP LOCKED')
                ->first();

            if ($deletion === null) {
                return false;
            }

            $user = $deletion->user_id === null
                ? null
                : User::query()->whereKey($deletion->user_id)->lockForUpdate()->first();

            if ($user !== null && ! $user->isDeactivated()) {
                // Reactivated through another path: nothing to erase.
                $deletion->status = DeletionRequestStatus::Cancelled;
                $deletion->cancelled_at = Carbon::now()->toImmutable();
                $deletion->save();

                return false;
            }

            if ($user !== null) {
                $this->assertNoOpenHooks($user);
                $this->erase($user);
            }

            $deletion->status = DeletionRequestStatus::Completed;
            $deletion->completed_at = Carbon::now()->toImmutable();
            $deletion->save();

            $userId = $user?->id;
            $user?->delete();

            activity(self::LOG_NAME)
                ->performedOn($deletion)
                ->event('hard_deleted')
                ->withProperties(['deletion_request_id' => $deletion->id, 'user_id' => $userId])
                ->log('account.hard_deleted');

            return true;
        });
    }

    /**
     * Shops whose only owner is this user: the user is the recorded owner and no other
     * member holds the owner role.
     *
     * @return Builder<Shop>
     */
    public function solelyOwnedShops(User $user): Builder
    {
        return Shop::query()
            ->where('owner_id', $user->id)
            ->whereNotExists(function ($query) use ($user): void {
                $query->selectRaw('1')
                    ->from('shop_members')
                    ->whereColumn('shop_members.shop_id', 'shops.id')
                    ->where('shop_members.role', ShopMemberRole::Owner->value)
                    ->where('shop_members.user_id', '<>', $user->id);
            });
    }

    public function hasOpenHooks(User $user): bool
    {
        return Hook::query()
            ->whereIn('shop_id', $this->solelyOwnedShops($user)->select('id'))
            ->whereIn('status', [HookStatus::Available->value, HookStatus::Reserved->value])
            ->exists();
    }

    private function assertNoOpenHooks(User $user): void
    {
        if ($this->hasOpenHooks($user)) {
            throw ProblemException::make(ProblemCode::ShopHasOpenHooks, 409);
        }
    }

    private function erase(User $user): void
    {
        $now = Carbon::now();

        Donation::query()->where('donor_id', $user->id)->update(['donor_id' => null, 'anonymized_at' => $now]);
        Hook::query()->where('redeemed_by_user_id', $user->id)->update(['redeemed_by_user_id' => null]);

        $this->releaseShops($user);

        ShopMember::query()->where('user_id', $user->id)->delete();
        KvkkConsent::query()->where('user_id', $user->id)->delete();
        DB::table('password_reset_tokens')->where('user_id', $user->id)->delete();
        $user->tokens()->delete();
        $this->pushTokens->forgetAll($user);
        $user->roles()->detach();
        $user->permissions()->detach();

        $this->scrubActivityLog($user);
    }

    /**
     * Solely owned shops lose documents and members and are removed, or kept as an
     * ownerless closed anchor when donations or payouts reference them (those rows
     * are retained financial records, ADR-0005). Co-owned shops pass to the earliest
     * remaining owner.
     */
    private function releaseShops(User $user): void
    {
        /** @var Collection<int, Shop> $owned */
        $owned = Shop::query()->where('owner_id', $user->id)->lockForUpdate()->get();
        $soleIds = $this->solelyOwnedShops($user)->pluck('id')->all();

        foreach ($owned as $shop) {
            if (! in_array($shop->id, $soleIds, true)) {
                $successor = ShopMember::query()
                    ->where('shop_id', $shop->id)
                    ->where('role', ShopMemberRole::Owner->value)
                    ->where('user_id', '<>', $user->id)
                    ->orderBy('created_at')
                    ->orderBy('id')
                    ->value('user_id');

                $shop->owner_id = is_string($successor) ? $successor : null;
                $shop->save();

                continue;
            }

            $this->deleteDocuments($shop);
            ShopMember::query()->where('shop_id', $shop->id)->delete();

            $hasFinancialRecords = Donation::query()->where('shop_id', $shop->id)->exists()
                || Payout::query()->where('shop_id', $shop->id)->exists();

            if (! $hasFinancialRecords) {
                $shop->items()->delete();
                $shop->delete();

                continue;
            }

            $shop->owner_id = null;
            $shop->phone = '';
            $shop->verification_state = ShopVerificationState::Rejected;
            $shop->listed_on_web = false;
            $shop->save();
        }
    }

    private function deleteDocuments(Shop $shop): void
    {
        $disk = Storage::disk((string) config('filesystems.private_disk', 'private'));

        ShopDocument::query()->where('shop_id', $shop->id)->get()->each(function (ShopDocument $document) use ($disk): void {
            $disk->delete($document->path);
            $document->delete();
        });
    }

    /**
     * Activity entries caused by or about the user keep their identifiers only: every
     * property value that is not an id (UUID or integer) is dropped.
     */
    private function scrubActivityLog(User $user): void
    {
        Activity::query()
            ->where(function (Builder $query) use ($user): void {
                $query->where(fn (Builder $q) => $q->where('causer_type', $user->getMorphClass())->where('causer_id', $user->id))
                    ->orWhere(fn (Builder $q) => $q->where('subject_type', $user->getMorphClass())->where('subject_id', $user->id));
            })
            ->get()
            ->each(function (Activity $activity): void {
                $properties = $activity->properties?->toArray() ?? [];
                $activity->properties = collect(IdentifiersOnly::filter($properties));
                $activity->save();
            });
    }
}
