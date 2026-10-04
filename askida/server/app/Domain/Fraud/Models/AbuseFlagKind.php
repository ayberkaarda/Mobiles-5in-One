<?php

namespace App\Domain\Fraud\Models;

/**
 * Kinds of `abuse_flags` rows written by the payouts area. At most one unreviewed flag
 * exists per shop and kind.
 */
enum AbuseFlagKind: string
{
    /** Sub-merchant onboarding gave up (attempts exhausted or incomplete shop data). */
    case OnboardingFailed = 'onboarding_failed';

    /** More redemptions within the scan window than FRAUD_MAX_REDEEMS_PER_HOUR. */
    case RedeemRate = 'redeem_rate';

    /** Share of self-redemptions within the scan window above FRAUD_MAX_SELF_REDEEM_RATIO. */
    case SelfRedeemRatio = 'self_redeem_ratio';

    /** More `suspicious_self_redeem` entries within the scan window than allowed. */
    case SelfRedeemCount = 'self_redeem_count';

    /**
     * Kinds that put the shop's payouts on hold.
     *
     * @return list<self>
     */
    public static function fraudKinds(): array
    {
        return [self::RedeemRate, self::SelfRedeemRatio, self::SelfRedeemCount];
    }

    public function holdReason(): string
    {
        return 'fraud.'.$this->value;
    }
}
