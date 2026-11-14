import { z } from 'zod';
import { tariffModuleForDepartment } from './tariff-departments.ts';

/** Validation shared by the single-service form and the create-only batch intake. */
export const facilityServiceCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9._/-]{0,49}$/);
export const facilityServiceMoney = z
  .union([z.string(), z.number()])
  .transform(String)
  .refine((value) => /^\d{1,8}(\.\d{1,2})?$/.test(value));
export const facilityServiceDay = z
  .union([
    z.string().refine((value) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
      const date = new Date(`${value}T00:00:00Z`);
      return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
    }),
    z.null(),
  ])
  .optional();
export const facilityServiceCategories = z.enum([
  'CONSULTATION',
  'LABORATORY',
  'RADIOLOGY',
  'PHARMACY',
  'PROCEDURE',
  'ADMISSION',
  'BED_DAY',
  'DELIVERY',
  'OTHER',
]);
export const facilityServiceInput = z.object({
  code: facilityServiceCode,
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(500),
  department: z.string().trim().min(1).max(100),
  category: facilityServiceCategories,
  unit: z.string().trim().min(1).max(50),
  isActive: z.boolean(),
  autoBill: z.boolean(),
});
export const createFacilityServiceInput = facilityServiceInput.extend({
  // Zero is an unconfigured price, not permission to bill or give free care.
  initialPrice: facilityServiceMoney.default('0.00'),
  initialTariffCode: facilityServiceCode.optional(),
});
export const updateFacilityServiceInput = facilityServiceInput.extend({
  expectedState: z.object({
    name: z.string(),
    description: z.string(),
    isActive: z.boolean(),
    autoBill: z.boolean(),
  }),
});
export const facilityTariffInput = z
  .object({
    serviceId: z.number().int().positive(),
    code: facilityServiceCode,
    description: z.string().trim().min(1).max(500),
    department: z.string().trim().min(1).max(100),
    unit: z.string().trim().min(1).max(50),
    fee: facilityServiceMoney,
    effectiveFrom: facilityServiceDay,
    effectiveTo: facilityServiceDay,
    isActive: z.boolean(),
    autoBill: z.boolean(),
    expectedRevision: z.number().int().positive().optional(),
  })
  .refine(
    (x) => !x.effectiveFrom || !x.effectiveTo || x.effectiveFrom <= x.effectiveTo,
    'Invalid effective dates.',
  );

export type FacilityServiceScope = {
  id: number;
  tenantId: number;
  enabledModules: unknown;
  timezone?: string | null;
};

export class FacilityServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/** Keep category/department validation identical for individual and bulk creation. */
export function requireFacilityServiceModule(
  facility: FacilityServiceScope,
  department: string,
  category?: string,
) {
  const module = tariffModuleForDepartment(department);
  if (
    !module ||
    !Array.isArray(facility.enabledModules) ||
    !facility.enabledModules.includes(module)
  )
    throw new FacilityServiceError(
      'DEPARTMENT_UNAVAILABLE',
      'Enable the service department before configuring it.',
    );
  const familyDepartment: Record<string, string> = {
    CONSULTATION: 'opd',
    LABORATORY: 'laboratory',
    RADIOLOGY: 'radiology',
    PHARMACY: 'pharmacy',
    ADMISSION: 'inpatient',
    BED_DAY: 'inpatient',
    // Delivery can be configured under maternity or inpatient at the facility.
    DELIVERY: module === 'maternity' ? 'maternity' : 'inpatient',
  };
  if (category && familyDepartment[category] && familyDepartment[category] !== module)
    throw new FacilityServiceError(
      'CATEGORY_DEPARTMENT_MISMATCH',
      'The category must belong to its clinical department.',
    );
  return module;
}
