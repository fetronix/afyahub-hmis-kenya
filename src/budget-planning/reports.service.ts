import * as XLSX from '@e965/xlsx';
import { pool } from '../db/index.ts';
import {
  resolveActiveLetterhead,
  resolveLetterheadVersion,
} from '../branding/letterhead.service.ts';
import { renderDocument } from '../documents/render.ts';
import type { DocumentModel, DocumentFacility } from '../documents/document-model.ts';
import { assert, id, decimal, year } from './calculations.ts';
import { transaction, scopedPlan, event, type PlanningScope } from './planning.service.ts';
type Query = Record<string, unknown>;
function date(value: unknown) {
  const s = String(value);
  assert(
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
      !Number.isNaN(Date.parse(s)) &&
      new Date(s).toISOString().slice(0, 10) === s,
    'INVALID_DATE',
    'Use a real date in YYYY-MM-DD format.',
  );
  return s;
}
export async function projection(s: PlanningScope, planId: unknown, q: Query = {}) {
  return transaction(async (c) => {
    await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const plan = await scopedPlan(c, s, planId);
    if (q.year)
      assert(
        plan.financial_year === year(q.year),
        'YEAR_MISMATCH',
        'Selected year does not match this plan.',
      );
    if (q.status)
      assert(
        plan.status === q.status,
        'STATUS_MISMATCH',
        'Selected status does not match this plan.',
      );
    let month: number | null = null;
    if (q.month !== undefined && q.month !== '') {
      month = Number(q.month);
      assert(
        Number.isInteger(month) && month >= 1 && month <= 12,
        'INVALID_MONTH',
        'Choose January through December.',
      );
    }
    const from = q.from ? date(q.from) : null,
      to = q.to ? date(q.to) : null;
    assert(!from || !to || from <= to, 'INVALID_RANGE', 'Start date must not be after end date.');
    const categories = (
      await c.query('SELECT * FROM planning_categories WHERE plan_id=$1 ORDER BY name,id', [
        plan.id,
      ])
    ).rows;
    const params: unknown[] = [plan.id];
    const where = ['i.plan_id=$1', 'i.is_active'];
    if (q.categoryId) {
      params.push(id(q.categoryId));
      where.push(`i.category_id=$${params.length}`);
    }
    for (const [field, key] of [
      ['description', 'search'],
      ['unit', 'unit'],
    ] as const)
      if (q[key]) {
        params.push('%' + String(q[key]).slice(0, 200) + '%');
        where.push(`i.${field} ILIKE $${params.length}`);
      }
    if (q.itemId) {
      params.push(id(q.itemId));
      where.push(`i.id=$${params.length}`);
    }
    const raw = (
      await c.query(
        `SELECT i.*,cat.name AS category_name FROM planning_items i JOIN planning_categories cat ON cat.id=i.category_id WHERE ${where.join(' AND ')} ORDER BY i.id LIMIT 5001`,
        params,
      )
    ).rows;
    assert(
      raw.length <= 5000,
      'REPORT_TOO_LARGE',
      'Plan exceeds 5000 matching items. Narrow the filters.',
    );
    const allMonths = raw.length
      ? (
          await c.query(
            'SELECT *,planned_month::text AS month FROM planning_months WHERE item_id=ANY($1::int[]) ORDER BY item_id,planned_month',
            [raw.map((r) => r.id)],
          )
        ).rows
      : [];
    const selected = (m: Record<string, any>) =>
      (month === null || Number(String(m.month).slice(5, 7)) === month) &&
      (!from || m.month >= from) &&
      (!to || m.month <= to);
    const items = raw.map((item) => {
      const months = allMonths.filter((m) => m.item_id === item.id);
      const chosen = months.filter(selected);
      return {
        ...item,
        months: chosen,
        annual_total_cents: months.reduce((n, m) => n + BigInt(m.amount_cents ?? 0), 0n).toString(),
        selected_total_cents: chosen
          .reduce((n, m) => n + BigInt(m.amount_cents ?? 0), 0n)
          .toString(),
        blank_months: chosen.filter((m) => m.quantity === null).length,
      };
    });
    const uniforms =
      q.unit || q.itemId
        ? []
        : (
            await c.query(
              "SELECT u.*,c.name AS category_name FROM planning_uniforms u JOIN planning_categories c ON c.id=u.category_id WHERE u.plan_id=$1 AND u.is_active AND ($2::int IS NULL OR u.category_id=$2) AND ($3::text='' OR u.description ILIKE $3) ORDER BY u.description,u.id",
              [
                plan.id,
                q.categoryId ? id(q.categoryId) : null,
                q.search ? '%' + String(q.search).slice(0, 200) + '%' : '',
              ],
            )
          ).rows;
    const selectedTotal = items.reduce((n, i) => n + BigInt(i.selected_total_cents), 0n),
      annualTotal = items.reduce((n, i) => n + BigInt(i.annual_total_cents), 0n),
      uniformTotal = uniforms.reduce((n, u) => n + BigInt(u.total_cents), 0n);
    const categoryTotals = categories.map((cat) => ({
      id: cat.id,
      name: cat.name,
      itemCents: items
        .filter((i) => i.category_id === cat.id)
        .reduce((n, i) => n + BigInt(i.selected_total_cents), 0n)
        .toString(),
      uniformAnnualCents: uniforms
        .filter((u) => u.category_id === cat.id)
        .reduce((n, u) => n + BigInt(u.total_cents), 0n)
        .toString(),
    }));
    const sort = String(q.sort ?? 'description');
    assert(
      ['description', 'unit', 'price', 'annual'].includes(sort),
      'INVALID_SORT',
      'Unsupported sorting field.',
    );
    const direction = q.direction === 'desc' ? -1 : 1;
    items.sort((a, b) => {
      const x =
          sort === 'price'
            ? BigInt(a.adjusted_price_cents)
            : sort === 'annual'
              ? BigInt(a.annual_total_cents)
              : String(a[sort]).toLocaleLowerCase(),
        y =
          sort === 'price'
            ? BigInt(b.adjusted_price_cents)
            : sort === 'annual'
              ? BigInt(b.annual_total_cents)
              : String(b[sort]).toLocaleLowerCase();
      return (x < y ? -1 : x > y ? 1 : a.id - b.id) * direction;
    });
    const page = Number(q.page ?? 1);
    assert(
      Number.isInteger(page) && page > 0 && page <= 100000,
      'INVALID_PAGE',
      'Choose a valid page.',
    );
    const pendingReviews = (
      await c.query(
        "SELECT count(*)::int n FROM planning_plans WHERE tenant_id=$1 AND facility_id=$2 AND status='REVIEW'",
        [s.tenantId, s.facilityId],
      )
    ).rows[0].n;
    const imports = (
      await c.query(
        "SELECT count(*) FILTER(WHERE status='UPLOADED')::int pending,count(*) FILTER(WHERE status='IMPORTED')::int imported,count(*) FILTER(WHERE status='CANCELLED')::int cancelled FROM planning_import_batches WHERE tenant_id=$1 AND facility_id=$2",
        [s.tenantId, s.facilityId],
      )
    ).rows[0];
    return {
      facilityOverview: { pendingReviews, imports },
      plan,
      categories,
      items: q.all === true ? items : items.slice((page - 1) * 20, page * 20),
      uniforms,
      categoryTotals,
      totalItems: items.length,
      page,
      summary: {
        selectedItemCents: selectedTotal.toString(),
        annualItemCents: annualTotal.toString(),
        uniformAnnualCents: uniformTotal.toString(),
        annualCombinedCents: (annualTotal + uniformTotal).toString(),
        blankMonths: items.reduce((n, i) => n + i.blank_months, 0),
        itemCount: items.length,
        uniformCount: uniforms.length,
      },
      filters: {
        month,
        from,
        to,
        categoryId: q.categoryId ?? null,
        search: q.search ?? '',
        unit: q.unit ?? '',
        status: plan.status,
        year: plan.financial_year,
      },
      notice:
        'Projected procurement budgets only: not inventory, purchase orders, goods received, expenditure, settlement or payment. Blank quantities are unplanned; known totals are partial. Monthly dates represent the first day of the planned month. Uniform budgets are annual and are not invented as monthly/daily allocations.',
    };
  });
}
export type Projection = Awaited<ReturnType<typeof projection>>;
export async function createReport(s: PlanningScope, planId: unknown, q: Query) {
  const type = String(q.reportType ?? 'ANNUAL');
  assert(
    ['ANNUAL', 'MONTHLY', 'CATEGORY', 'ITEM', 'BRANDING', 'YOY', 'ACTUAL'].includes(type),
    'REPORT_TYPE',
    'Choose a supported report type.',
  );
  assert(
    type !== 'ACTUAL',
    'ACTUALS_NOT_AVAILABLE',
    'Verified actual-expenditure attribution to planning items is not implemented. No budget-versus-actual figures can be generated.',
    409,
  );
  if (type === 'MONTHLY')
    assert(q.month, 'MONTH_REQUIRED', 'Select a month for the monthly projection.');
  const data = await projection(s, planId, { ...q, all: true });
  const head = await resolveActiveLetterhead(s.tenantId, s.facilityId);
  assert(
    head?.bytes,
    'ACTIVE_LETTERHEAD_REQUIRED',
    'Upload and activate the facility letterhead in existing Facility Branding before issuing a report.',
    409,
  );
  const facility = (
    await pool.query(
      'SELECT name,code,mfl_code AS "registryCode",address,county,phone,email FROM facilities WHERE id=$1 AND tenant_id=$2',
      [s.facilityId, s.tenantId],
    )
  ).rows[0] as DocumentFacility;
  assert(facility, 'FACILITY_NOT_FOUND', 'Facility not found.', 404);
  const now = new Date().toISOString();
  const titles: Record<string, string> = {
    ANNUAL: 'Annual Budget Plan',
    MONTHLY: 'Monthly Budget Projection',
    CATEGORY: 'Category Budget Summary',
    ITEM: 'Item-Level Projection',
    BRANDING: 'Branding and Uniform Projection',
    YOY: 'Year-on-Year Budget Comparison',
  };
  let rows: string[][] = data.items.map((i) => [
      i.description,
      i.category_name,
      i.unit,
      decimal(i.adjusted_price_cents),
      decimal(i.selected_total_cents),
      decimal(i.annual_total_cents),
    ]),
    columns = [
      { label: 'Item', width: 0.3 },
      { label: 'Category', width: 0.2 },
      { label: 'Unit', width: 0.09 },
      { label: 'Price', width: 0.13 },
      { label: 'Selected', width: 0.14 },
      { label: 'Annual', width: 0.14 },
    ];
  if (type === 'CATEGORY') {
    columns = [
      { label: 'Category', width: 0.5 },
      { label: 'Item projections', width: 0.25 },
      { label: 'Annual uniforms', width: 0.25 },
    ];
    rows = data.categoryTotals.map((c) => [
      c.name,
      decimal(c.itemCents),
      decimal(c.uniformAnnualCents),
    ]);
  }
  if (type === 'BRANDING') {
    // Category selection is explicit; do not guess branding from item names.
    assert(
      data.plan.plan_type === 'BRANDING' || q.categoryId,
      'BRANDING_CATEGORY_REQUIRED',
      'Select the branding category or a dedicated BRANDING plan. Classification is not guessed from source descriptions.',
    );
    rows.push(
      ...data.uniforms.map((u) => [
        u.description,
        u.category_name,
        'Uniform',
        decimal(u.buying_cost_cents),
        'Annual only',
        decimal(u.total_cents),
      ]),
    );
  }
  if (type === 'YOY') {
    assert(
      !q.month && !q.from && !q.to && !q.categoryId && !q.search && !q.unit && !q.itemId,
      'YOY_FULL_YEAR_REQUIRED',
      'Year-on-year compares complete annual plans. Clear month/date/category/item/search/unit filters.',
    );
    const prior = await projection(s, id(q.priorPlanId), { all: true });
    assert(
      prior.plan.financial_year === data.plan.financial_year - 1 &&
        prior.plan.currency === data.plan.currency &&
        prior.plan.plan_type === data.plan.plan_type,
      'PRIOR_PLAN_MISMATCH',
      'Choose a prior-year plan with the same currency and type.',
    );
    columns = [
      { label: 'Plan', width: 0.5 },
      { label: 'Year', width: 0.15 },
      { label: 'Annual planned budget', width: 0.35 },
    ];
    rows = [
      [
        prior.plan.name,
        String(prior.plan.financial_year),
        decimal(prior.summary.annualCombinedCents),
      ],
      [data.plan.name, String(data.plan.financial_year), decimal(data.summary.annualCombinedCents)],
    ];
  }
  const model: DocumentModel = {
    kind: 'BUDGET_PLAN',
    title: titles[type],
    documentNumber: `PLAN-${data.plan.id}-V${data.plan.version}`,
    issuedAt: now,
    facility,
    leftFields: [
      { label: 'Plan', value: data.plan.name },
      {
        label: 'Financial year / currency',
        value: `${data.plan.financial_year} / ${data.plan.currency}`,
      },
      { label: 'Status / revision', value: `${data.plan.status} / ${data.plan.version}` },
    ],
    rightFields: [
      {
        label: 'Month / dates',
        value: `${q.month || 'All'} / ${q.from || 'Start of year'} – ${q.to || 'End of year'}`,
      },
      {
        label: 'Category',
        value: q.categoryId
          ? (data.categories.find((c) => c.id === Number(q.categoryId))?.name ??
            'No matching category')
          : 'All',
      },
      { label: 'Generated', value: now },
      { label: 'Item / unit search', value: `${q.search || 'All'} / ${q.unit || 'All'}` },
    ],
    table: { columns, rows, repeatHeader: true },
    totals:
      type === 'YOY'
        ? []
        : type === 'BRANDING'
          ? [
              {
                label: 'Annual uniforms (in addition to item rows)',
                value: `${data.plan.currency} ${decimal(data.summary.uniformAnnualCents)}`,
              },
            ]
          : [
              {
                label: 'Selected item projections (known values)',
                value: `${data.plan.currency} ${decimal(data.summary.selectedItemCents)}`,
              },
              {
                label: 'Annual uniforms (unallocated by month)',
                value: `${data.plan.currency} ${decimal(data.summary.uniformAnnualCents)}`,
              },
            ],
    notes: [
      data.notice,
      `Plan inflation assumption: ${decimal(BigInt(data.plan.inflation_bp))}%. Item overrides are retained. Adjusted prices rounded half-up to currency cents; quantity precision 0.001; each monthly amount rounded before summation. Blank months in this selection: ${data.summary.blankMonths}.`,
      'Uniform method: staff × quantity per staff, explicitly selected opening-balance treatment, gross purchase cost less explicit percentage staff contribution. No source formula is executed.',
    ],
    brandingNote: head.label,
  };
  // A small inner inset keeps font ascenders inside the uploaded body rectangle.
  // Shared renderer/storage remain unchanged; the issued bytes retain this layout.
  const rendered = await renderDocument(model, {
    ...head,
    bodyTopPt: head.bodyTopPt + 4,
    bodyLeftPt: head.bodyLeftPt + 4,
    bodyRightPt: head.bodyRightPt + 4,
  });
  const report = await transaction(async (c) => {
    const row = (
      await c.query(
        'INSERT INTO planning_reports(tenant_id,facility_id,plan_id,report_type,filters,model,export_data,letterhead_id,pdf_bytes,generated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id,created_at,letterhead_id',
        [
          s.tenantId,
          s.facilityId,
          data.plan.id,
          type,
          JSON.stringify({
            ...data.filters,
            reportType: type,
            priorPlanId: q.priorPlanId ?? null,
            itemId: q.itemId ?? null,
            sort: q.sort ?? 'description',
            direction: q.direction ?? 'asc',
          }),
          JSON.stringify(model),
          JSON.stringify(data),
          head.id,
          rendered.bytes,
          s.actorId,
        ],
      )
    ).rows[0];
    await event(c, s, 'ISSUE_REPORT', data.plan.id, {
      entity: 'report',
      entityId: row.id,
      updated: {
        type,
        planVersion: data.plan.version,
        letterheadId: head.id,
        pages: rendered.pages,
      },
    });
    return row;
  });
  return { ...report, pages: rendered.pages, letterheadApplied: rendered.letterheadApplied };
}
export async function reportHistory(s: PlanningScope, planId: unknown) {
  await transaction((c) => scopedPlan(c, s, planId));
  return (
    await pool.query(
      'SELECT id,report_type,filters,letterhead_id,generated_by,created_at FROM planning_reports WHERE plan_id=$1 AND tenant_id=$2 AND facility_id=$3 ORDER BY id DESC LIMIT 100',
      [id(planId), s.tenantId, s.facilityId],
    )
  ).rows;
}
export async function reportFile(s: PlanningScope, reportId: unknown, format: 'pdf' | 'xlsx') {
  const r = (
    await pool.query(
      'SELECT * FROM planning_reports WHERE id=$1 AND tenant_id=$2 AND facility_id=$3',
      [id(reportId), s.tenantId, s.facilityId],
    )
  ).rows[0];
  assert(r, 'REPORT_NOT_FOUND', 'Report not found in this facility.', 404);
  if (format === 'pdf') return r.pdf_bytes as Buffer;
  const data = r.export_data as Projection;
  const workbook = XLSX.utils.book_new();
  const append = (name: string, rows: Array<Array<string | number | null>>) =>
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name);
  append('Report', [
    [r.model.title],
    ['Facility', r.model.facility.name],
    ['Year', data.plan.financial_year],
    ['Currency', data.plan.currency],
    ['Status', data.plan.status],
    ['Inflation percent', data.plan.inflation_bp / 100],
    ['Letterhead version ID', r.letterhead_id],
    ['Generated', String(r.created_at)],
    ['Limitations', data.notice],
  ]);
  append('Issued report rows', [
    r.model.table?.columns.map((c: { label: string }) => c.label) ?? [],
    ...(r.model.table?.rows ?? []),
  ]);
  append(
    'Active filters',
    Object.entries(r.filters).map(([key, value]) => [key, value === null ? '' : String(value)]),
  );
  append('Items', [
    [
      'Description',
      'Category',
      'Unit',
      'Base price',
      'Inflation percent',
      'Adjusted price',
      'Selected total',
      'Annual total',
      'Source sheet',
      'Source row',
    ],
    ...data.items.map((i) => [
      i.description,
      i.category_name,
      i.unit,
      Number(decimal(i.base_price_cents)),
      (i.inflation_bp ?? data.plan.inflation_bp) / 100,
      Number(decimal(i.adjusted_price_cents)),
      Number(decimal(i.selected_total_cents)),
      Number(decimal(i.annual_total_cents)),
      i.source_worksheet ?? '',
      i.source_row ?? null,
    ]),
  ]);
  append('Months', [
    ['Item', 'Planned month', 'Quantity (blank = unplanned)', 'Price', 'Amount'],
    ...data.items.flatMap((i) =>
      i.months.map((m: Record<string, any>) => [
        i.description,
        m.month,
        m.quantity === null ? null : Number(m.quantity),
        Number(decimal(m.unit_price_cents)),
        m.amount_cents === null ? null : Number(decimal(m.amount_cents)),
      ]),
    ),
  ]);
  append('Uniforms', [
    [
      'Uniform',
      'Category',
      'Opening balance',
      'Balance label',
      'Buying cost',
      'Contribution percent',
      'Staff',
      'Per staff',
      'Balance rule',
      'Projected quantity',
      'Purchase quantity',
      'Gross cost',
      'Contribution',
      'Net annual budget',
      'Source sheet',
      'Source row',
    ],
    ...data.uniforms.map((u) => [
      u.description,
      u.category_name,
      Number(u.existing_balance),
      u.balance_label,
      Number(decimal(u.buying_cost_cents)),
      u.contribution_bp / 100,
      u.staff_count,
      Number(u.quantity_per_staff),
      u.balance_rule,
      Number(u.projected_quantity),
      Number(u.purchase_quantity),
      Number(decimal(u.gross_cents)),
      Number(decimal(u.contribution_cents)),
      Number(decimal(u.total_cents)),
      u.source_worksheet ?? '',
      u.source_row ?? null,
    ]),
  ]);
  return XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' }) as Buffer;
}
/** Verifies retained branding remains resolvable; PDF itself is immutable issued bytes. */
export async function historicalBranding(s: PlanningScope, reportId: number) {
  const row = (
    await pool.query(
      'SELECT letterhead_id FROM planning_reports WHERE id=$1 AND tenant_id=$2 AND facility_id=$3',
      [reportId, s.tenantId, s.facilityId],
    )
  ).rows[0];
  assert(row, 'REPORT_NOT_FOUND', 'Report not found.', 404);
  return row.letterhead_id
    ? resolveLetterheadVersion(s.tenantId, s.facilityId, row.letterhead_id)
    : null;
}
