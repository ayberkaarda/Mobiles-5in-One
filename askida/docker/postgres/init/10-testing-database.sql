-- Runs once, when the askida_pg volume is first initialised.
-- A separate database keeps the test suite away from local development data.
CREATE DATABASE askida_testing OWNER askida;
\connect askida_testing
CREATE EXTENSION IF NOT EXISTS postgis;
