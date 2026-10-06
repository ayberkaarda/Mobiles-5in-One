-- Sign-in: one-time codes, refresh tokens and the devices a user signed in from.
-- Primary keys are UUIDv7 values created by the application. Secrets are never stored: codes are
-- kept as HMAC-SHA256(pepper, phone || code), refresh tokens as SHA-256 of the token.

CREATE TABLE otp_codes (
    id          UUID        PRIMARY KEY,
    phone_e164  TEXT        NOT NULL,
    device_id   UUID        NOT NULL,
    purpose     TEXT        NOT NULL DEFAULT 'LOGIN',
    code_hmac   BYTEA       NOT NULL,
    attempts    INTEGER     NOT NULL DEFAULT 0,
    expires_at  TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT otp_codes_phone_e164_format CHECK (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
    CONSTRAINT otp_codes_purpose_check CHECK (purpose IN ('LOGIN', 'REAUTH')),
    CONSTRAINT otp_codes_code_hmac_length CHECK (octet_length(code_hmac) = 32),
    CONSTRAINT otp_codes_attempts_range CHECK (attempts >= 0)
);

CREATE INDEX otp_codes_phone_created_idx ON otp_codes (phone_e164, created_at);

CREATE TABLE devices (
    id                    UUID        PRIMARY KEY,
    user_id               UUID        NOT NULL REFERENCES users (id),
    device_id             UUID        NOT NULL,
    model                 TEXT        NOT NULL,
    app_version           TEXT        NOT NULL,
    last_seen_at          TIMESTAMPTZ NOT NULL,
    integrity_verified_at TIMESTAMPTZ,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT devices_user_device_key UNIQUE (user_id, device_id),
    CONSTRAINT devices_model_length CHECK (char_length(model) BETWEEN 1 AND 100),
    CONSTRAINT devices_app_version_length CHECK (char_length(app_version) BETWEEN 1 AND 32)
);

CREATE TABLE refresh_tokens (
    id           UUID        PRIMARY KEY,
    token_hash   BYTEA       NOT NULL,
    user_id      UUID        NOT NULL REFERENCES users (id),
    device_id    UUID        NOT NULL,
    family_id    UUID        NOT NULL,
    expires_at   TIMESTAMPTZ NOT NULL,
    rotated_from UUID        REFERENCES refresh_tokens (id),
    revoked_at   TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT refresh_tokens_token_hash_key UNIQUE (token_hash),
    CONSTRAINT refresh_tokens_token_hash_length CHECK (octet_length(token_hash) = 32)
);

CREATE INDEX refresh_tokens_family_idx ON refresh_tokens (family_id);
CREATE INDEX refresh_tokens_user_device_idx ON refresh_tokens (user_id, device_id);
CREATE INDEX refresh_tokens_rotated_from_idx ON refresh_tokens (rotated_from);
