<?php

use App\Domain\Accounts\Mail\AccountDeletionRequestedMail;
use App\Domain\Anon\Models\DevicePlatform;
use App\Domain\Fraud\Mail\PayoutHoldAlertMail;
use App\Domain\Hooks\Listeners\NotifyDonorRedeemed;
use App\Domain\Hooks\Listeners\NotifyShopNewHooks;
use App\Domain\Payments\Mail\DonationReceiptMail;
use App\Domain\Payments\Mail\DonationRefundedMail;
use App\Domain\Payments\Mail\PaymentMismatchAlertMail;
use App\Domain\Payments\Mail\SettlementMismatchMail;
use App\Domain\Push\PushMessage;
use App\Domain\Push\Transports\LogPushTransport;
use App\Mail\EmailVerificationCodeMail;
use App\Mail\PasswordResetCodeMail;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailer;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Symfony\Component\Mime\Email;
use Tests\Datasets\XssPayloads;
use Tests\Feature\Api\Auth\Support\AuthTestKit;
use Tests\Feature\Api\Shops\Support\ShopTestKit;
use Tests\Security\Xss\XssSurface;
use Tests\Security\Xss\XssWorld;

uses(RefreshDatabase::class);

/*
| Stored-XSS sweep, outgoing messages (security checklist item 16): the transactional mails
| (receipt, refund, finance alerts, account notices) and the push payloads. Mails are really
| rendered (HTML and text part) through the array mailer, not through Mail::fake. The HTML
| part is parsed: no script element, no event handler or javascript: attribute, the element
| structure equals the structure of the same mail with benign text of the same length, and the
| stored value is in a text node. The text part never contains a raw `<script` sequence.
*/

beforeEach(function (): void {
    config(['mail.default' => 'array']);
});

/**
 * Sends the mailable through the array mailer and returns its HTML and text parts.
 *
 * @return array{html: string, text: string}
 */
function renderMail(Mailable $mailable): array
{
    $mailer = app('mail.manager')->mailer('array');
    assert($mailer instanceof Mailer);

    $mailer->to('recipient@example.test')->sendNow($mailable);

    $messages = $mailer->getSymfonyTransport()->messages();
    $email = $messages->last()?->getOriginalMessage();

    expect($email)->toBeInstanceOf(Email::class);
    assert($email instanceof Email);

    return ['html' => (string) $email->getHtmlBody(), 'text' => (string) $email->getTextBody()];
}

/**
 * A benign string with the character count of the value.
 */
function benignLike(string $value): string
{
    return str_repeat('g', mb_strlen($value));
}

/**
 * Asserts one mail: HTML inert and structurally equal to the benign rendering, the value shown
 * as text, the text part free of raw script tags.
 *
 * @param  list<string>  $values  stored strings that the mail displays
 */
function assertMailInert(array $payloadMail, array $benignMail, array $values, string $surface): void
{
    // Some mails are plain text only (refund, finance alerts): then there is no HTML part to parse.
    if ($payloadMail['html'] !== '') {
        $dom = XssSurface::dom($payloadMail['html']);

        expect($dom->getElementsByTagName('script')->length)->toBe(0, "{$surface}: script element in the HTML part.");

        XssSurface::assertNoDangerousAttributes($dom);
        XssSurface::assertSameStructure($payloadMail['html'], $benignMail['html'], $surface.' (html)');
        XssSurface::assertNoRawScript($payloadMail['html'], $surface.' (html)');

        foreach ($values as $value) {
            XssSurface::assertDisplayedAsText($dom, $value);
        }
    }

    expect($payloadMail['html'].$payloadMail['text'])->not->toBe('');

    XssSurface::assertNoRawScript($payloadMail['text'], $surface.' (text)');

    // The text part is escaped by the template too: the value is delivered, as characters, never as a raw tag.
    foreach ($values as $value) {
        expect($payloadMail['text'])->toContain(e($value));

        if (str_contains($value, '<')) {
            expect($payloadMail['text'])->not->toContain($value);
        }
    }
}

it('renders shop and item names in the receipt and the refund mail as text', function (string $payload): void {
    $world = XssWorld::listedShop($this, $payload);
    $shop = $world['shop'];
    $item = $world['item'];

    $receipt = static fn (string $shopName, string $itemName): array => renderMail(new DonationReceiptMail(
        (string) Str::uuid7(), $shopName, $itemName, 2, 3000, 300, CarbonImmutable::now(),
    ));
    $refund = static fn (string $shopName, string $itemName): array => renderMail(new DonationRefundedMail($itemName, $shopName, 2, 3000));

    assertMailInert($receipt($shop->name, $item->name), $receipt(benignLike($shop->name), benignLike($item->name)), [$shop->name, $item->name], 'receipt');
    assertMailInert($refund($shop->name, $item->name), $refund(benignLike($shop->name), benignLike($item->name)), [$shop->name, $item->name], 'refund');
})->with(XssPayloads::everything());

it('renders account names in the verification, reset and deletion mails as text', function (string $payload): void {
    $donor = ShopTestKit::donor();
    $token = AuthTestKit::token($donor);
    $this->withToken($token)->patchJson('/api/v1/me', ['name' => XssPayloads::fit($payload, XssWorld::ME_NAME_MAX, 'Ayşe')])->assertOk();
    $name = User::query()->findOrFail($donor->id)->name;

    $code = (string) random_int(100000, 999999);
    $verify = static fn (string $n): array => renderMail(new EmailVerificationCodeMail($n, $code));
    $reset = static fn (string $n): array => renderMail(new PasswordResetCodeMail($n, $code));
    $deletion = static fn (string $n): array => renderMail(new AccountDeletionRequestedMail($n, CarbonImmutable::now()->addDays(14)));

    assertMailInert($verify($name), $verify(benignLike($name)), [$name], 'verification');
    assertMailInert($reset($name), $reset(benignLike($name)), [$name], 'password reset');
    assertMailInert($deletion($name), $deletion(benignLike($name)), [$name], 'deletion notice');
})->with(XssPayloads::everything());

it('renders finance alert values in the alert mails as text', function (string $payload): void {
    $value = XssPayloads::fit($payload, 120, 'deger');

    $hold = static fn (string $v): array => renderMail(new PayoutHoldAlertMail((string) Str::uuid7(), (string) Str::uuid7(), 'redeem_rate', ['kind' => $v, 'threshold' => 30]));
    $mismatch = static fn (string $v): array => renderMail(new PaymentMismatchAlertMail(
        (string) Str::uuid7(), (string) Str::uuid7(), 'amount_mismatch', ['status' => $v], ['status' => $v], CarbonImmutable::now(),
    ));
    $settlement = static fn (string $v): array => renderMail(new SettlementMismatchMail((string) Str::uuid7(), [$v]));

    $held = $hold($value);
    assertMailInert($held, $hold(benignLike($value)), [$value], 'payout hold alert');

    assertMailInert($mismatch($value), $mismatch(benignLike($value)), [$value], 'payment mismatch alert');
    assertMailInert($settlement($value), $settlement(benignLike($value)), [$value], 'settlement mismatch alert');
})->with(XssPayloads::everything());

it('carries payloads in the push payload as JSON strings that round-trip unchanged', function (string $payload): void {
    $world = XssWorld::listedShop($this, $payload);
    $shop = $world['shop'];
    $item = $world['item'];

    // Native notification text is not HTML, so the contract here is lossless transport inside one JSON line.
    // Fixed letter-only ids: the log masking processor rewrites digit runs of random UUIDs that look like phone numbers.
    $shopRef = 'shop-ref';
    $donationRef = 'donation-ref';
    $messages = [
        NotifyShopNewHooks::message(2, $item->name, $shopRef),
        NotifyDonorRedeemed::message($item->name, $shop->name, $donationRef, $shopRef),
    ];

    $path = storage_path('logs/xss-push-'.Str::random(8).'.log');
    config(['logging.channels.xss_push' => array_merge(config('logging.channels.single'), ['path' => $path])]);

    try {
        foreach ($messages as $message) {
            (new LogPushTransport(Log::channel('xss_push')))->send(DevicePlatform::Android, Str::random(64), $message);
        }

        $lines = array_values(array_filter(explode("\n", (string) file_get_contents($path))));
    } finally {
        @unlink($path);
    }

    expect($lines)->toHaveCount(count($messages));

    foreach ($lines as $index => $line) {
        expect(preg_match('/push\.sent (\{.*\})\s*(?:\[\])?\s*$/', $line, $match))->toBe(1, 'One JSON context per line.');

        /** @var array{message: array{title: string, body: string, data: array<string, string>}} $context */
        $context = json_decode($match[1], true, flags: JSON_THROW_ON_ERROR);
        $expected = $messages[$index]->toArray();

        expect($context['message'])->toBe($expected);

        foreach ($context['message']['data'] as $value) {
            expect($value)->toBeString();
        }

        expect($context['message']['data']['item'])->toBe($item->name);
    }

    expect($messages[0])->toBeInstanceOf(PushMessage::class);
})->with(XssPayloads::everything());
