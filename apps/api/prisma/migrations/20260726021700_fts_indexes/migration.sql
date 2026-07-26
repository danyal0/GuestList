-- Full-text search support. These expression indexes must match the
-- expressions used in SearchService raw queries exactly for the planner
-- to use them.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "groups_fts_idx" ON "groups" USING GIN (
  to_tsvector('english', "name" || ' ' || "description" || ' ' || coalesce("location", ''))
);

CREATE INDEX IF NOT EXISTS "events_fts_idx" ON "events" USING GIN (
  to_tsvector('english', "title" || ' ' || "description" || ' ' || coalesce("locationName", ''))
);

CREATE INDEX IF NOT EXISTS "users_name_trgm_idx" ON "users" USING GIN ("name" gin_trgm_ops);
