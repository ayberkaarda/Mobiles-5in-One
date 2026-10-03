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
        };
    }

    public function type(): string
    {
        return 'https://askida.app/problems/'.$this->value;
    }
}
