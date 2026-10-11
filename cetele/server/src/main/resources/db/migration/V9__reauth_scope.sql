UPDATE otp_codes SET consumed_at = now() WHERE purpose = 'REAUTH' AND consumed_at IS NULL;
ALTER TABLE otp_codes ADD COLUMN scope TEXT;
ALTER TABLE otp_codes ADD CONSTRAINT otp_codes_scope_purpose CHECK (purpose = 'REAUTH' OR scope IS NULL);
ALTER TABLE otp_codes ADD CONSTRAINT otp_codes_scope_length CHECK (scope IS NULL OR length(scope) <= 64);
