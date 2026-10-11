-- Delivery reports of the SMS provider (ADR-0032). No shop id, no phone and no text: the table
-- is not touched by shop or account deletion; retention removes rows older than 90 days.
CREATE TABLE sms_delivery_reports (
    id UUID PRIMARY KEY,
    provider_msg_id TEXT NOT NULL,
    status TEXT NOT NULL,
    error_code TEXT,
    occurred_at TIMESTAMPTZ NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    processing TEXT NOT NULL DEFAULT 'RECEIVED',
    outcome TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    processed_at TIMESTAMPTZ,
    CONSTRAINT sms_delivery_reports_provider_msg_id_key UNIQUE (provider_msg_id),
    CONSTRAINT sms_delivery_reports_provider_msg_id_format CHECK (provider_msg_id ~ '^[A-Za-z0-9_.:-]{1,64}$'),
    CONSTRAINT sms_delivery_reports_status_check CHECK (status IN ('DELIVERED', 'UNDELIVERED')),
    CONSTRAINT sms_delivery_reports_error_code_format CHECK (error_code IS NULL OR error_code ~ '^[A-Za-z0-9_.-]{1,32}$'),
    CONSTRAINT sms_delivery_reports_processing_check CHECK (processing IN ('RECEIVED', 'APPLIED', 'IGNORED', 'FAILED')),
    CONSTRAINT sms_delivery_reports_outcome_length CHECK (outcome IS NULL OR char_length(outcome) <= 64),
    CONSTRAINT sms_delivery_reports_attempts_nonnegative CHECK (attempts >= 0)
);
CREATE INDEX sms_delivery_reports_pending_idx ON sms_delivery_reports (received_at) WHERE processing = 'RECEIVED';
