const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { mkdtemp, rm, mkdir } = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../../..');
const password = randomBytes(20).toString('base64url');
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const processes = [];
const browsers = [];
const pages = [];
let logs = '';
let temporary;
async function port() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const value = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return value;
}
function start(file, args, cwd, env) {
  const child = spawn(process.execPath, [file, ...args], {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  processes.push(child);
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (bytes) => {
      logs = (logs + bytes.toString()).slice(-18000);
    });
  return child;
}
async function ready(url) {
  for (let i = 0; i < 240; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Server did not become ready: ' + url);
}
const testPdf = Buffer.from('%PDF-1.7\nFictional integration document\n%%EOF\n');
async function main() {
  const production = process.env.WASL_TEST_WEB_PRODUCTION === '1';
  temporary = await mkdtemp(path.join(require('node:os').tmpdir(), 'wasl-web-test-'));
  const apiPort = await port(),
    webPort = await port();
  const base = `http://127.0.0.1:${webPort}`;
  const upstream = `http://127.0.0.1:${apiPort}/api/v1`;
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
  start(
    path.join(root, 'node_modules/next/dist/bin/next'),
    [production ? 'start' : 'dev', '-H', '127.0.0.1', '-p', String(webPort)],
    path.join(root, 'apps/web'),
    {
      NODE_ENV: production ? 'production' : 'development',
      WASL_API_URL: upstream,
      WASL_WEB_ORIGIN: base,
      WASL_WEB_SESSION_MODE: 'single-instance',
      NEXT_TELEMETRY_DISABLED: '1',
    },
  );
  await Promise.all([ready(upstream + '/health/ready'), ready(base + '/login')]);
  const anonymous = await fetch(base + '/api/wasl/me');
  assert.equal(anonymous.status, 401);
  const launch = () =>
    chromium.launch({
      headless: true,
      ...(process.env.WASL_CHROMIUM_EXECUTABLE
        ? { executablePath: process.env.WASL_CHROMIUM_EXECUTABLE }
        : {}),
      args: JSON.parse(process.env.WASL_CHROMIUM_ARGS || '[]').filter(
        (a) => a !== '--disable-web-security',
      ),
    });
  let active;
  async function pause() {
    if (!active) return;
    active.state = await active.context.storageState();
    active.url = active.page.url();
    await active.instance.close();
    active = undefined;
  }
  async function activate(person) {
    if (active === person) return;
    await pause();
    person.instance = await launch();
    browsers.push(person.instance);
    person.context = await person.instance.newContext({
      viewport: { width: person.width, height: 900 },
      ...(person.state ? { storageState: person.state } : {}),
    });
    person.page = await person.context.newPage();
    pages.push(person.page);
    const page = person.page;
    page.on('pageerror', (e) => console.error('PAGE ERROR: ' + e.message));
    page.setDefaultTimeout(30000);
    page.on('dialog', (d) => d.accept());
    active = person;
    if (person.url && person.url !== 'about:blank') await page.goto(person.url);
  }
  async function signIn(email, width = 1280) {
    console.log('RUN sign in ' + email.split('@')[0]);
    const person = { email, width };
    await activate(person);
    const { page } = person;
    await page.goto(base + '/login');
    await page.getByRole('button', { name: 'English', exact: true }).click();
    await page.locator('input[name=email]').fill(email);
    await page.locator('input[name=password]').fill(password);
    const login = page.waitForResponse(
      (r) => r.url().endsWith('/api/wasl/auth/login') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    const loginResult = await login;
    assert(loginResult.ok(), 'Login: ' + loginResult.status());
    await page.waitForURL((url) => !url.pathname.startsWith('/login'));
    await page.getByRole('heading', { level: 1 }).waitFor();
    const me = await page.evaluate(async () => {
      const response = await fetch('/api/wasl/me');
      return { status: response.status, email: (await response.json()).email };
    });
    assert.equal(me.status, 200);
    assert.equal(me.email, email);
    return person;
  }
  async function save(page, fields) {
    for (const [key, val] of Object.entries(fields)) {
      const locator = page.locator(`[name="${key}"]`);
      if (await locator.evaluate((el) => el.tagName === 'SELECT')) await locator.selectOption(val);
      else await locator.fill(String(val));
    }
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForURL(
      (url) => !url.pathname.endsWith('/new') && !url.pathname.endsWith('/edit'),
    );
  }
  const teacher = await signIn('teacher1@wasl.test');
  const student = await signIn('student1@wasl.test', 390);
  const parent = await signIn('parent@wasl.test');
  const admin = await signIn('admin1@wasl.test');
  const platform = await signIn('platform@wasl.test');
  console.log('PASS real login and role routing for five roles');
  await activate(student);
  await student.page.getByRole('button', { name: 'عربي', exact: true }).click();
  await student.page.locator('html[lang="ar"][dir="rtl"]').waitFor({ state: 'attached' });
  await student.page.getByRole('button', { name: 'English', exact: true }).click();
  await student.page.locator('html[lang="en"][dir="ltr"]').waitFor({ state: 'attached' });
  await student.page
    .getByRole('combobox', { name: 'Navigate', exact: true })
    .selectOption('lessons');
  await student.page.waitForURL('**/student/lessons');
  await student.page.getByText('Introduction', { exact: true }).waitFor();
  console.log('PASS responsive web navigation at phone width');
  await activate(teacher);
  const cookies = await teacher.context.cookies();
  const teacherSlot = cookies.find(c => c.name === 'wasl-session-slot')?.value;
  assert.ok(teacherSlot);
  for (const name of ['wasl.access.' + teacherSlot, 'wasl.refresh.' + teacherSlot, 'wasl-session-slot']) {
    const cookie = cookies.find((c) => c.name === name);
    assert(cookie?.httpOnly);
    assert.equal(cookie.sameSite, 'Lax');
    if (production) assert.equal(cookie.secure, true, `${name} must be Secure in production`);
  }
  const csrf = await teacher.context.request.post(base + '/api/wasl/auth/switch-school', {
    headers: {
      Origin: 'https://outside.example',
      Cookie: cookies.filter((c) => c.name.startsWith('wasl.')).map((c) => `${c.name}=${c.value}`).join('; '),
    },
    data: { schoolId: id(1), role: 'TEACHER' },
  });
  assert.equal(csrf.status(), 403);
  const loginCheck = await teacher.page.evaluate(async (password) => {
    const response = await fetch('/api/wasl/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'teacher1@wasl.test', password }),
    });
    const body = await response.json();
    return { status: response.status, hasTokens: 'accessToken' in body || 'refreshToken' in body };
  }, password);
  assert.equal(loginCheck.status, 200);
  assert.equal(loginCheck.hasTokens, false);
  const loginSlot = (await teacher.context.cookies()).find(c => c.name === 'wasl-session-slot')?.value;
  assert.ok(loginSlot);
  await teacher.context.clearCookies({ name: 'wasl.access.' + loginSlot });
  await activate(teacher);
  await teacher.page.goto(base + '/teacher/lessons');
  await teacher.page.getByRole('heading', { name: 'Lessons', exact: true }).waitFor();
  await teacher.page.getByRole('link', { name: 'View', exact: true }).first().waitFor();
  assert((await teacher.context.cookies()).find((c) => c.name === 'wasl.access.' + loginSlot));
  console.log('PASS HttpOnly session cookies, CSRF rejection, token redaction and refresh');
  await teacher.page.evaluate(() =>
    localStorage.setItem('wasl.platform-demo.v1', 'preserve-this-existing-demo-document'),
  );
  await activate(teacher);
  await teacher.page.goto(base + '/teacher/questions/new');
  await save(teacher.page, {
    questionBankId: id(701),
    text: 'Explain the real API integration',
    type: 'ESSAY',
    points: '5',
  });
  const questionId = teacher.page.url().split('/').pop();
  await activate(teacher);
  await teacher.page.goto(base + '/teacher/assessments/new');
  await save(teacher.page, {
    title: 'Connected integration assessment',
    sectionSubjectId: id(405),
    type: 'ASSIGNMENT',
    instructions: 'Answer using the real API.',
  });
  const assessmentId = teacher.page.url().split('/').pop();
  await teacher.page
    .locator('.learning-row')
    .filter({ hasText: 'Explain the real API integration' })
    .getByRole('button', { name: 'Add question', exact: true })
    .click();
  await teacher.page
    .getByRole('button', { name: 'Save assessment questions', exact: true })
    .click();
  await teacher.page.getByRole('button', { name: 'Publish', exact: true }).waitFor();
  await teacher.page.getByRole('button', { name: 'Publish', exact: true }).click();
  await teacher.page.getByText('Open', { exact: true }).waitFor();
  console.log(
    'PASS teacher question creation, assessment authoring, question selection and publication',
  );
  await activate(student);
  await student.page.goto(base + '/student/tasks/' + assessmentId);
  const answer = student.page.locator(`textarea[name="answer-${questionId}"]`);
  await answer.fill('My saved API answer');
  await student.page.getByRole('button', { name: 'Save answer draft', exact: true }).click();
  await student.page.getByText('Saved.', { exact: true }).waitFor();
  await activate(student);
  await student.page.reload();
  // The form appears before the submission request has populated the saved draft.
  await student.page.getByRole('button', { name: 'Save answer draft', exact: true }).waitFor();
  assert.equal(
    await student.page.locator(`textarea[name="answer-${questionId}"]`).inputValue(),
    'My saved API answer',
  );
  await student.page.getByRole('button', { name: 'Submit final', exact: true }).click();
  await student.page.getByText('Your answers were submitted.', { exact: true }).waitFor();
  await student.page.getByRole('link', { name: 'View submission receipt', exact: true }).click();
  await student.page.waitForURL('**/student/submissions/*');
  const submissionId = student.page.url().split('/').pop();
  await student.page.getByText('Result not released yet.', { exact: false }).waitFor();
  console.log('PASS student draft save/resume, final submission and hidden unreleased result');
  await activate(teacher);
  await teacher.page.goto(base + '/teacher/assessments/' + assessmentId);
  await teacher.page.getByRole('button', { name: 'Close', exact: true }).click();
  await teacher.page.getByText('Closed', { exact: true }).waitFor();
  await activate(teacher);
  await teacher.page.goto(base + '/teacher/submissions/' + submissionId);
  await teacher.page.locator(`input[name="score-${questionId}"]`).fill('4');
  await teacher.page
    .getByLabel('Feedback for the student')
    .fill('Reviewed through the connected UI.');
  await teacher.page.getByRole('button', { name: 'Save grading', exact: true }).click();
  await teacher.page.getByText('Saved.', { exact: true }).waitFor();
  await activate(student);
  await student.page.reload();
  await student.page.getByText('Result not released yet.', { exact: false }).waitFor();
  await activate(teacher);
  await teacher.page.goto(base + '/teacher/assessments/' + assessmentId);
  await teacher.page.getByRole('button', { name: 'Release results', exact: true }).click();
  await teacher.page.getByText('Results released', { exact: true }).waitFor();
  await activate(student);
  await student.page.goto(base + '/student/results');
  await student.page
    .locator('tr')
    .filter({ hasText: 'Connected integration assessment' })
    .waitFor();
  await activate(parent);
  await parent.page.bringToFront();
  await activate(parent);
  await parent.page.goto(base + `/parent/results?child=${id(112)}&school=${id(1)}`);
  await parent.page.locator('tr').filter({ hasText: 'Connected integration assessment' }).waitFor();
  console.log('PASS teacher grading and explicit result release to student and verified parent');
  await parent.page.goto(base + `/parent/lessons?child=${id(122)}&school=${id(2)}`);
  await parent.page.getByText('Introduction', { exact: true }).waitFor();
  assert.equal(await parent.page.getByText('Teacher draft', { exact: true }).count(), 0);
  console.log('PASS verified parent learning across schools and draft exclusion');
  await activate(teacher);
  await teacher.page.goto(base + '/teacher/resources/new');
  await teacher.page.locator('[name=title]').fill('Connected worksheet');
  await teacher.page.locator('[name=lessonId]').selectOption(id(409));
  await teacher.page.locator('[name=type]').selectOption('FILE');
  await teacher.page
    .locator('input[type=file]')
    .setInputFiles({ name: 'worksheet.pdf', mimeType: 'application/pdf', buffer: testPdf });
  await teacher.page.getByRole('button', { name: 'Save', exact: true }).click();
  await teacher.page.waitForURL((url) => !url.pathname.endsWith('/new'));
  const resourceId = teacher.page.url().split('/').pop();
  await activate(teacher);
  await teacher.page.goto(base + '/teacher/lessons/' + id(409));
  await teacher.page.getByRole('button', { name: 'Publish', exact: true }).click();
  await teacher.page.getByText('Published', { exact: true }).waitFor();
  await activate(student);
  await student.page.goto(base + '/student/resources/' + resourceId);
  const downloaded = student.page.waitForEvent('download');
  const downloadResponse = student.page.waitForResponse(
    (response) => /\/api\/wasl\/files\/[^/]+\/content$/.test(response.url()),
  );
  await student.page.getByRole('button', { name: 'Download file', exact: true }).click();
  const headers = (await downloadResponse).headers();
  assert.equal(headers['cache-control'], 'private, no-store');
  assert.equal(headers['x-content-type-options'], 'nosniff');
  assert.match(headers['content-disposition'], /^attachment;/i);
  const download = await downloaded;
  const file = await download.path();
  assert.deepEqual(await require('node:fs/promises').readFile(file), testPdf);
  console.log('PASS multipart lesson upload, publication and authorized binary download');
  await activate(teacher);
  await teacher.page.goto(base + '/teacher/announcements/new');
  await save(teacher.page, {
    title: 'Connected class announcement',
    body: 'Real published content',
    sectionSubjectId: id(405),
  });
  await teacher.page.getByRole('button', { name: 'Publish', exact: true }).click();
  await teacher.page.getByText('Published', { exact: true }).waitFor();
  await activate(student);
  await student.page.goto(base + '/student/announcements');
  await student.page.getByText('Connected class announcement', { exact: true }).waitFor();
  await activate(student);
  await student.page.goto(base + '/student/notifications');
  await student.page.getByRole('button', { name: 'Mark all read', exact: true }).click();
  await student.page.getByText('Saved.', { exact: true }).waitFor();
  console.log('PASS announcement publication and notification read state');
  await activate(admin);
  await admin.page.goto(base + '/school/users/new');
  await save(admin.page, {
    fullName: 'Connected New Student',
    email: 'connected-new@wasl.test',
    password,
    role: 'STUDENT',
  });
  await admin.page.getByText('Connected New Student', { exact: true }).first().waitFor();
  await activate(admin);
  await admin.page.goto(base + '/school/years/new');
  await save(admin.page, {
    name: 'Connected next year',
    startDate: '2027-09-01',
    endDate: '2028-06-30',
  });
  await admin.page.getByText('Connected next year', { exact: true }).first().waitFor();
  await activate(platform);
  await platform.page.goto(base + '/admin/schools/new');
  await save(platform.page, { name: 'Connected school', nameAr: 'مدرسة متصلة', locale: 'ar' });
  await platform.page.getByRole('heading', { name: 'Connected school', exact: true }).waitFor();
  console.log('PASS school account/academic creation and platform school management');
  await activate(teacher);
  assert.equal(
    await teacher.page.evaluate(() => localStorage.getItem('wasl.platform-demo.v1')),
    'preserve-this-existing-demo-document',
  );
  await activate(student);
  await student.page.route('**/api/wasl/announcements?*', (r) =>
    r.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Unavailable' }),
    }),
  );
  await activate(student);
  await student.page.goto(base + '/student/announcements');
  await student.page
    .getByRole('alert')
    .filter({ hasText: 'Could not reach the service. Please retry.' })
    .waitFor();
  assert.equal(
    await student.page.getByText('Connected class announcement', { exact: true }).count(),
    0,
  );
  await student.page.waitForLoadState('networkidle');
  await student.page.getByRole('button', { name: 'Retry', exact: true }).waitFor();
  await student.page.unroute('**/api/wasl/announcements?*');
  await student.page.getByRole('button', { name: 'Retry', exact: true }).click();
  await student.page.getByText('Connected class announcement', { exact: true }).waitFor();
  await activate(teacher);
  await teacher.page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await teacher.page.waitForURL('**/login');
  assert(!(await teacher.context.cookies()).some((c) => c.name.startsWith('wasl.')));
  console.log(
    'PASS retry without fixture fallback, preservation of demo data, logout and session clearing',
  );
  await activate(parent);
  const browserJson = (page, route, data) => page.evaluate(async ({ route, data }) => {
    const response = await fetch('/api/wasl/' + route, data === undefined ? undefined : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
    });
    return { status: response.status, body: await response.json() };
  }, { route, data });
  const beforeSwitch = await browserJson(parent.page, 'me');
  assert.equal(beforeSwitch.status, 200);
  const { activeSchoolId } = beforeSwitch.body;
  const parentCookies = await parent.context.cookies();
  const parentSlot = parentCookies.find(cookie => cookie.name === 'wasl-session-slot')?.value;
  assert.ok(parentSlot);
  const original = parentCookies.find(cookie => cookie.name === 'wasl.refresh.' + parentSlot);
  assert.ok(original);
  const targetSchool = activeSchoolId === id(1) ? id(2) : id(1);
  const switched = await browserJson(parent.page, 'auth/switch-school', { schoolId: targetSchool, role: 'PARENT' });
  assert.equal(switched.status, 200);
  assert.deepEqual(switched.body, { ok: true });
  const afterSwitch = await browserJson(parent.page, 'me');
  assert.equal(afterSwitch.status, 200);
  assert.equal(afterSwitch.body.activeSchoolId, targetSchool);
  const signedOut = await browserJson(parent.page, 'auth/logout', {});
  assert.equal(signedOut.status, 200);
  assert(!(await parent.context.cookies()).some(cookie => cookie.name.startsWith('wasl.')));
  const oldSession = await fetch(upstream + '/auth/refresh', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: original.value }),
  });
  assert.equal(oldSession.status, 401);
  console.log('PASS web school switch and logout revoke the original server session');
  if (production) {
    const secondPort = await port();
    const secondBase = `http://127.0.0.1:${secondPort}`;
    const bootSecond = () => start(
      path.join(root, 'node_modules/next/dist/bin/next'),
      ['start', '-H', '127.0.0.1', '-p', String(secondPort)],
      path.join(root, 'apps/web'),
      { NODE_ENV: 'production', WASL_API_URL: upstream, WASL_WEB_ORIGIN: secondBase,
        WASL_WEB_SESSION_MODE: 'single-instance', NEXT_TELEMETRY_DISABLED: '1' },
    );
    const cookieHeader = cookies => cookies.map(c => `${c.name}=${c.value}`).join('; ');
    const credentials = { email: 'parent@wasl.test', password };
    const primaryLogin = await browserJson(parent.page, 'auth/login', credentials);
    assert.equal(primaryLogin.status, 200);
    const primaryCookie = cookieHeader(await parent.context.cookies());
    const second = bootSecond();
    await ready(secondBase + '/login');
    const me = (url, cookie) => fetch(url + '/api/wasl/me', { headers: { Cookie: cookie } });
    assert.equal((await me(secondBase, primaryCookie)).status, 401);
    assert.equal((await me(base, primaryCookie)).status, 200);
    const secondaryContext = await parent.instance.newContext();
    const secondaryPage = await secondaryContext.newPage();
    await secondaryPage.goto(secondBase + '/login');
    const secondaryLogin = await browserJson(secondaryPage, 'auth/login', credentials);
    assert.equal(secondaryLogin.status, 200);
    const secondaryCookie = cookieHeader(await secondaryContext.cookies());
    await secondaryContext.close();
    assert.equal((await me(secondBase, secondaryCookie)).status, 200);
    const stopped = new Promise(resolve => second.once('exit', resolve));
    second.kill('SIGTERM');
    await stopped;
    bootSecond();
    await ready(secondBase + '/login');
    assert.equal((await me(secondBase, secondaryCookie)).status, 401);
    console.log('PASS isolated production instances and restart reject sessions from a different process');
  }
  const out = process.env.WASL_TEST_ARTIFACTS;
  if (out) {
    await activate(student);
    await mkdir(out, { recursive: true });
    await student.page.screenshot({
      path: path.join(out, 'student-connected.png'),
      fullPage: true,
    });
  }
  await pause();
}
main()
  .catch(async (error) => {
    for (const p of pages.filter((p) => !p.isClosed()))
      console.error(
        'PAGE ' +
          p.url() +
          ' ' +
          (
            await p
              .locator('body')
              .innerText()
              .catch(() => '')
          ).slice(0, 1600),
      );
    console.error(String(error.stack || error).replaceAll(password, '[test-password]'));
    console.error(logs.replaceAll(password, '[test-password]').slice(-6500));
    process.exitCode = 1;
  })
  .finally(async () => {
    for (const b of browsers) await b.close();
    for (const p of processes) p.kill('SIGTERM');
    if (temporary) await rm(temporary, { recursive: true, force: true });
  });
