CREATE TABLE "game_leaderboard_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" text NOT NULL,
	"user_id" text NOT NULL,
	"display_name" text NOT NULL,
	"score" integer NOT NULL,
	"room_id" uuid NOT NULL,
	"played_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_leaderboard_entries_game_user" UNIQUE("game_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "game_leaderboard_entries" ADD CONSTRAINT "game_leaderboard_entries_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_leaderboard_entries" ADD CONSTRAINT "game_leaderboard_entries_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "game_leaderboard_entries_rank_idx" ON "game_leaderboard_entries" USING btree ("game_id","score" DESC NULLS LAST);