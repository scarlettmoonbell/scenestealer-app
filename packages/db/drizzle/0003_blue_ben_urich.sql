CREATE TYPE "public"."analysis_status" AS ENUM('pending', 'analyzing', 'analyzed', 'failed');--> statement-breakpoint
ALTER TABLE "source_videos" ADD COLUMN "status" "analysis_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "source_videos" ADD COLUMN "analysis_error" text;