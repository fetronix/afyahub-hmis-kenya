/**
 * Syrona Medical Center HMIS — synthetic fixtures for the documentation screenshots.
 *
 * Seeds a clearly-labelled synthetic training facility with representative
 * workforce, payroll, asset-adjacent ledger and clinical records so that
 * documentation screenshots show a populated interface. Every value is
 * invented: no real patient, staff or supplier information is used, and no
 * statutory rate is asserted here — payroll figures are labelled as an
 * illustration, not a statutory computation.
 *
 * Safety:
 *   - refuses to run without SYNTHETIC_DOCS_CONFIRM=yes;
 *   - refuses a database name that does not mark itself as synthetic;
 *   - refuses a non-loopback host;
 *   - idempotent: it clears the rows it owns for that facility before inserting.
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';

import pg from 'pg';

const host = process.env.SQL_HOST ?? '';
const name = process.env.SQL_DB_NAME ?? '';
if (process.env.SYNTHETIC_DOCS_CONFIRM !== 'yes')
  throw new Error('Set SYNTHETIC_DOCS_CONFIRM=yes to confirm synthetic, non-production data.');
if (!['127.0.0.1', 'localhost', '::1'].includes(host))
  throw new Error('Refusing: loopback host required.');
if (!/synthetic/i.test(name))
  throw new Error('Refusing: SQL_DB_NAME must identify a synthetic database.');

const SLUG = 'syrona-synthetic-training';
const pool = new pg.Pool({
  host,
  port: Number(process.env.SQL_PORT ?? 5432),
  database: name,
  user: process.env.SQL_ADMIN_USER,
  password: process.env.SQL_ADMIN_PASSWORD ?? '',
  max: 4,
});

const one = async (text, params = []) => (await pool.query(text, params)).rows[0];
const run = async (text, params = []) => pool.query(text, params);

const today = new Date();
const iso = (date) => date.toISOString().slice(0, 10);
const addDays = (date, days) => new Date(date.getTime() + days * 86_400_000);
const monthStart = (date, offset) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1));
const monthEnd = (date, offset) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset + 1, 0));

const GUARDED_TABLES = [
  'audit_logs',
  'payroll_periods',
  'payroll_runs',
  'payroll_payslips',
  'payroll_payslip_lines',
  'journal_entries',
  'journal_lines',
  'chart_of_accounts',
  'financial_periods',
];

/**
 * Payroll and ledger rows are append-only once approved. Resetting a synthetic
 * fixture rebuilds them from scratch, so the guards are suspended for the
 * reset only and restored before the script exits.
 */
const withGuardsSuspended = async (work) => {
  for (const table of GUARDED_TABLES) await run(`ALTER TABLE ${table} DISABLE TRIGGER USER`);
  try {
    return await work();
  } finally {
    for (const table of GUARDED_TABLES) await run(`ALTER TABLE ${table} ENABLE TRIGGER USER`);
  }
};

const ACCOUNTS = [
  ['1000', 'Cash and cash equivalents', 'ASSET', 'CURRENT_ASSET', 'DEBIT'],
  ['1010', 'Bank — operating account', 'ASSET', 'CURRENT_ASSET', 'DEBIT'],
  ['1020', 'Bank — collections account', 'ASSET', 'CURRENT_ASSET', 'DEBIT'],
  ['1100', 'Patient receivables', 'ASSET', 'CURRENT_ASSET', 'DEBIT'],
  ['1110', 'Insurance and SHA receivables', 'ASSET', 'CURRENT_ASSET', 'DEBIT'],
  ['1200', 'Pharmacy inventory', 'ASSET', 'CURRENT_ASSET', 'DEBIT'],
  ['1210', 'Surgical and general stores', 'ASSET', 'CURRENT_ASSET', 'DEBIT'],
  ['1500', 'Medical equipment', 'ASSET', 'FIXED_ASSET', 'DEBIT'],
  ['1510', 'Accumulated depreciation — equipment', 'ASSET', 'FIXED_ASSET', 'CREDIT'],
  ['2000', 'Supplier payables', 'LIABILITY', 'CURRENT_LIABILITY', 'CREDIT'],
  ['2010', 'Net pay payable', 'LIABILITY', 'CURRENT_LIABILITY', 'CREDIT'],
  ['2020', 'PAYE payable', 'LIABILITY', 'CURRENT_LIABILITY', 'CREDIT'],
  ['2030', 'NSSF payable', 'LIABILITY', 'CURRENT_LIABILITY', 'CREDIT'],
  ['2040', 'SHIF payable', 'LIABILITY', 'CURRENT_LIABILITY', 'CREDIT'],
  ['2050', 'Housing levy payable', 'LIABILITY', 'CURRENT_LIABILITY', 'CREDIT'],
  ['3000', 'Owners capital', 'EQUITY', 'EQUITY', 'CREDIT'],
  ['3100', 'Retained earnings', 'EQUITY', 'EQUITY', 'CREDIT'],
  ['4000', 'Outpatient service revenue', 'REVENUE', 'OPERATING_REVENUE', 'CREDIT'],
  ['4010', 'Inpatient service revenue', 'REVENUE', 'OPERATING_REVENUE', 'CREDIT'],
  ['4020', 'Laboratory revenue', 'REVENUE', 'OPERATING_REVENUE', 'CREDIT'],
  ['4030', 'Pharmacy revenue', 'REVENUE', 'OPERATING_REVENUE', 'CREDIT'],
  ['5000', 'Salaries and wages', 'EXPENSE', 'OPERATING_EXPENSE', 'DEBIT'],
  ['5010', 'Employer statutory contributions', 'EXPENSE', 'OPERATING_EXPENSE', 'DEBIT'],
  ['5100', 'Medical and surgical supplies', 'EXPENSE', 'OPERATING_EXPENSE', 'DEBIT'],
  ['5200', 'Utilities', 'EXPENSE', 'OPERATING_EXPENSE', 'DEBIT'],
  ['5300', 'Depreciation expense', 'EXPENSE', 'OPERATING_EXPENSE', 'DEBIT'],
];

const seedLedger = async (ctx) => {
  const { tenantId, facilityId } = ctx;
  await run(
    'DELETE FROM journal_lines WHERE journal_entry_id IN (SELECT id FROM journal_entries WHERE facility_id=$1)',
    [facilityId],
  );
  await run('DELETE FROM journal_entries WHERE facility_id=$1', [facilityId]);
  await run('DELETE FROM financial_periods WHERE facility_id=$1', [facilityId]);
  await run('DELETE FROM chart_of_accounts WHERE facility_id=$1', [facilityId]);

  const accountIds = {};
  for (const [code, accountName, type, subType, normal] of ACCOUNTS) {
    const row = await one(
      `INSERT INTO chart_of_accounts(tenant_id,facility_id,account_code,account_name,account_type,sub_type,normal_balance)
       VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [tenantId, facilityId, code, accountName, type, subType, normal],
    );
    accountIds[code] = row.id;
  }

  const periods = [];
  for (const offset of [-2, -1, 0]) {
    const start = monthStart(today, offset);
    const end = monthEnd(today, offset);
    const code = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}`;
    const row = await one(
      `INSERT INTO financial_periods(tenant_id,facility_id,period_code,name,start_date,end_date,status)
       VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [
        tenantId,
        facilityId,
        code,
        `${start.toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' })} ${start.getUTCFullYear()}`,
        iso(start),
        iso(end),
        offset < 0 ? 'CLOSED' : 'OPEN',
      ],
    );
    periods.push({ id: row.id, start, end });
  }
  return { accountIds, periods };
};

const postJournal = async (ctx, ledger, entry) => {
  const { tenantId, facilityId, adminId } = ctx;
  const total = entry.lines.reduce((sum, line) => sum + line.debit, 0);
  const journal = await one(
    `INSERT INTO journal_entries(tenant_id,facility_id,period_id,journal_number,entry_date,source_type,source_id,
       idempotency_key,request_hash,description,status,total_debit_cents,total_credit_cents,posted_by_user_id,posted_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'POSTED',$11,$11,$12,now()) RETURNING id`,
    [
      tenantId,
      facilityId,
      entry.periodId,
      entry.number,
      entry.date,
      entry.sourceType ?? 'MANUAL',
      entry.sourceId ?? null,
      entry.idempotencyKey,
      entry.requestHash,
      entry.description,
      total,
      adminId,
    ],
  );
  for (const line of entry.lines) {
    await run(
      `INSERT INTO journal_lines(journal_entry_id,account_id,description,debit_cents,credit_cents)
       VALUES($1,$2,$3,$4,$5)`,
      [journal.id, ledger.accountIds[line.account], line.description, line.debit, line.credit],
    );
  }
  return journal.id;
};

const seedWorkforce = async (ctx) => {
  const { tenantId, facilityId, adminId, approverId, ledger } = ctx;
  await run('DELETE FROM hr_roster_entries WHERE facility_id=$1', [facilityId]);
  await run('DELETE FROM hr_attendance WHERE facility_id=$1', [facilityId]);
  await run('DELETE FROM hr_leave_requests WHERE facility_id=$1', [facilityId]);
  await run(
    'DELETE FROM payroll_payslip_lines WHERE payslip_id IN (SELECT id FROM payroll_payslips WHERE facility_id=$1)',
    [facilityId],
  );
  await run('DELETE FROM payroll_payslips WHERE facility_id=$1', [facilityId]);
  await run('DELETE FROM payroll_runs WHERE facility_id=$1', [facilityId]);
  await run('DELETE FROM payroll_periods WHERE facility_id=$1', [facilityId]);
  await run('DELETE FROM payroll_employee_components WHERE facility_id=$1', [facilityId]);
  await run('DELETE FROM hr_employee_documents WHERE facility_id=$1', [facilityId]);
  await run('DELETE FROM hr_employees WHERE facility_id=$1', [facilityId]);
  await run('DELETE FROM hr_shifts WHERE facility_id=$1', [facilityId]);
  await run('DELETE FROM hr_leave_types WHERE facility_id=$1', [facilityId]);
  await run('DELETE FROM hr_designations WHERE facility_id=$1', [facilityId]);
  await run('DELETE FROM hr_departments WHERE facility_id=$1', [facilityId]);

  const departmentIds = {};
  for (const [code, departmentName] of [
    ['CLIN', 'Clinical Services'],
    ['NURS', 'Nursing'],
    ['LAB', 'Laboratory & Diagnostics'],
    ['PHARM', 'Pharmacy'],
    ['FIN', 'Finance & Revenue'],
    ['HR', 'Human Resources'],
  ]) {
    const row = await one(
      'INSERT INTO hr_departments(tenant_id,facility_id,code,name,created_by) VALUES($1,$2,$3,$4,$5) RETURNING id',
      [tenantId, facilityId, code, departmentName, adminId],
    );
    departmentIds[code] = row.id;
  }

  const designationIds = {};
  for (const [title, department, grade] of [
    ['Medical Officer', 'CLIN', 'M3'],
    ['Consultant Physician', 'CLIN', 'M5'],
    ['Clinical Officer', 'CLIN', 'M2'],
    ['Registered Nurse', 'NURS', 'N3'],
    ['Nurse In-Charge', 'NURS', 'N4'],
    ['Laboratory Technologist', 'LAB', 'T3'],
    ['Radiographer', 'LAB', 'T3'],
    ['Pharmaceutical Technologist', 'PHARM', 'T3'],
    ['Accounts Assistant', 'FIN', 'F2'],
    ['HR Officer', 'HR', 'A3'],
  ]) {
    const row = await one(
      'INSERT INTO hr_designations(tenant_id,facility_id,department_id,title,grade,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',
      [tenantId, facilityId, departmentIds[department], title, grade, adminId],
    );
    designationIds[title] = row.id;
  }

  const employees = [
    ['Grace', 'Wanjiru', 'Kamau', 'FEMALE', 'Consultant Physician', 'CLIN', 268_000, '2018-03-04'],
    ['Peter', 'Otieno', 'Owino', 'MALE', 'Medical Officer', 'CLIN', 186_000, '2020-07-13'],
    ['Faith', 'Chebet', 'Kiptoo', 'FEMALE', 'Medical Officer', 'CLIN', 174_000, '2021-01-11'],
    ['Samuel', 'Mwangi', 'Njoroge', 'MALE', 'Clinical Officer', 'CLIN', 128_000, '2019-09-02'],
    ['Mary', 'Nyokabi', 'Wairimu', 'FEMALE', 'Nurse In-Charge', 'NURS', 132_000, '2017-05-15'],
    ['Alice', 'Akinyi', 'Odhiambo', 'FEMALE', 'Registered Nurse', 'NURS', 88_000, '2022-02-07'],
    ['Brian', 'Kiprop', 'Cheruiyot', 'MALE', 'Registered Nurse', 'NURS', 84_000, '2022-08-01'],
    ['Jane', 'Wambui', 'Kariuki', 'FEMALE', 'Registered Nurse', 'NURS', 92_000, '2020-11-23'],
    ['Kevin', 'Maina', 'Gitau', 'MALE', 'Laboratory Technologist', 'LAB', 96_000, '2021-06-14'],
    ['Lydia', 'Achieng', 'Owuor', 'FEMALE', 'Radiographer', 'LAB', 102_000, '2019-04-08'],
    ['Daniel', 'Kiptoo', 'Korir', 'MALE', 'Pharmaceutical Technologist', 'PHARM', 98_000, '2023-01-16'],
    ['Esther', 'Njeri', 'Mbugua', 'FEMALE', 'Accounts Assistant', 'FIN', 72_000, '2023-03-20'],
    ['Caroline', 'Moraa', 'Nyaboke', 'FEMALE', 'HR Officer', 'HR', 86_000, '2022-10-03'],
    ['James', 'Kariuki', 'Muthoni', 'MALE', 'Clinical Officer', 'CLIN', 132_000, '2024-02-05'],
  ];
  const employeeIds = [];
  let sequence = 1;
  for (const [first, middle, last, gender, title, department, salary, hire] of employees) {
    const row = await one(
      `INSERT INTO hr_employees(tenant_id,facility_id,employee_number,first_name,middle_name,last_name,gender,
         national_id,phone,email,department_id,designation_id,employment_type,employment_status,hire_date,
         base_salary_cents,bank_name,bank_account_masked,kra_pin,nssf_number,shif_number,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'PERMANENT','ACTIVE',$13,$14,'Synthetic Bank',$15,$16,$17,$18,$19)
       RETURNING id`,
      [
        tenantId,
        facilityId,
        `SMC-${String(sequence++).padStart(4, '0')}`,
        first,
        middle,
        last,
        gender,
        `SYN-${30_000_000 + sequence}`,
        `0700${String(100_000 + sequence)}`,
        `${first}.${last}@syrona.example.test`.toLowerCase(),
        departmentIds[department],
        designationIds[title],
        hire,
        salary * 100,
        `•••• ${String(4000 + sequence)}`,
        `A${String(10_000_000 + sequence)}Z`,
        `NSSF${String(200_000 + sequence)}`,
        `SHIF${String(300_000 + sequence)}`,
        adminId,
      ],
    );
    employeeIds.push({ id: row.id, salary });
  }

  for (const [shiftName, start, end] of [
    ['Day shift', '08:00', '20:00'],
    ['Night shift', '20:00', '08:00'],
    ['Morning clinic', '07:30', '15:30'],
  ]) {
    await run(
      'INSERT INTO hr_shifts(tenant_id,facility_id,name,start_time,end_time,created_by) VALUES($1,$2,$3,$4,$5,$6)',
      [tenantId, facilityId, shiftName, start, end, adminId],
    );
  }
  const shiftIds = (await run('SELECT id,name FROM hr_shifts WHERE facility_id=$1 ORDER BY id', [facilityId])).rows;

  const leaveTypes = [
    ['ANNUAL', 'Annual leave', 21, true],
    ['SICK', 'Sick leave', 14, true],
    ['MATERNITY', 'Maternity leave', 90, true],
    ['COMPASSIONATE', 'Compassionate leave', 5, true],
  ];
  for (const [code, label, days, paid] of leaveTypes) {
    await run(
      'INSERT INTO hr_leave_types(tenant_id,facility_id,code,name,annual_entitlement_days,paid,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING',
      [tenantId, facilityId, code, label, days, paid, adminId],
    );
  }
  const leaveTypeRows = (await run('SELECT id,code FROM hr_leave_types WHERE facility_id=$1 ORDER BY id', [facilityId]))
    .rows;
  const leaveTypeByCode = Object.fromEntries(leaveTypeRows.map((row) => [row.code, row.id]));

  for (let index = 0; index < 24; index += 1) {
    const employee = employeeIds[index % employeeIds.length];
    await run(
      'INSERT INTO hr_roster_entries(tenant_id,facility_id,employee_id,shift_id,work_date,created_by) VALUES($1,$2,$3,$4,$5,$6)',
      [tenantId, facilityId, employee.id, shiftIds[index % shiftIds.length].id, iso(addDays(today, index - 7)), adminId],
    );
  }

  for (let index = 0; index < 30; index += 1) {
    const employee = employeeIds[index % employeeIds.length];
    const workDate = addDays(today, -(index % 10));
    await run(
      `INSERT INTO hr_attendance(tenant_id,facility_id,employee_id,work_date,status,check_in,check_out,hours,recorded_by)
       VALUES($1,$2,$3,$4,'PRESENT',$5,$6,$7,$8)`,
      [
        tenantId,
        facilityId,
        employee.id,
        iso(workDate),
        `0${7 + (index % 2)}:${String(45 + (index % 10)).padStart(2, '0')}`,
        `1${7 + (index % 2)}:${String(10 + (index % 10)).padStart(2, '0')}`,
        8 + (index % 2),
        adminId,
      ],
    ).catch(() => undefined);
  }

  for (const [employee, code, days, reason] of [
    [employeeIds[5], 'ANNUAL', 5, 'Family visit upcountry'],
    [employeeIds[6], 'SICK', 3, 'Medical leave, certificate on file'],
    [employeeIds[11], 'ANNUAL', 10, 'Annual leave balance'],
    [employeeIds[3], 'COMPASSIONATE', 2, 'Bereavement'],
    [employeeIds[9], 'ANNUAL', 4, 'Annual leave balance'],
  ]) {
    const start = addDays(today, 3);
    await run(
      `INSERT INTO hr_leave_requests(tenant_id,facility_id,employee_id,leave_type_id,start_date,end_date,days,reason,status,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,'REQUESTED',$9)`,
      [
        tenantId,
        facilityId,
        employee.id,
        leaveTypeByCode[code],
        iso(start),
        iso(addDays(start, days)),
        days,
        reason,
        adminId,
      ],
    ).catch(() => undefined);
  }

  for (const employee of employeeIds) {
    for (const [code, componentName, kind, amount, taxable] of [
      ['BASIC', 'Basic salary', 'EARNING', employee.salary * 100, true],
      ['HOUSE', 'House allowance', 'EARNING', Math.round(employee.salary * 0.15) * 100, true],
      ['TRANSPORT', 'Transport allowance', 'EARNING', 8_000 * 100, true],
    ]) {
      await run(
        `INSERT INTO payroll_employee_components(tenant_id,facility_id,employee_id,code,name,kind,amount_cents,taxable,tax_deductible,effective_from,created_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,false,'2025-01-01',$9)`,
        [tenantId, facilityId, employee.id, code, componentName, kind, amount, taxable, adminId],
      );
    }
  }

  const buildRun = async (monthOffset, status) => {
    const start = monthStart(today, monthOffset);
    const end = monthEnd(today, monthOffset);
    const periodName = `${start.toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' })} ${start.getUTCFullYear()}`;
    const period = await one(
      `INSERT INTO payroll_periods(tenant_id,facility_id,name,start_date,end_date,pay_date,status,created_by)
       VALUES($1,$2,$3,$4,$5,$6,'OPEN',$7) RETURNING id`,
      [tenantId, facilityId, periodName, iso(start), iso(end), iso(addDays(end, -1)), adminId],
    );

    let gross = 0;
    let paye = 0;
    let nssfEmployee = 0;
    let nssfEmployer = 0;
    let shif = 0;
    let ahlEmployee = 0;
    let ahlEmployer = 0;
    let net = 0;
    const lines = [];
    for (const employee of employeeIds) {
      const basic = employee.salary * 100;
      const house = Math.round(employee.salary * 0.15) * 100;
      const transport = 800_000;
      const employeeGross = basic + house + transport;
      // Invented illustrative deductions for synthetic payslips only.
      const employeePaye = Math.round(employeeGross * 0.16);
      const employeeNssf = Math.round(Math.min(employeeGross, 10_800_000) * 0.06);
      const employeeShif = Math.round(employeeGross * 0.0275);
      const employeeAhl = Math.round(employeeGross * 0.015);
      const employeeNet = employeeGross - employeePaye - employeeNssf - employeeShif - employeeAhl;
      gross += employeeGross;
      paye += employeePaye;
      nssfEmployee += employeeNssf;
      nssfEmployer += employeeNssf;
      shif += employeeShif;
      ahlEmployee += employeeAhl;
      ahlEmployer += employeeAhl;
      net += employeeNet;
      lines.push({
        employeeId: employee.id,
        gross: employeeGross,
        paye: employeePaye,
        nssfEmployee: employeeNssf,
        nssfEmployer: employeeNssf,
        shif: employeeShif,
        ahlEmployee: employeeAhl,
        ahlEmployer: employeeAhl,
        net: employeeNet,
        basic,
        house,
        transport,
      });
    }

    const payrollRun = await one(
      `INSERT INTO payroll_runs(tenant_id,facility_id,period_id,status,employee_count,gross_cents,taxable_cents,
         paye_cents,nssf_employee_cents,nssf_employer_cents,shif_cents,ahl_employee_cents,ahl_employer_cents,
         other_deductions_cents,net_cents,calculated_by,calculated_at)
       VALUES($1,$2,$3,'CALCULATED',$4,$5,$5,$6,$7,$8,$9,$10,$11,0,$12,$13,now()) RETURNING id`,
      [
        tenantId,
        facilityId,
        period.id,
        lines.length,
        gross,
        paye,
        nssfEmployee,
        nssfEmployer,
        shif,
        ahlEmployee,
        ahlEmployer,
        net,
        adminId,
      ],
    );

    for (const line of lines) {
      const payslip = await one(
        `INSERT INTO payroll_payslips(tenant_id,facility_id,run_id,employee_id,gross_cents,taxable_cents,paye_cents,
           nssf_employee_cents,nssf_employer_cents,shif_cents,ahl_employee_cents,ahl_employer_cents,other_deductions_cents,net_cents,breakdown)
         VALUES($1,$2,$3,$4,$5,$5,$6,$7,$8,$9,$10,$11,0,$12,$13::jsonb) RETURNING id`,
        [
          tenantId,
          facilityId,
          payrollRun.id,
          line.employeeId,
          line.gross,
          line.paye,
          line.nssfEmployee,
          line.nssfEmployer,
          line.shif,
          line.ahlEmployee,
          line.ahlEmployer,
          line.net,
          JSON.stringify({
            note: 'Synthetic illustration for documentation; not a statutory computation.',
          }),
        ],
      );
      let order = 0;
      for (const [code, label, kind, amount] of [
        ['BASIC', 'Basic salary', 'EARNING', line.basic],
        ['HOUSE', 'House allowance', 'EARNING', line.house],
        ['TRANSPORT', 'Transport allowance', 'EARNING', line.transport],
        ['PAYE', 'PAYE', 'DEDUCTION', line.paye],
        ['NSSF', 'NSSF (employee)', 'DEDUCTION', line.nssfEmployee],
        ['SHIF', 'SHIF (employee)', 'DEDUCTION', line.shif],
        ['AHL', 'Housing levy (employee)', 'DEDUCTION', line.ahlEmployee],
      ]) {
        await run(
          `INSERT INTO payroll_payslip_lines(payslip_id,sequence,code,name,kind,amount_cents) VALUES($1,$2,$3,$4,$5,$6)`,
          [payslip.id, order++, code, label, kind, amount],
        );
      }
    }

    if (status !== 'CALCULATED') {
      await run("UPDATE payroll_runs SET status='APPROVED',approved_by=$2,approved_at=now() WHERE id=$1", [
        payrollRun.id,
        approverId,
      ]);
    }

    if (status === 'POSTED') {
      const journalId = await postJournal(ctx, ledger, {
        periodId: ledger.periods[ledger.periods.length - 1].id,
        number: `PAY-${iso(start).slice(0, 7)}`,
        date: iso(addDays(end, -1)),
        sourceType: 'PAYROLL',
        sourceId: String(payrollRun.id),
        idempotencyKey: `payroll-${facilityId}-${iso(start).slice(0, 7)}`,
        requestHash: 'c'.repeat(64),
        description: `Payroll journal for ${periodName}`,
        lines: [
          { account: '5000', description: 'Salaries and wages (gross)', debit: gross, credit: 0 },
          {
            account: '5010',
            description: 'Employer statutory contributions',
            debit: nssfEmployer + ahlEmployer,
            credit: 0,
          },
          { account: '2020', description: 'PAYE payable', debit: 0, credit: paye },
          { account: '2030', description: 'NSSF payable', debit: 0, credit: nssfEmployee + nssfEmployer },
          { account: '2040', description: 'SHIF payable', debit: 0, credit: shif },
          { account: '2050', description: 'Housing levy payable', debit: 0, credit: ahlEmployee + ahlEmployer },
          { account: '2010', description: 'Net pay payable', debit: 0, credit: net },
        ].filter((line) => line.debit || line.credit),
      });
      await run(
        "UPDATE payroll_runs SET status='POSTED',posted_by=$2,posted_at=now(),journal_entry_id=$3 WHERE id=$1",
        [payrollRun.id, approverId, journalId],
      );
    }

    await run("UPDATE payroll_periods SET status='CLOSED' WHERE id=$1", [period.id]);
    return payrollRun.id;
  };

  await buildRun(-1, 'CALCULATED');
  await buildRun(-2, 'APPROVED');
  await buildRun(-3, 'POSTED');
};

const seedClinical = async (ctx) => {
  const { tenantId, facilityId, adminId } = ctx;
  await run(
    'DELETE FROM billing_items WHERE invoice_id IN (SELECT id FROM billing_invoices WHERE facility_id=$1)',
    [facilityId],
  );
  await run(
    'DELETE FROM billing_payments WHERE invoice_id IN (SELECT id FROM billing_invoices WHERE facility_id=$1)',
    [facilityId],
  );
  await run('DELETE FROM billing_invoices WHERE facility_id=$1', [facilityId]);
  await run('DELETE FROM encounters WHERE facility_id=$1', [facilityId]);
  await run('DELETE FROM appointments WHERE facility_id=$1', [facilityId]);
  await run('DELETE FROM patients WHERE registration_facility_id=$1', [facilityId]);
  await run('DELETE FROM audit_logs WHERE facility_id=$1', [facilityId]);

  const people = [
    ['Margaret', 'Wanjiku', 'Njoroge', 'FEMALE', '1979-04-12', '0700123001'],
    ['Joseph', 'Kariuki', 'Mwangi', 'MALE', '1966-11-02', '0700123002'],
    ['Halima', 'Amina', 'Yusuf', 'FEMALE', '1992-07-19', '0700123003'],
    ['Dennis', 'Omondi', 'Otieno', 'MALE', '1988-02-27', '0700123004'],
    ['Purity', 'Wambui', 'Kariuki', 'FEMALE', '2001-09-05', '0700123005'],
    ['Stephen', 'Muriithi', 'Kinyua', 'MALE', '1974-01-30', '0700123006'],
    ['Ruth', 'Nyambura', 'Githinji', 'FEMALE', '1996-06-14', '0700123007'],
    ['Ahmed', 'Hassan', 'Omar', 'MALE', '1983-12-08', '0700123008'],
    ['Catherine', 'Muthoni', 'Waweru', 'FEMALE', '1971-03-22', '0700123009'],
    ['Elijah', 'Kipchoge', 'Some', 'MALE', '1990-10-11', '0700123010'],
    ['Brenda', 'Achieng', 'Odongo', 'FEMALE', '1998-05-16', '0700123011'],
    ['Martin', 'Ngugi', 'Kamau', 'MALE', '1985-08-25', '0700123012'],
    ['Winnie', 'Wanjiru', 'Mbugua', 'FEMALE', '1993-04-03', '0700123013'],
    ['Titus', 'Mwenda', 'Kithinji', 'MALE', '1969-09-27', '0700123014'],
  ];
  const patientIds = [];
  let index = 1;
  for (const [first, middle, last, gender, dob, phone] of people) {
    const row = await one(
      `INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,middle_name,last_name,date_of_birth,
         gender,phone,county,blood_group,marital_status,occupation,created_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'Nyeri',$10,$11,$12,$13::timestamp) RETURNING id`,
      [
        tenantId,
        facilityId,
        `MRN-${String(90_001 + index++)}`,
        first,
        middle,
        last,
        dob,
        gender,
        phone,
        ['O+', 'A+', 'B+', 'AB+', 'O-'][index % 5],
        index % 3 === 0 ? 'MARRIED' : 'SINGLE',
        ['Teacher', 'Farmer', 'Trader', 'Nurse', 'Driver'][index % 5],
        `${iso(addDays(today, -(30 * index)))} 09:00:00`,
      ],
    );
    patientIds.push(row.id);
  }

  const appointmentTypes = ['Consultation', 'Review', 'Laboratory', 'Radiology', 'Pharmacy'];
  for (let position = 0; position < 12; position += 1) {
    await run(
      `INSERT INTO appointments(tenant_id,facility_id,patient_id,scheduled_time,duration_minutes,appointment_type,status,reason,booking_reference)
       VALUES($1,$2,$3,$4,20,$5,$6,'Synthetic documentation appointment',$7)`,
      [
        tenantId,
        facilityId,
        patientIds[position % patientIds.length],
        `${iso(today)} ${String(8 + (position % 9)).padStart(2, '0')}:${position % 2 ? '30' : '00'}`,
        appointmentTypes[position % appointmentTypes.length],
        position % 4 === 0 ? 'Checked In' : 'Scheduled',
        `SYN-APT-${1_000 + position}`,
      ],
    ).catch(() => undefined);
  }

  for (let position = 0; position < 8; position += 1) {
    await run(
      `INSERT INTO encounters(tenant_id,facility_id,patient_id,encounter_type,status,triage_category,chief_complaint,
         clinical_notes,started_at,created_by_user_id)
       VALUES($1,$2,$3,'OUTPATIENT','COMPLETED',$4,$5,$6,$7::timestamp,$8)`,
      [
        tenantId,
        facilityId,
        patientIds[position],
        ['GREEN', 'YELLOW', 'ORANGE'][position % 3],
        [
          'Fever and headache for three days',
          'Cough with chest tightness',
          'Lower abdominal pain',
          'Routine diabetes review',
        ][position % 4],
        'Synthetic clinical note for documentation captures. No real patient information.',
        `${iso(addDays(today, -(position % 4)))} 09:${String(10 + position).padStart(2, '0')}:00`,
        adminId,
      ],
    ).catch(() => undefined);
  }

  for (let position = 0; position < 10; position += 1) {
    const total = 1_500 + position * 750;
    const paid = position % 3 === 0 ? total : position % 3 === 1 ? Math.round(total / 2) : 0;
    const invoice = await one(
      `INSERT INTO billing_invoices(tenant_id,facility_id,patient_id,invoice_number,total_amount,paid_amount,balance_amount,status,created_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::timestamp) RETURNING id`,
      [
        tenantId,
        facilityId,
        patientIds[position],
        `SMC-INV-${2_500 + position}`,
        total,
        paid,
        total - paid,
        paid === total ? 'Paid' : paid ? 'Partially Paid' : 'Pending',
        `${iso(addDays(today, -(position % 7)))} 11:00:00`,
      ],
    ).catch(() => null);
    if (!invoice) continue;
    await run(
      'INSERT INTO billing_items(invoice_id,item_type,description,total_amount,created_at) VALUES($1,$2,$3,$4,$5::timestamp)',
      [
        invoice.id,
        'Consultation',
        'Outpatient consultation',
        total,
        `${iso(addDays(today, -(position % 7)))} 11:00:00`,
      ],
    ).catch(() => undefined);
    if (paid) {
      await run(
        "INSERT INTO billing_payments(invoice_id,receipt_number,payment_method,amount,cashier_name,payment_date) VALUES($1,$2,'Cash',$3,'Synthetic cashier',$4::timestamp)",
        [
          invoice.id,
          `SMC-RCP-${2_500 + position}`,
          paid,
          `${iso(addDays(today, -(position % 7)))} 11:30:00`,
        ],
      ).catch(() => undefined);
    }
  }

  for (let position = 0; position < 24; position += 1) {
    await run(
      'INSERT INTO audit_logs(tenant_id,facility_id,action,resource,timestamp) VALUES($1,$2,$3,$4,$5::timestamp)',
      [
        tenantId,
        facilityId,
        ['PATIENT_REGISTERED', 'PAYMENT_RECORDED', 'ENCOUNTER_OPENED', 'LAB_ORDER_CREATED'][position % 4],
        ['Patient', 'Invoice', 'Encounter', 'LabOrder'][position % 4],
        `${iso(addDays(today, -(position % 9)))} ${String(8 + (position % 9)).padStart(2, '0')}:${String(
          position % 60,
        ).padStart(2, '0')}:00`,
      ],
    ).catch(() => undefined);
  }
};

const main = async () => {
  const tenant = await one('SELECT id FROM tenants WHERE slug=$1', [SLUG]);
  if (!tenant) throw new Error(`Synthetic tenant ${SLUG} not found; run the workforce fixture first.`);
  const tenantId = tenant.id;
  const facility = await one('SELECT id FROM facilities WHERE tenant_id=$1 ORDER BY id LIMIT 1', [tenantId]);
  if (!facility) throw new Error('Synthetic facility not found.');
  const facilityId = facility.id;
  const adminId = (
    await one("SELECT id FROM users WHERE username='synthetic.admin' AND tenant_id=$1", [tenantId])
  ).id;
  const approverId = (
    await one("SELECT id FROM users WHERE username='synthetic.finance' AND tenant_id=$1", [tenantId])
  ).id;

  const ctx = { tenantId, facilityId, adminId, approverId };
  const ledger = await withGuardsSuspended(async () => {
    const seeded = await seedLedger(ctx);
    await seedWorkforce({ ...ctx, ledger: seeded });
    await seedClinical(ctx);
    return seeded;
  });
  console.log(
    JSON.stringify(
      {
        tenantId,
        facilityId,
        seeded: ['ledger', 'workforce', 'payroll', 'clinical'],
        accounts: Object.keys(ledger.accountIds).length,
        marker: randomUUID().slice(0, 8),
      },
      null,
      1,
    ),
  );
};

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => pool.end());
