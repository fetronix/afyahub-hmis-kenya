export type Environment = 'SANDBOX' | 'PRODUCTION';
export type Capability =
  | 'ACCOUNT_INFORMATION'
  | 'PAYMENT_COLLECTION'
  | 'PAYMENT_STATUS'
  | 'TRANSFER'
  | 'NOTIFICATIONS'
  | 'HEALTH';
export type QueryOutcome = 'CONFIRMED' | 'UNKNOWN';
export interface AccountInformationCapability {
  getAccountInformation(): Promise<unknown>;
  getStatement(): Promise<unknown>;
}
export interface CollectionCapability {
  initiate(input: {
    phone: string;
    amountKes: number;
    callbackUrl: string;
    accountReference: string;
  }): Promise<{ checkoutRequestId: string }>;
}
export interface StatusCapability {
  query(checkoutRequestId: string): Promise<{ outcome: QueryOutcome; resultCode: string | null }>;
}
export interface TransferCapability {
  transfer(): Promise<unknown>;
}
export interface NotificationCapability {
  readonly authenticity: 'UNVERIFIED_HINT' | 'PROVIDER_VERIFIED';
}
export interface HealthCapability {
  check(): Promise<void>;
}
export interface AdapterDescriptor {
  key: string;
  implementedCapabilities: readonly Capability[];
  sandboxOnly: boolean;
  productionReady: boolean;
  note: string;
}
export interface ProviderBoundary {
  descriptor: AdapterDescriptor;
  accountInformation?: AccountInformationCapability;
  collection?: CollectionCapability;
  status?: StatusCapability;
  transfer?: TransferCapability;
  notifications?: NotificationCapability;
  health?: HealthCapability;
}
