<?php

namespace App\Domain\Payments\Gateways\Iyzico;

use App\Domain\Payments\Data\CheckoutRequest;
use App\Domain\Payments\Data\RefundRequest;
use App\Domain\Payments\Data\SubMerchantData;
use Carbon\CarbonImmutable;

/**
 * Builds provider request bodies from our DTOs.
 *
 * Privacy: the checkout never sends the donor's personal data. The provider requires a
 * buyer block, so it gets the opaque donor reference as `buyer.id` and fixed,
 * non-personal values for the other fields (a pseudonymous e-mail derived from the
 * reference, the placeholder identity number the provider's samples use, a generic
 * address). Whether the provider accepts these values for live merchants is not
 * verified (no sandbox account).
 *
 * The basket has one line per donation, routed to the shop's sub-merchant:
 * `price` = the donation amount, `subMerchantPrice` = amount - platform commission. The
 * basket id carries our conversation id so that the payment detail can be matched back.
 *
 * Field names follow the provider's Checkout Form, refund v2, sub-merchant and
 * settlement reporting documentation (not verified against the provider).
 */
final class IyzicoRequestMapper
{
    public const PAYMENT_GROUP = 'PRODUCT';

    /** Donations are collected at the shop, nothing is shipped. */
    public const ITEM_TYPE = 'VIRTUAL';

    public const BASKET_CATEGORY = 'Askıda bağışı';

    public const BUYER_NAME = 'Askıda';

    public const BUYER_SURNAME = 'Bağışçısı';

    public const BUYER_EMAIL_DOMAIN = 'buyers.askida.app';

    public const BUYER_CITY = 'Istanbul';

    public const BUYER_COUNTRY = 'Turkey';

    public const BUYER_ADDRESS = 'Askıda bağışı, teslimat yok';

    /** The buyer ip is not collected; the provider gets a non-routable placeholder. */
    public const BUYER_IP = '0.0.0.0';

    /**
     * @return array<string, mixed>
     */
    public function checkout(CheckoutRequest $request): array
    {
        $amount = IyzicoMoney::format($request->amountMinor);

        return [
            'locale' => $request->locale,
            'conversationId' => $request->conversationId,
            'price' => $amount,
            'paidPrice' => $amount,
            'currency' => $request->currency,
            'basketId' => $request->conversationId,
            'paymentGroup' => self::PAYMENT_GROUP,
            'callbackUrl' => $request->callbackUrl,
            'enabledInstallments' => [1],
            'buyer' => $this->buyer($request->buyerReference),
            'billingAddress' => [
                'contactName' => self::BUYER_NAME.' '.self::BUYER_SURNAME,
                'city' => self::BUYER_CITY,
                'country' => self::BUYER_COUNTRY,
                'address' => self::BUYER_ADDRESS,
            ],
            'basketItems' => [[
                'id' => $request->itemId,
                'name' => mb_substr($request->itemName, 0, 100).' x '.$request->qty,
                'category1' => self::BASKET_CATEGORY,
                'itemType' => self::ITEM_TYPE,
                'price' => $amount,
                'subMerchantKey' => $request->subMerchantKey,
                'subMerchantPrice' => IyzicoMoney::format($request->amountMinor - $request->commissionMinor),
            ]],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function retrieve(string $providerToken): array
    {
        return ['locale' => 'tr', 'token' => $providerToken];
    }

    /**
     * @return array<string, mixed>
     */
    public function refund(RefundRequest $request): array
    {
        return [
            'locale' => 'tr',
            'conversationId' => $request->idempotencyKey,
            'paymentId' => $request->providerPaymentId,
            'price' => IyzicoMoney::format($request->amountMinor),
            'currency' => $request->currency,
            'ip' => self::BUYER_IP,
        ];
    }

    /**
     * Sub-merchant onboarding. Personal and sole-proprietor merchants identify with the
     * identity number field; companies with tax number and legal title. The tax office is
     * not collected by the shop form, so it is not sent (provider requirement not verified).
     *
     * @return array<string, mixed>
     */
    public function subMerchant(SubMerchantData $data): array
    {
        $body = [
            'locale' => 'tr',
            'conversationId' => $data->externalId,
            'subMerchantExternalId' => $data->externalId,
            'subMerchantType' => $data->merchantType,
            'name' => $data->name,
            'address' => $data->address,
            'email' => $data->email,
            'gsmNumber' => $data->phone,
            'iban' => $data->iban,
            'currency' => 'TRY',
        ];

        if (in_array($data->merchantType, ['PERSONAL', 'PRIVATE_COMPANY'], true)) {
            $body['identityNumber'] = $data->taxNumber;
        }

        if ($data->merchantType !== 'PERSONAL') {
            $body['taxNumber'] = $data->taxNumber;
            $body['legalCompanyTitle'] = $data->name;
        }

        return $body;
    }

    /**
     * @return array<string, mixed>
     */
    public function subMerchantDetail(string $externalId): array
    {
        return ['locale' => 'tr', 'subMerchantExternalId' => $externalId];
    }

    /**
     * Completed payouts of one day.
     *
     * @return array<string, mixed>
     */
    public function payoutsOfDay(CarbonImmutable $day): array
    {
        return [
            'locale' => 'tr',
            'conversationId' => 'payouts-'.$day->format('Ymd'),
            'date' => $day->format('Y-m-d').' 00:00:00',
        ];
    }

    /**
     * @return array<string, string>
     */
    private function buyer(string $reference): array
    {
        return [
            'id' => $reference,
            'name' => self::BUYER_NAME,
            'surname' => self::BUYER_SURNAME,
            'email' => 'donor-'.substr(hash('sha256', $reference), 0, 16).'@'.self::BUYER_EMAIL_DOMAIN,
            // The provider's documented placeholder identity number (eleven ones).
            'identityNumber' => str_repeat('1', 11),
            'registrationAddress' => self::BUYER_ADDRESS,
            'city' => self::BUYER_CITY,
            'country' => self::BUYER_COUNTRY,
            'ip' => self::BUYER_IP,
        ];
    }
}
