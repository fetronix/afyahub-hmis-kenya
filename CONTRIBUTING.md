# Contributing to JaliCare

This is a clinical system. A bug here can bill a patient the wrong amount,
show one facility another facility's records, or lose a prescription. The
rules below are stricter than a typical web application for that reason, and
they are not negotiable for the sake of a green build.

Read the [README](README.md) first if you have not run the system yet.

---

## Ground rules

1. **Never weaken a control to make a test pass.** Not authentication, not a
   permission check, not tenant scoping, not field encryption, not the audit
   trail. If a test fails because of one of those, the test or the change is
   wrong — the control is not.
2. **Never edit an applied migration.** Add a new one. The journal records a
   checksum and `npm run db:status` will report the discrepancy.
3. **Never delete or rewrite patient data** to fix a migration that is out of
   step. Work out what the database actually contains first.
4. **Never change a price, a tariff, or a billing rule** without an explicit
   instruction and a record of who authorised it.
5. **Do not disable a lint rule globally.** Fix the code, or disable it on the
   single line with a comment saying why.
6. **Do not fabricate a test result or a coverage number.** If something is not
   verified, say it is not verified.

---

## Getting set up

```bash
npm ci
cp .env.example .env     # set FIELD_ENCRYPTION_KEY and the SQL_* values
npm run db:preflight
npm run db:migrate
npm run db:seed:permissions
npm run dev
```

See [Quick start](README.md#quick-start) for the details.

---

## The change cycle

```bash
npm run typecheck        # before anything else: it is the fastest signal
npm run lint
npm test                 # every spec, with coverage
npm run test:unit        # every spec, no coverage
npm run build:deploy     # only when the change touches build or server code
```

`npm run ci` runs all of it in the order CI does.

### What to run for a given change

| You changed                   | Run at minimum                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------ |
| A pure function               | `npm run test:unit`                                                                        |
| A React component             | `npm run test:unit` (with a `.spec.tsx`)                                                   |
| A route or a permission check | `npm test`                                                                                 |
| A query or a scope filter     | `npm test`, plus a `*.db.spec.ts` against PostgreSQL                                       |
| A migration                   | `npm run db:preflight`, `db:migrate:dry`, then `db:migrate` on a scratch database          |
| The build or `server.ts`      | `npm run build:deploy`, then start `build/server.js` and hit `/api/ready`                  |
| `package.json`                | `npm ci` from a clean `node_modules` — a lock file that only works incrementally is broken |

---

## Writing tests

The repository has two suites. New tests go in the Vitest one.

### Vitest (preferred)

Put specs in `src/tests/vitest/`, named `*.spec.ts`. Name database specs
`*.db.spec.ts` and wrap the body in `describeDb()`:

```ts
import { describeDb } from './support/db.ts';

describeDb('invoices', () => {
  it('refuses to mark an invoice paid when a charge is created', () => {
    // ...
  });
});
```

`describeDb` skips cleanly when no database is reachable and fails loudly when
`JALICARE_REQUIRE_DB=1`, which is how CI is configured.

### Component tests

Opt into jsdom with a docblock on the first line:

```tsx
// @vitest-environment jsdom
```

Use React Testing Library and query by role or accessible name:

```tsx
expect(screen.getByRole('button', { name: /save/i })).toBeEnabled();
```

Not by CSS class, and not by test id when a role exists. A test that only
passes because of a class name breaks when the design changes and proves
nothing about what a user can do.

### Pure functions over source text

The legacy suites largely assert that a file _contains_ the right code:

```ts
assert(source.includes('tenantId'), 'route must scope by tenant');
```

That catches a deletion and nothing else — it passes when the scoping is
present but wrong, and it breaks when the code is reformatted. When you touch
an area covered by one of these, prefer replacing the assertion with one that
executes the function. `src/tests/vitest/tariff-matching.spec.ts` is the
worked example.

### What makes a good test here

- **Assert the clinical consequence.** "Creating a charge does not mark the
  invoice paid" is worth more than "the function returns 201".
- **Assert the refusal.** That a nurse cannot read another facility's patient
  is the security property; that an admin can read their own is not.
- **Test the boundary that is easy to get wrong.** Malformed body, expired
  session, missing permission, a price that does not exist.
- **Do not assert on formatting, indentation, or a line number.** It creates a
  test that fails for a reason nobody cares about and teaches people to ignore
  the suite.

---

## Database changes

### A new migration

```bash
# 1. Edit src/db/schema.ts
# 2. Generate the SQL
npx drizzle-kit generate

# 3. Read the generated SQL. Do not skip this step.
cat drizzle/000N_*.sql

# 4. Apply it to a scratch database and confirm
npm run db:migrate:dry
npm run db:migrate
npm run db:status
```

Checklist for the SQL before it goes anywhere near real data:

- [ ] No `DROP TABLE`, `DROP COLUMN` or `TRUNCATE` on a table holding records
- [ ] A new `NOT NULL` column has a default or the table is provably empty
- [ ] A rename is two steps (add, backfill, drop in a later migration), never one
- [ ] Indexes are created concurrently where the table is large
- [ ] The down path is understood, even though there is no automatic rollback
- [ ] `drizzle/meta/_journal.json` has the new entry, so the file and journal
      stay in step

### Never

- edit an applied migration
- delete a migration
- reset a database that holds records
- mark a migration applied by hand to get past a failure

---

## Multi-tenancy

Every clinical query is scoped by `tenant_id`, and usually `facility_id`, **in
the `WHERE` clause**. Filtering afterwards, in JavaScript, means the row was
read from the database into a process where a later mistake can return it.

```ts
// correct: the database never returns another tenant's row
.where(and(
  eq(schema.patients.tenantId, ctx.tenantId),
  eq(schema.patients.facilityId, ctx.facilityId),
))

// wrong: the row is in memory and one early `return` away from disclosure
const rows = await db.select()...;
const mine = rows.filter(r => r.tenantId === ctx.tenantId);
```

When you add a table, add its tenant column, and add it to
`src/tests/vitest/tenant-isolation.db.spec.ts` if it is reachable by a route.

---

## Billing rules

- One billing engine. Do not add a parallel one.
- A charge is never a payment. Creating an invoice line must not change an
  invoice's paid status.
- Prices come from `facility_service_tariffs`. Never hard-code one, and never
  match a tariff fuzzily — `src/billing/tariff-matching.ts` is deliberately
  exact, and `tariff-matching.spec.ts` pins the rule order.
- Idempotency keys on anything that creates money. A retried request must not
  create a second charge.

---

## Error handling and responses

- Every route returns JSON. The catch-all handler in `app.ts` turns an
  unhandled error into `{ error, correlationId }` and logs the detail.
- Never return a stack trace, a SQL error message, or a file path to a client.
- Log with the logger, not `console`. Include the correlation id implicitly by
  using the request logger; never log a password, token, or patient identity.
- A malformed request body is a 400. It is not a 500: answering 500 sends
  whoever is on call looking for an outage that does not exist.

---

## Commits and pull requests

Small commits, each one a change that can be understood and reverted on its
own. A commit message says **why**, because the diff already says what.

```
fix(billing): stop a retried payment creating a second charge

The idempotency key was derived from the request body, which includes
the client-supplied timestamp, so a retry with a fresh timestamp produced
a new key and a second charge.

The key is now derived from invoice id and amount only.
```

Before opening a pull request:

- [ ] `npm run ci` passes
- [ ] New behaviour has a test that fails without the change
- [ ] No secret, token or `.env` file is in the diff
- [ ] No migration edited in place
- [ ] No permission check relaxed
- [ ] The description states anything that was **not** verified

---

## Reporting a problem

Include the correlation id from the response, the time in `Africa/Nairobi`,
and what you expected to happen. The correlation id turns a description into a
log query.

Do not include patient data, credentials, or database connection strings in an
issue, a chat message or a commit.
