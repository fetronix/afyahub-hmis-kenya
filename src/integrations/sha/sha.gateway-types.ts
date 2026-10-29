/** Gateway facade, bundle and transport contracts; re-exported at the original adapter path. */
import type { ShaConfig, ShaConnectionStatusReport, ShaEnvironmentMode } from './sha.config.ts';
import type { ParsedShaBundleResponse, ParsedShaClaimStatus } from './sha.fhir.ts';
import type {
  VerificationSource,
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

export interface BundleGatewayRequest {
  tenantId: number;
  facilityId: number;
  actorUserId: number | null;
  facilityRegistryOverride?: string | null;
  operation: 'preauthorization.submit' | 'claims.submit' | 'claims.resubmit';
  bundleUuid: string;
  claimUuid: string;
  fhirBundle: Record<string, unknown>;
  correlationId?: string;
}

export interface BundleGatewayResult extends ParsedShaBundleResponse {
  mode: ShaEnvironmentMode;
  source: VerificationSource;
  isSimulated: boolean;
  httpStatus: number | null;
  correlationId: string;
}

export interface ClaimStatusGatewayRequest {
  tenantId: number;
  facilityId: number;
  actorUserId: number | null;
  facilityRegistryOverride?: string | null;
  claimUuid: string;
  payerClaimReference?: string | null;
  correlationId?: string;
}

export interface ClaimStatusGatewayResult extends ParsedShaClaimStatus {
  mode: ShaEnvironmentMode;
  source: VerificationSource;
  isSimulated: boolean;
  httpStatus: number | null;
  correlationId: string;
  errorMessage: string | null;
}

export interface PayerGatewayAdapter {
  readonly payerCode: string;
  getConnectionStatus(facilityRegistryOverride?: string | null): ShaConnectionStatusReport;
  checkEligibility(req: EligibilityGatewayRequest): Promise<EligibilityGatewayResult>;
  submitBundle(req: BundleGatewayRequest): Promise<BundleGatewayResult>;
  queryClaimStatus(req: ClaimStatusGatewayRequest): Promise<ClaimStatusGatewayResult>;
  searchClientRegistryPatient?(
    req: ClientRegistrySearchRequest,
  ): Promise<ClientRegistrySearchResult>;
  fetchPatientBenefitsAndInterventions?(
    req: HieBenefitsLookupRequest,
  ): Promise<HieBenefitsLookupResult>;
  fetchBenefitUtilizationAndBalances?(
    req: HieUtilizationLookupRequest,
  ): Promise<HieUtilizationLookupResult>;
  createVisitAuthorization?(req: VisitAuthorizationRequest): Promise<VisitAuthorizationResult>;
  submitHiePreauth?(req: HiePreauthGatewayRequest): Promise<HiePreauthGatewayResult>;
  queryHiePreauths?(req: {
    tenantId: number;
    facilityId: number;
    actorUserId: number | null;
    facilityRegistryOverride?: string | null;
    consentToken: string;
    hiePreauthGuid?: string | null;
    correlationId?: string;
  }): Promise<HiePreauthGatewayResult>;
  cancelHiePreauth?(req: {
    tenantId: number;
    facilityId: number;
    actorUserId: number | null;
    facilityRegistryOverride?: string | null;
    consentToken: string;
    hiePreauthGuid?: string | null;
    reason: string;
    correlationId?: string;
  }): Promise<{
    cancelled: boolean;
    source: VerificationSource;
    isSimulated: boolean;
    errorMessage: string | null;
    correlationId: string;
  }>;
  submitHieVirtualClaim?(req: HieVirtualClaimSubmitRequest): Promise<BundleGatewayResult>;
  fetchFacilityRemittances?(req: HieRemittancesQueryRequest): Promise<HieRemittancesQueryResult>;
  fetchClaimsPaidByRemittance?(
    req: HieRemittanceClaimsQueryRequest,
  ): Promise<HieRemittanceClaimsQueryResult>;
  registerCallbackEndpoint?(
    req: RegisterHieCallbackEndpointRequest,
  ): Promise<RegisterHieCallbackEndpointResult>;
}

export type FetchLike = typeof globalThis.fetch;

export interface ShaGatewayAdapterOptions {
  config?: ShaConfig;
  fetchImpl?: FetchLike;
  recordAuditCall?: boolean;
}
