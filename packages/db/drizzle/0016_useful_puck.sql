ALTER TYPE "public"."post_status" ADD VALUE 'queued' BEFORE 'published';--> statement-breakpoint
ALTER TABLE "subscriptions" ALTER COLUMN "plan" SET DEFAULT 'free';--> statement-breakpoint
ALTER TABLE "tenants" ALTER COLUMN "notify_on_publish_failure" SET DEFAULT true;--> statement-breakpoint
ALTER TABLE "clips" ADD COLUMN "file_size_bytes" bigint;--> statement-breakpoint
ALTER TABLE "source_videos" ADD COLUMN "file_size_bytes" bigint;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "storage_addon_units" integer DEFAULT 0 NOT NULL;