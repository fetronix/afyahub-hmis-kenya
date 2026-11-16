-- Patient portal release workflow.
--
-- A document becomes visible to its own patient only through an explicit,
-- authorized release row. Nothing in this migration releases anything: it
-- records *when* a release happened, *when* it was revoked, the staff reason
-- and whether the original consent was reviewed before the release.
--
-- The release rows themselves stay mutable (release / revoke) while the
-- document versions and audit events remain append-only.
ALTER TABLE patient_document_releases ADD COLUMN IF NOT EXISTS reason text;
--> statement-breakpoint
ALTER TABLE patient_document_releases ADD COLUMN IF NOT EXISTS released_at timestamptz;
--> statement-breakpoint
ALTER TABLE patient_document_releases ADD COLUMN IF NOT EXISTS revoked_at timestamptz;
--> statement-breakpoint
ALTER TABLE patient_document_releases ADD COLUMN IF NOT EXISTS reviewed_original boolean NOT NULL DEFAULT false;
--> statement-breakpoint
-- Backfill only the timestamp that matches the recorded decision.
UPDATE patient_document_releases SET released_at = updated_at WHERE released AND released_at IS NULL;
--> statement-breakpoint
UPDATE patient_document_releases SET revoked_at = updated_at WHERE NOT released AND revoked_at IS NULL;
--> statement-breakpoint
-- Portal paging walks (uploaded_at, id) newest first inside one patient scope.
CREATE INDEX IF NOT EXISTS patient_signed_documents_portal_page_idx
  ON patient_signed_documents(tenant_id, facility_id, patient_id, uploaded_at DESC, id DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS patient_document_releases_released_idx
  ON patient_document_releases(released, released_at DESC) WHERE released;
