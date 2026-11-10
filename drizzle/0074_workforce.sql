-- Phase 5 workforce: additive only. No existing table is altered and no
-- historical row is rewritten. Every table carries tenant_id and facility_id.
-- Statutory payroll rates are deliberately NOT seeded here: the application
-- ships no Kenyan rates of its own, and a run refuses to calculate until an
-- authorised administrator records a version with its source reference.
CREATE TABLE hr_departments (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  facility_id integer NOT NULL REFERENCES facilities(id),
  code text NOT NULL CONSTRAINT hr_departments_code_check CHECK (code ~ '^[A-Z0-9_-]{2,24}$'),
  name text NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_by integer REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX hr_departments_facility_code_idx ON hr_departments(facility_id, code);
--> statement-breakpoint
CREATE INDEX hr_departments_tenant_idx ON hr_departments(tenant_id, facility_id);
--> statement-breakpoint
CREATE TABLE hr_designations (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  facility_id integer NOT NULL REFERENCES facilities(id),
  department_id integer REFERENCES hr_departments(id),
  title text NOT NULL,
  grade text,
  is_active boolean NOT NULL DEFAULT true,
  created_by integer REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX hr_designations_facility_title_idx ON hr_designations(facility_id, title);
--> statement-breakpoint
CREATE INDEX hr_designations_department_idx ON hr_designations(department_id);
--> statement-breakpoint
CREATE TABLE hr_employees (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  facility_id integer NOT NULL REFERENCES facilities(id),
  employee_number text NOT NULL,
  first_name text NOT NULL,
  middle_name text,
  last_name text NOT NULL,
  gender text,
  date_of_birth date,
  national_id text,
  phone text,
  email text,
  department_id integer REFERENCES hr_departments(id),
  designation_id integer REFERENCES hr_designations(id),
  manager_id integer,
  employment_type text NOT NULL DEFAULT 'PERMANENT'
    CONSTRAINT hr_employees_type_check CHECK (employment_type IN ('PERMANENT','CONTRACT','CASUAL','INTERN','LOCUM')),
  employment_status text NOT NULL DEFAULT 'ACTIVE'
    CONSTRAINT hr_employees_status_check CHECK (employment_status IN ('ACTIVE','ON_LEAVE','SUSPENDED','EXITED')),
  hire_date date NOT NULL,
  exit_date date,
  base_salary_cents bigint NOT NULL DEFAULT 0 CONSTRAINT hr_employees_salary_check CHECK (base_salary_cents >= 0),
  bank_name text,
  bank_account_masked text,
  kra_pin text,
  nssf_number text,
  shif_number text,
  user_id integer REFERENCES users(id),
  notes text,
  created_by integer REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT hr_employees_exit_check CHECK ((employment_status = 'EXITED') = (exit_date IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX hr_employees_facility_number_idx ON hr_employees(facility_id, employee_number);
--> statement-breakpoint
CREATE INDEX hr_employees_facility_status_idx ON hr_employees(facility_id, employment_status);
--> statement-breakpoint
CREATE INDEX hr_employees_department_idx ON hr_employees(department_id);
--> statement-breakpoint
-- A manager must be in the same facility; the composite reference below is
-- enforced with a trigger because it points at a second column pair.
CREATE TABLE hr_employee_documents (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  facility_id integer NOT NULL REFERENCES facilities(id),
  employee_id integer NOT NULL REFERENCES hr_employees(id),
  document_type text NOT NULL,
  title text NOT NULL CONSTRAINT hr_employee_documents_title_check CHECK (length(trim(title)) BETWEEN 2 AND 160),
  file_reference text,
  issued_on date,
  expires_on date,
  uploaded_by integer REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX hr_employee_documents_employee_idx ON hr_employee_documents(employee_id);
--> statement-breakpoint
CREATE TABLE hr_shifts (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  facility_id integer NOT NULL REFERENCES facilities(id),
  name text NOT NULL,
  start_time text NOT NULL CONSTRAINT hr_shifts_time_check CHECK (start_time ~ '^[0-2][0-9]:[0-5][0-9]$' AND end_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  end_time text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_by integer REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX hr_shifts_facility_name_idx ON hr_shifts(facility_id, name);
--> statement-breakpoint
CREATE TABLE hr_roster_entries (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  facility_id integer NOT NULL REFERENCES facilities(id),
  employee_id integer NOT NULL REFERENCES hr_employees(id),
  shift_id integer NOT NULL REFERENCES hr_shifts(id),
  work_date date NOT NULL,
  notes text,
  created_by integer REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX hr_roster_employee_date_idx ON hr_roster_entries(employee_id, work_date);
--> statement-breakpoint
CREATE INDEX hr_roster_facility_date_idx ON hr_roster_entries(facility_id, work_date);
--> statement-breakpoint
CREATE TABLE hr_attendance (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  facility_id integer NOT NULL REFERENCES facilities(id),
  employee_id integer NOT NULL REFERENCES hr_employees(id),
  work_date date NOT NULL,
  status text NOT NULL CONSTRAINT hr_attendance_status_check
    CHECK (status IN ('PRESENT','ABSENT','LEAVE','HOLIDAY','OFF_DUTY','TRAINING')),
  check_in text,
  check_out text,
  hours numeric(6,2),
  notes text,
  recorded_by integer REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX hr_attendance_employee_date_idx ON hr_attendance(employee_id, work_date);
--> statement-breakpoint
CREATE INDEX hr_attendance_facility_date_idx ON hr_attendance(facility_id, work_date);
--> statement-breakpoint
CREATE TABLE hr_leave_types (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  facility_id integer NOT NULL REFERENCES facilities(id),
  code text NOT NULL CONSTRAINT hr_leave_types_code_check CHECK (code ~ '^[A-Z0-9_]{2,24}$'),
  name text NOT NULL,
  annual_entitlement_days numeric(6,2) NOT NULL DEFAULT 0
    CONSTRAINT hr_leave_types_days_check CHECK (annual_entitlement_days BETWEEN 0 AND 366),
  paid boolean NOT NULL DEFAULT true,
  requires_approval boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  created_by integer REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX hr_leave_types_facility_code_idx ON hr_leave_types(facility_id, code);
--> statement-breakpoint
CREATE TABLE hr_leave_requests (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  facility_id integer NOT NULL REFERENCES facilities(id),
  employee_id integer NOT NULL REFERENCES hr_employees(id),
  leave_type_id integer NOT NULL REFERENCES hr_leave_types(id),
  start_date date NOT NULL,
  end_date date NOT NULL,
  days numeric(6,2) NOT NULL CONSTRAINT hr_leave_requests_days_check CHECK (days > 0 AND days <= 366),
  reason text,
  status text NOT NULL DEFAULT 'PENDING'
    CONSTRAINT hr_leave_requests_status_check CHECK (status IN ('PENDING','APPROVED','REJECTED','CANCELLED')),
  decided_by integer REFERENCES users(id),
  decided_at timestamp,
  decision_note text,
  created_by integer REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT hr_leave_requests_range_check CHECK (end_date >= start_date),
  CONSTRAINT hr_leave_requests_decision_check
    CHECK ((status IN ('APPROVED','REJECTED')) = (decided_by IS NOT NULL AND decided_at IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX hr_leave_requests_facility_status_idx ON hr_leave_requests(facility_id, status);
--> statement-breakpoint
CREATE INDEX hr_leave_requests_employee_idx ON hr_leave_requests(employee_id);
--> statement-breakpoint
CREATE TABLE payroll_statutory_versions (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  facility_id integer NOT NULL REFERENCES facilities(id),
  statute text NOT NULL CONSTRAINT payroll_statutory_versions_statute_check
    CHECK (statute IN ('PAYE','NSSF','SHIF','AHL')),
  label text NOT NULL,
  effective_from date NOT NULL,
  effective_to date,
  authority text NOT NULL,
  source_reference text NOT NULL
    CONSTRAINT payroll_statutory_versions_source_check CHECK (length(trim(source_reference)) BETWEEN 8 AND 500),
  basis text NOT NULL DEFAULT 'GROSS',
  status text NOT NULL DEFAULT 'DRAFT'
    CONSTRAINT payroll_statutory_versions_status_check CHECK (status IN ('DRAFT','ACTIVE','RETIRED')),
  notes text,
  created_by integer REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT payroll_statutory_versions_range_check CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
--> statement-breakpoint
CREATE UNIQUE INDEX payroll_statutory_versions_facility_statute_from_idx
  ON payroll_statutory_versions(facility_id, statute, effective_from);
--> statement-breakpoint
CREATE INDEX payroll_statutory_versions_lookup_idx
  ON payroll_statutory_versions(facility_id, statute, status);
--> statement-breakpoint
CREATE TABLE payroll_statutory_bands (
  id serial PRIMARY KEY,
  version_id integer NOT NULL REFERENCES payroll_statutory_versions(id) ON DELETE CASCADE,
  sequence integer NOT NULL,
  lower_bound_cents bigint NOT NULL DEFAULT 0 CONSTRAINT payroll_statutory_bands_bounds_check CHECK (lower_bound_cents >= 0),
  upper_bound_cents bigint,
  employee_rate_bp integer NOT NULL DEFAULT 0,
  employer_rate_bp integer NOT NULL DEFAULT 0,
  employee_fixed_cents bigint NOT NULL DEFAULT 0,
  employer_fixed_cents bigint NOT NULL DEFAULT 0,
  employee_cap_cents bigint,
  employer_cap_cents bigint,
  relief_cents bigint NOT NULL DEFAULT 0,
  CONSTRAINT payroll_statutory_bands_range_check
    CHECK (upper_bound_cents IS NULL OR upper_bound_cents > lower_bound_cents),
  CONSTRAINT payroll_statutory_bands_rate_check
    CHECK (employee_rate_bp BETWEEN 0 AND 10000 AND employer_rate_bp BETWEEN 0 AND 10000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX payroll_statutory_bands_order_idx ON payroll_statutory_bands(version_id, sequence);
--> statement-breakpoint
CREATE TABLE payroll_employee_components (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  facility_id integer NOT NULL REFERENCES facilities(id),
  employee_id integer NOT NULL REFERENCES hr_employees(id),
  code text NOT NULL,
  name text NOT NULL,
  kind text NOT NULL CONSTRAINT payroll_employee_components_kind_check CHECK (kind IN ('EARNING','DEDUCTION')),
  amount_cents bigint NOT NULL CONSTRAINT payroll_employee_components_amount_check CHECK (amount_cents > 0),
  taxable boolean NOT NULL DEFAULT true,
  effective_from date NOT NULL,
  effective_to date,
  is_active boolean NOT NULL DEFAULT true,
  created_by integer REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX payroll_employee_components_key_idx
  ON payroll_employee_components(employee_id, code, effective_from);
--> statement-breakpoint
CREATE INDEX payroll_employee_components_lookup_idx
  ON payroll_employee_components(employee_id, is_active);
--> statement-breakpoint
CREATE TABLE payroll_account_settings (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  facility_id integer NOT NULL REFERENCES facilities(id),
  salary_expense_account_id integer NOT NULL,
  employer_cost_account_id integer NOT NULL,
  net_pay_payable_account_id integer NOT NULL,
  paye_payable_account_id integer NOT NULL,
  nssf_payable_account_id integer NOT NULL,
  shif_payable_account_id integer NOT NULL,
  ahl_payable_account_id integer NOT NULL,
  other_deductions_payable_account_id integer,
  updated_by integer REFERENCES users(id),
  updated_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX payroll_account_settings_facility_idx ON payroll_account_settings(facility_id);
--> statement-breakpoint
CREATE TABLE payroll_periods (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  facility_id integer NOT NULL REFERENCES facilities(id),
  name text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  pay_date date NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT'
    CONSTRAINT payroll_periods_status_check CHECK (status IN ('DRAFT','OPEN','CLOSED')),
  created_by integer REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT payroll_periods_range_check CHECK (end_date >= start_date)
);
--> statement-breakpoint
CREATE UNIQUE INDEX payroll_periods_facility_range_idx ON payroll_periods(facility_id, start_date, end_date);
--> statement-breakpoint
CREATE TABLE payroll_runs (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  facility_id integer NOT NULL REFERENCES facilities(id),
  period_id integer NOT NULL REFERENCES payroll_periods(id),
  status text NOT NULL DEFAULT 'DRAFT'
    CONSTRAINT payroll_runs_status_check CHECK (status IN ('DRAFT','CALCULATED','APPROVED','POSTED')),
  employee_count integer NOT NULL DEFAULT 0,
  gross_cents bigint NOT NULL DEFAULT 0,
  taxable_cents bigint NOT NULL DEFAULT 0,
  paye_cents bigint NOT NULL DEFAULT 0,
  nssf_employee_cents bigint NOT NULL DEFAULT 0,
  nssf_employer_cents bigint NOT NULL DEFAULT 0,
  shif_cents bigint NOT NULL DEFAULT 0,
  ahl_employee_cents bigint NOT NULL DEFAULT 0,
  ahl_employer_cents bigint NOT NULL DEFAULT 0,
  other_deductions_cents bigint NOT NULL DEFAULT 0,
  net_cents bigint NOT NULL DEFAULT 0,
  statutory_version_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  calculated_by integer REFERENCES users(id),
  calculated_at timestamp,
  approved_by integer REFERENCES users(id),
  approved_at timestamp,
  posted_by integer REFERENCES users(id),
  posted_at timestamp,
  journal_entry_id integer,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT payroll_runs_approval_check
    CHECK ((status IN ('APPROVED','POSTED')) = (approved_by IS NOT NULL AND approved_at IS NOT NULL)),
  CONSTRAINT payroll_runs_segregation_check
    CHECK (approved_by IS NULL OR calculated_by IS NULL OR approved_by <> calculated_by)
);
--> statement-breakpoint
CREATE UNIQUE INDEX payroll_runs_period_idx ON payroll_runs(period_id);
--> statement-breakpoint
CREATE INDEX payroll_runs_facility_status_idx ON payroll_runs(facility_id, status);
--> statement-breakpoint
CREATE TABLE payroll_payslips (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id),
  facility_id integer NOT NULL REFERENCES facilities(id),
  run_id integer NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  employee_id integer NOT NULL REFERENCES hr_employees(id),
  gross_cents bigint NOT NULL,
  taxable_cents bigint NOT NULL,
  paye_cents bigint NOT NULL,
  nssf_employee_cents bigint NOT NULL,
  nssf_employer_cents bigint NOT NULL,
  shif_cents bigint NOT NULL,
  ahl_employee_cents bigint NOT NULL,
  ahl_employer_cents bigint NOT NULL,
  other_deductions_cents bigint NOT NULL,
  net_cents bigint NOT NULL CONSTRAINT payroll_payslips_net_check CHECK (net_cents >= 0),
  breakdown jsonb NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX payroll_payslips_run_employee_idx ON payroll_payslips(run_id, employee_id);
--> statement-breakpoint
CREATE INDEX payroll_payslips_employee_idx ON payroll_payslips(employee_id);
--> statement-breakpoint
CREATE TABLE payroll_payslip_lines (
  id serial PRIMARY KEY,
  payslip_id integer NOT NULL REFERENCES payroll_payslips(id) ON DELETE CASCADE,
  sequence integer NOT NULL DEFAULT 0,
  code text NOT NULL,
  name text NOT NULL,
  kind text NOT NULL CONSTRAINT payroll_payslip_lines_kind_check
    CHECK (kind IN ('EARNING','DEDUCTION','EMPLOYER')),
  amount_cents bigint NOT NULL
);
--> statement-breakpoint
CREATE INDEX payroll_payslip_lines_payslip_idx ON payroll_payslip_lines(payslip_id);
--> statement-breakpoint
-- Scope guards: a row must never point at another facility's employee.
CREATE FUNCTION jcare_workforce_scope_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE emp_facility integer; emp_tenant integer; emp_id integer; manager_id integer;
BEGIN
  /*
   * PL/pgSQL resolves NEW.<column> when the statement is first executed, and a
   * shared trigger function runs for tables with different columns. Reading
   * through to_jsonb means a table without `employee_id` or `manager_id` is
   * never asked for a field it does not have.
   */
  emp_id := (to_jsonb(NEW) ->> 'employee_id')::integer;
  IF emp_id IS NOT NULL THEN
    SELECT facility_id, tenant_id INTO emp_facility, emp_tenant FROM hr_employees WHERE id = emp_id;
    IF emp_facility IS NULL OR emp_facility <> NEW.facility_id OR emp_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'Workforce row must reference an employee in the same tenant and facility' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_TABLE_NAME = 'hr_employees' THEN
    manager_id := (to_jsonb(NEW) ->> 'manager_id')::integer;
    IF manager_id IS NOT NULL THEN
      IF NOT EXISTS (SELECT 1 FROM hr_employees m WHERE m.id = manager_id AND m.facility_id = NEW.facility_id AND m.tenant_id = NEW.tenant_id) THEN
        RAISE EXCEPTION 'Manager must belong to the same tenant and facility' USING ERRCODE = '23514';
      END IF;
      IF manager_id = NEW.id THEN
        RAISE EXCEPTION 'An employee cannot be their own manager' USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER hr_employees_scope_guard BEFORE INSERT OR UPDATE ON hr_employees
  FOR EACH ROW EXECUTE FUNCTION jcare_workforce_scope_guard();
--> statement-breakpoint
CREATE TRIGGER hr_employee_documents_scope_guard BEFORE INSERT OR UPDATE ON hr_employee_documents
  FOR EACH ROW EXECUTE FUNCTION jcare_workforce_scope_guard();
--> statement-breakpoint
CREATE TRIGGER hr_attendance_scope_guard BEFORE INSERT OR UPDATE ON hr_attendance
  FOR EACH ROW EXECUTE FUNCTION jcare_workforce_scope_guard();
--> statement-breakpoint
CREATE TRIGGER hr_roster_entries_scope_guard BEFORE INSERT OR UPDATE ON hr_roster_entries
  FOR EACH ROW EXECUTE FUNCTION jcare_workforce_scope_guard();
--> statement-breakpoint
CREATE TRIGGER hr_leave_requests_scope_guard BEFORE INSERT OR UPDATE ON hr_leave_requests
  FOR EACH ROW EXECUTE FUNCTION jcare_workforce_scope_guard();
--> statement-breakpoint
CREATE TRIGGER payroll_employee_components_scope_guard BEFORE INSERT OR UPDATE ON payroll_employee_components
  FOR EACH ROW EXECUTE FUNCTION jcare_workforce_scope_guard();
--> statement-breakpoint
CREATE TRIGGER payroll_payslips_scope_guard BEFORE INSERT OR UPDATE ON payroll_payslips
  FOR EACH ROW EXECUTE FUNCTION jcare_workforce_scope_guard();
