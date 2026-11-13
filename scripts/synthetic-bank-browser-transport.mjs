// Test-only preload. It never sends traffic to any provider or other host.
// Use only from the guarded browser-to-synthetic-PostgreSQL smoke.
const database = process.env.SQL_DB_NAME ?? '';
if (
  process.env.BROWSER_SMOKE_SYNTHETIC !== 'YES' ||
  !['127.0.0.1', 'localhost', '::1'].includes(process.env.SQL_HOST ?? '') ||
  !/(?:(?:synthetic|browser).*test|test.*(?:synthetic|browser))/i.test(database)
)
  throw new Error('Synthetic bank browser transport requires a loopback test database.');

globalThis.fetch = async (input, options = {}) => {
  const target = String(input instanceof Request ? input.url : input);
  const headers = new Headers(options.headers);
  if (target === 'https://uat.buni.kcbgroup.com/token') {
    const basic = headers.get('authorization') ?? '';
    if (
      options.method !== 'POST' ||
      options.body !== 'grant_type=client_credentials' ||
      !basic.startsWith('Basic ') ||
      !/^synthetic-kcb-key-[a-f0-9]{8}:synthetic-kcb-secret-[a-f0-9]{8}$/.test(
        Buffer.from(basic.slice(6), 'base64').toString('utf8'),
      )
    )
      throw new Error('Unexpected synthetic KCB authentication request.');
    return new Response(JSON.stringify({ access_token: 'synthetic-browser-kcb-token' }), {
      status: 200,
    });
  }
  if (target === 'https://uat.finserve.africa/authentication/api/v3/authenticate/merchant') {
    const body = JSON.parse(String(options.body));
    if (
      options.method !== 'POST' ||
      !/^synthetic-jenga-key-[a-f0-9]{8}$/.test(headers.get('api-key') ?? '') ||
      !/^synthetic-jenga-merchant-[a-f0-9]{8}$/.test(body.merchantCode ?? '') ||
      !/^synthetic-jenga-secret-[a-f0-9]{8}$/.test(body.consumerSecret ?? '')
    )
      throw new Error('Unexpected synthetic Jenga authentication request.');
    return new Response(
      JSON.stringify({
        accessToken: 'synthetic-browser-jenga-token',
        refreshToken: 'synthetic-browser-refresh-token',
      }),
      { status: 200 },
    );
  }
  throw new Error('The synthetic bank browser transport blocks all external requests.');
};
