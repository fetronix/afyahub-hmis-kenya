-- ============================================================
-- 0013  DHA service-area to intervention mapping
-- ============================================================
--
-- DHA adjudicates claim lines against intervention codes. This HMIS bills
-- against its own tariff catalogue, so a facility has to record which
-- intervention code covers each of the eight service areas it delivers.
--
-- No code is seeded here, and none ever should be. The authoritative
-- intervention code belongs to DHA and differs per beneficiary scheme;
-- an invented one would produce a rejected claim. Rows are written by an
-- administrator from the DHA portal.
--
-- One row per facility per service area: a unique index makes the mapping
-- unambiguous, so a claim line can never resolve to two codes.

CREATE TABLE IF NOT EXISTS dha_service_mappings (
  id                  serial PRIMARY KEY,
  tenant_id           integer NOT NULL,
  facility_id         integer NOT NULL,
  service_area        text    NOT NULL,
  intervention_code   text    NOT NULL,
  access_point        text,
  payment_mechanism   text,
  fund                text,
  needs_preauth       boolean,
  notes               text,
  created_by          integer,
  created_at          timestamp NOT NULL DEFAULT now(),
  updated_at          timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS dha_service_mappings_facility_area_idx
  ON dha_service_mappings (facility_id, service_area);

CREATE INDEX IF NOT EXISTS dha_service_mappings_tenant_idx
  ON dha_service_mappings (tenant_id);

COMMENT ON TABLE dha_service_mappings IS
  'Facility-configured link from an HMIS service area to a DHA intervention code. Codes are entered from the DHA portal, never generated here.';

COMMENT ON COLUMN dha_service_mappings.access_point IS
  'Documented DHA access_point enum: IP or OP.';
