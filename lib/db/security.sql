-- Development installation only. Never run this from application startup.
-- Audit appends are permitted; UPDATE, DELETE and TRUNCATE are database-enforced refusals.
CREATE OR REPLACE FUNCTION site_refuse_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'site_audit_log is append-only' USING ERRCODE = '42501';
END;
$$;
CREATE OR REPLACE TRIGGER site_audit_immutable
  BEFORE UPDATE OR DELETE OR TRUNCATE ON site_audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION site_refuse_audit_mutation();
REVOKE UPDATE, DELETE, TRUNCATE ON site_audit_log FROM PUBLIC;
DO $$ BEGIN
  EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON site_audit_log FROM %I', current_user);
END $$;
CREATE OR REPLACE FUNCTION site_refuse_hard_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Retire or end records; hard deletion is forbidden' USING ERRCODE = '42501';
END;
$$;
CREATE OR REPLACE TRIGGER site_grants_no_delete BEFORE DELETE OR TRUNCATE ON site_grants
  FOR EACH STATEMENT EXECUTE FUNCTION site_refuse_hard_delete();
CREATE OR REPLACE TRIGGER site_documents_no_delete BEFORE DELETE OR TRUNCATE ON site_documents
  FOR EACH STATEMENT EXECUTE FUNCTION site_refuse_hard_delete();
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='site_grant_role' AND conrelid='site_grants'::regclass) THEN
    ALTER TABLE site_grants ADD CONSTRAINT site_grant_role CHECK (role IN ('editor','admin'));
  END IF;
END $$;
