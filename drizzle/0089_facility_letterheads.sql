-- Facility letterhead: versioned, activated branding shared by every document.
--
-- WHY
-- A hospital's invoices, receipts, claims and reports all carry the same
-- letterhead. Before this migration the system had no letterhead at all: the
-- report PDF printed a product name, and an invoice existed only as HTML in the
-- billing screen. Facilities need their own identity on documents, and an
-- auditor needs to know which branding a reprinted invoice carried when it was
-- issued -- not whichever logo happens to be active today.
--
-- MODEL
-- * Every upload creates a new immutable version (DRAFT).
-- * Activating a version supersedes the previous active one in one transaction.
--   A partial unique index makes "at most one active letterhead per facility"
--   a database invariant, not an application convention.
-- * Content (logo bytes, checksum, text, colour) can never be edited after
--   upload. Only the lifecycle columns move, and only forward.
-- * Nothing is deleted: a historical invoice reprint resolves the exact
--   letterhead version recorded at finalization.
--
-- The logo is stored in the database rather than on a filesystem path so a
-- backup/restore carries the documents' branding with the data it belongs to.

CREATE TABLE IF NOT EXISTS facility_letterheads (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  facility_id integer NOT NULL REFERENCES facilities(id),
  version integer NOT NULL CHECK (version > 0),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ACTIVE', 'SUPERSEDED', 'WITHDRAWN')),

  header_text text,
  footer_text text,
  accent_color text,

  logo_mime text,
  logo_bytes bytea,
  logo_sha256 text,
  logo_width integer,
  logo_height integer,

  checksum text NOT NULL,

  created_by integer NOT NULL REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now(),

  activated_by integer REFERENCES users(id),
  activated_at timestamp,

  retired_by integer REFERENCES users(id),
  retired_at timestamp,
  retire_reason text,

  CONSTRAINT facility_letterhead_scope_fk FOREIGN KEY (facility_id, tenant_id)
    REFERENCES facilities(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT facility_letterhead_version_unique UNIQUE (facility_id, version),
  CONSTRAINT facility_letterhead_accent_chk CHECK (
    accent_color IS NULL OR accent_color ~ '^#[0-9a-fA-F]{6}$'),
  CONSTRAINT facility_letterhead_text_len_chk CHECK (
    coalesce(length(header_text), 0) <= 300
    AND coalesce(length(footer_text), 0) <= 500),
  CONSTRAINT facility_letterhead_logo_pair_chk CHECK (
    (logo_mime IS NULL AND logo_bytes IS NULL AND logo_sha256 IS NULL
      AND logo_width IS NULL AND logo_height IS NULL)
    OR (logo_mime IN ('image/png', 'image/jpeg')
      AND logo_bytes IS NOT NULL AND logo_sha256 IS NOT NULL
      AND logo_width >= 32 AND logo_height >= 32
      AND logo_width <= 4000 AND logo_height <= 4000)),
  CONSTRAINT facility_letterhead_content_chk CHECK (
    logo_bytes IS NOT NULL OR header_text IS NOT NULL OR footer_text IS NOT NULL
    OR accent_color IS NOT NULL),
  CONSTRAINT facility_letterhead_status_chk CHECK (
    (status = 'DRAFT' AND activated_at IS NULL AND retired_at IS NULL)
    OR (status = 'ACTIVE' AND activated_at IS NOT NULL AND retired_at IS NULL)
    OR (status = 'SUPERSEDED' AND activated_at IS NOT NULL AND retired_at IS NOT NULL)
    OR (status = 'WITHDRAWN' AND retired_at IS NOT NULL))
);

--> statement-breakpoint
-- At most one active version per facility, enforced by the database.
CREATE UNIQUE INDEX IF NOT EXISTS facility_letterheads_active_unique
  ON facility_letterheads (facility_id) WHERE status = 'ACTIVE';

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS facility_letterhead_events (
  id serial PRIMARY KEY,
  letterhead_id integer NOT NULL REFERENCES facility_letterheads(id),
  tenant_id integer NOT NULL,
  facility_id integer NOT NULL,
  action text NOT NULL CHECK (action IN ('UPLOADED', 'ACTIVATED', 'SUPERSEDED', 'WITHDRAWN')),
  version integer NOT NULL,
  actor_user_id integer NOT NULL REFERENCES users(id),
  reason text,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT facility_letterhead_event_scope_fk FOREIGN KEY (facility_id, tenant_id)
    REFERENCES facilities(id, tenant_id) ON DELETE RESTRICT
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS facility_letterhead_events_letterhead_idx
  ON facility_letterhead_events (letterhead_id, id);

--> statement-breakpoint
CREATE OR REPLACE FUNCTION jcare_guard_letterhead() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Letterhead versions are retained for reprint fidelity'
      USING ERRCODE = '23514';
  END IF;
  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
     OR OLD.facility_id IS DISTINCT FROM NEW.facility_id
     OR OLD.version IS DISTINCT FROM NEW.version
     OR OLD.header_text IS DISTINCT FROM NEW.header_text
     OR OLD.footer_text IS DISTINCT FROM NEW.footer_text
     OR OLD.accent_color IS DISTINCT FROM NEW.accent_color
     OR OLD.logo_mime IS DISTINCT FROM NEW.logo_mime
     OR OLD.logo_bytes IS DISTINCT FROM NEW.logo_bytes
     OR OLD.logo_sha256 IS DISTINCT FROM NEW.logo_sha256
     OR OLD.logo_width IS DISTINCT FROM NEW.logo_width
     OR OLD.logo_height IS DISTINCT FROM NEW.logo_height
     OR OLD.checksum IS DISTINCT FROM NEW.checksum
     OR OLD.created_by IS DISTINCT FROM NEW.created_by
     OR OLD.created_at IS DISTINCT FROM NEW.created_at
  THEN
    RAISE EXCEPTION 'Uploaded letterhead content is immutable'
      USING ERRCODE = '23514';
  END IF;
  -- Lifecycle only moves forward: DRAFT -> ACTIVE|WITHDRAWN,
  -- ACTIVE -> SUPERSEDED|WITHDRAWN, and a retired version stays retired.
  IF OLD.status = 'DRAFT' AND NEW.status NOT IN ('ACTIVE', 'WITHDRAWN') THEN
    RAISE EXCEPTION 'A draft letterhead can only be activated or withdrawn'
      USING ERRCODE = '23514';
  ELSIF OLD.status = 'ACTIVE' AND NEW.status NOT IN ('SUPERSEDED', 'WITHDRAWN') THEN
    RAISE EXCEPTION 'An active letterhead can only be superseded or withdrawn'
      USING ERRCODE = '23514';
  ELSIF OLD.status IN ('SUPERSEDED', 'WITHDRAWN') THEN
    RAISE EXCEPTION 'A retired letterhead version cannot change again'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.activated_at IS DISTINCT FROM OLD.activated_at AND OLD.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Activation time is recorded once' USING ERRCODE = '23514';
  END IF;
  IF OLD.retired_at IS NOT NULL AND NEW.retired_at IS DISTINCT FROM OLD.retired_at THEN
    RAISE EXCEPTION 'Retirement time is recorded once' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

--> statement-breakpoint
DROP TRIGGER IF EXISTS jcare_letterhead_guard ON facility_letterheads;

--> statement-breakpoint
CREATE TRIGGER jcare_letterhead_guard BEFORE UPDATE OR DELETE ON facility_letterheads
FOR EACH ROW EXECUTE FUNCTION jcare_guard_letterhead();

--> statement-breakpoint
CREATE OR REPLACE FUNCTION jcare_letterhead_event_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Letterhead activation history is append-only' USING ERRCODE = '23514';
END $$;

--> statement-breakpoint
DROP TRIGGER IF EXISTS jcare_letterhead_event_guard ON facility_letterhead_events;

--> statement-breakpoint
CREATE TRIGGER jcare_letterhead_event_guard BEFORE UPDATE OR DELETE ON facility_letterhead_events
FOR EACH ROW EXECUTE FUNCTION jcare_letterhead_event_append_only();

--> statement-breakpoint
-- The exact branding version used when an invoice was finalized. Historical
-- reprints resolve this id, so a later letterhead change cannot rewrite the
-- document a payer already received.
ALTER TABLE billing_invoice_finalizations
  ADD COLUMN IF NOT EXISTS letterhead_id integer REFERENCES facility_letterheads(id);

--> statement-breakpoint
CREATE OR REPLACE FUNCTION jcare_guard_finalization_letterhead() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE l facility_letterheads%ROWTYPE;
BEGIN
  IF NEW.letterhead_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO l FROM facility_letterheads WHERE id = NEW.letterhead_id;
  IF NOT FOUND
     OR l.tenant_id <> NEW.tenant_id
     OR l.facility_id <> NEW.facility_id
     OR l.status <> 'ACTIVE'
  THEN
    RAISE EXCEPTION 'A finalized invoice can only record an active letterhead from its own facility'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

--> statement-breakpoint
DROP TRIGGER IF EXISTS jcare_finalization_letterhead_guard ON billing_invoice_finalizations;

--> statement-breakpoint
CREATE TRIGGER jcare_finalization_letterhead_guard BEFORE INSERT ON billing_invoice_finalizations
FOR EACH ROW EXECUTE FUNCTION jcare_guard_finalization_letterhead();
