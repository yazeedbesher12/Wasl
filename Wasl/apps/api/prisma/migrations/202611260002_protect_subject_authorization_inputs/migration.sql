BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles AS r
    WHERE r.rolname = 'wasl_academic_admin' AND r.rolcanlogin
      AND NOT (r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication)
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members WHERE member = r.oid)
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_database WHERE datdba = r.oid)
  ) OR pg_catalog.pg_has_role('wasl_tenant', 'wasl_academic_admin', 'MEMBER') THEN
    RAISE EXCEPTION 'Provision a restricted wasl_academic_admin login first';
  END IF;
  EXECUTE pg_catalog.format('GRANT CONNECT ON DATABASE %I TO wasl_academic_admin', current_database());
END;
$$;

GRANT USAGE ON SCHEMA public TO wasl_academic_admin;
GRANT SELECT (id, email, full_name, preferred_language, active, created_at) ON public.users TO wasl_academic_admin;
GRANT SELECT ON public.memberships, public.schools TO wasl_academic_admin;

-- Subjects authorization derives from class assignments, enrollments, agreements
-- between section/grade/year records, and verified parent links. Keep their writes
-- behind the school-admin execution path and its in-transaction actor check.
REVOKE INSERT, UPDATE ON public.academic_years, public.grades, public.sections,
  public.section_subjects, public.enrollments, public.parent_student_links FROM wasl_tenant;
GRANT SELECT, INSERT, UPDATE ON public.academic_years, public.grades, public.sections,
  public.section_subjects, public.enrollments, public.parent_student_links TO wasl_academic_admin;
-- Administration needs these reads for assignment and academic year validation.
GRANT SELECT ON public.subjects, public.semesters TO wasl_academic_admin;

REVOKE UPDATE ON public.subjects FROM wasl_tenant;
GRANT UPDATE (name_ar, name_en, code) ON public.subjects TO wasl_tenant;

COMMIT;
