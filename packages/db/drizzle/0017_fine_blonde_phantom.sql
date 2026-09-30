ALTER TABLE "subscriptions" ALTER COLUMN "stripe_customer_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "clips" ADD COLUMN "burst_mode_used" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "source_videos" ADD COLUMN "burst_mode_used" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "burst_seconds_remaining" integer DEFAULT 0 NOT NULL;