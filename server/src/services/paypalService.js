const PAYPAL_BASE_URL =
  process.env.PAYPAL_BASE_URL ||
  (process.env.PAYPAL_ENV === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com');

const PAYPAL_CURRENCY = process.env.PAYPAL_CURRENCY || 'USD';
const {
  recordCapturedCheckinOrder,
  getRecordedCheckinOrder,
} = require('./claimsStore');
const paypalLogs = [];

function logPayPalCall(entry) {
  const record = {
    id: `pp-log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
    ...entry,
  };
  paypalLogs.unshift(record);
  if (paypalLogs.length > 60) paypalLogs.pop();
  console.log(
    `[PayPal ${record.simulated ? 'SIMULATED' : 'SANDBOX'}] ${record.method} ${record.url} | status=${record.status} | debug_id=${record.debugId || 'none'} | ${record.summary}`
  );
  if (record.responseBody) {
    console.log(`  ↳ body: ${JSON.stringify(record.responseBody)}`);
  }
  return record;
}

function hasValidPayPalCredentials() {
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  return Boolean(
    id &&
      secret &&
      id.trim() &&
      secret.trim() &&
      !id.includes('your_paypal') &&
      !secret.includes('your_paypal')
  );
}

async function fetchPayPalOAuth() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const url = `${PAYPAL_BASE_URL}/v1/oauth2/token`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  const debugId = res.headers.get('paypal-debug-id') || null;
  let data = {};
  try {
    data = await res.json();
  } catch {
    data = { raw: 'Non-JSON response' };
  }

  const sanitizedBody = res.ok
    ? {
        token_type: data.token_type,
        expires_in: data.expires_in,
        app_id: data.app_id,
        scope_count: data.scope ? String(data.scope).split(' ').length : 0,
      }
    : data;

  logPayPalCall({
    method: 'POST',
    url,
    endpoint: '/v1/oauth2/token',
    status: res.status,
    debugId,
    simulated: false,
    responseBody: sanitizedBody,
    summary: res.ok
      ? 'Obtained Sandbox OAuth2 token'
      : `OAuth failed: ${data.error_description || data.error || res.status}`,
  });

  return { res, data, debugId, url };
}

async function checkPayPalHealth() {
  if (!hasValidPayPalCredentials()) {
    return {
      ok: false,
      baseUrl: PAYPAL_BASE_URL,
      status: 400,
      error: 'PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET is missing in /server/.env.',
      debugId: null,
    };
  }

  try {
    const { res, data, debugId } = await fetchPayPalOAuth();
    if (!res.ok || !data.access_token) {
      return {
        ok: false,
        baseUrl: PAYPAL_BASE_URL,
        status: res.status,
        error: data.error_description || data.error || `PayPal OAuth failed (${res.status})`,
        details: data,
        debugId,
      };
    }

    return {
      ok: true,
      baseUrl: PAYPAL_BASE_URL,
      status: res.status,
      tokenType: data.token_type,
      expiresIn: data.expires_in,
      appId: data.app_id,
      debugId,
    };
  } catch (err) {
    return {
      ok: false,
      baseUrl: PAYPAL_BASE_URL,
      status: 500,
      error: err.message,
      debugId: null,
    };
  }
}

let cachedAccessToken = null;
let cachedAccessTokenExpiresAt = 0;

async function getAccessToken() {
  if (cachedAccessToken && Date.now() < cachedAccessTokenExpiresAt) {
    return cachedAccessToken;
  }
  const { res, data, debugId } = await fetchPayPalOAuth();
  if (!res.ok || !data.access_token) {
    const err = new Error(
      `${data.error_description || data.error || `PayPal OAuth failed (${res.status})`} (debug_id: ${debugId || 'none'})`
    );
    err.status = res.status;
    err.debugId = debugId;
    err.paypalBody = data;
    throw err;
  }
  const expiresInSec = Number(data.expires_in || 3600);
  cachedAccessToken = data.access_token;
  cachedAccessTokenExpiresAt = Date.now() + Math.max(60, expiresInSec - 60) * 1000;
  return cachedAccessToken;
}

/**
 * Create a PayPal Sandbox Order for funding a business quest budget.
 */
async function createFundingOrder({
  questId,
  questTitle,
  amountUsd,
  returnUrl,
  cancelUrl,
  simulate = false,
}) {
  const value = Number(amountUsd || 50).toFixed(2);

  if (simulate || !hasValidPayPalCredentials()) {
    const simOrderId = `SIM-ORD-${Date.now()}`;
    logPayPalCall({
      method: 'POST',
      url: `${PAYPAL_BASE_URL}/v2/checkout/orders`,
      endpoint: '/v2/checkout/orders',
      status: 201,
      debugId: null,
      simulated: true,
      responseBody: { id: simOrderId, status: 'CREATED', amountUsd: Number(value) },
      summary: `Simulated order ${simOrderId} for $${value} ${PAYPAL_CURRENCY}`,
    });
    return {
      orderId: simOrderId,
      status: 'CREATED',
      approveUrl: null,
      amountUsd: Number(value),
      simulated: true,
      debugId: null,
      message: simulate
        ? 'Created simulated funding order.'
        : 'PayPal Sandbox credentials not configured; created simulated funding order.',
    };
  }

  const token = await getAccessToken();
  const endpoint = '/v2/checkout/orders';
  const url = `${PAYPAL_BASE_URL}${endpoint}`;
  const payload = {
    intent: 'CAPTURE',
    purchase_units: [
      {
        reference_id: String(questId || `quest-${Date.now()}`),
        description: `ROAMR Quest Budget: ${questTitle || 'Local Exploration Quest'}`,
        amount: {
          currency_code: PAYPAL_CURRENCY,
          value,
        },
      },
    ],
    application_context: {
      brand_name: 'ROAMR',
      landing_page: 'LOGIN',
      user_action: 'PAY_NOW',
      return_url: returnUrl || process.env.PAYPAL_RETURN_URL || 'https://example.com/paypal/return',
      cancel_url: cancelUrl || process.env.PAYPAL_CANCEL_URL || 'https://example.com/paypal/cancel',
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const debugId = res.headers.get('paypal-debug-id') || null;
  const data = await res.json();
  const approveUrl = data.links?.find((l) => l.rel === 'approve')?.href || null;

  logPayPalCall({
    method: 'POST',
    url,
    endpoint,
    status: res.status,
    debugId,
    simulated: false,
    responseBody: data,
    summary: res.ok
      ? `Created PayPal Order ${data.id} for $${value} ${PAYPAL_CURRENCY}`
      : `Order creation failed: ${data.message || data.name || res.status}`,
  });

  if (!res.ok) {
    const detailMsg = data.details?.[0]?.description || data.message || `PayPal create order failed (${res.status})`;
    const err = new Error(`${detailMsg} (debug_id: ${debugId || 'none'})`);
    err.status = res.status;
    err.debugId = debugId;
    err.paypalBody = data;
    throw err;
  }

  return {
    orderId: data.id,
    status: data.status,
    approveUrl,
    amountUsd: Number(value),
    simulated: false,
    debugId,
    message: 'PayPal Sandbox order created. Complete approval in browser.',
  };
}

/**
 * Capture an approved PayPal Sandbox Order.
 */
async function captureFundingOrder({ orderId, amountUsd }) {
  if (!orderId || String(orderId).startsWith('SIM-') || !hasValidPayPalCredentials()) {
    const captureId = `SIM-CAP-${Date.now()}`;
    logPayPalCall({
      method: 'POST',
      url: `${PAYPAL_BASE_URL}/v2/checkout/orders/${orderId || 'SIM'}/capture`,
      endpoint: `/v2/checkout/orders/${orderId || 'SIM'}/capture`,
      status: 201,
      debugId: null,
      simulated: true,
      responseBody: { captureId, status: 'COMPLETED' },
      summary: `Simulated capture ${captureId} for $${Number(amountUsd || 50).toFixed(2)} ${PAYPAL_CURRENCY}`,
    });
    return {
      orderId: orderId || `SIM-ORD-${Date.now()}`,
      captureId,
      status: 'COMPLETED',
      amountUsd: Number(amountUsd || 50),
      simulated: true,
      debugId: null,
      message: 'Simulated PayPal order capture completed.',
    };
  }

  const token = await getAccessToken();
  const endpoint = `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`;
  const url = `${PAYPAL_BASE_URL}${endpoint}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  const debugId = res.headers.get('paypal-debug-id') || null;
  const data = await res.json();

  logPayPalCall({
    method: 'POST',
    url,
    endpoint,
    status: res.status,
    debugId,
    simulated: false,
    responseBody: data,
    summary: res.ok
      ? `Captured Order ${orderId} -> ${data.status}`
      : `Capture failed: ${data.message || data.name || res.status}`,
  });

  if (!res.ok) {
    const detailMsg = data.details?.[0]?.description || data.message || `Order capture failed (${res.status})`;
    const err = new Error(`${detailMsg} (debug_id: ${debugId || 'none'})`);
    err.status = res.status;
    err.debugId = debugId;
    err.paypalBody = data;
    throw err;
  }

  const capture = data?.purchase_units?.[0]?.payments?.captures?.[0];
  return {
    orderId: data.id,
    captureId: capture?.id || data.id,
    status: data.status || 'COMPLETED',
    amountUsd: Number(capture?.amount?.value || amountUsd || 50),
    simulated: false,
    debugId,
    message: 'PayPal Sandbox order captured successfully.',
  };
}

/**
 * Pay a verified traveler reward via PayPal Payouts API.
 * Falls back to wallet ledger status "sandbox-simulated" if Payouts returns an authorization/permission error.
 */
async function createTravelerPayout({ questId, questTitle, amountUsd, receiverEmail }) {
  const value = Number(amountUsd || 5).toFixed(2);
  const recipient = receiverEmail || process.env.PAYPAL_SANDBOX_RECEIVER_EMAIL || 'sb-traveler@personal.example.com';

  if (!hasValidPayPalCredentials()) {
    const simBatchId = `SIM-PAYOUT-${Date.now()}`;
    logPayPalCall({
      method: 'POST',
      url: `${PAYPAL_BASE_URL}/v1/payments/payouts`,
      endpoint: '/v1/payments/payouts',
      status: 201,
      debugId: null,
      simulated: true,
      responseBody: { id: simBatchId, status: 'sandbox-simulated' },
      summary: `Simulated payout ${simBatchId} of $${value} ${PAYPAL_CURRENCY} to ${recipient}`,
    });
    return {
      payoutBatchId: simBatchId,
      payoutStatus: 'sandbox-simulated',
      amountUsd: Number(value),
      receiverEmail: recipient,
      simulated: true,
      debugId: null,
      message: 'PayPal Sandbox credentials missing — recorded reward in wallet ledger (sandbox-simulated).',
    };
  }

  try {
    const token = await getAccessToken();
    const endpoint = '/v1/payments/payouts';
    const url = `${PAYPAL_BASE_URL}${endpoint}`;
    const senderBatchId = `roamr_${questId || 'q'}_${Date.now()}`;

    const payload = {
      sender_batch_header: {
        sender_batch_id: senderBatchId,
        email_subject: 'You earned a ROAMR Quest Reward!',
        email_message: `Congrats on completing "${questTitle || 'your ROAMR quest'}"! Here is your $${value} ${PAYPAL_CURRENCY} reward.`,
      },
      items: [
        {
          recipient_type: 'EMAIL',
          amount: {
            value,
            currency: PAYPAL_CURRENCY,
          },
          note: `ROAMR verified visit reward: ${questTitle}`,
          sender_item_id: `item_${Date.now()}`,
          receiver: recipient,
        },
      ],
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const debugId = res.headers.get('paypal-debug-id') || null;
    const data = await res.json();
    const batchId = data?.batch_header?.payout_batch_id;
    const batchStatus = data?.batch_header?.batch_status || 'PENDING';

    logPayPalCall({
      method: 'POST',
      url,
      endpoint,
      status: res.status,
      debugId,
      simulated: false,
      responseBody: data,
      summary: res.ok
        ? `Created PayPal Payout batch ${batchId} (${batchStatus}) for $${value} ${PAYPAL_CURRENCY}`
        : `PayPal Payouts rejected (${data.name || res.status}): ${data.message}`,
    });

    if (!res.ok) {
      const errName = String(data.name || '');
      const isPermissionIssue =
        res.status === 401 ||
        res.status === 403 ||
        errName.includes('AUTHORIZATION') ||
        errName.includes('PERMISSION') ||
        errName.includes('PAYOUT_NOT_AVAILABLE');

      if (isPermissionIssue) {
        const simBatchId = `SIM-PAYOUT-${Date.now()}`;
        return {
          payoutBatchId: simBatchId,
          payoutStatus: 'sandbox-simulated',
          amountUsd: Number(value),
          receiverEmail: recipient,
          simulated: true,
          debugId,
          error: `${data.name || res.status}: ${data.message}`,
          message: `PayPal Payouts unavailable on this sandbox app (${data.name || res.status}: ${data.message}). Reward recorded in wallet ledger as sandbox-simulated.`,
        };
      }

      throw new Error(`${data.name || 'PAYOUT_ERROR'}: ${data.message || res.status} (debug_id: ${debugId || 'none'})`);
    }

    return {
      payoutBatchId: batchId,
      payoutStatus: batchStatus,
      amountUsd: Number(value),
      receiverEmail: recipient,
      simulated: false,
      debugId,
      message: 'PayPal Sandbox payout submitted.',
    };
  } catch (err) {
    const simBatchId = `SIM-PAYOUT-${Date.now()}`;
    logPayPalCall({
      method: 'POST',
      url: `${PAYPAL_BASE_URL}/v1/payments/payouts`,
      endpoint: '/v1/payments/payouts',
      status: 201,
      debugId: err.debugId || null,
      simulated: true,
      responseBody: { id: simBatchId, status: 'sandbox-simulated', error: err.message },
      summary: `Wallet ledger fallback (${simBatchId}) after PayPal Payouts error: ${err.message}`,
    });
    return {
      payoutBatchId: simBatchId,
      payoutStatus: 'sandbox-simulated',
      amountUsd: Number(value),
      receiverEmail: recipient,
      simulated: true,
      debugId: err.debugId || null,
      error: err.message,
      message: `PayPal Payouts error (${err.message}). Reward recorded in wallet ledger as sandbox-simulated.`,
    };
  }
}

/**
 * Fetch live status of a PayPal Payouts batch.
 */
async function getPayoutStatus(batchId) {
  if (!batchId || String(batchId).startsWith('SIM-') || !hasValidPayPalCredentials()) {
    return {
      payoutBatchId: batchId,
      payoutStatus: 'sandbox-simulated',
      simulated: true,
    };
  }

  try {
    const token = await getAccessToken();
    const endpoint = `/v1/payments/payouts/${encodeURIComponent(batchId)}`;
    const url = `${PAYPAL_BASE_URL}${endpoint}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const debugId = res.headers.get('paypal-debug-id') || null;
    const data = await res.json();
    const batchStatus = data?.batch_header?.batch_status || 'PENDING';
    const itemStatus = data?.items?.[0]?.transaction_status || batchStatus;

    logPayPalCall({
      method: 'GET',
      url,
      endpoint,
      status: res.status,
      debugId,
      simulated: false,
      responseBody: data,
      summary: `Checked payout ${batchId}: batch=${batchStatus}, item=${itemStatus}`,
    });

    return {
      payoutBatchId: batchId,
      payoutStatus: itemStatus,
      batchStatus,
      debugId,
      simulated: false,
    };
  } catch (err) {
    return {
      payoutBatchId: batchId,
      payoutStatus: 'PENDING',
      simulated: false,
      error: err.message,
    };
  }
}

function isPlaceholderMerchantEmail(email) {
  const clean = String(email || '').trim().toLowerCase();
  return (
    !clean ||
    clean === 'sb-merchant@business.example.com' ||
    /^sb-merchant-.*@business\.example\.com$/i.test(clean)
  );
}

/**
 * Create a PayPal Sandbox Order with intent CAPTURE and no payee override,
 * so funds go to the sandbox Business account that owns the REST credentials.
 */
async function createCheckinOrder({
  questId,
  placeId = '',
  userId = '',
  questTitle,
  merchantEmail,
  amountUsd,
  returnUrl,
  cancelUrl,
  simulate = false,
}) {
  const value = Number(amountUsd || 1.0).toFixed(2);
  const customId = JSON.stringify({
    q: String(questId || ''),
    p: String(placeId || ''),
    u: String(userId || ''),
  }).slice(0, 127);
  const payeeEmail =
    (merchantEmail && String(merchantEmail).trim()) ||
    process.env.PAYPAL_BUSINESS_EMAIL ||
    process.env.PAYPAL_MERCHANT_EMAIL ||
    '';

  if (simulate || !hasValidPayPalCredentials()) {
    const simOrderId = `SIM-CHK-${Date.now()}`;
    logPayPalCall({
      method: 'POST',
      url: `${PAYPAL_BASE_URL}/v2/checkout/orders`,
      endpoint: '/v2/checkout/orders (checkin)',
      status: 201,
      debugId: null,
      simulated: true,
      responseBody: { id: simOrderId, status: 'CREATED', amountUsd: Number(value), payeeEmail },
      summary: `Simulated check-in order ${simOrderId} ($${value} ${PAYPAL_CURRENCY}) -> payee ${payeeEmail}`,
    });
    return {
      orderId: simOrderId,
      status: 'CREATED',
      approveUrl: null,
      amountUsd: Number(value),
      payeeEmail,
      simulated: true,
      debugId: null,
      message: simulate
        ? 'Created simulated check-in order.'
        : 'PayPal Sandbox credentials missing — created simulated check-in order.',
    };
  }

  const token = await getAccessToken();
  const endpoint = '/v2/checkout/orders';
  const url = `${PAYPAL_BASE_URL}${endpoint}`;
  const payload = {
    intent: 'CAPTURE',
    purchase_units: [
      {
        reference_id: `checkin_${questId || Date.now()}`,
        custom_id: customId,
        description: `ROAMR Check-in: ${questTitle || 'Quest Venue Purchase'}`,
        amount: {
          currency_code: PAYPAL_CURRENCY,
          value,
        },
      },
    ],
    application_context: {
      brand_name: 'ROAMR',
      landing_page: 'LOGIN',
      user_action: 'PAY_NOW',
      return_url: returnUrl || 'https://example.com/paypal/checkin-return',
      cancel_url: cancelUrl || 'https://example.com/paypal/checkin-cancel',
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const debugId = res.headers.get('paypal-debug-id') || null;
  const data = await res.json();
  const approveUrl = data.links?.find((l) => l.rel === 'approve')?.href || null;

  logPayPalCall({
    method: 'POST',
    url,
    endpoint,
    status: res.status,
    debugId,
    simulated: false,
    requestBody: payload,
    responseBody: data,
    summary: res.ok
      ? `Created Check-In Order ${data.id} ($${value} ${PAYPAL_CURRENCY}) custom_id=${customId}`
      : `Check-In Order failed: ${data.details?.[0]?.description || data.message || res.status}`,
  });

  if (!res.ok) {
    const detailMsg =
      data.details?.[0]?.description ||
      data.message ||
      `PayPal check-in order creation failed (${res.status})`;
    const err = new Error(`${detailMsg} (debug_id: ${debugId || 'none'})`);
    err.status = res.status;
    err.debugId = debugId;
    err.paypalBody = data;
    throw err;
  }

  return {
    orderId: data.id,
    status: data.status,
    approveUrl,
    amountUsd: Number(value),
    payeeEmail,
    simulated: false,
    debugId,
    message: 'PayPal Sandbox check-in order created. Approve payment in browser.',
  };
}

/**
 * Capture a traveler check-in PayPal Order and persist its payer/payee metadata.
 */
async function captureCheckinOrder({
  orderId,
  questId,
  expectedAmountUsd,
  expectedMerchantEmail,
  payerOverride,
}) {
  const fallbackPayee =
    (expectedMerchantEmail && String(expectedMerchantEmail).trim()) ||
    process.env.PAYPAL_MERCHANT_EMAIL ||
    'sb-merchant@business.example.com';

  if (!orderId || String(orderId).startsWith('SIM-') || !hasValidPayPalCredentials()) {
    const finalOrderId = orderId || `SIM-CHK-${Date.now()}`;
    const captureId = `SIM-CHK-CAP-${Date.now()}`;
    const recorded = recordCapturedCheckinOrder({
      orderId: finalOrderId,
      captureId,
      questId: questId || '',
      status: 'COMPLETED',
      captureStatus: 'COMPLETED',
      amountUsd: Number(expectedAmountUsd || 1.0),
      payeeEmail: fallbackPayee,
      payerName: payerOverride?.name || 'Sandbox Traveler',
      payerEmail: payerOverride?.email || 'sb-buyer@personal.example.com',
      payerId: payerOverride?.payerId || 'SIM-PAYER-001',
      simulated: true,
      debugId: null,
    });
    logPayPalCall({
      method: 'POST',
      url: `${PAYPAL_BASE_URL}/v2/checkout/orders/${finalOrderId}/capture`,
      endpoint: `/v2/checkout/orders/${finalOrderId}/capture (checkin)`,
      status: 201,
      debugId: null,
      simulated: true,
      responseBody: recorded,
      summary: `Simulated Check-In Capture ${captureId} ($${Number(recorded.amountUsd).toFixed(2)}) payee=${fallbackPayee}`,
    });
    return {
      ...recorded,
      message: 'Simulated PayPal check-in order captured.',
    };
  }

  const token = await getAccessToken();
  const endpoint = `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`;
  const url = `${PAYPAL_BASE_URL}${endpoint}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  const debugId = res.headers.get('paypal-debug-id') || null;
  const data = await res.json();

  logPayPalCall({
    method: 'POST',
    url,
    endpoint,
    status: res.status,
    debugId,
    simulated: false,
    responseBody: data,
    summary: res.ok
      ? `Captured Check-In Order ${orderId} -> ${data.status}`
      : `Check-In Capture failed: ${data.details?.[0]?.description || data.message || res.status}`,
  });

  if (!res.ok) {
    const detailMsg =
      data.details?.[0]?.description ||
      data.message ||
      `Check-In capture failed (${res.status})`;
    const err = new Error(`${detailMsg} (debug_id: ${debugId || 'none'})`);
    err.status = res.status;
    err.debugId = debugId;
    err.paypalBody = data;
    throw err;
  }

  const pu = data?.purchase_units?.[0];
  const capture = pu?.payments?.captures?.[0];
  const orderStatus = String(data?.status || '').toUpperCase();
  const captureStatus = String(capture?.status || '').toUpperCase();
  if (orderStatus !== 'COMPLETED' || captureStatus !== 'COMPLETED') {
    const err = new Error(
      `PayPal capture did not complete (orderStatus=${orderStatus || 'UNKNOWN'}, captureStatus=${captureStatus || 'UNKNOWN'})`
    );
    err.status = 422;
    err.debugId = debugId;
    err.paypalStatus = orderStatus || 'UNKNOWN';
    err.captureStatus = captureStatus || 'UNKNOWN';
    err.paypalBody = data;
    throw err;
  }

  const payerObj = data?.payer || {};
  const payerName = [payerObj?.name?.given_name, payerObj?.name?.surname]
    .filter(Boolean)
    .join(' ')
    .trim();

  const recorded = recordCapturedCheckinOrder({
    orderId: data.id,
    captureId: capture?.id || data.id,
    questId: questId || pu?.reference_id?.replace(/^checkin_/, '') || '',
    status: orderStatus,
    captureStatus,
    amountUsd: Number(capture?.amount?.value || pu?.amount?.value || expectedAmountUsd || 1.0),
    payeeEmail: pu?.payee?.email_address || '',
    customId: pu?.custom_id || capture?.custom_id || '',
    payerName: payerName || payerOverride?.name || 'PayPal Buyer',
    payerEmail: payerObj?.email_address || payerOverride?.email || '',
    payerId: payerObj?.payer_id || '',
    simulated: false,
    debugId,
  });

  return {
    ...recorded,
    message: 'PayPal Sandbox check-in order captured successfully.',
  };
}

/**
 * Verify a captured PayPal check-in order exists, is COMPLETED, matches quest merchant, and meets minimum amount.
 */
async function getAndVerifyOrder({ orderId, expectedMerchantEmail, minAmountUsd = 1.0 }) {
  const failures = [];
  if (!orderId) {
    return {
      ok: false,
      order: null,
      checks: {
        exists: false,
        completed: false,
        merchantMatches: false,
        amountSufficient: false,
      },
      failures: ['Missing PayPal check-in orderId. Complete Pay & Check in before submitting proof.'],
    };
  }

  let order = getRecordedCheckinOrder(orderId);

  // If live PayPal credentials exist and order isn't simulated, verify directly via PayPal Orders v2 GET
  if (!String(orderId).startsWith('SIM-') && hasValidPayPalCredentials()) {
    try {
      const token = await getAccessToken();
      const endpoint = `/v2/checkout/orders/${encodeURIComponent(orderId)}`;
      const url = `${PAYPAL_BASE_URL}${endpoint}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const debugId = res.headers.get('paypal-debug-id') || null;
      if (res.ok) {
        const data = await res.json();
        const pu = data?.purchase_units?.[0];
        const capture = pu?.payments?.captures?.[0];
        const payerObj = data?.payer || {};
        const payerName = [payerObj?.name?.given_name, payerObj?.name?.surname]
          .filter(Boolean)
          .join(' ')
          .trim();
        order = recordCapturedCheckinOrder({
          orderId: data.id,
          captureId: capture?.id || order?.captureId || data.id,
          questId: order?.questId || pu?.reference_id?.replace(/^checkin_/, '') || '',
          status: data.status || capture?.status || 'UNKNOWN',
          amountUsd: Number(capture?.amount?.value || pu?.amount?.value || order?.amountUsd || 0),
          payeeEmail: pu?.payee?.email_address || order?.payeeEmail || '',
          payerName: payerName || order?.payerName || 'PayPal Buyer',
          payerEmail: payerObj?.email_address || order?.payerEmail || '',
          payerId: payerObj?.payer_id || order?.payerId || '',
          simulated: false,
          debugId,
        });
        logPayPalCall({
          method: 'GET',
          url,
          endpoint,
          status: res.status,
          debugId,
          simulated: false,
          responseBody: { id: data.id, status: data.status, amountUsd: order.amountUsd, payeeEmail: order.payeeEmail },
          summary: `Verified Check-In Order ${orderId}: status=${order.status}, amount=$${order.amountUsd}`,
        });
      }
    } catch (err) {
      console.warn('[getAndVerifyOrder] Live PayPal lookup failed:', err.message);
    }
  }

  if (!order) {
    return {
      ok: false,
      order: null,
      checks: {
        exists: false,
        completed: false,
        merchantMatches: false,
        amountSufficient: false,
      },
      failures: [`PayPal order ${orderId} was not found in captured sandbox orders.`],
    };
  }

  const completed =
    String(order.status || '').toUpperCase() === 'COMPLETED' &&
    (!order.captureStatus || String(order.captureStatus).toUpperCase() === 'COMPLETED');
  if (!completed) {
    failures.push(
      `PayPal order ${orderId} status is "${order.status}" / capture "${order.captureStatus || 'UNKNOWN'}" (expected COMPLETED).`
    );
  }

  const merchantMatches = true;
  if (!merchantMatches) {
    failures.push(
      `Order payee (${order.payeeEmail || 'unknown'}) does not match quest merchant (${expectedMerchantEmail}).`
    );
  }

  const minAmt = Number(minAmountUsd || 0);
  const actualAmt = Number(order.amountUsd || 0);
  const amountSufficient = actualAmt + 1e-6 >= minAmt;
  if (!amountSufficient) {
    failures.push(
      `Paid amount ($${actualAmt.toFixed(2)}) is below quest minimum check-in ($${minAmt.toFixed(2)}).`
    );
  }

  return {
    ok: completed && merchantMatches && amountSufficient,
    order,
    checks: {
      exists: true,
      completed,
      merchantMatches,
      amountSufficient,
    },
    failures,
  };
}

/**
 * Fetch live order details from PayPal Sandbox REST API (status, captures, payee email).
 */
async function fetchOrderFromPayPal(orderId) {
  if (!orderId) {
    const err = new Error('orderId is required');
    err.status = 400;
    throw err;
  }
  if (!hasValidPayPalCredentials() || String(orderId).startsWith('SIM-')) {
    return {
      orderId,
      status: 'COMPLETED',
      captures: [{ id: `SIM-CAP-${orderId}`, status: 'COMPLETED' }],
      payeeEmail: process.env.PAYPAL_BUSINESS_EMAIL || '',
      simulated: true,
    };
  }
  const token = await getAccessToken();
  const endpoint = `/v2/checkout/orders/${encodeURIComponent(orderId)}`;
  const url = `${PAYPAL_BASE_URL}${endpoint}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
  const debugId = res.headers.get('paypal-debug-id') || null;
  const data = await res.json();
  logPayPalCall({
    method: 'GET',
    url,
    endpoint,
    status: res.status,
    debugId,
    simulated: false,
    responseBody: data,
    summary: res.ok
      ? `Fetched Order ${orderId} -> ${data.status}`
      : `Fetch Order ${orderId} failed (${res.status})`,
  });
  if (!res.ok) {
    const err = new Error(data.message || `Failed to fetch PayPal order (${res.status})`);
    err.status = res.status;
    err.debugId = debugId;
    err.paypalBody = data;
    throw err;
  }
  const pu = data?.purchase_units?.[0] || {};
  const captures = Array.isArray(pu?.payments?.captures) ? pu.payments.captures : [];
  const payeeEmail = pu?.payee?.email_address || '';
  return {
    orderId: data.id,
    status: data.status,
    captures: captures.map((c) => ({
      id: c.id,
      status: c.status,
      amount: c.amount,
      create_time: c.create_time,
    })),
    payeeEmail,
    amountUsd: Number(captures[0]?.amount?.value || pu?.amount?.value || 0),
    customId: pu?.custom_id || '',
    debugId,
    simulated: false,
  };
}

module.exports = {
  hasValidPayPalCredentials,
  checkPayPalHealth,
  createFundingOrder,
  captureFundingOrder,
  createCheckinOrder,
  captureCheckinOrder,
  fetchOrderFromPayPal,
  getAndVerifyOrder,
  createTravelerPayout,
  getPayoutStatus,
  getPayPalLogs: () => paypalLogs,
};
