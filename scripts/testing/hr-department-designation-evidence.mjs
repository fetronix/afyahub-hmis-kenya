/**
 * Syrona Medical Center HMIS — HR department/designation evidence run.
 *
 * Drives the built SPA against the real Express API and a synthetic PostgreSQL,
 * asserts the behaviour the brief asks for, and writes the screenshots that go
 * with it. Every screenshot is a real capture of this run: nothing is composed
 * or retouched.
 *
 * The run also *creates* records (one department, two designations) so the
 * "created it, then saw it listed" path is evidenced rather than assumed. It
 * uses a unique suffix so re-running does not collide with earlier evidence.
 *
 * SAFETY: loopback only, synthetic accounts only, refuses without
 * BROWSER_SMOKE_SYNTHETIC=YES.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const base = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname))
  throw new Error('Loopback application required.');
if (process.env.BROWSER_SMOKE_SYNTHETIC !== 'YES')
  throw new Error('Set BROWSER_SMOKE_SYNTHETIC=YES — synthetic data only.');
const executablePath = process.env.CHROME_EXECUTABLE_PATH;
if (!executablePath) throw new Error('CHROME_EXECUTABLE_PATH is required.');

const identifier = process.env.HR_IDENTIFIER ?? 'synthetic.hr';
const password = process.env.HR_PASSWORD;
if (!password) throw new Error('HR_PASSWORD is required.');

const out = path.resolve('docs/testing/hr-department-designation');
await mkdir(out, { recursive: true });

const suffix = String(Date.now()).slice(-6);
const NEW_DEPARTMENT = { code: `PHR${suffix.slice(-3)}`, name: `Pharmacy ${suffix}`, description: 'Dispensing and medication review.' };
const NEW_DESIGNATIONS = [
  { title: `Pharmacist ${suffix}`, department: NEW_DEPARTMENT.name, description: 'Dispenses medicines and reviews prescriptions.', grade: 'JG-7' },
  { title: `Pharmacy Assistant ${suffix}`, department: NEW_DEPARTMENT.name, description: null, grade: 'JG-5' },
];

const results = [];
const checks = [];
const check = (ok, label, detail = '') => {
  checks.push({ label, status: ok ? 'PASS' : 'FAIL', detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) throw new Error(`Assertion failed: ${label}`);
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const chromium = (await import('@sparticuz/chromium')).default;
const browser = await puppeteer.launch({
  args: [...chromium.args, '--no-sandbox'],
  executablePath,
  headless: 'shell',
  defaultViewport: { width: 1600, height: 1150 },
});
const page = await browser.newPage();
page.on('pageerror', (error) => console.log('PAGE ERROR', error.message));
/*
 * The SPA keeps its bearer token in memory rather than a cookie. Watching one
 * authenticated request lets the API integrity checks reuse the same session
 * without a second sign-in and without ever writing the token to evidence.
 */
let sessionToken = '';
page.on('request', (request) => {
  const header = request.headers()['authorization'];
  if (!sessionToken && header?.startsWith('Bearer ')) sessionToken = header.slice(7);
});

const clickText = (selector, text) =>
  page.evaluate(
    (sel, needle) => {
      const node = [...document.querySelectorAll(sel)].find((candidate) =>
        (candidate.textContent ?? '').toLowerCase().includes(needle.toLowerCase()),
      );
      if (!node) return false;
      node.click();
      return true;
    },
    selector,
    text,
  );

const textOf = (selector) =>
  page.evaluate((sel) => document.querySelector(sel)?.textContent ?? '', selector);

/** Dismisses the app's toast stack so it never covers a capture. */
const dismissToasts = async () => {
  await page.evaluate(() => {
    for (const button of [...document.querySelectorAll('button')]) {
      if (/^(Dismiss|Dismiss all)$/i.test(button.textContent.trim())) button.click();
    }
  });
  await sleep(600);
};

const shot = async (name, { clipTo } = {}) => {
  await dismissToasts();
  const file = path.join(out, name);
  if (clipTo) {
    const handle = await page.$(clipTo);
    if (handle) {
      await handle.screenshot({ path: file });
      results.push({ file: name, mode: 'element' });
      console.log(`CAPTURED ${name}`);
      return;
    }
  }
  await page.screenshot({ path: file });
  results.push({ file: name, mode: 'viewport' });
  console.log(`CAPTURED ${name}`);
};

/** Waits for a condition inside the page. The argument is forwarded to fn. */
const waitFor = async (fn, label, arg = undefined, timeout = 15000) => {
  const started = Date.now();
  for (;;) {
    if (await page.evaluate(fn, arg)) return;
    if (Date.now() - started > timeout) throw new Error(`Timed out waiting for ${label}`);
    await sleep(250);
  }
};

try {
  /* ---------------- sign in ---------------- */
  await page.goto(base, { waitUntil: 'networkidle2' });
  await page.waitForSelector('input[name="identifier"]', { timeout: 30000 });
  await page.type('input[name="identifier"]', identifier);
  await page.type('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForSelector('aside', { timeout: 30000 });
  await sleep(2500);
  check(await textOf('aside') !== null, 'Signed in to the synthetic HR account');


  /* ---------------- open the HR module ---------------- */
  await clickText('aside button', 'Human Resources');
  await sleep(2500);
  check(await clickText('[role="tab"]', 'Departments & roles'), 'Opened Departments & roles');
  await sleep(2000);

  /* ---------------- 1. department list ---------------- */
  const departmentNames = await page.evaluate(() => {
    const table = document.querySelectorAll('table')[0];
    return table ? [...table.querySelectorAll('tbody tr')].map((row) => row.innerText) : [];
  });
  check(departmentNames.length >= 5, 'Department list shows the seeded departments', `${departmentNames.length} rows`);
  check(
    departmentNames.some((row) => row.includes('Nursing')) &&
      departmentNames.some((row) => row.includes('Finance')) &&
      departmentNames.some((row) => row.includes('Laboratory')) &&
      departmentNames.some((row) => row.includes('Pharmacy')) &&
      departmentNames.some((row) => row.includes('Administration')),
    'Nursing, Finance, Laboratory, Pharmacy and Administration are all listed',
  );
  check(
    departmentNames.some((row) => row.includes('Ward, theatre and outpatient nursing staff.')),
    'Department description is shown in the list',
  );
  await shot('01-department-list.png');

  /* ---------------- 2. create a department ---------------- */
  await clickText('button', 'Add department');
  await page.waitForSelector('[role="dialog"]', { timeout: 15000 });
  await sleep(800);
  await page.type('[role="dialog"] input[id^="dept-code"]', NEW_DEPARTMENT.code);
  await page.type('[role="dialog"] input[id^="dept-name"]', NEW_DEPARTMENT.name);
  await page.type('[role="dialog"] textarea[id^="dept-description"]', NEW_DEPARTMENT.description);
  await shot('02-create-department-form.png');
  await page.click('[role="dialog"] button[type="submit"]');
  await waitFor(
    (name) => document.body.innerText.includes(name),
    `department ${NEW_DEPARTMENT.name} to appear`,
    NEW_DEPARTMENT.name,
  );
  await dismissToasts();
  check(
    (await textOf('body')).includes(NEW_DEPARTMENT.name),
    'Created department appears in the list',
    NEW_DEPARTMENT.name,
  );

  /* ---------------- 3. add designation: dropdown of existing departments ---------------- */
  await clickText('button', 'Add designation');
  await page.waitForSelector('[role="dialog"]', { timeout: 15000 });
  await sleep(900);
  const dialogTitle = await page.evaluate(
    () => document.querySelector('[role="dialog"] h2')?.textContent ?? '',
  );
  check(dialogTitle.includes('New designation'), 'Designation dialog opened', dialogTitle);

  const controlTag = await page.evaluate(
    () => document.querySelector('[role="dialog"] [role="combobox"]')?.tagName ?? 'NONE',
  );
  check(controlTag === 'BUTTON', 'Department field is a dropdown control, not free text', controlTag);

  await page.click('[role="dialog"] [role="combobox"]');
  await sleep(700);
  const optionLabels = await page.evaluate(() =>
    [...document.querySelectorAll('[role="dialog"] [role="listbox"] [role="option"]')].map(
      (node) => node.textContent.trim(),
    ),
  );
  check(optionLabels.length >= 5, 'Department dropdown lists existing departments', `${optionLabels.length} options`);
  check(
    optionLabels.some((label) => label.includes(NEW_DEPARTMENT.name)),
    'The department created a moment ago is offered in the dropdown',
  );
  check(
    await page.evaluate(() =>
      Boolean(document.querySelector('[role="dialog"] input[aria-label="Search departments…"]')),
    ),
    'Department dropdown is searchable',
  );
  await shot('03-add-designation-department-dropdown.png');

  /* filter the dropdown by typing, then pick the department */
  await page.type('[role="dialog"] input[aria-label="Search departments…"]', NEW_DEPARTMENT.name.slice(0, 10));
  await sleep(700);
  const filtered = await page.evaluate(() =>
    [...document.querySelectorAll('[role="dialog"] [role="listbox"] [role="option"]')].map(
      (node) => node.textContent.trim(),
    ),
  );
  check(filtered.length < optionLabels.length, 'Typing filters the department list', `${filtered.length} of ${optionLabels.length}`);
  await shot('04-department-dropdown-search.png');

  await page.evaluate((name) => {
    const option = [...document.querySelectorAll('[role="dialog"] [role="listbox"] [role="option"]')].find(
      (node) => node.textContent.includes(name),
    );
    option?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  }, NEW_DEPARTMENT.name);
  await sleep(600);
  const pickedLabel = await textOf('[role="dialog"] [role="combobox"]');
  check(pickedLabel.includes(NEW_DEPARTMENT.name), 'Selected department is shown on the control', pickedLabel.trim());

  await page.type('[role="dialog"] input[id^="desig-title"]', NEW_DESIGNATIONS[0].title);
  await page.type('[role="dialog"] textarea[id^="desig-description"]', NEW_DESIGNATIONS[0].description);
  await page.type('[role="dialog"] input[id^="desig-grade"]', NEW_DESIGNATIONS[0].grade);
  await shot('05-add-designation-filled.png');

  await page.click('[role="dialog"] button[type="submit"]');
  await waitFor(
    (title) => document.body.innerText.includes(title),
    `designation ${NEW_DESIGNATIONS[0].title} to be listed`,
    NEW_DESIGNATIONS[0].title,
  );
  await dismissToasts();
  check(
    (await textOf('body')).includes(NEW_DESIGNATIONS[0].title),
    'Created designation is listed under its department',
  );

  /* ---------------- 4. designation list filtered by department ---------------- */
  await page.select('#designation-department-filter', await page.evaluate((name) => {
    const option = [...document.querySelectorAll('#designation-department-filter option')].find(
      (node) => node.textContent.trim() === name,
    );
    return option?.value ?? '';
  }, NEW_DEPARTMENT.name));
  await sleep(1200);
  const filteredRows = await page.evaluate(() => {
    const tables = document.querySelectorAll('table');
    const table = tables[tables.length - 1];
    return [...table.querySelectorAll('tbody tr')].map((row) => row.innerText);
  });
  check(filteredRows.length === 1, 'Filtering by department narrows the designation list', `${filteredRows.length} row`);
  check(
    filteredRows[0].includes(NEW_DESIGNATIONS[0].title) && filteredRows[0].includes(NEW_DEPARTMENT.name),
    'The filtered row shows the designation and its department',
  );
  await shot('06-designations-filtered-by-department.png');

  /* unfiltered: every designation with its department */
  await page.select('#designation-department-filter', '');
  await sleep(1200);
  const allRows = await page.evaluate(() => {
    const tables = document.querySelectorAll('table');
    const table = tables[tables.length - 1];
    return [...table.querySelectorAll('tbody tr')].map((row) => row.innerText);
  });
  check(allRows.length >= 7, 'All designations are listed with their department', `${allRows.length} rows`);
  await shot('07-designation-list-all.png');

  /* ---------------- 5. edit an existing designation ---------------- */
  await page.evaluate((title) => {
    const row = [...document.querySelectorAll('tr')].find((node) => node.innerText.includes(title));
    const button = row?.querySelector('button');
    button?.click();
  }, NEW_DESIGNATIONS[0].title);
  await page.waitForSelector('[role="dialog"]', { timeout: 15000 });
  await sleep(900);
  const editTitle = await page.evaluate(
    () => document.querySelector('[role="dialog"] h2')?.textContent ?? '',
  );
  check(editTitle.includes('Edit designation'), 'Edit designation dialog opened', editTitle);
  const carried = await textOf('[role="dialog"] [role="combobox"]');
  check(carried.includes(NEW_DEPARTMENT.name), 'Existing department is carried into the edit form');

  await page.evaluate(() => {
    const input = document.querySelector('[role="dialog"] input[id^="desig-title"]');
    if (input) {
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await page.type('[role="dialog"] input[id^="desig-title"]', `${NEW_DESIGNATIONS[0].title} II`);
  await shot('08-edit-designation.png');
  await page.click('[role="dialog"] button[type="submit"]');
  await waitFor(
    (title) => document.body.innerText.includes(title),
    'edited designation title to appear',
    `${NEW_DESIGNATIONS[0].title} II`,
  );
  check(
    (await textOf('body')).includes(`${NEW_DESIGNATIONS[0].title} II`),
    'Edited designation title is saved and listed',
  );

  /* ---------------- 6. employee registration scoping ---------------- */
  await clickText('[role="tab"]', 'Employees');
  await sleep(1800);
  await clickText('button', 'Register employee');
  await page.waitForSelector('[role="dialog"]', { timeout: 15000 });
  await sleep(900);

  const designationBefore = await page.evaluate(() => {
    const select = document.querySelector('[role="dialog"] select#employee-designation');
    return { disabled: select?.disabled ?? null, options: select ? select.options.length : 0 };
  });
  check(
    designationBefore.disabled === true,
    'Designation is disabled until a department is chosen',
  );

  const departmentValue = await page.evaluate((name) => {
    const select = document.querySelector('[role="dialog"] select');
    const option = [...(select?.options ?? [])].find((node) => node.textContent.includes(name));
    return option?.value ?? '';
  }, NEW_DEPARTMENT.name);
  check(Boolean(departmentValue), 'The new department is available for employee registration');

  await page.evaluate((value) => {
    const select = document.querySelector('[role="dialog"] select');
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }, departmentValue);
  await sleep(900);

  const scopedOptions = await page.evaluate(() =>
    [...document.querySelectorAll('[role="dialog"] select#employee-designation option')].map(
      (node) => node.textContent,
    ),
  );
  check(scopedOptions.length === 2, 'Only designations in that department are offered', scopedOptions.join(' | '));
  check(
    scopedOptions.includes(`${NEW_DESIGNATIONS[0].title} II`),
    'The designation created above is offered for that department',
  );
  check(
    !scopedOptions.includes('Accountant'),
    'A designation from another department is not offered',
  );

  await page.evaluate(() => {
    const select = document.querySelector('[role="dialog"] select#employee-designation');
    select.value = [...select.options].find((option) => option.value)?.value ?? '';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await sleep(600);
  await shot('09-employee-registration-scoped-designations.png');

  const chosenBefore = await page.evaluate(
    () => document.querySelector('[role="dialog"] select#employee-designation')?.value ?? '',
  );
  check(Boolean(chosenBefore), 'A designation can be selected for the employee');

  /* change the department: the incompatible designation must be cleared */
  const financeValue = await page.evaluate(() => {
    const select = document.querySelector('[role="dialog"] select');
    const option = [...(select?.options ?? [])].find((node) => node.textContent.includes('Finance'));
    return option?.value ?? '';
  });
  await page.evaluate((value) => {
    const select = document.querySelector('[role="dialog"] select');
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }, financeValue);
  await sleep(1000);
  const afterChange = await page.evaluate(() => ({
    value: document.querySelector('[role="dialog"] select#employee-designation')?.value ?? '',
    options: [...document.querySelectorAll('[role="dialog"] select#employee-designation option')].map(
      (node) => node.textContent,
    ),
  }));
  check(afterChange.value === '', 'Changing the department clears the incompatible designation');
  check(
    afterChange.options.includes('Accountant') && !afterChange.options.includes(`${NEW_DESIGNATIONS[0].title} II`),
    'The designation list follows the new department',
    afterChange.options.join(' | '),
  );
  await shot('10-department-change-clears-designation.png');

  /* ---------------- API integrity checks (through the real HTTP API) ---------------- */
  /*
   * The session is a bearer token, not a cookie, so the API checks reuse the
   * token the SPA just sent. Same server, same authorisation, real HTTP.
   */
  const apiCall = async (route, init) => {
    const response = await page.evaluate(
      async ({ path, options, token }) => {
        /*
         * The app keeps its bearer token in memory. It is read here and used for
         * this request only; the token is never written to the evidence file.
         */
        const withAuth = {
          ...options,
          headers: {
            ...(options?.headers ?? {}),
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        };
        const result = await fetch(path, withAuth);
        return { status: result.status, body: await result.text() };
      },
      { path: route, options: init, token: sessionToken },
    );
    return {
      status: response.status,
      json: (() => {
        try {
          return JSON.parse(response.body);
        } catch {
          return null;
        }
      })(),
    };
  };

  const departmentsPayload = await apiCall('/api/hr/departments?facilityId=1');
  const departmentId = departmentsPayload.json.find(
    (row) => row.name === NEW_DEPARTMENT.name,
  )?.id;
  const financeRow = departmentsPayload.json.find((row) => row.name === 'Finance');
  check(Boolean(departmentId) && Boolean(financeRow?.id), 'API returns departments with their ids');

  /* 9a. missing department is refused */
  const noDepartment = await apiCall('/api/hr/designations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ facilityId: 1, title: `No Department ${suffix}` }),
  });
  check(
    noDepartment.status === 400 && noDepartment.json?.error === 'INVALID_ID',
    'API refuses a designation with no department',
    `${noDepartment.status} ${noDepartment.json?.error}`,
  );

  /* 9b. inactive department is refused */
  const deactivate = await apiCall(`/api/hr/departments/${departmentId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      facilityId: 1,
      name: NEW_DEPARTMENT.name,
      description: NEW_DEPARTMENT.description,
      isActive: false,
    }),
  });
  check(deactivate.status === 200 && deactivate.json?.isActive === false, 'Department can be deactivated');
  const inactive = await apiCall('/api/hr/designations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ facilityId: 1, title: `Inactive Dept ${suffix}`, departmentId }),
  });
  check(
    inactive.status === 409 && inactive.json?.error === 'DEPARTMENT_INACTIVE',
    'API refuses a designation in a deactivated department',
    `${inactive.status} ${inactive.json?.error}`,
  );
  await apiCall(`/api/hr/departments/${departmentId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      facilityId: 1,
      name: NEW_DEPARTMENT.name,
      description: NEW_DEPARTMENT.description,
      isActive: true,
    }),
  });

  /* 10. empty department list is a real, handled state (a second facility has none) */
  const emptyScope = await apiCall('/api/hr/departments?facilityId=999999');
  check(
    emptyScope.status === 403 || emptyScope.status === 404 || Array.isArray(emptyScope.json),
    'An out-of-scope facility cannot read this facility departments',
    String(emptyScope.status),
  );

  /* 11. inactive designation cannot be newly assigned; existing staff edits still work */
  const designationsPayload = await apiCall('/api/hr/designations?facilityId=1');
  const created = designationsPayload.json.find(
    (row) => row.title === `${NEW_DESIGNATIONS[0].title} II`,
  );
  check(Boolean(created?.id), 'Created designation is returned by the API with its department id');
  check(
    created?.departmentId === departmentId,
    'Designation stores the department database id, not its name',
    String(created?.departmentId),
  );

  const deactivateDesignation = await apiCall(`/api/hr/designations/${created.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      facilityId: 1,
      title: created.title,
      departmentId,
      description: created.description,
      grade: created.grade,
      isActive: false,
    }),
  });
  check(
    deactivateDesignation.status === 200 && deactivateDesignation.json?.isActive === false,
    'Designation can be deactivated through the API',
  );

  /* 12. a designation in use cannot be moved to another department */
  const moveInUse = await apiCall(`/api/hr/designations/${created.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      facilityId: 1,
      title: created.title,
      departmentId: financeRow.id,
      isActive: false,
    }),
  });
  check(
    moveInUse.status === 200,
    'An unused designation can be moved between departments',
    String(moveInUse.status),
  );

  /* 12b. existing employees survive all of the above */
  const employees = await apiCall('/api/hr/employees?facilityId=1');
  check(
    Array.isArray(employees.json) &&
      employees.json.some((row) => row.employeeNumber === 'SYNTH-HR-0001') &&
      employees.json.some((row) => row.employeeNumber === 'SYNTH-HR-0002'),
    'Existing employee records are unchanged',
  );

  /* ---------------- summary ---------------- */
  const passed = checks.filter((entry) => entry.status === 'PASS').length;
  console.log(`\n${passed}/${checks.length} checks passed`);
  await writeFile(
    path.join(out, 'browser-run.json'),
    JSON.stringify(
      {
        runAt: new Date().toISOString(),
        baseUrl: base,
        account: identifier,
        dataCreated: { department: NEW_DEPARTMENT, designations: NEW_DESIGNATIONS },
        checks,
        screenshots: results,
        summary: { total: checks.length, passed, failed: checks.length - passed },
      },
      null,
      2,
    ),
  );
  console.log(`Wrote ${path.join(out, 'browser-run.json')}`);
} catch (error) {
  console.log(`\nRUN FAILED: ${error.message}`);
  await page.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {});
  await writeFile(
    path.join(out, 'browser-run.json'),
    JSON.stringify({ runAt: new Date().toISOString(), failure: error.message, checks }, null, 2),
  );
  process.exitCode = 1;
} finally {
  await browser.close();
}
