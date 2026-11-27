BEGIN;

CREATE TABLE public.session_families (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.users(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  revision bigint NOT NULL DEFAULT 0,
  revoked_at timestamp(3),
  CONSTRAINT session_families_id_user_id_key UNIQUE (id, user_id)
);

ALTER TABLE public.refresh_tokens ADD COLUMN family_id uuid;

-- Existing tokens have no trustworthy lineage. Preserve them as revoked
-- records and require a new login rather than grouping independent devices.
INSERT INTO public.session_families (id, user_id, revoked_at)
SELECT id, user_id, COALESCE(revoked_at, CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
FROM public.refresh_tokens;
UPDATE public.refresh_tokens t
SET family_id = f.id, revoked_at = f.revoked_at
FROM public.session_families f WHERE f.id = t.id;

ALTER TABLE public.refresh_tokens ALTER COLUMN family_id SET NOT NULL;
ALTER TABLE public.refresh_tokens ADD CONSTRAINT refresh_tokens_family_id_user_id_fkey
  FOREIGN KEY (family_id, user_id) REFERENCES public.session_families(id, user_id)
  ON UPDATE CASCADE ON DELETE RESTRICT;
CREATE INDEX refresh_tokens_family_id_user_id_idx ON public.refresh_tokens (family_id, user_id);

REVOKE ALL ON public.session_families FROM PUBLIC;
GRANT SELECT (id, user_id, revoked_at, revision), INSERT (id, user_id), UPDATE (revoked_at, revision)
  ON public.session_families TO wasl_auth;
GRANT SELECT (family_id), INSERT (family_id) ON public.refresh_tokens TO wasl_auth;

COMMIT;
