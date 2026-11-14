/**
 * Public SHA gateway facade. Workflows delegate to concern modules and share
 * one context per adapter; the existing import path and payer contract remain stable.
 */
import { ShaGatewayContext } from './sha.context.ts';
import { searchClientRegistryPatient } from './sha.client-registry.ts';
import { checkEligibility } from './sha.eligibility.ts';
import { fetchPatientBenefitsAndInterventions } from './sha.benefits.ts';
import { fetchBenefitUtilizationAndBalances } from './sha.utilization.ts';
import { createVisitAuthorization } from './sha.authorization.ts';
import { submitHiePreauth, queryHiePreauths, cancelHiePreauth } from './sha.preauthorization.ts';
import { submitBundle, queryClaimStatus } from './sha.claims.ts';
import { submitHieVirtualClaim } from './sha.virtual-claim.ts';
import { registerCallbackEndpoint } from './sha.callbacks.ts';
import { fetchFacilityRemittances, fetchClaimsPaidByRemittance } from './sha.remittances.ts';
import type { ShaConnectionStatusReport } from './sha.config.ts';
import type {
  EligibilityGatewayRequest,
  EligibilityGatewayResult,
  ClientRegistrySearchRequest,
  ClientRegistrySearchResult,
  HieBenefitsLookupRequest,
  HieBenefitsLookupResult,
  HieUtilizationLookupRequest,
  HieUtilizationLookupResult,
  VisitAuthorizationRequest,
  VisitAuthorizationResult,
  HiePreauthGatewayRequest,
  HiePreauthGatewayResult,
  HieVirtualClaimSubmitRequest,
  HieRemittancesQueryRequest,
  HieRemittancesQueryResult,
  HieRemittanceClaimsQueryRequest,
  HieRemittanceClaimsQueryResult,
  RegisterHieCallbackEndpointRequest,
  RegisterHieCallbackEndpointResult,
} from './sha.types.ts';
import type {
  BundleGatewayRequest,
  BundleGatewayResult,
  ClaimStatusGatewayRequest,
  ClaimStatusGatewayResult,
  PayerGatewayAdapter,
  ShaGatewayAdapterOptions,
} from './sha.gateway-types.ts';

export type * from './sha.types.ts';
export type * from './sha.gateway-types.ts';
export { mapToHieIdentificationType } from './sha.client-registry.ts';
export { interpretShaEligibilityPayload } from './sha.eligibility-parser.ts';

export class ShaGatewayAdapter implements PayerGatewayAdapter {
  public readonly payerCode = 'SHA';
  private readonly context: ShaGatewayContext;

  constructor(options: ShaGatewayAdapterOptions = {}) {
    this.context = new ShaGatewayContext(options);
  }

  public getConnectionStatus(facilityRegistryOverride?: string | null): ShaConnectionStatusReport {
    return this.context.getConnectionStatus(facilityRegistryOverride);
  }

  public async searchClientRegistryPatient(
    req: ClientRegistrySearchRequest,
  ): Promise<ClientRegistrySearchResult> {
    return searchClientRegistryPatient(this.context, req);
  }

  public async checkEligibility(req: EligibilityGatewayRequest): Promise<EligibilityGatewayResult> {
    return checkEligibility(this.context, req);
  }

  public async fetchPatientBenefitsAndInterventions(
    req: HieBenefitsLookupRequest,
  ): Promise<HieBenefitsLookupResult> {
    return fetchPatientBenefitsAndInterventions(this.context, req);
  }

  public async fetchBenefitUtilizationAndBalances(
    req: HieUtilizationLookupRequest,
  ): Promise<HieUtilizationLookupResult> {
    return fetchBenefitUtilizationAndBalances(this.context, req);
  }

  public async createVisitAuthorization(
    req: VisitAuthorizationRequest,
  ): Promise<VisitAuthorizationResult> {
    return createVisitAuthorization(this.context, req);
  }

  public async submitHiePreauth(req: HiePreauthGatewayRequest): Promise<HiePreauthGatewayResult> {
    return submitHiePreauth(this.context, req);
  }

  public async queryHiePreauths(req: {
    tenantId: number;
    facilityId: number;
    actorUserId: number | null;
    facilityRegistryOverride?: string | null;
    consentToken: string;
    hiePreauthGuid?: string | null;
    correlationId?: string;
  }): Promise<HiePreauthGatewayResult> {
    return queryHiePreauths(this.context, req);
  }

  public async cancelHiePreauth(req: {
    tenantId: number;
    facilityId: number;
    actorUserId: number | null;
    facilityRegistryOverride?: string | null;
    consentToken: string;
    hiePreauthGuid?: string | null;
    reason: string;
    correlationId?: string;
  }) {
    return cancelHiePreauth(this.context, req);
  }

  public async submitBundle(req: BundleGatewayRequest): Promise<BundleGatewayResult> {
    return submitBundle(this.context, req);
  }

  public async queryClaimStatus(req: ClaimStatusGatewayRequest): Promise<ClaimStatusGatewayResult> {
    return queryClaimStatus(this.context, req);
  }

  public async submitHieVirtualClaim(
    req: HieVirtualClaimSubmitRequest,
  ): Promise<BundleGatewayResult> {
    return submitHieVirtualClaim(this.context, req);
  }

  public async registerCallbackEndpoint(
    req: RegisterHieCallbackEndpointRequest,
  ): Promise<RegisterHieCallbackEndpointResult> {
    return registerCallbackEndpoint(this.context, req);
  }

  public async fetchFacilityRemittances(
    req: HieRemittancesQueryRequest,
  ): Promise<HieRemittancesQueryResult> {
    return fetchFacilityRemittances(this.context, req);
  }

  public async fetchClaimsPaidByRemittance(
    req: HieRemittanceClaimsQueryRequest,
  ): Promise<HieRemittanceClaimsQueryResult> {
    return fetchClaimsPaidByRemittance(this.context, req);
  }
}

export const defaultShaGatewayAdapter = new ShaGatewayAdapter();
