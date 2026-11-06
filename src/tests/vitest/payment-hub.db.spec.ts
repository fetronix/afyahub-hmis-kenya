/** Real authenticated HTTP + disposable PostgreSQL; all provider responses are mocked. */
import { createHash, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { describeDb } from './support/db.ts';
import { pool } from '../../db/index.ts';
import { createSession } from '../../auth/session.service.ts';
import { recordSettledPayment } from '../../billing/payments.service.ts';
import {
  decryptFacilitySecret,
  encryptFacilitySecret,
  privateDigest,
} from '../../payment-hub/secrets.ts';

const codes = [
  'payment_hub.global.read',
  'payment_hub.global.manage',
  'payment_hub.assign',
  'payment_hub.production.approve',
  'payment_hub.catalogue.read',
  'payment_hub.facility.manage',
  'payment_hub.credentials.manage',
  'payment_hub.accounts.read',
  'payment_hub.production.request',
  'payment_hub.transactions.read',
  'payment_hub.collection.initiate',
  'payment_hub.payments.verify',
  'payment_hub.reconciliation.manage',
];
const facilityCodes = codes.filter(
  (x) =>
    !x.includes('.global.') && x !== 'payment_hub.assign' && x !== 'payment_hub.production.approve',
);
const fakeCredentials = {
  consumerKey: 'synthetic-hub-key',
  consumerSecret: 'synthetic-hub-secret',
  passkey: 'synthetic-hub-passkey',
  shortcode: '123456',
  transactionType: 'CustomerPayBillOnline',
};

describeDb('payment hub authenticated HTTP and PostgreSQL (mocked provider only)', () => {
  let server: Server,
    base: string,
    tenantA: number,
    tenantB: number,
    facilityA: number,
    facilityB: number,
    facilityC: number,
    userA: number,
    userC: number,
    superUser: number,
    providerId: number,
    integrationId: number,
    productionId: number,
    invoiceId: number,
    invoiceC: number,
    transactionId: number;
  let superToken: string,
    aToken: string,
    bToken: string,
    cToken: string,
    clerkToken: string,
    tenantToken: string,
    delegatedToken: string;
  let queryResult = '4999',
    pushCount = 0,
    offline = false,
    failPush = false;
  const realFetch = globalThis.fetch;
  const secretNames: string[] = [];
  const provision = (
    facility: number,
    tenant: number,
    integration: number,
    environment: string,
    credentials: Record<string, string>,
  ) => {
    const name = `PAYMENT_HUB_T${tenant}_F${facility}_I${integration}_${environment}`;
    process.env[name] = JSON.stringify(credentials);
    secretNames.push(name);
    return name;
  };
  const call = async (
    token: string | undefined,
    method: string,
    path: string,
    body?: unknown,
    key?: string,
  ) => {
    const r = await realFetch(`${base}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(key ? { 'Idempotency-Key': key } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, data: (await r.json()) as Record<string, any> };
  };
  beforeAll(async () => {
    if (!(process.env.SQL_DB_NAME ?? '').includes('test'))
      throw new Error('Disposable test database required.');
    process.env.PAYMENT_HUB_ENCRYPTION_KEY = createHash('sha256')
      .update('payment hub synthetic DB test key')
      .digest('base64');
    process.env.PAYMENT_HUB_CALLBACK_BASE_URL = 'https://example.test';
    const x = randomUUID().slice(0, 8);
    fakeCredentials.consumerKey = `synthetic-hub-key-${x}`;
    fakeCredentials.consumerSecret = `synthetic-hub-secret-${x}`;
    fakeCredentials.passkey = `synthetic-hub-passkey-${x}`;
    const tenants = await pool.query(
      `INSERT INTO tenants(name,slug) VALUES($1,$2),($3,$4) RETURNING id`,
      [`Hub tenant A ${x}`, `hub-a-${x}`, `Hub tenant B ${x}`, `hub-b-${x}`],
    );
    tenantA = tenants.rows[0].id;
    tenantB = tenants.rows[1].id;
    const facilities = await pool.query(
      `INSERT INTO facilities(tenant_id,code,name) VALUES($1,$2,'Synthetic Hub A'),($1,$3,'Synthetic Hub B'),($4,$5,'Synthetic Hub C') RETURNING id`,
      [tenantA, `ha-${x}`, `hb-${x}`, tenantB, `hc-${x}`],
    );
    facilityA = facilities.rows[0].id;
    facilityB = facilities.rows[1].id;
    facilityC = facilities.rows[2].id;
    for (const code of codes)
      await pool.query(
        `INSERT INTO permissions(code,name,module) VALUES($1,$1,'payment_hub') ON CONFLICT(code) DO NOTHING`,
        [code],
      );
    const createActor = async (
      tag: string,
      tenant: number | null,
      facility: number | null,
      role: string,
      grants: string[],
    ) => {
      const u = await pool.query(
        `INSERT INTO users(uid,username,email,full_name,password_hash,account_status,tenant_id,facility_id) VALUES($1,$2,$3,$4,'synthetic','ACTIVE',$5,$6) RETURNING id`,
        [
          `hub-${tag}-${x}`,
          `hub-${tag}-${x}`,
          `hub-${tag}-${x}@example.test`,
          `Synthetic ${tag}`,
          tenant,
          facility,
        ],
      );
      const r = await pool.query(
        `INSERT INTO roles(tenant_id,name,is_active) VALUES($1,$2,true) ON CONFLICT(tenant_id,name) DO UPDATE SET name=EXCLUDED.name RETURNING id`,
        [tenant, role],
      );
      await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [
        u.rows[0].id,
        r.rows[0].id,
      ]);
      for (const grant of grants)
        await pool.query(
          'INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE code=$2 ON CONFLICT DO NOTHING',
          [r.rows[0].id, grant],
        );
      const session = await createSession({ userId: u.rows[0].id, securityVersion: 1 });
      return { id: u.rows[0].id, token: session.sessionToken };
    };
    const su = await createActor('super', null, null, 'SUPER_ADMIN', codes),
      a = await createActor('a', tenantA, facilityA, 'FACILITY_ADMIN', facilityCodes),
      b = await createActor('b', tenantA, facilityB, 'FACILITY_ADMIN', facilityCodes),
      c = await createActor('c', tenantB, facilityC, 'FACILITY_ADMIN', facilityCodes),
      clerk = await createActor('clerk', tenantA, facilityA, `HUB_CLERK_${x}`, [
        'payment_hub.transactions.read',
      ]),
      tenant = await createActor('tenant', tenantA, null, `HUB_TENANT_${x}`, facilityCodes),
      delegated = await createActor(
        'delegated',
        tenantA,
        facilityA,
        `HUB_DELEGATED_${x}`,
        facilityCodes,
      );
    superUser = su.id;
    userA = a.id;
    userC = c.id;
    superToken = su.token;
    aToken = a.token;
    bToken = b.token;
    cToken = c.token;
    clerkToken = clerk.token;
    tenantToken = tenant.token;
    delegatedToken = delegated.token;
    const patient = await pool.query(
      `INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender) VALUES($1,$2,$3,'Synthetic','Patient','2000-01-01','Unknown') RETURNING id`,
      [tenantA, facilityA, `hub-mrn-${x}`],
    );
    const invoice = await pool.query(
      `INSERT INTO billing_invoices(tenant_id,facility_id,patient_id,invoice_number,total_amount,paid_amount,balance_amount,status) VALUES($1,$2,$3,$4,'100.00','0.00','100.00','Unpaid') RETURNING id`,
      [tenantA, facilityA, patient.rows[0].id, `HUB-INV-${x}`],
    );
    invoiceId = invoice.rows[0].id;
    const patientC = await pool.query(
      `INSERT INTO patients(tenant_id,registration_facility_id,mrn,first_name,last_name,date_of_birth,gender) VALUES($1,$2,$3,'Synthetic','Other','2000-01-01','Unknown') RETURNING id`,
      [tenantB, facilityC, `hub-mrn-other-${x}`],
    );
    const otherInvoice = await pool.query(
      `INSERT INTO billing_invoices(tenant_id,facility_id,patient_id,invoice_number,total_amount,paid_amount,balance_amount,status) VALUES($1,$2,$3,$4,'100.00','0.00','100.00','Unpaid') RETURNING id`,
      [tenantB, facilityC, patientC.rows[0].id, `HUB-INV-OTHER-${x}`],
    );
    invoiceC = otherInvoice.rows[0].id;
    providerId = (
      await pool.query(`SELECT id FROM payment_provider_definitions WHERE code='MPESA_DARAJA'`)
    ).rows[0].id;
    // This suite uses the seeded Daraja definition in a disposable DB and
    // restores the policies it exercises so repeated runs are independent.
    await pool.query(
      `UPDATE payment_provider_definitions SET status='ACTIVE',requestable=true WHERE id=$1`,
      [providerId],
    );
    await pool.query(
      `UPDATE payment_provider_environments SET is_available=(environment='SANDBOX') WHERE provider_id=$1`,
      [providerId],
    );
    await pool.query(
      `UPDATE payment_provider_capability_policies SET is_allowed=true WHERE provider_id=$1`,
      [providerId],
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const target = String(input);
        if (!target.startsWith('https://sandbox.safaricom.co.ke/'))
          throw new Error('Unexpected external request in synthetic test');
        if (offline) throw new Error('synthetic network timeout');
        if (target.includes('/oauth/v1/generate'))
          return new Response(JSON.stringify({ access_token: 'synthetic-access-token' }), {
            status: 200,
          });
        if (target.includes('/mpesa/stkpush/v1/processrequest')) {
          pushCount++;
          if (failPush) throw new Error('synthetic timeout after dispatch');
          return new Response(
            JSON.stringify({
              ResponseCode: '0',
              CheckoutRequestID: `ws_synthetic_${x}_${pushCount}`,
            }),
            { status: 200 },
          );
        }
        if (target.includes('/mpesa/stkpushquery/v1/query')) {
          const request = JSON.parse(String(init?.body));
          return new Response(
            JSON.stringify({
              ResponseCode: '0',
              ResultCode: queryResult,
              CheckoutRequestID: request.CheckoutRequestID,
            }),
            { status: 200 },
          );
        }
        throw new Error('Unexpected mock endpoint');
      }),
    );
    const { createApp } = await import('../../app.ts');
    const app = await createApp();
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    vi.unstubAllGlobals();
    for (const name of secretNames) delete process.env[name];
    delete process.env.PAYMENT_HUB_ENCRYPTION_KEY;
    delete process.env.PAYMENT_HUB_ACTIVE_VAULT_KEY_ID;
    delete process.env.PAYMENT_HUB_VAULT_KEY_K1;
    delete process.env.PAYMENT_HUB_VAULT_KEY_K2;
    delete process.env.PAYMENT_HUB_CALLBACK_BASE_URL;
  });

  it('enforces platform versus facility roles on actually mounted routes', async () => {
    expect((await call(undefined, 'GET', '/api/payment-hub/platform')).status).toBe(401);
    expect((await call(aToken, 'GET', '/api/payment-hub/platform')).status).toBe(403);
    expect((await call(superToken, 'GET', '/api/payment-hub/platform')).status).toBe(200);
    expect(
      (
        await call(
          superToken,
          'GET',
          `/api/payment-hub/facility/transactions?facilityId=${facilityA}`,
        )
      ).status,
    ).toBe(403);
    expect(
      (await call(clerkToken, 'GET', `/api/payment-hub/facility/catalogue?facilityId=${facilityA}`))
        .status,
    ).toBe(403);
    expect(
      (
        await call(
          tenantToken,
          'GET',
          `/api/payment-hub/facility/catalogue?facilityId=${facilityC}`,
        )
      ).status,
    ).toBe(403);
    expect(
      (await call(aToken, 'GET', `/api/payment-hub/facility/catalogue?facilityId=${facilityB}`))
        .status,
    ).toBe(403);
    expect(
      (
        await call(
          tenantToken,
          'GET',
          `/api/payment-hub/facility/catalogue?facilityId=${facilityA}`,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await call(
          delegatedToken,
          'GET',
          `/api/payment-hub/facility/catalogue?facilityId=${facilityA}`,
        )
      ).status,
    ).toBe(200);
    const delegated = await call(
      delegatedToken,
      'POST',
      `/api/payment-hub/facility/providers/${providerId}/integrations`,
      { facilityId: facilityA, environment: 'SANDBOX', capabilities: [] },
    );
    expect(delegated.status).toBe(403);
    expect(delegated.data.error).toBe('FACILITY_ADMIN_REQUIRED');
    expect(
      (
        await call(
          tenantToken,
          'POST',
          `/api/payment-hub/facility/providers/${providerId}/access-request`,
          { facilityId: facilityA },
        )
      ).status,
    ).toBe(403);
  });
  it('requires platform assignment before facility configuration and supports access requests', async () => {
    const cat = await call(
      aToken,
      'GET',
      `/api/payment-hub/facility/catalogue?facilityId=${facilityA}`,
    );
    expect(cat.status).toBe(200);
    expect(cat.data.providers.find((p: any) => p.id === providerId).isAllowed).toBe(false);
    expect(
      (
        await call(
          aToken,
          'POST',
          `/api/payment-hub/facility/providers/${providerId}/integrations`,
          { facilityId: facilityA, environment: 'SANDBOX', capabilities: ['PAYMENT_COLLECTION'] },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await call(
          aToken,
          'POST',
          `/api/payment-hub/facility/providers/${providerId}/access-request`,
          { facilityId: facilityA },
        )
      ).status,
    ).toBe(201);
    const platform = await call(superToken, 'GET', '/api/payment-hub/platform');
    expect(
      platform.data.requests.some(
        (r: any) => r.providerId === providerId && r.facilityId === facilityA,
      ),
    ).toBe(true);
    expect(
      (
        await call(
          superToken,
          'PUT',
          `/api/payment-hub/platform/providers/${providerId}/facilities/${facilityA}`,
          { isAllowed: true },
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await call(
          bToken,
          'POST',
          `/api/payment-hub/facility/providers/${providerId}/integrations`,
          { facilityId: facilityB, environment: 'SANDBOX', capabilities: [] },
        )
      ).status,
    ).toBe(403);
  });
  it('encrypts per-facility credentials, returns only masked accounts and denies cross-facility mutations', async () => {
    const conf = await call(
      aToken,
      'POST',
      `/api/payment-hub/facility/providers/${providerId}/integrations`,
      {
        facilityId: facilityA,
        environment: 'SANDBOX',
        capabilities: ['PAYMENT_COLLECTION', 'PAYMENT_STATUS', 'HEALTH'],
      },
    );
    expect(conf.status).toBe(201);
    integrationId = conf.data.id;
    expect(
      (
        await call(
          aToken,
          'PUT',
          `/api/payment-hub/facility/integrations/${integrationId}/credentials`,
          { facilityId: facilityA, source: 'ENVIRONMENT' },
        )
      ).status,
    ).toBe(409);
    const variable = provision(facilityA, tenantA, integrationId, 'SANDBOX', fakeCredentials);
    expect(
      (
        await call(
          aToken,
          'PUT',
          `/api/payment-hub/facility/integrations/${integrationId}/credentials`,
          { facilityId: facilityA, ...fakeCredentials },
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await call(
          aToken,
          'PUT',
          `/api/payment-hub/facility/integrations/${integrationId}/credentials`,
          { facilityId: facilityA, source: 'ENVIRONMENT' },
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await call(
          bToken,
          'PUT',
          `/api/payment-hub/facility/integrations/${integrationId}/credentials`,
          { facilityId: facilityB, source: 'ENVIRONMENT' },
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await call(
          cToken,
          'POST',
          `/api/payment-hub/facility/integrations/${integrationId}/accounts`,
          { facilityId: facilityC, alias: 'Other', accountType: 'BANK', lastFour: '0000' },
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await call(
          clerkToken,
          'PUT',
          `/api/payment-hub/facility/integrations/${integrationId}/credentials`,
          { facilityId: facilityA, source: 'ENVIRONMENT' },
        )
      ).status,
    ).toBe(403);
    const account = await call(
      aToken,
      'POST',
      `/api/payment-hub/facility/integrations/${integrationId}/accounts`,
      {
        facilityId: facilityA,
        alias: 'Synthetic till',
        accountType: 'MOBILE_MONEY',
        lastFour: '3456',
      },
    );
    expect(account.status).toBe(201);
    expect(account.data.account.maskedIdentifier).toBe('••••3456');
    expect(account.data.account.authorizationState).toBe('PENDING');
    const encrypted = (
      await pool.query(
        'SELECT encrypted_value FROM facility_payment_secrets WHERE integration_id=$1',
        [integrationId],
      )
    ).rows[0].encrypted_value;
    expect(encrypted).not.toContain(fakeCredentials.consumerSecret);
    expect(encrypted).not.toContain(fakeCredentials.shortcode);
    const stored = decryptFacilitySecret(
      { tenantId: tenantA, facilityId: facilityA, integrationId },
      encrypted,
    );
    expect(stored.environmentReference).toBe(variable);
    expect(JSON.stringify(stored)).not.toContain(fakeCredentials.consumerSecret);
    expect(JSON.stringify(stored)).not.toContain(fakeCredentials.passkey);
    const catalogue = JSON.stringify(
      (await call(aToken, 'GET', `/api/payment-hub/facility/catalogue?facilityId=${facilityA}`))
        .data,
    );
    for (const secret of [
      fakeCredentials.consumerKey,
      fakeCredentials.consumerSecret,
      fakeCredentials.passkey,
      fakeCredentials.shortcode,
    ])
      expect(catalogue).not.toContain(secret);
    expect(catalogue).toContain('••••3456');
    expect(catalogue).toContain(variable);
    const platform = JSON.stringify(
      (await call(superToken, 'GET', '/api/payment-hub/platform')).data,
    );
    expect(platform).not.toContain('3456');
    expect(platform).not.toContain(fakeCredentials.consumerSecret);
  });
  it('requires reconfiguration after server credential rotation', async () => {
    const name = `PAYMENT_HUB_T${tenantA}_F${facilityA}_I${integrationId}_SANDBOX`;
    process.env[name] = JSON.stringify({
      ...fakeCredentials,
      passkey: 'synthetic-rotated-passkey',
    });
    const result = await call(
      aToken,
      'POST',
      `/api/payment-hub/facility/integrations/${integrationId}/health`,
      { facilityId: facilityA },
    );
    expect(result.status).toBe(409);
    expect(result.data.error).toBe('CREDENTIALS_CHANGED');
    process.env[name] = JSON.stringify(fakeCredentials);
  });
  it('checks OAuth only, enables sandbox and keeps payment collection idempotent', async () => {
    const health = await call(
      aToken,
      'POST',
      `/api/payment-hub/facility/integrations/${integrationId}/health`,
      { facilityId: facilityA },
    );
    expect(health.status).toBe(200);
    expect(health.data.status).toBe('HEALTHY');
    expect(health.data.notice).toContain('OAuth');
    expect(
      (
        await call(
          aToken,
          'PUT',
          `/api/payment-hub/facility/integrations/${integrationId}/enabled`,
          { facilityId: facilityA, enabled: true },
        )
      ).status,
    ).toBe(200);
    const body = {
      facilityId: facilityA,
      integrationId,
      invoiceId,
      amountKes: '20',
      phone: '254700000001',
    };
    const first = await call(
      aToken,
      'POST',
      '/api/payment-hub/facility/collections',
      body,
      'synthetic-request-1',
    );
    expect(first.status).toBe(201);
    expect(first.data.status).toBe('PENDING');
    transactionId = first.data.transactionId;
    expect(pushCount).toBe(1);
    const repeat = await call(
      aToken,
      'POST',
      '/api/payment-hub/facility/collections',
      body,
      'synthetic-request-1',
    );
    expect(repeat.status).toBe(200);
    expect(repeat.data.idempotentReplay).toBe(true);
    expect(pushCount).toBe(1);
    // A request stored before the separate-review field was introduced is still replayable.
    const oldHash = privateDigest(
      JSON.stringify({
        integrationId,
        invoiceId,
        phone: body.phone,
        cents: 2000,
        allowOverpayment: false,
      }),
    );
    await pool.query('UPDATE payment_hub_transactions SET request_hash=$1 WHERE id=$2', [
      oldHash,
      transactionId,
    ]);
    const legacyRetry = await call(
      aToken,
      'POST',
      '/api/payment-hub/facility/collections',
      body,
      'synthetic-request-1',
    );
    expect(legacyRetry.status).toBe(200);
    expect(legacyRetry.data.idempotentReplay).toBe(true);
    expect(pushCount).toBe(1);
    const changedLegacyRetry = await call(
      aToken,
      'POST',
      '/api/payment-hub/facility/collections',
      { ...body, confirmSeparateRequest: true },
      'synthetic-request-1',
    );
    expect(changedLegacyRetry.status).toBe(409);
    expect(pushCount).toBe(1);
    expect(
      (
        await call(
          aToken,
          'POST',
          '/api/payment-hub/facility/collections',
          { ...body, amountKes: '21' },
          'synthetic-request-1',
        )
      ).status,
    ).toBe(409);
    const secondWithoutReview = await call(
      aToken,
      'POST',
      '/api/payment-hub/facility/collections',
      body,
      'synthetic-request-distinct',
    );
    expect(secondWithoutReview.status).toBe(409);
    expect(secondWithoutReview.data.error).toBe('PENDING_COLLECTION_REVIEW_REQUIRED');
    expect(pushCount).toBe(1);
    const invoice = await pool.query(
      'SELECT paid_amount,status FROM billing_invoices WHERE id=$1',
      [invoiceId],
    );
    expect(invoice.rows[0]).toMatchObject({ paid_amount: '0.00', status: 'Unpaid' });
  });
  it('rejects unauthenticated callback replays without recording or changing financial state', async () => {
    const txBefore = (
      await pool.query('SELECT * FROM payment_hub_transactions WHERE id=$1', [transactionId])
    ).rows[0];
    const invoiceBefore = (
      await pool.query('SELECT * FROM billing_invoices WHERE id=$1', [invoiceId])
    ).rows[0];
    const eventsBefore = await pool.query(
      'SELECT id FROM payment_hub_webhook_events WHERE transaction_id=$1',
      [transactionId],
    );
    const paymentsBefore = await pool.query('SELECT id FROM billing_payments WHERE invoice_id=$1', [
      invoiceId,
    ]);
    const callback = {
      Body: {
        stkCallback: {
          CheckoutRequestID: txBefore.provider_request_id,
          ResultCode: 0,
          CallbackMetadata: {
            Item: [
              { Name: 'Amount', Value: 20 },
              { Name: 'PhoneNumber', Value: 'synthetic' },
            ],
          },
        },
      },
      credential: 'synthetic-callback-secret',
    };
    const bodies = [
      {},
      callback,
      callback,
      { ...callback, irrelevant: 'modified replay' },
      { Body: { stkCallback: { CheckoutRequestID: 'unknown_id', ResultCode: 0 } } },
    ];
    const attempts = await Promise.all(
      bodies.map((body) => call(undefined, 'POST', '/api/payment-hub/webhooks/mpesa', body)),
    );
    for (const attempt of attempts) {
      expect(attempt.status).toBe(503);
      expect(attempt.data).toEqual({ received: false, error: 'CALLBACK_VERIFICATION_UNAVAILABLE' });
      expect(JSON.stringify(attempt.data)).not.toContain('synthetic-callback-secret');
    }
    expect(
      (
        await pool.query('SELECT id FROM payment_hub_webhook_events WHERE transaction_id=$1', [
          transactionId,
        ])
      ).rows,
    ).toEqual(eventsBefore.rows);
    expect(
      (await pool.query('SELECT * FROM payment_hub_transactions WHERE id=$1', [transactionId]))
        .rows[0],
    ).toEqual(txBefore);
    expect(
      (await pool.query('SELECT * FROM billing_invoices WHERE id=$1', [invoiceId])).rows[0],
    ).toEqual(invoiceBefore);
    expect(
      (await pool.query('SELECT id FROM billing_payments WHERE invoice_id=$1', [invoiceId])).rows,
    ).toEqual(paymentsBefore.rows);
    expect(
      (
        await call(
          bToken,
          'POST',
          `/api/payment-hub/facility/transactions/${transactionId}/query`,
          { facilityId: facilityB },
        )
      ).status,
    ).toBe(404);
    const other = await call(
      cToken,
      'GET',
      `/api/payment-hub/facility/transactions?facilityId=${facilityC}`,
    );
    expect(other.data.transactions).toEqual([]);
  });
  it('never promotes pending, failed, ambiguous or unavailable results to a payment', async () => {
    for (const code of ['4999', '1032']) {
      queryResult = code;
      const r = await call(
        aToken,
        'POST',
        `/api/payment-hub/facility/transactions/${transactionId}/query`,
        { facilityId: facilityA },
      );
      expect(r.status).toBe(200);
      expect(r.data.status).toBe('PENDING');
    }
    offline = true;
    const fail = await call(
      aToken,
      'POST',
      `/api/payment-hub/facility/transactions/${transactionId}/query`,
      { facilityId: facilityA },
    );
    expect(fail.status).toBe(503);
    expect(JSON.stringify(fail.data)).not.toContain('synthetic network timeout');
    offline = false;
    queryResult = '0';
    const ok = await call(
      aToken,
      'POST',
      `/api/payment-hub/facility/transactions/${transactionId}/query`,
      { facilityId: facilityA },
    );
    expect(ok.data.status).toBe('PROVIDER_CONFIRMED');
    expect(
      (await pool.query('SELECT paid_amount FROM billing_invoices WHERE id=$1', [invoiceId]))
        .rows[0].paid_amount,
    ).toBe('0.00');
    expect(
      (
        await call(
          aToken,
          'POST',
          `/api/payment-hub/facility/transactions/${transactionId}/reconcile`,
          {
            facilityId: facilityA,
            billingPaymentId: 1,
            verifiedReference: 'TS12345678',
            evidenceReference: 'TEST-REVIEW',
            attested: true,
          },
        )
      ).status,
    ).toBe(403);
    queryResult = '1032';
    const conflict = await call(
      aToken,
      'POST',
      `/api/payment-hub/facility/transactions/${transactionId}/query`,
      { facilityId: facilityA },
    );
    expect(conflict.data.status).toBe('REVIEW_REQUIRED');
  });
  it('records ambiguous dispatch once and refuses automatic retries', async () => {
    failPush = true;
    const body = {
      facilityId: facilityA,
      integrationId,
      invoiceId,
      amountKes: '10',
      phone: '254700000002',
      confirmSeparateRequest: true,
    };
    const before = pushCount;
    const r = await call(
      aToken,
      'POST',
      '/api/payment-hub/facility/collections',
      body,
      'synthetic-uncertain',
    );
    expect(r.data.status).toBe('UNKNOWN');
    expect(pushCount).toBe(before + 1);
    const retry = await call(
      aToken,
      'POST',
      '/api/payment-hub/facility/collections',
      body,
      'synthetic-uncertain',
    );
    expect(retry.data.idempotentReplay).toBe(true);
    expect(pushCount).toBe(before + 1);
    failPush = false;
  });
  it('records production approval but cannot bypass the hard production readiness gate', async () => {
    expect(
      (
        await call(
          superToken,
          'PUT',
          `/api/payment-hub/platform/providers/${providerId}/environments/PRODUCTION`,
          { isAvailable: true },
        )
      ).status,
    ).toBe(200);
    const config = await call(
      aToken,
      'POST',
      `/api/payment-hub/facility/providers/${providerId}/integrations`,
      {
        facilityId: facilityA,
        environment: 'PRODUCTION',
        capabilities: ['PAYMENT_COLLECTION', 'PAYMENT_STATUS'],
      },
    );
    expect(config.status).toBe(201);
    productionId = config.data.id;
    const productionSecretName = provision(facilityA, tenantA, productionId, 'PRODUCTION', {
      ...fakeCredentials,
      consumerKey: `${fakeCredentials.consumerKey}-production`,
    });
    const sharedSecret = await call(
      aToken,
      'PUT',
      `/api/payment-hub/facility/integrations/${productionId}/credentials`,
      { facilityId: facilityA, source: 'ENVIRONMENT' },
    );
    expect(sharedSecret).toMatchObject({
      status: 409,
      data: { error: 'CREDENTIAL_ENVIRONMENT_REUSE' },
    });
    expect(
      (
        await pool.query(
          'SELECT count(*)::int AS count FROM facility_payment_secrets WHERE integration_id=$1',
          [productionId],
        )
      ).rows[0].count,
    ).toBe(0);
    process.env[productionSecretName] = JSON.stringify({
      ...fakeCredentials,
      consumerKey: `${fakeCredentials.consumerKey}-production`,
      consumerSecret: `${fakeCredentials.consumerSecret}-production`,
      passkey: `${fakeCredentials.passkey}-production`,
    });
    // A legacy environment reference without component evidence cannot prove separation.
    const sandboxCipher = (
      await pool.query(
        'SELECT encrypted_value FROM facility_payment_secrets WHERE integration_id=$1',
        [integrationId],
      )
    ).rows[0].encrypted_value;
    const sandboxEnvelope = decryptFacilitySecret(
      { tenantId: tenantA, facilityId: facilityA, integrationId },
      sandboxCipher,
    );
    delete sandboxEnvelope._credentialPartFingerprints;
    await pool.query(
      'UPDATE facility_payment_secrets SET encrypted_value=$2 WHERE integration_id=$1',
      [
        integrationId,
        encryptFacilitySecret(
          { tenantId: tenantA, facilityId: facilityA, integrationId },
          sandboxEnvelope,
        ),
      ],
    );
    const needsReview = await call(
      aToken,
      'PUT',
      `/api/payment-hub/facility/integrations/${productionId}/credentials`,
      { facilityId: facilityA, source: 'ENVIRONMENT' },
    );
    expect(needsReview).toMatchObject({
      status: 409,
      data: { error: 'CREDENTIAL_ISOLATION_REVIEW_REQUIRED' },
    });
    await pool.query(
      'UPDATE facility_payment_secrets SET encrypted_value=$2 WHERE integration_id=$1',
      [integrationId, sandboxCipher],
    );
    expect(
      (
        await call(
          aToken,
          'PUT',
          `/api/payment-hub/facility/integrations/${productionId}/credentials`,
          { facilityId: facilityA, source: 'ENVIRONMENT' },
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await call(
          aToken,
          'POST',
          `/api/payment-hub/facility/integrations/${productionId}/accounts`,
          {
            facilityId: facilityA,
            alias: 'Production till',
            accountType: 'MOBILE_MONEY',
            lastFour: '3456',
          },
        )
      ).status,
    ).toBe(201);
    expect(
      (
        await call(
          aToken,
          'POST',
          `/api/payment-hub/facility/integrations/${productionId}/production-request`,
          { facilityId: facilityA },
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await call(
          aToken,
          'POST',
          `/api/payment-hub/platform/integrations/${productionId}/production-decision`,
          { decision: 'APPROVED', approvalReference: 'CONTRACT-TEST' },
        )
      ).status,
    ).toBe(403);
    const approval = await call(
      superToken,
      'POST',
      `/api/payment-hub/platform/integrations/${productionId}/production-decision`,
      { decision: 'APPROVED', approvalReference: 'CONTRACT-TEST' },
    );
    expect(approval.status).toBe(200);
    expect(approval.data.activationBlocked).toBe(true);
    const enable = await call(
      aToken,
      'PUT',
      `/api/payment-hub/facility/integrations/${productionId}/enabled`,
      { facilityId: facilityA, enabled: true },
    );
    expect(enable.status).toBe(403);
    expect(enable.data.error).toBe('PRODUCTION_BLOCKED');
  });
  it('matches only an existing same-facility receipt with explicit evidence; duplicate matches do not create receipts', async () => {
    // This is a synthetic DB fixture representing a provider-confirmed production
    // status. It is NOT a provider sandbox or real transaction test.
    const ref = `TS${Math.floor(Math.random() * 100000000)
      .toString()
      .padStart(8, '0')}`;
    const payment = await recordSettledPayment(
      {
        userId: userA,
        tenantId: tenantA,
        facilityId: facilityA,
        roles: [],
        permissions: ['billing.payments.record'],
        isSuperAdmin: false,
      },
      { invoiceId, amount: '40.00', paymentMethod: 'M-Pesa', transactionCode: ref },
      'Synthetic cashier',
    );
    const t = await pool.query(
      `INSERT INTO payment_hub_transactions(integration_id,tenant_id,facility_id,invoice_id,amount_cents,idempotency_key,request_hash,status,initiated_by_user_id) VALUES($1,$2,$3,$4,4000,$5,'synthetic','PROVIDER_CONFIRMED',$6) RETURNING id`,
      [
        productionId,
        tenantA,
        facilityA,
        invoiceId,
        `local-production-fixture-${randomUUID()}`,
        userA,
      ],
    );
    const id = t.rows[0].id,
      body = {
        facilityId: facilityA,
        billingPaymentId: payment.payment.id,
        verifiedReference: ref,
        evidenceReference: 'SYNTHETIC-STATEMENT',
        attested: true,
      };
    expect(
      (
        await call(bToken, 'POST', `/api/payment-hub/facility/transactions/${id}/reconcile`, {
          ...body,
          facilityId: facilityB,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call(aToken, 'POST', `/api/payment-hub/facility/transactions/${id}/reconcile`, {
          ...body,
          attested: false,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call(aToken, 'POST', `/api/payment-hub/facility/transactions/${id}/reconcile`, {
          ...body,
          verifiedReference: 'WRONG',
        })
      ).status,
    ).toBe(409);
    const matched = await call(
      aToken,
      'POST',
      `/api/payment-hub/facility/transactions/${id}/reconcile`,
      body,
    );
    expect(matched.status).toBe(201);
    expect(matched.data.receiptCreated).toBe(false);
    await expect(
      pool.query('UPDATE payment_hub_reconciliations SET evidence_reference=$1 WHERE id=$2', [
        'TAMPERED',
        matched.data.id,
      ]),
    ).rejects.toThrow();
    await expect(
      pool.query('DELETE FROM payment_hub_reconciliations WHERE id=$1', [matched.data.id]),
    ).rejects.toThrow();
    const otherRef = `TO${randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase()}`;
    const otherPayment = await recordSettledPayment(
      {
        userId: userC,
        tenantId: tenantB,
        facilityId: facilityC,
        roles: [],
        permissions: ['billing.payments.record'],
        isSuperAdmin: false,
      },
      { invoiceId: invoiceC, amount: '40.00', paymentMethod: 'M-Pesa', transactionCode: otherRef },
      'Synthetic other cashier',
    );
    await expect(
      pool.query(
        `INSERT INTO payment_hub_reconciliations(transaction_id,tenant_id,facility_id,billing_payment_id,evidence_reference,matched_by_user_id) VALUES($1,$2,$3,$4,'OTHER',$5)`,
        [id, tenantA, facilityA, otherPayment.payment.id, userA],
      ),
    ).rejects.toThrow();
    expect(
      (await call(aToken, 'POST', `/api/payment-hub/facility/transactions/${id}/reconcile`, body))
        .status,
    ).toBe(409);
    expect(
      (
        await pool.query('SELECT count(*)::int AS n FROM billing_payments WHERE invoice_id=$1', [
          invoiceId,
        ])
      ).rows[0].n,
    ).toBe(1);
    expect(
      (
        await call(
          aToken,
          'POST',
          `/api/payment-hub/facility/reconciliations/${matched.data.id}/void`,
          { facilityId: facilityA, reason: 'WRONG_RECEIPT' },
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await pool.query('SELECT count(*)::int AS n FROM billing_payments WHERE invoice_id=$1', [
          invoiceId,
        ])
      ).rows[0].n,
    ).toBe(1);
    const inv = (
      await pool.query('SELECT paid_amount,balance_amount FROM billing_invoices WHERE id=$1', [
        invoiceId,
      ])
    ).rows[0];
    expect(inv).toEqual({ paid_amount: '40.00', balance_amount: '60.00' });
    await expect(
      pool.query(
        `INSERT INTO payment_hub_transactions(integration_id,tenant_id,facility_id,invoice_id,amount_cents,idempotency_key,request_hash,initiated_by_user_id) VALUES($1,$2,$3,$4,100,'cross-scope','x',$5)`,
        [productionId, tenantA, facilityA, invoiceC, userA],
      ),
    ).rejects.toThrow();
  });
  it('deduplicates concurrent initiation and keeps provider adapter registration fail-closed', async () => {
    const body = {
      facilityId: facilityA,
      integrationId,
      invoiceId,
      amountKes: '5',
      phone: '254700000003',
      confirmSeparateRequest: true,
    };
    const before = pushCount;
    const calls = await Promise.all([
      call(aToken, 'POST', '/api/payment-hub/facility/collections', body, 'synthetic-concurrent'),
      call(aToken, 'POST', '/api/payment-hub/facility/collections', body, 'synthetic-concurrent'),
    ]);
    expect(calls.map((c) => c.data.transactionId)[0]).toBe(
      calls.map((c) => c.data.transactionId)[1],
    );
    expect(pushCount).toBe(before + 1);
    const suffix = randomUUID().slice(0, 8).toUpperCase();
    const created = await call(superToken, 'POST', '/api/payment-hub/platform/providers', {
      code: `TEST_${suffix}`,
      displayName: 'Synthetic provider',
      documentationUrl: 'https://example.test/docs',
      description: 'Synthetic contract not verified',
      adapterKey: 'MPESA_DARAJA',
    });
    expect(created.status).toBe(201);
    const provider = (
      await call(superToken, 'GET', '/api/payment-hub/platform')
    ).data.providers.find((p: any) => p.id === created.data.id);
    expect(provider.adapterKey).toBe('UNCONFIGURED');
    expect(provider.status).toBe('DISABLED');
    expect(provider.adapter.implementedCapabilities).toEqual([]);
  });
  it('rejects the same provider credential in another facility integration', async () => {
    expect(
      (
        await call(
          superToken,
          'PUT',
          `/api/payment-hub/platform/providers/${providerId}/facilities/${facilityB}`,
          { isAllowed: true },
        )
      ).status,
    ).toBe(200);
    const configured = await call(
      bToken,
      'POST',
      `/api/payment-hub/facility/providers/${providerId}/integrations`,
      { facilityId: facilityB, environment: 'SANDBOX', capabilities: ['PAYMENT_COLLECTION'] },
    );
    expect(configured.status).toBe(201);
    provision(facilityB, tenantA, configured.data.id, 'SANDBOX', fakeCredentials);
    const duplicate = await call(
      bToken,
      'PUT',
      `/api/payment-hub/facility/integrations/${configured.data.id}/credentials`,
      { facilityId: facilityB, source: 'ENVIRONMENT' },
    );
    expect(duplicate.status).toBe(409);
    expect(duplicate.data.error).toBe('CREDENTIAL_ALREADY_ASSIGNED');
    expect(
      (
        await call(
          superToken,
          'PUT',
          `/api/payment-hub/platform/providers/${providerId}/facilities/${facilityB}`,
          { isAllowed: false },
        )
      ).status,
    ).toBe(200);
  });
  it('invalidates production approval when facility credentials change', async () => {
    expect(
      (
        await call(
          aToken,
          'PUT',
          `/api/payment-hub/facility/integrations/${productionId}/credentials`,
          { facilityId: facilityA, source: 'ENVIRONMENT' },
        )
      ).status,
    ).toBe(200);
    const row = (
      await pool.query(
        'SELECT production_approval,is_enabled FROM facility_payment_integrations WHERE id=$1',
        [productionId],
      )
    ).rows[0];
    expect(row).toEqual({ production_approval: 'NOT_REQUESTED', is_enabled: false });
  });
  it('enforces global capability restrictions without permitting unsupported operations', async () => {
    const path = `/api/payment-hub/platform/providers/${providerId}/capabilities/PAYMENT_STATUS`;
    expect((await call(aToken, 'PUT', path, { isAllowed: false })).status).toBe(403);
    expect(
      (
        await call(
          superToken,
          'PUT',
          `/api/payment-hub/platform/providers/${providerId}/capabilities/TRANSFER`,
          { isAllowed: true },
        )
      ).status,
    ).toBe(403);
    expect((await call(superToken, 'PUT', path, { isAllowed: false })).status).toBe(200);
    const catalogue = await call(
      aToken,
      'GET',
      `/api/payment-hub/facility/catalogue?facilityId=${facilityA}`,
    );
    const p = catalogue.data.providers.find((item: any) => item.id === providerId);
    expect(p.adapter.implementedCapabilities).not.toContain('PAYMENT_STATUS');
    expect(p.integrations.find((item: any) => item.id === integrationId).isEnabled).toBe(false);
    expect(
      (
        await call(
          aToken,
          'POST',
          `/api/payment-hub/facility/providers/${providerId}/integrations`,
          { facilityId: facilityA, environment: 'SANDBOX', capabilities: ['PAYMENT_STATUS'] },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await call(
          aToken,
          'POST',
          `/api/payment-hub/facility/transactions/${transactionId}/query`,
          { facilityId: facilityA },
        )
      ).status,
    ).toBe(403);
    expect((await call(superToken, 'PUT', path, { isAllowed: true })).status).toBe(200);
    // Re-allowing policy never silently re-enables facility configurations.
    const disabled = (
      await pool.query('SELECT is_enabled FROM facility_payment_integrations WHERE id=$1', [
        integrationId,
      ])
    ).rows[0];
    expect(disabled.is_enabled).toBe(false);
  });
  it('central revocation stops operations without deleting facility history', async () => {
    expect(
      (
        await call(
          superToken,
          'PUT',
          `/api/payment-hub/platform/providers/${providerId}/facilities/${facilityA}`,
          { isAllowed: false },
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await call(
          aToken,
          'POST',
          `/api/payment-hub/facility/integrations/${integrationId}/health`,
          { facilityId: facilityA },
        )
      ).status,
    ).toBe(403);
    const maintenance = await call(
      aToken,
      'GET',
      `/api/payment-hub/facility/catalogue?facilityId=${facilityA}`,
    );
    const restricted = maintenance.data.providers.find(
      (provider: any) => provider.id === providerId,
    );
    expect(restricted.isAllowed).toBe(false);
    expect(restricted.integrations.find((item: any) => item.id === integrationId)).toMatchObject({
      isEffective: false,
      credentialsConfigured: true,
    });
    const delegatedView = await call(
      delegatedToken,
      'GET',
      `/api/payment-hub/facility/catalogue?facilityId=${facilityA}`,
    );
    expect(
      delegatedView.data.providers.find((provider: any) => provider.id === providerId).integrations,
    ).toEqual([]);
    const history = await call(
      aToken,
      'GET',
      `/api/payment-hub/facility/transactions?facilityId=${facilityA}`,
    );
    expect(history.status).toBe(200);
    expect(history.data.transactions.some((t: any) => t.id === transactionId)).toBe(true);
    const events = await pool.query(
      `SELECT details FROM audit_logs WHERE resource LIKE 'payment_hub.%' AND facility_id=$1`,
      [facilityA],
    );
    expect(JSON.stringify(events.rows)).not.toContain(fakeCredentials.consumerSecret);
    expect(superUser).toBeGreaterThan(0);
  });
  it('stores only authenticated, facility-owned sandbox credentials in the encrypted database vault', async () => {
    expect(
      (
        await call(
          superToken,
          'PUT',
          `/api/payment-hub/platform/providers/${providerId}/facilities/${facilityA}`,
          { isAllowed: true },
        )
      ).status,
    ).toBe(200);
    process.env.PAYMENT_HUB_ACTIVE_VAULT_KEY_ID = 'K1';
    process.env.PAYMENT_HUB_VAULT_KEY_K1 = createHash('sha256')
      .update('synthetic integration K1')
      .digest('base64');
    process.env.PAYMENT_HUB_VAULT_KEY_K2 = createHash('sha256')
      .update('synthetic integration K2')
      .digest('base64');
    const path = `/api/payment-hub/facility/integrations/${integrationId}/credentials`;
    const payload = {
      facilityId: facilityA,
      source: 'VAULT',
      credentials: fakeCredentials,
      expiresAt: '2099-01-01T00:00:00.000Z',
    };
    expect((await call(undefined, 'PUT', path, payload)).status).toBe(401);
    expect((await call(clerkToken, 'PUT', path, payload)).status).toBe(403);
    expect((await call(superToken, 'PUT', path, payload)).status).toBe(403);
    expect((await call(bToken, 'PUT', path, { ...payload, facilityId: facilityB })).status).toBe(
      404,
    );
    expect(
      (
        await call(aToken, 'PUT', path, {
          ...payload,
          credentials: { ...fakeCredentials, pin: '1234' },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call(aToken, 'PUT', path, {
          ...payload,
          credentials: { ...fakeCredentials, consumerSecret: '' },
        })
      ).status,
    ).toBe(400);
    expect(
      (await call(aToken, 'PUT', path, { ...payload, expiresAt: '2000-01-01T00:00:00.000Z' }))
        .status,
    ).toBe(400);
    const production = await call(
      aToken,
      'PUT',
      `/api/payment-hub/facility/integrations/${productionId}/credentials`,
      payload,
    );
    expect(production.status).toBe(403);
    expect(production.data.error).toBe('PRODUCTION_BLOCKED');
    const originalNodeEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      const insecure = await call(aToken, 'PUT', path, payload);
      expect(insecure.status).toBe(403);
      expect(insecure.data.error).toBe('HTTPS_REQUIRED');
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
    }
    const saved = await call(aToken, 'PUT', path, payload);
    expect(saved.status).toBe(200);
    const row = (
      await pool.query(
        `SELECT encrypted_value,credential_source,expires_at FROM facility_payment_secrets WHERE integration_id=$1`,
        [integrationId],
      )
    ).rows[0];
    expect(row.credential_source).toBe('VAULT');
    expect(row.encrypted_value.startsWith('v2.K1.')).toBe(true);
    expect(row.expires_at.toISOString()).toBe('2099-01-01T00:00:00.000Z');
    for (const secret of Object.values(fakeCredentials)) {
      expect(row.encrypted_value).not.toContain(secret);
      expect(JSON.stringify(saved.data)).not.toContain(secret);
    }
    expect(
      decryptFacilitySecret(
        { tenantId: tenantA, facilityId: facilityA, integrationId },
        row.encrypted_value,
      ),
    ).toMatchObject(fakeCredentials);
    expect(
      (
        await call(
          superToken,
          'PUT',
          `/api/payment-hub/platform/providers/${providerId}/facilities/${facilityB}`,
          { isAllowed: true },
        )
      ).status,
    ).toBe(200);
    const otherIntegration = (
      await pool.query(
        `SELECT id FROM facility_payment_integrations WHERE provider_id=$1 AND tenant_id=$2 AND facility_id=$3 AND environment='SANDBOX'`,
        [providerId, tenantA, facilityB],
      )
    ).rows[0].id;
    const duplicate = await call(
      bToken,
      'PUT',
      `/api/payment-hub/facility/integrations/${otherIntegration}/credentials`,
      { ...payload, facilityId: facilityB },
    );
    expect(duplicate.status).toBe(409);
    expect(duplicate.data.error).toBe('CREDENTIAL_ALREADY_ASSIGNED');
    expect(
      (
        await call(
          superToken,
          'PUT',
          `/api/payment-hub/platform/providers/${providerId}/facilities/${facilityB}`,
          { isAllowed: false },
        )
      ).status,
    ).toBe(200);
    const catalogue = await call(
      aToken,
      'GET',
      `/api/payment-hub/facility/catalogue?facilityId=${facilityA}`,
    );
    const current = catalogue.data.providers
      .find((p: any) => p.id === providerId)
      .integrations.find((i: any) => i.id === integrationId);
    expect(current).toMatchObject({
      credentialSource: 'VAULT',
      credentialsExpired: false,
      isEnabled: false,
    });
    for (const secret of Object.values(fakeCredentials))
      expect(JSON.stringify(catalogue.data)).not.toContain(secret);
    const healthPath = `/api/payment-hub/facility/integrations/${integrationId}/health`;
    const requestsBeforeTampering = vi.mocked(globalThis.fetch).mock.calls.length;
    await pool.query(
      `UPDATE facility_payment_secrets SET expires_at=NULL WHERE integration_id=$1`,
      [integrationId],
    );
    expect((await call(aToken, 'POST', healthPath, { facilityId: facilityA })).data.error).toBe(
      'SECRET_UNAVAILABLE',
    );
    await pool.query(
      `UPDATE facility_payment_secrets SET expires_at=$2,credential_source='ENVIRONMENT' WHERE integration_id=$1`,
      [integrationId, payload.expiresAt],
    );
    expect((await call(aToken, 'POST', healthPath, { facilityId: facilityA })).data.error).toBe(
      'SECRET_UNAVAILABLE',
    );
    expect(vi.mocked(globalThis.fetch).mock.calls.length).toBe(requestsBeforeTampering);
    await pool.query(
      `UPDATE facility_payment_secrets SET credential_source='VAULT' WHERE integration_id=$1`,
      [integrationId],
    );
    // The new path really supplies the sandbox adapter; it no longer depends on
    // the legacy server credential reference. Transport is mocked only.
    delete process.env[`PAYMENT_HUB_T${tenantA}_F${facilityA}_I${integrationId}_SANDBOX`];
    const health = await call(
      aToken,
      'POST',
      `/api/payment-hub/facility/integrations/${integrationId}/health`,
      { facilityId: facilityA },
    );
    expect(health.status).toBe(200);
    expect(health.data.status).toBe('HEALTHY');
    const mocked = vi.mocked(globalThis.fetch);
    const oauthCalls = mocked.mock.calls.filter(([url]) =>
      String(url).includes('/oauth/v1/generate'),
    );
    const authorization = (oauthCalls.at(-1)?.[1]?.headers as Record<string, string>).Authorization;
    expect(authorization).toBe(
      `Basic ${Buffer.from(`${fakeCredentials.consumerKey}:${fakeCredentials.consumerSecret}`).toString('base64')}`,
    );
    expect(
      (
        await call(
          aToken,
          'PUT',
          `/api/payment-hub/facility/integrations/${integrationId}/enabled`,
          { facilityId: facilityA, enabled: true },
        )
      ).status,
    ).toBe(200);
  });

  it('reencrypts keys, rejects expired credentials and exposes only scoped sanitized configuration audit', async () => {
    const reencrypt = `/api/payment-hub/facility/integrations/${integrationId}/credentials/reencrypt`;
    expect((await call(bToken, 'POST', reencrypt, { facilityId: facilityB })).status).toBe(404);
    expect((await call(clerkToken, 'POST', reencrypt, { facilityId: facilityA })).status).toBe(403);
    process.env.PAYMENT_HUB_ACTIVE_VAULT_KEY_ID = 'K2';
    const rotated = await call(aToken, 'POST', reencrypt, { facilityId: facilityA });
    expect(rotated.status).toBe(200);
    expect(rotated.data.reencrypted).toBe(true);
    const row = (
      await pool.query(
        `SELECT encrypted_value FROM facility_payment_secrets WHERE integration_id=$1`,
        [integrationId],
      )
    ).rows[0];
    expect(row.encrypted_value.startsWith('v2.K2.')).toBe(true);
    delete process.env.PAYMENT_HUB_VAULT_KEY_K1;
    expect(
      decryptFacilitySecret(
        { tenantId: tenantA, facilityId: facilityA, integrationId },
        row.encrypted_value,
      ),
    ).toMatchObject(fakeCredentials);
    const savedKey = process.env.PAYMENT_HUB_VAULT_KEY_K2;
    delete process.env.PAYMENT_HUB_VAULT_KEY_K2;
    const unavailable = await call(
      aToken,
      'POST',
      `/api/payment-hub/facility/integrations/${integrationId}/health`,
      { facilityId: facilityA },
    );
    expect(unavailable.status).toBe(503);
    expect(unavailable.data.error).toBe('SECRET_STORE_UNCONFIGURED');
    process.env.PAYMENT_HUB_VAULT_KEY_K2 = savedKey;
    offline = true;
    const failedHealth = await call(
      aToken,
      'POST',
      `/api/payment-hub/facility/integrations/${integrationId}/health`,
      { facilityId: facilityA },
    );
    expect(failedHealth.data.status).toBe('UNAVAILABLE');
    const blocked = await call(
      aToken,
      'POST',
      '/api/payment-hub/facility/collections',
      {
        facilityId: facilityA,
        integrationId,
        invoiceId,
        amountKes: '5',
        phone: '254700000003',
      },
      'synthetic-offline-health',
    );
    expect(blocked.status).toBe(409);
    expect(blocked.data.error).toBe('HEALTH_CHECK_REQUIRED');
    offline = false;
    expect(
      (
        await call(
          aToken,
          'POST',
          `/api/payment-hub/facility/integrations/${integrationId}/health`,
          { facilityId: facilityA },
        )
      ).data.status,
    ).toBe('HEALTHY');
    await pool.query(
      `UPDATE facility_payment_secrets SET expires_at=now()-interval '1 minute' WHERE integration_id=$1`,
      [integrationId],
    );
    const before = vi.mocked(globalThis.fetch).mock.calls.length;
    const expired = await call(
      aToken,
      'POST',
      `/api/payment-hub/facility/integrations/${integrationId}/health`,
      { facilityId: facilityA },
    );
    expect(expired.status).toBe(409);
    expect(expired.data.error).toBe('CREDENTIALS_EXPIRED');
    expect(vi.mocked(globalThis.fetch).mock.calls.length).toBe(before);
    const catalogue = await call(
      aToken,
      'GET',
      `/api/payment-hub/facility/catalogue?facilityId=${facilityA}`,
    );
    const current = catalogue.data.providers
      .find((p: any) => p.id === providerId)
      .integrations.find((i: any) => i.id === integrationId);
    expect(current).toMatchObject({
      isEnabled: true,
      isEffective: false,
      credentialsExpired: true,
    });
    const auditPath = `/api/payment-hub/facility/configuration-audit?facilityId=${facilityA}`;
    expect((await call(undefined, 'GET', auditPath)).status).toBe(401);
    expect((await call(clerkToken, 'GET', auditPath)).status).toBe(403);
    expect((await call(bToken, 'GET', auditPath)).status).toBe(403);
    const audit = await call(aToken, 'GET', auditPath);
    expect(audit.status).toBe(200);
    expect(
      audit.data.events.some(
        (event: any) => event.action === 'ROTATE_KEY' && event.resourceId === String(integrationId),
      ),
    ).toBe(true);
    expect(audit.data.events.every((event: any) => !('details' in event))).toBe(true);
    for (const secret of Object.values(fakeCredentials))
      expect(JSON.stringify(audit.data)).not.toContain(secret);
    const otherAudit = await call(
      bToken,
      'GET',
      `/api/payment-hub/facility/configuration-audit?facilityId=${facilityB}`,
    );
    expect(otherAudit.status).toBe(200);
    expect(otherAudit.data.events.some((event: any) => event.action === 'ROTATE_KEY')).toBe(false);
    // Rekeying remains possible for facility-owned secrets even when the
    // platform has revoked a provider; it does not reactivate the provider.
    expect(
      (
        await call(
          superToken,
          'PUT',
          `/api/payment-hub/platform/providers/${providerId}/facilities/${facilityA}`,
          { isAllowed: false },
        )
      ).status,
    ).toBe(200);
    expect((await call(aToken, 'POST', reencrypt, { facilityId: facilityA })).status).toBe(200);
    const disabled = await call(
      aToken,
      'POST',
      `/api/payment-hub/facility/integrations/${integrationId}/health`,
      { facilityId: facilityA },
    );
    expect(disabled.status).toBe(403);
  });
  it('audits revocation, blocks tampering and reuse, and requires a distinct credential replacement', async () => {
    const revoke = `/api/payment-hub/facility/integrations/${integrationId}/credentials/revoke`;
    const path = `/api/payment-hub/facility/integrations/${integrationId}/credentials`;
    const health = `/api/payment-hub/facility/integrations/${integrationId}/health`;
    await pool.query(`UPDATE facility_payment_secrets SET expires_at=$2 WHERE integration_id=$1`, [
      integrationId,
      '2099-01-01T00:00:00.000Z',
    ]);
    expect((await call(undefined, 'POST', revoke, { facilityId: facilityA })).status).toBe(401);
    expect((await call(clerkToken, 'POST', revoke, { facilityId: facilityA })).status).toBe(403);
    expect((await call(delegatedToken, 'POST', revoke, { facilityId: facilityA })).status).toBe(
      403,
    );
    expect((await call(bToken, 'POST', revoke, { facilityId: facilityB })).status).toBe(404);
    const before = (
      await pool.query(
        'SELECT count(*)::int AS n FROM audit_logs WHERE facility_id=$1 AND resource=$2 AND action=$3 AND resource_id=$4',
        [facilityA, 'payment_hub.credentials', 'REVOKE', String(integrationId)],
      )
    ).rows[0].n;
    // Revocation remains possible even if the platform has disabled this provider.
    const result = await call(aToken, 'POST', revoke, { facilityId: facilityA });
    expect(result.status).toBe(200);
    expect(result.data).toMatchObject({ revoked: true, alreadyRevoked: false });
    expect(
      (await call(aToken, 'POST', revoke, { facilityId: facilityA })).data.alreadyRevoked,
    ).toBe(true);
    const row = (
      await pool.query(
        `SELECT s.revoked_at,s.encrypted_value,i.is_enabled,i.connection_status FROM facility_payment_secrets s
      JOIN facility_payment_integrations i ON i.id=s.integration_id WHERE s.integration_id=$1`,
        [integrationId],
      )
    ).rows[0];
    expect(row).toMatchObject({ is_enabled: false, connection_status: 'NOT_TESTED' });
    expect(row.revoked_at).toBeInstanceOf(Date);
    expect(
      decryptFacilitySecret(
        { tenantId: tenantA, facilityId: facilityA, integrationId },
        row.encrypted_value,
      )._revokedAt,
    ).toBe(row.revoked_at.toISOString());
    expect(
      (
        await pool.query(
          'SELECT count(*)::int AS n FROM audit_logs WHERE facility_id=$1 AND resource=$2 AND action=$3 AND resource_id=$4',
          [facilityA, 'payment_hub.credentials', 'REVOKE', String(integrationId)],
        )
      ).rows[0].n,
    ).toBe(before + 1);
    for (const secret of Object.values(fakeCredentials))
      expect(JSON.stringify(result.data)).not.toContain(secret);
    expect(
      (
        await call(
          superToken,
          'PUT',
          `/api/payment-hub/platform/providers/${providerId}/facilities/${facilityA}`,
          { isAllowed: true },
        )
      ).status,
    ).toBe(200);
    const callCount = vi.mocked(globalThis.fetch).mock.calls.length;
    expect((await call(aToken, 'POST', health, { facilityId: facilityA })).data.error).toBe(
      'CREDENTIALS_REVOKED',
    );
    await pool.query(
      `UPDATE facility_payment_secrets SET revoked_at=NULL WHERE integration_id=$1`,
      [integrationId],
    );
    expect((await call(aToken, 'POST', health, { facilityId: facilityA })).data.error).toBe(
      'SECRET_UNAVAILABLE',
    );
    expect(vi.mocked(globalThis.fetch).mock.calls.length).toBe(callCount);
    const tamperedReplacement = await call(aToken, 'PUT', path, {
      facilityId: facilityA,
      source: 'VAULT',
      credentials: {
        ...fakeCredentials,
        consumerSecret: 'synthetic-changed',
        passkey: 'synthetic-changed-passkey',
      },
      expiresAt: '2099-01-01T00:00:00.000Z',
    });
    expect(tamperedReplacement).toMatchObject({
      status: 503,
      data: { error: 'SECRET_UNAVAILABLE' },
    });
    await pool.query(`UPDATE facility_payment_secrets SET revoked_at=$2 WHERE integration_id=$1`, [
      integrationId,
      row.revoked_at,
    ]);
    const same = await call(aToken, 'PUT', path, {
      facilityId: facilityA,
      source: 'VAULT',
      credentials: fakeCredentials,
      expiresAt: '2099-01-01T00:00:00.000Z',
    });
    expect(same.status).toBe(409);
    expect(same.data.error).toBe('REVOKED_CREDENTIAL_REUSE');
    for (const partial of [
      { ...fakeCredentials, consumerSecret: `${fakeCredentials.consumerSecret}-rotated` },
      { ...fakeCredentials, passkey: `${fakeCredentials.passkey}-rotated` },
      { ...fakeCredentials, shortcode: '999999' },
    ]) {
      const rejected = await call(aToken, 'PUT', path, {
        facilityId: facilityA,
        source: 'VAULT',
        credentials: partial,
        expiresAt: '2099-01-01T00:00:00.000Z',
      });
      expect(rejected).toMatchObject({ status: 409, data: { error: 'REVOKED_CREDENTIAL_REUSE' } });
    }
    const replacement = {
      ...fakeCredentials,
      consumerSecret: `${fakeCredentials.consumerSecret}-rotated`,
      passkey: `${fakeCredentials.passkey}-rotated`,
    };
    const saved = await call(aToken, 'PUT', path, {
      facilityId: facilityA,
      source: 'VAULT',
      credentials: replacement,
      expiresAt: '2099-01-01T00:00:00.000Z',
    });
    expect(saved.status).toBe(200);
    expect(JSON.stringify(saved.data)).not.toContain(replacement.consumerSecret);
    const historicalReuse = await call(aToken, 'PUT', path, {
      facilityId: facilityA,
      source: 'VAULT',
      credentials: fakeCredentials,
      expiresAt: '2099-01-01T00:00:00.000Z',
    });
    expect(historicalReuse).toMatchObject({
      status: 409,
      data: { error: 'REVOKED_CREDENTIAL_REUSE' },
    });
    const newRow = (
      await pool.query(
        `SELECT s.revoked_at,s.encrypted_value,i.is_enabled,i.connection_status FROM facility_payment_secrets s
      JOIN facility_payment_integrations i ON i.id=s.integration_id WHERE s.integration_id=$1`,
        [integrationId],
      )
    ).rows[0];
    expect(newRow).toMatchObject({
      revoked_at: null,
      is_enabled: false,
      connection_status: 'NOT_TESTED',
    });
    expect(newRow.encrypted_value).not.toContain(replacement.consumerSecret);
    expect(
      decryptFacilitySecret(
        { tenantId: tenantA, facilityId: facilityA, integrationId },
        newRow.encrypted_value,
      ),
    ).toMatchObject(replacement);
  });
  it('retains revoked server-reference component fingerprints across replacements', async () => {
    const name = `PAYMENT_HUB_T${tenantA}_F${facilityA}_I${productionId}_PRODUCTION`;
    const original = JSON.parse(process.env[name]!);
    const path = `/api/payment-hub/facility/integrations/${productionId}/credentials`;
    const revoke = await call(aToken, 'POST', `${path}/revoke`, { facilityId: facilityA });
    expect(revoke.status).toBe(200);
    const unchanged = await call(aToken, 'PUT', path, {
      facilityId: facilityA,
      source: 'ENVIRONMENT',
    });
    expect(unchanged).toMatchObject({ status: 409, data: { error: 'REVOKED_CREDENTIAL_REUSE' } });
    process.env[name] = JSON.stringify({
      ...original,
      consumerSecret: `${original.consumerSecret}-rotated`,
    });
    expect(
      (await call(aToken, 'PUT', path, { facilityId: facilityA, source: 'ENVIRONMENT' })).data
        .error,
    ).toBe('REVOKED_CREDENTIAL_REUSE');
    process.env[name] = JSON.stringify({
      ...original,
      consumerSecret: `${original.consumerSecret}-rotated`,
      passkey: `${original.passkey}-rotated`,
    });
    expect(
      (await call(aToken, 'PUT', path, { facilityId: facilityA, source: 'ENVIRONMENT' })).status,
    ).toBe(200);
    process.env[name] = JSON.stringify(original);
    expect(
      (await call(aToken, 'PUT', path, { facilityId: facilityA, source: 'ENVIRONMENT' })).data
        .error,
    ).toBe('REVOKED_CREDENTIAL_REUSE');
    const row = (
      await pool.query(
        'SELECT encrypted_value FROM facility_payment_secrets WHERE integration_id=$1',
        [productionId],
      )
    ).rows[0];
    for (const value of Object.values(original) as string[])
      expect(row.encrypted_value).not.toContain(value);
  });
});
