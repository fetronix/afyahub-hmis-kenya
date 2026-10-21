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
    /**
     * Clinical officers practise independently in Kenya and are regulated
     * by the Clinical Officers Council, which is one of the four
     * regulators the Health Worker Registry accepts.
     *
     * Discharge is deliberately absent: whether a clinical officer may
     * authorise discharge is a facility policy decision, not a default.
     */
    name: 'CLINICAL_OFFICER',
    description: 'Provides clinical care under the Clinical Officers Council.',
    permissions: [
      'appointments.read', 'clinical.create', 'clinical.read',
      'clinical.update', 'inpatient.read', 'inpatient.admit',
      'laboratory.read', 'laboratory.orders.create', 'patients.read',
      // Clinical officers run antenatal clinics and conduct deliveries.
      'maternity.read', 'maternity.create', 'maternity.update',
    ],
  },
  {
    name: 'DOCTOR',
    description: 'Provides clinical care and manages clinical records.',
    permissions: [
      'appointments.read', 'clinical.create', 'clinical.read',
      'clinical.update',
      // Doctors admit and authorise discharge for their own patients.
      'inpatient.read', 'inpatient.admit', 'inpatient.discharge',
      'laboratory.read',
      'laboratory.orders.create', 'patients.read',
      'maternity.read', 'maternity.create', 'maternity.update',
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
      'clinical.create', 'clinical.read',
      // Nurses admit patients to a ward and manage beds, but do not
      // discharge them: discharge stays a doctor authorisation.
      'inpatient.read', 'inpatient.admit', 'patients.read',
      // Nurse-midwives conduct deliveries in Kenya, so the nursing cadre
      // records the whole maternity pathway.
      'maternity.read', 'maternity.create', 'maternity.update',
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
      // Enough to find a booked mother and her next appointment; not
      // enough to record clinical findings.
      'maternity.read',
    ],
  },
] as const;
