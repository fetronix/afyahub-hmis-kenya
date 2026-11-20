# Departments and designations — evidence

**Run date:** 2026-11-20 · **Branch:** `arena/e088f11d-afyahub-hmis-kenya` · **Application:** Syrona Medical Center HMIS (the product was renamed from JaliCare in `aed6e94`)

This directory holds the evidence for one change: a designation must name a
department from the departments that already exist, chosen from a searchable
list, and stored by database id. Every image here is a capture of the running
application against a synthetic PostgreSQL database. No screenshot is composed,
edited, or generated.

## What the run proves

`browser-run.json` records 38 assertions, all **PASS**. They are grouped below by
the test list in the brief.

| # | Requirement | Where it is proved |
| --- | --- | --- |
| 1 | Creating a department | `02-create-department-form.png`; the run creates `Pharmacy <suffix>` and asserts it appears in the list |
| 2 | Loading departments into the Add Designation dropdown | `03-add-designation-department-dropdown.png` — 9 options, each showing code and designation count |
| 3 | Selecting a department | `05-add-designation-filled.png` — the control shows the chosen department |
| 4 | Creating a designation under that department | `06-designations-filtered-by-department.png` |
| 5 | Editing an existing designation | `08-edit-designation.png` — the department is carried into the edit form and preserved on save |
| 6 | Selecting a department during employee registration | `09-employee-registration-scoped-designations.png` |
| 7 | Only that department's designations appear | same image — `Unassigned \| Pharmacist <suffix> II`, with no designation from another department |
| 8 | Changing the department clears the incompatible designation | `10-department-change-clears-designation.png` — the select is empty and now offers `Accountant` |
| 9 | Invalid combinations refused by the API | `POST /api/hr/designations` without a department → `400 INVALID_ID`; into a deactivated department → `409 DEPARTMENT_INACTIVE`; employee with a designation from another department → `409 DESIGNATION_DEPARTMENT_MISMATCH` |
| 10 | Empty department list | The form disables the control, explains that no departments exist and offers **Create a department** (unit test, see below) |
| 11 | Inactive departments and designations | Inactive departments are not offered (and an inactive department is refused by the API); an inactive designation cannot be newly assigned but still displays for staff who already hold it |
| 12 | Existing employee records preserved | `SYNTH-HR-0001` and `SYNTH-HR-0002` still load after every change above |

## Screenshots

| File | Shows |
| --- | --- |
| `01-department-list.png` | Department list with code, name, description, designation count, active staff and status |
| `02-create-department-form.png` | New department form: code, name, description, active toggle |
| `03-add-designation-department-dropdown.png` | **New designation** with the department dropdown open, populated from the backend |
| `04-department-dropdown-search.png` | The same list filtered by typing |
| `05-add-designation-filled.png` | A completed designation form with the department selected |
| `06-designations-filtered-by-department.png` | Designation list filtered to one department |
| `07-designation-list-all.png` | Every designation with its department and staff count |
| `08-edit-designation.png` | Editing a designation, department preserved |
| `09-employee-registration-scoped-designations.png` | Employee form: designation list scoped to the chosen department |
| `10-department-change-clears-designation.png` | After changing department, the previous designation is cleared |

## How it was run

Both passwords are supplied through environment variables and are not recorded
here or in any evidence file.

```bash
# synthetic database, migrations, permissions, fixture
export SQL_HOST=127.0.0.1 SQL_PORT=5432 SQL_DB_NAME=syrona_synthetic_test \
       SQL_ADMIN_USER=postgres SQL_ADMIN_PASSWORD=postgres SQL_SSL=false
npm run db:migrate
npm run db:seed:permissions          # after db:bootstrap-admin
NODE_ENV=test SYNTHETIC_HR_CONFIRM=yes SYNTH_HR_PASSWORD="$SYNTH_HR_PASSWORD" \
  ./node_modules/.bin/tsx scripts/testing/hr-department-designation-fixture.ts

# the evidence run itself
BROWSER_SMOKE_SYNTHETIC=YES BASE_URL=http://127.0.0.1:3000 \
  CHROME_EXECUTABLE_PATH=/tmp/chromium HR_PASSWORD="$SYNTH_HR_PASSWORD" \
  node scripts/testing/hr-department-designation-evidence.mjs
```

The fixture creates one synthetic tenant (`syrona-hr-synthetic`), one facility
(`SYNTH-HR-01`), the HR officer account, the five departments
(Nursing, Finance, Laboratory, Pharmacy, Administration) and six designations
(Nurse, Nursing Officer, Accountant, Laboratory Technician, Pharmacist, HR Officer),
plus two employees used to prove existing records survive.

## Automated tests

| Suite | Result |
| --- | --- |
| `src/tests/vitest/workforce-designation-dialog.spec.tsx` | 16 passed |
| `src/tests/vitest/hr-department-designation.db.spec.ts` | 15 passed (real PostgreSQL) |
| `scripts/testing/hr-department-designation-evidence.mjs` | 38 of 38 checks passed |

## Limitations

- Department records created by each evidence run are left in place (one
  `Pharmacy <suffix>` per run) so the screenshots and the database agree. Earlier
  runs' departments are not deleted, so repeated runs accumulate rows.
- The employee form's designation list is filtered in the browser from the
  facility's designation list, which the module already loads. It is not a
  per-department endpoint; the server refuses a mismatched pair regardless.
- The screenshot run uses the synthetic HR account only. Permission-denied paths
  for departments and designations are not part of this evidence.
