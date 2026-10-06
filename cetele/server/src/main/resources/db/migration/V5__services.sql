CREATE TABLE statement_links (
    id UUID PRIMARY KEY, shop_id UUID NOT NULL REFERENCES shops (id), customer_id UUID NOT NULL REFERENCES customers (id),
    token_hash TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL, opened_at TIMESTAMPTZ, open_count INTEGER NOT NULL DEFAULT 0,
    revoked_at TIMESTAMPTZ, created_by UUID REFERENCES users (id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT statement_links_token_hash_key UNIQUE (token_hash),
    CONSTRAINT statement_links_token_hash_format CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT statement_links_expiry_after_creation CHECK (expires_at > created_at),
    CONSTRAINT statement_links_open_count_nonnegative CHECK (open_count >= 0)
);
CREATE INDEX statement_links_shop_customer_idx ON statement_links (shop_id, customer_id, expires_at);

CREATE TABLE reminders (
    id UUID PRIMARY KEY, shop_id UUID NOT NULL REFERENCES shops (id), customer_id UUID NOT NULL REFERENCES customers (id),
    channel TEXT NOT NULL, template TEXT NOT NULL, status TEXT NOT NULL, provider_msg_id TEXT, failure_code TEXT,
    statement_link_id UUID REFERENCES statement_links (id) ON DELETE SET NULL,
    requested_by UUID REFERENCES users (id) ON DELETE SET NULL, requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    sent_at TIMESTAMPTZ, delivered_at TIMESTAMPTZ,
    CONSTRAINT reminders_channel_check CHECK (channel IN ('SMS', 'WHATSAPP')),
    CONSTRAINT reminders_template_check CHECK (template IN ('BALANCE', 'DUE_TODAY')),
    CONSTRAINT reminders_status_check CHECK (status IN ('QUEUED', 'SENT', 'FAILED', 'DELIVERED', 'UNDELIVERED')),
    CONSTRAINT reminders_failure_code_length CHECK (failure_code IS NULL OR char_length(failure_code) <= 64)
);
CREATE INDEX reminders_shop_customer_idx ON reminders (shop_id, customer_id, requested_at);
CREATE INDEX reminders_sms_sent_idx ON reminders (sent_at) WHERE channel = 'SMS' AND sent_at IS NOT NULL;
CREATE UNIQUE INDEX reminders_provider_msg_id_key ON reminders (provider_msg_id) WHERE provider_msg_id IS NOT NULL;

CREATE TABLE sms_quota (
    shop_id UUID NOT NULL REFERENCES shops (id), month DATE NOT NULL, used INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (shop_id, month),
    CONSTRAINT sms_quota_month_first_day CHECK (extract(day FROM month) = 1),
    CONSTRAINT sms_quota_used_nonnegative CHECK (used >= 0)
);

CREATE TABLE media_objects (
    id UUID PRIMARY KEY, shop_id UUID NOT NULL REFERENCES shops (id), status TEXT NOT NULL,
    declared_content_type TEXT NOT NULL, declared_length INTEGER NOT NULL, upload_key TEXT NOT NULL, photo_key TEXT,
    width INTEGER, height INTEGER, bytes INTEGER, failure_code TEXT,
    created_by UUID REFERENCES users (id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    upload_expires_at TIMESTAMPTZ NOT NULL, ready_at TIMESTAMPTZ,
    CONSTRAINT media_objects_status_check CHECK (status IN ('PENDING', 'READY', 'FAILED', 'EXPIRED')),
    CONSTRAINT media_objects_content_type_check CHECK (declared_content_type IN ('image/jpeg', 'image/webp')),
    CONSTRAINT media_objects_declared_length_range CHECK (declared_length BETWEEN 1 AND 1200000),
    CONSTRAINT media_objects_photo_key_key UNIQUE (photo_key),
    CONSTRAINT media_objects_photo_key_format CHECK (photo_key IS NULL OR photo_key ~ '^media/[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$'),
    CONSTRAINT media_objects_ready_has_key CHECK (status <> 'READY' OR (photo_key IS NOT NULL AND ready_at IS NOT NULL))
);
CREATE INDEX media_objects_shop_created_idx ON media_objects (shop_id, created_at);
CREATE INDEX media_objects_pending_idx ON media_objects (upload_expires_at) WHERE status = 'PENDING';

-- No foreign keys: the row must outlive the user and the shop it records (evidence of completion, no PII).
CREATE TABLE deletion_requests (
    id UUID PRIMARY KEY, kind TEXT NOT NULL, user_id UUID NOT NULL, shop_id UUID,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(), grace_until TIMESTAMPTZ NOT NULL,
    cancelled_at TIMESTAMPTZ, blocked_at TIMESTAMPTZ, completed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT deletion_requests_kind_check CHECK (kind IN ('ACCOUNT', 'SHOP')),
    CONSTRAINT deletion_requests_shop_for_kind CHECK ((kind = 'SHOP') = (shop_id IS NOT NULL)),
    CONSTRAINT deletion_requests_grace_after_request CHECK (grace_until >= requested_at)
);
CREATE UNIQUE INDEX deletion_requests_open_account_key ON deletion_requests (user_id) WHERE kind = 'ACCOUNT' AND completed_at IS NULL AND cancelled_at IS NULL;
CREATE UNIQUE INDEX deletion_requests_open_shop_key ON deletion_requests (shop_id) WHERE kind = 'SHOP' AND completed_at IS NULL AND cancelled_at IS NULL;
CREATE INDEX deletion_requests_due_idx ON deletion_requests (grace_until) WHERE completed_at IS NULL AND cancelled_at IS NULL;

ALTER TABLE refresh_tokens ADD COLUMN family_expires_at TIMESTAMPTZ;
UPDATE refresh_tokens SET family_expires_at = created_at + INTERVAL '180 days';
ALTER TABLE refresh_tokens ALTER COLUMN family_expires_at SET NOT NULL;
ALTER TABLE shops DROP CONSTRAINT shops_created_by_fkey, ALTER COLUMN created_by DROP NOT NULL,
    ADD CONSTRAINT shops_created_by_fkey FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL;
ALTER TABLE invitations DROP CONSTRAINT invitations_created_by_fkey, ALTER COLUMN created_by DROP NOT NULL,
    ADD CONSTRAINT invitations_created_by_fkey FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL;
