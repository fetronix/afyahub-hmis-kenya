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
  if (name === 'billingPayments' || name === 'bankReconciliations') {
    const expected = structuredClone(original) as {
      columns: Array<{ name: string } & Record<string, unknown>>;
      foreignKeys: Array<Record<string, unknown>>;
    };
    const column = (name: string, type: string, unique = false) => ({
      name,
      type,
      notNull: false,
      primary: false,
      hasDefault: false,
      default: null,
      unique,
      uniqueName: unique ? `billing_payments_${name}_unique` : null,
    });
    if (name === 'billingPayments') {
      // 0091: preserve every original column/index; exactly one nullable unique evidence link.
      const at = expected.columns.findIndex((c) => c.name === 'receipt_number');
      if (at < 0) throw new Error('Historical receipt number missing');
      expected.columns.splice(at, 0, column('bank_payment_record_id', 'integer', true));
    } else {
      // 0081 already added approval fields in SQL; 0091 aligns the Drizzle declaration.
      const at = expected.columns.findIndex((c) => c.name === 'reconciled_at');
      if (at < 0) throw new Error('Historical reconciled_at missing');
      expected.columns.splice(
        at + 1,
        0,
        column('approved_by_user_id', 'integer'),
        column('approved_at', 'timestamp'),
        column('approval_notes', 'text'),
      );
      expected.foreignKeys.push({
        name: 'bank_reconciliations_approved_by_user_id_users_id_fk',
        columns: ['approved_by_user_id'],
        foreignTable: 'users',
        foreignColumns: ['id'],
        onDelete: 'no action',
        onUpdate: 'no action',
      });
    }
    return expected;
  }

  if (name === 'insuranceBenefitValidations') {
    const expected = structuredClone(original) as {
      columns: Array<{ name: string } & Record<string, unknown>>;
    };
    // Migration 0071 intentionally preserves history while allowing an unknown
    // deductible/copay estimate to remain null rather than defaulting to zero.
    for (const name of ['deductible_estimate', 'estimated_copay_amount']) {
      const column = expected.columns.find((item) => item.name === name);
      if (!column) throw new Error(`Expected historical ${name} column not found`);
      Object.assign(column, { notNull: false, hasDefault: false, default: null });
    }
    return expected;
  }
  if (name === 'fixedAssets') {
    const expected = structuredClone(original) as {
      columns: Array<{ name: string } & Record<string, unknown>>;
      indexes: Array<Record<string, unknown>>;
      foreignKeys: Array<Record<string, unknown>>;
    };
    // Migration 0075 adds operational register fields. The historical columns
    // are unchanged; these are appended in the order the migration declares.
    const position = expected.columns.findIndex((column) => column.name === 'created_at');
    if (position < 0) throw new Error('Expected historical created_at column not found');
    const added: Array<[string, string, boolean, unknown]> = [
      ['category_id', 'integer', false, null],
      /* Migration 0082: impairment and revaluation move the carrying basis,
         never the historical cost recorded in acquisition_cost_kes. */
      ['carrying_basis_kes', 'numeric(14, 2)', false, null],
      ['impairment_loss_kes', 'numeric(14, 2)', true, '0.00'],
      ['revaluation_reserve_kes', 'numeric(14, 2)', true, '0.00'],
      ['impairment_loss_account_id', 'integer', false, null],
      ['revaluation_surplus_account_id', 'integer', false, null],
      ['location', 'text', false, null],
      ['custodian_employee_id', 'integer', false, null],
      ['condition', 'text', true, 'GOOD'],
      ['acquisition_credit_account_id', 'integer', false, null],
      ['disposal_proceeds_account_id', 'integer', false, null],
      ['disposal_gain_loss_account_id', 'integer', false, null],
      ['supplier_invoice_id', 'integer', false, null],
      ['purchase_order_id', 'integer', false, null],
      ['created_by_user_id', 'integer', false, null],
      ['notes', 'text', false, null],
    ];
    added.forEach(([columnName, type, notNull, defaultValue], offset) => {
      expected.columns.splice(position + offset, 0, {
        name: columnName,
        type,
        notNull,
        primary: false,
        hasDefault: notNull,
        default: defaultValue,
        unique: false,
        uniqueName: null,
      });
    });
    // Migration 0075 also adds a status index and a creator foreign key.
    expected.indexes.push({
      name: 'fixed_assets_facility_status_idx',
      columns: [
        { name: 'facility_id', order: { order: 'asc', nulls: 'last' } },
        { name: 'status', order: { order: 'asc', nulls: 'last' } },
      ],
      unique: false,
      method: 'btree',
      where: null,
    });
    for (const columnName of ['impairment_loss_account_id', 'revaluation_surplus_account_id'])
      expected.foreignKeys.push({
        name: `fixed_assets_${columnName}_chart_of_accounts_id_fk`,
        columns: [columnName],
        foreignTable: 'chart_of_accounts',
        foreignColumns: ['id'],
        onDelete: 'no action',
        onUpdate: 'no action',
      });
    expected.foreignKeys.push({
      name: 'fixed_assets_created_by_user_id_users_id_fk',
      columns: ['created_by_user_id'],
      foreignTable: 'users',
      foreignColumns: ['id'],
      onDelete: 'no action',
      onUpdate: 'no action',
    });
    return expected;
  }
  if (name === 'dialysisTreatmentPlans') {
    const expected = structuredClone(original) as {
      columns: Array<{ name: string } & Record<string, unknown>>;
      foreignKeys: Array<Record<string, unknown>>;
    };
    /* Migration 0084: the facility service a plan delivers, so a completed
       session can be priced through the facility tariff machinery. */
    const position = expected.columns.findIndex((column) => column.name === 'status');
    if (position < 0) throw new Error('Expected historical status column not found');
    /* Declared immediately after `status` in the schema, so the contract
       records it in that position rather than at the end. */
    expected.columns.splice(position + 1, 0, {
      name: 'facility_service_id',
      type: 'integer',
      notNull: false,
      primary: false,
      hasDefault: false,
      default: null,
      unique: false,
      uniqueName: null,
    });
    /* Foreign keys follow column order, so this one sits before the
       authorized-by key rather than at the end. */
    const keyAt = expected.foreignKeys.findIndex(
      (key) =>
        (key as { name?: string }).name ===
        'dialysis_treatment_plans_authorized_by_user_id_users_id_fk',
    );
    if (keyAt < 0) throw new Error('Expected historical authorized-by foreign key not found');
    expected.foreignKeys.splice(keyAt, 0, {
      name: 'dialysis_treatment_plans_facility_service_id_facility_services_id_fk',
      columns: ['facility_service_id'],
      foreignTable: 'facility_services',
      foreignColumns: ['id'],
      onDelete: 'no action',
      onUpdate: 'no action',
    });
    return expected;
  }
  if (name === 'supplierInvoices') {
    const expected = structuredClone(original) as {
      columns: Array<{ name: string } & Record<string, unknown>>;
      indexes: Array<Record<string, unknown>>;
    };
    // Migration 0076 links a supplier invoice to the receipt it bills, and
    // makes that receipt unique per invoice so a note cannot be billed twice.
    const position = expected.columns.findIndex((column) => column.name === 'invoice_number');
    if (position < 0) throw new Error('Expected historical invoice_number column not found');
    expected.columns.splice(position, 0, {
      name: 'goods_received_note_id',
      type: 'integer',
      notNull: false,
      primary: false,
      hasDefault: false,
      default: null,
      unique: false,
      uniqueName: null,
    });
    // Declared before the existing lookup index, so it leads the array.
    expected.indexes.unshift({
      name: 'supplier_invoices_grn_idx',
      columns: [
        {
          name: 'goods_received_note_id',
          order: { order: 'asc', nulls: 'last', opClass: undefined },
        },
      ],
      unique: true,
      method: 'btree',
      where: null,
    });
    return expected;
  }
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
  if (name === 'facilityPaymentSecrets') {
    const expected = structuredClone(original) as {
      columns: Array<{ name: string } & Record<string, unknown>>;
    };
    const position = expected.columns.findIndex((column) => column.name === 'updated_at');
    if (position < 0) throw new Error('Expected historical updated_at column not found');
    for (const [offset, name, type] of [
      [0, 'credential_source', 'text'],
      [1, 'expires_at', 'timestamp with time zone'],
      [2, 'revoked_at', 'timestamp with time zone'],
    ] as const) {
      expected.columns.splice(position + offset, 0, {
        name,
        type,
        notNull: false,
        primary: false,
        hasDefault: false,
        default: null,
        unique: false,
        uniqueName: null,
      });
    }
    return expected;
  }
  if (name === 'insurancePayerEnvironmentConfigs') {
    const expected = structuredClone(original) as {
      columns: Array<{ name: string } & Record<string, unknown>>;
    };
    expected.columns.push(
      {
        name: 'revoked_at',
        type: 'timestamp with time zone',
        notNull: false,
        primary: false,
        hasDefault: false,
        default: null,
        unique: false,
        uniqueName: null,
      },
      {
        name: 'credential_generation',
        type: 'integer',
        notNull: true,
        primary: false,
        hasDefault: true,
        default: 1,
        unique: false,
        uniqueName: null,
      },
    );
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

  /* Migration 0088: a claim records the frozen invoice basis it was prepared
     from. Both columns are nullable by design — a historical claim cannot be
     given one retrospectively without inventing data, so it stays NULL and is
     reported as an unverifiable basis. They sit after their parent invoice_id,
     which is where the schema module declares them.
     Inserted second, so the status_index above is still the untouched one. */
  const invoiceIndex = expected.columns.findIndex((column) => column.name === 'invoice_id');
  if (invoiceIndex < 0) throw new Error('Expected historical invoice_id column not found');
  expected.columns.splice(
    invoiceIndex + 1,
    0,
    {
      name: 'invoice_finalized_at',
      type: 'timestamp',
      notNull: false,
      primary: false,
      hasDefault: false,
      default: null,
      unique: false,
      uniqueName: null,
    },
    {
      name: 'invoice_snapshot',
      type: 'jsonb',
      notNull: false,
      primary: false,
      hasDefault: false,
      default: null,
      unique: false,
      uniqueName: null,
    },
  );
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
