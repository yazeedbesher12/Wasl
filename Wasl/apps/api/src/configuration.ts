export function validateEnvironment(env: Record<string, unknown>) {
  if (env.NODE_ENV !== undefined && !['development', 'test', 'production'].includes(String(env.NODE_ENV))) throw new Error('NODE_ENV must be development, test or production');
  const production = env.NODE_ENV === 'production';
  const driver = String(env.WASL_STORAGE_DRIVER ?? 'memory');
  if (!['memory', 'prisma'].includes(driver)) throw new Error('WASL_STORAGE_DRIVER must be memory or prisma');
  if (production && driver === 'memory') throw new Error('Memory storage is forbidden in production');
  for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET']) {
    const value = String(env[key] ?? '');
    if (value.length < 32 || /change-me|placeholder/i.test(value)) throw new Error(`${key} must be a non-placeholder secret of at least 32 characters`);
  }
  if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) throw new Error('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be distinct');
  const port = Number(env.API_PORT ?? 4000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('API_PORT must be 1..65535');
  const ttl = String(env.JWT_ACCESS_TTL ?? '15m');
  const match = /^(\d+)(s|m|h)?$/.exec(ttl);
  const units: Record<string, number> = { s: 1, m: 60, h: 3600 };
  const seconds = match ? Number(match[1]) * (units[match[2] ?? 's'] ?? 0) : 0;
  if (!Number.isSafeInteger(seconds) || seconds < 60 || seconds > 86400) throw new Error('JWT_ACCESS_TTL must be between 60s and 24h');
  const days = Number(env.JWT_REFRESH_TTL_DAYS ?? 30);
  if (!Number.isInteger(days) || days < 1 || days > 90) throw new Error('JWT_REFRESH_TTL_DAYS must be 1..90');
  if (driver === 'prisma') {
    const runtimeRoles = { DATABASE_URL: 'wasl_tenant', AUTH_DATABASE_URL: 'wasl_auth', PLATFORM_DATABASE_URL: 'wasl_platform', ACADEMIC_ADMIN_DATABASE_URL: 'wasl_academic_admin', ASSESSMENT_STAFF_DATABASE_URL: 'wasl_assessment_staff' } as const;
    const targets = Object.entries(runtimeRoles).map(([key, role]) => {
      try {
        const url = new URL(String(env[key] ?? ''));
        if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.pathname.slice(1) ||
            decodeURIComponent(url.username) !== role || (url.searchParams.get('schema') ?? 'public') !== 'public') throw new Error();
        return `${url.hostname}:${url.port || '5432'}/${decodeURIComponent(url.pathname.slice(1))}`;
      } catch {
        throw new Error(`${key} must be a PostgreSQL connection URL for ${role} in the public schema`);
      }
    });
    if (new Set(targets).size !== 1) throw new Error('The runtime database roles must target the same database');
    if (env.MIGRATION_DATABASE_URL) throw new Error('MIGRATION_DATABASE_URL belongs in the migration process only');
    if (!/^[a-f0-9]{64}$/.test(String(env.WASL_SUBJECT_PROOF_KEY ?? ''))) throw new Error('WASL_SUBJECT_PROOF_KEY must be a 32-byte hex key');
  }
  if (driver === 'memory') {
    const password = String(env.WASL_DEV_PASSWORD ?? '');
    if (password.length < 12 || Buffer.byteLength(password, 'utf8') > 72) throw new Error('Set WASL_DEV_PASSWORD to a development-only password of 12..72 UTF-8 bytes');
  }
  const origins = String(env.CORS_ORIGINS ?? (production ? '' : 'http://localhost:3000')).split(',').map(s => s.trim()).filter(Boolean);
  if (!origins.length) throw new Error('Set explicit CORS_ORIGINS');
  for (const origin of origins) {
    try { const url = new URL(origin); if (!['http:', 'https:', 'exp:'].includes(url.protocol) || url.origin !== origin && url.protocol !== 'exp:' || url.username || url.password || origin.includes('*')) throw new Error(); }
    catch { throw new Error('CORS_ORIGINS must contain explicit valid origins, never wildcards'); }
  }
  const fileDriver = String(env.WASL_FILE_STORAGE_DRIVER ?? (production ? 's3' : 'local'));
  if (!['local', 's3'].includes(fileDriver)) throw new Error('WASL_FILE_STORAGE_DRIVER must be local or s3');
  if (production && fileDriver !== 's3') throw new Error('Production requires a private S3-compatible file store');
  if (fileDriver === 's3') {
    for (const key of ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']) if (!String(env[key] ?? '').trim()) throw new Error(`${key} is required for S3 file storage`);
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(String(env.S3_BUCKET))) throw new Error('Use a valid S3 bucket name');
    if (env.S3_ENDPOINT) {
      try { const url = new URL(String(env.S3_ENDPOINT)); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || production && url.protocol !== 'https:') throw new Error(); }
      catch { throw new Error('S3_ENDPOINT must be a valid endpoint (HTTPS in production)'); }
    }
    if (env.S3_FORCE_PATH_STYLE !== undefined && !['true', 'false'].includes(String(env.S3_FORCE_PATH_STYLE))) throw new Error('S3_FORCE_PATH_STYLE must be true or false');
  }
  return { ...env, WASL_FILE_STORAGE_DRIVER: fileDriver, WASL_STORAGE_DRIVER: driver, JWT_ACCESS_SECONDS: seconds, JWT_REFRESH_TTL_DAYS: days, CORS_ORIGINS: origins.join(',') };
}
