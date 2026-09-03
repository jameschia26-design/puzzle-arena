ALTER TABLE "room_players" DROP CONSTRAINT "room_players_seat";--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "seed" bigint;--> statement-breakpoint
CREATE UNIQUE INDEX "room_players_seat" ON "room_players" USING btree ("room_id","seat") WHERE left_at is null;