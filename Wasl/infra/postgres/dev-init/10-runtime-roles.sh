#!/usr/bin/env bash
set -Eeuo pipefail

required=(
  WASL_DEV_AUTH_PASSWORD
  WASL_DEV_PLATFORM_PASSWORD
  WASL_DEV_TENANT_PASSWORD
  WASL_DEV_ACADEMIC_ADMIN_PASSWORD
  WASL_DEV_ASSESSMENT_STAFF_PASSWORD
)
for key in "${required[@]}"; do
  value="${!key:-}"
  if [[ ! "$value" =~ ^[a-f0-9]{48}$ ]]; then
    echo "Refusing to initialize: $key must be 48 lowercase hex characters." >&2
    exit 1
  fi
done

create_login() {
  local role="$1"
  local password="$2"
  psql --set=ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
    --set=role_name="$role" --set=role_password="$password" <<'SQL'
SELECT pg_catalog.format(
  'CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L',
  :'role_name', :'role_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = :'role_name')
\gexec
SQL
}

create_login wasl_auth "$WASL_DEV_AUTH_PASSWORD"
create_login wasl_platform "$WASL_DEV_PLATFORM_PASSWORD"
create_login wasl_tenant "$WASL_DEV_TENANT_PASSWORD"
create_login wasl_academic_admin "$WASL_DEV_ACADEMIC_ADMIN_PASSWORD"
create_login wasl_assessment_staff "$WASL_DEV_ASSESSMENT_STAFF_PASSWORD"

psql --set=ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
SELECT 'CREATE ROLE wasl_subject_verifier NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS'
WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'wasl_subject_verifier')
\gexec
COMMENT ON DATABASE wasl_dev IS 'wasl-local-postgres17-development-v1';
SQL
