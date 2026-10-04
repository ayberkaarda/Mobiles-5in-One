<?php

namespace Tests\Support;

use App\Domain\Donations\Models\Donation;
use App\Domain\Donations\Models\DonationStatus;
use App\Domain\Payments\Contracts\SettlesPayments;
use App\Domain\Payments\Data\SettlementOutcome;
use App\Domain\Payments\Exceptions\GatewayUnavailable;
use Closure;

/**
 * Stand-in for the settlement service: records every call and answers with a scripted
 * outcome. With `applyTransitions` it also moves the donation to paid or failed, so a
 * reconciliation test can observe that a missed transition was fixed.
 */
final class RecordingSettler implements SettlesPayments
{
    /** @var list<string> */
    public array $calls = [];

    /** @var array<string, SettlementOutcome|GatewayUnavailable> */
    public array $outcomes = [];

    public SettlementOutcome $default = SettlementOutcome::Pending;

    /** @var (Closure(string): ?SettlementOutcome)|null */
    public ?Closure $resolver = null;

    public bool $applyTransitions = false;

    public function settle(string $providerToken): SettlementOutcome
    {
        $this->calls[] = $providerToken;

        $outcome = $this->outcomes[$providerToken] ?? null;

        if ($outcome === null && $this->resolver !== null) {
            $outcome = ($this->resolver)($providerToken);
        }

        $outcome ??= $this->default;

        if ($outcome instanceof GatewayUnavailable) {
            throw $outcome;
        }

        if ($this->applyTransitions) {
            $donation = Donation::query()->where('provider_token', $providerToken)->first();

            if ($donation !== null && $donation->status === DonationStatus::Initiated) {
                if ($outcome === SettlementOutcome::Paid) {
                    $donation->forceFill(['status' => DonationStatus::Paid, 'paid_at' => now()])->save();
                } elseif ($outcome === SettlementOutcome::Failed) {
                    $donation->forceFill(['status' => DonationStatus::Failed])->save();
                }
            }
        }

        return $outcome;
    }
}
