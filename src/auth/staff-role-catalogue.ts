export const STAFF_ROLE_CATALOGUE = [
  {
    name: 'BILLING_CLERK',
    description: 'Handles billing, payment records, and SHA eClaims billing workflows.',
    permissions: [
      'billing.create',
      'billing.payments.record',
      'billing.read',
      'billing.update',
      'patients.read',
      'insurance.read',
      'insurance.claims.create',
      'insurance.claims.submit',
      'insurance.claims.manage',
      'insurance.sha.read',
      'insurance.sha.eligibility.check',
      'insurance.sha.benefits.validate',
      'insurance.sha.preauthorization.create',
      'insurance.sha.claims.read',
      'insurance.sha.claims.prepare',
      'insurance.sha.claims.submit',
      'insurance.sha.claims.resubmit',
      'insurance.sha.remittance.read',
      'insurance.sha.reconciliation.manage',
      'insurance.payers.read',
      'insurance.members.read',
      'insurance.members.manage',
      'insurance.eligibility.check',
      'insurance.benefits.validate',
      'insurance.preauthorization.manage',
      'insurance.private.claims.prepare',
      'insurance.private.claims.submit',
      'insurance.private.remittance.reconcile',
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
      'appointments.read',
      'clinical.create',
      'clinical.read',
      'clinical.update',
      'inpatient.read',
      'inpatient.admit',
      'laboratory.read',
      'laboratory.orders.create',
      'patients.read',
      // Recording consent and correcting a patient's own demographic
      // details are part of the consultation, not admin work.
      'patients.update',
      // Clinical officers run antenatal clinics and conduct deliveries.
      'maternity.read',
      'maternity.create',
      'maternity.update',
      'insurance.sha.read',
      'insurance.sha.benefits.validate',
      'insurance.sha.preauthorization.create',
      'insurance.payers.read',
      'insurance.members.read',
      'insurance.benefits.validate',
      'insurance.preauthorization.manage',
    ],
  },
  {
    name: 'DOCTOR',
    description: 'Provides clinical care and manages clinical records.',
    permissions: [
      'appointments.read',
      'clinical.create',
      'clinical.read',
      'clinical.update',
      // Doctors admit and authorise discharge for their own patients.
      'inpatient.read',
      'inpatient.admit',
      'inpatient.discharge',
      'laboratory.read',
      'laboratory.orders.create',
      'patients.read',
      // Consent to treatment and to sharing is taken during the
      // consultation; a doctor who cannot record it will not ask.
      'patients.update',
      'maternity.read',
      'maternity.create',
      'maternity.update',
      'insurance.sha.read',
      'insurance.sha.benefits.validate',
      'insurance.sha.preauthorization.create',
      'insurance.payers.read',
      'insurance.members.read',
      'insurance.benefits.validate',
      'insurance.preauthorization.manage',
    ],
  },
  {
    name: 'INVENTORY_OFFICER',
    description: 'Manages inventory and procurement activities.',
    permissions: ['inventory.manage', 'inventory.read', 'procurement.create', 'procurement.read'],
  },
  {
    name: 'LABORATORY_TECHNICIAN',
    description: 'Handles laboratory orders and results entry.',
    permissions: [
      'laboratory.orders.create',
      'laboratory.read',
      'laboratory.results.enter',
      'patients.read',
    ],
  },
  {
    name: 'NURSE',
    description: 'Provides nursing care and accesses clinical records.',
    permissions: [
      'clinical.create',
      'clinical.read',
      // Nurses admit patients to a ward and manage beds, but do not
      // discharge them: discharge stays a doctor authorisation.
      'inpatient.read',
      'inpatient.admit',
      'patients.read',
      // Nurse-midwives conduct deliveries in Kenya, so the nursing cadre
      // records the whole maternity pathway.
      'maternity.read',
      'maternity.create',
      'maternity.update',
    ],
  },
  {
    name: 'PHARMACIST',
    description: 'Handles pharmacy dispensing and pharmacy records.',
    permissions: ['patients.read', 'pharmacy.dispense', 'pharmacy.read'],
  },
  {
    name: 'RECEPTIONIST',
    description: 'Handles patient registration and appointments.',
    permissions: [
      'appointments.create',
      'appointments.read',
      'appointments.update',
      'patients.create',
      'patients.read',
      // Consent is a registration form at most facilities, so the desk
      // that registers the patient must be able to record it — and to
      // revoke it when the patient asks.
      'patients.update',
      /*
       * Portal invitations are a front-desk routine, not a clinical
       * act. The receptionist can issue and hand over an invitation;
       * revoking one, managing accounts and changing policy sit with
       * the facility administrator, because those decisions concern
       * someone's access to their own record.
       */
      'portal.invite',
      // Enough to find a booked mother and her next appointment; not
      // enough to record clinical findings.
      'maternity.read',
      'insurance.read',
      'insurance.sha.read',
      'insurance.sha.eligibility.check',
      'insurance.sha.benefits.validate',
      'insurance.payers.read',
      'insurance.members.read',
      'insurance.members.manage',
      'insurance.eligibility.check',
      'insurance.benefits.validate',
    ],
  },
] as const;
