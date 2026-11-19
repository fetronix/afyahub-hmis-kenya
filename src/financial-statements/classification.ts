/**
 * Resolves every chart account to a presentation group for one facility.
 * Kept separate from the statement engine so the loader can ask which accounts
 * are receivable or payable control accounts before it reads party lines.
 */

import { type PresentationGroup, resolvePresentationGroup } from './groups.ts';

export interface ClassifiableAccount {
  id: number;
  code: string;
  name: string;
  type: string;
  subType: string;
  normalBalance?: string;
}

export interface AccountClassification {
  account: ClassifiableAccount;
  group: PresentationGroup;
  source: 'OVERRIDE' | 'DEFAULT' | 'INVALID_OVERRIDE';
}

export function classifyAccounts(
  accounts: readonly ClassifiableAccount[],
  overrides: ReadonlyMap<number, string>,
): Map<number, AccountClassification> {
  const classified = new Map<number, AccountClassification>();
  for (const account of accounts) {
    const resolved = resolvePresentationGroup(
      {
        id: account.id,
        accountType: account.type,
        subType: account.subType,
        accountCode: account.code,
        accountName: account.name,
      },
      overrides,
    );
    classified.set(account.id, { account, group: resolved.group, source: resolved.source });
  }
  return classified;
}

export function accountsInGroups(
  classified: ReadonlyMap<number, AccountClassification>,
  groups: readonly PresentationGroup[],
): ClassifiableAccount[] {
  const wanted = new Set<string>(groups);
  return [...classified.values()]
    .filter((entry) => wanted.has(entry.group))
    .map((entry) => entry.account)
    .sort((a, b) => a.code.localeCompare(b.code));
}
