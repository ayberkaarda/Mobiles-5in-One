-- Admin console (ADR-0033): platform staff identities, separate from shop users, and the audit log.
-- Primary keys are UUIDv7 values created by the application. Passwords are Argon2id hashes, TOTP
-- secrets are AES-256-GCM ciphertexts, client addresses are HMAC-SHA256 values.

CREATE TABLE admin_users (
    id UUID PRIMARY KEY,
    email TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL,
    totp_secret_enc BYTEA,
    totp_enrolled_at TIMESTAMPTZ,
    totp_last_step BIGINT,
    must_change_password BOOLEAN NOT NULL DEFAULT true,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ,
    last_login_at TIMESTAMPTZ,
    password_changed_at TIMESTAMPTZ,
    created_by UUID REFERENCES admin_users (id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    disabled_at TIMESTAMPTZ,
    CONSTRAINT admin_users_role_check CHECK (role IN ('ADMIN', 'SUPPORT')),
    CONSTRAINT admin_users_email_format CHECK (email = lower(email) AND char_length(email) BETWEEN 3 AND 254 AND email ~ '^[^@\s]+@[^@\s]+$'),
    CONSTRAINT admin_users_password_hash_argon2 CHECK (password_hash LIKE '$argon2id$%'),
    CONSTRAINT admin_users_totp_pair CHECK ((totp_enrolled_at IS NULL) OR (totp_secret_enc IS NOT NULL)),
    CONSTRAINT admin_users_failed_attempts_nonnegative CHECK (failed_attempts >= 0)
);
CREATE UNIQUE INDEX admin_users_email_key ON admin_users (email);

-- No foreign keys: a row outlives the admin, user, shop or device it names.
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY,
    at TIMESTAMPTZ NOT NULL DEFAULT now(),
    actor_type TEXT NOT NULL,
    actor_id UUID,
    action TEXT NOT NULL,
    target_type TEXT,
    target_id UUID,
    ip_hash TEXT,
    trace_id UUID,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    CONSTRAINT audit_logs_actor_type_check CHECK (actor_type IN ('ADMIN', 'SYSTEM')),
    CONSTRAINT audit_logs_admin_has_actor CHECK (actor_type <> 'ADMIN' OR actor_id IS NOT NULL OR action = 'ADMIN_LOGIN_FAILED'),
    CONSTRAINT audit_logs_action_format CHECK (action ~ '^[A-Z][A-Z_]{2,63}$'),
    CONSTRAINT audit_logs_target_type_check CHECK (target_type IS NULL OR target_type IN ('ADMIN_USER', 'USER', 'SHOP', 'DEVICE')),
    CONSTRAINT audit_logs_target_pair CHECK ((target_type IS NULL) = (target_id IS NULL)),
    CONSTRAINT audit_logs_ip_hash_format CHECK (ip_hash IS NULL OR ip_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT audit_logs_metadata_object CHECK (jsonb_typeof(metadata) = 'object' AND octet_length(metadata::text) <= 2048)
);
CREATE INDEX audit_logs_at_idx ON audit_logs (at DESC);
CREATE INDEX audit_logs_actor_idx ON audit_logs (actor_id, at DESC);
CREATE INDEX audit_logs_target_idx ON audit_logs (target_type, target_id, at DESC);
