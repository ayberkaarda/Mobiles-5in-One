-- ADR-0039: folded venue names for Turkish-aware substring search, backed by a pg_trgm GIN index.
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN "search_name" text;--> statement-breakpoint
-- Backfill rows that already exist (the seeded [ÖRNEK] venues). The expression mirrors
-- foldTr() from @kadro/contracts for Turkish and common Latin letters: İ/I handled before
-- lower-casing, diacritics removed, whitespace collapsed. The application and the seed write
-- foldTr(name) on every insert and name change, so later rows never depend on this expression.
UPDATE "venues"
SET "search_name" = trim(regexp_replace(
  translate(
    lower(translate("name", 'İI', 'iı')),
    'ıçğöşüâîûêéèëàáäíìïóòúùñ',
    'icgosuaiueeeeaaaiiioouun'
  ),
  '\s+', ' ', 'g'
));--> statement-breakpoint
ALTER TABLE "venues" ALTER COLUMN "search_name" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "venues_search_name_trgm" ON "venues" USING gin ("search_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "venues_search_name_id_idx" ON "venues" USING btree ("search_name","id");--> statement-breakpoint
CREATE INDEX "venues_district_id_search_name_idx" ON "venues" USING btree ("district_id","search_name");
