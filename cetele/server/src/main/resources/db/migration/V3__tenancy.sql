-- Tenancy: shop types, creation timestamps, the one-owner invariant and phone-bound invitations.
-- Primary keys stay UUIDv7 values created by the application.

ALTER TABLE shops ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE shops ADD CONSTRAINT shops_type_check
    CHECK (type IN ('BAKKAL', 'MANAV', 'KASAP', 'BERBER', 'KAHVEHANE', 'DIGER'));

ALTER TABLE memberships ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Exactly one owner per shop: a second OWNER row for the same shop is rejected by the database.
CREATE UNIQUE INDEX memberships_one_owner ON memberships (shop_id) WHERE role = 'OWNER';

-- An invitation is bound to one phone number. Only the SHA-256 of the code is stored (lowercase hex);
-- the code itself is shown once to the inviting owner.
CREATE TABLE invitations (
    id          UUID        PRIMARY KEY,
    shop_id     UUID        NOT NULL REFERENCES shops (id),
    phone_e164  TEXT        NOT NULL,
    code_hash   TEXT        NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL,
    accepted_at TIMESTAMPTZ,
    created_by  UUID        NOT NULL REFERENCES users (id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT invitations_code_hash_key UNIQUE (code_hash),
    CONSTRAINT invitations_code_hash_format CHECK (code_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT invitations_phone_e164_format CHECK (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
    CONSTRAINT invitations_expiry_after_creation CHECK (expires_at > created_at)
);

CREATE INDEX invitations_shop_id_expires_at_idx ON invitations (shop_id, expires_at);
