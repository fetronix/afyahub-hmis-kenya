import * as domain from '../db/schema/payment-hub.ts';
import { schemaModuleContract } from './support/schema-module-contract.ts';

schemaModuleContract('payment-hub', domain, [
  'paymentProviderDefinitions',
  'paymentProviderEnvironments',
  'paymentProviderAssignments',
  'paymentProviderCapabilityPolicies',
  'paymentProviderAccessRequests',
  'facilityPaymentIntegrations',
  'facilityPaymentSecrets',
  'facilityPaymentAccounts',
  'paymentHubTransactions',
  'paymentHubWebhookEvents',
  'paymentHubReconciliations',
]);
