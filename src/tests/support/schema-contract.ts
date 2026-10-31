/**
 * Stable, executable Drizzle metadata for schema extraction regression tests.
 * No database connection or patient data is involved.
 */
import { createTableRelationsHelpers, getTableName, is, One, SQL } from 'drizzle-orm';
import { getTableConfig, PgDialect, type PgTable } from 'drizzle-orm/pg-core';
import type { Relations } from 'drizzle-orm';

const dialect = new PgDialect();

function value(input: unknown): unknown {
  if (is(input, SQL)) return dialect.sqlToQuery(input);
  return input === undefined ? null : input;
}

/** Column definitions, defaults, indexes, foreign keys and table constraints. */
export function tableContract(table: PgTable) {
  const config = getTableConfig(table);
  return {
    name: config.name,
    schema: config.schema ?? null,
    columns: config.columns.map((column) => ({
      name: column.name,
      type: column.getSQLType(),
      notNull: column.notNull,
      primary: column.primary,
      hasDefault: column.hasDefault,
      default: value(column.default),
      unique: column.isUnique,
      uniqueName: column.isUnique ? column.uniqueName : null,
    })),
    indexes: config.indexes.map(({ config: index }) => ({
      name: index.name,
      columns: index.columns.map((column) =>
        'name' in column
          ? { name: column.name, order: 'indexConfig' in column ? column.indexConfig : null }
          : value(column),
      ),
      unique: index.unique,
      method: index.method,
      where: value(index.where),
    })),
    foreignKeys: config.foreignKeys.map((foreignKey) => {
      const reference = foreignKey.reference();
      return {
        name: foreignKey.getName(),
        columns: reference.columns.map((column) => column.name),
        foreignTable: getTableName(reference.foreignTable),
        foreignColumns: reference.foreignColumns.map((column) => column.name),
        onDelete: foreignKey.onDelete,
        onUpdate: foreignKey.onUpdate,
      };
    }),
    checks: config.checks.map((check) => ({ name: check.name, value: value(check.value) })),
    primaryKeys: config.primaryKeys.map((key) => ({
      name: key.getName(),
      columns: key.columns.map((column) => column.name),
    })),
    uniqueConstraints: config.uniqueConstraints.map((constraint) => ({
      name: constraint.getName(),
      columns: constraint.columns.map((column) => column.name),
      nullsNotDistinct: constraint.nullsNotDistinct,
    })),
    enableRLS: config.enableRLS,
  };
}

/** Exact metadata changes introduced by reviewed additive migrations. The original
 * extraction fixture remains unchanged; all other columns and indexes still match it. */
export function contractWithReviewedAdditions(name: string, original: unknown) {
  if (name === 'facilities') {
    const expected = structuredClone(original) as {
      columns: Array<{ name: string } & Record<string, unknown>>;
    };
    const position = expected.columns.findIndex((column) => column.name === 'phone');
    if (position < 0) throw new Error('Expected historical phone column not found');
    expected.columns.splice(position, 0, {
      name: 'timezone',
      type: 'text',
      notNull: false,
      primary: false,
      hasDefault: false,
      default: null,
      unique: false,
      uniqueName: null,
    });
    return expected;
  }
  if (name !== 'shaEclaims' && name !== 'privateInsuranceClaims') return original;
  const expected = structuredClone(original) as {
    columns: Array<{ name: string } & Record<string, unknown>>;
  };
  const statusIndex = expected.columns.findIndex((column) => column.name === 'status');
  if (statusIndex < 0) throw new Error('Expected historical status column not found');
  expected.columns.splice(statusIndex + 1, 0, {
    name: 'dispatch_revision',
    type: 'integer',
    notNull: true,
    primary: false,
    hasDefault: true,
    default: 0,
    unique: false,
    uniqueName: null,
  });
  return expected;
}

/** Join targets, cardinality and explicit field mappings of a relation. */
export function relationContract(relation: Relations) {
  const definitions = relation.config(createTableRelationsHelpers(relation.table));
  return {
    table: getTableName(relation.table),
    relations: Object.fromEntries(
      Object.entries(definitions).map(([fieldName, definition]) => [
        fieldName,
        {
          kind: is(definition, One) ? 'one' : 'many',
          table: getTableName(definition.referencedTable),
          relationName: definition.relationName ?? null,
          fields: is(definition, One) ? (definition.config?.fields.map((c) => c.name) ?? []) : [],
          references: is(definition, One)
            ? (definition.config?.references.map((c) => c.name) ?? [])
            : [],
        },
      ]),
    ),
  };
}
