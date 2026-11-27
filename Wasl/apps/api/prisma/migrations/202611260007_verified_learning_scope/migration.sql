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
    IF purpose IN ('assessment:draft','assessment:submit') OR
      (purpose IN ('assessment:read','assessment:results','assessment:metadata') AND target = actor) THEN RETURN NEXT; END IF;
  ELSIF role = 'PARENT' THEN
    IF (purpose IN ('assessment:metadata','assessment:discover') AND target = actor) OR purpose IN ('assessment:read','assessment:results') THEN RETURN NEXT; END IF;
  ELSIF role IN ('TEACHER','SCHOOL_ADMIN') AND target = actor AND purpose IN ('assessment:read','assessment:metadata','assessment:content-write') THEN RETURN NEXT;
  END IF;
EXCEPTION WHEN invalid_text_representation OR invalid_parameter_value OR numeric_value_out_of_range THEN RETURN;
END;
$$;

CREATE SCHEMA wasl_content;
REVOKE ALL ON SCHEMA wasl_content FROM PUBLIC;
GRANT USAGE ON SCHEMA wasl_content TO wasl_tenant;
GRANT USAGE, CREATE ON SCHEMA wasl_content TO wasl_subject_verifier;

CREATE UNIQUE INDEX units_school_row_idx ON public.units (school_id, id);
CREATE UNIQUE INDEX lessons_school_row_idx ON public.lessons (school_id, id);
CREATE UNIQUE INDEX question_banks_school_row_idx ON public.question_banks (school_id, id);
CREATE UNIQUE INDEX questions_school_row_idx ON public.questions (school_id, id);
ALTER TABLE public.units ADD CONSTRAINT units_school_assignment_fk
  FOREIGN KEY (school_id, section_subject_id) REFERENCES public.section_subjects (school_id, id);
ALTER TABLE public.lessons ADD CONSTRAINT lessons_school_unit_fk
  FOREIGN KEY (school_id, unit_id) REFERENCES public.units (school_id, id);
ALTER TABLE public.resources ADD CONSTRAINT resources_school_lesson_fk
  FOREIGN KEY (school_id, lesson_id) REFERENCES public.lessons (school_id, id);
ALTER TABLE public.question_banks ADD CONSTRAINT question_banks_school_subject_fk
  FOREIGN KEY (school_id, subject_id) REFERENCES public.subjects (school_id, id);
ALTER TABLE public.questions ADD CONSTRAINT questions_school_bank_fk
  FOREIGN KEY (school_id, question_bank_id) REFERENCES public.question_banks (school_id, id);
ALTER TABLE public.question_options ADD CONSTRAINT question_options_school_question_fk
  FOREIGN KEY (school_id, question_id) REFERENCES public.questions (school_id, id);

REVOKE UPDATE ON public.units, public.lessons, public.resources FROM wasl_tenant;
GRANT UPDATE (title, "order") ON public.units TO wasl_tenant;
GRANT UPDATE (title, body, "order", status, published_at) ON public.lessons TO wasl_tenant;
GRANT UPDATE (lesson_id, type, title, storage_key, url, offline_allowed) ON public.resources TO wasl_tenant;
GRANT SELECT (id, school_id, section_subject_id) ON public.units TO wasl_subject_verifier;
GRANT SELECT (id, school_id, unit_id, status, title, body, "order", published_at) ON public.lessons TO wasl_subject_verifier;
GRANT SELECT (school_id, lesson_id, owner_id, purpose, storage_key) ON public.file_objects TO wasl_subject_verifier;
CREATE POLICY file_content_reference ON public.file_objects FOR SELECT TO wasl_subject_verifier USING (true);

CREATE FUNCTION wasl_content.assignment_access(school uuid, assignment uuid, writing boolean)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM wasl_assessment.verified_actor($1) v
    JOIN public.section_subjects a ON a.school_id = $1 AND a.id = $2
    JOIN public.sections s ON s.school_id = $1 AND s.id = a.section_id
    JOIN public.academic_years y ON y.school_id = $1 AND y.id = s.academic_year_id
    WHERE v.purpose IN ('assessment:read','assessment:metadata','assessment:content-write')
      AND CASE
        WHEN $3 THEN v.purpose = 'assessment:content-write' AND NOT y.archived
          AND (v.role = 'SCHOOL_ADMIN' OR (v.role = 'TEACHER' AND a.teacher_id = v.actor))
        ELSE (v.role IN ('SCHOOL_ADMIN','TEACHER') OR NOT y.archived)
          AND wasl_assessment.class_access($1, $2, NULL, false)
      END);
$$;

CREATE FUNCTION wasl_content.unit_access(school uuid, unit uuid, writing boolean)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.units u WHERE u.school_id = $1 AND u.id = $2
    AND wasl_content.assignment_access($1, u.section_subject_id, $3));
$$;

CREATE FUNCTION wasl_content.lesson_visible(school uuid, unit uuid, lesson_status public."PublishStatus")
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT wasl_content.unit_access($1, $2, false) AND ($3 = 'PUBLISHED'
    OR EXISTS (SELECT 1 FROM wasl_assessment.verified_actor($1) v WHERE v.role IN ('SCHOOL_ADMIN','TEACHER')));
$$;

CREATE FUNCTION wasl_content.lesson_update(school uuid, lesson uuid, next_title text, next_body text, next_order integer,
  next_status public."PublishStatus", next_published timestamp)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.lessons l WHERE l.school_id = $1 AND l.id = $2
    AND wasl_content.unit_access($1, l.unit_id, true)
    AND CASE WHEN l.status = 'DRAFT' THEN
      (($6 = 'DRAFT' AND $7 IS NULL) OR ($6 = 'PUBLISHED' AND $7 IS NOT NULL))
    ELSE (l.status = $6 OR (l.status = 'PUBLISHED' AND $6 = 'ARCHIVED'))
      AND (l.title, l.body, l."order", l.published_at) IS NOT DISTINCT FROM ($3, $4, $5, $7) END);
$$;

CREATE FUNCTION wasl_content.resource_access(school uuid, lesson uuid, writing boolean)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE WHEN $2 IS NULL THEN EXISTS (SELECT 1 FROM wasl_assessment.verified_actor($1) v
      WHERE v.role = 'SCHOOL_ADMIN' AND (NOT $3 OR v.purpose = 'assessment:content-write'))
    ELSE EXISTS (SELECT 1 FROM public.lessons l WHERE l.school_id = $1 AND l.id = $2
      AND CASE WHEN $3 THEN l.status = 'DRAFT' AND wasl_content.unit_access($1, l.unit_id, true)
        ELSE wasl_content.lesson_visible($1, l.unit_id, l.status) END) END;
$$;

CREATE FUNCTION wasl_content.resource_write(school uuid, lesson uuid, resource_type public."ResourceType", file_key text, resource_url text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT wasl_content.resource_access($1, $2, true) AND CASE
    WHEN $3 = 'FILE' THEN $4 IS NOT NULL AND $5 IS NULL AND EXISTS (
      SELECT 1 FROM public.file_objects f CROSS JOIN wasl_assessment.verified_actor($1) v
      WHERE f.school_id = $1 AND f.lesson_id = $2 AND f.purpose = 'LESSON_RESOURCE' AND f.storage_key = $4
        AND (v.role = 'SCHOOL_ADMIN' OR v.actor = f.owner_id))
    ELSE $4 IS NULL AND $5 IS NOT NULL END;
$$;

ALTER FUNCTION wasl_content.assignment_access(uuid,uuid,boolean) OWNER TO wasl_subject_verifier;
ALTER FUNCTION wasl_content.unit_access(uuid,uuid,boolean) OWNER TO wasl_subject_verifier;
ALTER FUNCTION wasl_content.lesson_visible(uuid,uuid,public."PublishStatus") OWNER TO wasl_subject_verifier;
ALTER FUNCTION wasl_content.lesson_update(uuid,uuid,text,text,integer,public."PublishStatus",timestamp) OWNER TO wasl_subject_verifier;
ALTER FUNCTION wasl_content.resource_access(uuid,uuid,boolean) OWNER TO wasl_subject_verifier;
ALTER FUNCTION wasl_content.resource_write(uuid,uuid,public."ResourceType",text,text) OWNER TO wasl_subject_verifier;
REVOKE CREATE ON SCHEMA wasl_content FROM wasl_subject_verifier;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA wasl_content FROM PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA wasl_content TO wasl_tenant;

ALTER TABLE public.units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.units FORCE ROW LEVEL SECURITY;
CREATE POLICY content_unit_verifier ON public.units FOR SELECT TO wasl_subject_verifier USING (true);
CREATE POLICY content_unit_read ON public.units FOR SELECT TO wasl_tenant
  USING (wasl_content.assignment_access(school_id, section_subject_id, false));
CREATE POLICY content_unit_insert ON public.units FOR INSERT TO wasl_tenant
  WITH CHECK (wasl_content.assignment_access(school_id, section_subject_id, true));
CREATE POLICY content_unit_update ON public.units FOR UPDATE TO wasl_tenant
  USING (wasl_content.assignment_access(school_id, section_subject_id, true))
  WITH CHECK (wasl_content.assignment_access(school_id, section_subject_id, true));

ALTER TABLE public.lessons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lessons FORCE ROW LEVEL SECURITY;
CREATE POLICY content_lesson_verifier ON public.lessons FOR SELECT TO wasl_subject_verifier USING (true);
CREATE POLICY content_lesson_read ON public.lessons FOR SELECT TO wasl_tenant
  USING (wasl_content.lesson_visible(school_id, unit_id, status));
CREATE POLICY content_lesson_insert ON public.lessons FOR INSERT TO wasl_tenant
  WITH CHECK (status = 'DRAFT' AND published_at IS NULL AND wasl_content.unit_access(school_id, unit_id, true));
CREATE POLICY content_lesson_update ON public.lessons FOR UPDATE TO wasl_tenant
  USING (wasl_content.unit_access(school_id, unit_id, true))
  WITH CHECK (wasl_content.lesson_update(school_id, id, title, body, "order", status, published_at));

ALTER TABLE public.resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resources FORCE ROW LEVEL SECURITY;
CREATE POLICY content_resource_read ON public.resources FOR SELECT TO wasl_tenant
  USING (wasl_content.resource_access(school_id, lesson_id, false));
CREATE POLICY content_resource_insert ON public.resources FOR INSERT TO wasl_tenant
  WITH CHECK (wasl_content.resource_write(school_id, lesson_id, type, storage_key, url));
CREATE POLICY content_resource_update ON public.resources FOR UPDATE TO wasl_tenant
  USING (wasl_content.resource_access(school_id, lesson_id, true))
  WITH CHECK (wasl_content.resource_write(school_id, lesson_id, type, storage_key, url));

COMMIT;
