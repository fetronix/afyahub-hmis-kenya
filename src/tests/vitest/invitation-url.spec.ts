import { describe, expect, it } from 'vitest';
import {
  buildInvitationUrl,
  isLoopbackHostname,
  resolveInvitationBaseUrl,
} from '../../auth/invitation-url.ts';

describe('Invitation base URL resolution (APP_BASE_URL & safe request fallback)', () => {
  it('identifies loopback hostnames accurately', () => {
    expect(isLoopbackHostname('localhost')).toBe(true);
    expect(isLoopbackHostname('127.0.0.1')).toBe(true);
    expect(isLoopbackHostname('::1')).toBe(true);
    expect(isLoopbackHostname('[::1]')).toBe(true);
    expect(isLoopbackHostname('hmis.example.co.ke')).toBe(false);
  });

  it('prefers explicit APP_BASE_URL and preserves deployment sub-paths', () => {
    const resolved = resolveInvitationBaseUrl(
      { headers: { host: 'other.example.co.ke' } },
      { APP_BASE_URL: 'https://hmis.example.co.ke/portal-root/', NODE_ENV: 'production' },
    );

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.source).toBe('env');
    expect(
      buildInvitationUrl(resolved.baseUrl, '/accept-facility-admin-invitation', 'tok-123'),
    ).toBe('https://hmis.example.co.ke/portal-root/accept-facility-admin-invitation?token=tok-123');
    expect(buildInvitationUrl(resolved.baseUrl, '/accept-staff-invitation', 'tok-456')).toBe(
      'https://hmis.example.co.ke/portal-root/accept-staff-invitation?token=tok-456',
    );
  });

  it('falls back safely to verified same-host Origin when APP_BASE_URL is unset (cPanel / reverse proxy)', () => {
    const resolved = resolveInvitationBaseUrl(
      {
        protocol: 'http', // e.g. behind Apache/Passenger when TRUST_PROXY is unset
        headers: {
          origin: 'https://hmis.clinic.co.ke',
          host: 'hmis.clinic.co.ke',
        },
      },
      { APP_BASE_URL: '', NODE_ENV: 'production' },
    );

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.source).toBe('request');
    expect(buildInvitationUrl(resolved.baseUrl, '/accept-facility-admin-invitation', 'abc')).toBe(
      'https://hmis.clinic.co.ke/accept-facility-admin-invitation?token=abc',
    );
  });

  it('falls back to allowlisted Vite dev Origin (localhost:5173) in development when APP_BASE_URL is unset', () => {
    const resolved = resolveInvitationBaseUrl(
      {
        protocol: 'http',
        headers: {
          origin: 'http://localhost:5173',
          host: 'localhost:3000',
        },
      },
      { NODE_ENV: 'development' },
    );

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.baseUrl.origin).toBe('http://localhost:5173');
  });

  it('falls back to localhost/127.0.0.1 Host header when Origin is absent and APP_BASE_URL is unset', () => {
    const resolved = resolveInvitationBaseUrl(
      {
        protocol: 'http',
        headers: { host: '127.0.0.1:3000' },
      },
      { APP_BASE_URL: '   ', NODE_ENV: 'development' },
    );

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.baseUrl.origin).toBe('http://127.0.0.1:3000');
  });

  it('ignores spoofed mismatched Origin headers and uses HTTPS on non-loopback production Host', () => {
    const resolved = resolveInvitationBaseUrl(
      {
        protocol: 'http',
        headers: {
          origin: 'https://evil-attacker.example',
          host: 'hmis.clinic.co.ke',
        },
      },
      { NODE_ENV: 'production' },
    );

    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.baseUrl.origin).toBe('https://hmis.clinic.co.ke');
  });

  it('fails closed when explicit APP_BASE_URL is malformed, carries credentials, or uses HTTP in production', () => {
    const badScheme = resolveInvitationBaseUrl(
      { headers: { host: 'localhost:3000' } },
      { APP_BASE_URL: 'javascript:alert(1)', NODE_ENV: 'development' },
    );
    expect(badScheme.ok).toBe(false);

    const withCreds = resolveInvitationBaseUrl(
      { headers: { host: 'localhost:3000' } },
      { APP_BASE_URL: 'https://admin:secret@hmis.clinic.co.ke', NODE_ENV: 'production' },
    );
    expect(withCreds.ok).toBe(false);

    const insecureProd = resolveInvitationBaseUrl(
      { headers: { host: 'hmis.clinic.co.ke' } },
      { APP_BASE_URL: 'http://hmis.clinic.co.ke', NODE_ENV: 'production' },
    );
    expect(insecureProd.ok).toBe(false);
    if (!insecureProd.ok) {
      expect(insecureProd.code).toBe('INVALID_APP_BASE_URL');
    }
  });

  it('rejects malformed Host headers and returns APP_BASE_URL_NOT_CONFIGURED when nothing usable exists', () => {
    const badHost = resolveInvitationBaseUrl(
      { headers: { host: 'evil.example/injected-path' } },
      { NODE_ENV: 'production' },
    );
    expect(badHost.ok).toBe(false);
    if (!badHost.ok) {
      expect(badHost.code).toBe('APP_BASE_URL_NOT_CONFIGURED');
    }
  });
});
