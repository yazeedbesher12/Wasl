BEGIN;

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
    IF purpose IN ('assessment:draft','assessment:submit','assessment:file-write') OR
      (purpose IN ('assessment:read','assessment:results','assessment:metadata') AND target = actor) THEN RETURN NEXT; END IF;
  ELSIF role = 'PARENT' THEN
    IF (purpose IN ('assessment:metadata','assessment:discover') AND target = actor) OR purpose IN ('assessment:read','assessment:results') THEN RETURN NEXT; END IF;
  ELSIF role IN ('TEACHER','SCHOOL_ADMIN') AND ((target = actor AND purpose IN ('assessment:read','assessment:metadata','assessment:content-write','assessment:announcement-write')) OR purpose = 'assessment:file-write') THEN RETURN NEXT;
  END IF;
EXCEPTION WHEN invalid_text_representation OR invalid_parameter_value OR numeric_value_out_of_range THEN RETURN;
END;
$$;

CREATE OR REPLACE FUNCTION wasl_content.assignment_access(school uuid, assignment uuid, writing boolean)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM wasl_assessment.verified_actor($1) v
    JOIN public.section_subjects a ON a.school_id = $1 AND a.id = $2
    JOIN public.sections s ON s.school_id = $1 AND s.id = a.section_id
    JOIN public.academic_years y ON y.school_id = $1 AND y.id = s.academic_year_id
    WHERE (v.purpose IN ('assessment:read','assessment:metadata','assessment:content-write') OR (v.purpose = 'assessment:file-write' AND EXISTS (
      SELECT 1 FROM public.lessons l JOIN public.units u ON u.school_id = l.school_id AND u.id = l.unit_id
      WHERE l.school_id = $1 AND l.id = v.target AND u.section_subject_id = $2)))
      AND CASE
        WHEN $3 THEN v.purpose = 'assessment:content-write' AND NOT y.archived
          AND (v.role = 'SCHOOL_ADMIN' OR (v.role = 'TEACHER' AND a.teacher_id = v.actor))
        ELSE (v.role IN ('SCHOOL_ADMIN','TEACHER') OR NOT y.archived)
          AND wasl_assessment.class_access($1, $2, NULL, false)
      END);
$$;

CREATE OR REPLACE FUNCTION wasl_assessment.link_visible(row_school uuid, parent_id uuid, student_id uuid, link_status public."LinkStatus")
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM wasl_assessment.verified_actor($1) v WHERE
    CASE WHEN v.role = 'SCHOOL_ADMIN' THEN true
    WHEN v.role = 'PARENT' THEN v.actor = $2 AND $4 = 'VERIFIED'
      AND (v.purpose = 'assessment:metadata' OR (v.purpose IN ('assessment:read','assessment:results') AND v.target = $3))
      AND wasl_assessment.linked_child($1, $2, $3)
    WHEN v.role = 'TEACHER' THEN v.purpose IN ('assessment:metadata','assessment:staff-write','assessment:announcement-write') AND $4 = 'VERIFIED'
      AND EXISTS (SELECT 1 FROM public.section_subjects a JOIN public.enrollments e ON e.school_id = a.school_id AND e.section_id = a.section_id
        WHERE a.school_id = $1 AND a.teacher_id = v.actor AND e.student_id = $3 AND e.status = 'ACTIVE')
    ELSE false END)
  OR ($4 = 'VERIFIED' AND wasl_assessment.linked_child($1, $2, $3) AND EXISTS (
    SELECT 1 FROM public.memberships home CROSS JOIN LATERAL wasl_assessment.verified_actor(home.school_id) v
    WHERE home.user_id = $2 AND home.active AND home.role = 'PARENT' AND v.role = 'PARENT'
      AND v.actor = $2 AND v.purpose = 'assessment:discover'));
$$;

CREATE SCHEMA wasl_private;
REVOKE ALL ON SCHEMA wasl_private FROM PUBLIC;
GRANT USAGE ON SCHEMA wasl_private TO wasl_tenant, wasl_assessment_staff;
GRANT USAGE, CREATE ON SCHEMA wasl_private TO wasl_subject_verifier;

CREATE UNIQUE INDEX assessments_school_row_idx ON public.assessments (school_id, id);
ALTER TABLE public.file_objects ADD CONSTRAINT files_school_lesson_fk
  FOREIGN KEY (school_id, lesson_id) REFERENCES public.lessons (school_id, id),
  ADD CONSTRAINT files_school_assessment_fk FOREIGN KEY (school_id, assessment_id) REFERENCES public.assessments (school_id, id);
ALTER TABLE public.announcements ADD CONSTRAINT announcements_school_assignment_fk
  FOREIGN KEY (school_id, section_subject_id) REFERENCES public.section_subjects (school_id, id);
ALTER TABLE public.parent_student_links ADD CONSTRAINT parent_links_school_fk
  FOREIGN KEY (school_id) REFERENCES public.schools (id);

REVOKE UPDATE ON public.announcements, public.notifications FROM wasl_tenant;
GRANT UPDATE (title, body, status, published_at) ON public.announcements TO wasl_tenant;
GRANT UPDATE (read_at) ON public.notifications TO wasl_tenant;
GRANT SELECT (school_id, lesson_id, storage_key, type) ON public.resources TO wasl_subject_verifier;
GRANT SELECT (id, school_id, author_id, section_subject_id, title, body, status, published_at) ON public.announcements TO wasl_subject_verifier;
GRANT SELECT (file_key) ON public.answers TO wasl_subject_verifier;
CREATE POLICY content_resource_verifier ON public.resources FOR SELECT TO wasl_subject_verifier USING (true);

CREATE FUNCTION wasl_private.class_open(school uuid, assignment uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.section_subjects a
    JOIN public.sections s ON s.school_id = $1 AND s.id = a.section_id
    JOIN public.academic_years y ON y.school_id = $1 AND y.id = s.academic_year_id
    WHERE a.school_id = $1 AND a.id = $2 AND NOT y.archived);
$$;

CREATE FUNCTION wasl_private.file_visible(school uuid, owner_id uuid, file_purpose public."FilePurpose", lesson uuid, assessment uuid, file_key text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM wasl_assessment.verified_actor($1) v
    WHERE v.purpose IN ('assessment:read','assessment:metadata','assessment:content-write','assessment:file-write','assessment:draft','assessment:submit')
      AND CASE WHEN $3 = 'LESSON_RESOURCE' THEN EXISTS (SELECT 1 FROM public.lessons l
        WHERE l.school_id = $1 AND l.id = $4 AND wasl_content.lesson_visible($1, l.unit_id, l.status)
          AND (v.role IN ('SCHOOL_ADMIN','TEACHER') OR EXISTS (
            SELECT 1 FROM public.resources r WHERE r.school_id = $1 AND r.lesson_id = l.id AND r.type = 'FILE' AND r.storage_key = $6)))
      ELSE EXISTS (SELECT 1 FROM public.assessments a
        WHERE a.school_id = $1 AND a.id = $5 AND wasl_assessment.assessment_access($1, a.id, false)
          AND (v.purpose <> 'assessment:file-write' OR v.target = a.id)
          AND (CASE WHEN v.role = 'STUDENT' THEN v.actor = $2
            ELSE EXISTS (SELECT 1 FROM public.submissions s JOIN public.answers ans
              ON ans.school_id = $1 AND ans.submission_id = s.id AND ans.file_key = $6
              WHERE s.school_id = $1 AND s.assessment_id = a.id AND s.student_id = $2 AND s.status <> 'IN_PROGRESS')
              AND (v.role IN ('TEACHER','SCHOOL_ADMIN') OR (v.role = 'PARENT'
                AND (v.target = $2 OR v.purpose = 'assessment:metadata')
                AND wasl_assessment.linked_child($1, v.actor, $2)
                AND a.status IN ('RESULTS_RELEASED','ARCHIVED') AND a.results_released_at IS NOT NULL))
          END)) END);
$$;

CREATE FUNCTION wasl_private.file_insert(school uuid, owner_id uuid, file_purpose public."FilePurpose", lesson uuid, assessment uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM wasl_assessment.verified_actor($1) v WHERE v.purpose = 'assessment:file-write' AND v.actor = $2
    AND CASE WHEN $3 = 'LESSON_RESOURCE' THEN v.role IN ('TEACHER','SCHOOL_ADMIN') AND v.target = $4 AND EXISTS (
      SELECT 1 FROM public.lessons l JOIN public.units u ON u.school_id = $1 AND u.id = l.unit_id
      WHERE l.school_id = $1 AND l.id = $4 AND l.status = 'DRAFT'
        AND wasl_content.unit_access($1, l.unit_id, false) AND wasl_private.class_open($1, u.section_subject_id))
    ELSE v.role = 'STUDENT' AND v.target = $5 AND EXISTS (
      SELECT 1 FROM public.assessments a WHERE a.school_id = $1 AND a.id = $5
        AND a.status IN ('OPEN','SCHEDULED') AND wasl_assessment.assessment_access($1, a.id, true)
        AND (a.due_at IS NULL OR a.due_at > pg_catalog.statement_timestamp() AT TIME ZONE 'UTC')
        AND wasl_private.class_open($1, a.section_subject_id)
        AND NOT EXISTS (SELECT 1 FROM public.submissions s WHERE s.school_id = $1 AND s.assessment_id = a.id
          AND s.student_id = v.actor AND s.status <> 'IN_PROGRESS')
        AND EXISTS (SELECT 1 FROM public.assessment_questions link JOIN public.questions q ON q.school_id = $1 AND q.id = link.question_id
          WHERE link.school_id = $1 AND link.assessment_id = a.id AND q.type = 'FILE_UPLOAD'))
    END);
$$;

CREATE FUNCTION wasl_private.announcement_visible(school uuid, author uuid, assignment uuid, state public."PublishStatus")
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM wasl_assessment.verified_actor($1) v
    WHERE v.purpose IN ('assessment:metadata','assessment:read','assessment:announcement-write')
      AND (v.role = 'SCHOOL_ADMIN' OR (($4 = 'PUBLISHED' OR (v.role = 'TEACHER' AND v.actor = $2))
        AND ($3 IS NULL OR wasl_assessment.class_access($1, $3, NULL, false)))));
$$;

CREATE FUNCTION wasl_private.announcement_manage(school uuid, author uuid, assignment uuid, creating boolean)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM wasl_assessment.verified_actor($1) v
    WHERE v.purpose = 'assessment:announcement-write' AND (NOT $4 OR v.actor = $2)
    AND (v.role = 'SCHOOL_ADMIN' OR (v.role = 'TEACHER' AND v.actor = $2 AND $3 IS NOT NULL))
    AND ($3 IS NULL OR (wasl_private.class_open($1, $3) AND wasl_assessment.class_access($1, $3, NULL, false))));
$$;

CREATE FUNCTION wasl_private.announcement_edit(school uuid, announcement uuid, next_title text, next_body text,
  next_state public."PublishStatus", next_published timestamp)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.announcements n
    WHERE n.school_id = $1 AND n.id = $2 AND wasl_private.announcement_manage($1, n.author_id, n.section_subject_id, false)
    AND CASE WHEN n.status = 'DRAFT' THEN
      (($5 = 'DRAFT' AND $6 IS NULL) OR ($5 = 'PUBLISHED' AND $6 IS NOT NULL AND (n.title, n.body) IS NOT DISTINCT FROM ($3, $4)))
    ELSE $5 = 'ARCHIVED' AND (n.title, n.body, n.published_at) IS NOT DISTINCT FROM ($3, $4, $6) END);
$$;

CREATE FUNCTION wasl_private.active_school_member(school uuid, member uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.memberships m JOIN public.users u ON u.id = m.user_id
    WHERE m.school_id = $1 AND m.user_id = $2 AND m.active AND u.active);
$$;

CREATE FUNCTION wasl_private.class_recipient(school uuid, assignment uuid, recipient uuid, student uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.section_subjects a
    JOIN public.enrollments e ON e.school_id = $1 AND e.section_id = a.section_id AND e.student_id = $4 AND e.status = 'ACTIVE'
    JOIN public.memberships m ON m.school_id = $1 AND m.user_id = e.student_id AND m.role = 'STUDENT' AND m.active
    JOIN public.users u ON u.id = m.user_id AND u.active
    WHERE a.school_id = $1 AND a.id = $2 AND (e.student_id = $3 OR wasl_assessment.linked_child($1, $3, $4)));
$$;

CREATE FUNCTION wasl_private.notification_access(school uuid, recipient uuid, event text, payload jsonb, writing boolean)
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
        AND EXISTS (SELECT 1 FROM wasl_assessment.verified_actor($1) v WHERE v.purpose = 'assessment:staff-write')
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

ALTER FUNCTION wasl_private.class_open(uuid,uuid) OWNER TO wasl_subject_verifier;
ALTER FUNCTION wasl_private.file_visible(uuid,uuid,public."FilePurpose",uuid,uuid,text) OWNER TO wasl_subject_verifier;
ALTER FUNCTION wasl_private.file_insert(uuid,uuid,public."FilePurpose",uuid,uuid) OWNER TO wasl_subject_verifier;
ALTER FUNCTION wasl_private.announcement_visible(uuid,uuid,uuid,public."PublishStatus") OWNER TO wasl_subject_verifier;
ALTER FUNCTION wasl_private.announcement_manage(uuid,uuid,uuid,boolean) OWNER TO wasl_subject_verifier;
ALTER FUNCTION wasl_private.announcement_edit(uuid,uuid,text,text,public."PublishStatus",timestamp) OWNER TO wasl_subject_verifier;
ALTER FUNCTION wasl_private.active_school_member(uuid,uuid) OWNER TO wasl_subject_verifier;
ALTER FUNCTION wasl_private.class_recipient(uuid,uuid,uuid,uuid) OWNER TO wasl_subject_verifier;
ALTER FUNCTION wasl_private.notification_access(uuid,uuid,text,jsonb,boolean) OWNER TO wasl_subject_verifier;
REVOKE CREATE ON SCHEMA wasl_private FROM wasl_subject_verifier;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA wasl_private FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wasl_private.file_visible(uuid,uuid,public."FilePurpose",uuid,uuid,text),
  wasl_private.file_insert(uuid,uuid,public."FilePurpose",uuid,uuid),
  wasl_private.announcement_visible(uuid,uuid,uuid,public."PublishStatus"),
  wasl_private.announcement_manage(uuid,uuid,uuid,boolean),
  wasl_private.announcement_edit(uuid,uuid,text,text,public."PublishStatus",timestamp) TO wasl_tenant;
GRANT EXECUTE ON FUNCTION wasl_private.notification_access(uuid,uuid,text,jsonb,boolean) TO wasl_tenant, wasl_assessment_staff;

DROP POLICY file_objects_school ON public.file_objects;
CREATE POLICY verified_file_read ON public.file_objects FOR SELECT TO wasl_tenant
  USING (wasl_private.file_visible(school_id, owner_id, purpose, lesson_id, assessment_id, storage_key));
CREATE POLICY verified_file_insert ON public.file_objects FOR INSERT TO wasl_tenant
  WITH CHECK (wasl_private.file_insert(school_id, owner_id, purpose, lesson_id, assessment_id) AND storage_key ~ (
    '^schools/' || school_id::text || CASE WHEN purpose = 'LESSON_RESOURCE' THEN '/lessons/' || lesson_id::text ELSE '/students/' || owner_id::text END
      || '/files/' || id::text || '[.](pdf|png|jpg|jpeg|txt|docx|xlsx|pptx)$'));

DROP POLICY announcements_school ON public.announcements;
CREATE POLICY announcement_verifier ON public.announcements FOR SELECT TO wasl_subject_verifier USING (true);
CREATE POLICY announcement_read ON public.announcements FOR SELECT TO wasl_tenant
  USING (wasl_private.announcement_visible(school_id, author_id, section_subject_id, status));
CREATE POLICY announcement_insert ON public.announcements FOR INSERT TO wasl_tenant
  WITH CHECK (status = 'DRAFT' AND published_at IS NULL AND wasl_private.announcement_manage(school_id, author_id, section_subject_id, true));
CREATE POLICY announcement_update ON public.announcements FOR UPDATE TO wasl_tenant
  USING (wasl_private.announcement_manage(school_id, author_id, section_subject_id, false))
  WITH CHECK (wasl_private.announcement_edit(school_id, id, title, body, status, published_at));

DROP POLICY notifications_school ON public.notifications;
CREATE POLICY notification_read ON public.notifications FOR SELECT TO wasl_tenant
  USING (wasl_private.notification_access(school_id, user_id, type, payload, false));
CREATE POLICY notification_insert ON public.notifications FOR INSERT TO wasl_tenant, wasl_assessment_staff
  WITH CHECK (read_at IS NULL AND wasl_private.notification_access(school_id, user_id, type, payload, true));
CREATE POLICY notification_mark ON public.notifications FOR UPDATE TO wasl_tenant
  USING (wasl_private.notification_access(school_id, user_id, type, payload, false))
  WITH CHECK (wasl_private.notification_access(school_id, user_id, type, payload, false));

DROP POLICY academic_manage_links ON public.parent_student_links;
CREATE POLICY academic_read_links ON public.parent_student_links FOR SELECT TO wasl_academic_admin
  USING (wasl_academic.can_manage(school_id));
CREATE POLICY academic_create_links ON public.parent_student_links FOR INSERT TO wasl_academic_admin
  WITH CHECK (status = 'PENDING' AND verified_at IS NULL AND parent_id <> student_id
    AND wasl_academic.valid_participant(school_id, parent_id, 'PARENT', true)
    AND wasl_academic.valid_participant(school_id, student_id, 'STUDENT', true));
CREATE POLICY academic_update_links ON public.parent_student_links FOR UPDATE TO wasl_academic_admin
  USING (wasl_academic.can_manage(school_id))
  WITH CHECK (wasl_academic.can_manage(school_id) AND (status <> 'VERIFIED' OR (
    verified_at IS NOT NULL AND wasl_academic.valid_participant(school_id, parent_id, 'PARENT', true)
    AND wasl_academic.valid_participant(school_id, student_id, 'STUDENT', true))));

COMMIT;
