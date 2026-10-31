/**
 * Facility service-tariff helpers.
 *
 * The price list is the one place where a wrong value changes what a
 * patient is billed, so its validation is strict and lives in one place
 * rather than being repeated in each tariff route.
 *
 * Moved out of `createApp` unchanged.
 */

import type { Response } from 'express';

import type { AuthRequest } from '../../auth/auth.middleware.ts';
import { resolveFacilityScope } from '../../auth/scope.service.ts';
import { isValidBillingKey } from '../../billing/tariff-codes.ts';
import * as queries from '../../db/queries.ts';
import { handleScopeError } from './errors.ts';

export const tariffModuleForDepartment = (department: string): string | null => {
  const value = department
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  const aliases: Record<string, string> = {
    opd: 'opd',
    outpatient: 'opd',
    inpatient: 'inpatient',
    ward: 'inpatient',
    theatre: 'theatre',
    operating_theatre: 'theatre',
    specialty: 'specialty',
    specialist: 'specialty',
    laboratory: 'laboratory',
    lab: 'laboratory',
    radiology: 'radiology',
    imaging: 'radiology',
    pharmacy: 'pharmacy',
    registration: 'registration',
    reception: 'reception',
    insurance: 'insurance',
    sha: 'insurance',
    finance: 'finance',
    general: 'finance',
  };
  return aliases[value] ?? null;
};

export const validateTariffInput = (input: any) => {
  /*
   * Stored in capitals, always. The billing engine looks codes up in
   * capitals; a row saved as "consultation" would be invisible to it
   * and the visit would bill nothing.
   */
  const code = typeof input?.code === 'string' ? input.code.trim().toUpperCase() : '';
  const description = typeof input?.description === 'string' ? input.description.trim() : '';
  const department = typeof input?.department === 'string' ? input.department.trim() : '';
  const unit = typeof input?.unit === 'string' ? input.unit.trim() : '';
  const feeText =
    typeof input?.fee === 'string' || typeof input?.fee === 'number'
      ? String(input.fee).trim()
      : '';
  const shaStatus = typeof input?.shaStatus === 'string' ? input.shaStatus.trim() : 'Not Assessed';
  const shaNotes =
    input?.shaNotes == null
      ? null
      : typeof input.shaNotes === 'string'
        ? input.shaNotes.trim()
        : undefined;
  const moduleId = tariffModuleForDepartment(department);
  const fee = Number(feeText);

  /*
   * Optional link to an automatic charge. Absent or empty means "not
   * linked"; anything else must be a key the engine understands, or it
   * would be a link that silently never fires.
   */
  const rawBillingKey = typeof input?.billingKey === 'string' ? input.billingKey.trim() : '';

  if (rawBillingKey !== '' && !isValidBillingKey(rawBillingKey)) {
    return null;
  }

  const billingKey = rawBillingKey === '' ? null : rawBillingKey.toUpperCase();

  /*
   * Effective dates. Both optional; empty means "always". They are
   * what lets a price list change on 1 January without either
   * rewriting history or silently repricing past invoices: the
   * resolver checks today's date against the pair.
   */
  const parseDate = (value: unknown): string | null | undefined => {
    if (value === undefined || value === null || value === '') return null;

    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
      return undefined;
    }

    const parsed = new Date(`${value.trim()}T00:00:00Z`);

    return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value.trim()
      ? undefined
      : value.trim();
  };

  const effectiveFrom = parseDate(input?.effectiveFrom);
  const effectiveTo = parseDate(input?.effectiveTo);

  if (effectiveFrom === undefined || effectiveTo === undefined) return null;

  if (effectiveFrom && effectiveTo && effectiveFrom > effectiveTo) return null;

  const autoBill = input?.autoBill === undefined ? true : input.autoBill === true;

  if (input?.autoBill !== undefined && typeof input.autoBill !== 'boolean') {
    return null;
  }

  if (
    !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,49}$/.test(code) ||
    !description ||
    description.length > 500 ||
    !department ||
    department.length > 100 ||
    !moduleId ||
    !unit ||
    unit.length > 50 ||
    !/^\d{1,8}(\.\d{1,2})?$/.test(feeText) ||
    !Number.isFinite(fee) ||
    fee < 0 ||
    !shaStatus ||
    shaStatus.length > 50 ||
    shaNotes === undefined ||
    (shaNotes !== null && shaNotes.length > 1000)
  ) {
    return null;
  }

  return {
    code,
    description,
    department: moduleId,
    unit,
    fee: fee.toFixed(2),
    shaStatus,
    shaNotes,
    moduleId,
    billingKey,
    effectiveFrom,
    effectiveTo,
    autoBill,
  };
};

export const sendTariffWriteError = (error: unknown, res: Response): boolean => {
  const code = (error as { code?: string } | null)?.code;

  if (code === '23505') {
    res.status(409).json({
      success: false,
      error: 'TARIFF_BILLING_KEY_TAKEN',
      message:
        'Another active tariff already answers that automatic charge. Deactivate it first, or choose a different one.',
    });

    return true;
  }

  if (code === '42703' || code === '42P01') {
    /*
     * Two migrations sit behind this form now:
     *   0019 — billing_key (the automatic-billing link)
     *   0021 — effective dates and the automatic-billing flag
     * Either being absent is a deployment fact, not a bad request.
     * The message names the one that is missing rather than a generic
     * 500, because the operator can fix it in one command.
     */
    const message =
      typeof (error as { message?: string }).message === 'string' &&
      (error as { message: string }).message.includes('effective')
        ? 'Price validity dates need migration 0021. Run `npm run db:migrate`, then save again. The tariff was not changed.'
        : 'Automatic billing links need migrations 0019 and 0021. Run `npm run db:migrate`, then save again. The tariff was not changed.';

    res.status(409).json({
      success: false,
      error: 'TARIFF_MIGRATION_REQUIRED',
      message,
    });

    return true;
  }

  return false;
};

export const facilityHasTariffModule = (
  facility: { enabledModules: unknown },
  moduleId: string,
): boolean => Array.isArray(facility.enabledModules) && facility.enabledModules.includes(moduleId);

export const requireFacilityAdminTariffRole = (req: AuthRequest, res: Response): boolean => {
  const context = req.authContext;

  if (!context) {
    res.status(401).json({
      success: false,
      error: 'AUTHORIZATION_CONTEXT_MISSING',
      message: 'Authorization context is required.',
    });
    return false;
  }

  if (context.isSuperAdmin || !context.roles.includes('FACILITY_ADMIN')) {
    res.status(403).json({
      success: false,
      error: 'FACILITY_ADMIN_REQUIRED',
      message: 'Only Facility Administrators can manage facility service tariffs.',
    });
    return false;
  }

  return true;
};

export const resolveTariffFacility = async (
  req: AuthRequest,
  res: Response,
  requestedId: unknown,
) => {
  if (!req.authContext) {
    res.status(401).json({
      success: false,
      error: 'AUTHORIZATION_CONTEXT_MISSING',
      message: 'Authorization context is required.',
    });
    return null;
  }

  const facilityId = Number(requestedId);
  if (!Number.isSafeInteger(facilityId) || facilityId <= 0) {
    res.status(400).json({
      success: false,
      error: 'INVALID_FACILITY_ID',
      message: 'A valid facilityId is required.',
    });
    return null;
  }

  try {
    const scopedId = resolveFacilityScope(req.authContext, facilityId);
    const facility = await queries.getFacilityByIdScoped(req.authContext, scopedId);

    if (!facility) {
      res.status(404).json({
        success: false,
        error: 'FACILITY_NOT_FOUND',
        message: 'The facility was not found in your authorized scope.',
      });
      return null;
    }

    if (!facilityHasTariffModule(facility, 'finance')) {
      res.status(403).json({
        success: false,
        error: 'FACILITY_MODULE_DISABLED',
        module: 'finance',
        message: 'The finance module must be enabled to manage tariffs.',
      });
      return null;
    }

    return facility;
  } catch (error: unknown) {
    if (handleScopeError(error, res)) return null;
    throw error;
  }
};
