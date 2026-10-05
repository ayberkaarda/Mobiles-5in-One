<?php

namespace App\Domain\Push;

/**
 * Value of the `type` key in a push message's data. The app routes on it: `hooks.issued`
 * opens the redemptions of `shop_id` (merchant "Yeni askı"), `hook.redeemed` opens the
 * donation `donation_id` (donor "Askın alındı").
 */
enum PushType: string
{
    case HooksIssued = 'hooks.issued';
    case HookRedeemed = 'hook.redeemed';
}
