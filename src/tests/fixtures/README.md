# Schema extraction baseline

These fixtures describe Drizzle metadata, not database rows. They were captured
from `src/db/schema.ts` at commit `eb7430e`, before the remaining inline tables
and relations were extracted into domain modules.

- `schema-exports-before-extraction.json` records the complete public export
  list, including the definitions that had already been extracted.
- `schema-contract-before-extraction.json` records each of the 66 moved tables
  and 40 moved relations: columns, SQL types, defaults, indexes, foreign keys,
  constraints and relation joins.

`schema-extraction.spec.ts` checks the public barrel against these fixtures;
`schema-*.spec.ts` also checks each domain module and its object identities.
The tests do not need a database. This is a refactor regression baseline, not
proof that the historical migrations or production databases match the schema.
If an intentional schema change requires changing a fixture, review the
corresponding migration and update the expected metadata in the same change;
do not regenerate the fixtures merely to make a failing test green.
