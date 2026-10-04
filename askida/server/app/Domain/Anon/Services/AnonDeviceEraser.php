<?php

namespace App\Domain\Anon\Services;

use App\Domain\Anon\Auth\AnonTokenIssuer;
use App\Domain\Anon\Models\AnonDailyCounter;
use App\Domain\Anon\Models\AnonDevice;
use App\Domain\Hooks\Services\HookReleaseService;
use Illuminate\Support\Facades\DB;

/**
 * DELETE anon/me ("Verilerimi sıfırla", security item 21): immediately gives back the
 * device's live reservations, then deletes its tokens, daily counters and the device
 * row. Redeemed units lose their device link through the foreign key (SET NULL).
 */
class AnonDeviceEraser
{
    public function __construct(
        private readonly HookReleaseService $release,
        private readonly AnonTokenIssuer $tokens,
        private readonly AnonAttestationService $attestation,
    ) {}

    public function erase(AnonDevice $device): void
    {
        $anonId = $device->anon_id;

        DB::transaction(function () use ($device, $anonId): void {
            AnonDevice::query()->whereKey($device->getKey())->lockForUpdate()->first();

            $this->release->releaseForAnon($anonId);
            $this->tokens->revokeAll($device);
            AnonDailyCounter::query()->where('anon_id', $anonId)->delete();
            AnonDevice::query()->whereKey($device->getKey())->delete();
        });

        $this->attestation->forget($anonId);
    }
}
