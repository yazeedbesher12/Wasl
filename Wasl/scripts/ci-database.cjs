const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createHash, randomBytes } = require('node:crypto');
const { readFileSync, readdirSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { PrismaClient } = require('@prisma/client');

const root = resolve(__dirname, '..');
const api = join(root, 'apps', 'api');
const migrations = join(api, 'prisma', 'migrations');
const internalPort = '55436';
const database = 'wasl_db02_disposable';
const migrator = 'wasl_migrate';
const marker = 'wasl-pg17-lab-' + randomBytes(5).toString('hex');
const roles = {
  DATABASE_URL: 'wasl_tenant',
  AUTH_DATABASE_URL: 'wasl_auth',
  PLATFORM_DATABASE_URL: 'wasl_platform',
  ACADEMIC_ADMIN_DATABASE_URL: 'wasl_academic_admin',
  ASSESSMENT_STAFF_DATABASE_URL: 'wasl_assessment_staff',
};
const privateValues = [];
function secret(bytes) {
  const value = randomBytes(bytes).toString('hex');
  privateValues.push(value);
  return value;
}
const migratorPassword = secret(24);
const proofKey = secret(32);
const baseEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !/(?:DATABASE_URL$|^PG|^POSTGRES_|^WASL_|^JWT_|^DEBUG$|^RUST_LOG$)/i.test(key)));

function run(program, args, { env = {}, input, cwd = root, timeout = 120_000 } = {}) {
  return spawnSync(program, args, { env: { ...baseEnv, ...env }, input, cwd, timeout,
    encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, windowsHide: true });
}
function checked(result, label, report = false) {
  if (report) {
    for (const [stream, output] of [[process.stdout, result.stdout], [process.stderr, result.stderr]]) {
      if (output) stream.write(privateValues.reduce((safe, value) => safe.replaceAll(value, '[redacted]'), output));
    }
  }
  if (result.status !== 0) throw new Error(label + ' failed');
  return result.stdout.trim();
}
function sql(statement) {
  return checked(run('docker', ['exec', '-i', '--env', 'PGPASSWORD', marker,
    'psql', '-X', '-h', '127.0.0.1', '-p', internalPort, '-U', migrator, '-d', database,
    '-v', 'ON_ERROR_STOP=1', '-At'], { input: statement, env: { PGPASSWORD: migratorPassword } }),
  'Disposable lab SQL');
}
function url(role, password, port) {
  assert.ok(port > 1024 && ![5432, 5433].includes(port) && port <= 65535, 'Unsafe lab port');
  return `postgresql://${role}:${password}@127.0.0.1:${port}/${database}?schema=public`;
}
function prisma(args, env) {
  checked(run(process.execPath, [process.env.npm_execpath, 'exec', 'prisma', ...args], { cwd: api, env }),
    'Prisma ' + args.join(' '), true);
}

async function verifyLoopback(migrationUrl) {
  const client = new PrismaClient({ datasources: { db: { url: migrationUrl } } });
  try {
    const [row] = await client.$queryRaw`
      SELECT current_database() = ${database} AND current_user::text = ${migrator}
        AND pg_catalog.shobj_description(oid, 'pg_database') = ${marker}
        AND inet_server_port() = ${Number(internalPort)}::integer
        AND current_setting('server_version_num')::int BETWEEN 170000 AND 179999 AS valid
      FROM pg_catalog.pg_database WHERE datname = current_database()`;
    assert.ok(row?.valid, 'Unrecognized database behind loopback port');
  } finally { await client.$disconnect(); }
}

function verifyLedger() {
  const expected = readdirSync(migrations, { withFileTypes: true }).filter(entry => entry.isDirectory())
    .map(entry => entry.name).sort().map(name => name + '|' +
      createHash('sha256').update(readFileSync(join(migrations, name, 'migration.sql'))).digest('hex'));
  assert.ok(expected.length > 0, 'Migration chain is empty');
  const ledger = sql("SELECT migration_name || '|' || checksum FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name").split('\n').map(row => row.trim());
  assert.deepEqual(ledger, expected, 'Applied migration checksums and ordering');
  return ledger;
}

async function main() {
  assert.ok(process.env.npm_execpath, 'Run with pnpm ci:database');
  const runtime = {};
  const labels = ['--name', marker, '--label', 'wasl.disposable=' + marker];
  try {
    checked(run('docker', ['run', '--detach', ...labels, '--publish', `127.0.0.1::${internalPort}`,
      '--env', 'POSTGRES_USER=' + migrator, '--env', 'POSTGRES_DB=' + database,
      '--env', 'POSTGRES_PASSWORD', 'postgres:17', '-p', internalPort],
    { env: { POSTGRES_PASSWORD: migratorPassword }, timeout: 180_000 }), 'Disposable PostgreSQL container');
    const mapping = checked(run('docker', ['port', marker, internalPort + '/tcp']), 'Disposable port mapping');
    const mapped = /^127\.0\.0\.1:(\d+)$/.exec(mapping);
    assert.ok(mapped, 'Expected exactly one loopback port mapping');
    const port = Number(mapped[1]);
    const migrationUrl = url(migrator, migratorPassword, port);
    let ready = false;
    for (let attempt = 0; attempt < 45 && !ready; attempt++) {
      ready = run('docker', ['exec', marker, 'pg_isready', '-h', '127.0.0.1', '-p',
        internalPort, '-U', migrator, '-d', database], { timeout: 5_000 }).status === 0;
      if (!ready) await delay(1_000);
    }
    assert.ok(ready, 'Disposable PostgreSQL did not become ready');
    const roleSql = Object.entries(roles).map(([key, role]) => {
      const password = secret(24);
      runtime[key] = url(role, password, port);
      return `CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${password}';`;
    });
    sql(`CREATE ROLE wasl_subject_verifier NOLOGIN; COMMENT ON DATABASE ${database} IS '${marker}';\n${roleSql.join('\n')}`);
    // Verify the host connection before a migration process can execute any DDL.
    await verifyLoopback(migrationUrl);
    const migrationEnv = { DATABASE_URL: migrationUrl, MIGRATION_DATABASE_URL: migrationUrl };
    prisma(['validate'], migrationEnv);
    prisma(['migrate', 'deploy'], migrationEnv);
    const initial = verifyLedger();
    prisma(['migrate', 'deploy'], migrationEnv);
    prisma(['migrate', 'status'], migrationEnv);
    assert.deepEqual(verifyLedger(), initial);
    console.log(`Verified ${initial.length} migration checksums and repeat deployment`);

    sql(`INSERT INTO wasl_subject_scope.signing_key (singleton, secret) VALUES (true, decode('${proofKey}', 'hex'));
      INSERT INTO public.users (id,email,full_name,password_hash)
        VALUES (gen_random_uuid(),'platform-admin@wasl.test','Fictional CI administrator','unused');
      INSERT INTO public.memberships (id,user_id,role)
        SELECT gen_random_uuid(),id,'PLATFORM_ADMIN' FROM public.users WHERE email='platform-admin@wasl.test';`);
    const testEnv = { ...runtime, NODE_ENV: 'test', WASL_LAB_ID: marker, WASL_SUBJECT_PROOF_KEY: proofKey,
      JWT_ACCESS_SECRET: secret(32), JWT_REFRESH_SECRET: secret(32), WASL_STORAGE_DRIVER: 'prisma', CORS_ORIGINS: 'http://127.0.0.1' };
    for (const suite of ['db-identity-boundary.cjs', 'db-verified-subjects.cjs', 'db-assessment-sensitive.cjs']) {
      checked(run(process.execPath, ['-r', 'ts-node/register/transpile-only', '--test', 'test/' + suite],
        { cwd: api, env: testEnv, timeout: 300_000 }), suite, true);
    }
  } finally {
    const info = run('docker', ['inspect', '--format', '{{index .Config.Labels "wasl.disposable"}}', marker]);
    if (info.status === 0 && info.stdout.trim() === marker) {
      checked(run('docker', ['rm', '--force', '--volumes', marker]), 'Remove disposable PostgreSQL container');
      console.log('Removed disposable PostgreSQL container');
    }
  }
}

main().catch(error => {
  // Driver errors can contain the connection URL.
  console.error(error instanceof assert.AssertionError ? error.message : 'Database verification failed. Check the last completed step.');
  process.exitCode = 1;
});
