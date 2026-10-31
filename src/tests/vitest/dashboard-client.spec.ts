import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '../../api/client.ts';

describe('dashboard API transport regression', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('reports a 200 HTML SPA fallback as a routing error rather than parsing it as JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('<!doctype html><html><body>Fallback</body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
      ),
    );
    try {
      await api.getDashboardOverview(9, { start: '2026-01-01', end: '2026-01-31' });
      throw new Error('Expected an API error');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ code: 'UNEXPECTED_HTML_RESPONSE', status: 200 });
      expect((error as Error).message).toContain('/api/dashboard/overview');
      expect((error as Error).message).not.toContain('start=');
    }
  });
});
