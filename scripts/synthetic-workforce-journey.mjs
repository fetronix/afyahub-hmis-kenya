/**
 * JaliCare HMIS — synthetic Phase 5 acceptance journey.
 *
 * Drives the live HTTP API with synthetic data only: departments, employees,
 * attendance, leave with a separate approver, effective-dated statutory
 * versions, payroll calculation, segregation-of-duties approval, ledger
 * posting and the printed payslip payload.
 *
 * It asserts the refusals too — self-approval, missing statutory rules, and a
 * second post that must replay the same journal rather than duplicate it.
 *
 *   BASE_URL=http://127.0.0.1:3000 SYNTHETIC_JOURNEY_CONFIRM=yes \
 *     node scripts/synthetic-workforce-journey.mjs
 *
 * Credentials come from the environment. Nothing secret is printed; the
 * report contains ids, amounts and assertion results only.
 */

import 'dotenv/config';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const FACILITY_ID = Number(process.env.SYNTH_FACILITY_ID ?? 1);

if (process.env.SYNTHETIC_JOURNEY_CONFIRM !== 'yes')
  throw new Error('Set SYNTHETIC_JOURNEY_CONFIRM=yes to run the synthetic journey.');
if (process.env.NODE_ENV === 'production')
  throw new Error('The synthetic journey refuses production.');

const results = [];
let failures = 0;

function check(name, condition, detail = '') {
  results.push({ name, passed: Boolean(condition), detail });
  if (!condition) failures += 1;
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function login(identifier, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.sessionToken)
    throw new Error(`Login failed for ${identifier}: ${body.error ?? res.status}`);
  return body.sessionToken;
}

function client(token) {
  return async (method, path, body) => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, ok: res.ok, body: json };
  };
}

const money = (cents) => (Number(cents) / 100).toFixed(2);

async function main() {
  const hrToken = await login('synthetic.hr', process.env.SYNTH_HR_PASSWORD);
  const financeToken = await login('synthetic.finance', process.env.SYNTH_FINANCE_PASSWORD);
  const adminToken = await login('synthetic.admin', process.env.SYNTH_FACILITY_ADMIN_PASSWORD);
  const hr = client(hrToken);
  const finance = client(financeToken);
  const admin = client(adminToken);

  /* --- 1. Organisation ------------------------------------------------- */
  const stamp = Date.now().toString().slice(-6);
  const dept = await hr('POST', '/api/hr/departments', {
    facilityId: FACILITY_ID,
    code: `CLIN${stamp}`,
    name: 'Clinical Services (synthetic)',
  });
  check('Create department', dept.status === 201, `status ${dept.status}`);

  const designation = await hr('POST', '/api/hr/designations', {
    facilityId: FACILITY_ID,
    departmentId: dept.body.id,
    title: `Clinical Officer ${stamp}`,
    grade: 'Job Group H',
  });
  check('Create designation', designation.status === 201, `status ${designation.status}`);

  /* --- 2. Employees ---------------------------------------------------- */
  const employees = [];
  for (const [index, person] of [
    { first: 'Synthetic', last: 'Nurse', salary: '6500000', pin: 'A000000001Z' },
    { first: 'Synthetic', last: 'Clerk', salary: '3200000', pin: 'A000000002Z' },
  ].entries()) {
    const created = await hr('POST', '/api/hr/employees', {
      facilityId: FACILITY_ID,
      employeeNumber: `SYN-${stamp}-${index + 1}`,
      firstName: person.first,
      middleName: 'Acceptance',
      lastName: `${person.last}${stamp}`,
      gender: 'FEMALE',
      dateOfBirth: '1992-04-11',
      phone: `+25470000${10 + index}`,
      email: `synthetic${index + 1}.${stamp}@example.test`,
      departmentId: dept.body.id,
      designationId: designation.body.id,
      employmentType: 'PERMANENT',
      hireDate: `${new Date().getUTCFullYear()}-01-05`,
      baseSalaryCents: person.salary,
      kraPin: person.pin,
      nssfNumber: `NSSF-${stamp}-${index}`,
      shifNumber: `SHIF-${stamp}-${index}`,
      bankAccountMasked: `****${1000 + index}`,
    });
    check(
      `Register employee ${index + 1}`,
      created.status === 201,
      created.ok ? created.body.employeeNumber : created.body.message,
    );
    if (created.ok) employees.push(created.body);
  }
  check('Two synthetic employees registered', employees.length === 2);
  if (employees.length < 2) throw new Error('Cannot continue without the synthetic employees.');

  // A full bank account must be refused.
  const unmasked = await hr('POST', '/api/hr/employees', {
    facilityId: FACILITY_ID,
    employeeNumber: `SYN-X-${stamp}`,
    firstName: 'Synthetic',
    lastName: 'Rejected',
    hireDate: `${new Date().getUTCFullYear()}-02-01`,
    baseSalaryCents: '1000000',
    bankAccountMasked: '1234567890',
  });
  check('Unmasked bank account refused', unmasked.status === 400, unmasked.body.error ?? '');

  // Another facility's employee must not be readable through a hint.
  const otherFacility = await hr('GET', '/api/hr/employees?facilityId=999999');
  check(
    'Foreign facility is rejected',
    otherFacility.status === 403 || otherFacility.status === 404,
    `status ${otherFacility.status}`,
  );

  /* --- 3. Attendance --------------------------------------------------- */
  const attendance = await hr('POST', '/api/hr/attendance', {
    facilityId: FACILITY_ID,
    employeeId: employees[0].id,
    workDate: new Date().toISOString().slice(0, 10),
    status: 'PRESENT',
    checkIn: '08:05',
    checkOut: '17:10',
    hours: 9,
  });
  check('Record attendance', attendance.status === 201, `status ${attendance.status}`);
  const attendanceDay = await hr('GET', `/api/hr/attendance?facilityId=${FACILITY_ID}`);
  check(
    'Attendance day shows the recorded status',
    attendanceDay.ok &&
      attendanceDay.body.rows.some(
        (row) => row.employeeId === employees[0].id && row.status === 'PRESENT',
      ),
  );

  /* --- 4. Leave with an independent approver --------------------------- */
  const leaveType = await hr('POST', '/api/hr/leave-types', {
    facilityId: FACILITY_ID,
    code: `ANNUAL${stamp}`.slice(0, 24),
    name: 'Annual leave (synthetic)',
    annualEntitlementDays: 21,
  });
  check('Create leave type', leaveType.status === 201, leaveType.body.message ?? '');

  const leaveRequest = await hr('POST', '/api/hr/leave-requests', {
    facilityId: FACILITY_ID,
    employeeId: employees[0].id,
    leaveTypeId: leaveType.body.id,
    startDate: `${new Date().getUTCFullYear()}-12-01`,
    endDate: `${new Date().getUTCFullYear()}-12-03`,
    days: 3,
    reason: 'Synthetic acceptance journey',
  });
  check('Request leave', leaveRequest.status === 201, leaveRequest.body.message ?? '');

  const selfApproval = await hr('POST', `/api/hr/leave-requests/${leaveRequest.body.id}/decide`, {
    facilityId: FACILITY_ID,
    decision: 'APPROVED',
  });
  check(
    'Self-approval of leave refused',
    selfApproval.status === 403 && selfApproval.body.error === 'LEAVE_SELF_APPROVAL',
    selfApproval.body.error ?? '',
  );

  const approved = await admin('POST', `/api/hr/leave-requests/${leaveRequest.body.id}/decide`, {
    facilityId: FACILITY_ID,
    decision: 'APPROVED',
    note: 'Synthetic approval by a second user',
  });
  check('Leave approved by a second user', approved.ok && approved.body.status === 'APPROVED');
  const balances = await hr('GET', `/api/hr/leave-balances?facilityId=${FACILITY_ID}`);
  check('Leave balances calculate', balances.ok && Array.isArray(balances.body));

  /* --- 5. Statutory rules ---------------------------------------------- */
  const year = new Date().getUTCFullYear();
  const statutory = [
    {
      statute: 'PAYE',
      label: 'Synthetic test bands — not a legal rate',
      sourceReference: 'SYNTHETIC TEST FIXTURE — NOT AN AUTHORITY PUBLICATION',
      authority: 'Synthetic acceptance fixture',
      bands: [
        {
          lowerBoundCents: '0',
          upperBoundCents: '2400000',
          employeeRateBp: 1000,
          employerRateBp: 0,
          reliefCents: '240000',
        },
        {
          lowerBoundCents: '2400000',
          upperBoundCents: '3233333',
          employeeRateBp: 2500,
          employerRateBp: 0,
          reliefCents: '0',
        },
        {
          lowerBoundCents: '3233333',
          upperBoundCents: null,
          employeeRateBp: 3000,
          employerRateBp: 0,
          reliefCents: '0',
        },
      ],
    },
    {
      statute: 'NSSF',
      label: 'Synthetic test band — not a legal rate',
      sourceReference: 'SYNTHETIC TEST FIXTURE — NOT AN AUTHORITY PUBLICATION',
      authority: 'Synthetic acceptance fixture',
      bands: [
        {
          lowerBoundCents: '0',
          employeeRateBp: 600,
          employerRateBp: 600,
          employeeCapCents: '216000',
          employerCapCents: '216000',
        },
      ],
    },
    {
      statute: 'SHIF',
      label: 'Synthetic test band — not a legal rate',
      sourceReference: 'SYNTHETIC TEST FIXTURE — NOT AN AUTHORITY PUBLICATION',
      authority: 'Synthetic acceptance fixture',
      bands: [{ lowerBoundCents: '0', employeeRateBp: 275, employerRateBp: 0 }],
    },
    {
      statute: 'AHL',
      label: 'Synthetic test band — not a legal rate',
      sourceReference: 'SYNTHETIC TEST FIXTURE — NOT AN AUTHORITY PUBLICATION',
      authority: 'Synthetic acceptance fixture',
      bands: [{ lowerBoundCents: '0', employeeRateBp: 150, employerRateBp: 150 }],
    },
  ];

  // Recording statutory rules is a privileged action: HR must be refused.
  const hrAttempt = await hr('POST', '/api/payroll/statutory-versions', {
    facilityId: FACILITY_ID,
    ...statutory[0],
    label: `${statutory[0].label} ${stamp}`,
    effectiveFrom: `${year}-01-01`,
  });
  check(
    'HR officer cannot record statutory rules',
    hrAttempt.status === 403,
    `status ${hrAttempt.status}`,
  );

  const existingVersions = await finance(
    'GET',
    `/api/payroll/statutory-versions?facilityId=${FACILITY_ID}`,
  );
  for (const rule of statutory) {
    let versionId = null;
    const created = await finance('POST', '/api/payroll/statutory-versions', {
      facilityId: FACILITY_ID,
      ...rule,
      label: `${rule.label} ${stamp}`,
      effectiveFrom: `${year}-01-01`,
    });
    if (created.status === 201) versionId = created.body.id;
    check(
      `Record ${rule.statute} version`,
      created.status === 201 || created.status === 409,
      created.ok ? `id ${created.body.id}` : created.body.message,
    );
    if (!versionId && existingVersions.ok) {
      // A previous visit to this synthetic facility already recorded a version
      // for the same statute and effective date; reuse it rather than assume
      // the run failed.
      const prior = existingVersions.body.find(
        (version) => version.statute === rule.statute && version.effectiveFrom === `${year}-01-01`,
      );
      versionId = prior?.id ?? null;
      if (prior?.status === 'ACTIVE') {
        check(`Activate ${rule.statute} version`, true, 'already active');
        continue;
      }
    }
    if (versionId) {
      const activated = await finance(
        'POST',
        `/api/payroll/statutory-versions/${versionId}/status`,
        {
          facilityId: FACILITY_ID,
          status: 'ACTIVE',
        },
      );
      check(`Activate ${rule.statute} version`, activated.ok, activated.body.message ?? '');
    }
  }

  /* --- 6. Accounts and payroll mapping --------------------------------- */
  const accountSpecs = [
    ['5100', 'Salaries and wages', 'EXPENSE', 'DEBIT', 'PAYROLL'],
    ['5110', 'Employer statutory contributions', 'EXPENSE', 'DEBIT', 'PAYROLL'],
    ['2100', 'Net pay payable', 'LIABILITY', 'CREDIT', 'PAYROLL'],
    ['2110', 'PAYE payable', 'LIABILITY', 'CREDIT', 'PAYROLL'],
    ['2120', 'NSSF payable', 'LIABILITY', 'CREDIT', 'PAYROLL'],
    ['2130', 'SHIF payable', 'LIABILITY', 'CREDIT', 'PAYROLL'],
    ['2140', 'Affordable housing levy payable', 'LIABILITY', 'CREDIT', 'PAYROLL'],
    ['2150', 'Other payroll deductions payable', 'LIABILITY', 'CREDIT', 'PAYROLL'],
  ];
  const accounts = [];
  for (const [code, name, type, normal, subType] of accountSpecs) {
    const created = await finance('POST', '/api/accounting/accounts', {
      facilityId: FACILITY_ID,
      accountCode: `${code}-${stamp}`,
      accountName: `${name} (synthetic ${stamp})`,
      accountType: type,
      normalBalance: normal,
      subType,
    });
    if (created.status === 201) accounts.push(created.body.account);
  }
  check(
    'Payroll ledger accounts created',
    accounts.length === accountSpecs.length,
    `${accounts.length}/8`,
  );

  const [salary, employerCost, netPay, paye, nssf, shif, ahl, other] = accounts;
  if (accounts.length === accountSpecs.length) {
    const mapping = await finance('PUT', '/api/payroll/account-settings', {
      facilityId: FACILITY_ID,
      salaryExpenseAccountId: salary.id,
      employerCostAccountId: employerCost.id,
      netPayPayableAccountId: netPay.id,
      payePayableAccountId: paye.id,
      nssfPayableAccountId: nssf.id,
      shifPayableAccountId: shif.id,
      ahlPayableAccountId: ahl.id,
      otherDeductionsPayableAccountId: other.id,
    });
    check('Map payroll accounts', mapping.ok, mapping.body.message ?? '');
  }

  /* --- 7. Period, calculation and segregation ------------------------- */
  const periodRange = { startDate: `${year}-11-01`, endDate: `${year}-11-30` };
  const period = await hr('POST', '/api/payroll/periods', {
    facilityId: FACILITY_ID,
    name: `Synthetic payroll ${stamp}`,
    ...periodRange,
    payDate: `${year}-11-28`,
  });
  check(
    'Create payroll period',
    period.status === 201 || period.status === 409,
    period.body.message ?? '',
  );
  let periodId = period.ok ? period.body.id : null;
  if (!periodId) {
    // The unique range already exists from an earlier synthetic visit.
    const existingPeriods = await hr('GET', `/api/payroll/periods?facilityId=${FACILITY_ID}`);
    const match = (existingPeriods.body ?? []).find(
      (candidate) =>
        candidate.startDate === periodRange.startDate && candidate.endDate === periodRange.endDate,
    );
    periodId = match?.id ?? null;
  }
  check('Payroll period resolved', Boolean(periodId), periodId ? `id ${periodId}` : 'not found');
  if (!periodId) throw new Error('No period to calculate.');

  const calculation = await hr('POST', `/api/payroll/periods/${periodId}/calculate`, {
    facilityId: FACILITY_ID,
  });
  const runLocked = !calculation.ok && calculation.body.error === 'RUN_LOCKED';
  if (!runLocked)
    check(
      'Calculate payroll from effective-dated rules',
      calculation.ok,
      calculation.ok ? `${calculation.body.employeeCount} payslips` : calculation.body.message,
    );

  let runId = calculation.ok ? calculation.body.runId : null;
  if (!runId) {
    const periodsNow = await hr('GET', `/api/payroll/periods?facilityId=${FACILITY_ID}`);
    runId = (periodsNow.body ?? []).find((candidate) => candidate.id === periodId)?.run?.id ?? null;
  }
  check('Run resolved for the period', Boolean(runId), runId ? `id ${runId}` : 'not found');
  if (!runId) throw new Error('Payroll run could not be resolved; cannot continue.');

  const runDetail = await hr('GET', `/api/payroll/runs/${runId}?facilityId=${FACILITY_ID}`);
  check('Run detail returns payslips', runDetail.ok && runDetail.body.payslips.length >= 2);
  const slip = runDetail.body.payslips[0];
  const expectedNet =
    Number(slip.grossCents) -
    Number(slip.nssfEmployeeCents) -
    Number(slip.shifCents) -
    Number(slip.ahlEmployeeCents) -
    Number(slip.payeCents) -
    Number(slip.otherDeductionsCents);
  check(
    'Net pay equals gross less every deduction',
    expectedNet === Number(slip.netCents),
    `expected ${money(expectedNet)}, got ${money(slip.netCents)}`,
  );

  const runStatus = runDetail.body.run.status;
  let postOutcome = null;
  if (runStatus === 'CALCULATED') {
    const unprivilegedApprove = await hr('POST', `/api/payroll/runs/${runId}/approve`, {
      facilityId: FACILITY_ID,
    });
    check(
      'A preparer without approval authority is refused',
      unprivilegedApprove.status === 403,
      unprivilegedApprove.body.error ?? '',
    );

    const approve = await finance('POST', `/api/payroll/runs/${runId}/approve`, {
      facilityId: FACILITY_ID,
    });
    check(
      'Finance manager approves the run',
      approve.ok && approve.body.status === 'APPROVED',
      approve.body.message ?? '',
    );
  } else {
    check(
      'Run was already approved in an earlier visit',
      ['APPROVED', 'POSTED'].includes(runStatus),
      runStatus,
    );
  }

  if (runStatus !== 'POSTED') {
    const hrPost = await hr('POST', `/api/payroll/runs/${runId}/post`, { facilityId: FACILITY_ID });
    check('HR officer cannot post to the ledger', hrPost.status === 403, `status ${hrPost.status}`);

    const post = await finance('POST', `/api/payroll/runs/${runId}/post`, {
      facilityId: FACILITY_ID,
    });
    check(
      'Post payroll to the ledger',
      post.ok && post.body.status === 'POSTED',
      post.ok ? `journal ${post.body.journalNumber}` : post.body.message,
    );
    check(
      'Journal balances',
      post.ok && post.body.debitTotalCents === post.body.creditTotalCents,
      post.ok ? `${money(post.body.debitTotalCents)} = ${money(post.body.creditTotalCents)}` : '',
    );
    const replay = await finance('POST', `/api/payroll/runs/${runId}/post`, {
      facilityId: FACILITY_ID,
    });
    check(
      'A retried post is refused, not duplicated',
      replay.status === 409,
      `${replay.status} ${replay.body.error ?? ''}`,
    );
    postOutcome = post;
  } else {
    check('Run was already posted in an earlier visit', true, 'verifying the existing journal');
    const replay = await finance('POST', `/api/payroll/runs/${runId}/post`, {
      facilityId: FACILITY_ID,
    });
    check(
      'A retried post is refused, not duplicated',
      replay.status === 409,
      `${replay.status} ${replay.body.error ?? ''}`,
    );
    postOutcome = {
      ok: Boolean(runDetail.body.run.journalEntryId),
      body: {
        journalNumber: null,
        journalEntryId: runDetail.body.run.journalEntryId,
        debitTotalCents: null,
        creditTotalCents: null,
        status: 'POSTED',
      },
    };
  }

  /* --- 8. Payslip and ledger -------------------------------------------- */
  const payslipId = runDetail.body.payslips[0].id;
  const payslip = await hr('GET', `/api/payroll/payslips/${payslipId}?facilityId=${FACILITY_ID}`);
  check('Payslip detail is retrievable', payslip.ok && payslip.body.netCents);
  check(
    'Payslip records the rules applied',
    payslip.ok &&
      Array.isArray(payslip.body.breakdown?.statutes) &&
      payslip.body.breakdown.statutes.length === 4,
  );

  const overview = await finance(
    'GET',
    `/api/accounting/overview?facilityId=${FACILITY_ID}&endDate=${year}-12-31`,
  );
  check('Ledger overview loads after posting', overview.ok);
  if (overview.ok) {
    const journalNumber = postOutcome?.body?.journalNumber;
    const journalEntryId = postOutcome?.body?.journalEntryId;
    const journals = overview.body.journals ?? [];
    const found = journalNumber
      ? journals.some((journal) => journal.journalNumber === journalNumber)
      : journals.some((journal) => journal.id === journalEntryId);
    check(
      'Payroll journal appears in the general ledger',
      found,
      journalNumber ?? `id ${journalEntryId}`,
    );
    // Sum every expense debit: the run may have been posted against an
    // earlier mapping while this visit created fresh synthetic accounts.
    const gross = Number(runDetail.body.run.grossCents);
    const expenseDebits = (overview.body.accounts ?? [])
      .filter((account) => account.accountType === 'EXPENSE')
      .reduce((sum, account) => sum + Number(account.debitCents ?? 0), 0);
    check(
      'Salary expense is debited by at least gross pay',
      expenseDebits >= gross,
      `expense debits ${money(expenseDebits)} vs gross ${money(gross)}`,
    );
  }

  /* --- 9. Missing rules and self-approval on a second period ----------- */
  const decemberRange = { startDate: `${year}-12-01`, endDate: `${year}-12-31` };
  const december = await finance('POST', '/api/payroll/periods', {
    facilityId: FACILITY_ID,
    name: `Synthetic payroll ${stamp} December`,
    ...decemberRange,
    payDate: `${year}-12-24`,
  });
  let decemberId = december.ok ? december.body.id : null;
  if (!decemberId) {
    const existingPeriods = await finance('GET', `/api/payroll/periods?facilityId=${FACILITY_ID}`);
    decemberId =
      (existingPeriods.body ?? []).find(
        (candidate) =>
          candidate.startDate === decemberRange.startDate &&
          candidate.endDate === decemberRange.endDate,
      )?.id ?? null;
  }
  check(
    'Second period available for refusal tests',
    Boolean(decemberId),
    `id ${decemberId ?? 'none'}`,
  );

  const versionsNow = await finance(
    'GET',
    `/api/payroll/statutory-versions?facilityId=${FACILITY_ID}`,
  );
  const activeAhl = (versionsNow.body ?? []).find(
    (version) => version.statute === 'AHL' && version.status === 'ACTIVE',
  );
  if (activeAhl && decemberId) {
    const retired = await finance(
      'POST',
      `/api/payroll/statutory-versions/${activeAhl.id}/status`,
      { facilityId: FACILITY_ID, status: 'RETIRED' },
    );
    check('Retire the housing levy version to test coverage', retired.ok);
    const refused = await finance('POST', `/api/payroll/periods/${decemberId}/calculate`, {
      facilityId: FACILITY_ID,
    });
    check(
      'A pay date with no statutory version is refused',
      refused.status === 409 && refused.body.error === 'STATUTORY_VERSION_REQUIRED',
      `${refused.status} ${refused.body.error ?? ''}`,
    );
    const restored = await finance(
      'POST',
      `/api/payroll/statutory-versions/${activeAhl.id}/status`,
      { facilityId: FACILITY_ID, status: 'ACTIVE' },
    );
    check('Restore the housing levy version', restored.ok);
  }

  if (decemberId) {
    const financeCalculation = await finance(
      'POST',
      `/api/payroll/periods/${decemberId}/calculate`,
      {
        facilityId: FACILITY_ID,
      },
    );
    check(
      'Finance manager calculates the second run',
      financeCalculation.ok,
      financeCalculation.body.message ?? '',
    );
    if (financeCalculation.ok) {
      const selfApprove = await finance(
        'POST',
        `/api/payroll/runs/${financeCalculation.body.runId}/approve`,
        { facilityId: FACILITY_ID },
      );
      check(
        'The user who calculated a run cannot approve it',
        selfApprove.status === 403 && selfApprove.body.error === 'PAYROLL_SELF_APPROVAL',
        selfApprove.body.error ?? '',
      );
    }
  }

  console.log('\n---------------------------------------------');
  console.log(`Assertions: ${results.length - failures} passed, ${failures} failed`);
  const summary = {
    facilityId: FACILITY_ID,
    employees: employees.map((employee) => employee.id),
    periodId,
    runId,
    payslips: runDetail.body?.payslips?.length ?? 0,
    grossCents: runDetail.body?.run?.grossCents,
    netCents: runDetail.body?.run?.netCents,
    journalNumber: postOutcome?.body?.journalNumber ?? null,
    journalEntryId: postOutcome?.body?.journalEntryId ?? null,
    payrollPayslipId: payslipId,
    results,
  };
  const { writeFileSync } = await import('node:fs');
  writeFileSync('/tmp/workforce-journey-report.json', JSON.stringify(summary, null, 2));
  console.log('Report written to /tmp/workforce-journey-report.json');
  if (failures > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
