-- Phase 4 billing (ADR-0031): Play subscriptions bound to shops, and the authenticated RTDN inbox (ADR-0032).

CREATE TABLE subscriptions (
    id UUID PRIMARY KEY,
    shop_id UUID REFERENCES shops (id) ON DELETE SET NULL,
    purchase_token_hash TEXT NOT NULL,
    purchase_token_enc BYTEA,
    product_id TEXT NOT NULL,
    base_plan_id TEXT,
    state TEXT NOT NULL,
    expires_at TIMESTAMPTZ,
    auto_renewing BOOLEAN NOT NULL DEFAULT false,
    test_purchase BOOLEAN NOT NULL DEFAULT false,
    acknowledged_at TIMESTAMPTZ,
    linked_by UUID REFERENCES users (id) ON DELETE SET NULL,
    linked_at TIMESTAMPTZ NOT NULL,
    last_verified_at TIMESTAMPTZ NOT NULL,
    last_notification_type INTEGER,
    revoked_at TIMESTAMPTZ,
    superseded_at TIMESTAMPTZ,
    replaced_by UUID REFERENCES subscriptions (id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT subscriptions_purchase_token_hash_key UNIQUE (purchase_token_hash),
    CONSTRAINT subscriptions_purchase_token_hash_format CHECK (purchase_token_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT subscriptions_state_check CHECK (state IN ('PENDING', 'ACTIVE', 'IN_GRACE_PERIOD', 'ON_HOLD', 'PAUSED',
        'CANCELED', 'EXPIRED', 'REVOKED', 'REPLACED', 'ORPHANED')),
    CONSTRAINT subscriptions_product_id_length CHECK (char_length(product_id) BETWEEN 1 AND 100),
    CONSTRAINT subscriptions_base_plan_id_length CHECK (base_plan_id IS NULL OR char_length(base_plan_id) BETWEEN 1 AND 100),
    CONSTRAINT subscriptions_revoked_has_time CHECK (state <> 'REVOKED' OR revoked_at IS NOT NULL),
    CONSTRAINT subscriptions_replaced_is_superseded CHECK (state <> 'REPLACED' OR superseded_at IS NOT NULL)
);
CREATE UNIQUE INDEX subscriptions_one_current_per_shop ON subscriptions (shop_id) WHERE superseded_at IS NULL AND shop_id IS NOT NULL;
CREATE INDEX subscriptions_reverify_idx ON subscriptions (expires_at) WHERE superseded_at IS NULL;

CREATE TABLE webhook_events (
    id UUID PRIMARY KEY,
    provider TEXT NOT NULL,
    event_id TEXT NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at TIMESTAMPTZ,
    notification_type INTEGER,
    purchase_token_hash TEXT,
    purchase_token_enc BYTEA,
    status TEXT NOT NULL,
    outcome TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at TIMESTAMPTZ,
    CONSTRAINT webhook_events_provider_check CHECK (provider IN ('PLAY_RTDN')),
    CONSTRAINT webhook_events_provider_event_key UNIQUE (provider, event_id),
    CONSTRAINT webhook_events_event_id_length CHECK (char_length(event_id) BETWEEN 1 AND 128),
    CONSTRAINT webhook_events_status_check CHECK (status IN ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED')),
    CONSTRAINT webhook_events_token_hash_format CHECK (purchase_token_hash IS NULL OR purchase_token_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT webhook_events_outcome_length CHECK (outcome IS NULL OR char_length(outcome) <= 64),
    CONSTRAINT webhook_events_attempts_nonnegative CHECK (attempts >= 0),
    CONSTRAINT webhook_events_done_has_no_token CHECK (status = 'RECEIVED' OR purchase_token_enc IS NULL)
);
CREATE INDEX webhook_events_pending_idx ON webhook_events (next_attempt_at) WHERE status = 'RECEIVED';
