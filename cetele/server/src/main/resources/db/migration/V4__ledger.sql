CREATE TABLE customers (
    id UUID PRIMARY KEY, shop_id UUID NOT NULL REFERENCES shops (id),
    name TEXT NOT NULL, phone_e164 TEXT, note TEXT, tag TEXT,
    sms_consent BOOLEAN NOT NULL DEFAULT false, sms_consent_at TIMESTAMPTZ, sms_consent_source TEXT,
    created_by UUID REFERENCES users (id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ,
    CONSTRAINT customers_name_length CHECK (char_length(name) BETWEEN 1 AND 80),
    CONSTRAINT customers_phone_e164_format CHECK (phone_e164 IS NULL OR phone_e164 ~ '^\+905[0-9]{9}$'),
    CONSTRAINT customers_note_length CHECK (note IS NULL OR char_length(note) <= 500),
    CONSTRAINT customers_tag_length CHECK (tag IS NULL OR char_length(tag) BETWEEN 1 AND 30),
    CONSTRAINT customers_sms_consent_source_check CHECK (sms_consent_source IS NULL OR sms_consent_source IN ('IN_PERSON', 'PHONE', 'WRITTEN', 'OTHER')),
    CONSTRAINT customers_sms_consent_evidence CHECK (NOT sms_consent OR (sms_consent_at IS NOT NULL AND sms_consent_source IS NOT NULL))
);
CREATE INDEX customers_shop_updated_idx ON customers (shop_id, updated_at);
CREATE INDEX customers_shop_live_idx ON customers (shop_id) WHERE deleted_at IS NULL;

CREATE TABLE ledger_entries (
    id UUID PRIMARY KEY, shop_id UUID NOT NULL REFERENCES shops (id), customer_id UUID NOT NULL REFERENCES customers (id),
    client_id UUID NOT NULL, type TEXT NOT NULL, amount_minor BIGINT NOT NULL, currency CHAR(3) NOT NULL DEFAULT 'TRY',
    occurred_on DATE NOT NULL, due_on DATE, note TEXT, photo_key TEXT,
    reverses UUID REFERENCES ledger_entries (id), reversed_by UUID REFERENCES ledger_entries (id),
    created_by UUID REFERENCES users (id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ledger_entries_client_id_key UNIQUE (client_id),
    CONSTRAINT ledger_entries_type_check CHECK (type IN ('DEBT', 'PAYMENT')),
    CONSTRAINT ledger_entries_amount_range CHECK (amount_minor BETWEEN 1 AND 10000000000),
    CONSTRAINT ledger_entries_currency_check CHECK (currency = 'TRY'),
    CONSTRAINT ledger_entries_note_length CHECK (note IS NULL OR char_length(note) <= 500),
    CONSTRAINT ledger_entries_photo_key_format CHECK (photo_key IS NULL OR photo_key ~ '^media/[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$'),
    CONSTRAINT ledger_entries_due_on_debt_only CHECK (due_on IS NULL OR type = 'DEBT'),
    CONSTRAINT ledger_entries_reverses_not_self CHECK (reverses IS NULL OR reverses <> id),
    CONSTRAINT ledger_entries_reverses_key UNIQUE (reverses),
    CONSTRAINT ledger_entries_reversed_by_key UNIQUE (reversed_by)
);
CREATE INDEX ledger_entries_shop_customer_idx ON ledger_entries (shop_id, customer_id, occurred_on, created_at);
CREATE INDEX ledger_entries_shop_due_idx ON ledger_entries (shop_id, due_on) WHERE due_on IS NOT NULL;

CREATE TABLE shop_sequences (shop_id UUID PRIMARY KEY REFERENCES shops (id), last_seq BIGINT NOT NULL DEFAULT 0, CONSTRAINT shop_sequences_last_seq_nonnegative CHECK (last_seq >= 0));

CREATE TABLE change_log (
    id UUID PRIMARY KEY, shop_id UUID NOT NULL REFERENCES shops (id), seq BIGINT NOT NULL,
    entity TEXT NOT NULL, entity_id UUID NOT NULL, op TEXT NOT NULL, payload JSONB NOT NULL, at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT change_log_shop_seq_key UNIQUE (shop_id, seq),
    CONSTRAINT change_log_entity_check CHECK (entity IN ('CUSTOMER', 'ENTRY')),
    CONSTRAINT change_log_op_check CHECK (op IN ('UPSERT', 'DELETE')),
    CONSTRAINT change_log_seq_positive CHECK (seq > 0)
);

CREATE TABLE sync_outbox_receipts (
    id UUID PRIMARY KEY, shop_id UUID NOT NULL REFERENCES shops (id), device_id UUID NOT NULL,
    user_id UUID REFERENCES users (id) ON DELETE SET NULL, client_seq BIGINT NOT NULL, client_id UUID NOT NULL,
    entity_id UUID NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT sync_outbox_receipts_client_id_key UNIQUE (shop_id, client_id),
    CONSTRAINT sync_outbox_receipts_device_seq_key UNIQUE (shop_id, device_id, client_seq),
    CONSTRAINT sync_outbox_receipts_client_seq_positive CHECK (client_seq > 0)
);
