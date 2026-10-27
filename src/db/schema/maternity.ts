/**
 * JaliCare HMIS
 * Schema: Maternity, labour, deliveries, postnatal care, and immunisation
 *
 * Extracted from `../schema.ts`, which re-exports every table defined here so
 * that `import * as schema from '../schema.ts'` and drizzle.config.ts keep
 * working untouched. Tables are grouped by the domain that owns them; the
 * relations that join two domains stay in the barrel, because a relation is a
 * statement about both and belongs to neither.
 */

import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  boolean,
  numeric,
  date,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';

import { sql } from 'drizzle-orm';

import { facilities, tenants } from './tenancy.ts';

import { patients } from './patients.ts';

import { encounters } from './clinical.ts';

export const maternityPregnancies = pgTable(
  'maternity_pregnancies',
  {
    id: serial('id').primaryKey(),

    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),

    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),

    patientId: integer('patient_id')
      .references(() => patients.id)
      .notNull(),

    /* Booking date and the dating that everything else is measured from. */
    bookedAt: text('booked_at').notNull(),

    lmpDate: text('lmp_date'),

    eddDate: text('edd_date').notNull(),

    /*
     * LMP | Ultrasound | Other. An EDD from the last menstrual period and
     * an EDD from a scan legitimately disagree; recording which one is in
     * use stops the next clinician silently "correcting" it.
     */
    eddBasis: text('edd_basis').default('LMP').notNull(),

    /* Obstetric history at booking. */
    gravida: integer('gravida'),
    para: integer('para'),
    abortions: integer('abortions'),
    livingChildren: integer('living_children'),

    heightCm: numeric('height_cm', { precision: 5, scale: 1 }),
    bloodGroup: text('blood_group'),
    rhesus: text('rhesus'),
    haemoglobinGdl: numeric('haemoglobin_gdl', { precision: 4, scale: 1 }),

    /* Free text on purpose: risk is a clinical judgement, not a checkbox. */
    riskFactors: text('risk_factors'),

    /* Active | Delivered | Closed | Transferred */
    status: text('status').default('Active').notNull(),

    closedAt: text('closed_at'),
    closedReason: text('closed_reason'),

    createdBy: integer('created_by'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    patientIdx: index('maternity_pregnancies_patient_idx').on(
      table.tenantId,
      table.patientId,
      table.status,
    ),

    facilityIdx: index('maternity_pregnancies_facility_idx').on(table.facilityId, table.status),

    /*
     * A patient cannot be booked twice for the same pregnancy. Two active
     * records would split the ANC history and make the EDD ambiguous, so
     * the database refuses the second one rather than the screen.
     */
    oneActiveIdx: uniqueIndex('maternity_pregnancies_one_active_idx')
      .on(table.tenantId, table.patientId)
      .where(sql`status = 'Active'`),
  }),
);

export const ancVisits = pgTable(
  'anc_visits',
  {
    id: serial('id').primaryKey(),

    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),

    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),

    pregnancyId: integer('pregnancy_id')
      .references(() => maternityPregnancies.id)
      .notNull(),

    patientId: integer('patient_id')
      .references(() => patients.id)
      .notNull(),

    visitDate: text('visit_date').notNull(),

    /*
     * Recorded by hand rather than derived from the count of rows: the
     * MOH 405 card numbers visits in order and a woman may arrive having
     * attended elsewhere.
     */
    visitNumber: integer('visit_number'),

    gestationWeeks: integer('gestation_weeks'),
    gestationDays: integer('gestation_days'),

    weightKg: numeric('weight_kg', { precision: 5, scale: 1 }),
    bpSystolic: integer('bp_systolic'),
    bpDiastolic: integer('bp_diastolic'),
    pulseBpm: integer('pulse_bpm'),
    temperatureC: numeric('temperature_c', { precision: 4, scale: 1 }),

    fundalHeightCm: numeric('fundal_height_cm', { precision: 4, scale: 1 }),
    fetalHeartRateBpm: integer('fetal_heart_rate_bpm'),
    presentation: text('presentation'),
    fetalMovements: text('fetal_movements'),

    /* Negative | Trace | + | ++ | +++ */
    urineProtein: text('urine_protein'),
    urineGlucose: text('urine_glucose'),

    haemoglobinGdl: numeric('haemoglobin_gdl', { precision: 4, scale: 1 }),

    /* Tetanus-toxoid dose number: 1 to 5. */
    ttDose: integer('tt_dose'),
    ifasDispensed: boolean('ifas_dispensed').default(false).notNull(),

    /* Danger signs seen today, in the words of whoever saw them. */
    dangerSigns: text('danger_signs'),
    notes: text('notes'),
    nextVisitDate: text('next_visit_date'),

    recordedBy: integer('recorded_by'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    pregnancyIdx: index('anc_visits_pregnancy_idx').on(table.pregnancyId, table.visitDate),

    facilityIdx: index('anc_visits_facility_idx').on(table.facilityId, table.visitDate),
  }),
);

export const labourRecords = pgTable(
  'labour_records',
  {
    id: serial('id').primaryKey(),

    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),

    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),

    pregnancyId: integer('pregnancy_id')
      .references(() => maternityPregnancies.id)
      .notNull(),

    patientId: integer('patient_id')
      .references(() => patients.id)
      .notNull(),

    encounterId: integer('encounter_id').references(() => encounters.id),

    admittedAt: text('admitted_at').notNull(),

    labourOnsetAt: text('labour_onset_at'),
    membranesRupturedAt: text('membranes_ruptured_at'),

    gestationWeeksAtAdmission: integer('gestation_weeks_at_admission'),

    /* In Labour | Delivered | Referred | Closed */
    status: text('status').default('In Labour').notNull(),

    notes: text('notes'),

    createdBy: integer('created_by'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    pregnancyIdx: index('labour_records_pregnancy_idx').on(table.pregnancyId, table.admittedAt),

    facilityStatusIdx: index('labour_records_facility_status_idx').on(
      table.facilityId,
      table.status,
    ),
  }),
);

export const partographEntries = pgTable(
  'partograph_entries',
  {
    id: serial('id').primaryKey(),

    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),

    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),

    labourRecordId: integer('labour_record_id')
      .references(() => labourRecords.id)
      .notNull(),

    patientId: integer('patient_id')
      .references(() => patients.id)
      .notNull(),

    /*
     * Minutes matter on a partograph: the alert and action lines are read
     * against time since admission, so this is a timestamp, not a date.
     */
    recordedAt: text('recorded_at').notNull(),

    cervicalDilatationCm: numeric('cervical_dilatation_cm', {
      precision: 4,
      scale: 1,
    }),

    /*
     * Station of the presenting part, -3 to +3. Zero is at the ischial
     * spines; negative is above them.
     */
    descentStation: integer('descent_station'),

    contractionsPer10Min: integer('contractions_per_10_min'),

    /* Seconds. Recorded separately: 3 in 10 of 40 s is not 4 in 10 of 20 s. */
    contractionDurationSec: integer('contraction_duration_sec'),

    fetalHeartRateBpm: integer('fetal_heart_rate_bpm'),

    /* Intact | Ruptured */
    membranes: text('membranes'),

    /* Clear | Meconium I | Meconium II | Meconium III | Bloody | Absent */
    liquor: text('liquor'),

    maternalPulseBpm: integer('maternal_pulse_bpm'),
    bpSystolic: integer('bp_systolic'),
    bpDiastolic: integer('bp_diastolic'),
    temperatureC: numeric('temperature_c', { precision: 4, scale: 1 }),

    oxytocin: text('oxytocin'),
    drugsGiven: text('drugs_given'),
    notes: text('notes'),

    recordedBy: integer('recorded_by'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    labourIdx: index('partograph_entries_labour_idx').on(table.labourRecordId, table.recordedAt),

    /*
     * Two observations claiming the same moment is a double entry, and on
     * a partograph it moves the plotted line. Refuse it.
     */
    uniqueReadingIdx: uniqueIndex('partograph_entries_labour_time_idx').on(
      table.labourRecordId,
      table.recordedAt,
    ),
  }),
);

export const deliveries = pgTable(
  'deliveries',
  {
    id: serial('id').primaryKey(),

    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),

    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),

    pregnancyId: integer('pregnancy_id')
      .references(() => maternityPregnancies.id)
      .notNull(),

    labourRecordId: integer('labour_record_id').references(() => labourRecords.id),

    patientId: integer('patient_id')
      .references(() => patients.id)
      .notNull(),

    deliveredAt: text('delivered_at').notNull(),

    /*
     * Spontaneous Vertex | Assisted Vaginal | Breech | Vacuum |
     * Forceps | Caesarean Section
     */
    deliveryMode: text('delivery_mode').notNull(),

    bloodLossMl: integer('blood_loss_ml'),

    /* Intact | 1st Degree | 2nd Degree | 3rd Degree | 4th Degree | Episiotomy */
    perineum: text('perineum'),

    placentaComplete: boolean('placenta_complete'),
    placentaDeliveredAt: text('placenta_delivered_at'),
    oxytocinGiven: boolean('oxytocin_given').default(false).notNull(),

    complications: text('complications'),
    notes: text('notes'),

    deliveredBy: integer('delivered_by'),
    conductedByCadre: text('conducted_by_cadre'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    pregnancyIdx: index('deliveries_pregnancy_idx').on(table.pregnancyId, table.deliveredAt),

    facilityIdx: index('deliveries_facility_idx').on(table.facilityId, table.deliveredAt),
  }),
);

export const deliveryBabies = pgTable(
  'delivery_babies',
  {
    id: serial('id').primaryKey(),

    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),

    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),

    deliveryId: integer('delivery_id')
      .references(() => deliveries.id)
      .notNull(),

    /* 1 for a singleton, 1 and 2 for twins. */
    babyNumber: integer('baby_number').notNull(),

    /* Male | Female | Ambiguous | Not recorded */
    sex: text('sex'),

    birthWeightGrams: integer('birth_weight_grams'),

    /*
     * Apgar is nullable at each minute because a resuscitation may mean
     * the score was never taken. A zero is a real score; null is not.
     */
    apgar1: integer('apgar1'),
    apgar5: integer('apgar5'),
    apgar10: integer('apgar10'),

    /* Live Birth | Stillbirth Fresh | Stillbirth Macerated | Neonatal Death */
    outcome: text('outcome').notNull(),

    resuscitation: text('resuscitation'),
    notes: text('notes'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    deliveryIdx: uniqueIndex('delivery_babies_delivery_number_idx').on(
      table.deliveryId,
      table.babyNumber,
    ),
  }),
);

/* ============================================================
   44c. POSTNATAL CARE
   ============================================================

   One row per postnatal contact. The mother is the subject; the baby is
   noted on the same row because at this stage the two are seen together
   and a separate baby record would be empty for most visits.

   Postnatal visits hang off the pregnancy, not the delivery: a woman who
   delivered elsewhere still attends here for her six-week check.
   ============================================================ */

export const postnatalVisits = pgTable(
  'postnatal_visits',
  {
    id: serial('id').primaryKey(),

    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),

    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),

    patientId: integer('patient_id')
      .references(() => patients.id)
      .notNull(),

    pregnancyId: integer('pregnancy_id')
      .references(() => maternityPregnancies.id)
      .notNull(),

    deliveryId: integer('delivery_id').references(() => deliveries.id),

    visitDate: text('visit_date').notNull(),

    /* 1..n within this pregnancy, and the day counted from delivery. */
    visitNumber: integer('visit_number'),
    dayPostpartum: integer('day_postpartum'),

    bpSystolic: integer('bp_systolic'),
    bpDiastolic: integer('bp_diastolic'),
    pulseBpm: integer('pulse_bpm'),
    temperatureC: numeric('temperature_c', { precision: 4, scale: 1 }),

    /* Involution: how far the fundus has descended, in cm. */
    fundalHeightCm: numeric('fundal_height_cm', { precision: 4, scale: 1 }),

    /* Normal | Subinvolution | Not examined */
    involution: text('involution'),

    /* Rubra | Serosa | Alba | Abnormal | Not examined */
    lochia: text('lochia'),

    /* Intact | Healing | Infected | Dehisced | Episiotomy healing */
    perineum: text('perineum'),

    /* Normal | Engorged | Cracked nipples | Mastitis */
    breasts: text('breasts'),

    /* Exclusive | Mixed | Formula | Not breastfeeding */
    breastfeeding: text('breastfeeding'),

    /*
     * Not a diagnosis. A recorded screening outcome, so the next
     * clinician knows whether anyone asked.
     */
    moodScreening: text('mood_screening'),

    haemoglobinGdl: numeric('haemoglobin_gdl', { precision: 4, scale: 1 }),

    dangerSigns: text('danger_signs'),
    notes: text('notes'),
    nextVisitDate: text('next_visit_date'),

    babyWeightGrams: integer('baby_weight_grams'),
    babyNotes: text('baby_notes'),

    recordedBy: integer('recorded_by'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    pregnancyIdx: index('postnatal_visits_pregnancy_idx').on(table.pregnancyId, table.visitDate),

    facilityIdx: index('postnatal_visits_facility_idx').on(table.facilityId, table.visitDate),
  }),
);

/* ============================================================
   44d. IMMUNISATION
   ============================================================

   The antigen and dose are stored as administered. The schedule lives in
   code (`immunisation-contracts.ts`), not in this table: a schedule
   changes, a record of what was given does not.

   The unique index is the safety property that matters most here. Two
   doses of the same antigen on the same child at the same dose number is
   a double administration, and it is refused by the database rather than
   by a screen that someone may not be looking at.
   ============================================================ */

export const immunisationRecords = pgTable(
  'immunisation_records',
  {
    id: serial('id').primaryKey(),

    tenantId: integer('tenant_id')
      .references(() => tenants.id)
      .notNull(),

    facilityId: integer('facility_id')
      .references(() => facilities.id)
      .notNull(),

    patientId: integer('patient_id')
      .references(() => patients.id)
      .notNull(),

    /* Set when the child was born here and the link is known. */
    deliveryId: integer('delivery_id').references(() => deliveries.id),

    deliveryBabyId: integer('delivery_baby_id').references(() => deliveryBabies.id),

    pregnancyId: integer('pregnancy_id').references(() => maternityPregnancies.id),

    /* BCG | OPV | PENTA | PCV | ROTA | IPV | MR | YF | HPV | Td */
    antigenCode: text('antigen_code').notNull(),

    doseNumber: integer('dose_number').default(1).notNull(),

    administeredOn: text('administered_on').notNull(),

    batchNumber: text('batch_number'),
    site: text('site'),

    /* Intradermal | Subcutaneous | Intramuscular | Oral */
    route: text('route'),

    administeredBy: integer('administered_by'),
    notes: text('notes'),

    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    patientIdx: index('immunisation_records_patient_idx').on(
      table.tenantId,
      table.patientId,
      table.administeredOn,
    ),

    facilityIdx: index('immunisation_records_facility_idx').on(
      table.facilityId,
      table.administeredOn,
    ),

    /*
     * A child cannot receive the same dose twice. This is the one
     * constraint a paper card cannot enforce.
     */
    uniqueDoseIdx: uniqueIndex('immunisation_records_dose_idx').on(
      table.tenantId,
      table.patientId,
      table.antigenCode,
      table.doseNumber,
    ),
  }),
);
