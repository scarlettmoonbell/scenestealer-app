ALTER TABLE "source_videos" ADD COLUMN "recorded_at" timestamp;--> statement-breakpoint
ALTER TABLE "source_videos" ADD COLUMN "device_model" text;--> statement-breakpoint
ALTER TABLE "source_videos" ADD COLUMN "venue_name" text;--> statement-breakpoint
ALTER TABLE "source_videos" ADD COLUMN "city_name" text;--> statement-breakpoint
ALTER TABLE "source_videos" ADD COLUMN "gps_lat" real;--> statement-breakpoint
ALTER TABLE "source_videos" ADD COLUMN "gps_lon" real;