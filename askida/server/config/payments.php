<?php

/*
|--------------------------------------------------------------------------
| Payments
|--------------------------------------------------------------------------
|
| The platform never holds funds: the provider settles to the shop's
| sub-merchant account and the platform books only its commission.
| Provider credentials and the base url live in config/services.php (iyzico).
| Amounts are integers in kuruş (TRY minor units).
|
*/

return [

    /*
    | Gateway implementation: `iyzico` or `fake`. The fake gateway is refused at boot in
    | production-like environments (see PaymentsServiceProvider).
    */
    'provider' => env('PAYMENT_PROVIDER', 'fake'),

    /*
    | Platform commission in basis points (100 = 1%). 500 (5%) is a SAMPLE rate for
    | demonstration; the real rate is a business decision.
    */
    'commission_bps' => (int) env('COMMISSION_BPS', 500),

    /*
    | Donation caps in kuruş. Per transaction (TRY 2000) and per donor and day in the
    | Europe/Istanbul calendar (TRY 5000).
    */
    'caps' => [
        'transaction_minor' => 200_000,
        'donor_day_minor' => 500_000,
        // An `initiated` donation counts towards the day cap for this many minutes.
        'initiated_window_minutes' => 30,
    ],

    /*
    | Webhooks older than this many seconds are rejected as stale (replay protection).
    */
    'webhook_max_age_seconds' => (int) env('WEBHOOK_MAX_AGE_SECONDS', 300),

    /*
    | Recipient of reconciliation mismatch and fraud alerts.
    */
    'finance_alert_email' => env('FINANCE_ALERT_EMAIL', 'finance@example.test'),

    /*
    | Fraud scan thresholds. A shop above any of them has its pending payouts held.
    */
    'fraud' => [
        'max_redeems_per_hour' => (int) env('FRAUD_MAX_REDEEMS_PER_HOUR', 30),
        'max_self_redeem_ratio' => (float) env('FRAUD_MAX_SELF_REDEEM_RATIO', 0.5),
        // Number of `suspicious_self_redeem` entries that triggers a hold.
        'max_suspicious_self_redeems' => 3,
    ],

];
