# Duty roster, shift assignment and clock-in / clock-out — evidence

**Run date:** 2026-11-20 · **Branch:** `arena/e088f11d-afyahub-hmis-kenya` · **Application:** Syrona Medical Center HMIS · **Database:** synthetic PostgreSQL (`syrona_synthetic_test`, 109 migrations)

Every image in this directory is a capture of the running application driven by
Chromium against that synthetic database. No screenshot is composed, edited or
generated. **All names, employee numbers, shifts and attendance records below
are synthetic test data, not real staff data.** The figures are illustrative of
the workflow, not of any real facility's attendance.

---

## 1. What was reported

| Report | What the user saw | What was actually true |
| --- | --- | --- |
| "The attendance table says **Not recorded** for clock-in" | An attendance tab with a clock-in column that never filled | There was **no clock-in action anywhere in the application**. The column was bound to a field nothing ever wrote. |
| "There is no **Clock In / Clock Out** button" | No control to record arrival or departure | Correct. Attendance was a hand-typed status ("PRESENT", "LEAVE", …) posted by a manager; no timestamp was ever generated. |
| "A shift 07:19–18:19 exists but **Nobody is rostered for today**" | A shift that looked like a duty roster | The screen listed **shift definitions**, not assignments. `hr_roster_entries` existed but had **no screen and no caller**: the API function that would assign staff was never invoked. There genuinely were zero assignments, so the message was accurate. |

## 2. Root causes

1. **No clock workflow existed.** The attendance table was a free-entry status
   register: `POST /api/hr/attendance` accepted a status string and wrote a row,
   and the UI rendered whatever was there. `hr_attendance` had **no
   `clock_in_at` / `clock_out_at` columns at all**, so "Not recorded" was the
   literal truth rather than a rendering defect.
2. **Shift ≠ roster, and the UI blurred the two.** `hr_shifts` held a reusable
   definition and `hr_roster_entries` held (employee, date, shift) assignments,
   but the module rendered the *shift list* under a dated heading and labelled
   it as today's roster. Because no assignment could be created from the
   interface, "Nobody is rostered for today" was correct.
3. **UTC was used where the facility's local day was meant.** "Today" came from
   `toISOString().slice(0, 10)` with no facility time zone, so between 00:00 and
   03:00 Nairobi time the screen showed the previous day and would have written
   roster rows under the wrong date.
4. **The data model could not express the policy.** Shifts had no description,
   no break duration, no department applicability and no expected hours;
   attendance had no `LATE`, `INCOMPLETE`, overtime, correction history, grace
   period, absence cutoff, time zone or holiday table.
5. **A duplicate DOM id** — `#assign-shift` was used by both the toolbar button
   and the shift `<select>` inside the assign dialog. Found while scripting the
   evidence run (`Element is not a <select>`); the dialog control is now
   `#assign-shift-select`. This was a real accessibility/automation defect, not
   only a test artefact.

## 3. What was built

### Database — `drizzle/0109_hr_roster_attendance.sql` (journal index 108 → 109)

Additive only; no existing row is touched.

- `hr_shifts` + `description`, `break_minutes` (0–480, default 0),
  `department_id`, `updated_at`; checks that start ≠ end; unique
  `(facility_id, name)`.
- `hr_roster_entries` + `department_id`, `status` (`ASSIGNED`/`CANCELLED`),
  `cancelled_at`, `cancelled_by`, `cancel_reason`, `updated_at`.
- `hr_attendance` + `roster_entry_id`, `shift_id`, `clock_in_at`,
  `clock_out_at`, `scheduled_minutes`, `late_minutes`, `worked_minutes`,
  `overtime_minutes`, `corrected_at`; widened status check to
  `PRESENT, LATE, ABSENT, LEAVE, HOLIDAY, OFF_DUTY, TRAINING, INCOMPLETE`.
- New: `hr_attendance_policies` (grace, absence cutoff, time zone — default
  **Africa/Nairobi**), `hr_holidays`, `hr_attendance_corrections`
  (previous/new status and instants, reason, actor, timestamp).

### Service — `src/workforce/workforce.service.ts`

Shift timing (overnight detection, break netting, expected hours), roster
assignment with duplicate/conflict/scope guards, per-day attendance derivation
(`CLOCKED_IN`, `CLOCKED_OUT`, `NOT_STARTED`, `ABSENT`, `EXCUSED`,
`UNROSTERED`), server-generated clock in/out, lateness against shift start +
grace, worked minutes and overtime from actual instants, HR corrections with a
mandatory reason and audit row, holiday/leave/off-duty precedence, and the
attendance policy that drives grace and the absence cutoff.

### API — `src/routes/workforce.routes.ts`

```
GET  /api/hr/me/employee                       GET|POST /api/hr/roster
GET|POST /api/hr/shifts                        POST /api/hr/roster/:id/cancel
PUT  /api/hr/shifts/:id                        GET  /api/hr/attendance
GET|PUT /api/hr/attendance/policy              POST /api/hr/attendance
GET|POST /api/hr/holidays                      POST /api/hr/attendance/clock-in
DELETE /api/hr/holidays/:id                    POST /api/hr/attendance/clock-out
GET  /api/hr/attendance/:id/history            POST /api/hr/attendance/correction
```

### Interface — `src/components/modules/hr/AttendanceRoster.tsx` (new tab)

Summary cards (expected, present, late, absent, on approved leave, off duty,
not yet clocked in, clocked in / not out); attendance table (employee, employee
number, department, designation, assigned shift, scheduled start/end, actual
clock-in/out, status, hours, actions); shift-template table that says in plain
words that a shift is a definition and assigning it is a separate step; daily /
weekly / monthly duty roster with department, employee and shift filters;
dialogs for new/edit shift, assign shift (one or many employees, already-
rostered staff marked), cancel assignment (reason), HR correction (reason) and
attendance history. Loading, empty and error states are present, and the
employee number is kept out of the department column.

## 4. The fifteen scenarios

Executed 2026-11-20. `PASS` means the assertion ran and reported success;
nothing here is inferred from reading code.

| # | Scenario | Where it was executed | Result |
| --- | --- | --- | --- |
| 1 | Create a shift | `hr-duty-roster-attendance.db.spec.ts` "1. creates a shift as a template, with no roster entry and no attendance"; browser check 1 | **PASS** |
| 2 | Assign an employee for today | DB "2–3. assigns an employee to a shift for today and lists them as rostered"; browser check 2 (two employees through the dialog) | **PASS** |
| 3 | Appears in "Rostered today" | DB "2–3"; browser check 3 (both assignments persist on re-read; shift row shows 2 rostered) | **PASS** |
| 4 | Clock-in persists after refresh | DB "4–6. records a server clock-in, then a clock-out, and survives a re-read"; browser check 5 (timestamp survives a re-read) | **PASS** |
| 5 | Clock In → Clock Out | DB "4–6"; browser 5 then 6 | **PASS** |
| 6 | Clock-out keeps both timestamps | DB "4–6"; browser check 6 — `18:51 → 18:52` | **PASS** |
| 7 | Employee with no roster assignment | DB "7. refuses a clock-in for an employee with no roster assignment"; browser `409 NO_ROSTER_ASSIGNMENT: No roster assignment covers this moment. Ask HR to add you to the roster before clocking in.` | **PASS** |
| 8 | Late arrival | DB "5. late arrival is measured against the shift start and the configured grace"; DB "12." for the absence cutoff | **PASS** |
| 9 | Overnight shift | DB "marks a shift whose end precedes its start as overnight and subtracts the break"; the browser run's shift is itself overnight (`18:45–02:45 +1`) and is labelled `(overnight)` with `+1` on the end time | **PASS** |
| 10 | Approved leave / holiday / off duty are not absences | DB "10. reports approved leave, holiday and off duty instead of absence"; DB "10. refuses a hand-recorded PRESENT"; browser 10a (`HOLIDAY`) and 10b (`OFF_DUTY`, 201) | **PASS** |
| 11 | Duplicate clock-in and invalid clock-out rejected | DB "11."; browser 11a `409 ALREADY_CLOCKED_IN`, 11b `409 NOT_CLOCKED_IN` | **PASS** |
| 12 | Department and date filtering | Browser 12a (attendance rows filtered to Nursing) and 12b (roster filtered to Nursing) | **PASS** |
| 13 | Unauthorised attendance actions | Browser: an ordinary employee clocking a colleague → `403 NOT_YOUR_ATTENDANCE`; UI spec "hides management actions from a user without hr.manage" | **PASS** |
| 14 | Records correct after an application restart | The app server was stopped and started again, then the same read ran: date, `attendanceId 29`, `18:51 → 02:51`, 480 worked minutes, 30 overtime minutes and the correction's author/reason were byte-for-byte identical | **PASS** |
| 15 | Payroll consumes only approved attendance where configured | **No configured rule consumes attendance.** Payroll builds from salary and registered components; overtime is written to `hr_attendance` only. `hr-attendance-payroll-isolation.spec.ts` (4 tests) guards that shape so it cannot be wired silently | **PASS as a documented limitation** — see §7 |

## 5. Tests actually run

Command (from the repository root, synthetic DB on `127.0.0.1:5432`):

```
SYRONA_DB_AVAILABLE=1 npx vitest run \
  src/tests/vitest/hr-duty-roster-attendance.db.spec.ts \
  src/tests/vitest/workforce-attendance-roster.spec.tsx \
  src/tests/vitest/hr-attendance-payroll-isolation.spec.ts
```

| Suite | Tests | Result |
| --- | --- | --- |
| `hr-duty-roster-attendance.db.spec.ts` (real PostgreSQL) | 21 | **21 / 21 PASS** |
| `workforce-attendance-roster.spec.tsx` (jsdom UI) | 13 | **13 / 13 PASS** |
| `hr-attendance-payroll-isolation.spec.ts` (source-shape guards) | 4 | **4 / 4 PASS** |
| **Total** | **38** | **38 / 38 PASS** |

Browser evidence run (`scripts/testing/hr-duty-roster-attendance-evidence.mjs`,
Chromium against `http://127.0.0.1:3000`): **21 / 21 checks PASS**; the JSON log
is `browser-run.json`. Builds: `npm run build` and `npm run build:server` both
exit 0.

Before each run of the browser script the same day is cleared with
`scripts/testing/hr-roster-attendance-reset.ts`, which refuses to run outside a
test environment and deletes attendance, corrections and roster entries **for
the synthetic employees only**.

## 6. Screenshots

| File | What it shows |
| --- | --- |
| `01-shift-creation.png` | New-shift dialog: name, description, start 18:45, end 02:45, 30-minute break, the explicit "ends on the following day — overnight shift" notice, department and active flag |
| `02-roster-assignment.png` | Assign-shift dialog: work date 2026-11-20, department filter, shift select, search, two synthetic employees ticked with their departments |
| `03-todays-roster.png` | Both employees now on today's attendance table with the assigned shift, and two rows in the duty roster below; the shift template row reads "Rostered today: 2" |
| `04-attendance-before-clock-in.png` | Before any clock: clock-in and clock-out are em dashes, status "Not clocked in", action is **Clock in** |
| `05-attendance-after-clock-in.png` | After clock-in: clock-in `18:51`, status **Present**, action is now **Clock out**; the second employee still offers Clock in |
| `06-attendance-after-clock-out.png` | After clock-out: both `18:51` and `18:52` shown, hours `1m` (measured, not assumed) |
| `07-attendance-summary.png` | Summary cards from the API: expected 2, present 1, late 0, absent 0, on approved leave 0, off duty 0, not yet clocked in 1, clocked in / not out 0 |
| `08-attendance-history.png` | Attendance history dialog: `PRESENT → PRESENT`, author "Synthetic HR Officer", timestamp, and the correction reason |

The screen captures after clock-in show the synthetic HR officer's session
(`Synthetic HR Officer`) and the facility ("Syrona Medical Center — Synthetic").
No real person, password, token or patient appears in any image.

## 7. Remaining limitations

- **Payroll does not consume attendance or overtime.** There is no configured
  rule that maps attendance to pay, and this change does not invent one.
  Overtime minutes are recorded on the attendance row and are available for a
  future, deliberately configured payroll rule. Scenario 15 is therefore
  satisfied only in the sense that nothing unapproved flows into payroll.
- **No employee self-service screen.** The application has no staff portal, so
  clocking is performed by HR-authorized users on the employee's behalf. The
  service refuses one employee clocking another (`403 NOT_YOUR_ATTENDANCE`) and
  refuses any attendance action from users without the HR permission.
- **Break deduction.** Break minutes reduce the shift's *expected* hours. Worked
  minutes are the elapsed time between the recorded instants; a break is not
  inferred from the clock times, so an employee who forgets to clock out for
  lunch is not silently docked.
- **Overnight attendance** is resolved by which shift window covers the moment
  on the selected date; a night shift that has not yet ended still appears under
  its start date. Multi-day rosters beyond the daily/weekly/monthly views
  (e.g. rolling 6-week rota patterns) are not modelled.
- **Corrections are restricted to HR** and require a reason of at least five
  characters; there is no approval workflow above that, and no payroll sign-off
  step.
- **Not a production-readiness claim.** These results show that the workflow
  behaves as described against a synthetic database on this branch. They do not
  certify the product for live use, and nothing here has been deployed.

## 8. Reproducing

```bash
# 1. synthetic database and fixture (tenant SYNTH-HR-01, employees 1–2)
NODE_ENV=test SYNTHETIC_HR_CONFIRM=yes npx tsx scripts/testing/hr-roster-attendance-fixture.ts

# 2. clear the day before a re-run
NODE_ENV=test SYNTHETIC_HR_CONFIRM=yes npx tsx scripts/testing/hr-roster-attendance-reset.ts

# 3. unit / database suites
SYRONA_DB_AVAILABLE=1 npx vitest run \
  src/tests/vitest/hr-duty-roster-attendance.db.spec.ts \
  src/tests/vitest/workforce-attendance-roster.spec.tsx \
  src/tests/vitest/hr-attendance-payroll-isolation.spec.ts

# 4. browser evidence (writes the eight images above)
BROWSER_SMOKE_SYNTHETIC=YES BASE_URL=http://127.0.0.1:3000 \
CHROME_EXECUTABLE_PATH=… HR_PASSWORD=… STAFF_PASSWORD=… \
node scripts/testing/hr-duty-roster-attendance-evidence.mjs
```

The browser script refuses to run without `BROWSER_SMOKE_SYNTHETIC=YES`, refuses
any non-loopback `BASE_URL`, and never writes the session token or password to
disk.
