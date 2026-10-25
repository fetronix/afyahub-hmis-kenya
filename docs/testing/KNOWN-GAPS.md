# Testing — known gaps

Tests that exist but do not run in CI, and why. Recorded here rather than
deleted, because each one is real coverage somebody intended to have.

---

## `src/tests/auth-service.test.ts` and `src/tests/authentication.test.ts`

**State: broken. Not in any CI gate.**

Both import `../db` and exercise real rows, so they need PostgreSQL. They
are runnable in the CI `database` job, and were temporarily wired into it.
They fail.

The failure was traced to the first real assertion:

```
ASSERTION FAILED: Administrator can authenticate through AuthService
```

They sign in as the administrator named by `ADMIN_USERNAME` /
`ADMIN_PASSWORD` and assume that account exists with a known password.

Two things were tried:

1. **Setting `ADMIN_*`.** This only got past `src/bootstrap-admin.ts`, which
   validates those variables at import. The account still did not exist.
2. **`npm run db:seed`.** This does not help: `src/db/seed.ts` never reads
   `ADMIN_*` and does not create that account. It seeds demo facilities and
   patients, not a bootstrap administrator.

So the suites encode assumptions about a developer's existing database.
They have never passed in this repository, and no evidence of them passing
exists.

### What repairing them needs

Choose one, and write it down before starting:

- **Self-contained fixtures.** Each suite creates the user it needs at the
  top of the run, with a known password hash, and deletes it afterwards.
  This is the right answer: a test that depends on ambient database state is
  not a test, it is a memory of one working afternoon.
- **Or a real bootstrap-admin seed step** that creates the account from
  `ADMIN_*`, which is a product change and needs its own review.

Until then they are excluded deliberately. They are **not** passing, they
are **not** counted, and wiring them in would either fail CI every run or
require weakening the assertion — both worse than an honest gap.

The `test:auth-db` script exists so the work can be run by hand:

```bash
npm run test:auth-db     # needs a database and a matching administrator
```

---

## `src/tests/auth-api.test.ts`

**State: 0 bytes. Contains no test.**

Not deleted, because removing a file under `src/tests` is a decision for the
owner rather than a cleanup. It provides no coverage and appears in no
suite. Either write it or remove it.

---

## Source-text assertions

Twelve suites assert that a file *contains* a string:

```ts
assert(schema.includes("pgTable('patients'"), '...');
```

These are not behavioural coverage. They catch a deletion and nothing else:
they pass when the code is present but wrong, and they break when it is
reformatted or moved to another file.

They are also the reason `prettier --write` cannot be run across the tree —
reformatting broke five of them — and the reason the first schema extraction
required a test change.

`facility-modules.test.ts` now reads the barrel **plus** every module under
`src/db/schema/`, which survives the split. The other eleven will need the
same treatment as their tables move. The durable fix is one shared helper:

```ts
// src/tests/support/schema-source.ts
export function schemaSource(): string   // barrel + every schema module
```

Recommended next, before the third or fourth extraction, rather than
repairing each file as it breaks.
