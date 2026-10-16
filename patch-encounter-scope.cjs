const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const queryPath = path.join(root, "src", "db", "queries.ts");
const appPath = path.join(root, "src", "app.ts");

if (!fs.existsSync(queryPath) || !fs.existsSync(appPath)) {
  throw new Error("Run this script from the JaliCare project root.");
}

let queries = fs.readFileSync(queryPath, "utf8");
let app = fs.readFileSync(appPath, "utf8");

const queryMarker = "// Queues";
const appStart = "  app.get('/api/encounters'";
const appEnd = "  // =========================================================\n  // QUEUES";

if (!queries.includes(queryMarker)) {
  throw new Error("Could not find the query insertion point. No files changed.");
}
if (!app.includes(appStart) || !app.includes(appEnd)) {
  throw new Error("Could not find the expected encounter route block. No files changed.");
}
if (queries.includes("export async function getEncountersScoped(") ||
    queries.includes("export async function createEncounterScoped(") ||
    queries.includes("export async function updateEncounterScoped(")) {
  throw new Error("Scoped encounter functions already exist. No files changed.");
}

const backupDir = path.join(
  root,
  "local-backups",
  "encounter-scope-" + new Date().toISOString().replace(/[:.]/g, "-")
);
fs.mkdirSync(backupDir, { recursive: true });
fs.copyFileSync(queryPath, path.join(backupDir, "queries.ts"));
fs.copyFileSync(appPath, path.join(backupDir, "app.ts"));

const scopedFunctions = `
/**
 * Scope-aware encounter operations.
 * Facility ownership is verified against the database.
 * Tenant/facility ownership fields are never accepted from update payloads.
 */
export async function getEncountersScoped(
  context: AuthorizationContext,
  patientId?: number,
  requestedFacilityId?: number,
) {
  const facilityId = resolveFacilityScope(context, requestedFacilityId);
  const facility = await getFacilityByIdScoped(context, facilityId);

  if (!facility) {
    throw new ScopeAccessError(
      "Facility not found.",
      "FACILITY_ACCESS_DENIED",
    );
  }

  const conditions = [
    eq(schema.encounters.tenantId, facility.tenantId),
    eq(schema.encounters.facilityId, facility.id),
  ];

  if (patientId !== undefined) {
    if (!Number.isSafeInteger(patientId) || patientId <= 0) {
      throw new Error("Invalid patient ID.");
    }

    const patient = await getPatientByIdScoped(context, patientId);

    if (!patient || patient.tenantId !== facility.tenantId) {
      throw new ScopeAccessError(
        "Patient is outside the authorized tenant.",
        "FACILITY_ACCESS_DENIED",
      );
    }

    conditions.push(eq(schema.encounters.patientId, patient.id));
  }

  return db
    .select()
    .from(schema.encounters)
    .where(and(...conditions))
    .orderBy(desc(schema.encounters.startedAt))
    .limit(50);
}

export async function createEncounterScoped(
  context: AuthorizationContext,
  data: typeof schema.encounters.$inferInsert,
) {
  const facilityId = resolveFacilityScope(
    context,
    data.facilityId,
  );
  const facility = await getFacilityByIdScoped(context, facilityId);

  if (!facility) {
    throw new ScopeAccessError(
      "Facility not found.",
      "FACILITY_ACCESS_DENIED",
    );
  }

  if (!Number.isSafeInteger(data.patientId) || data.patientId <= 0) {
    throw new Error("A valid patient ID is required.");
  }

  const patient = await getPatientByIdScoped(context, data.patientId);

  if (!patient || patient.tenantId !== facility.tenantId) {
    throw new ScopeAccessError(
      "Patient is outside the authorized tenant.",
      "FACILITY_ACCESS_DENIED",
    );
  }

  const safeData = { ...data } as Record<string, unknown>;
  for (const key of [
    "id", "tenantId", "facilityId", "patientId",
    "createdAt", "updatedAt",
  ]) {
    delete safeData[key];
  }

  const [created] = await db
    .insert(schema.encounters)
    .values({
      ...safeData,
      tenantId: facility.tenantId,
      facilityId: facility.id,
      patientId: patient.id,
    } as typeof schema.encounters.$inferInsert)
    .returning();

  return created;
}

export async function updateEncounterScoped(
  context: AuthorizationContext,
  encounterId: number,
  data: Partial<typeof schema.encounters.$inferInsert>,
) {
  if (!Number.isSafeInteger(encounterId) || encounterId <= 0) {
    throw new Error("Invalid encounter ID.");
  }

  const [current] = await db
    .select()
    .from(schema.encounters)
    .where(eq(schema.encounters.id, encounterId))
    .limit(1);

  if (!current) return null;

  const facility = await getFacilityByIdScoped(
    context,
    current.facilityId,
  );

  if (!facility || facility.tenantId !== current.tenantId) {
    throw new ScopeAccessError(
      "Encounter is outside the authorized facility.",
      "FACILITY_ACCESS_DENIED",
    );
  }

  const requestedPatientId = data.patientId ?? current.patientId;
  const patient = await getPatientByIdScoped(
    context,
    requestedPatientId,
  );

  if (!patient || patient.tenantId !== facility.tenantId) {
    throw new ScopeAccessError(
      "Patient is outside the authorized tenant.",
      "FACILITY_ACCESS_DENIED",
    );
  }

  const safeData = { ...data } as Record<string, unknown>;
  for (const key of [
    "id", "tenantId", "facilityId", "patientId",
    "createdAt", "updatedAt",
  ]) {
    delete safeData[key];
  }

  const [updated] = await db
    .update(schema.encounters)
    .set({
      ...safeData,
      patientId: patient.id,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.encounters.id, encounterId),
        eq(schema.encounters.tenantId, facility.tenantId),
        eq(schema.encounters.facilityId, facility.id),
      ),
    )
    .returning();

  return updated ?? null;
}

`;

queries = queries.replace(
  queryMarker,
  scopedFunctions + queryMarker,
);

const replacementRoutes = `  app.get('/api/encounters', requirePermission('clinical.read'), async (req: AuthRequest, res: Response) => {
    try {
      if (!req.authContext) {
        return res.status(401).json({
          success: false,
          error: 'AUTHORIZATION_CONTEXT_MISSING',
        });
      }

      const patientId = req.query.patientId === undefined
        ? undefined
        : Number(req.query.patientId);
      const facilityId = req.query.facilityId === undefined
        ? undefined
        : Number(req.query.facilityId);

      if (patientId !== undefined &&
          (!Number.isSafeInteger(patientId) || patientId <= 0)) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_PATIENT_ID',
        });
      }

      if (facilityId !== undefined &&
          (!Number.isSafeInteger(facilityId) || facilityId <= 0)) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_FACILITY_ID',
        });
      }

      const list = await queries.getEncountersScoped(
        req.authContext,
        patientId,
        facilityId,
      );

      return res.json(list);
    } catch (err: unknown) {
      if (handleScopeError(err, res)) return;
      console.error('Encounter list error:', err);
      return res.status(500).json({
        success: false,
        error: 'ENCOUNTERS_LIST_FAILED',
      });
    }
  });

  app.post('/api/encounters', requirePermission('clinical.create'), async (req: AuthRequest, res: Response) => {
    try {
      if (!req.authContext) {
        return res.status(401).json({
          success: false,
          error: 'AUTHORIZATION_CONTEXT_MISSING',
        });
      }

      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_ENCOUNTER_BODY',
        });
      }

      const encounter = await queries.createEncounterScoped(
        req.authContext,
        req.body,
      );

      return res.status(201).json(encounter);
    } catch (err: unknown) {
      if (handleScopeError(err, res)) return;
      console.error('Encounter creation error:', err);
      return res.status(500).json({
        success: false,
        error: 'ENCOUNTER_CREATION_FAILED',
      });
    }
  });

  app.put('/api/encounters/:id', requirePermission('clinical.update'), async (req: AuthRequest, res: Response) => {
    try {
      if (!req.authContext) {
        return res.status(401).json({
          success: false,
          error: 'AUTHORIZATION_CONTEXT_MISSING',
        });
      }

      const encounterId = Number(req.params.id);

      if (!Number.isSafeInteger(encounterId) || encounterId <= 0) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_ENCOUNTER_ID',
        });
      }

      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_ENCOUNTER_BODY',
        });
      }

      const encounter = await queries.updateEncounterScoped(
        req.authContext,
        encounterId,
        req.body,
      );

      if (!encounter) {
        return res.status(404).json({
          success: false,
          error: 'ENCOUNTER_NOT_FOUND',
        });
      }

      return res.json(encounter);
    } catch (err: unknown) {
      if (handleScopeError(err, res)) return;
      console.error('Encounter update error:', err);
      return res.status(500).json({
        success: false,
        error: 'ENCOUNTER_UPDATE_FAILED',
      });
    }
  });

`;

const start = app.indexOf(appStart);
const end = app.indexOf(appEnd, start);
app = app.slice(0, start) + replacementRoutes + app.slice(end);

if (!queries.includes("resolveFacilityScope")) {
  throw new Error("Internal check failed: missing scope resolver.");
}

// Add the resolver to the existing scope-service import.
const scopeImport = /import \{\s*requireTenantScope,\s*requireFacilityScope,\s*\} from '\.\.\/auth\/scope\.service\.ts';/;
if (!scopeImport.test(queries)) {
  throw new Error("Could not safely update the scope-service import.");
}
queries = queries.replace(
  scopeImport,
  "import {requireTenantScope,requireFacilityScope,resolveFacilityScope,\\n} from '../auth/scope.service.ts';"
);

fs.writeFileSync(queryPath, queries, "utf8");
fs.writeFileSync(appPath, app, "utf8");

console.log("Patch applied.");
console.log("Backup folder:", backupDir);
console.log("Next: run npx tsc --noEmit before starting the server.");
