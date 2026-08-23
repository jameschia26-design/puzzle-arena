ALTER TABLE "ai_providers" ALTER COLUMN "max_tokens" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "ai_providers" ALTER COLUMN "max_tokens" DROP NOT NULL;--> statement-breakpoint
-- 1024 was never a deliberate choice: the admin UI has never exposed a field
-- to set it, so every existing row only has it because of the old column
-- default. Clearing it here means those rows stop being silently capped.
UPDATE "ai_providers" SET "max_tokens" = NULL WHERE "max_tokens" = 1024;