-- PostGIS provides the geography(Point, 4326) type used by districts.centroid and venues.point.
-- Creating the extension needs a role with CREATE privilege on the database (superuser or the
-- provider's extension-admin role on managed PostgreSQL).
CREATE EXTENSION IF NOT EXISTS postgis;
