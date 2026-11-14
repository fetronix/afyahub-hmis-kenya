/** User-supplied Syrona 2026 scenario. Projections, not actuals or verified statutory rates. */
export type BudgetRule = 'Manual' | '50% MoM' | 'Volume-Linked' | 'Linear +Step' | 'Revenue %';
export type BudgetDepartment = {
  id: string;
  name: string;
  kind: 'INCOME' | 'COGS' | 'OPEX';
  custom?: boolean;
};
export type BudgetLine = {
  code: string;
  name: string;
  departmentId: string;
  rule: BudgetRule;
  cells: string[];
  overrides: Record<string, string>;
  custom?: boolean;
  marginDepartmentId?: string;
};
export type FinancialBudget = {
  schemaVersion: 1;
  year: 2026;
  dialysisFeesAprDec: boolean;
  departments: BudgetDepartment[];
  rows: BudgetLine[];
};
export const budgetMonths = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
export function createFinancialBaseline(): FinancialBudget {
  const departments: BudgetDepartment[] = [
    ['consult', 'Medical Consultation', 'INCOME'],
    ['pharmacy', 'Pharmacy', 'INCOME'],
    ['lab', 'Laboratory', 'INCOME'],
    ['dental', 'Dental Services', 'INCOME'],
    ['antenatal', 'Antenatal & Family Planning', 'INCOME'],
    ['dialysis', 'Dialysis', 'INCOME'],
    ['surgery', 'Minor Surgery & Endoscopy', 'INCOME'],
    ['misc', 'Miscellaneous Income', 'INCOME'],
    ['cogs', 'Cost of Goods Sold (COGS)', 'COGS'],
    ['personnel', 'Personnel Expenses', 'OPEX'],
    ['admin', 'Administrative Expenses', 'OPEX'],
    ['depreciation', 'Depreciation & Amortization', 'OPEX'],
    ['governance', 'Governance', 'OPEX'],
  ].map(([id, name, kind]) => ({ id, name, kind: kind as BudgetDepartment['kind'] }));
  const rows: BudgetLine[] = [];
  const add = (
    departmentId: string,
    name: string,
    cells: (string | number)[],
    rule: BudgetRule = 'Manual',
    marginDepartmentId?: string,
  ) => {
    const income = departments.find((d) => d.id === departmentId)!.kind === 'INCOME';
    const code = `${income ? 'INC' : 'EXP'}-${String(rows.filter((r) => r.code.startsWith(income ? 'INC' : 'EXP')).length + 1).padStart(2, '0')}`;
    rows.push({
      code,
      name,
      departmentId,
      cells: cells.map(String),
      rule,
      overrides: {},
      ...(marginDepartmentId ? { marginDepartmentId } : {}),
    });
    return code;
  };
  const flat = (n: number) => Array(12).fill(n);
  const growth = (jan: number, apr: string | number, later: string | number) => [
    jan,
    '=PREV*1.50',
    '=PREV*1.50',
    apr,
    ...Array(8).fill(later),
  ];
  const sparse = (values: Record<number, number>) =>
    Array.from({ length: 12 }, (_, i) => values[i] ?? 0);
  const ref = (code: string, offset = 0) => `[${code}${offset ? '@' + offset : ''}]`;
  const general = add(
    'consult',
    'General Consultation',
    growth(18200, '=5*26*700', '=PREV+18200'),
    'Linear +Step',
  );
  const specialist = add(
    'consult',
    'Specialist Consultation',
    growth(10000, 65000, `=((${ref(general)}/700)/5)*2500`),
    'Volume-Linked',
  );
  add(
    'consult',
    'Follow Up Consultation Fees',
    growth(9100, `=${ref(general)}/2`, `=${ref(general)}/2`),
    'Volume-Linked',
  );
  add(
    'pharmacy',
    'Sale of Prescription Medication',
    growth(
      53000,
      `=(${ref(general)}*0.90)+(20*600)`,
      `=(((${ref(general)}/700)*0.90)*2000)+(2*600)`,
    ),
    'Volume-Linked',
  );
  add('pharmacy', 'Sale of OTC Medication', growth(7500, 39000, '=PREV+1500'), 'Linear +Step');
  add('pharmacy', 'Sale of Medical Supplies', growth(3000, 9000, 9000), '50% MoM');
  // Dental check-up is INC-11: forward references are resolved by the safe dependency engine.
  const haematology = add(
    'lab',
    'Haematology Analyzer',
    growth(
      19500,
      `=(((${ref(general)}/700)/2)*1000)+6000`,
      `=(((${ref(general)}/1000)/2)*1000)+((([INC-11@-1]/1500)*1000)+1000)`,
    ),
    'Volume-Linked',
  );
  rows.find((r) => r.code === haematology)!.cells[4] =
    `=(((${ref(general)}/700)/2)*1000)+((([INC-11@-1]/1500)*1000)+1000)`;
  add('lab', 'Biochemistry Analyzer', growth(7500, 22500, '=PREV+1500'), 'Linear +Step');
  add('lab', 'Immunoassay Analyzer', growth(4000, 20000, '=PREV+4000'), 'Linear +Step');
  add(
    'lab',
    'Rapid Kits',
    growth(10400, 53800, `=(${ref(general)}/700)*400+2100`),
    'Volume-Linked',
  );
  add(
    'dental',
    'Dental Check-ups & Consultation',
    growth(19600, 48000, '=PREV+1500'),
    'Linear +Step',
  );
  add('dental', 'Teeth Cleaning & Scaling', growth(15000, 36000, '=PREV+6000'), 'Linear +Step');
  add('dental', 'Tooth Extractions', growth(3750, 6000, '=PREV+1000'), 'Linear +Step');
  add('dental', 'Fillings & Restorations', growth(30000, 30000, '=PREV+6000'), 'Linear +Step');
  add('dental', 'Root Canal Treatment', growth(36000, 120000, 120000), '50% MoM');
  add(
    'dental',
    'Dentures & Other Dental Procedures',
    growth(20000, 30000, '=PREV+5000'),
    'Linear +Step',
  );
  add('antenatal', 'Antenatal Care Visits', growth(4800, 28800, 28800), '50% MoM');
  const ultrasound = add(
    'antenatal',
    'Ultrasound Services',
    growth(30000, 32000, '=PREV+2000'),
    'Linear +Step',
  );
  add('antenatal', 'Baby Growth Monitoring & Vaccinations', flat(500));
  add('antenatal', 'Family Planning Consultations', growth(2900, 5800, 5800), '50% MoM');
  const dialysis = add(
    'dialysis',
    'Dialysis Sessions',
    [0, 0, 168000, ...Array(9).fill('=PREV+84000')],
    'Linear +Step',
  );
  add(
    'dialysis',
    'Laboratory Fees Dialysis',
    [0, 0, 10400, ...Array(9).fill('=PREV+5200')],
    'Linear +Step',
  );
  add('dialysis', 'Dialysis Consumables', flat(0));
  add('surgery', 'Procedure Fees', growth(1500, 4500, 4500), '50% MoM');
  add('surgery', 'Post Surgery Follow-up Fees', flat(0));
  const ogd = add('surgery', 'OGD Colonoscopy', flat(67000));
  add('misc', 'Registration Fees for New Patients', flat(0));
  add('misc', 'Insurance Reimbursements', flat(0));
  add('misc', 'Sales of Additional Health Products', flat(200));
  add(
    'cogs',
    'Purchase of Prescription & OTC Drugs',
    sparse({ 0: 14400, 3: 50000, 4: 50000, 5: 50000 }),
    'Manual',
    'pharmacy',
  );
  add('cogs', 'Laboratory Reagents & Consumables', sparse({ 5: 82950, 7: 51660 }), 'Manual', 'lab');
  add(
    'cogs',
    'Dental Supplies',
    sparse({ 0: 2310, 4: 10867, 8: 2992, 11: 22207.5 }),
    'Manual',
    'dental',
  );
  add('cogs', 'Minor Surgery Supplies', sparse({ 0: 700 }), 'Manual', 'surgery');
  add('cogs', 'Antenatal Supplies', sparse({ 0: 1065 }), 'Manual', 'antenatal');
  add('cogs', 'Dialysis Consumables', flat(0), 'Manual', 'dialysis');
  add(
    'cogs',
    'Medical Consultation Consumables',
    sparse({ 1: 16965, 2: 19184, 3: 8877.75, 4: 2205, 6: 12143.25, 9: 2808.75, 11: 9042.6 }),
    'Manual',
    'consult',
  );
  add('cogs', 'Miscellaneous COGS', flat(0), 'Manual', 'misc');
  add('personnel', 'Basic Salary', [65000, 65000, 65000, ...Array(9).fill(100000)]);
  for (const name of [
    'House Allowance',
    'Medical Allowance',
    'Staff Bonus',
    'Pension',
    'NSSF Employer',
    'Housing Levy Employer',
    'SHIF Employer',
    'NITA Levy',
    'Staff Training/Welfare',
  ])
    add('personnel', name, flat(0));
  add('admin', 'Rent Expense', flat(80000));
  add('admin', 'Insurance Expense', sparse({ 1: 96000 }));
  add('admin', 'Repairs & Maintenance Equipment', sparse({ 2: 150000 }));
  add('admin', 'Repairs & Maintenance Computers', sparse({ 1: 10000 }));
  add('admin', 'Repairs & Maintenance Buildings', flat(1000));
  add('admin', 'Repairs & Maintenance Furniture', flat(1000));
  add('admin', 'Water & Electricity', flat(7000));
  add('admin', 'Cleaning Expense', flat(7000));
  add('admin', 'Internet Expenses', flat(2500));
  add('admin', 'Telephone Expense', flat(500));
  add('admin', 'Postage Expenses', flat(500));
  add('admin', 'Business & Council Fees', sparse({ 0: 11300 }));
  add('admin', 'Legal Expenses', flat(2500));
  add('admin', 'Travelling Expenses', flat(2000));
  add(
    'admin',
    'Printing & Stationery',
    [8996, 420, 919, 84, 283, 766.5, 582.75, 168, 3737.5, 0, 0, 0],
  );
  add('admin', 'Advertising & Marketing', [1000, 1000, 1000, ...Array(9).fill(5000)]);
  add('admin', 'Annual Subscription Fees', sparse({ 0: 40000 }));
  add('admin', 'Branding', [9345, 6195, 6825, ...Array(9).fill(0)]);
  add('admin', 'Sundry Expense', flat(3000));
  const professionalBase = `(${ref(specialist)}*0.60)+(${ref(ultrasound)}*0.80)+(${ref(ogd)}*0.70)`;
  add(
    'admin',
    'Professional Fees & Expenses',
    Array.from(
      { length: 12 },
      (_, m) =>
        `=${professionalBase}${m < 3 ? `+(${ref(haematology)}*0.50)` : ''}${m === 2 ? `+(${ref(dialysis)}*0.70)` : ''}`,
    ),
    'Revenue %',
  );
  add('depreciation', 'Depreciation Medical Equipment', flat(11662.09));
  add('depreciation', 'Depreciation Computers H-W', flat(3948.34));
  add('depreciation', 'Depreciation Furniture & Fittings', flat(1897.5));
  for (const name of [
    'Board Meeting',
    'Board Allowance',
    'Audit Fees',
    'AGM',
    'Executive Meetings',
  ])
    add('governance', name, flat(0));
  return { schemaVersion: 1, year: 2026, dialysisFeesAprDec: false, departments, rows };
}
export function effectiveFormula(model: FinancialBudget, line: BudgetLine, month: number) {
  const base = line.cells[month];
  return line.code === 'EXP-38' && month >= 3 && model.dialysisFeesAprDec
    ? `${base}+([INC-21]*0.70)`
    : base;
}
