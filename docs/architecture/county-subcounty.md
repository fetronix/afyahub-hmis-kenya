# County and sub-county

Where a patient lives is recorded as two fields, `county` and `sub_county`,
on `patients`, and the same pair on `facilities`. This note records what the
two words mean here, because the UI used to leave that to whoever typed.

## The decision

**County is one of the 47.** **Sub-county is one of the 290 constituencies.**

A sub-county is not a ward. Kenya has 47 counties, 290 sub-counties
(constituencies) and 1,450 wards. Wards were rejected: they are fine enough
that a reception desk would leave the field blank, and a field nobody fills
is worse than no field. Constituencies are what the Ministry of Health's
sub-county health management teams are built around, so a patient's
sub-county names the team responsible for where they live.

The counts are fixed by the Constitution (First Schedule, the 47) and by the
IEBC (the 290 constituencies). They do not move between election cycles
until the boundary review they have deferred.

## Where the list lives

`src/constants/kenya-locations.ts` is the only copy. It holds:

- `KENYA_COUNTIES` — 47 records, each with the official code (`'001'` …
  `'047'`, strings because of the leading zeros), the name, and its
  sub-counties;
- lookup helpers — `findCounty`, `subCountiesOf`, `findSubCounty`,
  `countiesWithSubCounty`;
- `normaliseCounty` — spelling variants that older screens produced
  (`Nairobi City`, `muranga`, `taita taveta`);
- `resolveLocation` — the single rule for what gets stored.

Nothing else may hold a county list. The registration form, the facility
forms, the API and the migration all read this file, and
`src/tests/kenya-locations.spec.ts` fails if any of them stop doing so.

## What the write path does

`resolveLocation(county, subCounty)` decides, in this order:

| Input | Result |
| --- | --- |
| nothing | both stored as `NULL` |
| a county, no sub-county | county stored, sub-county `NULL` |
| a matching pair | both stored in canonical spelling |
| a sub-county that is not in that county | **refused** — `400 INVALID_SUB_COUNTY`, with the accepted list |
| a sub-county with no county | **refused** — there is nothing to check it against |
| a county name nobody recognises | stored as supplied |

The last row is deliberate. An import or an older client must not lose a
patient record because the server has never seen the spelling; the forms
cannot produce one, and migration `0023` reports and repairs whatever is
already there.

Both screens clear the sub-county when the county changes, because a
sub-county means nothing outside its county.

## Existing records

`drizzle/0023_normalise_county_subcounty.sql` brings stored rows into line.
It is **generated** from the constants:

```
npm run locations:migration
```

The generator exists so that 290 names are never typed twice; the test
compares the file on disk against a fresh render and fails when the two
disagree.

The migration:

1. turns blank strings into `NULL` — "not recorded" should be one question,
   not two;
2. canonicalises county spellings, for patients and facilities;
3. canonicalises sub-county spellings **inside their own county** — it never
   "corrects" a sub-county into a different county;
4. recovers a blank or unrecognised county from a sub-county that only one
   county owns;
5. clears a sub-county that still does not belong to its county, writing the
   old value to `audit_logs` against the patient or facility first.

It is idempotent, and it deletes nothing. `src/tests/county-migration.db.spec.ts`
executes all of it against a real PostgreSQL, in `TEMP` tables that shadow
the real ones, and asserts both the outcome and that a second run changes
nothing. Without a database the suite is skipped like every `.db.spec.ts`.
