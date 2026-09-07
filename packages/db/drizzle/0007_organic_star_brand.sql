ALTER TABLE "clips" ALTER COLUMN "source_video_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "clips" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "clips" ADD CONSTRAINT "clips_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;