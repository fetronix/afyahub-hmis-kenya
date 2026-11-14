// Test-only preload: it never sends network traffic to any provider.
// It may be used only with the explicitly guarded synthetic browser smoke.
const database = process.env.SQL_DB_NAME ?? '';
if (
  process.env.BROWSER_SMOKE_SYNTHETIC !== 'YES' ||
  !['127.0.0.1', 'localhost', '::1'].includes(process.env.SQL_HOST ?? '') ||
  !/(?:(?:synthetic|browser).*test|test.*(?:synthetic|browser))/i.test(database)
)
  throw new Error('Synthetic browser transport requires a loopback test database.');

const runId = process.env.MPESA_BROWSER_MOCK_RUN_ID ?? '';
if (!/^[a-f0-9]{8}$/.test(runId)) throw new Error('A unique synthetic run ID is required.');
let pushes = 0;
globalThis.fetch = async (input, options = {}) => {
  const target = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (target.origin !== 'https://sandbox.safaricom.co.ke')
    throw new Error('The synthetic browser transport blocks all external requests.');
  const json = (value) => new Response(JSON.stringify(value), { status: 200 });
  if (target.pathname === '/oauth/v1/generate')
    return json({ access_token: 'synthetic-browser-token' });
  if (target.pathname === '/mpesa/stkpush/v1/processrequest') {
    const body = JSON.parse(String(options.body));
    if (body.TransactionType !== 'CustomerPayBillOnline' || body.Amount !== 20)
      throw new Error('Unexpected synthetic browser STK request.');
    return json({
      ResponseCode: '0',
      CheckoutRequestID: `ws_synthetic_browser_${runId}_${++pushes}`,
    });
  }
  if (target.pathname === '/mpesa/stkpushquery/v1/query') {
    const body = JSON.parse(String(options.body));
    const match = new RegExp(`^ws_synthetic_browser_${runId}_(\\d+)$`).exec(body.CheckoutRequestID);
    if (!match) throw new Error('Unexpected synthetic browser query.');
    return json({
      ResponseCode: '0',
      ResultCode: match[1] === '1' ? '0' : '1032',
      CheckoutRequestID: body.CheckoutRequestID,
    });
  }
  throw new Error('Unrecognized synthetic browser provider endpoint.');
};
