BEGIN;

-- These columns are read only by the non-login verifier. Runtime grants on
-- answer keys and grading fields from the preceding migration stay revoked.
GRANT SELECT (school_id, assessment_id, question_id) ON public.assessment_questions TO wasl_subject_verifier;
GRANT SELECT (id, school_id, question_bank_id, type, points) ON public.questions TO wasl_subject_verifier;
GRANT SELECT (id, school_id, subject_id, owner_id) ON public.question_banks TO wasl_subject_verifier;
GRANT SELECT (id, school_id, question_id, text) ON public.question_options TO wasl_subject_verifier;
GRANT SELECT (type, title, instructions) ON public.assessments TO wasl_subject_verifier;
GRANT USAGE, CREATE ON SCHEMA wasl_assessment TO wasl_subject_verifier;

REVOKE UPDATE ON public.question_banks, public.questions, public.assessments, public.submissions FROM wasl_assessment_staff;
REVOKE INSERT ON public.submissions FROM wasl_assessment_staff;
REVOKE INSERT, DELETE ON public.answers FROM wasl_assessment_staff;
GRANT UPDATE (name) ON public.question_banks TO wasl_assessment_staff;
GRANT UPDATE (type, text, points) ON public.questions TO wasl_assessment_staff;
GRANT UPDATE (type, title, instructions, opens_at, due_at, status, results_released_at) ON public.assessments TO wasl_assessment_staff;
GRANT UPDATE (status, score, feedback, graded_at) ON public.submissions TO wasl_assessment_staff;
GRANT UPDATE (score) ON public.answers TO wasl_assessment_staff;

CREATE FUNCTION wasl_assessment.verified_actor(row_school uuid)
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
  IF session_user NOT IN ('wasl_tenant','wasl_assessment_staff') OR proof IS NULL
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
  IF session_user = 'wasl_assessment_staff' THEN
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

CREATE FUNCTION wasl_assessment.linked_child(row_school uuid, parent_id uuid, student_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.parent_student_links l
    JOIN public.memberships p ON p.user_id = l.parent_id AND p.school_id = l.school_id AND p.active AND p.role = 'PARENT'
    JOIN public.memberships m ON m.user_id = l.student_id AND m.school_id = l.school_id AND m.active AND m.role = 'STUDENT'
    JOIN public.users u ON u.id = l.student_id AND u.active
    JOIN public.schools s ON s.id = l.school_id AND s.active
    WHERE l.school_id = $1 AND l.parent_id = $2 AND l.student_id = $3 AND l.status = 'VERIFIED');
$$;

CREATE FUNCTION wasl_assessment.link_visible(row_school uuid, parent_id uuid, student_id uuid, link_status public."LinkStatus")
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM wasl_assessment.verified_actor($1) v WHERE
    CASE WHEN v.role = 'SCHOOL_ADMIN' THEN true
    WHEN v.role = 'PARENT' THEN v.actor = $2 AND $4 = 'VERIFIED'
      AND (v.purpose = 'assessment:metadata' OR (v.purpose IN ('assessment:read','assessment:results') AND v.target = $3))
      AND wasl_assessment.linked_child($1, $2, $3)
    WHEN v.role = 'TEACHER' THEN v.purpose IN ('assessment:metadata','assessment:staff-write') AND $4 = 'VERIFIED'
      AND EXISTS (SELECT 1 FROM public.section_subjects a JOIN public.enrollments e ON e.school_id = a.school_id AND e.section_id = a.section_id
        WHERE a.school_id = $1 AND a.teacher_id = v.actor AND e.student_id = $3 AND e.status = 'ACTIVE')
    ELSE false END)
  OR ($4 = 'VERIFIED' AND wasl_assessment.linked_child($1, $2, $3) AND EXISTS (
    SELECT 1 FROM public.memberships home CROSS JOIN LATERAL wasl_assessment.verified_actor(home.school_id) v
    WHERE home.user_id = $2 AND home.active AND home.role = 'PARENT' AND v.role = 'PARENT'
      AND v.actor = $2 AND v.purpose = 'assessment:discover'));
$$;

CREATE FUNCTION wasl_assessment.class_access(row_school uuid, assignment_id uuid, assessment_id uuid, writable boolean)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM wasl_assessment.verified_actor($1) v
    JOIN public.section_subjects a ON a.id = $2 AND a.school_id = $1
    JOIN public.sections s ON s.id = a.section_id AND s.school_id = $1
    JOIN public.academic_years y ON y.id = s.academic_year_id AND y.school_id = $1
    WHERE (v.purpose <> 'assessment:staff-grade' OR EXISTS (SELECT 1 FROM public.submissions sub
      WHERE sub.id = v.target AND sub.school_id = $1 AND sub.assessment_id = $3)) AND CASE
      WHEN $4 THEN v.role = 'TEACHER' AND v.actor = a.teacher_id AND v.purpose IN ('assessment:staff-write','assessment:staff-grade') AND NOT y.archived
      WHEN v.role = 'SCHOOL_ADMIN' THEN true
      WHEN v.role = 'TEACHER' THEN v.actor = a.teacher_id
      ELSE v.purpose <> 'assessment:discover' AND (v.purpose NOT IN ('assessment:draft','assessment:submit') OR v.target = $3) AND EXISTS (
        SELECT 1 FROM public.enrollments e WHERE e.school_id = $1 AND e.section_id = s.id AND e.status = 'ACTIVE'
        AND (CASE WHEN v.role = 'STUDENT' THEN e.student_id = v.actor
          ELSE (v.purpose = 'assessment:metadata' OR e.student_id = v.target)
            AND wasl_assessment.linked_child($1, v.actor, e.student_id) END)
      ) END);
$$;

CREATE FUNCTION wasl_assessment.assessment_access(row_school uuid, assessment_id uuid, opened boolean)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.assessments a CROSS JOIN wasl_assessment.verified_actor($1) v
    WHERE a.school_id = $1 AND a.id = $2 AND wasl_assessment.class_access($1, a.section_subject_id, a.id, false)
      AND ((session_user = 'wasl_assessment_staff' AND v.role IN ('TEACHER','SCHOOL_ADMIN')) OR (a.status <> 'DRAFT'
        AND (NOT $3 OR a.opens_at IS NULL OR a.opens_at <= pg_catalog.statement_timestamp() AT TIME ZONE 'UTC'))));
$$;

CREATE FUNCTION wasl_assessment.edit_assessment_scope(row_school uuid, assessment_id uuid, assignment_id uuid,
  next_status public."AssessmentStatus", next_type public."AssessmentType", next_title text,
  next_instructions text, next_opens timestamp, next_due timestamp, next_release timestamp)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT wasl_assessment.class_access($1, $3, $2, true) AND EXISTS (
    SELECT 1 FROM wasl_assessment.verified_actor($1) v WHERE v.purpose = 'assessment:staff-write'
      OR (v.purpose = 'assessment:staff-grade' AND $4 = 'GRADING' AND EXISTS (
        SELECT 1 FROM public.assessments a WHERE a.id = $2 AND a.school_id = $1 AND a.status IN ('CLOSED','GRADING')
          AND (a.type, a.title, a.instructions, a.opens_at, a.due_at, a.results_released_at)
            IS NOT DISTINCT FROM ($5, $6, $7, $8, $9, $10))));
$$;

CREATE FUNCTION wasl_assessment.submission_access(row_school uuid, assessment_id uuid, student_id uuid, submission_status public."SubmissionStatus", responses boolean, writable boolean, submission_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.assessments a CROSS JOIN wasl_assessment.verified_actor($1) v
    WHERE a.school_id = $1 AND a.id = $2 AND a.status <> 'DRAFT'
      AND wasl_assessment.class_access($1, a.section_subject_id, a.id, $6)
      AND (NOT $5 OR v.purpose <> 'assessment:metadata')
      AND (v.purpose <> 'assessment:staff-grade' OR v.target = $7)
      AND CASE WHEN $6 THEN $4 <> 'IN_PROGRESS' AND v.purpose = 'assessment:staff-grade' AND a.status IN ('CLOSED','GRADING')
        WHEN v.role IN ('TEACHER','SCHOOL_ADMIN') THEN ($4 <> 'IN_PROGRESS' OR (NOT $5 AND v.purpose = 'assessment:staff-write'))
        WHEN v.role = 'STUDENT' THEN v.actor = $3
        ELSE v.purpose IN ('assessment:read','assessment:results') AND v.target = $3
          AND $4 = 'GRADED' AND a.results_released_at IS NOT NULL AND a.status IN ('RESULTS_RELEASED','ARCHIVED')
      END);
$$;

CREATE FUNCTION wasl_assessment.answer_access(row_school uuid, submission_id uuid, writable boolean)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.submissions s WHERE s.school_id = $1 AND s.id = $2
    AND wasl_assessment.submission_access($1, s.assessment_id, s.student_id, s.status, true, $3, s.id));
$$;

CREATE FUNCTION wasl_assessment.bank_access(row_school uuid, bank_subject uuid, owner_id uuid, writable boolean)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM wasl_assessment.verified_actor($1) v
    WHERE v.role IN ('TEACHER','SCHOOL_ADMIN') AND v.purpose IN ('assessment:staff-read','assessment:staff-write')
      AND (NOT $4 OR (v.purpose = 'assessment:staff-write' AND (v.role = 'SCHOOL_ADMIN' OR v.actor = $3)))
      AND (v.role = 'SCHOOL_ADMIN' OR EXISTS (
        SELECT 1 FROM public.section_subjects a JOIN public.sections s ON s.id = a.section_id AND s.school_id = $1
        JOIN public.academic_years y ON y.id = s.academic_year_id AND y.school_id = $1
        WHERE a.school_id = $1 AND a.subject_id = $2 AND a.teacher_id = v.actor AND (NOT $4 OR NOT y.archived))));
$$;

CREATE FUNCTION wasl_assessment.question_access(row_school uuid, question_id uuid, bank_id uuid, writable boolean)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT (EXISTS (SELECT 1 FROM public.question_banks b WHERE b.school_id = $1 AND b.id = $3
    AND wasl_assessment.bank_access($1, b.subject_id, b.owner_id, $4)) AND (NOT $4 OR NOT EXISTS (
      SELECT 1 FROM public.assessment_questions link JOIN public.assessments a ON a.id = link.assessment_id AND a.school_id = $1
      WHERE link.school_id = $1 AND link.question_id = $2 AND a.status <> 'DRAFT')))
    OR (NOT $4 AND EXISTS (SELECT 1 FROM public.assessment_questions q CROSS JOIN wasl_assessment.verified_actor($1) v
      WHERE q.school_id = $1 AND q.question_id = $2 AND v.purpose <> 'assessment:metadata'
        AND wasl_assessment.assessment_access($1, q.assessment_id, true)));
$$;

CREATE FUNCTION wasl_assessment.question_locked(row_school uuid, question_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.questions q JOIN public.question_banks b ON b.id = q.question_bank_id AND b.school_id = $1
    WHERE q.school_id = $1 AND q.id = $2 AND wasl_assessment.bank_access($1, b.subject_id, b.owner_id, false)
      AND EXISTS (SELECT 1 FROM public.assessment_questions link JOIN public.assessments a ON a.id = link.assessment_id AND a.school_id = $1
        WHERE link.school_id = $1 AND link.question_id = $2 AND a.status <> 'DRAFT'));
$$;

CREATE FUNCTION wasl_assessment.bank_visible(row_school uuid, bank_id uuid, subject_id uuid, owner_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT wasl_assessment.bank_access($1, $3, $4, false) OR EXISTS (
    SELECT 1 FROM public.questions q JOIN public.assessment_questions a ON a.question_id = q.id AND a.school_id = $1
    CROSS JOIN wasl_assessment.verified_actor($1) v
    WHERE q.question_bank_id = $2 AND q.school_id = $1 AND v.role IN ('STUDENT','PARENT') AND v.purpose <> 'assessment:metadata'
      AND wasl_assessment.assessment_access($1, a.assessment_id, true));
$$;

CREATE FUNCTION wasl_assessment.question_row_access(row_school uuid, question_id uuid, writable boolean)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.questions q WHERE q.school_id = $1 AND q.id = $2
    AND wasl_assessment.question_access($1, q.id, q.question_bank_id, $3));
$$;

CREATE FUNCTION wasl_assessment.draft_attachment(row_school uuid, assessment_id uuid, question_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.assessments a JOIN public.section_subjects ss ON ss.id = a.section_subject_id AND ss.school_id = $1
    JOIN public.questions q ON q.id = $3 AND q.school_id = $1
    JOIN public.question_banks b ON b.id = q.question_bank_id AND b.school_id = $1
    WHERE a.id = $2 AND a.school_id = $1 AND a.status = 'DRAFT' AND b.subject_id = ss.subject_id
      AND wasl_assessment.class_access($1, ss.id, a.id, true));
$$;

CREATE FUNCTION wasl_assessment.question_stats(row_school uuid, assessment_id uuid)
RETURNS TABLE(question_count integer, total_points double precision)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT count(*)::integer, COALESCE(sum(q.points), 0)::double precision
  FROM public.assessment_questions link JOIN public.questions q ON q.id = link.question_id AND q.school_id = link.school_id
  WHERE link.school_id = $1 AND link.assessment_id = $2 AND wasl_assessment.assessment_access($1, $2, false);
$$;

ALTER FUNCTION wasl_assessment.verified_actor(uuid) OWNER TO wasl_subject_verifier;
ALTER FUNCTION wasl_assessment.linked_child(uuid,uuid,uuid) OWNER TO wasl_subject_verifier;
ALTER FUNCTION wasl_assessment.link_visible(uuid,uuid,uuid,public."LinkStatus") OWNER TO wasl_subject_verifier;
ALTER FUNCTION wasl_assessment.class_access(uuid,uuid,uuid,boolean) OWNER TO wasl_subject_verifier;
ALTER FUNCTION wasl_assessment.assessment_access(uuid,uuid,boolean) OWNER TO wasl_subject_verifier;
ALTER FUNCTION wasl_assessment.edit_assessment_scope(uuid,uuid,uuid,public."AssessmentStatus",public."AssessmentType",text,text,timestamp,timestamp,timestamp) OWNER TO wasl_subject_verifier;
ALTER FUNCTION wasl_assessment.submission_access(uuid,uuid,uuid,public."SubmissionStatus",boolean,boolean,uuid) OWNER TO wasl_subject_verifier;
ALTER FUNCTION wasl_assessment.answer_access(uuid,uuid,boolean) OWNER TO wasl_subject_verifier;
ALTER FUNCTION wasl_assessment.bank_access(uuid,uuid,uuid,boolean) OWNER TO wasl_subject_verifier;
ALTER FUNCTION wasl_assessment.question_access(uuid,uuid,uuid,boolean) OWNER TO wasl_subject_verifier;
ALTER FUNCTION wasl_assessment.question_locked(uuid,uuid) OWNER TO wasl_subject_verifier;
ALTER FUNCTION wasl_assessment.bank_visible(uuid,uuid,uuid,uuid) OWNER TO wasl_subject_verifier;
ALTER FUNCTION wasl_assessment.question_row_access(uuid,uuid,boolean) OWNER TO wasl_subject_verifier;
ALTER FUNCTION wasl_assessment.draft_attachment(uuid,uuid,uuid) OWNER TO wasl_subject_verifier;
ALTER FUNCTION wasl_assessment.question_stats(uuid,uuid) OWNER TO wasl_subject_verifier;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA wasl_assessment FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wasl_assessment.class_access(uuid,uuid,uuid,boolean), wasl_assessment.assessment_access(uuid,uuid,boolean),
  wasl_assessment.submission_access(uuid,uuid,uuid,public."SubmissionStatus",boolean,boolean,uuid), wasl_assessment.answer_access(uuid,uuid,boolean),
  wasl_assessment.bank_access(uuid,uuid,uuid,boolean), wasl_assessment.question_access(uuid,uuid,uuid,boolean),
  wasl_assessment.bank_visible(uuid,uuid,uuid,uuid),
  wasl_assessment.link_visible(uuid,uuid,uuid,public."LinkStatus"),
  wasl_assessment.question_row_access(uuid,uuid,boolean), wasl_assessment.question_stats(uuid,uuid) TO wasl_tenant, wasl_assessment_staff;
GRANT EXECUTE ON FUNCTION wasl_assessment.draft_attachment(uuid,uuid,uuid), wasl_assessment.question_locked(uuid,uuid) TO wasl_assessment_staff;
GRANT EXECUTE ON FUNCTION wasl_assessment.edit_assessment_scope(uuid,uuid,uuid,public."AssessmentStatus",public."AssessmentType",text,text,timestamp,timestamp,timestamp) TO wasl_assessment_staff;

DROP POLICY read_submissions ON public.submissions;
DROP POLICY read_answers ON public.answers;
DROP POLICY staff_submissions ON public.submissions;
DROP POLICY staff_answers ON public.answers;
CREATE POLICY verifier_submissions ON public.submissions FOR SELECT TO wasl_subject_verifier USING (true);
CREATE POLICY verifier_answers ON public.answers FOR SELECT TO wasl_subject_verifier USING (true);
CREATE POLICY participant_submissions ON public.submissions FOR SELECT TO wasl_tenant, wasl_assessment_staff
  USING (wasl_assessment.submission_access(school_id, assessment_id, student_id, status, false, false, id));
CREATE POLICY participant_answers ON public.answers FOR SELECT TO wasl_tenant, wasl_assessment_staff
  USING (wasl_assessment.answer_access(school_id, submission_id, false));
CREATE POLICY grade_submission ON public.submissions FOR UPDATE TO wasl_assessment_staff
  USING (wasl_assessment.submission_access(school_id, assessment_id, student_id, status, false, true, id))
  WITH CHECK (status = 'GRADED' AND wasl_assessment.submission_access(school_id, assessment_id, student_id, status, false, true, id));
CREATE POLICY grade_answer ON public.answers FOR UPDATE TO wasl_assessment_staff
  USING (wasl_assessment.answer_access(school_id, submission_id, true))
  WITH CHECK (wasl_assessment.answer_access(school_id, submission_id, true));

ALTER TABLE public.assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assessments FORCE ROW LEVEL SECURITY;
CREATE POLICY verifier_assessments ON public.assessments FOR SELECT TO wasl_subject_verifier USING (true);
CREATE POLICY staff_visible_assessments ON public.assessments FOR SELECT TO wasl_assessment_staff
  USING (wasl_assessment.class_access(school_id, section_subject_id, id, false));
CREATE POLICY tenant_visible_assessments ON public.assessments FOR SELECT TO wasl_tenant
  USING (wasl_assessment.assessment_access(school_id, id, false));
CREATE POLICY create_assessment ON public.assessments FOR INSERT TO wasl_assessment_staff
  WITH CHECK (status = 'DRAFT' AND results_released_at IS NULL AND wasl_assessment.class_access(school_id, section_subject_id, id, true));
CREATE POLICY edit_assessment ON public.assessments FOR UPDATE TO wasl_assessment_staff
  USING (wasl_assessment.class_access(school_id, section_subject_id, id, true))
  WITH CHECK (wasl_assessment.edit_assessment_scope(school_id, id, section_subject_id, status, type, title, instructions, opens_at, due_at, results_released_at));

ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.questions FORCE ROW LEVEL SECURITY;
CREATE POLICY verifier_questions ON public.questions FOR SELECT TO wasl_subject_verifier USING (true);
CREATE POLICY visible_questions ON public.questions FOR SELECT TO wasl_tenant, wasl_assessment_staff
  USING (wasl_assessment.question_access(school_id, id, question_bank_id, false));
CREATE POLICY create_question ON public.questions FOR INSERT TO wasl_assessment_staff
  WITH CHECK (wasl_assessment.question_access(school_id, id, question_bank_id, true));
CREATE POLICY edit_question ON public.questions FOR UPDATE TO wasl_assessment_staff
  USING (wasl_assessment.question_access(school_id, id, question_bank_id, true))
  WITH CHECK (wasl_assessment.question_access(school_id, id, question_bank_id, true));

ALTER TABLE public.question_banks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.question_banks FORCE ROW LEVEL SECURITY;
CREATE POLICY verifier_question_banks ON public.question_banks FOR SELECT TO wasl_subject_verifier USING (true);
CREATE POLICY visible_question_banks ON public.question_banks FOR SELECT TO wasl_tenant, wasl_assessment_staff
  USING (wasl_assessment.bank_visible(school_id, id, subject_id, owner_id));
CREATE POLICY create_question_bank ON public.question_banks FOR INSERT TO wasl_assessment_staff
  WITH CHECK (wasl_assessment.bank_access(school_id, subject_id, owner_id, true));
CREATE POLICY edit_question_bank ON public.question_banks FOR UPDATE TO wasl_assessment_staff
  USING (wasl_assessment.bank_access(school_id, subject_id, owner_id, true))
  WITH CHECK (wasl_assessment.bank_access(school_id, subject_id, owner_id, true));

ALTER TABLE public.question_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.question_options FORCE ROW LEVEL SECURITY;
CREATE POLICY verifier_safe_options ON public.question_options FOR SELECT TO wasl_subject_verifier USING (true);
CREATE POLICY staff_read_options ON public.question_options FOR SELECT TO wasl_assessment_staff
  USING (wasl_assessment.question_row_access(school_id, question_id, false));
CREATE POLICY staff_insert_options ON public.question_options FOR INSERT TO wasl_assessment_staff
  WITH CHECK (wasl_assessment.question_row_access(school_id, question_id, true));
CREATE POLICY staff_delete_options ON public.question_options FOR DELETE TO wasl_assessment_staff
  USING (wasl_assessment.question_row_access(school_id, question_id, true));

ALTER TABLE public.assessment_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assessment_questions FORCE ROW LEVEL SECURITY;
CREATE POLICY verifier_assessment_questions ON public.assessment_questions FOR SELECT TO wasl_subject_verifier USING (true);
CREATE POLICY visible_assessment_questions ON public.assessment_questions FOR SELECT TO wasl_tenant, wasl_assessment_staff
  USING (wasl_assessment.assessment_access(school_id, assessment_id, true));
CREATE POLICY attach_question ON public.assessment_questions FOR INSERT TO wasl_assessment_staff
  WITH CHECK (wasl_assessment.draft_attachment(school_id, assessment_id, question_id));
CREATE POLICY detach_question ON public.assessment_questions FOR DELETE TO wasl_assessment_staff
  USING (wasl_assessment.draft_attachment(school_id, assessment_id, question_id));

ALTER TABLE public.parent_student_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parent_student_links FORCE ROW LEVEL SECURITY;
CREATE POLICY verifier_links ON public.parent_student_links FOR SELECT TO wasl_subject_verifier USING (true);
CREATE POLICY academic_manage_links ON public.parent_student_links TO wasl_academic_admin USING (true) WITH CHECK (true);
CREATE POLICY visible_links ON public.parent_student_links FOR SELECT TO wasl_tenant, wasl_assessment_staff
  USING (wasl_assessment.link_visible(school_id, parent_id, student_id, status));

-- Preserve the existing safe column projection and require verified delivery
-- or staff authoring scope to see option labels.
CREATE OR REPLACE VIEW wasl_assessment.learner_options WITH (security_barrier = true) AS
  SELECT o.id, o.school_id, o.question_id, o.text FROM public.question_options o
  JOIN public.questions q ON q.id = o.question_id AND q.school_id = o.school_id
  WHERE q.type IN ('MULTIPLE_CHOICE','TRUE_FALSE')
    AND wasl_assessment.question_access(o.school_id, o.question_id, q.question_bank_id, false);
ALTER VIEW wasl_assessment.learner_options OWNER TO wasl_subject_verifier;
REVOKE CREATE ON SCHEMA wasl_assessment FROM wasl_subject_verifier;

COMMIT;
