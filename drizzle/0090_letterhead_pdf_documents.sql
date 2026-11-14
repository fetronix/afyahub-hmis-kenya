-- 0090 — a letterhead may be a supplied PDF, and every document has a body area.
--
-- WHY
-- 0089 modelled a letterhead as a composed logo + header/footer text + accent
-- colour. Facilities do not work that way: they already own a designed A4
-- letterhead (usually a PDF) that carries their name, logo, colour band,
-- accreditation numbers and a footer with contacts. Asking an administrator to
-- retype the header as text and upload the logo separately produces a document
-- that looks nothing like the one the hospital already prints.
--
-- This migration adds a second content mode: the facility's own PDF, stored
-- verbatim, used as the page background of every generated document. The 0089
-- columns are untouched and still work; a facility that has only a logo keeps
-- using them.
--
-- WHY THE PDF LIVES IN THE DATABASE
-- For the same reason 0089 gives: a backup/restore must carry the branding with
-- the documents it belongs to. A filesystem path survives neither a database
-- restore to a new host nor a tenant clone, and it introduces a path-traversal
-- surface that bytea does not have. Nothing in this table is web-served: the
-- bytes are read only after an authorization check, and are never placed in a
-- static directory.
--
-- THE BODY AREA
-- A background cannot be laid over content by guesswork: the content has to be
-- laid out *inside* whatever the letterhead leaves free. Each version therefore
-- records the printable body rectangle in PDF points, measured from the page
-- edges:
--
--   body_top_pt     distance from the top edge down to the first usable row
--   body_bottom_pt  distance from the bottom edge up to the last usable row
--   body_left_pt    distance from the left edge to the text column
--   body_right_pt   distance from the right edge to the text column
--
-- `layout_source` says where those numbers came from: 'MEASURED' when the
-- uploaded PDF's ink was analysed, 'ADJUSTED' when an administrator moved the
-- guide in the preview, 'DEFAULT' when the PDF could not be measured and the
-- safe fallback was used. An administrator can always correct the rectangle
-- before activation, which is the point of the preview.

ALTER TABLE facility_letterheads
  ADD COLUMN IF NOT EXISTS source_pdf bytea,
  ADD COLUMN IF NOT EXISTS source_pdf_sha256 text,
  ADD COLUMN IF NOT EXISTS source_pdf_bytes integer,
  ADD COLUMN IF NOT EXISTS source_pdf_pages integer,
  ADD COLUMN IF NOT EXISTS page_width_pt double precision,
  ADD COLUMN IF NOT EXISTS page_height_pt double precision,
  ADD COLUMN IF NOT EXISTS body_top_pt double precision,
  ADD COLUMN IF NOT EXISTS body_bottom_pt double precision,
  ADD COLUMN IF NOT EXISTS body_left_pt double precision,
  ADD COLUMN IF NOT EXISTS body_right_pt double precision,
  ADD COLUMN IF NOT EXISTS layout_source text;

--> statement-breakpoint
-- A PDF version is either complete or absent. Half a record would let the
-- renderer believe a background exists when the bytes are missing.
ALTER TABLE facility_letterheads
  DROP CONSTRAINT IF EXISTS facility_letterhead_pdf_chk;
ALTER TABLE facility_letterheads
  ADD CONSTRAINT facility_letterhead_pdf_chk CHECK (
    (source_pdf IS NULL
      AND source_pdf_sha256 IS NULL AND source_pdf_bytes IS NULL
      AND source_pdf_pages IS NULL AND page_width_pt IS NULL
      AND page_height_pt IS NULL AND body_top_pt IS NULL
      AND body_bottom_pt IS NULL AND body_left_pt IS NULL
      AND body_right_pt IS NULL AND layout_source IS NULL)
    OR
    (source_pdf IS NOT NULL
      AND source_pdf_sha256 IS NOT NULL AND source_pdf_bytes > 0
      AND source_pdf_pages >= 1
      AND page_width_pt >= 100 AND page_width_pt <= 2000
      AND page_height_pt >= 100 AND page_height_pt <= 2000
      AND body_top_pt >= 0 AND body_top_pt < page_height_pt
      AND body_bottom_pt >= 0 AND body_bottom_pt < page_height_pt
      AND body_left_pt >= 0 AND body_left_pt < page_width_pt
      AND body_right_pt >= 0 AND body_right_pt < page_width_pt
      AND body_top_pt + body_bottom_pt < page_height_pt - 40
      AND body_left_pt + body_right_pt < page_width_pt - 40
      AND layout_source IN ('MEASURED', 'ADJUSTED', 'DEFAULT'))
  );

--> statement-breakpoint
-- A PDF-only letterhead is a complete letterhead. 0089 required at least one of
-- logo/header/footer/accent; that check is widened rather than replaced, so
-- every row that satisfied it still does.
ALTER TABLE facility_letterheads
  DROP CONSTRAINT IF EXISTS facility_letterhead_content_chk;
ALTER TABLE facility_letterheads
  ADD CONSTRAINT facility_letterhead_content_chk CHECK (
    source_pdf IS NOT NULL
    OR logo_bytes IS NOT NULL OR header_text IS NOT NULL OR footer_text IS NOT NULL
    OR accent_color IS NOT NULL
  );

--> statement-breakpoint
-- The uploaded document is content, not configuration: it must be as immutable
-- as the logo it may replace. Re-create the 0089 guard with the new columns in
-- the comparison, otherwise an operator with table access could swap the bytes
-- of a letterhead that a finalized invoice already points at.
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
     OR OLD.source_pdf IS DISTINCT FROM NEW.source_pdf
     OR OLD.source_pdf_sha256 IS DISTINCT FROM NEW.source_pdf_sha256
     OR OLD.source_pdf_bytes IS DISTINCT FROM NEW.source_pdf_bytes
     OR OLD.source_pdf_pages IS DISTINCT FROM NEW.source_pdf_pages
     OR OLD.page_width_pt IS DISTINCT FROM NEW.page_width_pt
     OR OLD.page_height_pt IS DISTINCT FROM NEW.page_height_pt
     OR OLD.checksum IS DISTINCT FROM NEW.checksum
     OR OLD.created_by IS DISTINCT FROM NEW.created_by
     OR OLD.created_at IS DISTINCT FROM NEW.created_at
  THEN
    RAISE EXCEPTION 'Uploaded letterhead content is immutable'
      USING ERRCODE = '23514';
  END IF;
  -- The body rectangle is a layout decision, not content: an administrator may
  -- still correct it while the version is a draft. Once activated it is frozen
  -- with everything else, because documents already resolved against it.
  IF OLD.status <> 'DRAFT' AND (
       OLD.body_top_pt IS DISTINCT FROM NEW.body_top_pt
    OR OLD.body_bottom_pt IS DISTINCT FROM NEW.body_bottom_pt
    OR OLD.body_left_pt IS DISTINCT FROM NEW.body_left_pt
    OR OLD.body_right_pt IS DISTINCT FROM NEW.body_right_pt
    OR OLD.layout_source IS DISTINCT FROM NEW.layout_source
  ) THEN
    RAISE EXCEPTION 'An activated letterhead layout cannot change'
      USING ERRCODE = '23514';
  END IF;
  -- A retired version is evidence and never changes again.
  IF OLD.status IN ('SUPERSEDED', 'WITHDRAWN') THEN
    RAISE EXCEPTION 'A retired letterhead version cannot change again'
      USING ERRCODE = '23514';
  END IF;
  -- Lifecycle only moves forward: DRAFT -> ACTIVE|WITHDRAWN,
  -- ACTIVE -> SUPERSEDED|WITHDRAWN. The condition tests the TRANSITION, not
  -- the new value: a draft being re-laid-out keeps status DRAFT, and an
  -- earlier version of this guard rejected that legitimate update by reading
  -- the unchanged value as an illegal destination.
  IF OLD.status = 'DRAFT'
     AND NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status NOT IN ('ACTIVE', 'WITHDRAWN') THEN
    RAISE EXCEPTION 'A draft letterhead can only be activated or withdrawn'
      USING ERRCODE = '23514';
  ELSIF OLD.status = 'ACTIVE'
     AND NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status NOT IN ('SUPERSEDED', 'WITHDRAWN') THEN
    RAISE EXCEPTION 'An active letterhead can only be superseded or withdrawn'
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
-- A letterhead version belongs to exactly one facility, and the facility must
-- belong to the tenant that uploaded it. 0089 enforced the first half with a
-- composite FK; this keeps that and adds the PDF-specific uniqueness of a
-- checksum so the same document cannot be uploaded twice as two versions.
CREATE UNIQUE INDEX IF NOT EXISTS facility_letterheads_pdf_unique
  ON facility_letterheads (facility_id, source_pdf_sha256)
  WHERE source_pdf_sha256 IS NOT NULL AND status <> 'WITHDRAWN';

--> statement-breakpoint
-- Reprints resolve the letterhead recorded at finalization even after it has
-- been superseded, so looking one up by id must not depend on its status. The
-- composite index keeps that lookup inside one facility.
CREATE INDEX IF NOT EXISTS facility_letterheads_facility_status_idx
  ON facility_letterheads (facility_id, status, version);
