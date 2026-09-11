ALTER TABLE "social_connections" ADD COLUMN "default_posting_time" text;
ALTER TABLE "tenants" ADD COLUMN "notification_email" text;
ALTER TABLE "tenants" ADD COLUMN "notify_on_publish_failure" boolean NOT NULL DEFAULT true;
