-- Idempotent protection installer. Safe to run at API startup after schema push.
-- Never drops/recreates a trigger or deletes/updates data.
SELECT pg_advisory_xact_lock(74202001);

DO $installer$
BEGIN
IF to_regprocedure('site_refuse_audit_mutation()') IS NULL THEN
EXECUTE $function$CREATE FUNCTION site_refuse_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $body$
BEGIN
  RAISE EXCEPTION 'site_audit_log is append-only' USING ERRCODE = '42501';
END;
$body$;$function$;
END IF;

IF to_regprocedure('site_refuse_hard_delete()') IS NULL THEN
EXECUTE $function$CREATE FUNCTION site_refuse_hard_delete() RETURNS trigger LANGUAGE plpgsql AS $body$
BEGIN
  RAISE EXCEPTION 'Retire or end records; hard deletion is forbidden' USING ERRCODE = '42501';
END;
$body$;$function$;
END IF;
END;
$installer$;

DO $$
DECLARE
  audit_table regclass := to_regclass('site_audit_log');
  grants_table regclass := to_regclass('site_grants');
  documents_table regclass := to_regclass('site_documents');
  announcements_table regclass := to_regclass('site_announcements');
  groups_table regclass := to_regclass('site_document_groups');
  migrations_table regclass := to_regclass('site_data_migrations');
BEGIN
  IF audit_table IS NULL OR grants_table IS NULL OR documents_table IS NULL OR announcements_table IS NULL THEN
    RAISE EXCEPTION 'HWD protected tables must exist before protection installation';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = audit_table AND tgname = 'site_audit_immutable' AND NOT tgisinternal) THEN
    EXECUTE 'CREATE TRIGGER site_audit_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON site_audit_log FOR EACH STATEMENT EXECUTE FUNCTION site_refuse_audit_mutation()';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = grants_table AND tgname = 'site_grants_no_delete' AND NOT tgisinternal) THEN
    EXECUTE 'CREATE TRIGGER site_grants_no_delete BEFORE DELETE OR TRUNCATE ON site_grants FOR EACH STATEMENT EXECUTE FUNCTION site_refuse_hard_delete()';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = documents_table AND tgname = 'site_documents_no_delete' AND NOT tgisinternal) THEN
    EXECUTE 'CREATE TRIGGER site_documents_no_delete BEFORE DELETE OR TRUNCATE ON site_documents FOR EACH STATEMENT EXECUTE FUNCTION site_refuse_hard_delete()';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = announcements_table AND tgname = 'site_announcements_no_delete' AND NOT tgisinternal) THEN
    EXECUTE 'CREATE TRIGGER site_announcements_no_delete BEFORE DELETE OR TRUNCATE ON site_announcements FOR EACH STATEMENT EXECUTE FUNCTION site_refuse_hard_delete()';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='site_grant_role' AND conrelid=grants_table) THEN
    ALTER TABLE site_grants ADD CONSTRAINT site_grant_role CHECK (role IN ('editor','admin'));
  END IF;
  IF groups_table IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid=groups_table AND tgname='site_groups_no_delete' AND NOT tgisinternal) THEN
    CREATE TRIGGER site_groups_no_delete BEFORE DELETE OR TRUNCATE ON site_document_groups FOR EACH STATEMENT EXECUTE FUNCTION site_refuse_hard_delete();
  END IF;
  IF migrations_table IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid=migrations_table AND tgname='site_migrations_immutable' AND NOT tgisinternal) THEN
    CREATE TRIGGER site_migrations_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON site_data_migrations FOR EACH STATEMENT EXECUTE FUNCTION site_refuse_audit_mutation();
  END IF;
END
$$;

REVOKE UPDATE, DELETE, TRUNCATE ON TABLE site_audit_log FROM PUBLIC;
