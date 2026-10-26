# Testing — known gaps

Tests that exist but do not run in CI, and why. Recorded here rather than
deleted, because each one is real coverage somebody intended to have.

---

## `src/tests/auth-service.test.ts` and `src/tests/authentication.test.ts`

**State: FIXED. Both run in the CI `database` job.**

Both import `../db` and exercise real rows, so they need PostgreSQL. They
used to sign in as an administrator named by `ADMIN_USERNAME` /
`ADMIN_PASSWORD` and assume that account already existed with a known
password. Nothing in this repository creates it:

1. **Setting `ADMIN_*`** only got past `src/bootstrap-admin.ts`, which
   validates those variables at import. The account still did not exist.
2. **`npm run db:seed`** did not help: `src/db/seed.ts` never reads `ADMIN_*`
   and does not create a bootstrap administrator.

So on a fresh database both failed at `Administrator can authenticate
through AuthService`. They had never passed anywhere.

### The repair

Self-contained fixtures, the first of the two options this document used to
list. Each suite now inserts the platform administrator it exercises - the
same field set it already used for its temporary user - and deletes it in
cleanup. Every assertion and business rule is unchanged; only the source of
the account moved, from the environment into the test.

`authentication.test.ts` had a second problem worth recording: it
incremented the failed-login counter of whatever account it found. Against a
real deployment that would have pushed a live administrator toward the
five-attempt lockout. It now only touches its own row.

### Verification

Both files are now `*.db.spec.ts` specs in the one runner, so the
`database` job runs them by path after migrations:

```bash
npx vitest run src/tests/auth-service.db.spec.ts src/tests/authentication.db.spec.ts
```

Run
[40158302094](https://github.com/fetronix/afyahub-hmis-kenya/actions/runs/40158302094),
step _Auth service and authentication specs_: **success**, against
PostgreSQL 16.

These cannot be run in every environment - they need a database, and there
is no PostgreSQL or Docker in some development sandboxes. The CI job is
where they are authoritative:

```bash
npx vitest run src/tests/auth-service.db.spec.ts src/tests/authentication.db.spec.ts
```

The `test:auth-db` script is gone: there is one runner and one `npm test`,
and a suite that needs a database says so in its filename rather than in a
separate command.

---

## `src/tests/auth-api.test.ts`

**State: 0 bytes. Contains no test.**

Not deleted, because removing a file under `src/tests` is a decision for the
owner rather than a cleanup. It provides no coverage and appears in no
suite. Either write it or remove it.

It is now the only `.test.ts` left under `src/tests` - every other suite was
migrated to `*.spec.ts` and runs under vitest. The extension is what
distinguishes "written but never migrated" from "written for the runner", so
this file is currently invisible to `npm test` for two independent reasons:
it is empty, and it does not match the runner's glob.

---

## Source-text assertions

Twelve suites assert that a file _contains_ a string:

```ts
assert(schema.includes("pgTable('patients'"), '...');
```

These are not behavioural coverage. They catch a deletion and nothing else:
they pass when the code is present but wrong, and they break when it is
reformatted or moved to another file.

They are also the reason `prettier --write` cannot be run across the tree —
reformatting broke five of them — and the reason the first schema extraction
required a test change.

The shared helper now exists and **eleven suites use it**:

```ts
// src/tests/support/schema-source.ts
export function schemaSource(): string; // barrel + every schema module
```

It concatenates `src/db/schema.ts` with every `.ts` file under
`src/db/schema/`, sorted for determinism. `facility-modules.test.ts` keeps
its own local copy; folding it in is a one-line change for the next commit
that touches it.

This makes the assertions survive the schema split. It does **not** make
them behavioural. They still pass when the code is present but wrong, and
they are still why `prettier --write` cannot run across the tree without
breaking five of them first.

The durable fix is unchanged: replace each with an executed assertion
against the real table object (`getTableConfig(...)`, a `references()` walk,
or a query against a disposable database). That is where the remaining
source-text debt lives, and it is the highest-value test work left.
