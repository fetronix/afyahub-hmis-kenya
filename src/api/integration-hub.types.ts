export interface IntegrationAuditEvent {
  id: number;
  action: string;
  resource: string;
  resourceId: string | null;
  actorUserId: string | null;
  timestamp: string;
}
