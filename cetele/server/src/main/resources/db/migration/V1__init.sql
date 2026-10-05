-- Identity and tenancy core: users, shops and the memberships that link them.
-- Primary keys are UUIDv7 values created by the application; the database sets no defaults for them.

CREATE TABLE users (
    id             UUID        PRIMARY KEY,
    phone_e164     TEXT        NOT NULL,
    display_name   TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    deactivated_at TIMESTAMPTZ,
    CONSTRAINT users_phone_e164_key UNIQUE (phone_e164),
    CONSTRAINT users_phone_e164_format CHECK (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
    CONSTRAINT users_display_name_length CHECK (display_name IS NULL OR char_length(display_name) BETWEEN 1 AND 80)
);

CREATE TABLE shops (
    id         UUID        PRIMARY KEY,
    name       TEXT        NOT NULL,
    type       TEXT        NOT NULL,
    il         TEXT        NOT NULL,
    ilce       TEXT        NOT NULL,
    plan       TEXT        NOT NULL DEFAULT 'FREE',
    created_by UUID        NOT NULL REFERENCES users (id),
    deleted_at TIMESTAMPTZ,
    CONSTRAINT shops_name_length CHECK (char_length(name) BETWEEN 1 AND 80),
    CONSTRAINT shops_plan_check CHECK (plan IN ('FREE', 'PRO'))
);

CREATE INDEX shops_created_by_idx ON shops (created_by);

CREATE TABLE memberships (
    id      UUID PRIMARY KEY,
    shop_id UUID NOT NULL REFERENCES shops (id),
    user_id UUID NOT NULL REFERENCES users (id),
    role    TEXT NOT NULL,
    CONSTRAINT memberships_shop_user_key UNIQUE (shop_id, user_id),
    CONSTRAINT memberships_role_check CHECK (role IN ('OWNER', 'STAFF'))
);

CREATE INDEX memberships_user_id_idx ON memberships (user_id);
