export const STAFF_ROLE_CATALOGUE = [
  {
    name: 'BILLING_CLERK',
    description: 'Handles billing and payment records.',
    permissions: [
      'billing.create', 'billing.payments.record', 'billing.read',
      'billing.update', 'patients.read',
    ],
  },
  {
    name: 'DOCTOR',
    description: 'Provides clinical care and manages clinical records.',
    permissions: [
      'appointments.read', 'clinical.create', 'clinical.read',
      'clinical.update', 'inpatient.read', 'patients.read',
    ],
  },
  {
    name: 'INVENTORY_OFFICER',
    description: 'Manages inventory and procurement activities.',
    permissions: [
      'inventory.manage', 'inventory.read',
      'procurement.create', 'procurement.read',
    ],
  },
  {
    name: 'LABORATORY_TECHNICIAN',
    description: 'Handles laboratory orders and results entry.',
    permissions: [
      'laboratory.orders.create', 'laboratory.read',
      'laboratory.results.enter', 'patients.read',
    ],
  },
  {
    name: 'NURSE',
    description: 'Provides nursing care and accesses clinical records.',
    permissions: [
      'clinical.create', 'clinical.read', 'inpatient.read', 'patients.read',
    ],
  },
  {
    name: 'PHARMACIST',
    description: 'Handles pharmacy dispensing and pharmacy records.',
    permissions: [
      'patients.read', 'pharmacy.dispense', 'pharmacy.read',
    ],
  },
  {
    name: 'RECEPTIONIST',
    description: 'Handles patient registration and appointments.',
    permissions: [
      'appointments.create', 'appointments.read', 'appointments.update',
      'patients.create', 'patients.read',
    ],
  },
] as const;
