const fs = require('fs');
const path = require('path');

const DATA_DIR = path.resolve(__dirname, '../../data');
const CLAIMS_FILE = path.join(DATA_DIR, 'claims.json');
const ORDERS_FILE = path.join(DATA_DIR, 'checkin_orders.json');

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readJsonFile(filePath, fallback) {
  try {
    ensureDir();
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch (err) {
    console.warn(`[claimsStore] Failed reading ${path.basename(filePath)}:`, err.message);
    return fallback;
  }
}

function writeJsonFile(filePath, data) {
  try {
    ensureDir();
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, filePath);
  } catch (err) {
    console.warn(`[claimsStore] Failed writing ${path.basename(filePath)}:`, err.message);
  }
}

const claimsCache = readJsonFile(CLAIMS_FILE, []);
const ordersCache = readJsonFile(ORDERS_FILE, {});

function getSupabaseRestConfig() {
  const url = (process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const key = (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
    ''
  ).trim();
  if (!url || !key || !url.startsWith('http')) return null;
  return { url, key };
}

async function syncClaimToSupabase(claim) {
  const cfg = getSupabaseRestConfig();
  if (!cfg) return;
  try {
    const row = {
      id: claim.id,
      quest_id: claim.questId,
      quest_title: claim.questTitle,
      business_name: claim.businessName,
      traveler_name: claim.travelerName,
      traveler_email: claim.travelerEmail || null,
      traveler_avatar: claim.travelerAvatar || null,
      paypal_email: claim.paypalEmail,
      order_id: claim.order?.orderId || null,
      capture_id: claim.order?.captureId || null,
      order_amount_cents: Math.round(Number(claim.order?.amountUsd || 0) * 100),
      order_status: claim.order?.status || null,
      payee_email: claim.order?.payeeEmail || null,
      payer_name: claim.order?.payerName || null,
      payer_email: claim.order?.payerEmail || null,
      payer_id: claim.order?.payerId || null,
      photo_uri: claim.photoUri && claim.photoUri.length < 2048 ? claim.photoUri : null,
      latitude: claim.gps?.latitude ?? null,
      longitude: claim.gps?.longitude ?? null,
      mocked: Boolean(claim.gps?.mocked),
      resolved_address: claim.resolvedAddress || null,
      distance_meters: typeof claim.distanceMeters === 'number' ? claim.distanceMeters : null,
      demo_mode: Boolean(claim.demoMode),
      ai_verdict: claim.aiVerdict?.verdict || null,
      ai_confidence: typeof claim.aiVerdict?.confidence === 'number' ? claim.aiVerdict.confidence : null,
      ai_reasons: Array.isArray(claim.aiVerdict?.reasons) ? claim.aiVerdict.reasons : [],
      hard_checks: claim.hardChecks || null,
      status: claim.status,
      review_note: claim.reviewNote || null,
      payout_id: claim.payout?.id || null,
      payout_status: claim.payout?.status || null,
      webhook_status: claim.webhookStatus || null,
      webhook_status_code: typeof claim.webhookStatusCode === 'number' ? claim.webhookStatusCode : null,
      owner_notified: Boolean(claim.ownerNotified),
      review_token: claim.reviewToken || null,
      business_email: claim.businessEmail || null,
      submitted_at: claim.submittedAt,
      ai_reviewed_at: claim.aiReviewedAt || null,
      reviewed_at: claim.reviewedAt || null,
      paid_at: claim.paidAt || null,
    };

    const res = await fetch(`${cfg.url}/rest/v1/claims`, {
      method: 'POST',
      headers: {
        apikey: cfg.key,
        Authorization: `Bearer ${cfg.key}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify(row),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      console.warn(`[claimsStore] Supabase claims sync HTTP ${res.status}: ${txt.slice(0, 160)}`);
    }
  } catch (err) {
    console.warn('[claimsStore] Supabase claims sync skipped:', err.message);
  }
}

function listClaims({ questId, status, travelerEmail } = {}) {
  return claimsCache.filter((c) => {
    if (questId && c.questId !== String(questId)) return false;
    if (status && c.status !== String(status)) return false;
    if (travelerEmail && String(c.travelerEmail || '').toLowerCase() !== String(travelerEmail).toLowerCase()) {
      return false;
    }
    return true;
  });
}

function getClaimById(id) {
  return claimsCache.find((c) => c.id === id) || null;
}

function saveClaim(claim) {
  const idx = claimsCache.findIndex((c) => c.id === claim.id);
  if (idx !== -1) {
    claimsCache[idx] = claim;
  } else {
    claimsCache.unshift(claim);
  }
  writeJsonFile(CLAIMS_FILE, claimsCache);
  void syncClaimToSupabase(claim);
  return claim;
}

function recordCapturedCheckinOrder(order) {
  if (!order || !order.orderId) return null;
  ordersCache[order.orderId] = {
    ...order,
    recordedAt: order.recordedAt || new Date().toISOString(),
  };
  writeJsonFile(ORDERS_FILE, ordersCache);
  return ordersCache[order.orderId];
}

function getRecordedCheckinOrder(orderId) {
  return ordersCache[orderId] || null;
}

function listCheckinOrders({ questId } = {}) {
  const rows = Object.values(ordersCache).filter((o) => {
    if (!o || !o.orderId) return false;
    if (questId && o.questId !== String(questId)) return false;
    return true;
  });
  return rows.sort((a, b) =>
    String(b.recordedAt || '').localeCompare(String(a.recordedAt || ''))
  );
}

module.exports = {
  listClaims,
  getClaimById,
  saveClaim,
  recordCapturedCheckinOrder,
  getRecordedCheckinOrder,
  listCheckinOrders,
};
