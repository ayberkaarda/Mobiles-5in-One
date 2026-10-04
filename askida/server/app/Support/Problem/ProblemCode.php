<?php

namespace App\Support\Problem;

enum ProblemCode: string
{
    case ValidationFailed = 'validation.failed';
    case InvalidCredentials = 'auth.invalid_credentials';
    case Locked = 'auth.locked';
    case Unauthenticated = 'auth.unauthenticated';
    case EmailUnverified = 'auth.email_unverified';
    case TokenInvalid = 'auth.token_invalid';
    case Forbidden = 'forbidden';
    case NotFound = 'not_found';
    case Conflict = 'conflict';
    case RateLimited = 'rate_limited';
    case PayloadTooLarge = 'payload_too_large';
    case UnsupportedMediaType = 'unsupported_media_type';
    case ServerError = 'server_error';
    case BadRequest = 'bad_request';
    case MethodNotAllowed = 'method_not_allowed';
    case HttpsRequired = 'https_required';
    case ServiceUnavailable = 'service_unavailable';
    case ShopHasOpenHooks = 'shop.has_open_hooks';
    case ShopNotPayable = 'shop.not_payable';
    case PaymentMismatch = 'payment.mismatch';
    case DonationCapExceeded = 'donation.cap_exceeded';
    case DonationTxCapExceeded = 'donation.tx_cap_exceeded';
    case AnonDailyCap = 'anon.daily_cap';
    case AnonShopCap = 'anon.shop_cap';
    case HookNoneAvailable = 'hook.none_available';
    case HookCodeInvalid = 'hook.code_invalid';
    case HookCodeExpired = 'hook.code_expired';

    public function title(): string
    {
        return match ($this) {
            self::ValidationFailed => 'The request data is invalid.',
            self::InvalidCredentials => 'The credentials are incorrect.',
            self::Locked => 'Too many failed attempts.',
            self::Unauthenticated => 'Authentication is required.',
            self::EmailUnverified => 'The email address is not verified.',
            self::TokenInvalid => 'The token is invalid or expired.',
            self::Forbidden => 'This action is not allowed.',
            self::NotFound => 'The resource was not found.',
            self::Conflict => 'The request conflicts with the current state.',
            self::RateLimited => 'Too many requests.',
            self::PayloadTooLarge => 'The request body is too large.',
            self::UnsupportedMediaType => 'The media type is not supported.',
            self::ServerError => 'An unexpected error occurred.',
            self::BadRequest => 'The request could not be processed.',
            self::MethodNotAllowed => 'The method is not allowed for this resource.',
            self::HttpsRequired => 'HTTPS is required.',
            self::ServiceUnavailable => 'The service is temporarily unavailable.',
            self::ShopHasOpenHooks => 'A shop of this account still has open units.',
            self::ShopNotPayable => 'This shop cannot receive donations yet.',
            self::PaymentMismatch => 'The payment does not match the donation.',
            self::DonationCapExceeded => 'The daily donation limit has been reached.',
            self::DonationTxCapExceeded => 'The donation exceeds the per-donation limit.',
            self::AnonDailyCap => 'The daily limit of this device is reached.',
            self::AnonShopCap => 'The daily limit of this device at this shop is reached.',
            self::HookNoneAvailable => 'No unit of this item is available now.',
            self::HookCodeInvalid => 'The code is not valid for this shop.',
            self::HookCodeExpired => 'The code has expired.',
        };
    }

    public function type(): string
    {
        return 'https://askida.app/problems/'.$this->value;
    }
}
