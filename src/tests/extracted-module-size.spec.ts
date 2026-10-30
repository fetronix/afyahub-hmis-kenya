import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The existing sha.fhir.ts and previously extracted schema files are separate
// follow-up work; this ratchet covers the files extracted in this refactor.
const shaModules = [
  'adapter',
  'authorization',
  'benefits',
  'callbacks',
  'claims',
  'client-registry',
  'context',
  'eligibility-parser',
  'eligibility',
  'gateway-types',
  'preauthorization',
  'remittances',
  'types',
  'utilization',
  'values',
  'virtual-claim',
].map((name) => `../integrations/sha/sha.${name}.ts`);
const schemaModules = [
  'banking',
  'dialysis',
  'financial-ledger',
  'icd',
  'insurance-benefits',
  'insurance-payers',
  'insurance-remittances',
  'payment-hub',
  'private-insurance',
  'relations-clinical',
  'relations-operations',
  'relations-tenancy-auth',
  'sha-claims',
  'website-booking',
].map((name) => `../db/schema/${name}.ts`);

describe('extracted module size ratchet', () => {
  it.each([...shaModules, '../db/schema.ts', ...schemaModules])(
    '%s stays below 500 lines',
    (path) => {
      const source = readFileSync(new URL(path, import.meta.url), 'utf8');
      const lines = source.replace(/\n$/, '').split('\n').length;
      expect(lines).toBeLessThan(500);
    },
  );
});
