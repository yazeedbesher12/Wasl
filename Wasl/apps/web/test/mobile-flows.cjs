const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { mkdtemp, readFile, rm, mkdir } = require('node:fs/promises');
const { createServer } = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../../..');
const password = randomBytes(20).toString('base64url');
const processes = [];
let browser;
let page;
let temporary;
let server;
let logs = '';
function start(script, args, cwd, env) {
  const p = spawn(process.execPath, [script, ...args], {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  processes.push(p);
  for (const stream of [p.stdout, p.stderr])
    stream.on('data', (b) => {
      logs = (logs + b).slice(-14000);
    });
  return p;
}
async function ready(url) {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('API startup timeout');
}
async function main() {
  temporary = await mkdtemp(path.join(require('node:os').tmpdir(), 'wasl-native-flows-'));
  const output = path.join(temporary, 'export');
  const probe = createServer();
  await new Promise((r) => probe.listen(0, '127.0.0.1', r));
  const apiPort = probe.address().port;
  await new Promise((r) => probe.close(r));
  server = createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://local').pathname);
      const file = path.resolve(output, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!file.startsWith(output + path.sep)) {
        res.writeHead(403).end();
        return;
      }
      const types = {
        '.html': 'text/html',
        '.js': 'application/javascript',
        '.json': 'application/json',
        '.png': 'image/png',
        '.css': 'text/css',
        '.ttf': 'font/ttf',
      };
      const bytes = await readFile(file);
      res.writeHead(200, {
        'Content-Type': types[path.extname(file)] ?? 'application/octet-stream',
      });
      res.end(bytes);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const api = `http://127.0.0.1:${apiPort}/api/v1`;
  start(
    path.join(root, 'node_modules/ts-node/dist/bin.js'),
    ['--transpile-only', 'src/memory-main.ts'],
    path.join(root, 'apps/api'),
    {
      NODE_ENV: 'test',
      WASL_STORAGE_DRIVER: 'memory',
      WASL_FILE_STORAGE_DRIVER: 'local',
      WASL_FILES_DIR: path.join(temporary, 'files'),
      WASL_DEV_PASSWORD: password,
      JWT_ACCESS_SECRET: randomBytes(40).toString('hex'),
      JWT_REFRESH_SECRET: randomBytes(40).toString('hex'),
      API_PORT: String(apiPort),
      CORS_ORIGINS: base,
    },
  );
  await ready(api + '/health/ready');
  const build = start(
    path.join(root, 'node_modules/expo/bin/cli'),
    ['export', '--platform', 'web', '--max-workers', '2', '--output-dir', output],
    path.join(root, 'apps/mobile'),
    { EXPO_PUBLIC_API_URL: api, EXPO_PUBLIC_WASL_MODE: 'api', EXPO_NO_TELEMETRY: '1', CI: '1' },
  );
  await new Promise((resolve, reject) => {
    build.on('error', reject);
    build.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error('Expo web export failed')),
    );
  });
  console.log('PASS Expo web production export');
  browser = await chromium.launch({
    headless: true,
    ...(process.env.WASL_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.WASL_CHROMIUM_EXECUTABLE }
      : {}),
    args: JSON.parse(process.env.WASL_CHROMIUM_ARGS || '[]').filter(
      (a) => a !== '--disable-web-security',
    ),
  });
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(30000);
  page.on('dialog', (d) => d.accept());
  const errors = [];
  page.on('pageerror', (e) => {
    errors.push(e.message);
    console.error('PAGE ERROR: ' + e.message);
  });
  await page.goto(base);
  await page.getByRole('button', { name: 'English', exact: true }).click();
  async function login(email) {
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    const response = page.waitForResponse((r) => r.url() === api + '/auth/login');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    assert((await response).ok());
    await page.getByRole('button', { name: 'Sign out', exact: true }).waitFor();
  }
  await login('student1@wasl.test');
  await page.getByRole('button', { name: 'Tasks', exact: true }).first().click();
  await page.getByText('Fictional open practice', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await page.getByRole('button', { name: 'Four', exact: true }).click();
  await page.getByRole('button', { name: 'Save answer draft', exact: true }).click();
  await page.getByText('Saved.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await page.getByRole('button', { name: '✓ Four', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Submit final', exact: true }).click();
  await page.getByText('Your answers were submitted.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Submission receipt', exact: true }).click();
  await page
    .getByText(/Result not released yet\./)
    .first()
    .waitFor();
  console.log(
    'PASS native UI login, safe questions, persisted draft, final submission and receipt',
  );
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('button', { name: 'Lessons', exact: true }).click();
  await page.getByText('Introduction', { exact: true }).waitFor();
  assert.equal(await page.getByText('Teacher draft', { exact: true }).count(), 0);
  const artifacts = process.env.WASL_TEST_ARTIFACTS;
  if (artifacts) {
    await mkdir(artifacts, { recursive: true });
    await page.screenshot({ path: path.join(artifacts, 'native-student.png') });
  }
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor();
  await login('parent@wasl.test');
  await page.getByRole('button', { name: 'View learning', exact: true }).first().click();
  await page.getByText('Mathematics · أ · 2026–2027', { exact: true }).waitFor();
  console.log('PASS native published learning, logout and verified parent class access');
  assert.deepEqual(errors, []);
  await browser.close();
  browser = null;
}
main()
  .catch(async (e) => {
    if (page)
      console.error(
        'PAGE: ' +
          (
            await page
              .locator('body')
              .innerText()
              .catch(() => '')
          ).slice(0, 2400),
      );
    console.error(String(e.stack ?? e).replaceAll(password, '[test-password]'));
    console.error(logs.replaceAll(password, '[test-password]').slice(-4500));
    process.exitCode = 1;
  })
  .finally(async () => {
    if (browser) await browser.close();
    for (const p of processes) p.kill('SIGTERM');
    if (server) await new Promise((r) => server.close(r));
    if (temporary) await rm(temporary, { recursive: true, force: true });
  });
