BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles AS r WHERE r.rolname = 'wasl_assessment_staff' AND r.rolcanlogin
      AND NOT (r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication)
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members WHERE member = r.oid)
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_database WHERE datdba = r.oid)
  ) OR pg_catalog.pg_has_role('wasl_tenant', 'wasl_assessment_staff', 'MEMBER') THEN
    RAISE EXCEPTION 'Provision a restricted assessment staff login first';
  END IF;
  EXECUTE pg_catalog.format('GRANT CONNECT ON DATABASE %I TO wasl_assessment_staff', current_database());
END;
$$;

GRANT USAGE ON SCHEMA public TO wasl_assessment_staff;
GRANT SELECT (id, email, full_name, preferred_language, active, created_at) ON public.users TO wasl_assessment_staff;
GRANT SELECT ON public.memberships, public.schools, public.academic_years, public.sections, public.section_subjects,
  public.enrollments, public.parent_student_links, public.subjects TO wasl_assessment_staff;
GRANT INSERT, SELECT ON public.notifications TO wasl_assessment_staff;
GRANT SELECT, INSERT, UPDATE ON public.question_banks, public.questions, public.assessments, public.submissions TO wasl_assessment_staff;
GRANT SELECT, INSERT, DELETE ON public.question_options, public.assessment_questions, public.answers TO wasl_assessment_staff;
GRANT EXECUTE ON FUNCTION wasl_subject_scope.permits(uuid, uuid, text) TO wasl_assessment_staff;
CREATE POLICY subject_assessment_staff ON public.subjects FOR SELECT TO wasl_assessment_staff
  USING (wasl_subject_scope.permits(school_id, id, 'read'));

REVOKE INSERT, UPDATE ON public.question_banks, public.questions, public.assessments FROM wasl_tenant;
REVOKE INSERT, DELETE ON public.assessment_questions FROM wasl_tenant;
REVOKE ALL ON public.question_options, public.submissions, public.answers FROM wasl_tenant;
GRANT SELECT (id, school_id, assessment_id, student_id, client_id, status, submitted_at),
  INSERT (id, school_id, assessment_id, student_id), UPDATE (status, submitted_at)
  ON public.submissions TO wasl_tenant;
GRANT SELECT (id, school_id, submission_id, question_id, response, file_key),
  INSERT (id, school_id, submission_id, question_id, response, file_key), DELETE ON public.answers TO wasl_tenant;

CREATE SCHEMA wasl_assessment;
REVOKE ALL ON SCHEMA wasl_assessment FROM PUBLIC;
GRANT USAGE ON SCHEMA wasl_assessment TO wasl_tenant, wasl_assessment_staff;
GRANT USAGE, CREATE ON SCHEMA wasl_assessment TO wasl_subject_verifier;

-- Short-answer option text is itself a key, even without is_correct.
CREATE VIEW wasl_assessment.learner_options WITH (security_barrier = true) AS
  SELECT o.id, o.school_id, o.question_id, o.text
  FROM public.question_options AS o
  JOIN public.questions AS q ON q.id = o.question_id AND q.school_id = o.school_id
  WHERE q.type IN ('MULTIPLE_CHOICE', 'TRUE_FALSE');
REVOKE ALL ON wasl_assessment.learner_options FROM PUBLIC;
GRANT SELECT ON wasl_assessment.learner_options TO wasl_tenant, wasl_assessment_staff;

GRANT SELECT (id, school_id, section_subject_id, status, opens_at, due_at, results_released_at)
  ON public.assessments TO wasl_subject_verifier;
GRANT SELECT (id, school_id, assessment_id, student_id, status, score, feedback, graded_at) ON public.submissions TO wasl_subject_verifier;
GRANT SELECT (id, school_id, submission_id, score) ON public.answers TO wasl_subject_verifier;

CREATE FUNCTION wasl_assessment.actor_for(row_school uuid, purpose text, target uuid)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  proof text := pg_catalog.current_setting('app.assessment_proof', true);
  tag text := pg_catalog.current_setting('app.assessment_tag', true);
  secret_key bytea;
  expected bytea;
  claims jsonb;
  actor uuid;
  actor_role public."Role";
  now_ms bigint := (EXTRACT(epoch FROM pg_catalog.statement_timestamp()) * 1000)::bigint;
BEGIN
  IF session_user <> 'wasl_tenant' OR proof IS NULL OR pg_catalog.octet_length(proof) NOT BETWEEN 1 AND 1024
    OR tag IS NULL OR tag !~ '^[a-f0-9]{64}$' THEN RETURN NULL; END IF;
  SELECT k.secret INTO secret_key FROM wasl_subject_scope.signing_key AS k WHERE k.singleton;
  IF secret_key IS NULL THEN RETURN NULL; END IF;
  expected := wasl_subject_crypto.hmac(pg_catalog.convert_to(proof, 'UTF8'), secret_key, 'sha256');
  IF wasl_subject_crypto.hmac(expected, secret_key, 'sha256') <>
     wasl_subject_crypto.hmac(pg_catalog.decode(tag, 'hex'), secret_key, 'sha256') THEN RETURN NULL; END IF;
  claims := proof::jsonb;
  IF pg_catalog.jsonb_array_length(claims) <> 10
    OR claims->>0 IS DISTINCT FROM (SELECT oid::text FROM pg_catalog.pg_database WHERE datname = current_database())
    OR claims->>1 IS DISTINCT FROM pg_catalog.pg_backend_pid()::text
    OR claims->>2 IS DISTINCT FROM pg_catalog.pg_current_xact_id_if_assigned()::text
    OR claims->>3 IS DISTINCT FROM session_user::text
    OR (claims->>4)::bigint IS NULL OR (claims->>4)::bigint <= now_ms OR (claims->>4)::bigint > now_ms + 20000
    OR (claims->>7)::uuid IS DISTINCT FROM row_school OR claims->>8 IS DISTINCT FROM purpose
    OR (claims->>9)::uuid IS DISTINCT FROM target THEN RETURN NULL; END IF;
  actor := (claims->>5)::uuid;
  SELECT m.role INTO actor_role FROM public.memberships m JOIN public.users u ON u.id = m.user_id
    JOIN public.schools s ON s.id = m.school_id
    WHERE m.id = (claims->>6)::uuid AND m.user_id = actor AND m.active AND u.active AND s.active
      AND (m.school_id = row_school OR m.role = 'PARENT');

  IF purpose IN ('assessment:draft', 'assessment:submit') AND actor_role = 'STUDENT' AND EXISTS (
    SELECT 1 FROM public.assessments a
    JOIN public.section_subjects ss ON ss.id = a.section_subject_id AND ss.school_id = row_school
    JOIN public.sections sec ON sec.id = ss.section_id AND sec.school_id = row_school
    JOIN public.academic_years yr ON yr.id = sec.academic_year_id AND yr.school_id = row_school AND NOT yr.archived
    JOIN public.enrollments e ON e.section_id = sec.id AND e.school_id = row_school AND e.student_id = actor AND e.status = 'ACTIVE'
    WHERE a.id = target AND a.school_id = row_school AND a.status IN ('OPEN', 'SCHEDULED')
      AND (a.opens_at IS NULL OR a.opens_at <= pg_catalog.statement_timestamp() AT TIME ZONE 'UTC')
      AND (a.due_at IS NULL OR a.due_at > pg_catalog.statement_timestamp() AT TIME ZONE 'UTC')
  ) THEN RETURN actor;
  ELSIF purpose = 'assessment:results' AND actor_role = 'STUDENT' AND actor = target THEN RETURN actor;
  ELSIF purpose = 'assessment:results' AND actor_role = 'PARENT' AND EXISTS (
    SELECT 1 FROM public.parent_student_links l
    JOIN public.memberships p ON p.user_id = actor AND p.school_id = row_school AND p.role = 'PARENT' AND p.active
    JOIN public.memberships c ON c.user_id = target AND c.school_id = row_school AND c.role = 'STUDENT' AND c.active
    JOIN public.users u ON u.id = target AND u.active
    JOIN public.schools s ON s.id = row_school AND s.active
    WHERE l.school_id = row_school AND l.parent_id = actor AND l.student_id = target AND l.status = 'VERIFIED'
  ) THEN RETURN actor;
  END IF;
  RETURN NULL;
EXCEPTION WHEN invalid_text_representation OR invalid_parameter_value OR numeric_value_out_of_range THEN RETURN NULL;
END;
$$;

CREATE FUNCTION wasl_assessment.released_grade(submission_id uuid)
RETURNS TABLE(score double precision, feedback text, graded_at timestamp, answer_scores jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT s.score, s.feedback, s.graded_at, COALESCE((
    SELECT pg_catalog.jsonb_object_agg(ans.id, ans.score) FROM public.answers AS ans
    WHERE ans.submission_id = s.id AND ans.school_id = s.school_id
  ), '{}'::jsonb)
  FROM public.submissions AS s JOIN public.assessments AS a ON a.id = s.assessment_id AND a.school_id = s.school_id
  JOIN public.section_subjects ss ON ss.id = a.section_subject_id AND ss.school_id = s.school_id
  WHERE s.id = $1 AND s.status = 'GRADED' AND a.status IN ('RESULTS_RELEASED', 'ARCHIVED') AND a.results_released_at IS NOT NULL
    AND wasl_assessment.actor_for(s.school_id, 'assessment:results', s.student_id) IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.enrollments e WHERE e.school_id = s.school_id AND e.section_id = ss.section_id
      AND e.student_id = s.student_id AND e.status = 'ACTIVE');
$$;

ALTER FUNCTION wasl_assessment.actor_for(uuid, text, uuid) OWNER TO wasl_subject_verifier;
ALTER FUNCTION wasl_assessment.released_grade(uuid) OWNER TO wasl_subject_verifier;
REVOKE CREATE ON SCHEMA wasl_assessment FROM wasl_subject_verifier;
REVOKE ALL ON FUNCTION wasl_assessment.actor_for(uuid, text, uuid), wasl_assessment.released_grade(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wasl_assessment.actor_for(uuid, text, uuid), wasl_assessment.released_grade(uuid) TO wasl_tenant;

ALTER TABLE public.submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.submissions FORCE ROW LEVEL SECURITY;
CREATE POLICY staff_submissions ON public.submissions TO wasl_assessment_staff USING (true) WITH CHECK (true);
CREATE POLICY read_submissions ON public.submissions FOR SELECT TO wasl_tenant, wasl_subject_verifier USING (true);
CREATE POLICY insert_draft ON public.submissions FOR INSERT TO wasl_tenant WITH CHECK (
  status = 'IN_PROGRESS' AND COALESCE(wasl_assessment.actor_for(school_id, 'assessment:draft', assessment_id),
    wasl_assessment.actor_for(school_id, 'assessment:submit', assessment_id)) = student_id
);
CREATE POLICY update_draft ON public.submissions FOR UPDATE TO wasl_tenant
  USING (status = 'IN_PROGRESS' AND COALESCE(wasl_assessment.actor_for(school_id, 'assessment:draft', assessment_id),
    wasl_assessment.actor_for(school_id, 'assessment:submit', assessment_id)) = student_id)
  WITH CHECK (
    (status = 'IN_PROGRESS' AND submitted_at IS NULL AND wasl_assessment.actor_for(school_id, 'assessment:draft', assessment_id) = student_id)
    OR (status = 'SUBMITTED' AND submitted_at IS NOT NULL AND wasl_assessment.actor_for(school_id, 'assessment:submit', assessment_id) = student_id
      AND EXISTS (SELECT 1 FROM public.assessment_questions q WHERE q.assessment_id = submissions.assessment_id AND q.school_id = submissions.school_id)
      AND NOT EXISTS (
        SELECT 1 FROM public.assessment_questions q WHERE q.assessment_id = submissions.assessment_id AND q.school_id = submissions.school_id
          AND NOT EXISTS (SELECT 1 FROM public.answers a WHERE a.submission_id = submissions.id AND a.school_id = submissions.school_id AND a.question_id = q.question_id)
      )));

ALTER TABLE public.answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.answers FORCE ROW LEVEL SECURITY;
CREATE POLICY staff_answers ON public.answers TO wasl_assessment_staff USING (true) WITH CHECK (true);
CREATE POLICY read_answers ON public.answers FOR SELECT TO wasl_tenant, wasl_subject_verifier USING (true);
CREATE POLICY delete_draft_answers ON public.answers FOR DELETE TO wasl_tenant USING (EXISTS (
  SELECT 1 FROM public.submissions s WHERE s.id = submission_id AND s.school_id = answers.school_id AND s.status = 'IN_PROGRESS'
    AND COALESCE(wasl_assessment.actor_for(s.school_id, 'assessment:draft', s.assessment_id),
      wasl_assessment.actor_for(s.school_id, 'assessment:submit', s.assessment_id)) = s.student_id
));
CREATE POLICY insert_draft_answers ON public.answers FOR INSERT TO wasl_tenant WITH CHECK (EXISTS (
  SELECT 1 FROM public.submissions s JOIN public.assessment_questions q ON q.assessment_id = s.assessment_id AND q.school_id = s.school_id
  WHERE s.id = submission_id AND s.school_id = answers.school_id AND s.status = 'IN_PROGRESS' AND q.question_id = answers.question_id
    AND COALESCE(wasl_assessment.actor_for(s.school_id, 'assessment:draft', s.assessment_id),
      wasl_assessment.actor_for(s.school_id, 'assessment:submit', s.assessment_id)) = s.student_id
));

DO $$
BEGIN
  IF pg_catalog.has_any_column_privilege('wasl_tenant', 'public.question_options', 'SELECT, INSERT, UPDATE')
    OR pg_catalog.has_column_privilege('wasl_tenant', 'public.submissions', 'score', 'SELECT, INSERT, UPDATE')
    OR pg_catalog.has_column_privilege('wasl_tenant', 'public.submissions', 'feedback', 'SELECT, INSERT, UPDATE')
    OR pg_catalog.has_column_privilege('wasl_tenant', 'public.submissions', 'graded_at', 'SELECT, INSERT, UPDATE')
    OR pg_catalog.has_column_privilege('wasl_tenant', 'public.answers', 'score', 'SELECT, INSERT, UPDATE')
    OR pg_catalog.has_column_privilege('wasl_tenant', 'public.assessments', 'results_released_at', 'INSERT, UPDATE') THEN
    RAISE EXCEPTION 'Unexpected effective assessment privileges';
  END IF;
END;
$$;

COMMIT;
