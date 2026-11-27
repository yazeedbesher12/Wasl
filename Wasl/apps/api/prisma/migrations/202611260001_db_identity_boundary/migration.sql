BEGIN;

-- Provision these logins outside Prisma using the database administrator and
-- the deployment secret store. The database owner does not need CREATEROLE.
DO $$
DECLARE
  runtime_role record;
BEGIN
  IF (SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname IN ('wasl_auth', 'wasl_platform', 'wasl_tenant')) <> 3 THEN
    RAISE EXCEPTION 'Provision wasl_auth, wasl_platform and wasl_tenant before deploying';
  END IF;

  FOR runtime_role IN
    SELECT * FROM pg_catalog.pg_roles WHERE rolname IN ('wasl_auth', 'wasl_platform', 'wasl_tenant')
  LOOP
    IF NOT runtime_role.rolcanlogin OR runtime_role.rolsuper OR runtime_role.rolbypassrls
      OR runtime_role.rolcreatedb OR runtime_role.rolcreaterole OR runtime_role.rolreplication
      OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members WHERE member = runtime_role.oid)
      OR EXISTS (SELECT 1 FROM pg_catalog.pg_database WHERE datdba = runtime_role.oid)
      OR EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspowner = runtime_role.oid)
      OR EXISTS (
        SELECT 1 FROM pg_catalog.pg_class AS relation
        JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = 'public' AND (
          relation.relowner = runtime_role.oid OR EXISTS (
            SELECT 1 FROM pg_catalog.aclexplode(relation.relacl) WHERE grantee = runtime_role.oid
          ) OR EXISTS (
            SELECT 1 FROM pg_catalog.pg_attribute AS attribute
            CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS grant_entry
            WHERE attribute.attrelid = relation.oid AND grant_entry.grantee = runtime_role.oid
          )
        )
      ) THEN
      RAISE EXCEPTION 'Expected a clean, unprivileged login for %', runtime_role.rolname;
    END IF;
  END LOOP;

  EXECUTE pg_catalog.format('REVOKE CONNECT, TEMP ON DATABASE %I FROM PUBLIC', current_database());
  EXECUTE pg_catalog.format('REVOKE CREATE, TEMP ON DATABASE %I FROM wasl_auth, wasl_platform, wasl_tenant', current_database());
  EXECUTE pg_catalog.format('GRANT CONNECT ON DATABASE %I TO wasl_auth, wasl_platform, wasl_tenant', current_database());
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'wasl_app') THEN
    EXECUTE pg_catalog.format('REVOKE ALL ON DATABASE %I FROM wasl_app', current_database());
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM wasl_app;
  END IF;
END;
$$;

REVOKE CREATE ON SCHEMA public FROM PUBLIC, wasl_auth, wasl_platform, wasl_tenant;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO wasl_auth, wasl_platform, wasl_tenant;

GRANT SELECT (id, email, full_name, preferred_language, active, created_at)
  ON public.users TO wasl_auth, wasl_platform, wasl_tenant;
GRANT SELECT ON public.memberships, public.schools TO wasl_auth, wasl_platform, wasl_tenant;

GRANT SELECT (password_hash) ON public.users TO wasl_auth;
GRANT SELECT (id, user_id, token_hash, expires_at, revoked_at),
  INSERT (id, user_id, token_hash, expires_at, revoked_at, created_at), UPDATE (revoked_at)
  ON public.refresh_tokens TO wasl_auth;

GRANT INSERT (id, email, full_name, password_hash, preferred_language, active, created_at),
  UPDATE (full_name, preferred_language) ON public.users TO wasl_platform;
GRANT INSERT (id, name, name_ar, locale, active, created_at), UPDATE (name, name_ar, locale, active)
  ON public.schools TO wasl_platform;

CREATE SCHEMA wasl_admin;
REVOKE ALL ON SCHEMA wasl_admin FROM PUBLIC;
CREATE VIEW wasl_admin.school_memberships AS
  SELECT id, user_id, school_id, role, active, created_at
  FROM public.memberships
  WHERE school_id IS NOT NULL AND role IN ('SCHOOL_ADMIN', 'TEACHER', 'STUDENT', 'PARENT')
  WITH CASCADED CHECK OPTION;
REVOKE ALL ON wasl_admin.school_memberships FROM PUBLIC;
GRANT USAGE ON SCHEMA wasl_admin TO wasl_platform;
GRANT SELECT, INSERT (id, user_id, school_id, role, active, created_at), UPDATE (active)
  ON wasl_admin.school_memberships TO wasl_platform;

GRANT SELECT, INSERT, UPDATE ON
  public.academic_years, public.semesters, public.grades, public.sections, public.subjects,
  public.section_subjects, public.enrollments, public.parent_student_links,
  public.units, public.lessons, public.resources, public.question_banks, public.questions,
  public.assessments, public.submissions, public.announcements, public.notifications
  TO wasl_tenant;
GRANT SELECT, INSERT, DELETE ON public.answers, public.assessment_questions, public.question_options TO wasl_tenant;
GRANT SELECT, INSERT ON public.file_objects TO wasl_tenant;

-- Column ACLs can survive a table-level REVOKE. Check effective grants before
-- committing so an unexpected PUBLIC ACL cannot silently widen the boundary.
DO $$
BEGIN
  IF pg_catalog.has_column_privilege('wasl_tenant', 'public.users', 'password_hash', 'SELECT')
    OR pg_catalog.has_any_column_privilege('wasl_tenant', 'public.users', 'INSERT, UPDATE')
    OR pg_catalog.has_any_column_privilege('wasl_tenant', 'public.memberships', 'INSERT, UPDATE')
    OR pg_catalog.has_any_column_privilege('wasl_tenant', 'public.refresh_tokens', 'SELECT, INSERT, UPDATE')
    OR pg_catalog.has_any_column_privilege('wasl_tenant', 'public.schools', 'INSERT, UPDATE')
    OR pg_catalog.has_schema_privilege('wasl_tenant', 'wasl_admin', 'USAGE')
    OR pg_catalog.has_column_privilege('wasl_platform', 'public.users', 'password_hash', 'SELECT, UPDATE')
    OR pg_catalog.has_any_column_privilege('wasl_platform', 'public.memberships', 'INSERT, UPDATE')
    OR pg_catalog.has_any_column_privilege('wasl_platform', 'public.refresh_tokens', 'SELECT, INSERT, UPDATE')
    OR pg_catalog.has_any_column_privilege('wasl_auth', 'public.users', 'INSERT, UPDATE')
    OR pg_catalog.has_any_column_privilege('wasl_auth', 'public.memberships', 'INSERT, UPDATE')
    OR pg_catalog.has_any_column_privilege('wasl_auth', 'public.schools', 'INSERT, UPDATE') THEN
    RAISE EXCEPTION 'Unexpected effective privileges on DB-02 identity relations';
  END IF;
END;
$$;

COMMIT;
