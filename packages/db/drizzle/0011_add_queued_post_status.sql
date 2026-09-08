-- Custom SQL migration file, put your code below! --
ALTER TYPE "public"."post_status" ADD VALUE IF NOT EXISTS 'queued' BEFORE 'published';