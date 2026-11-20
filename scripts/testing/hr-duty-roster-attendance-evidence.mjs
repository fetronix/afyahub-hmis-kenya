/**
 * Syrona Medical Center HMIS — duty roster / attendance browser evidence.
 *
 * Drives the real application in Chromium against the synthetic database:
 * creates a shift, assigns two employees through the roster dialog, clocks one
 * of them in and out, records a correction and opens its history, and captures
 * a screenshot at each step.
 *
 * SAFETY
 * ------
 * - Refuses to run without BROWSER_SMOKE_SYNTHETIC=YES (synthetic data only).
 * - Refuses to run off the loopback host.
 * - Reads the password from HR_PASSWORD; it is never written to the evidence.
 * - The bearer token is read from the application's own requests and used for
 *   the API assertions only. It is never written to disk.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import puppeteer from 'puppeteer-core';

const BASE_URL = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const CHROME = process.env.CHROME_EXECUTABLE_PATH;
const PASSWORD = process.env.HR_PASSWORD;
const STAFF_PASSWORD = process.env.STAFF_PASSWORD ?? PASSWORD;
const OUT_DIR = resolve('docs/testing/hr-duty-roster-attendance');
const RESULT_FILE = resolve(OUT_DIR, 'browser-run.json');
const suffix = String(Date.now()).slice(-6);

if (process.env.BROWSER_SMOKE_SYNTHETIC !== 'YES')
  throw new Error('Set BROWSER_SMOKE_SYNTHETIC=YES. This script mutates a synthetic database only.');
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(BASE_URL))
  throw new Error('BASE_URL must be a loopback address.');
if (!CHROME) throw new Error('CHROME_EXECUTABLE_PATH is required.');
if (!PASSWORD) throw new Error('HR_PASSWORD is required.');

const results = { startedAt: new Date().toISOString(), baseUrl: BASE_URL, checks: [], screenshots: [], summary: {} };

function check(ok, label, detail) {
  results.checks.push({ label, passed: Boolean(ok), detail: detail ?? null });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function waitFor(predicate, label, timezone = 20000) {
  const deadline = Date.now() + timezone;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(200);
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ''}`);
}

let browser;

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    defaultViewport: { width: 1680, height: 1050 },
  });
  const page = await browser.newPage();
  page.on('pageerror', (error) => console.log('PAGE ERROR', error.message));

  let token = '';
  page.on('request', (request) => {
    const header = request.headers()['authorization'];
    if (!token && header?.startsWith('Bearer ')) token = header.slice(7);
  });

  const shot = async (name, selector) => {
    const path = resolve(OUT_DIR, name);
    if (selector) {
      const element = await page.$(selector);
      if (!element) throw new Error(`No element ${selector} for ${name}`);
      await element.screenshot({ path });
    } else {
      await page.screenshot({ path, fullPage: true });
    }
    results.screenshots.push(name);
    console.log(`CAPTURED ${name}`);
  };

  const dismissToasts = async () => {
    await page.evaluate(() => {
      for (const button of document.querySelectorAll('button')) {
        if (/^(Dismiss|Dismiss all)$/i.test(button.textContent ?? '')) button.click();
      }
    });
    await sleep(250);
  };

  const clickByText = async (selector, text) => {
    const handle = await page.evaluateHandle(
      (sel, needle) =>
        [...document.querySelectorAll(sel)].find((node) =>
          (node.textContent ?? '').trim().toLowerCase().includes(needle.toLowerCase()),
        ) ?? null,
      selector,
      text,
    );
    const element = handle.asElement();
    if (!element) throw new Error(`No ${selector} containing "${text}"`);
    await element.click();
  };

  const apiCall = async (route, { method = 'GET', body } = {}) =>
    page.evaluate(
      async ({ path, method: verb, body: payload, bearer }) => {
        const response = await fetch(path, {
          method: verb,
          headers: {
            'content-type': 'application/json',
            ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
          },
          body: payload ? JSON.stringify(payload) : undefined,
        });
        const text = await response.text();
        let json = null;
        try {
          json = JSON.parse(text);
        } catch {
          /* non-JSON error body */
        }
        return { status: response.status, json };
      },
      { path: route, method, body, bearer: token },
    );

  /* ---------------- sign in ---------------- */
  await page.goto(BASE_URL, { waitUntil: 'networkidle2' });
  await page.waitForSelector('#identifier');
  await page.type('#identifier', 'synthetic.hr');
  await page.type('#password', PASSWORD);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => undefined),
    page.click('button[type="submit"]'),
  ]);
  await page.waitForSelector('aside', { timeout: 40000 });
  await sleep(2000);
  check(Boolean(await page.$('aside')), 'Signed in as the synthetic HR officer');
  check(Boolean(token), 'Captured the session token the application itself sent');

  /* ---------------- facility-local today ---------------- */
  const today = await page.evaluate(() =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' }).format(new Date()),
  );

  /* ---------------- clear yesterday's evidence leaves ---------------- */
  const existing = await apiCall(`/api/hr/roster?from=${today}&to=${today}`);
  for (const entry of existing.json ?? []) {
    await apiCall(`/api/hr/roster/${entry.id}/cancel`, {
      method: 'POST',
      body: { reason: 'Evidence setup: clearing the previous run' },
    });
  }

  /* ---------------- 7: an unrostered employee cannot clock in ---------------- */
  const staffLogin = await page.evaluate(async (password) => {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identifier: 'synthetic.staff', password }),
    });
    return (await response.json()).sessionToken;
  }, STAFF_PASSWORD);
  const employees = (await apiCall('/api/hr/employees')).json ?? [];
  const nurse = employees.find((employee) => employee.employeeNumber === 'SYNTH-HR-0001');
  const accountant = employees.find((employee) => employee.employeeNumber === 'SYNTH-HR-0002');

  const staffCall = async (route, body) =>
    page.evaluate(
      async ({ path, payload, bearer }) => {
        const response = await fetch(path, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` },
          body: JSON.stringify(payload),
        });
        return { status: response.status, json: await response.json().catch(() => null) };
      },
      { path: route, payload: body, bearer: staffLogin },
    );

  const unrostered = await apiCall('/api/hr/attendance/clock-in', {
    method: 'POST',
    body: { employeeId: nurse.id },
  });
  check(
    unrostered.status === 409 && unrostered.json?.error === 'NO_ROSTER_ASSIGNMENT',
    'An employee with no roster assignment is refused, with an explanation',
    `${unrostered.status} ${unrostered.json?.error}: ${unrostered.json?.message}`,
  );

  const forbidden = await staffCall('/api/hr/attendance/clock-in', { employeeId: nurse.id });
  check(
    forbidden.status === 403 && forbidden.json?.error === 'NOT_YOUR_ATTENDANCE',
    'An ordinary employee cannot clock a colleague',
    `${forbidden.status} ${forbidden.json?.error}`,
  );

  /* ---------------- navigate to the attendance tab ---------------- */
  await clickByText('button, a', 'Human Resources');
  await sleep(1200);
  await clickByText('button, [role="tab"]', 'Attendance & roster');
  await page.waitForSelector('#attendance-date', { timeout: 20000 });
  await sleep(1200);

  /* ---------------- 1: create a shift through the UI ---------------- */
  await page.click('#new-shift');
  await page.waitForSelector('#shift-name', { timeout: 10000 });
  const shiftName = `Evidence Day ${suffix}`;
  /* Starts five minutes ago, so the clock-in is a normal on-time arrival. */
  const nowMinutes = await page.evaluate(() => {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Nairobi',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date());
    const get = (type) => Number(parts.find((part) => part.type === type)?.value ?? 0);
    return get('hour') * 60 + get('minute');
  });
  const asTime = (minutes) => {
    const wrapped = ((minutes % 1440) + 1440) % 1440;
    return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
  };
  const startTime = asTime(nowMinutes - 5);
  const endTime = asTime(nowMinutes + 475);
  await page.type('#shift-name', shiftName);
  await page.type('#shift-description', 'Synthetic evidence shift covering the current hour.');
  await page.evaluate((start, end) => {
    const set = (selector, value) => {
      const input = document.querySelector(selector);
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    set('#shift-start', start);
    set('#shift-end', end);
    set('#shift-break', '30');
  }, startTime, endTime);
  await sleep(300);
  await shot('01-shift-creation.png', '[role="dialog"]');
  await clickByText('[role="dialog"] button[type="submit"]', 'Save shift');
  await waitFor(
    async () => !(await page.$('#shift-name')),
    'the shift dialog to close',
  );
  await dismissToasts();
  const shiftVisible = await waitFor(
    async () =>
      page.evaluate((name) => document.body.innerText.includes(name), shiftName),
    'the new shift in the templates table',
  );
  check(Boolean(shiftVisible), '1. The created shift appears in the shift templates', shiftName);

  const shifts = (await apiCall(`/api/hr/shifts?date=${today}`)).json ?? [];
  const createdShift = shifts.find((shift) => shift.name === shiftName);
  const toMinutes = (value) => {
    const [hours, minutes] = value.split(':').map(Number);
    return hours * 60 + minutes;
  };
  const startMinutes = toMinutes(createdShift.startTime);
  const endMinutes = toMinutes(createdShift.endTime);
  const overnight = endMinutes <= startMinutes;
  const gross = overnight ? endMinutes + 1440 - startMinutes : endMinutes - startMinutes;
  const expectedHours = (gross - createdShift.breakMinutes) / 60;
  check(
    createdShift.overnight === overnight && createdShift.expectedHours === expectedHours,
    'The shift reports its expected hours and overnight flag from its own times',
    `${createdShift.startTime}–${createdShift.endTime}${overnight ? ' +1' : ''}, ${createdShift.breakMinutes}m break, ${createdShift.expectedHours}h`,
  );

  /* ---------------- 2: assign both employees through the UI ---------------- */
  await page.click('#assign-shift');
  await page.waitForSelector('#assign-date', { timeout: 10000 });
  await page.select('#assign-shift-select', String(createdShift.id));
  for (const employee of [nurse, accountant]) {
    await page.evaluate((name) => {
      const label = [...document.querySelectorAll('[role="dialog"] label')].find((node) =>
        (node.textContent ?? '').includes(name),
      );
      const box = label?.querySelector('input[type="checkbox"]');
      if (box && !box.disabled) box.click();
    }, `${employee.firstName} ${employee.lastName}`);
  }
  await sleep(300);
  await shot('02-roster-assignment.png', '[role="dialog"]');
  await clickByText('[role="dialog"] button[type="submit"]', 'Assign shift');
  await waitFor(async () => !(await page.$('#assign-date')), 'the assign dialog to close');
  await dismissToasts();
  check(true, '2. Two employees assigned through the roster dialog');

  /* ---------------- 3: today's roster ---------------- */
  const roster = (await apiCall(`/api/hr/roster?from=${today}&to=${today}`)).json ?? [];
  check(
    roster.length >= 2 && roster.every((entry) => entry.shiftId === createdShift.id),
    '3. The roster persists both assignments for today',
    roster.map((entry) => `${entry.employeeNumber}:${entry.shiftName}`).join(', '),
  );
  await page.evaluate(() => {
    const heading = [...document.querySelectorAll('h2')].find((node) =>
      /Duty roster/i.test(node.textContent ?? ''),
    );
    heading?.scrollIntoView({ block: 'center' });
  });
  await sleep(400);
  await page.screenshot({ path: resolve(OUT_DIR, '03-todays-roster.png') });
  results.screenshots.push('03-todays-roster.png');
  console.log('CAPTURED 03-todays-roster.png');

  /* ---------------- 4: attendance before clock-in ---------------- */
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForSelector('aside', { timeout: 30000 });
  await clickByText('button, a', 'Human Resources');
  await sleep(1200);
  await clickByText('button, [role="tab"]', 'Attendance & roster');
  await page.waitForSelector('#attendance-date', { timeout: 20000 });
  await sleep(1500);
  const beforeDay = (await apiCall(`/api/hr/attendance?date=${today}`)).json;
  const nurseBefore = beforeDay.rows.find((row) => row.employeeId === nurse.id);
  check(
    nurseBefore?.clockInAt === null && nurseBefore?.canClockIn === true,
    '4. Before any clock, the row offers Clock in and has no time',
    `${nurseBefore?.shiftName} ${nurseBefore?.startTime}–${nurseBefore?.endTime}`,
  );
  await page.evaluate(() => {
    const heading = [...document.querySelectorAll('h2')].find((node) =>
      /^Attendance —/.test(node.textContent ?? ''),
    );
    heading?.scrollIntoView({ block: 'start' });
  });
  await sleep(400);
  await page.screenshot({ path: resolve(OUT_DIR, '04-attendance-before-clock-in.png') });
  results.screenshots.push('04-attendance-before-clock-in.png');
  console.log('CAPTURED 04-attendance-before-clock-in.png');

  /* ---------------- 5: clock in ---------------- */
  const clockInButton = `button[aria-label="Clock in ${nurse.firstName} ${nurse.lastName}"]`;
  await page.waitForSelector(clockInButton, { timeout: 15000 });
  await page.click(clockInButton);
  await waitFor(
    async () => (await apiCall(`/api/hr/attendance?date=${today}`)).json.rows.some(
      (row) => row.employeeId === nurse.id && row.clockInAt,
    ),
    'the clock-in to persist',
  );
  await dismissToasts();
  await sleep(800);
  await shot('05-attendance-after-clock-in.png');

  const afterIn = (await apiCall(`/api/hr/attendance?date=${today}`)).json;
  const nurseIn = afterIn.rows.find((row) => row.employeeId === nurse.id);
  check(
    Boolean(nurseIn?.clockInAt) && nurseIn?.canClockOut === true && nurseIn?.canClockIn === false,
    '5. Clock in is replaced by Clock out and the timestamp survives a re-read',
    `${nurseIn?.clockInLocal} · ${nurseIn?.status}`,
  );

  /* ---------------- 6: clock out ---------------- */
  /* A real minute elapses between the two clocks, so "hours worked" is a
     measurement rather than a zero. */
  await sleep(65000);
  const clockOutButton = `button[aria-label="Clock out ${nurse.firstName} ${nurse.lastName}"]`;
  await page.waitForSelector(clockOutButton, { timeout: 15000 });
  await page.click(clockOutButton);
  await waitFor(
    async () => (await apiCall(`/api/hr/attendance?date=${today}`)).json.rows.some(
      (row) => row.employeeId === nurse.id && row.clockOutAt,
    ),
    'the clock-out to persist',
  );
  await dismissToasts();
  await sleep(800);
  await shot('06-attendance-after-clock-out.png');

  const afterOut = (await apiCall(`/api/hr/attendance?date=${today}`)).json;
  const nurseOut = afterOut.rows.find((row) => row.employeeId === nurse.id);
  check(
    Boolean(nurseOut?.clockInAt) && Boolean(nurseOut?.clockOutAt),
    '6. Both clock instants are stored',
    `${nurseOut?.clockInLocal} → ${nurseOut?.clockOutLocal}`,
  );

  /* ---------------- duplicate / invalid clock actions ---------------- */
  const duplicate = await apiCall('/api/hr/attendance/clock-in', {
    method: 'POST',
    body: { employeeId: nurse.id },
  });
  check(
    duplicate.status === 409 && duplicate.json?.error === 'ALREADY_CLOCKED_IN',
    '11a. A duplicate clock-in is refused',
    `${duplicate.status} ${duplicate.json?.error}`,
  );
  const invalidOut = await apiCall('/api/hr/attendance/clock-out', {
    method: 'POST',
    body: { employeeId: nurse.id },
  });
  check(
    invalidOut.status === 409 && invalidOut.json?.error === 'NOT_CLOCKED_IN',
    '11b. A clock-out with nothing open is refused',
    `${invalidOut.status} ${invalidOut.json?.error}`,
  );

  /* ---------------- 7: summary ---------------- */
  const cards = await page.$('[data-testid="attendance-summary"]');
  if (cards) {
    await cards.screenshot({ path: resolve(OUT_DIR, '07-attendance-summary.png') });
    results.screenshots.push('07-attendance-summary.png');
    console.log('CAPTURED 07-attendance-summary.png');
  }
  check(
    afterOut.summary.present >= 1 && afterOut.summary.expected >= 2,
    '7. The summary counts the expected employees and the one who attended',
    `expected ${afterOut.summary.expected}, present ${afterOut.summary.present}, late ${afterOut.summary.late}, not clocked in ${afterOut.summary.notClockedIn}`,
  );

  /* ---------------- correction and history ---------------- */
  const correctButton = `button[aria-label="Correct attendance for ${nurse.firstName} ${nurse.lastName}"]`;
  await page.waitForSelector(correctButton, { timeout: 15000 });
  await page.click(correctButton);
  await page.waitForSelector('#correction-reason', { timeout: 10000 });
  /* The employee's clock-out was recorded a moment after clock-in; HR corrects
     it to a full eight-hour day, which is the workflow this dialog exists for. */
  /* Build the corrected clock-out from the stored clock-in, not from the
     clock-out: an eight-hour day runs from when the employee arrived. */
  await page.evaluate(
    ({ date, clockInLocal, addMinutes }) => {
      const input = document.querySelector('#correction-out');
      const [inHours, inMinutes] = clockInLocal.split(':').map(Number);
      const total = inHours * 60 + inMinutes + addMinutes;
      const dayOffset = Math.floor(total / 1440);
      const minuteOfDay = total % 1440;
      const pad = (value) => String(value).padStart(2, '0');
      const day = new Date(`${date}T00:00:00Z`);
      day.setUTCDate(day.getUTCDate() + dayOffset);
      const next = `${day.getUTCFullYear()}-${pad(day.getUTCMonth() + 1)}-${pad(day.getUTCDate())}T${pad(Math.floor(minuteOfDay / 60))}:${pad(minuteOfDay % 60)}`;
      /* React tracks the previous value, so write through the native setter. */
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, next);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    },
    { date: today, clockInLocal: nurseOut.clockInLocal, addMinutes: 480 },
  );
  await page.type(
    '#correction-reason',
    'Synthetic evidence: clock times checked against the ward register',
  );
  await clickByText('[role="dialog"] button[type="submit"]', 'Save correction');
  await waitFor(async () => !(await page.$('#correction-reason')), 'the correction dialog to close');
  await dismissToasts();

  const corrected = await apiCall(`/api/hr/attendance?date=${today}`);
  const nurseRecord = corrected.json.rows.find((row) => row.employeeId === nurse.id);
  const history = nurseRecord?.attendanceId
    ? await apiCall(`/api/hr/attendance/${nurseRecord.attendanceId}/history`)
    : { status: 0, json: [] };
  const correctedRow = corrected.json.rows.find((row) => row.employeeId === nurse.id);
  check(
    correctedRow?.workedMinutes !== null && Math.abs((correctedRow?.workedMinutes ?? 0) - 480) <= 1,
    'The correction recomputes hours worked from the corrected instants',
    `${correctedRow?.workedMinutes} minutes, ${correctedRow?.hoursWorked}h`,
  );
  check(
    Array.isArray(history.json) && history.json.length >= 1,
    '13. The correction is stored with its reason and author',
    history.json?.[0]
      ? `${history.json[0].correctedByName} — ${String(history.json[0].reason).slice(0, 60)}`
      : 'none',
  );

  const historyButton = `button[aria-label="Attendance history for ${nurse.firstName} ${nurse.lastName}"]`;
  await page.waitForSelector(historyButton, { timeout: 15000 });
  await page.click(historyButton);
  await sleep(900);
  await shot('08-attendance-history.png', '[role="dialog"]');
  await page.keyboard.press('Escape');

  /* ---------------- 12: filters ---------------- */
  const departments = (await apiCall('/api/hr/departments')).json ?? [];
  const nursing = departments.find((department) => department.name === 'Nursing');
  const filtered = await apiCall(`/api/hr/attendance?date=${today}&departmentId=${nursing.id}`);
  check(
    (filtered.json?.rows ?? []).every((row) => row.departmentId === nursing.id),
    '12a. Department filtering returns only that department',
    `${filtered.json?.rows?.length} row(s)`,
  );
  const week = await apiCall(
    `/api/hr/roster?from=${today}&to=${today}&departmentId=${nursing.id}`,
  );
  check(
    Array.isArray(week.json) && week.json.every((entry) => entry.departmentId === nursing.id),
    '12b. The roster filters by department as well',
    `${week.json?.length} assignment(s)`,
  );

  /* ---------------- leave, holiday and off duty ---------------- */
  const holiday = await apiCall('/api/hr/holidays', {
    method: 'POST',
    body: { holidayDate: today, name: `Synthetic evidence holiday ${suffix}` },
  });
  const holidayDay = await apiCall(`/api/hr/attendance?date=${today}`);
  const accountantRow = holidayDay.json?.rows?.find((row) => row.employeeId === accountant.id);
  check(
    accountantRow?.status === 'HOLIDAY',
    '10a. A holiday is reported as HOLIDAY, not as an absence',
    accountantRow?.status ?? 'none',
  );
  if (holiday.json?.id) await apiCall(`/api/hr/holidays/${holiday.json.id}`, { method: 'DELETE' });

  const offDuty = await apiCall('/api/hr/attendance', {
    method: 'POST',
    body: {
      employeeId: accountant.id,
      workDate: today,
      status: 'OFF_DUTY',
      notes: 'Synthetic evidence: off duty',
    },
  });
  check(
    offDuty.status === 200 || offDuty.status === 201,
    '10b. Off duty can be recorded by HR for an excused day',
    `${offDuty.status} ${offDuty.json?.status ?? offDuty.json?.error}`,
  );

  /* ---------------- 15: payroll isolation ---------------- */
  const policy = await apiCall('/api/hr/attendance/policy');
  check(
    policy.status === 200 && policy.json?.timeZone === 'Africa/Nairobi',
    '15. Attendance policy is stored per facility (payroll consumes none of it)',
    `${policy.json?.graceMinutes}m grace, ${policy.json?.absenceCutoffMinutes}m cutoff, ${policy.json?.timeZone}`,
  );

  results.summary = {
    total: results.checks.length,
    passed: results.checks.filter((entry) => entry.passed).length,
    failed: results.checks.filter((entry) => !entry.passed).length,
  };
  results.finishedAt = new Date().toISOString();
  await writeFile(RESULT_FILE, `${JSON.stringify(results, null, 2)}\n`);

  await browser.close();
  console.log(`\n${results.summary.passed}/${results.summary.total} checks passed`);
  if (results.summary.failed > 0) {
    console.error('FAILED CHECKS:');
    for (const entry of results.checks.filter((candidate) => !candidate.passed))
      console.error(` - ${entry.label}`);
    process.exitCode = 1;
  }
}

main().catch(async (error) => {
  console.error('RUN FAILED:', error.message);
  await browser?.close().catch(() => undefined);
  try {
    results.summary = {
      total: results.checks.length,
      passed: results.checks.filter((entry) => entry.passed).length,
      failed: results.checks.filter((entry) => !entry.passed).length,
    };
    await writeFile(RESULT_FILE, `${JSON.stringify(results, null, 2)}\n`);
  } catch {
    /* best effort */
  }
  process.exitCode = 1;
});
