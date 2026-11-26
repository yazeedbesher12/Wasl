BEGIN;

-- The API writes the submission and its marks separately in one transaction.
-- Check the final state at commit, and use the same check before release.
GRANT SELECT (question_id) ON public.answers TO wasl_subject_verifier;
GRANT SELECT ("order") ON public.assessment_questions TO wasl_subject_verifier;

CREATE FUNCTION wasl_assessment.complete_grade(school uuid, submission uuid, assessment uuid, total double precision)
RETURNS boolean LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT count(*) > 0 AND count(*) = count(a.id)
    AND count(*) = (SELECT count(*) FROM public.answers ax WHERE ax.school_id = $1 AND ax.submission_id = $2)
    AND bool_and(coalesce(q.id IS NOT NULL AND a.score >= 0 AND a.score <= least(q.points, 10000), false))
    AND $4 >= 0 AND $4 < 'Infinity'::double precision
    -- The API sums doubles in question order, then rounds to ten decimal places.
    AND abs($4 - sum(a.score ORDER BY l."order", l.question_id)) <=
      5e-11 + abs($4) * 2.23e-16
  FROM public.assessment_questions l
  LEFT JOIN public.questions q ON q.school_id = l.school_id AND q.id = l.question_id
  LEFT JOIN public.answers a ON a.school_id = l.school_id AND a.question_id = l.question_id AND a.submission_id = $2
  WHERE l.school_id = $1 AND l.assessment_id = $3;
$$;

CREATE FUNCTION wasl_assessment.check_grade_at_commit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  submission_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'answers' THEN submission_id := NEW.submission_id;
  ELSE submission_id := NEW.id;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.submissions s
    WHERE s.school_id = NEW.school_id AND s.id = submission_id
      AND CASE WHEN s.status = 'GRADED' THEN
        s.graded_at IS NULL OR NOT coalesce(wasl_assessment.complete_grade(s.school_id, s.id, s.assessment_id, s.score), false)
      ELSE s.score IS NOT NULL OR s.graded_at IS NOT NULL OR EXISTS (
        SELECT 1 FROM public.answers a WHERE a.school_id = s.school_id AND a.submission_id = s.id AND a.score IS NOT NULL)
      END
  ) THEN
    RAISE EXCEPTION 'Submission marks are incomplete or inconsistent' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION wasl_assessment.edit_assessment_scope(row_school uuid, assessment_id uuid, assignment_id uuid,
  next_status public."AssessmentStatus", next_type public."AssessmentType", next_title text,
  next_instructions text, next_opens timestamp, next_due timestamp, next_release timestamp)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT wasl_assessment.class_access($1, $3, $2, true) AND EXISTS (
    SELECT 1 FROM wasl_assessment.verified_actor($1) v
    JOIN public.assessments a ON a.id = $2 AND a.school_id = $1
    CROSS JOIN LATERAL (SELECT pg_catalog.statement_timestamp() AT TIME ZONE 'UTC' AS now) clock
    CROSS JOIN LATERAL (SELECT CASE
      WHEN a.status NOT IN ('OPEN','SCHEDULED') THEN a.status
      WHEN a.due_at <= clock.now THEN 'CLOSED'
      WHEN a.opens_at > clock.now THEN 'SCHEDULED'
      ELSE 'OPEN' END AS state,
      (a.type, a.title, a.instructions, a.opens_at, a.due_at)
        IS NOT DISTINCT FROM ($5, $6, $7, $8, $9) AS same_content) old
    WHERE CASE v.purpose
      WHEN 'assessment:staff-write' THEN
        $10 IS NOT DISTINCT FROM a.results_released_at AND (
          (old.state = 'DRAFT' AND $4 = 'DRAFT' AND ($8 IS NULL OR $9 IS NULL OR $8 < $9))
          OR (old.same_content AND (
            (old.state = 'DRAFT' AND $4 = CASE WHEN a.opens_at > clock.now
                THEN 'SCHEDULED'::public."AssessmentStatus" ELSE 'OPEN'::public."AssessmentStatus" END
              AND (a.due_at IS NULL OR a.due_at > clock.now)
              AND (a.opens_at IS NULL OR a.due_at IS NULL OR a.opens_at < a.due_at)
              AND EXISTS (SELECT 1 FROM public.assessment_questions l WHERE l.school_id = $1 AND l.assessment_id = $2))
            OR (old.state IN ('OPEN','SCHEDULED') AND $4 = 'DRAFT'
              AND NOT EXISTS (SELECT 1 FROM public.submissions s WHERE s.school_id = $1 AND s.assessment_id = $2))
            OR (old.state IN ('OPEN','SCHEDULED','CLOSED') AND $4 = 'CLOSED')
            OR (old.state IN ('CLOSED','GRADING') AND $4 = 'GRADING')
            OR (old.state = 'RESULTS_RELEASED' AND $4 = 'ARCHIVED')
          )))
      WHEN 'assessment:staff-grade' THEN old.state IN ('CLOSED','GRADING') AND $4 = 'GRADING'
        AND old.same_content AND $10 IS NOT DISTINCT FROM a.results_released_at
      WHEN 'assessment:staff-release' THEN v.target = $2 AND old.state = 'GRADING' AND $4 = 'RESULTS_RELEASED'
        AND $10 IS NOT NULL AND a.results_released_at IS NULL AND old.same_content
        AND EXISTS (SELECT 1 FROM public.submissions s WHERE s.school_id = $1 AND s.assessment_id = $2 AND s.status <> 'IN_PROGRESS')
        AND NOT EXISTS (SELECT 1 FROM public.submissions s
          WHERE s.school_id = $1 AND s.assessment_id = $2 AND s.status <> 'IN_PROGRESS'
            AND (s.status <> 'GRADED' OR s.graded_at IS NULL
              OR NOT coalesce(wasl_assessment.complete_grade(s.school_id, s.id, s.assessment_id, s.score), false)))
      ELSE false END);
$$;

CREATE OR REPLACE FUNCTION wasl_assessment.submission_access(row_school uuid, assessment_id uuid,
  student_id uuid, submission_status public."SubmissionStatus", responses boolean, writable boolean, submission_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.assessments a CROSS JOIN wasl_assessment.verified_actor($1) v
    WHERE a.school_id = $1 AND a.id = $2 AND a.status <> 'DRAFT'
      AND wasl_assessment.class_access($1, a.section_subject_id, a.id, $6)
      AND (NOT $5 OR v.purpose <> 'assessment:metadata')
      AND (v.purpose <> 'assessment:staff-grade' OR v.target = $7)
      AND CASE WHEN $6 THEN $4 <> 'IN_PROGRESS' AND v.purpose = 'assessment:staff-grade'
        AND (a.status IN ('CLOSED','GRADING') OR (a.status IN ('OPEN','SCHEDULED')
          AND a.due_at <= pg_catalog.statement_timestamp() AT TIME ZONE 'UTC'))
        WHEN v.role IN ('TEACHER','SCHOOL_ADMIN') THEN ($4 <> 'IN_PROGRESS' OR (NOT $5 AND v.purpose = 'assessment:staff-write'))
        WHEN v.role = 'STUDENT' THEN v.actor = $3
        ELSE v.purpose IN ('assessment:read','assessment:results') AND v.target = $3
          AND $4 = 'GRADED' AND a.results_released_at IS NOT NULL AND a.status IN ('RESULTS_RELEASED','ARCHIVED')
      END);
$$;

-- The policies read other rows to decide whether a transition is allowed.
-- Require the isolation level already used by the Prisma workflow for writes
-- that can change those decisions concurrently.
CREATE FUNCTION wasl_assessment.require_serializable_write()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF session_user IN ('wasl_tenant', 'wasl_assessment_staff')
    AND pg_catalog.current_setting('transaction_isolation') <> 'serializable' THEN
    RAISE EXCEPTION 'Assessment workflow writes require a serializable transaction' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER serialize_assessment_updates BEFORE UPDATE ON public.assessments
  FOR EACH ROW EXECUTE FUNCTION wasl_assessment.require_serializable_write();
CREATE TRIGGER serialize_submission_writes BEFORE INSERT OR UPDATE ON public.submissions
  FOR EACH ROW EXECUTE FUNCTION wasl_assessment.require_serializable_write();
CREATE TRIGGER serialize_answer_writes BEFORE INSERT OR UPDATE OR DELETE ON public.answers
  FOR EACH ROW EXECUTE FUNCTION wasl_assessment.require_serializable_write();
CREATE TRIGGER serialize_assessment_questions BEFORE INSERT OR DELETE ON public.assessment_questions
  FOR EACH ROW EXECUTE FUNCTION wasl_assessment.require_serializable_write();
CREATE TRIGGER serialize_assessment_question_edits BEFORE UPDATE ON public.questions
  FOR EACH ROW EXECUTE FUNCTION wasl_assessment.require_serializable_write();

CREATE CONSTRAINT TRIGGER validate_submission_grade AFTER INSERT OR UPDATE ON public.submissions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  WHEN (NEW.status = 'GRADED' OR NEW.score IS NOT NULL OR NEW.graded_at IS NOT NULL)
  EXECUTE FUNCTION wasl_assessment.check_grade_at_commit();
CREATE CONSTRAINT TRIGGER validate_answer_grade AFTER UPDATE ON public.answers
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION wasl_assessment.check_grade_at_commit();

-- Ownership transfer requires CREATE on the containing schema.
GRANT CREATE ON SCHEMA wasl_assessment TO wasl_subject_verifier;
ALTER FUNCTION wasl_assessment.complete_grade(uuid,uuid,uuid,double precision) OWNER TO wasl_subject_verifier;
ALTER FUNCTION wasl_assessment.check_grade_at_commit() OWNER TO wasl_subject_verifier;
REVOKE CREATE ON SCHEMA wasl_assessment FROM wasl_subject_verifier;
REVOKE ALL ON FUNCTION wasl_assessment.complete_grade(uuid,uuid,uuid,double precision),
  wasl_assessment.check_grade_at_commit(), wasl_assessment.require_serializable_write() FROM PUBLIC;

COMMIT;
