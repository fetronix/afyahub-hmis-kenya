-- Signed originals are immutable; correction means a new version, never replacement bytes.
CREATE TABLE patient_signed_documents (
 id serial PRIMARY KEY,
 tenant_id integer NOT NULL REFERENCES tenants(id),
 facility_id integer NOT NULL REFERENCES facilities(id),
 patient_id integer NOT NULL REFERENCES patients(id),
 root_id integer REFERENCES patient_signed_documents(id),
 version integer NOT NULL CHECK(version > 0),
 title text NOT NULL,
 category text NOT NULL,
 document_type text NOT NULL,
 signing_date date,
 patient_signature text NOT NULL CHECK(patient_signature IN ('UNKNOWN','PRESENT','ABSENT')),
 doctor_signature text NOT NULL CHECK(doctor_signature IN ('UNKNOWN','PRESENT','ABSENT')),
 doctor_id integer REFERENCES users(id),
 notes text,
 filename text NOT NULL,
 mime_type text NOT NULL,
 sha256 text NOT NULL,
 original_bytes bytea NOT NULL,
 uploaded_by integer NOT NULL REFERENCES users(id),
 uploaded_at timestamptz NOT NULL DEFAULT now(),
 radiology_order_id integer REFERENCES radiology_orders(id),
 procedure_name text,
 reason text NOT NULL,
 UNIQUE(root_id, version)
);
CREATE INDEX patient_signed_documents_scope_idx ON patient_signed_documents(tenant_id,facility_id,patient_id,id);
CREATE TABLE patient_document_events (
 id serial PRIMARY KEY,
 document_id integer REFERENCES patient_signed_documents(id),
 tenant_id integer NOT NULL REFERENCES tenants(id),
 facility_id integer NOT NULL REFERENCES facilities(id),
 patient_id integer NOT NULL REFERENCES patients(id),
 actor_id integer REFERENCES users(id),
 portal_account_id integer,
 action text NOT NULL,
 reason text NOT NULL,
 facts jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE patient_document_releases (
 document_id integer PRIMARY KEY REFERENCES patient_signed_documents(id),
 released boolean NOT NULL DEFAULT false,
 actor_id integer NOT NULL REFERENCES users(id),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE radiology_consent_policies (
 facility_id integer PRIMARY KEY REFERENCES facilities(id),
 tenant_id integer NOT NULL REFERENCES tenants(id),
 required boolean NOT NULL DEFAULT true,
 allow_exception boolean NOT NULL DEFAULT false,
 updated_by integer NOT NULL REFERENCES users(id),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE radiology_consent_decisions (
 order_id integer PRIMARY KEY REFERENCES radiology_orders(id),
 tenant_id integer NOT NULL REFERENCES tenants(id),
 facility_id integer NOT NULL REFERENCES facilities(id),
 patient_id integer NOT NULL REFERENCES patients(id),
 document_id integer REFERENCES patient_signed_documents(id),
 status text NOT NULL CHECK(status IN ('AWAITING_VERIFICATION','VERIFIED','EXCEPTION')),
 clinician_id integer NOT NULL REFERENCES users(id),
 reason text NOT NULL,
 decided_by integer NOT NULL REFERENCES users(id),
 decided_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION jcare_document_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Original documents and audit events are append-only'; END $$;
CREATE TRIGGER patient_signed_documents_immutable BEFORE UPDATE OR DELETE ON patient_signed_documents FOR EACH ROW EXECUTE FUNCTION jcare_document_append_only();
CREATE TRIGGER patient_document_events_immutable BEFORE UPDATE OR DELETE ON patient_document_events FOR EACH ROW EXECUTE FUNCTION jcare_document_append_only();
-- Protect the existing performance boundary even from direct SQL/alternative writers.
-- No policy means consent required with no exception permitted (fail closed).
CREATE FUNCTION jcare_radiology_consent_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE decision radiology_consent_decisions%ROWTYPE;
DECLARE needed boolean;
DECLARE exceptions boolean;
BEGIN
 IF NEW.status IN ('Reported','Performed','Completed') AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
  SELECT required,allow_exception INTO needed,exceptions FROM radiology_consent_policies WHERE facility_id=NEW.facility_id AND tenant_id=NEW.tenant_id;
  IF COALESCE(needed,true) THEN
   SELECT * INTO decision FROM radiology_consent_decisions WHERE order_id=NEW.id AND tenant_id=NEW.tenant_id AND facility_id=NEW.facility_id AND patient_id=NEW.patient_id;
   IF decision.status='EXCEPTION' AND COALESCE(exceptions,false) THEN RETURN NEW; END IF;
   IF decision.status='VERIFIED' AND EXISTS (
    SELECT 1 FROM patient_signed_documents d WHERE d.id=decision.document_id AND d.radiology_order_id=NEW.id AND d.patient_id=NEW.patient_id AND d.tenant_id=NEW.tenant_id AND d.facility_id=NEW.facility_id
    AND d.procedure_name=NEW.procedure_name AND d.doctor_id=decision.clinician_id AND d.patient_signature='PRESENT' AND d.doctor_signature='PRESENT' AND d.signing_date IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM patient_signed_documents newer WHERE newer.root_id=COALESCE(d.root_id,d.id) AND newer.version>d.version)
   ) THEN RETURN NEW; END IF;
   RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='RADIOLOGY_CONSENT_REQUIRED';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER radiology_consent_performance_guard BEFORE INSERT OR UPDATE OF status ON radiology_orders FOR EACH ROW EXECUTE FUNCTION jcare_radiology_consent_guard();
-- Catalogue only: no role assignments or blanket access grants.
INSERT INTO permissions(code,name,module,description) VALUES
 ('patients.documents.read','Read signed patient documents','patients','Read scoped patient originals, versions and history.'),
 ('patients.documents.upload','Upload signed patient documents','patients','Create immutable patient document versions.'),
 ('patients.documents.release','Release patient documents to portal','patients','Explicitly release a scoped document version to its patient.'),
 ('radiology.consent.verify','Verify radiology consent','radiology','Record procedure-specific signature verification.'),
 ('radiology.consent.exception','Authorize radiology consent exception','radiology','Record an exception only where facility policy permits.'),
 ('radiology.consent.policy','Manage radiology consent policy','radiology','Configure facility-specific consent requirement and exceptions.')
ON CONFLICT(code) DO NOTHING;

CREATE FUNCTION jcare_patient_document_subject_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM patients WHERE id=NEW.patient_id AND tenant_id=NEW.tenant_id AND registration_facility_id=NEW.facility_id) THEN RAISE EXCEPTION 'Document patient scope mismatch'; END IF;
 IF NEW.root_id IS NULL AND NEW.version<>1 THEN RAISE EXCEPTION 'Initial version must be one'; END IF;
 IF NEW.root_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM patient_signed_documents d WHERE d.id=NEW.root_id AND d.root_id IS NULL AND d.tenant_id=NEW.tenant_id AND d.facility_id=NEW.facility_id AND d.patient_id=NEW.patient_id AND d.radiology_order_id IS NOT DISTINCT FROM NEW.radiology_order_id AND NEW.version>1) THEN RAISE EXCEPTION 'Document version scope mismatch'; END IF;
 IF NEW.radiology_order_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM radiology_orders WHERE id=NEW.radiology_order_id AND tenant_id=NEW.tenant_id AND facility_id=NEW.facility_id AND patient_id=NEW.patient_id AND procedure_name=NEW.procedure_name) THEN RAISE EXCEPTION 'Document radiology scope mismatch'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER patient_document_subject_guard BEFORE INSERT ON patient_signed_documents FOR EACH ROW EXECUTE FUNCTION jcare_patient_document_subject_guard();
