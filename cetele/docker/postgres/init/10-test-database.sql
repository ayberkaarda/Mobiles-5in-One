-- Runs once, when the cetele_pg volume is first initialised.
-- A separate database keeps manual test runs away from local development data.
CREATE DATABASE cetele_test OWNER cetele;
