-- Read-only explainSchemaDiff() output captured 2026-10-29 after removing the
-- premature live-group CHECK from development. Regression fixture ONLY:
-- applied by the test to an isolated synthetic schema, never to production.
CREATE TABLE "site_document_groups" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "description" text DEFAULT '' NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "layout" text DEFAULT 'list' NOT NULL,
  "visibility" text DEFAULT 'everyone' NOT NULL,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "retired_at" timestamp with time zone,
  CONSTRAINT "site_document_groups_slug_unique" UNIQUE("slug")
);
CREATE TABLE "site_data_migrations" (
  "key" text PRIMARY KEY NOT NULL,
  "details" jsonb NOT NULL,
  "completed_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE "site_documents" DROP CONSTRAINT "site_document_year";
ALTER TABLE "site_documents" ALTER COLUMN "section" DROP NOT NULL;
ALTER TABLE "site_sessions" ADD COLUMN "roster_apps" jsonb;
ALTER TABLE "site_documents" ADD COLUMN "group_id" uuid;
ALTER TABLE "site_documents" ADD CONSTRAINT "site_documents_group_id_site_document_groups_id_fk"
  FOREIGN KEY ("group_id") REFERENCES "public"."site_document_groups"("id") ON DELETE no action ON UPDATE no action;
