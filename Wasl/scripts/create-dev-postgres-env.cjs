const { randomBytes } = require('node:crypto');
const { constants, copyFileSync, existsSync, readFileSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');

const root = resolve(__dirname, '..');
const template = resolve(root, '.env.postgres.example');
const target = resolve(root, '.env.postgres.local');
if (existsSync(target)) {
  console.error('.env.postgres.local already exists; it was not changed.');
  process.exitCode = 1;
} else {
  copyFileSync(template, target, constants.COPYFILE_EXCL);
  const secretKeys = new Set([
    'WASL_DEV_MIGRATOR_PASSWORD', 'WASL_DEV_AUTH_PASSWORD', 'WASL_DEV_PLATFORM_PASSWORD',
    'WASL_DEV_TENANT_PASSWORD', 'WASL_DEV_ACADEMIC_ADMIN_PASSWORD',
    'WASL_DEV_ASSESSMENT_STAFF_PASSWORD', 'WASL_DEV_ADMIN_PASSWORD',
  ]);
  const keyKeys = new Set(['WASL_SUBJECT_PROOF_KEY', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET']);
  const configured = readFileSync(target, 'utf8').replace(/^([A-Z][A-Z0-9_]*)=$/gm, (_, key) => {
    if (secretKeys.has(key)) return `${key}=${randomBytes(24).toString('hex')}`;
    if (keyKeys.has(key)) return `${key}=${randomBytes(32).toString('hex')}`;
    return `${key}=`;
  });
  writeFileSync(target, configured, { encoding: 'utf8', flag: 'w', mode: 0o600 });
  console.log('Created private .env.postgres.local with independent random development secrets.');
}
