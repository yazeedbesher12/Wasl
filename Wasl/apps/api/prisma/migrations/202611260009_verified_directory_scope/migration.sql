BEGIN;

CREATE SCHEMA wasl_directory;
REVOKE ALL ON SCHEMA wasl_directory FROM PUBLIC;
GRANT USAGE ON SCHEMA wasl_directory TO wasl_tenant, wasl_academic_admin, wasl_assessment_staff;
GRANT USAGE, CREATE ON SCHEMA wasl_directory TO wasl_subject_verifier;

-- Contact fields are available through the verified projection. Relationship
-- lookups on the base table have only the name and account-status columns.
REVOKE SELECT ON public.users FROM wasl_tenant, wasl_academic_admin, wasl_assessment_staff;
REVOKE SELECT (email, preferred_language, created_at) ON public.users FROM wasl_tenant, wasl_academic_admin, wasl_assessment_staff;
GRANT SELECT (id, full_name, active) ON public.users TO wasl_tenant, wasl_academic_admin, wasl_assessment_staff;
GRANT SELECT (email, full_name, preferred_language, created_at) ON public.users TO wasl_subject_verifier;

CREATE FUNCTION wasl_directory.actor_scope()
RETURNS TABLE(actor uuid, role public."Role", purpose text, target uuid, school uuid, home_school uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  proof text := pg_catalog.current_setting('app.assessment_proof', true);
  selected uuid;
BEGIN
  IF proof IS NULL OR pg_catalog.octet_length(proof) NOT BETWEEN 1 AND 1024 THEN RETURN; END IF;
  selected := (proof::jsonb->>6)::uuid;
  RETURN QUERY SELECT v.actor, v.role, v.purpose, v.target, hint.school, m.school_id
    FROM (SELECT wasl_academic.current_school() AS school) hint
    CROSS JOIN LATERAL wasl_assessment.verified_actor(hint.school) v
    JOIN public.memberships m ON m.user_id = v.actor AND m.id = selected;
EXCEPTION WHEN invalid_text_representation THEN RETURN;
END;
$$;

CREATE FUNCTION wasl_directory.profile_visible(profile_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM wasl_directory.actor_scope() v
    WHERE v.actor = $1 OR (v.purpose <> 'assessment:discover' AND EXISTS (
      SELECT 1 FROM public.memberships m WHERE m.school_id = v.school AND m.user_id = $1
        AND (v.role = 'SCHOOL_ADMIN' OR (m.active AND (
          (v.role = 'TEACHER' AND m.role = 'STUDENT' AND wasl_academic.membership_visible(m.school_id, m.user_id, m.role))
          OR (v.role = 'STUDENT' AND m.role = 'TEACHER' AND wasl_academic.membership_visible(m.school_id, m.user_id, m.role))
          OR (v.role = 'PARENT' AND v.purpose IN ('assessment:read','assessment:results')
            AND ((m.role = 'STUDENT' AND v.target = m.user_id AND wasl_assessment.linked_child(v.school, v.actor, v.target))
              OR (m.role = 'TEACHER' AND wasl_academic.membership_visible(m.school_id, m.user_id, m.role))))
        )))
    )));
$$;

CREATE FUNCTION wasl_directory.contact_visible(profile_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM wasl_directory.actor_scope() v WHERE v.actor = $1
    OR (v.role = 'SCHOOL_ADMIN' AND EXISTS (SELECT 1 FROM public.memberships m
      WHERE m.school_id = v.school AND m.user_id = $1)));
$$;

CREATE FUNCTION wasl_directory.school_visible(school_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM wasl_directory.actor_scope() v WHERE v.home_school = $1
    OR (v.school = $1 AND v.role = 'PARENT' AND v.purpose IN ('assessment:read','assessment:results')
      AND wasl_assessment.linked_child(v.school, v.actor, v.target)));
$$;

-- Recipient selection and relationship checks need only a scoped eligibility
-- bit. They do not require permission to read the participant's profile.
CREATE FUNCTION wasl_directory.is_eligible(school uuid, member uuid, member_role public."Role")
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM wasl_directory.actor_scope() v
    JOIN public.memberships m ON m.school_id = v.school AND m.user_id = $2 AND m.role = $3 AND m.active
    JOIN public.users u ON u.id = m.user_id AND u.active
    WHERE v.school = $1 AND wasl_academic.membership_visible(m.school_id, m.user_id, m.role));
$$;

ALTER FUNCTION wasl_directory.actor_scope() OWNER TO wasl_subject_verifier;
ALTER FUNCTION wasl_directory.profile_visible(uuid) OWNER TO wasl_subject_verifier;
ALTER FUNCTION wasl_directory.contact_visible(uuid) OWNER TO wasl_subject_verifier;
ALTER FUNCTION wasl_directory.school_visible(uuid) OWNER TO wasl_subject_verifier;
ALTER FUNCTION wasl_directory.is_eligible(uuid,uuid,public."Role") OWNER TO wasl_subject_verifier;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA wasl_directory FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wasl_directory.profile_visible(uuid), wasl_directory.contact_visible(uuid),
  wasl_directory.school_visible(uuid), wasl_directory.is_eligible(uuid,uuid,public."Role")
  TO wasl_tenant, wasl_academic_admin, wasl_assessment_staff;

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users FORCE ROW LEVEL SECURITY;
CREATE POLICY identity_auth_read ON public.users FOR SELECT TO wasl_auth, wasl_subject_verifier USING (true);
CREATE POLICY identity_platform_read ON public.users FOR SELECT TO wasl_platform USING (true);
CREATE POLICY identity_platform_provision ON public.users FOR INSERT TO wasl_platform WITH CHECK (true);
CREATE POLICY identity_platform_profile_write ON public.users FOR UPDATE TO wasl_platform USING (true) WITH CHECK (true);
CREATE POLICY directory_profile_read ON public.users FOR SELECT TO wasl_tenant, wasl_academic_admin, wasl_assessment_staff
  USING (wasl_directory.profile_visible(id));

CREATE VIEW wasl_directory.contact_profiles WITH (security_barrier = true) AS
  SELECT id, email, full_name, preferred_language, active, created_at FROM public.users
  WHERE wasl_directory.contact_visible(id);
ALTER VIEW wasl_directory.contact_profiles OWNER TO wasl_subject_verifier;
REVOKE ALL ON wasl_directory.contact_profiles FROM PUBLIC;
GRANT SELECT ON wasl_directory.contact_profiles TO wasl_tenant, wasl_academic_admin, wasl_assessment_staff;
REVOKE CREATE ON SCHEMA wasl_directory FROM wasl_subject_verifier;

-- A question-bank owner is an authorization input, not just descriptive
-- metadata.  A trusted staff proof must not assign ownership to a teacher in
-- another school (or to an inactive teacher).
CREATE OR REPLACE FUNCTION wasl_assessment.bank_access(row_school uuid, bank_subject uuid, owner_id uuid, writable boolean)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM wasl_assessment.verified_actor($1) v
    WHERE v.role IN ('TEACHER','SCHOOL_ADMIN') AND v.purpose IN ('assessment:staff-read','assessment:staff-write')
      AND (NOT $4 OR (v.purpose = 'assessment:staff-write' AND (v.role = 'SCHOOL_ADMIN' OR v.actor = $3)))
      AND (NOT $4 OR EXISTS (SELECT 1 FROM public.memberships owner_membership
        JOIN public.users owner_user ON owner_user.id = owner_membership.user_id AND owner_user.active
        WHERE owner_membership.school_id = $1 AND owner_membership.user_id = $3
          AND owner_membership.role = 'TEACHER' AND owner_membership.active))
      AND (v.role = 'SCHOOL_ADMIN' OR EXISTS (
        SELECT 1 FROM public.section_subjects a JOIN public.sections s ON s.id = a.section_id AND s.school_id = $1
        JOIN public.academic_years y ON y.id = s.academic_year_id AND y.school_id = $1
        WHERE a.school_id = $1 AND a.subject_id = $2 AND a.teacher_id = v.actor AND (NOT $4 OR NOT y.archived))));
$$;

-- Grading and releasing results are separate capabilities.  The release proof
-- is bound to one assessment and the database independently checks both the
-- lifecycle transition and completion of every final submission.
CREATE OR REPLACE FUNCTION wasl_assessment.verified_actor(row_school uuid)
RETURNS TABLE(actor uuid, role public."Role", purpose text, target uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  proof text := pg_catalog.current_setting('app.assessment_proof', true);
  tag text := pg_catalog.current_setting('app.assessment_tag', true);
  key bytea;
  expected bytea;
  claims jsonb;
  now_ms bigint := (EXTRACT(epoch FROM pg_catalog.statement_timestamp()) * 1000)::bigint;
BEGIN
  IF session_user NOT IN ('wasl_tenant','wasl_assessment_staff','wasl_academic_admin') OR proof IS NULL
    OR pg_catalog.octet_length(proof) NOT BETWEEN 1 AND 1024 OR tag IS NULL OR tag !~ '^[a-f0-9]{64}$' THEN RETURN; END IF;
  SELECT k.secret INTO key FROM wasl_subject_scope.signing_key k WHERE k.singleton;
  IF key IS NULL THEN RETURN; END IF;
  expected := wasl_subject_crypto.hmac(pg_catalog.convert_to(proof, 'UTF8'), key, 'sha256');
  IF wasl_subject_crypto.hmac(expected, key, 'sha256') <>
     wasl_subject_crypto.hmac(pg_catalog.decode(tag, 'hex'), key, 'sha256') THEN RETURN; END IF;
  claims := proof::jsonb;
  IF pg_catalog.jsonb_array_length(claims) <> 10
    OR claims->>0 IS DISTINCT FROM (SELECT oid::text FROM pg_catalog.pg_database WHERE datname = current_database())
    OR claims->>1 IS DISTINCT FROM pg_catalog.pg_backend_pid()::text
    OR claims->>2 IS DISTINCT FROM pg_catalog.pg_current_xact_id_if_assigned()::text
    OR claims->>3 IS DISTINCT FROM session_user::text
    OR (claims->>4)::bigint IS NULL OR (claims->>4)::bigint <= now_ms OR (claims->>4)::bigint > now_ms + 20000
    OR (claims->>7)::uuid IS DISTINCT FROM row_school THEN RETURN; END IF;

  actor := (claims->>5)::uuid;
  purpose := claims->>8;
  target := (claims->>9)::uuid;
  SELECT m.role INTO role FROM public.memberships m JOIN public.users u ON u.id = m.user_id
    JOIN public.schools s ON s.id = m.school_id
    WHERE m.id = (claims->>6)::uuid AND m.user_id = actor AND m.active AND u.active AND s.active
      AND (m.school_id = row_school OR m.role = 'PARENT');
  IF role IS NULL OR target IS NULL OR purpose IS NULL THEN RETURN; END IF;
  IF session_user = 'wasl_academic_admin' THEN
    IF role = 'SCHOOL_ADMIN' AND target = actor AND purpose = 'assessment:academic-write' THEN RETURN NEXT; END IF;
  ELSIF session_user = 'wasl_assessment_staff' THEN
    IF (role IN ('TEACHER','SCHOOL_ADMIN') AND target = actor AND purpose IN ('assessment:staff-read','assessment:staff-write'))
      OR (role = 'TEACHER' AND purpose IN ('assessment:staff-grade','assessment:staff-release')) THEN RETURN NEXT; END IF;
  ELSIF role = 'STUDENT' THEN
    IF purpose IN ('assessment:draft','assessment:submit','assessment:file-write') OR
      (purpose IN ('assessment:read','assessment:results','assessment:metadata') AND target = actor) THEN RETURN NEXT; END IF;
  ELSIF role = 'PARENT' THEN
    IF (purpose IN ('assessment:metadata','assessment:discover') AND target = actor) OR purpose IN ('assessment:read','assessment:results') THEN RETURN NEXT; END IF;
  ELSIF role IN ('TEACHER','SCHOOL_ADMIN') AND ((target = actor AND purpose IN ('assessment:read','assessment:metadata','assessment:content-write','assessment:announcement-write')) OR purpose = 'assessment:file-write') THEN RETURN NEXT;
  END IF;
EXCEPTION WHEN invalid_text_representation OR invalid_parameter_value OR numeric_value_out_of_range THEN RETURN;
END;
$$;

CREATE OR REPLACE FUNCTION wasl_assessment.class_access(row_school uuid, assignment_id uuid, assessment_id uuid, writable boolean)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM wasl_assessment.verified_actor($1) v
    JOIN public.section_subjects a ON a.id = $2 AND a.school_id = $1
    JOIN public.sections s ON s.id = a.section_id AND s.school_id = $1
    JOIN public.academic_years y ON y.id = s.academic_year_id AND y.school_id = $1
    WHERE (v.purpose NOT IN ('assessment:staff-grade','assessment:staff-release') OR
      (v.purpose = 'assessment:staff-grade' AND EXISTS (SELECT 1 FROM public.submissions sub
        WHERE sub.id = v.target AND sub.school_id = $1 AND sub.assessment_id = $3)) OR
      (v.purpose = 'assessment:staff-release' AND v.target = $3)) AND CASE
      WHEN $4 THEN v.role = 'TEACHER' AND v.actor = a.teacher_id
        AND v.purpose IN ('assessment:staff-write','assessment:staff-grade','assessment:staff-release') AND NOT y.archived
      WHEN v.role = 'SCHOOL_ADMIN' THEN true
      WHEN v.role = 'TEACHER' THEN v.actor = a.teacher_id
      ELSE v.purpose <> 'assessment:discover' AND (v.purpose NOT IN ('assessment:draft','assessment:submit') OR v.target = $3) AND EXISTS (
        SELECT 1 FROM public.enrollments e WHERE e.school_id = $1 AND e.section_id = s.id AND e.status = 'ACTIVE'
        AND (CASE WHEN v.role = 'STUDENT' THEN e.student_id = v.actor
          ELSE (v.purpose = 'assessment:metadata' OR e.student_id = v.target)
            AND wasl_assessment.linked_child($1, v.actor, e.student_id) END)
      ) END);
$$;

CREATE OR REPLACE FUNCTION wasl_assessment.edit_assessment_scope(row_school uuid, assessment_id uuid, assignment_id uuid,
  next_status public."AssessmentStatus", next_type public."AssessmentType", next_title text,
  next_instructions text, next_opens timestamp, next_due timestamp, next_release timestamp)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT wasl_assessment.class_access($1, $3, $2, true) AND EXISTS (
    SELECT 1 FROM wasl_assessment.verified_actor($1) v JOIN public.assessments a ON a.id = $2 AND a.school_id = $1
    WHERE CASE v.purpose
      WHEN 'assessment:staff-write' THEN
        (($4 NOT IN ('RESULTS_RELEASED','ARCHIVED') AND a.status NOT IN ('RESULTS_RELEASED','ARCHIVED') AND $10 IS NULL)
          OR (a.status = 'RESULTS_RELEASED' AND $4 IN ('RESULTS_RELEASED','ARCHIVED') AND $10 IS NOT DISTINCT FROM a.results_released_at)
          OR (a.status = 'ARCHIVED' AND $4 = 'ARCHIVED' AND $10 IS NOT DISTINCT FROM a.results_released_at))
      WHEN 'assessment:staff-grade' THEN v.target IN (SELECT s.id FROM public.submissions s
          WHERE s.school_id = $1 AND s.assessment_id = $2)
        AND a.status IN ('CLOSED','GRADING') AND $4 = 'GRADING'
        AND (a.type, a.title, a.instructions, a.opens_at, a.due_at, a.results_released_at)
          IS NOT DISTINCT FROM ($5, $6, $7, $8, $9, $10)
      WHEN 'assessment:staff-release' THEN v.target = $2 AND a.status = 'GRADING' AND $4 = 'RESULTS_RELEASED'
        AND $10 IS NOT NULL AND a.results_released_at IS NULL
        AND (a.type, a.title, a.instructions, a.opens_at, a.due_at)
          IS NOT DISTINCT FROM ($5, $6, $7, $8, $9)
        AND EXISTS (SELECT 1 FROM public.submissions s WHERE s.school_id = $1 AND s.assessment_id = $2 AND s.status <> 'IN_PROGRESS')
        AND NOT EXISTS (SELECT 1 FROM public.submissions s WHERE s.school_id = $1 AND s.assessment_id = $2
          AND s.status <> 'IN_PROGRESS' AND (s.status <> 'GRADED' OR s.score IS NULL OR s.graded_at IS NULL))
      ELSE false END);
$$;

CREATE OR REPLACE FUNCTION wasl_private.notification_access(school uuid, recipient uuid, event text, payload jsonb, writing boolean)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  entity uuid;
  assignment uuid;
  student uuid;
BEGIN
  IF pg_catalog.jsonb_typeof($4) IS DISTINCT FROM 'object' OR NOT ($4 ? 'sectionSubjectId')
    OR ($4 - 'entityId' - 'sectionSubjectId' - 'studentId') <> '{}'::jsonb THEN RETURN false; END IF;
  entity := ($4->>'entityId')::uuid;
  assignment := ($4->>'sectionSubjectId')::uuid;
  student := ($4->>'studentId')::uuid;
  IF entity IS NULL OR NOT wasl_private.active_school_member($1, $2) THEN RETURN false; END IF;
  IF NOT $5 AND NOT EXISTS (SELECT 1 FROM wasl_assessment.verified_actor($1) v
    WHERE v.actor = $2 AND v.purpose = 'assessment:metadata') THEN RETURN false; END IF;

  IF $3 = 'ANNOUNCEMENT_PUBLISHED' THEN
    RETURN EXISTS (SELECT 1 FROM public.announcements n
      WHERE n.school_id = $1 AND n.id = entity AND n.status = 'PUBLISHED' AND n.section_subject_id IS NOT DISTINCT FROM assignment
        AND (CASE WHEN assignment IS NULL THEN student IS NULL ELSE wasl_private.class_recipient($1, assignment, $2, student) END)
        AND CASE WHEN $5 THEN wasl_private.announcement_manage($1, n.author_id, n.section_subject_id, false)
          ELSE wasl_private.announcement_visible($1, n.author_id, n.section_subject_id, n.status) END);
  ELSIF $3 IN ('ASSESSMENT_PUBLISHED','RESULTS_RELEASED') THEN
    RETURN EXISTS (SELECT 1 FROM public.assessments a WHERE a.school_id = $1 AND a.id = entity AND a.section_subject_id = assignment
      AND a.status <> 'DRAFT' AND wasl_private.class_recipient($1, assignment, $2, student)
      AND ($3 <> 'RESULTS_RELEASED' OR (a.status IN ('RESULTS_RELEASED','ARCHIVED') AND a.results_released_at IS NOT NULL
        AND EXISTS (SELECT 1 FROM public.submissions s WHERE s.school_id = $1 AND s.assessment_id = a.id AND s.student_id = student AND s.status = 'GRADED')))
      AND CASE WHEN $5 THEN wasl_assessment.class_access($1, assignment, a.id, true)
        AND EXISTS (SELECT 1 FROM wasl_assessment.verified_actor($1) v
          WHERE ($3 = 'RESULTS_RELEASED' AND v.purpose = 'assessment:staff-release' AND v.target = a.id)
            OR ($3 = 'ASSESSMENT_PUBLISHED' AND v.purpose = 'assessment:staff-write'))
        ELSE wasl_assessment.assessment_access($1, a.id, false) END);
  ELSIF $3 = 'SUBMISSION_RECEIVED' THEN
    RETURN EXISTS (SELECT 1 FROM public.submissions s
      JOIN public.assessments a ON a.id = s.assessment_id AND a.school_id = $1
      JOIN public.section_subjects ss ON ss.id = a.section_subject_id AND ss.school_id = $1
      WHERE s.school_id = $1 AND s.id = entity AND s.student_id = student AND s.status <> 'IN_PROGRESS'
        AND a.section_subject_id = assignment AND ($2 = s.student_id OR $2 = ss.teacher_id)
        AND CASE WHEN $5 THEN s.status = 'SUBMITTED' AND EXISTS (
          SELECT 1 FROM wasl_assessment.verified_actor($1) v WHERE v.purpose = 'assessment:submit'
            AND v.target = a.id AND v.actor = s.student_id)
          ELSE wasl_assessment.assessment_access($1, a.id, false) END);
  END IF;
  RETURN false;
EXCEPTION WHEN invalid_text_representation THEN RETURN false;
END;
$$;

ALTER TABLE public.schools ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schools FORCE ROW LEVEL SECURITY;
CREATE POLICY school_auth_read ON public.schools FOR SELECT TO wasl_auth, wasl_subject_verifier USING (true);
CREATE POLICY school_platform_read ON public.schools FOR SELECT TO wasl_platform USING (true);
CREATE POLICY school_platform_provision ON public.schools FOR INSERT TO wasl_platform WITH CHECK (true);
CREATE POLICY school_platform_update ON public.schools FOR UPDATE TO wasl_platform USING (true) WITH CHECK (true);
CREATE POLICY directory_school_read ON public.schools FOR SELECT TO wasl_tenant, wasl_academic_admin, wasl_assessment_staff
  USING (wasl_directory.school_visible(id));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM (VALUES ('wasl_tenant'), ('wasl_academic_admin'), ('wasl_assessment_staff')) AS r(role)
    WHERE pg_catalog.has_column_privilege(r.role, 'public.users', 'email', 'SELECT')
       OR pg_catalog.has_column_privilege(r.role, 'public.users', 'password_hash', 'SELECT')
       OR pg_catalog.has_any_column_privilege(r.role, 'public.users', 'INSERT, UPDATE')
       OR pg_catalog.has_any_column_privilege(r.role, 'public.schools', 'INSERT, UPDATE')) THEN
    RAISE EXCEPTION 'Unexpected direct grants on verified directory relations';
  END IF;
END;
$$;

COMMIT;
