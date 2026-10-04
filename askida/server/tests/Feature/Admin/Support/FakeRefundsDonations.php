<?php

namespace Tests\Feature\Admin\Support;

use App\Domain\Admin\Contracts\RefundsDonations;
use App\Domain\Donations\Models\Donation;
use App\Models\User;

/**
 * Stands in for the payments domain refund service in panel tests.
 */
final class FakeRefundsDonations implements RefundsDonations
{
    /** @var list<array{string, string, string}> */
    public array $calls = [];

    public function refund(Donation $donation, User $actor, string $reason): Donation
    {
        $this->calls[] = [$donation->id, $actor->id, $reason];

        return $donation;
    }
}
