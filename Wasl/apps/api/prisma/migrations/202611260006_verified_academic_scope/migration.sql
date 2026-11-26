BEGIN;

-- Retain the existing proof format and verifier ownership. Admit the separate
-- academic provider only with a school-admin membership and its write purpose.
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
      OR (role = 'TEACHER' AND purpose = 'assessment:staff-grade') THEN RETURN NEXT; END IF;
  ELSIF role = 'STUDENT' THEN
    IF purpose IN ('assessment:draft','assessment:submit') OR
      (purpose IN ('assessment:read','assessment:results','assessment:metadata') AND target = actor) THEN RETURN NEXT; END IF;
  ELSIF role = 'PARENT' THEN
    IF (purpose IN ('assessment:metadata','assessment:discover') AND target = actor) OR purpose IN ('assessment:read','assessment:results') THEN RETURN NEXT; END IF;
  ELSIF role IN ('TEACHER','SCHOOL_ADMIN') AND target = actor AND purpose IN ('assessment:read','assessment:metadata') THEN RETURN NEXT;
  END IF;
EXCEPTION WHEN invalid_text_representation OR invalid_parameter_value OR numeric_value_out_of_range THEN RETURN;
END;
$$;

CREATE SCHEMA wasl_academic;
REVOKE ALL ON SCHEMA wasl_academic FROM PUBLIC;
GRANT USAGE ON SCHEMA wasl_academic TO wasl_tenant, wasl_assessment_staff, wasl_academic_admin;
GRANT USAGE, CREATE ON SCHEMA wasl_academic TO wasl_subject_verifier;

CREATE UNIQUE INDEX academic_years_school_row_idx ON public.academic_years (school_id, id);
CREATE UNIQUE INDEX grades_school_row_idx ON public.grades (school_id, id);
CREATE UNIQUE INDEX sections_school_row_idx ON public.sections (school_id, id);
CREATE UNIQUE INDEX subjects_school_row_idx ON public.subjects (school_id, id);
CREATE UNIQUE INDEX section_subjects_school_row_idx ON public.section_subjects (school_id, id);

ALTER TABLE public.semesters ADD CONSTRAINT semesters_school_year_fk
  FOREIGN KEY (school_id, academic_year_id) REFERENCES public.academic_years (school_id, id);
ALTER TABLE public.sections ADD CONSTRAINT sections_school_year_fk
  FOREIGN KEY (school_id, academic_year_id) REFERENCES public.academic_years (school_id, id),
  ADD CONSTRAINT sections_school_grade_fk FOREIGN KEY (school_id, grade_id) REFERENCES public.grades (school_id, id);
ALTER TABLE public.section_subjects ADD CONSTRAINT section_subjects_school_section_fk
  FOREIGN KEY (school_id, section_id) REFERENCES public.sections (school_id, id),
  ADD CONSTRAINT section_subjects_school_subject_fk FOREIGN KEY (school_id, subject_id) REFERENCES public.subjects (school_id, id);
ALTER TABLE public.enrollments ADD CONSTRAINT enrollments_school_section_fk
  FOREIGN KEY (school_id, section_id) REFERENCES public.sections (school_id, id);

REVOKE INSERT, UPDATE ON public.semesters FROM wasl_tenant;
GRANT INSERT ON public.semesters TO wasl_academic_admin;
REVOKE UPDATE ON public.academic_years, public.grades, public.sections, public.section_subjects,
  public.enrollments, public.parent_student_links FROM wasl_academic_admin;
GRANT UPDATE (name, start_date, end_date, archived) ON public.academic_years TO wasl_academic_admin;
GRANT UPDATE (name, start_date, end_date) ON public.semesters TO wasl_academic_admin;
GRANT UPDATE (name, level) ON public.grades TO wasl_academic_admin;
GRANT UPDATE (name) ON public.sections TO wasl_academic_admin;
GRANT UPDATE (teacher_id) ON public.section_subjects TO wasl_academic_admin;
GRANT UPDATE (status) ON public.enrollments TO wasl_academic_admin;
GRANT UPDATE (status, verified_at) ON public.parent_student_links TO wasl_academic_admin;

CREATE FUNCTION wasl_academic.can_manage(school uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM wasl_assessment.verified_actor($1) v
    WHERE v.role = 'SCHOOL_ADMIN' AND v.purpose = 'assessment:academic-write');
$$;

-- The optional assignment parameter distinguishes an assignment with no
-- teacher from visibility of the section itself.
CREATE FUNCTION wasl_academic.section_visible(school uuid, section uuid, assignment_teacher uuid, is_assignment boolean DEFAULT false)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM wasl_assessment.verified_actor($1) v
    WHERE v.purpose <> 'assessment:discover'
      AND (v.purpose NOT IN ('assessment:draft','assessment:submit','assessment:staff-grade') OR EXISTS (
        SELECT 1 FROM public.assessments a JOIN public.section_subjects ss ON ss.id = a.section_subject_id AND ss.school_id = $1
        WHERE a.school_id = $1 AND ss.section_id = $2 AND (
          (v.purpose IN ('assessment:draft','assessment:submit') AND a.id = v.target) OR
          (v.purpose = 'assessment:staff-grade' AND EXISTS (SELECT 1 FROM public.submissions s
            WHERE s.id = v.target AND s.school_id = $1 AND s.assessment_id = a.id)))))
      AND CASE v.role
        WHEN 'SCHOOL_ADMIN' THEN true
        WHEN 'TEACHER' THEN CASE WHEN $4 THEN $3 = v.actor ELSE EXISTS (
          SELECT 1 FROM public.section_subjects assn WHERE assn.school_id = $1 AND assn.section_id = $2 AND assn.teacher_id = v.actor
        ) END
        ELSE EXISTS (SELECT 1 FROM public.enrollments e WHERE e.school_id = $1 AND e.section_id = $2 AND e.status = 'ACTIVE'
          AND (CASE WHEN v.role = 'STUDENT' THEN e.student_id = v.actor
            ELSE v.role = 'PARENT' AND (e.student_id = v.target OR v.purpose = 'assessment:metadata')
              AND wasl_assessment.linked_child($1, v.actor, e.student_id) END))
      END);
$$;

CREATE FUNCTION wasl_academic.structure_visible(school uuid, year_id uuid, grade_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM wasl_assessment.verified_actor($1) v WHERE v.role = 'SCHOOL_ADMIN')
    OR EXISTS (SELECT 1 FROM public.sections s WHERE s.school_id = $1
      AND ($2 IS NULL OR s.academic_year_id = $2) AND ($3 IS NULL OR s.grade_id = $3)
      AND wasl_academic.section_visible($1, s.id, NULL));
$$;

CREATE FUNCTION wasl_academic.enrollment_visible(school uuid, section uuid, student uuid, enrollment_status public."EnrollmentStatus")
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM wasl_assessment.verified_actor($1) v
    WHERE v.role = 'SCHOOL_ADMIN' OR ($4 = 'ACTIVE'
      AND wasl_academic.section_visible($1, $2, NULL)
      AND (v.role = 'TEACHER' OR (v.role = 'STUDENT' AND v.actor = $3)
        OR (v.role = 'PARENT' AND (v.target = $3 OR v.purpose = 'assessment:metadata')
          AND wasl_assessment.linked_child($1, v.actor, $3)))));
$$;

CREATE FUNCTION wasl_academic.year_open(school uuid, year_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT wasl_academic.can_manage($1) AND EXISTS (SELECT 1 FROM public.academic_years y
    WHERE y.school_id = $1 AND y.id = $2 AND NOT y.archived);
$$;

CREATE FUNCTION wasl_academic.section_open(school uuid, section uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.sections s WHERE s.school_id = $1 AND s.id = $2
    AND wasl_academic.year_open($1, s.academic_year_id));
$$;

CREATE FUNCTION wasl_academic.valid_participant(school uuid, participant uuid, member_role public."Role", active_required boolean)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT wasl_academic.can_manage($1) AND ($2 IS NULL OR EXISTS (
    SELECT 1 FROM public.memberships m JOIN public.users u ON u.id = m.user_id
    WHERE m.school_id = $1 AND m.user_id = $2 AND m.role = $3 AND (NOT $4 OR (m.active AND u.active))));
$$;

-- The decoded school is a lookup hint. verified_actor checks its signature and
-- transaction binding before any membership is visible.
CREATE FUNCTION wasl_academic.current_school()
RETURNS uuid LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE proof text := pg_catalog.current_setting('app.assessment_proof', true);
BEGIN
  IF proof IS NULL OR pg_catalog.octet_length(proof) NOT BETWEEN 1 AND 1024 THEN RETURN NULL; END IF;
  RETURN (proof::jsonb->>7)::uuid;
EXCEPTION WHEN invalid_text_representation THEN RETURN NULL;
END;
$$;

CREATE FUNCTION wasl_academic.membership_visible(school uuid, member uuid, member_role public."Role")
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM wasl_assessment.verified_actor(wasl_academic.current_school()) v
    WHERE v.actor = $2 OR ($1 = wasl_academic.current_school() AND v.purpose <> 'assessment:discover' AND (
      v.role = 'SCHOOL_ADMIN'
      OR ($3 = 'STUDENT' AND EXISTS (SELECT 1 FROM public.enrollments e
        WHERE e.school_id = $1 AND e.student_id = $2 AND wasl_academic.enrollment_visible($1, e.section_id, e.student_id, e.status)))
      OR ($3 = 'STUDENT' AND v.role = 'PARENT' AND (v.target = $2 OR v.purpose = 'assessment:metadata')
        AND wasl_assessment.linked_child($1, v.actor, $2))
      OR ($3 = 'TEACHER' AND EXISTS (SELECT 1 FROM public.section_subjects a WHERE a.school_id = $1 AND a.teacher_id = $2
        AND wasl_academic.section_visible($1, a.section_id, a.teacher_id, true)))
      OR ($3 = 'PARENT' AND v.role = 'TEACHER' AND EXISTS (SELECT 1 FROM public.enrollments e
        WHERE e.school_id = $1 AND e.status = 'ACTIVE' AND wasl_academic.section_visible($1, e.section_id, NULL)
          AND wasl_assessment.linked_child($1, $2, e.student_id)))
    )));
$$;

ALTER FUNCTION wasl_academic.can_manage(uuid) OWNER TO wasl_subject_verifier;
ALTER FUNCTION wasl_academic.section_visible(uuid,uuid,uuid,boolean) OWNER TO wasl_subject_verifier;
ALTER FUNCTION wasl_academic.structure_visible(uuid,uuid,uuid) OWNER TO wasl_subject_verifier;
ALTER FUNCTION wasl_academic.enrollment_visible(uuid,uuid,uuid,public."EnrollmentStatus") OWNER TO wasl_subject_verifier;
ALTER FUNCTION wasl_academic.year_open(uuid,uuid) OWNER TO wasl_subject_verifier;
ALTER FUNCTION wasl_academic.section_open(uuid,uuid) OWNER TO wasl_subject_verifier;
ALTER FUNCTION wasl_academic.valid_participant(uuid,uuid,public."Role",boolean) OWNER TO wasl_subject_verifier;
ALTER FUNCTION wasl_academic.current_school() OWNER TO wasl_subject_verifier;
ALTER FUNCTION wasl_academic.membership_visible(uuid,uuid,public."Role") OWNER TO wasl_subject_verifier;
REVOKE CREATE ON SCHEMA wasl_academic FROM wasl_subject_verifier;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA wasl_academic FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wasl_academic.section_visible(uuid,uuid,uuid,boolean), wasl_academic.structure_visible(uuid,uuid,uuid), wasl_academic.enrollment_visible(uuid,uuid,uuid,public."EnrollmentStatus") TO wasl_tenant, wasl_assessment_staff, wasl_academic_admin;
GRANT EXECUTE ON FUNCTION wasl_academic.can_manage(uuid), wasl_academic.year_open(uuid,uuid), wasl_academic.section_open(uuid,uuid), wasl_academic.valid_participant(uuid,uuid,public."Role",boolean) TO wasl_academic_admin;
GRANT EXECUTE ON FUNCTION wasl_academic.membership_visible(uuid,uuid,public."Role") TO wasl_tenant, wasl_academic_admin, wasl_assessment_staff;

ALTER TABLE public.academic_years ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academic_years FORCE ROW LEVEL SECURITY;
CREATE POLICY academic_years_verified_read ON public.academic_years FOR SELECT TO wasl_tenant, wasl_assessment_staff, wasl_academic_admin
  USING (wasl_academic.structure_visible(school_id, id, NULL));
CREATE POLICY academic_years_verifier_read ON public.academic_years FOR SELECT TO wasl_subject_verifier USING (true);
CREATE POLICY academic_years_admin_insert ON public.academic_years FOR INSERT TO wasl_academic_admin
  WITH CHECK (wasl_academic.can_manage(school_id));
CREATE POLICY academic_years_admin_update ON public.academic_years FOR UPDATE TO wasl_academic_admin
  USING (wasl_academic.can_manage(school_id))
  WITH CHECK (wasl_academic.can_manage(school_id));

ALTER TABLE public.semesters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.semesters FORCE ROW LEVEL SECURITY;
CREATE POLICY semesters_verified_read ON public.semesters FOR SELECT TO wasl_tenant, wasl_assessment_staff, wasl_academic_admin
  USING (wasl_academic.structure_visible(school_id, academic_year_id, NULL));
CREATE POLICY semesters_admin_insert ON public.semesters FOR INSERT TO wasl_academic_admin
  WITH CHECK (wasl_academic.can_manage(school_id) AND wasl_academic.year_open(school_id, academic_year_id));
CREATE POLICY semesters_admin_update ON public.semesters FOR UPDATE TO wasl_academic_admin
  USING (wasl_academic.can_manage(school_id))
  WITH CHECK (wasl_academic.can_manage(school_id));

ALTER TABLE public.grades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grades FORCE ROW LEVEL SECURITY;
CREATE POLICY grades_verified_read ON public.grades FOR SELECT TO wasl_tenant, wasl_assessment_staff, wasl_academic_admin
  USING (wasl_academic.structure_visible(school_id, NULL, id));
CREATE POLICY grades_verifier_read ON public.grades FOR SELECT TO wasl_subject_verifier USING (true);
CREATE POLICY grades_admin_insert ON public.grades FOR INSERT TO wasl_academic_admin
  WITH CHECK (wasl_academic.can_manage(school_id));
CREATE POLICY grades_admin_update ON public.grades FOR UPDATE TO wasl_academic_admin
  USING (wasl_academic.can_manage(school_id))
  WITH CHECK (wasl_academic.can_manage(school_id));

ALTER TABLE public.sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sections FORCE ROW LEVEL SECURITY;
CREATE POLICY sections_verified_read ON public.sections FOR SELECT TO wasl_tenant, wasl_assessment_staff, wasl_academic_admin
  USING (wasl_academic.section_visible(school_id, id, NULL));
CREATE POLICY sections_verifier_read ON public.sections FOR SELECT TO wasl_subject_verifier USING (true);
CREATE POLICY sections_admin_insert ON public.sections FOR INSERT TO wasl_academic_admin
  WITH CHECK (wasl_academic.can_manage(school_id) AND wasl_academic.year_open(school_id, academic_year_id));
CREATE POLICY sections_admin_update ON public.sections FOR UPDATE TO wasl_academic_admin
  USING (wasl_academic.can_manage(school_id))
  WITH CHECK (wasl_academic.can_manage(school_id));

ALTER TABLE public.section_subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.section_subjects FORCE ROW LEVEL SECURITY;
CREATE POLICY section_subjects_verified_read ON public.section_subjects FOR SELECT TO wasl_tenant, wasl_assessment_staff, wasl_academic_admin
  USING (wasl_academic.section_visible(school_id, section_id, teacher_id, true));
CREATE POLICY section_subjects_verifier_read ON public.section_subjects FOR SELECT TO wasl_subject_verifier USING (true);
CREATE POLICY section_subjects_admin_insert ON public.section_subjects FOR INSERT TO wasl_academic_admin
  WITH CHECK (wasl_academic.can_manage(school_id) AND wasl_academic.section_open(school_id, section_id) AND wasl_academic.valid_participant(school_id, teacher_id, 'TEACHER', true));
CREATE POLICY section_subjects_admin_update ON public.section_subjects FOR UPDATE TO wasl_academic_admin
  USING (wasl_academic.can_manage(school_id))
  WITH CHECK (wasl_academic.can_manage(school_id) AND wasl_academic.valid_participant(school_id, teacher_id, 'TEACHER', true));

ALTER TABLE public.enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enrollments FORCE ROW LEVEL SECURITY;
CREATE POLICY enrollments_verified_read ON public.enrollments FOR SELECT TO wasl_tenant, wasl_assessment_staff, wasl_academic_admin
  USING (wasl_academic.enrollment_visible(school_id, section_id, student_id, status));
CREATE POLICY enrollments_verifier_read ON public.enrollments FOR SELECT TO wasl_subject_verifier USING (true);
CREATE POLICY enrollments_admin_insert ON public.enrollments FOR INSERT TO wasl_academic_admin
  WITH CHECK (wasl_academic.can_manage(school_id) AND wasl_academic.section_open(school_id, section_id) AND wasl_academic.valid_participant(school_id, student_id, 'STUDENT', status = 'ACTIVE'));
CREATE POLICY enrollments_admin_update ON public.enrollments FOR UPDATE TO wasl_academic_admin
  USING (wasl_academic.can_manage(school_id))
  WITH CHECK (wasl_academic.can_manage(school_id) AND (status <> 'ACTIVE' OR wasl_academic.section_open(school_id, section_id)) AND wasl_academic.valid_participant(school_id, student_id, 'STUDENT', status = 'ACTIVE'));

DROP POLICY academic_manage_links ON public.parent_student_links;
CREATE POLICY academic_manage_links ON public.parent_student_links TO wasl_academic_admin
  USING (wasl_academic.can_manage(school_id))
  WITH CHECK (wasl_academic.can_manage(school_id) AND (status <> 'VERIFIED' OR (
    wasl_academic.valid_participant(school_id, parent_id, 'PARENT', true)
    AND wasl_academic.valid_participant(school_id, student_id, 'STUDENT', true))));

ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;
-- The table owner serves the existing school-membership view. Its CHECK OPTION
-- and platform grants remain the boundary for provisioning.
CREATE POLICY membership_service_read ON public.memberships FOR SELECT TO wasl_subject_verifier, wasl_auth, wasl_platform USING (true);
CREATE POLICY membership_verified_read ON public.memberships FOR SELECT TO wasl_tenant, wasl_academic_admin, wasl_assessment_staff
  USING (wasl_academic.membership_visible(school_id, user_id, role));

COMMIT;
