const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { PrismaClient } = require('@prisma/client');

const root = resolve(__dirname, '..');
const envFile = resolve(root, process.env.WASL_DEV_ENV_FILE || '.env.postgres.local');
const marker = 'wasl-local-postgres17-development-v1';
const database = 'wasl_dev';
const roles = {
  AUTH_DATABASE_URL: ['wasl_auth', 'WASL_DEV_AUTH_PASSWORD'],
  PLATFORM_DATABASE_URL: ['wasl_platform', 'WASL_DEV_PLATFORM_PASSWORD'],
  DATABASE_URL: ['wasl_tenant', 'WASL_DEV_TENANT_PASSWORD'],
  ACADEMIC_ADMIN_DATABASE_URL: ['wasl_academic_admin', 'WASL_DEV_ACADEMIC_ADMIN_PASSWORD'],
  ASSESSMENT_STAFF_DATABASE_URL: ['wasl_assessment_staff', 'WASL_DEV_ASSESSMENT_STAFF_PASSWORD'],
};

function readEnvironment() {
  let source;
  try { source = readFileSync(envFile, 'utf8'); }
  catch { throw new Error('Create .env.postgres.local from .env.postgres.example before continuing.'); }
  const values = {};
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (!match) throw new Error('The local PostgreSQL environment file contains an invalid line.');
    if (Object.hasOwn(values, match[1])) throw new Error(`Duplicate ${match[1]} in the local environment file.`);
    values[match[1]] = match[2].trim();
  }
  const passwordKeys = ['WASL_DEV_MIGRATOR_PASSWORD', 'WASL_DEV_ADMIN_PASSWORD', ...Object.values(roles).map(([, key]) => key)];
  for (const key of passwordKeys) {
    if (!/^[a-f0-9]{48}$/.test(values[key] ?? '')) throw new Error(`${key} must be 48 lowercase hex characters.`);
  }
  for (const key of ['WASL_SUBJECT_PROOF_KEY', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET']) {
    if (!/^[a-f0-9]{64}$/.test(values[key] ?? '')) throw new Error(`${key} must be 64 lowercase hex characters.`);
  }
  if (values.JWT_ACCESS_SECRET === values.JWT_REFRESH_SECRET)
    throw new Error('JWT access and refresh secrets must be distinct.');
  const port = Number(values.WASL_DEV_POSTGRES_PORT || 55437);
  if (!Number.isInteger(port) || port <= 1024 || port > 65535 || [5432, 5433, 55436].includes(port))
    throw new Error('WASL_DEV_POSTGRES_PORT must be an unprotected high port.');
  const apiPort = Number(values.API_PORT || 4000);
  if (!Number.isInteger(apiPort) || apiPort < 1 || apiPort > 65535) throw new Error('API_PORT is invalid.');
  if (!values.CORS_ORIGINS) throw new Error('CORS_ORIGINS is required.');
  return { values, port, apiPort };
}

function url(role, password, port) {
  return `postgresql://${encodeURIComponent(role)}:${encodeURIComponent(password)}@127.0.0.1:${port}/${database}?schema=public`;
}

function applicationEnvironment(config) {
  const env = { ...process.env, ...config.values, NODE_ENV: 'development', WASL_STORAGE_DRIVER: 'prisma',
    WASL_FILE_STORAGE_DRIVER: 'local', WASL_DEV_DATABASE_MARKER: marker };
  for (const [key, [role, passwordKey]] of Object.entries(roles))
    env[key] = url(role, config.values[passwordKey], config.port);
  delete env.MIGRATION_DATABASE_URL;
  return env;
}

function pnpm(args, env) {
  const executable = process.env.npm_execpath;
  if (!executable) throw new Error('Run this command through the repository pnpm scripts.');
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [executable, ...args], { cwd: root, env, stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolvePromise() : reject(new Error(`Command failed${signal ? ` (${signal})` : ''}.`)));
  });
}

async function verifyTarget(client) {
  const [identity] = await client.$queryRaw`
    SELECT current_database() = ${database}
      AND current_user = 'wasl_migrate'
      AND pg_get_userbyid(datdba) = current_user
      AND inet_server_port() = 5432
      AND current_setting('server_version_num')::int BETWEEN 170000 AND 179999
      AND shobj_description(oid, 'pg_database') = ${marker} AS valid
    FROM pg_database WHERE datname = current_database()`;
  assert.equal(identity?.valid, true, 'Refusing an unrecognized PostgreSQL target.');
}

async function bootstrap(config) {
  const runtime = applicationEnvironment(config);
  const migrationUrl = url('wasl_migrate', config.values.WASL_DEV_MIGRATOR_PASSWORD, config.port);
  const migrationEnv = { ...runtime, DATABASE_URL: migrationUrl, MIGRATION_DATABASE_URL: migrationUrl };
  await pnpm(['--filter', '@wasl/api', 'exec', 'prisma', 'validate'], migrationEnv);
  await pnpm(['--filter', '@wasl/api', 'exec', 'prisma', 'generate'], migrationEnv);
  const db = new PrismaClient({ datasources: { db: { url: migrationUrl } } });
  try {
    await verifyTarget(db);
    await pnpm(['--filter', '@wasl/api', 'exec', 'prisma', 'migrate', 'deploy'], migrationEnv);
    await pnpm(['--filter', '@wasl/api', 'exec', 'prisma', 'migrate', 'status'], migrationEnv);
    const key = config.values.WASL_SUBJECT_PROOF_KEY;
    await db.$transaction(async tx => {
      await tx.$executeRaw`
        INSERT INTO wasl_subject_scope.signing_key (singleton, secret)
        VALUES (true, decode(${key}, 'hex')) ON CONFLICT (singleton) DO NOTHING`;
      const [installed] = await tx.$queryRaw`
        SELECT encode(secret, 'hex') = ${key} AS matches
        FROM wasl_subject_scope.signing_key WHERE singleton = true`;
      assert.equal(installed?.matches, true, 'The configured proof key does not match the persistent database.');
    });
  } finally { await db.$disconnect(); }
  await pnpm(['--filter', '@wasl/api', 'run', 'db:seed:dev'], { ...migrationEnv, WASL_DEV_ADMIN_PASSWORD: config.values.WASL_DEV_ADMIN_PASSWORD });
  console.log('Persistent PostgreSQL development database is migrated and bootstrapped.');
}

async function main() {
  const mode = process.argv[2];
  const config = readEnvironment();
  if (mode === 'bootstrap') return bootstrap(config);
  if (mode === 'api') return pnpm(['--filter', '@wasl/api', 'run', 'dev'], applicationEnvironment(config));
  throw new Error('Expected bootstrap or api mode.');
}

main().catch(error => {
  console.error(error instanceof assert.AssertionError ? error.message : error.message || 'PostgreSQL development command failed.');
  process.exitCode = 1;
});
