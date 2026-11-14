/**
 * Workforce routes — HR, attendance, leave and payroll.
 *
 * Every handler resolves the facility through `requireScopedFacility`, so a
 * facility id in the query string or body is only a hint. Permissions are
 * declared per route; payroll approval is separate from payroll preparation,
 * and recording the statutory versions is a further privileged action.
 */

import { requireFacilityModule } from '../middleware/facility-module.middleware.ts';
import { Router, type Response } from 'express';

import { type AuthRequest } from '../auth/auth.middleware.ts';
import { requireAnyPermission, requirePermission } from '../auth/authorization.middleware.ts';
import * as workforce from '../workforce/workforce.service.ts';
import { respondInternalError } from './shared/errors.ts';
import { requireScopedFacility } from './shared/scoping.ts';

const router = Router();
router.use('/api/hr', requireFacilityModule('hr'));
router.use('/api/payroll', requireFacilityModule('payroll'));
router.use(['/api/hr', '/api/payroll'], (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

type Access = workforce.WorkforceScope;

async function scope(
  req: AuthRequest,
  res: Response,
  rawFacilityId: unknown,
): Promise<Access | null> {
  const context = req.authContext;
  if (!context || !req.user) {
    res.status(401).json({
      success: false,
      error: 'AUTHORIZATION_CONTEXT_MISSING',
      message: 'Authorization context is required.',
    });
    return null;
  }
  if (context.isSuperAdmin || context.roles.includes('SUPER_ADMIN')) {
    res.status(403).json({
      success: false,
      error: 'FACILITY_WORKFORCE_USER_REQUIRED',
      message: 'Use an authorized facility account for workforce and payroll records.',
    });
    return null;
  }
  const facility = await requireScopedFacility(req, res, rawFacilityId);
  if (!facility) return null;
  return {
    tenantId: facility.tenantId,
    facilityId: facility.id,
    actorId: context.userId,
    actorName: req.user.fullName || req.user.username,
  };
}

function idParam(req: AuthRequest, res: Response, label = 'record'): number | null {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    res.status(400).json({
      success: false,
      error: 'INVALID_ID',
      message: `A valid ${label} ID is required.`,
    });
    return null;
  }
  return id;
}

function handleError(res: Response, err: unknown, route: string) {
  if (err instanceof workforce.WorkforceError) {
    res.status(err.statusCode).json({ success: false, error: err.code, message: err.message });
    return;
  }
  if (err instanceof Error && err.name === 'PayrollCalculationError') {
    const status = (err as { status?: number }).status ?? 409;
    res.status(status).json({
      success: false,
      error: (err as { code?: string }).code ?? 'PAYROLL_RULES_UNAVAILABLE',
      message: err.message,
    });
    return;
  }
  if (err instanceof Error && err.name === 'AccountingIntegrityError') {
    const status = (err as { statusCode?: number }).statusCode ?? 409;
    res.status(status).json({
      success: false,
      error: (err as { code?: string }).code ?? 'LEDGER_POSTING_REFUSED',
      message: err.message,
    });
    return;
  }
  // Drizzle wraps driver errors, so look through the cause chain rather than
  // reporting a 500 for a constraint the user can act on.
  let code: string | undefined;
  let cursor: unknown = err;
  for (let depth = 0; depth < 4 && cursor; depth += 1) {
    const candidate = cursor as { code?: unknown; cause?: unknown };
    if (typeof candidate.code === 'string') {
      code = candidate.code;
      break;
    }
    cursor = candidate.cause;
  }
  if (code === '23505') {
    res.status(409).json({
      success: false,
      error: 'DUPLICATE_RECORD',
      message: 'A record with that code, number or effective date already exists in this facility.',
    });
    return;
  }
  if (code === '23514' || code === '23503' || code === '23502' || code === '22003') {
    res.status(400).json({
      success: false,
      error: 'DATABASE_CONSTRAINT',
      message: 'The record conflicts with a data rule. Check the values and try again.',
    });
    return;
  }
  respondInternalError(res, err, route);
}

const body = (req: AuthRequest) => (req.body ?? {}) as Record<string, unknown>;
// HR duty alone is not a salary/payslip grant. Never rely on hiding a table column.
function hrView(req: AuthRequest, value: unknown): unknown {
  if (req.authContext?.permissions.includes('payroll.read') && !req.authContext.isSuperAdmin)
    return value;
  if (Array.isArray(value)) return value.map((v) => hrView(req, v));
  if (!value || typeof value !== 'object' || value instanceof Date) return value;
  const sensitive = new Set([
    'baseSalaryCents',
    'monthlyBasicCents',
    'kraPin',
    'nssfNumber',
    'shifNumber',
    'bankName',
    'bankAccountMasked',
    'nationalId',
    'components',
    'payslips',
  ]);
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k, sensitive.has(k) ? null : hrView(req, v)]),
  );
}
function salaryWriteAllowed(req: AuthRequest, res: Response) {
  if ('baseSalaryCents' in body(req) && !req.authContext?.permissions.includes('payroll.manage')) {
    res.status(403).json({
      success: false,
      error: 'PAYROLL_SALARY_PERMISSION_REQUIRED',
      message: 'Payroll preparation permission is required to set salary.',
    });
    return false;
  }
  return true;
}

/* ============================================================
   OVERVIEW, DEPARTMENTS, DESIGNATIONS
   ============================================================ */

router.get(
  '/api/hr/overview',
  requirePermission('hr.read'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, req.query.facilityId);
    if (!access) return;
    try {
      res.json(hrView(req, await workforce.workforceOverview(access)));
    } catch (err) {
      handleError(res, err, 'GET /api/hr/overview');
    }
  },
);

router.get(
  '/api/hr/departments',
  requirePermission('hr.read'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, req.query.facilityId);
    if (!access) return;
    try {
      res.json(await workforce.listDepartments(access));
    } catch (err) {
      handleError(res, err, 'GET /api/hr/departments');
    }
  },
);

router.post(
  '/api/hr/departments',
  requirePermission('hr.manage'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, body(req).facilityId ?? req.query.facilityId);
    if (!access) return;
    try {
      res.status(201).json(await workforce.createDepartment(access, body(req)));
    } catch (err) {
      handleError(res, err, 'POST /api/hr/departments');
    }
  },
);

router.put(
  '/api/hr/departments/:id',
  requirePermission('hr.manage'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, body(req).facilityId ?? req.query.facilityId);
    if (!access) return;
    const id = idParam(req, res, 'department');
    if (!id) return;
    try {
      res.json(await workforce.updateDepartment(access, id, body(req)));
    } catch (err) {
      handleError(res, err, 'PUT /api/hr/departments/:id');
    }
  },
);

router.get(
  '/api/hr/designations',
  requirePermission('hr.read'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, req.query.facilityId);
    if (!access) return;
    try {
      res.json(await workforce.listDesignations(access));
    } catch (err) {
      handleError(res, err, 'GET /api/hr/designations');
    }
  },
);

router.post(
  '/api/hr/designations',
  requirePermission('hr.manage'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, body(req).facilityId ?? req.query.facilityId);
    if (!access) return;
    try {
      res.status(201).json(await workforce.createDesignation(access, body(req)));
    } catch (err) {
      handleError(res, err, 'POST /api/hr/designations');
    }
  },
);

/* ============================================================
   EMPLOYEES
   ============================================================ */

router.get(
  '/api/hr/employees',
  requirePermission('hr.read'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, req.query.facilityId);
    if (!access) return;
    try {
      const departmentId = req.query.departmentId ? Number(req.query.departmentId) : undefined;
      res.json(
        hrView(
          req,
          await workforce.listEmployees(access, {
            search: typeof req.query.search === 'string' ? req.query.search : undefined,
            status: typeof req.query.status === 'string' ? req.query.status : undefined,
            departmentId:
              Number.isSafeInteger(departmentId) && departmentId! > 0 ? departmentId : undefined,
          }),
        ),
      );
    } catch (err) {
      handleError(res, err, 'GET /api/hr/employees');
    }
  },
);

router.get(
  '/api/hr/employees/:id',
  requirePermission('hr.read'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, req.query.facilityId);
    if (!access) return;
    const id = idParam(req, res, 'employee');
    if (!id) return;
    try {
      res.json(hrView(req, await workforce.employeeDetail(access, id)));
    } catch (err) {
      handleError(res, err, 'GET /api/hr/employees/:id');
    }
  },
);

router.post(
  '/api/hr/employees',
  requirePermission('hr.manage'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, body(req).facilityId ?? req.query.facilityId);
    if (!access) return;
    try {
      if (!salaryWriteAllowed(req, res)) return;
      res.status(201).json(hrView(req, await workforce.createEmployee(access, body(req))));
    } catch (err) {
      handleError(res, err, 'POST /api/hr/employees');
    }
  },
);

router.put(
  '/api/hr/employees/:id',
  requirePermission('hr.manage'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, body(req).facilityId ?? req.query.facilityId);
    if (!access) return;
    const id = idParam(req, res, 'employee');
    if (!id) return;
    try {
      if (!salaryWriteAllowed(req, res)) return;
      const prior = await workforce.employeeDetail(access, id);
      res.json(
        hrView(
          req,
          await workforce.updateEmployee(access, id, {
            ...body(req),
            baseSalaryCents: body(req).baseSalaryCents ?? prior.baseSalaryCents,
          }),
        ),
      );
    } catch (err) {
      handleError(res, err, 'PUT /api/hr/employees/:id');
    }
  },
);

router.post(
  '/api/hr/employees/:id/status',
  requirePermission('hr.manage'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, body(req).facilityId ?? req.query.facilityId);
    if (!access) return;
    const id = idParam(req, res, 'employee');
    if (!id) return;
    try {
      res.json(hrView(req, await workforce.changeEmployeeStatus(access, id, body(req))));
    } catch (err) {
      handleError(res, err, 'POST /api/hr/employees/:id/status');
    }
  },
);

router.post(
  '/api/hr/employees/:id/documents',
  requirePermission('hr.manage'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, body(req).facilityId ?? req.query.facilityId);
    if (!access) return;
    const id = idParam(req, res, 'employee');
    if (!id) return;
    try {
      res.status(201).json(await workforce.addEmployeeDocument(access, id, body(req)));
    } catch (err) {
      handleError(res, err, 'POST /api/hr/employees/:id/documents');
    }
  },
);

/* ============================================================
   ATTENDANCE, ROSTER AND SHIFTS
   ============================================================ */

router.get(
  '/api/hr/shifts',
  requirePermission('hr.read'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, req.query.facilityId);
    if (!access) return;
    try {
      res.json(await workforce.listShifts(access));
    } catch (err) {
      handleError(res, err, 'GET /api/hr/shifts');
    }
  },
);

router.post(
  '/api/hr/shifts',
  requirePermission('hr.manage'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, body(req).facilityId ?? req.query.facilityId);
    if (!access) return;
    try {
      res.status(201).json(await workforce.createShift(access, body(req)));
    } catch (err) {
      handleError(res, err, 'POST /api/hr/shifts');
    }
  },
);

router.get(
  '/api/hr/attendance',
  requirePermission('hr.read'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, req.query.facilityId);
    if (!access) return;
    const date =
      typeof req.query.date === 'string' && req.query.date
        ? req.query.date
        : new Date().toISOString().slice(0, 10);
    try {
      res.json(await workforce.attendanceForDate(access, date));
    } catch (err) {
      handleError(res, err, 'GET /api/hr/attendance');
    }
  },
);

router.post(
  '/api/hr/attendance',
  requirePermission('hr.manage'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, body(req).facilityId ?? req.query.facilityId);
    if (!access) return;
    try {
      res.status(201).json(await workforce.recordAttendance(access, body(req)));
    } catch (err) {
      handleError(res, err, 'POST /api/hr/attendance');
    }
  },
);

router.get(
  '/api/hr/roster',
  requirePermission('hr.read'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, req.query.facilityId);
    if (!access) return;
    const today = new Date().toISOString().slice(0, 10);
    const from = typeof req.query.from === 'string' && req.query.from ? req.query.from : today;
    const to = typeof req.query.to === 'string' && req.query.to ? req.query.to : today;
    try {
      res.json(await workforce.listRoster(access, from, to));
    } catch (err) {
      handleError(res, err, 'GET /api/hr/roster');
    }
  },
);

router.post(
  '/api/hr/roster',
  requirePermission('hr.manage'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, body(req).facilityId ?? req.query.facilityId);
    if (!access) return;
    try {
      res.status(201).json(await workforce.saveRosterEntry(access, body(req)));
    } catch (err) {
      handleError(res, err, 'POST /api/hr/roster');
    }
  },
);

/* ============================================================
   LEAVE
   ============================================================ */

router.get(
  '/api/hr/leave-types',
  requirePermission('hr.read'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, req.query.facilityId);
    if (!access) return;
    try {
      res.json(await workforce.listLeaveTypes(access));
    } catch (err) {
      handleError(res, err, 'GET /api/hr/leave-types');
    }
  },
);

router.post(
  '/api/hr/leave-types',
  requirePermission('hr.manage'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, body(req).facilityId ?? req.query.facilityId);
    if (!access) return;
    try {
      res.status(201).json(await workforce.createLeaveType(access, body(req)));
    } catch (err) {
      handleError(res, err, 'POST /api/hr/leave-types');
    }
  },
);

router.get(
  '/api/hr/leave-requests',
  requirePermission('hr.read'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, req.query.facilityId);
    if (!access) return;
    try {
      res.json(
        await workforce.listLeaveRequests(
          access,
          typeof req.query.status === 'string' ? req.query.status : undefined,
        ),
      );
    } catch (err) {
      handleError(res, err, 'GET /api/hr/leave-requests');
    }
  },
);

router.get(
  '/api/hr/leave-balances',
  requirePermission('hr.read'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, req.query.facilityId);
    if (!access) return;
    try {
      res.json(await workforce.leaveBalances(access));
    } catch (err) {
      handleError(res, err, 'GET /api/hr/leave-balances');
    }
  },
);

router.post(
  '/api/hr/leave-requests',
  requirePermission('hr.manage'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, body(req).facilityId ?? req.query.facilityId);
    if (!access) return;
    try {
      res.status(201).json(await workforce.createLeaveRequest(access, body(req)));
    } catch (err) {
      handleError(res, err, 'POST /api/hr/leave-requests');
    }
  },
);

router.post(
  '/api/hr/leave-requests/:id/decide',
  requirePermission('hr.approve'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, body(req).facilityId ?? req.query.facilityId);
    if (!access) return;
    const id = idParam(req, res, 'leave request');
    if (!id) return;
    try {
      res.json(await workforce.decideLeaveRequest(access, id, body(req)));
    } catch (err) {
      handleError(res, err, 'POST /api/hr/leave-requests/:id/decide');
    }
  },
);

/* ============================================================
   PAYROLL CONFIGURATION
   ============================================================ */

router.get(
  '/api/payroll/statutory-versions',
  requirePermission('payroll.read'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, req.query.facilityId);
    if (!access) return;
    try {
      res.json(await workforce.listStatutoryVersions(access));
    } catch (err) {
      handleError(res, err, 'GET /api/payroll/statutory-versions');
    }
  },
);

router.post(
  '/api/payroll/statutory-versions',
  requirePermission('payroll.statutory.manage'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, body(req).facilityId ?? req.query.facilityId);
    if (!access) return;
    try {
      res.status(201).json(await workforce.createStatutoryVersion(access, body(req)));
    } catch (err) {
      handleError(res, err, 'POST /api/payroll/statutory-versions');
    }
  },
);

router.post(
  '/api/payroll/statutory-versions/:id/status',
  requirePermission('payroll.statutory.manage'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, body(req).facilityId ?? req.query.facilityId);
    if (!access) return;
    const id = idParam(req, res, 'statutory version');
    if (!id) return;
    try {
      res.json(await workforce.setStatutoryVersionStatus(access, id, body(req)));
    } catch (err) {
      handleError(res, err, 'POST /api/payroll/statutory-versions/:id/status');
    }
  },
);

router.get(
  '/api/payroll/accounts',
  requirePermission('payroll.read'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, req.query.facilityId);
    if (!access) return;
    try {
      res.json(await workforce.listPayrollAccounts(access));
    } catch (err) {
      handleError(res, err, 'GET /api/payroll/accounts');
    }
  },
);

router.get(
  '/api/payroll/account-settings',
  requirePermission('payroll.read'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, req.query.facilityId);
    if (!access) return;
    try {
      res.json(await workforce.getPayrollAccountSettings(access));
    } catch (err) {
      handleError(res, err, 'GET /api/payroll/account-settings');
    }
  },
);

router.put(
  '/api/payroll/account-settings',
  // Either the preparer or the approver may configure the posting mapping;
  // the accounts themselves are re-validated against this facility.
  requireAnyPermission('payroll.manage', 'payroll.approve'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, body(req).facilityId ?? req.query.facilityId);
    if (!access) return;
    try {
      res.json(await workforce.savePayrollAccountSettings(access, body(req)));
    } catch (err) {
      handleError(res, err, 'PUT /api/payroll/account-settings');
    }
  },
);

router.post(
  '/api/payroll/components',
  requirePermission('payroll.manage'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, body(req).facilityId ?? req.query.facilityId);
    if (!access) return;
    try {
      res.status(201).json(await workforce.createPayComponent(access, body(req)));
    } catch (err) {
      handleError(res, err, 'POST /api/payroll/components');
    }
  },
);

router.delete(
  '/api/payroll/components/:id',
  requirePermission('payroll.manage'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, body(req).facilityId ?? req.query.facilityId);
    if (!access) return;
    const id = idParam(req, res, 'component');
    if (!id) return;
    try {
      res.json(await workforce.deactivatePayComponent(access, id));
    } catch (err) {
      handleError(res, err, 'DELETE /api/payroll/components/:id');
    }
  },
);

/* ============================================================
   PERIODS, RUNS AND PAYSLIPS
   ============================================================ */

router.get(
  '/api/payroll/periods',
  requirePermission('payroll.read'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, req.query.facilityId);
    if (!access) return;
    try {
      res.json(await workforce.listPeriods(access));
    } catch (err) {
      handleError(res, err, 'GET /api/payroll/periods');
    }
  },
);

router.post(
  '/api/payroll/periods',
  requirePermission('payroll.manage'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, body(req).facilityId ?? req.query.facilityId);
    if (!access) return;
    try {
      res.status(201).json(await workforce.createPeriod(access, body(req)));
    } catch (err) {
      handleError(res, err, 'POST /api/payroll/periods');
    }
  },
);

router.post(
  '/api/payroll/periods/:id/calculate',
  requirePermission('payroll.manage'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, body(req).facilityId ?? req.query.facilityId);
    if (!access) return;
    const id = idParam(req, res, 'period');
    if (!id) return;
    try {
      res.json(await workforce.calculateRun(access, id));
    } catch (err) {
      handleError(res, err, 'POST /api/payroll/periods/:id/calculate');
    }
  },
);

router.get(
  '/api/payroll/runs/:id',
  requirePermission('payroll.read'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, req.query.facilityId);
    if (!access) return;
    const id = idParam(req, res, 'run');
    if (!id) return;
    try {
      res.json(await workforce.runDetail(access, id));
    } catch (err) {
      handleError(res, err, 'GET /api/payroll/runs/:id');
    }
  },
);

router.post(
  '/api/payroll/runs/:id/approve',
  requirePermission('payroll.approve'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, body(req).facilityId ?? req.query.facilityId);
    if (!access) return;
    const id = idParam(req, res, 'run');
    if (!id) return;
    try {
      res.json(await workforce.approveRun(access, id));
    } catch (err) {
      handleError(res, err, 'POST /api/payroll/runs/:id/approve');
    }
  },
);

router.post(
  '/api/payroll/runs/:id/post',
  requirePermission('payroll.post'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, body(req).facilityId ?? req.query.facilityId);
    if (!access) return;
    const id = idParam(req, res, 'run');
    if (!id) return;
    try {
      res.json(await workforce.postRun(access, id));
    } catch (err) {
      handleError(res, err, 'POST /api/payroll/runs/:id/post');
    }
  },
);

router.get(
  '/api/payroll/payslips/:id',
  requirePermission('payroll.read'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, req.query.facilityId);
    if (!access) return;
    const id = idParam(req, res, 'payslip');
    if (!id) return;
    try {
      res.json(await workforce.payslipDetail(access, id));
    } catch (err) {
      handleError(res, err, 'GET /api/payroll/payslips/:id');
    }
  },
);

/*
 * Statutory form profiles and extracts.
 *
 * Reading a P9/P10 extract is `payroll.read`; recording which published form
 * version the facility produces is `payroll.statutory.manage`, the same
 * privilege that lets someone record the statutory rates the figures derive
 * from.
 */
router.get(
  '/api/payroll/form-profiles',
  requirePermission('payroll.read'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, req.query.facilityId);
    if (!access) return;
    try {
      res.json(await workforce.listFormProfiles(access));
    } catch (err) {
      handleError(res, err, 'GET /api/payroll/form-profiles');
    }
  },
);

router.post(
  '/api/payroll/form-profiles',
  requirePermission('payroll.statutory.manage'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, body(req).facilityId);
    if (!access) return;
    try {
      res.status(201).json(await workforce.createFormProfile(access, body(req)));
    } catch (err) {
      handleError(res, err, 'POST /api/payroll/form-profiles');
    }
  },
);

router.get(
  '/api/payroll/statutory-extract',
  requirePermission('payroll.read'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, req.query.facilityId);
    if (!access) return;
    try {
      res.json(
        await workforce.statutoryFormExtract(access, {
          formCode: String(req.query.formCode ?? 'P9'),
          taxYear: Number(req.query.taxYear ?? new Date().getUTCFullYear()),
        }),
      );
    } catch (err) {
      handleError(res, err, 'GET /api/payroll/statutory-extract');
    }
  },
);

router.get(
  '/api/payroll/employees',
  requirePermission('payroll.read'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, req.query.facilityId);
    if (!access) return;
    try {
      res.json(await workforce.listEmployees(access));
    } catch (err) {
      handleError(res, err, 'GET /api/payroll/employees');
    }
  },
);
router.get(
  '/api/payroll/employees/:id',
  requirePermission('payroll.read'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, req.query.facilityId);
    if (!access) return;
    const id = idParam(req, res);
    if (!id) return;
    try {
      const employee = await workforce.employeeDetail(access, id);
      res.json({
        id: employee.id,
        employeeNumber: employee.employeeNumber,
        firstName: employee.firstName,
        lastName: employee.lastName,
        baseSalaryCents: employee.baseSalaryCents,
        components: employee.components,
      });
    } catch (err) {
      handleError(res, err, 'GET /api/payroll/employees/:id');
    }
  },
);
router.put(
  '/api/payroll/employees/:id/salary',
  requirePermission('payroll.manage'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, body(req).facilityId);
    if (!access) return;
    const id = idParam(req, res);
    if (!id) return;
    try {
      res.json(await workforce.setEmployeeSalary(access, id, body(req)));
    } catch (err) {
      handleError(res, err, 'PUT /api/payroll/employees/:id/salary');
    }
  },
);
router.get(
  '/api/payroll/runs/:id/reports',
  requirePermission('payroll.read'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, req.query.facilityId);
    if (!access) return;
    const id = idParam(req, res);
    if (!id) return;
    try {
      res.json(await workforce.payrollRunReports(access, id));
    } catch (err) {
      handleError(res, err, 'GET /api/payroll/runs/:id/reports');
    }
  },
);
router.get(
  '/api/payroll/history',
  requirePermission('payroll.read'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, req.query.facilityId);
    if (!access) return;
    try {
      res.json(await workforce.payrollHistory(access));
    } catch (err) {
      handleError(res, err, 'GET /api/payroll/history');
    }
  },
);

router.get(
  '/api/payroll/readiness',
  requirePermission('payroll.read'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, req.query.facilityId);
    if (!access) return;
    try {
      const id = req.query.periodId === undefined ? undefined : Number(req.query.periodId);
      if (id !== undefined && (!Number.isSafeInteger(id) || id <= 0)) {
        res
          .status(400)
          .json({ error: 'INVALID_PERIOD_ID', message: 'Select a valid payroll period.' });
        return;
      }
      res.json(await workforce.payrollReadiness(access, id));
    } catch (err) {
      handleError(res, err, 'GET /api/payroll/readiness');
    }
  },
);
router.post(
  '/api/payroll/statutory-versions/:id/verify',
  requirePermission('payroll.statutory.manage'),
  async (req: AuthRequest, res: Response) => {
    const access = await scope(req, res, body(req).facilityId);
    if (!access) return;
    try {
      res.json(
        await workforce.verifyStatutoryVersion(
          access,
          workforce.positiveId(req.params.id, 'Statutory version'),
          body(req),
        ),
      );
    } catch (err) {
      handleError(res, err, 'POST /api/payroll/statutory-versions/:id/verify');
    }
  },
);

export default router;
