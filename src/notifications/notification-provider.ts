/**
 * JaliCare HMIS
 * Notification provider
 *
 * The repository has no SMS or email provider configured anywhere — no
 * SDK, no credentials, no gateway. The portal therefore needs two
 * things, and this module is both:
 *
 *   1. A **narrow interface** a provider can be dropped into later
 *      without touching the invitation logic.
 *   2. An honest **default** that says `NOT_CONFIGURED` instead of
 *      pretending a message was sent.
 *
 * The failure mode this guards against is the one the audit already
 * found once in this codebase: a screen that says "Sent" because a
 * button was clicked. Delivery status comes from the provider's answer,
 * and if there is no provider, the answer is "I cannot send this".
 */

export type NotificationChannel = 'SMS' | 'EMAIL';

export type DeliveryOutcome =
  | { status: 'SENT'; providerReference?: string }
  | { status: 'FAILED'; reason: string }
  | { status: 'NOT_CONFIGURED'; reason: string };

export interface OutboundMessage {
  channel: NotificationChannel;
  /** Normalised phone (digits) or lower-cased email. */
  to: string;
  subject?: string;
  body: string;
}

export interface NotificationProvider {
  readonly name: string;
  readonly channels: readonly NotificationChannel[];
  send(message: OutboundMessage): Promise<DeliveryOutcome>;
}

/**
 * Environment names a real provider will need.
 *
 * Documented rather than invented: these are the variables an operator
 * would set, and `describeNotificationConfiguration()` reports which are
 * missing so the deployment guide can list them exactly.
 */
export const SMS_PROVIDER_ENV = [
  'SMS_PROVIDER_NAME',
  'SMS_PROVIDER_API_KEY',
  'SMS_PROVIDER_SENDER_ID',
] as const;

export const EMAIL_PROVIDER_ENV = [
  'EMAIL_PROVIDER_HOST',
  'EMAIL_PROVIDER_PORT',
  'EMAIL_PROVIDER_USER',
  'EMAIL_PROVIDER_PASSWORD',
  'EMAIL_PROVIDER_FROM',
] as const;

function envComplete(names: readonly string[]): boolean {
  return names.every((name) => {
    const value = process.env[name];
    return typeof value === 'string' && value.trim() !== '';
  });
}

export interface NotificationConfiguration {
  smsConfigured: boolean;
  emailConfigured: boolean;
  missingSmsVariables: string[];
  missingEmailVariables: string[];
}

export function describeNotificationConfiguration(): NotificationConfiguration {
  const missingSmsVariables = SMS_PROVIDER_ENV.filter(
    (name) => !process.env[name] || process.env[name]!.trim() === '',
  );

  const missingEmailVariables = EMAIL_PROVIDER_ENV.filter(
    (name) => !process.env[name] || process.env[name]!.trim() === '',
  );

  return {
    smsConfigured: envComplete(SMS_PROVIDER_ENV),
    emailConfigured: envComplete(EMAIL_PROVIDER_ENV),
    missingSmsVariables,
    missingEmailVariables,
  };
}

/**
 * The provider this build actually has.
 *
 * There is no HTTP client here on purpose. Writing a guessed integration
 * against an unknown gateway would mean either a fake "sent" or a
 * runtime crash in front of a patient; both are worse than a documented
 * absence. When an operator configures the variables above, this class
 * must be replaced with a real implementation — the interface exists so
 * that replacement is a single file.
 */
class UnconfiguredProvider implements NotificationProvider {
  readonly name = 'unconfigured';
  readonly channels: NotificationChannel[] = ['SMS', 'EMAIL'];

  async send(message: OutboundMessage): Promise<DeliveryOutcome> {
    const configuration = describeNotificationConfiguration();

    const configured =
      message.channel === 'SMS' ? configuration.smsConfigured : configuration.emailConfigured;

    if (!configured) {
      return {
        status: 'NOT_CONFIGURED',
        reason:
          message.channel === 'SMS'
            ? 'No SMS provider is configured for this installation.'
            : 'No email provider is configured for this installation.',
      };
    }

    /*
     * Reaching here means the environment looks configured but no
     * client was registered. That is a deployment error, and it must
     * not be reported as a successful send.
     */
    return {
      status: 'FAILED',
      reason:
        'Provider credentials are present but no sender implementation is registered. Add one in src/notifications/notification-provider.ts.',
    };
  }
}

let provider: NotificationProvider = new UnconfiguredProvider();

/**
 * Swap the provider. Intended for a real implementation and for tests;
 * not reachable from any HTTP route.
 */
export function setNotificationProvider(next: NotificationProvider): void {
  provider = next;
}

export function getNotificationProvider(): NotificationProvider {
  return provider;
}

export async function sendNotification(message: OutboundMessage): Promise<DeliveryOutcome> {
  if (!message.to || message.to.trim() === '') {
    return { status: 'FAILED', reason: 'There is no contact address to send to.' };
  }

  try {
    return await provider.send(message);
  } catch (error) {
    return {
      status: 'FAILED',
      reason:
        error instanceof Error
          ? `The provider threw: ${error.message}`
          : 'The provider threw an unknown error.',
    };
  }
}

/**
 * The message body.
 *
 * It names the facility and the action and nothing else. No diagnosis,
 * no result, no MRN, no national ID: an SMS is read on a shared phone,
 * and the patient's neighbour is not a party to their care. The token
 * itself goes in the link, which is unavoidable for a self-service
 * activation — and it is single-use, expiring and hashed at rest.
 */
export function buildInvitationMessage(input: {
  facilityName: string;
  link: string;
  expiryHours: number;
}): string {
  return [
    `${input.facilityName}: you can now view your own medical records online.`,
    `Activate your account: ${input.link}`,
    `This link works once and expires in ${input.expiryHours} hours.`,
    'If you did not ask for this, tell the reception desk and ignore the message.',
  ].join(' ');
}
