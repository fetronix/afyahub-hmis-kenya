-- Radiology consent simplification.
--
-- A document attached after the request was reported is historical support. It
-- keeps its real upload time and can never stand in for pre-procedure consent.
ALTER TABLE patient_signed_documents ADD COLUMN IF NOT EXISTS radiology_attachment_context text;
--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='patient_signed_documents_radiology_context_check') THEN
  ALTER TABLE patient_signed_documents ADD CONSTRAINT patient_signed_documents_radiology_context_check CHECK (radiology_attachment_context IS NULL OR radiology_attachment_context IN ('PRE_PROCEDURE','POST_REPORTING_HISTORICAL'));
 END IF;
END $$;
--> statement-breakpoint
ALTER TABLE radiology_consent_decisions DROP CONSTRAINT IF EXISTS radiology_consent_decisions_status_check;
--> statement-breakpoint
ALTER TABLE radiology_consent_decisions ADD CONSTRAINT radiology_consent_decisions_status_check CHECK (status IN ('AWAITING_VERIFICATION','VERIFIED','REJECTED','EXCEPTION'));
--> statement-breakpoint
-- Completion still requires an explicit decision by the authenticated doctor.
-- The doctor's signed-in identity, review event and exact procedure document are
-- checked in the database, not only by the application service.
CREATE OR REPLACE FUNCTION jcare_radiology_consent_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE decision radiology_consent_decisions%ROWTYPE;
DECLARE needed boolean;
DECLARE exceptions boolean;
DECLARE clinician_active boolean;
BEGIN
 IF NEW.status IN ('Reported','Performed','Completed') AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
  SELECT required,allow_exception INTO needed,exceptions FROM radiology_consent_policies WHERE facility_id=NEW.facility_id AND tenant_id=NEW.tenant_id;
  IF COALESCE(needed,true) THEN
   SELECT * INTO decision FROM radiology_consent_decisions WHERE order_id=NEW.id AND tenant_id=NEW.tenant_id AND facility_id=NEW.facility_id AND patient_id=NEW.patient_id;
   SELECT EXISTS(
    SELECT 1 FROM users u
    JOIN user_roles ur ON ur.user_id=u.id
    JOIN roles r ON r.id=ur.role_id
    WHERE u.id=decision.clinician_id AND u.tenant_id=NEW.tenant_id AND u.facility_id=NEW.facility_id
     AND u.account_status='ACTIVE' AND u.is_active=true AND u.deactivated_at IS NULL
     AND (u.locked_until IS NULL OR u.locked_until <= now())
     AND ur.is_active=true AND ur.revoked_at IS NULL
     AND r.is_active=true AND r.tenant_id=u.tenant_id AND upper(r.name)='DOCTOR'
   ) INTO clinician_active;
   IF decision.status='EXCEPTION' AND COALESCE(exceptions,false) AND decision.clinician_id=decision.decided_by AND clinician_active THEN RETURN NEW; END IF;
   IF decision.status='VERIFIED' AND decision.clinician_id=decision.decided_by AND clinician_active AND EXISTS (
    SELECT 1 FROM patient_signed_documents d
    WHERE d.id=decision.document_id AND d.radiology_order_id=NEW.id AND d.patient_id=NEW.patient_id
     AND d.tenant_id=NEW.tenant_id AND d.facility_id=NEW.facility_id AND d.procedure_name=NEW.procedure_name
     AND d.radiology_attachment_context IS DISTINCT FROM 'POST_REPORTING_HISTORICAL'
     AND NOT EXISTS (SELECT 1 FROM patient_signed_documents newer WHERE newer.root_id=COALESCE(d.root_id,d.id) AND newer.version>d.version)
     AND EXISTS (
      SELECT 1 FROM patient_document_events e
      WHERE e.document_id=d.id AND e.tenant_id=NEW.tenant_id AND e.facility_id=NEW.facility_id
       AND e.action='RADIOLOGY_VERIFIED' AND e.actor_id=decision.clinician_id
       AND e.facts @> jsonb_build_object('orderId', NEW.id, 'documentId', decision.document_id)
     )
   ) THEN RETURN NEW; END IF;
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='RADIOLOGY_CONSENT_REQUIRED';
  END IF;
 END IF;
 RETURN NEW;
END $$;
