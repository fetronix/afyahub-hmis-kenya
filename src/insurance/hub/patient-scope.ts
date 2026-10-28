import { and, eq } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import * as schema from '../../db/schema.ts';

/** A tenant match alone does not give a facility access to a patient. */
export async function findFacilityPatient(tenantId: number, facilityId: number, patientId: number) {
  const [patient] = await db
    .select()
    .from(schema.patients)
    .where(and(eq(schema.patients.id, patientId), eq(schema.patients.tenantId, tenantId)))
    .limit(1);
  if (!patient) return null;
  if (patient.registrationFacilityId === facilityId) return patient;
  const [association] = await db
    .select({ id: schema.patientFacilities.id })
    .from(schema.patientFacilities)
    .where(
      and(
        eq(schema.patientFacilities.patientId, patientId),
        eq(schema.patientFacilities.tenantId, tenantId),
        eq(schema.patientFacilities.facilityId, facilityId),
        eq(schema.patientFacilities.status, 'ACTIVE'),
      ),
    )
    .limit(1);
  if (association) return patient;
  const [encounter] = await db
    .select({ id: schema.encounters.id })
    .from(schema.encounters)
    .where(
      and(
        eq(schema.encounters.patientId, patientId),
        eq(schema.encounters.tenantId, tenantId),
        eq(schema.encounters.facilityId, facilityId),
      ),
    )
    .limit(1);
  return encounter ? patient : null;
}
