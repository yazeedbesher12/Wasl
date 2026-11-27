BEGIN;

-- The administrator provisions a dedicated NOLOGIN role and allows the
-- migrator to transfer ownership of the verification function to it.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles AS r WHERE r.rolname = 'wasl_subject_verifier'
      AND NOT (r.rolcanlogin OR r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication)
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members WHERE member = r.oid)
  ) OR pg_catalog.pg_has_role('wasl_tenant', 'wasl_subject_verifier', 'MEMBER')
    OR pg_catalog.pg_has_role('wasl_platform', 'wasl_subject_verifier', 'MEMBER')
    OR pg_catalog.pg_has_role('wasl_academic_admin', 'wasl_subject_verifier', 'MEMBER')
    OR pg_catalog.pg_has_role('wasl_auth', 'wasl_subject_verifier', 'MEMBER') THEN
    RAISE EXCEPTION 'A dedicated non-runtime Subjects verifier role is required';
  END IF;
END;
$$;

CREATE SCHEMA wasl_subject_scope;
CREATE SCHEMA wasl_subject_crypto;
REVOKE ALL ON SCHEMA wasl_subject_scope, wasl_subject_crypto FROM PUBLIC;
CREATE EXTENSION pgcrypto WITH SCHEMA wasl_subject_crypto;
CREATE TABLE wasl_subject_scope.signing_key (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  secret bytea NOT NULL CHECK (pg_catalog.octet_length(secret) = 32)
);
REVOKE ALL ON wasl_subject_scope.signing_key FROM PUBLIC;

GRANT USAGE ON SCHEMA wasl_subject_crypto, public TO wasl_subject_verifier;
GRANT USAGE, CREATE ON SCHEMA wasl_subject_scope TO wasl_subject_verifier;
GRANT SELECT ON wasl_subject_scope.signing_key TO wasl_subject_verifier;
GRANT SELECT (id, active) ON public.users, public.schools TO wasl_subject_verifier;
GRANT SELECT (id, user_id, school_id, role, active) ON public.memberships TO wasl_subject_verifier;
GRANT SELECT ON public.section_subjects, public.sections, public.grades, public.academic_years,
  public.enrollments, public.parent_student_links TO wasl_subject_verifier;

CREATE FUNCTION wasl_subject_scope.permits(row_school uuid, row_subject uuid, requested text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  proof text := pg_catalog.current_setting('app.subject_proof', true);
  supplied text := pg_catalog.current_setting('app.subject_tag', true);
  signing_secret bytea;
  expected bytea;
  claims jsonb;
  expires bigint;
  now_ms bigint := (EXTRACT(epoch FROM pg_catalog.statement_timestamp()) * 1000)::bigint;
  actor uuid;
  membership uuid;
  operation text;
  child uuid;
  school_role public."Role";
BEGIN
  IF proof IS NULL OR pg_catalog.octet_length(proof) NOT BETWEEN 1 AND 1024
    OR supplied IS NULL OR supplied !~ '^[a-f0-9]{64}$' THEN RETURN false; END IF;
  SELECT secret INTO signing_secret FROM wasl_subject_scope.signing_key WHERE singleton;
  IF signing_secret IS NULL THEN RETURN false; END IF;
  expected := wasl_subject_crypto.hmac(pg_catalog.convert_to(proof, 'UTF8'), signing_secret, 'sha256');
  IF wasl_subject_crypto.hmac(expected, signing_secret, 'sha256') <>
     wasl_subject_crypto.hmac(pg_catalog.decode(supplied, 'hex'), signing_secret, 'sha256') THEN RETURN false; END IF;

  claims := proof::jsonb;
  IF pg_catalog.jsonb_array_length(claims) <> 11 THEN RETURN false; END IF;
  expires := (claims->>4)::bigint;
  IF (claims->>0) IS DISTINCT FROM (SELECT oid::text FROM pg_catalog.pg_database WHERE datname = current_database())
    OR (claims->>1) IS DISTINCT FROM pg_catalog.pg_backend_pid()::text
    OR (claims->>2) IS DISTINCT FROM pg_catalog.pg_current_xact_id_if_assigned()::text
    OR (claims->>3) IS DISTINCT FROM session_user::text
    OR expires IS NULL OR expires <= now_ms OR expires > now_ms + 20000
    OR (claims->>7)::uuid IS DISTINCT FROM row_school THEN RETURN false; END IF;
  actor := (claims->>5)::uuid;
  membership := (claims->>6)::uuid;
  operation := claims->>8;
  child := (claims->>10)::uuid;
  IF operation NOT IN ('read', 'insert', 'update') OR operation IS NULL
    OR (operation <> 'read' AND (claims->>9)::uuid IS DISTINCT FROM row_subject)
    OR (requested <> 'read' AND operation IS DISTINCT FROM requested) THEN RETURN false; END IF;

  SELECT m.role INTO school_role
  FROM public.memberships AS m JOIN public.users AS u ON u.id = m.user_id
  JOIN public.schools AS s ON s.id = m.school_id
  WHERE m.id = membership AND m.user_id = actor AND m.active AND u.active AND s.active
    AND (m.school_id = row_school OR m.role = 'PARENT');
  IF school_role = 'SCHOOL_ADMIN' THEN RETURN child IS NULL; END IF;
  IF school_role IS NULL OR operation <> 'read' OR school_role NOT IN ('TEACHER', 'STUDENT', 'PARENT') THEN RETURN false; END IF;

  IF school_role = 'PARENT' THEN
    IF child IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.parent_student_links AS link
      JOIN public.memberships AS p ON p.user_id = actor AND p.school_id = row_school AND p.active AND p.role = 'PARENT'
      JOIN public.memberships AS c ON c.user_id = child AND c.school_id = row_school AND c.active AND c.role = 'STUDENT'
      JOIN public.users AS u ON u.id = child AND u.active
      WHERE link.school_id = row_school AND link.parent_id = actor AND link.student_id = child
        AND link.status = 'VERIFIED'
    ) THEN RETURN false; END IF;
  ELSIF child IS NOT NULL THEN RETURN false; END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.section_subjects AS a
    JOIN public.sections AS s ON s.id = a.section_id AND s.school_id = row_school
    JOIN public.grades AS g ON g.id = s.grade_id AND g.school_id = row_school
    JOIN public.academic_years AS y ON y.id = s.academic_year_id AND y.school_id = row_school AND NOT y.archived
    WHERE a.school_id = row_school AND a.subject_id = row_subject
      AND (CASE WHEN school_role = 'TEACHER' THEN a.teacher_id = actor ELSE EXISTS (
        SELECT 1 FROM public.enrollments AS e WHERE e.school_id = row_school AND e.section_id = s.id
          AND e.status = 'ACTIVE' AND e.student_id = COALESCE(child, actor)
      ) END)
  );
EXCEPTION WHEN invalid_text_representation OR invalid_parameter_value OR numeric_value_out_of_range THEN
  RETURN false;
END;
$$;

ALTER FUNCTION wasl_subject_scope.permits(uuid, uuid, text) OWNER TO wasl_subject_verifier;
REVOKE CREATE ON SCHEMA wasl_subject_scope FROM wasl_subject_verifier;
REVOKE ALL ON FUNCTION wasl_subject_scope.permits(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wasl_subject_scope.permits(uuid, uuid, text) TO wasl_tenant, wasl_academic_admin;

ALTER TABLE public.subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subjects FORCE ROW LEVEL SECURITY;
CREATE POLICY subjects_read ON public.subjects FOR SELECT TO wasl_tenant, wasl_academic_admin
  USING (wasl_subject_scope.permits(school_id, id, 'read'));
CREATE POLICY subjects_insert ON public.subjects FOR INSERT TO wasl_tenant
  WITH CHECK (wasl_subject_scope.permits(school_id, id, 'insert'));
CREATE POLICY subjects_update ON public.subjects FOR UPDATE TO wasl_tenant
  USING (wasl_subject_scope.permits(school_id, id, 'update'))
  WITH CHECK (wasl_subject_scope.permits(school_id, id, 'update'));

COMMIT;
