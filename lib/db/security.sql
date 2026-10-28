-- Idempotent protection installer. Safe to run at API startup after schema push.
-- Never drops/recreates a trigger or deletes/updates data.
SELECT pg_advisory_xact_lock(74202001);

CREATE OR REPLACE FUNCTION site_refuse_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'site_audit_log is append-only' USING ERRCODE = '42501';
END;
$$;

CREATE OR REPLACE FUNCTION site_refuse_hard_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Retire or end records; hard deletion is forbidden' USING ERRCODE = '42501';
END;
$$;

DO $$
DECLARE
  audit_table regclass := to_regclass('site_audit_log');
  grants_table regclass := to_regclass('site_grants');
  documents_table regclass := to_regclass('site_documents');
  announcements_table regclass := to_regclass('site_announcements');
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
END
$$;

REVOKE UPDATE, DELETE, TRUNCATE ON TABLE site_audit_log FROM PUBLIC;
