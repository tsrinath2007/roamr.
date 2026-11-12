import path from 'path';
import readline from 'readline';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const BASE_URL = (process.env.PAYPAL_BASE_URL || 'https://api-m.sandbox.paypal.com').replace(/\/+$/, '');
const CLIENT_ID = (process.env.PAYPAL_CLIENT_ID || '').trim();
const CLIENT_SECRET = (process.env.PAYPAL_CLIENT_SECRET || '').trim();
const BUSINESS_EMAIL = (process.env.PAYPAL_BUSINESS_EMAIL || '').trim();
const TEST_PAYOUT_EMAIL = (process.env.PAYPAL_TEST_PAYOUT_EMAIL || '').trim();

function logSection(title: string) {
  console.log(`\n==================== ${title} ====================`);
}

function waitForEnter(promptText: string): Promise<void> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(promptText, () => {
      rl.close();
      resolve();
    });
  });
}

function explainPayoutFailure(status: number, body: any): string {
  const name = String(body?.name || '');
  const message = String(body?.message || '');
  const combined = `${name} ${message}`.toLowerCase();

  if (
    status === 401 ||
    status === 403 ||
    combined.includes('payout_not_available') ||
    combined.includes('not allowed to send') ||
    combined.includes('authorization') ||
    combined.includes('permission') ||
    combined.includes('not enabled')
  ) {
    return (
      `Reason category: PERMISSION / ACCOUNT ELIGIBILITY (${name || `HTTP ${status}`}). ` +
      `PayPal rejected the payout request because either PayPal Payouts API is disabled for this Sandbox account/country (${message}) or the client app lacks Payouts scope.`
    );
  }

  if (combined.includes('insufficient_funds') || combined.includes('insufficient balance')) {
    return (
      `Reason category: FUNDS (${name || `HTTP ${status}`}). ` +
      `The sandbox sender account does not have enough USD balance to fund the $0.10 payout (${message}).`
    );
  }

  if (combined.includes('currency') || combined.includes('unsupported_currency')) {
    return (
      `Reason category: CURRENCY (${name || `HTTP ${status}`}). ` +
      `PayPal rejected USD payout currency for this sender/receiver account configuration (${message}).`
    );
  }

  return `Reason category: OTHER (${name || `HTTP ${status}`}) — ${message || 'See raw response above.'}`;
}

async function main() {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error('ERROR: PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET must be set in server/.env');
    process.exit(1);
  }

  console.log('PayPal Smoke Test Configuration:');
  console.log('  PAYPAL_BASE_URL        :', BASE_URL);
  console.log('  PAYPAL_BUSINESS_EMAIL  :', BUSINESS_EMAIL || '(unset — omitting payee override)');
  console.log('  PAYPAL_TEST_PAYOUT_EMAIL:', TEST_PAYOUT_EMAIL || '(unset — using fallback sb-traveler@personal.example.com)');

  // (1) Fetch OAuth Token
  logSection('STEP 1: OAUTH TOKEN');
  const oauthUrl = `${BASE_URL}/v1/oauth2/token`;
  const oauthBody = 'grant_type=client_credentials';
  console.log('REQUEST:', { method: 'POST', url: oauthUrl, body: oauthBody });

  const authHeader = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const oauthRes = await fetch(oauthUrl, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${authHeader}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: oauthBody,
  });
  const oauthData: any = await oauthRes.json();
  const sanitizedOauth = {
    ...oauthData,
    access_token: oauthData.access_token ? `${String(oauthData.access_token).slice(0, 14)}...<redacted>` : undefined,
  };
  console.log('RESPONSE STATUS:', oauthRes.status, 'debug_id:', oauthRes.headers.get('paypal-debug-id'));
  console.log('RESPONSE BODY:', JSON.stringify(sanitizedOauth, null, 2));

  if (!oauthRes.ok || !oauthData.access_token) {
    throw new Error(`OAuth failed with HTTP ${oauthRes.status}`);
  }
  const accessToken = String(oauthData.access_token);

  // (2) Create $1.00 USD Order
  logSection('STEP 2: CREATE $1.00 USD ORDER');
  const createUrl = `${BASE_URL}/v2/checkout/orders`;
  const purchaseUnit: any = {
    reference_id: `smoke-${Date.now()}`,
    description: 'ROAMR Prompt 0 PayPal Smoke Test Order',
    amount: {
      currency_code: 'USD',
      value: '1.00',
    },
  };
  if (BUSINESS_EMAIL) {
    purchaseUnit.payee = { email_address: BUSINESS_EMAIL };
  }

  const createPayload = {
    intent: 'CAPTURE',
    purchase_units: [purchaseUnit],
    application_context: {
      brand_name: 'ROAMR Smoke Test',
      user_action: 'PAY_NOW',
      return_url: 'https://example.com/paypal-return',
      cancel_url: 'https://example.com/paypal-cancel',
    },
  };

  console.log('REQUEST:', JSON.stringify({ method: 'POST', url: createUrl, body: createPayload }, null, 2));
  const createRes = await fetch(createUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(createPayload),
  });
  const createData: any = await createRes.json();
  console.log('RESPONSE STATUS:', createRes.status, 'debug_id:', createRes.headers.get('paypal-debug-id'));
  console.log('RESPONSE BODY:', JSON.stringify(createData, null, 2));

  if (!createRes.ok || !createData.id) {
    throw new Error(`Create Order failed with HTTP ${createRes.status}`);
  }

  const orderId = String(createData.id);
  const approveUrl =
    (createData.links || []).find((l: any) => l.rel === 'approve')?.href ||
    `https://www.sandbox.paypal.com/checkoutnow?token=${encodeURIComponent(orderId)}`;

  // (3) Print approval link, wait for Enter, then capture
  logSection('STEP 3: APPROVE IN SANDBOX & CAPTURE');
  console.log('Approval Link (open in browser and approve with Sandbox Personal account):');
  console.log(approveUrl);

  await waitForEnter('\nPress Enter AFTER you approve the order in PayPal Sandbox... ');

  const captureUrl = `${BASE_URL}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`;
  console.log('REQUEST:', { method: 'POST', url: captureUrl, body: {} });
  const captureRes = await fetch(captureUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });
  const captureData: any = await captureRes.json().catch(() => ({}));
  console.log('RESPONSE STATUS:', captureRes.status, 'debug_id:', captureRes.headers.get('paypal-debug-id'));
  console.log('RESPONSE BODY:', JSON.stringify(captureData, null, 2));
  console.log('Capture Order Status:', captureData?.status || captureData?.name || `HTTP ${captureRes.status}`);

  // (4) Attempt $0.10 USD Payout
  logSection('STEP 4: ATTEMPT $0.10 USD PAYOUT');
  const receiverEmail = TEST_PAYOUT_EMAIL || 'sb-traveler@personal.example.com';
  const payoutUrl = `${BASE_URL}/v1/payments/payouts`;
  const payoutPayload = {
    sender_batch_header: {
      sender_batch_id: `roamr-smoke-${Date.now()}`,
      email_subject: 'ROAMR Smoke Test Payout',
      email_message: 'PayPal Sandbox $0.10 payout test from ROAMR.',
    },
    items: [
      {
        recipient_type: 'EMAIL',
        amount: {
          value: '0.10',
          currency: 'USD',
        },
        note: 'ROAMR smoke test payout',
        sender_item_id: `smoke-item-${Date.now()}`,
        receiver: receiverEmail,
      },
    ],
  };

  console.log('REQUEST:', JSON.stringify({ method: 'POST', url: payoutUrl, body: payoutPayload }, null, 2));
  const payoutRes = await fetch(payoutUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payoutPayload),
  });
  const payoutData: any = await payoutRes.json().catch(() => ({}));
  console.log('RESPONSE STATUS:', payoutRes.status, 'debug_id:', payoutRes.headers.get('paypal-debug-id'));
  console.log('RESPONSE BODY:', JSON.stringify(payoutData, null, 2));

  if (!payoutRes.ok) {
    console.log('\nPAYOUT FAILURE EXPLANATION:');
    console.log(explainPayoutFailure(payoutRes.status, payoutData));
  } else {
    console.log('\nPAYOUT SUCCEEDED! Batch ID:', payoutData?.batch_header?.payout_batch_id);
  }
}

main().catch((err) => {
  console.error('\nSMOKE TEST ERROR:', err);
  process.exit(1);
});
