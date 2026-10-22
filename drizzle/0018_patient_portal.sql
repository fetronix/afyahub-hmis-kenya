-- ============================================================
-- 0018  Patient digital health record portal
-- ============================================================
--
-- A patient-facing portal that lets a patient read their own
-- authorised record. It does NOT create a second patient record and
-- does NOT put patients into the `users` table: a portal account is a
-- separate identity with no staff role and no access to staff APIs.
--
-- Six tables:
--
--   1. patient_portal_accounts        one per patient, enforced by
--                                     a UNIQUE constraint
--   2. patient_portal_invitations     single-use, hashed token
--   3. patient_portal_invitation_events  delivery history, separate
--                                     from invitation status
--   4. patient_portal_sessions        patient sessions, hash-only
--   5. patient_portal_settings        per-facility policy
--   6. patient_record_sharing_grants  time-limited, revocable sharing
--
-- Everything is additive. No existing table is altered, no row is
-- deleted, and no column is dropped.
-- ============================================================


-- ------------------------------------------------------------
-- 1. Portal accounts
-- ------------------------------------------------------------
--
-- `patient_id` is UNIQUE. That is the database enforcing "one patient,
-- one portal account" — not an application check that a race can pass
-- twice. `login_identifier` is also UNIQUE so that two people who share
-- a phone number cannot both activate with it; the second is routed to
-- staff-assisted verification instead of being silently linked.

CREATE TABLE IF NOT EXISTS patient_portal_accounts (
  id serial PRIMARY KEY,

  tenant_id integer NOT NULL
    REFERENCES tenants(id),

  facility_id integer
    REFERENCES facilities(id),

  patient_id integer NOT NULL
    REFERENCES patients(id),

  /*
    Normalised phone (digits only) or lower-cased email. This is the
    value the patient types to log in, so it must be unambiguous.
  */
  login_identifier text NOT NULL,

  /*
    PHONE | EMAIL — what login_identifier actually is.
  */
  login_type text NOT NULL DEFAULT 'PHONE',

  password_hash text NOT NULL,

  /*
    PENDING_VERIFICATION  created, awaiting staff identity check
    ACTIVE                usable
    SUSPENDED             temporarily blocked by an administrator
    REVOKED               access withdrawn
  */
  status text NOT NULL DEFAULT 'ACTIVE',

  must_change_password boolean NOT NULL DEFAULT false,

  failed_login_attempts integer NOT NULL DEFAULT 0,

  locked_until timestamp,

  activated_at timestamp,

  last_login_at timestamp,

  suspended_at timestamp,
  suspended_by_user_id integer REFERENCES users(id),
  suspended_reason text,

  revoked_at timestamp,
  revoked_by_user_id integer REFERENCES users(id),
  revoked_reason text,

  /*
    Opaque identifier carried by the digital patient card's QR code.
    Stored as a SHA-256 hash so a database dump does not yield a set of
    scannable patient codes. Scanning never authenticates anyone.
  */
  qr_token_hash text,

  /*
    The code itself, sealed with AES-256-GCM when FIELD_ENCRYPTION_KEY is
    configured. The hash is what a scan looks up; this column exists so the
    patient can re-open their own card. It is an opaque random identifier
    that reveals nothing on its own — see docs/patient-portal.
  */
  qr_token_sealed text,

  qr_issued_at timestamp,

  security_version integer NOT NULL DEFAULT 1,

  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS patient_portal_accounts_patient_idx
  ON patient_portal_accounts (patient_id);

CREATE UNIQUE INDEX IF NOT EXISTS patient_portal_accounts_login_idx
  ON patient_portal_accounts (login_identifier);

CREATE UNIQUE INDEX IF NOT EXISTS patient_portal_accounts_qr_idx
  ON patient_portal_accounts (qr_token_hash)
  WHERE qr_token_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS patient_portal_accounts_scope_idx
  ON patient_portal_accounts (tenant_id, facility_id, status);


-- ------------------------------------------------------------
-- 2. Invitations
-- ------------------------------------------------------------
--
-- `token_hash` only. The raw token exists in exactly two places: the
-- response that created it (shown once to the receptionist for a
-- manual handout) and the patient's browser. It is never written to a
-- log, an audit row or an error message.

CREATE TABLE IF NOT EXISTS patient_portal_invitations (
  id serial PRIMARY KEY,

  tenant_id integer NOT NULL
    REFERENCES tenants(id),

  facility_id integer NOT NULL
    REFERENCES facilities(id),

  patient_id integer NOT NULL
    REFERENCES patients(id),

  token_hash text NOT NULL,

  /*
    MANUAL  handed over at the desk (no provider required)
    SMS     sent through a configured provider
    EMAIL   sent through a configured provider
  */
  delivery_channel text NOT NULL DEFAULT 'MANUAL',

  /*
    PENDING        created, not yet handed over or accepted by a provider
    SENT           a provider accepted it
    FAILED         the provider rejected it
    NOT_CONFIGURED no provider exists for this channel
    HANDED_OVER    staff delivered it manually
  */
  delivery_status text NOT NULL DEFAULT 'PENDING',

  /*
    PENDING | ACTIVATED | EXPIRED | REVOKED | SUPERSEDED
    The stored value is what the row last had; `deriveInvitationStatus`
    re-evaluates PENDING against `expires_at` on read so an expired
    invitation never reads as pending.
  */
  status text NOT NULL DEFAULT 'PENDING',

  /*
    ACTIVATION | RECOVERY | REVERIFICATION
  */
  purpose text NOT NULL DEFAULT 'ACTIVATION',

  /*
    Masked contact for display: 0712***789 / j***@example.com.
    Never the full identifier — the desk already knows the patient.
  */
  contact_hint text,

  delivery_attempts integer NOT NULL DEFAULT 0,

  last_delivery_error text,

  expires_at timestamp NOT NULL,

  created_by_user_id integer REFERENCES users(id),

  created_at timestamp NOT NULL DEFAULT now(),

  sent_at timestamp,

  handed_over_at timestamp,

  activated_at timestamp,

  revoked_at timestamp,
  revoked_by_user_id integer REFERENCES users(id),
  revoked_reason text,

  superseded_by integer REFERENCES patient_portal_invitations(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS patient_portal_invitations_token_idx
  ON patient_portal_invitations (token_hash);

CREATE INDEX IF NOT EXISTS patient_portal_invitations_patient_idx
  ON patient_portal_invitations (patient_id, created_at DESC);

CREATE INDEX IF NOT EXISTS patient_portal_invitations_scope_idx
  ON patient_portal_invitations (tenant_id, facility_id, status);


-- ------------------------------------------------------------
-- 3. Invitation delivery events
-- ------------------------------------------------------------
--
-- Delivery and redemption are different things and are recorded
-- separately, so "the SMS was delivered" can never be read as "the
-- patient activated".

CREATE TABLE IF NOT EXISTS patient_portal_invitation_events (
  id serial PRIMARY KEY,

  invitation_id integer NOT NULL
    REFERENCES patient_portal_invitations(id),

  /*
    CREATED | DELIVERY_ATTEMPTED | DELIVERY_SENT | DELIVERY_FAILED
    DELIVERY_NOT_CONFIGURED | HANDED_OVER | REDEEMED | REDEEM_REJECTED
    REVOKED | SUPERSEDED
  */
  event_type text NOT NULL,

  /*
    Sanitised detail. Callers must never pass a token or a full contact
    value into this column; `describeEvent` enforces a fixed vocabulary.
  */
  detail text,

  actor_user_id integer REFERENCES users(id),

  ip_address text,

  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS patient_portal_events_invitation_idx
  ON patient_portal_invitation_events (invitation_id, created_at DESC);


-- ------------------------------------------------------------
-- 4. Patient sessions
-- ------------------------------------------------------------
--
-- Same shape as the staff `sessions` table and the same rule: only a
-- hash is stored. Portal sessions are deliberately shorter-lived.

CREATE TABLE IF NOT EXISTS patient_portal_sessions (
  id serial PRIMARY KEY,

  account_id integer NOT NULL
    REFERENCES patient_portal_accounts(id),

  session_token_hash text NOT NULL,

  ip_address text,

  user_agent text,

  created_at timestamp NOT NULL DEFAULT now(),

  last_activity_at timestamp NOT NULL DEFAULT now(),

  expires_at timestamp NOT NULL,

  revoked_at timestamp,

  revoke_reason text
);

CREATE UNIQUE INDEX IF NOT EXISTS patient_portal_sessions_token_idx
  ON patient_portal_sessions (session_token_hash);

CREATE INDEX IF NOT EXISTS patient_portal_sessions_account_idx
  ON patient_portal_sessions (account_id, expires_at DESC);


-- ------------------------------------------------------------
-- 5. Facility portal settings
-- ------------------------------------------------------------
--
-- Only presentation and delivery choices live here. The bounds in
-- `clampPortalPolicy` stop a facility from setting a ten-year expiry or
-- disabling the token requirement, because those are not settings.

CREATE TABLE IF NOT EXISTS patient_portal_settings (
  id serial PRIMARY KEY,

  facility_id integer NOT NULL
    REFERENCES facilities(id),

  tenant_id integer NOT NULL
    REFERENCES tenants(id),

  invitation_expiry_hours integer NOT NULL DEFAULT 72,

  max_resends integer NOT NULL DEFAULT 3,

  allow_manual_delivery boolean NOT NULL DEFAULT true,

  allow_sms boolean NOT NULL DEFAULT false,

  allow_email boolean NOT NULL DEFAULT false,

  show_lab_results boolean NOT NULL DEFAULT true,

  show_appointments boolean NOT NULL DEFAULT true,

  show_prescriptions boolean NOT NULL DEFAULT true,

  show_allergies boolean NOT NULL DEFAULT true,

  show_discharge_summaries boolean NOT NULL DEFAULT true,

  allow_downloads boolean NOT NULL DEFAULT true,

  updated_by_user_id integer REFERENCES users(id),

  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS patient_portal_settings_facility_idx
  ON patient_portal_settings (facility_id);


-- ------------------------------------------------------------
-- 6. Record sharing grants
-- ------------------------------------------------------------
--
-- A patient may release selected categories to a named recipient for a
-- limited time. The grant is redeemed by an authenticated staff member
-- with `patients.read` inside the same tenant; it is not a public link
-- and it is not a national HIE integration.

CREATE TABLE IF NOT EXISTS patient_record_sharing_grants (
  id serial PRIMARY KEY,

  tenant_id integer NOT NULL
    REFERENCES tenants(id),

  patient_id integer NOT NULL
    REFERENCES patients(id),

  created_by_account_id integer NOT NULL
    REFERENCES patient_portal_accounts(id),

  /*
    SHA-256 of the one-time code shown to the patient.
  */
  code_hash text NOT NULL,

  recipient_name text NOT NULL,

  purpose text NOT NULL,

  /*
    JSON array of allowed categories, drawn from SHARING_CATEGORIES:
    demographics, encounters, diagnoses, medications, laboratory,
    radiology, maternity, billing.
  */
  categories jsonb NOT NULL DEFAULT '[]'::jsonb,

  expires_at timestamp NOT NULL,

  revoked_at timestamp,

  redeemed_at timestamp,

  redeemed_by_user_id integer REFERENCES users(id),

  created_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS patient_record_sharing_grants_code_idx
  ON patient_record_sharing_grants (code_hash);

CREATE INDEX IF NOT EXISTS patient_record_sharing_grants_patient_idx
  ON patient_record_sharing_grants (patient_id, created_at DESC);
