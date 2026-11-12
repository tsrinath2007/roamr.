const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../../app/.env'), override: false });
const express = require('express');
const cors = require('cors');
const {
  db,
  USD_TO_INR,
  isDisallowedBusinessCategory,
  ensureSuperadminUser,
  getSuperadminPaypalEmail,
  resolveOrCreateUser,
  formatQuestDto,
  formatPlaceDto,
} = require('../db');
const { seedDatabaseFromFile } = require('../db/seed');
const { notifyBusiness } = require('../services/zapier.ts');
const {
  hasValidGeminiKey,
  hasValidGroqKey,
  getActiveAiProvider,
  verifyQuestProof,
  verifyClaimWithGemini,
  readBillTotalWithAi,
  draftAiBriefWithAi,
  generateWeeklyInsight,
  generatePersonalizedQuests,
} = require('./services/geminiService');
const {
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
  getPayPalLogs,
} = require('./services/paypalService');
const {
  listClaims,
  getClaimById,
  saveClaim,
  listCheckinOrders,
  recordCapturedCheckinOrder,
} = require('./services/claimsStore');

const app = express();
const PORT = Number(process.env.PORT || 5000);
const HOST = process.env.HOST || '127.0.0.1';

app.use(cors());
app.use(express.json({ limit: '15mb' }));

const UPLOADS_DIR = path.resolve(__dirname, '../data/uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}
app.use('/uploads', express.static(UPLOADS_DIR));

function persistClaimPhoto(claimId, photoBase64, mimeType, rawPhotoUri, req) {
  if (photoBase64 && String(photoBase64).length >= 32) {
    try {
      const stripped = String(photoBase64).replace(/^data:image\/\w+;base64,/, '');
      const ext = String(mimeType || '').includes('png') ? 'png' : 'jpg';
      const fileName = `${claimId}.${ext}`;
      fs.writeFileSync(path.join(UPLOADS_DIR, fileName), Buffer.from(stripped, 'base64'));
      return `${getServerBaseUrl(req)}/uploads/${fileName}`;
    } catch (err) {
      console.warn('[persistClaimPhoto] failed:', err.message);
    }
  }
  return rawPhotoUri || null;
}

function recordFundingOrder(entry) {
  const idx = fundingOrdersStore.findIndex((o) => o.id === entry.id);
  if (idx !== -1) {
    fundingOrdersStore[idx] = entry;
  } else {
    fundingOrdersStore.unshift(entry);
  }
}

function computeDistanceMeters(a, b) {
  if (!a || !b || typeof a.latitude !== 'number' || typeof a.longitude !== 'number') return null;
  if (typeof b.latitude !== 'number' || typeof b.longitude !== 'number') return null;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)));
}

function isNightTimeKolkata(dateInput = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(dateInput);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value || 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value || 0);
  const totalMinutes = hour * 60 + minute;
  return totalMinutes >= 18 * 60 + 30 || totalMinutes < 5 * 60;
}

function recomputeQuestFunding(quest) {
  if (!quest || typeof quest !== 'object') return quest;
  const total = Number(quest.budget_usd ?? quest.budgetUsd ?? 0);
  const rawRemaining =
    quest.budget_remaining_usd !== undefined
      ? Number(quest.budget_remaining_usd)
      : Math.max(0, total - Number(quest.spentUsd || 0));
  const remaining = Number(Math.max(0, rawRemaining).toFixed(2));
  quest.budget_usd = total;
  quest.budgetUsd = total;
  quest.budget_remaining_usd = remaining;
  quest.funded = remaining > 0;
  quest.reward_mode = quest.funded ? 'cashback' : 'xp_only';
  if (!quest.funded) {
    quest.rewardUsd = 0;
  } else if (quest.reward?.max_reward_usd || quest.reward?.fixed_reward_usd) {
    quest.rewardUsd = Number(quest.reward.max_reward_usd ?? quest.reward.fixed_reward_usd ?? 2.0);
  }
  return quest;
}

function getISTDateKey(dateInput = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(dateInput);
}

// SQLite query & DTO helpers
function getPlaceRow(placeId) {
  return db.prepare('SELECT * FROM places WHERE id = ?').get(String(placeId || ''));
}

function getQuestDtoById(questId, { includePrivate = false } = {}) {
  const q = db.prepare('SELECT * FROM quests WHERE id = ?').get(String(questId || ''));
  if (!q) return null;
  const p = getPlaceRow(q.place_id);
  return formatQuestDto(q, p, { includePrivate });
}

function listQuestDtos({
  includePrivate = false,
  fundedOnly = false,
  activeOnly = true,
  ownerId = null,
  ownerOrClaimantId = null,
} = {}) {
  const clauses = [];
  const params = [];
  if (activeOnly) clauses.push('q.active = 1');
  if (fundedOnly) clauses.push('q.budget_remaining_usd > 0');
  if (ownerOrClaimantId) {
    clauses.push("(p.owner_id = ? OR (p.claimed_by = ? AND p.claim_status = 'pending'))");
    params.push(ownerOrClaimantId, ownerOrClaimantId);
  } else if (ownerId) {
    clauses.push('p.owner_id = ?');
    params.push(ownerId);
  }
  const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db
    .prepare(
      `SELECT q.*, p.id AS p_id, p.name AS p_name, p.address AS p_address, p.lat AS p_lat, p.lng AS p_lng,
              p.category AS p_category, p.photo_url AS p_photo_url, p.city AS p_city,
              p.maps_link AS p_maps_link, p.owner_id AS p_owner_id
       FROM quests q
       JOIN places p ON q.place_id = p.id
       ${whereSql}
       ORDER BY q.created_at DESC`
    )
    .all(...params);

  return rows.map((row) => {
    const placeRow = {
      id: row.p_id,
      name: row.p_name,
      address: row.p_address,
      lat: row.p_lat,
      lng: row.p_lng,
      category: row.p_category,
      photo_url: row.p_photo_url,
      city: row.p_city,
      maps_link: row.p_maps_link,
      owner_id: row.p_owner_id,
    };
    return formatQuestDto(row, placeRow, { includePrivate });
  });
}

function toPublicQuest(quest) {
  if (!quest || typeof quest !== 'object') return quest;
  const { ai_private, aiInstructions, aiReferenceImages, ...publicFields } = quest;
  return publicFields;
}

function persistClaimRecord(claim, userId = null) {
  saveClaim(claim);
  try {
    const questExists = db
      .prepare('SELECT id FROM quests WHERE id = ?')
      .get(String(claim?.questId || ''));
    if (!questExists) return;
    db.prepare(
      `INSERT OR REPLACE INTO claims (
        id, quest_id, user_id, status, photo_path, bill_photo_path, text_answer,
        lat, lng, distance_m, paypal_order_id, bill_inr, paid_usd,
        ai_verdict, ai_confidence, ai_reasons, reward_usd, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      claim.id,
      claim.questId,
      userId || null,
      claim.status || 'submitted',
      claim.photoUri || null,
      claim.billPhotoUri || null,
      claim.textAnswer || null,
      typeof claim.gps?.latitude === 'number' ? claim.gps.latitude : null,
      typeof claim.gps?.longitude === 'number' ? claim.gps.longitude : null,
      typeof claim.distanceMeters === 'number' ? claim.distanceMeters : null,
      claim.order?.orderId || null,
      Number(claim.billInr || 0),
      Number(claim.paidUsd || 0),
      claim.aiVerdict?.verdict || null,
      Number(claim.aiVerdict?.confidence || 0),
      JSON.stringify(Array.isArray(claim.aiVerdict?.reasons) ? claim.aiVerdict.reasons : []),
      Number(claim.rewardUsd || 0),
      claim.submittedAt || new Date().toISOString()
    );
  } catch (err) {
    console.warn('[persistClaimRecord sqlite]', err.message);
  }
}

function extractEmailFromAuthHeader(req) {
  const explicit = String(req.headers['x-user-email'] || '').trim();
  if (explicit && explicit.includes('@')) return explicit;

  const auth = String(req.headers.authorization || '').trim();
  if (auth.toLowerCase().startsWith('bearer ')) {
    const token = auth.slice(7).trim();
    const parts = token.split('.');
    if (parts.length === 3) {
      try {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
        if (payload?.email && String(payload.email).includes('@')) {
          return String(payload.email).trim();
        }
      } catch {
        // ignore malformed JWT
      }
    }
  }

  const bodyEmail = String(req.body?.traveler?.email || '').trim();
  if (bodyEmail && bodyEmail.includes('@')) return bodyEmail;
  return 'demo@roamr.app';
}

function attachUser(req, res, next) {
  try {
    const email = extractEmailFromAuthHeader(req);
    const name = String(
      req.headers['x-user-name'] || req.body?.traveler?.name || ''
    ).trim();
    const avatar = String(req.body?.traveler?.avatar || '').trim() || undefined;
    req.user = resolveOrCreateUser({ email, name, avatar });
  } catch (err) {
    console.warn('[attachUser] fallback:', err.message);
    req.user = resolveOrCreateUser({ email: 'demo@roamr.app', name: 'Demo Explorer' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  return next();
}

app.use(attachUser);

const payoutsStore = [];
const fundingOrdersStore = [];
const submissionsStore = [];

function recordPayoutLedger({ questId, questTitle, amountUsd, payout, skipQuestBudgetUpdate = false }) {
  const target = getQuestDtoById(questId);
  if (target && !skipQuestBudgetUpdate) {
    db.prepare(
      `UPDATE quests SET verified_visits = verified_visits + 1, spent_usd = ROUND(spent_usd + ?, 2) WHERE id = ?`
    ).run(Number(amountUsd || target.rewardUsd || 0), questId);
  }

  const record = {
    id: payout.payoutBatchId,
    questId,
    questTitle: questTitle || target?.title || 'ROAMR Quest',
    amountUsd: payout.amountUsd,
    status: payout.payoutStatus,
    simulated: payout.simulated,
    debugId: payout.debugId || null,
    receiverEmail: payout.receiverEmail,
    createdAt: new Date().toISOString(),
    message: payout.message,
  };
  payoutsStore.unshift(record);
  return record;
}

function getServerBaseUrl(req) {
  const host = req.get('host');
  const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
  return `${proto}://${host}`;
}

function renderReturnRedirectHtml({ title, subtitle, deepLink }) {
  const safeDeepLink = JSON.stringify(deepLink);
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #EAF1E7;
      color: #18251E;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      padding: 20px;
    }
    .card {
      background: #FFFFFF;
      border-radius: 22px;
      padding: 28px 24px;
      max-width: 360px;
      width: 100%;
      text-align: center;
      box-shadow: 0 10px 25px rgba(22, 41, 29, 0.12);
    }
    h1 { font-size: 22px; margin: 0 0 8px; color: #1F5D3A; }
    p { font-size: 14px; line-height: 1.5; color: #58675D; margin: 0 0 20px; }
    a.btn {
      display: inline-block;
      background: #1F5D3A;
      color: #FFFFFF;
      text-decoration: none;
      font-weight: 600;
      padding: 12px 22px;
      border-radius: 999px;
      font-size: 14px;
    }
  </style>
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    <p>${subtitle}</p>
    <a class="btn" href=${safeDeepLink}>Return to ROAMR</a>
  </div>
  <script>
    window.location.replace(${safeDeepLink});
  </script>
</body>
</html>`;
}

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'roamr-server',
    timestamp: new Date().toISOString(),
    integrations: {
      aiProvider: getActiveAiProvider(),
      groqConfigured: hasValidGroqKey(),
      geminiConfigured: hasValidGeminiKey(),
      paypalConfigured: hasValidPayPalCredentials(),
    },
  });
});

// PayPal OAuth health check
app.get('/api/paypal/health', async (req, res) => {
  const health = await checkPayPalHealth();
  res.status(health.ok ? 200 : health.status || 500).json(health);
});

// Auth / current user endpoints
app.get('/api/me', (req, res) => {
  return res.json({ user: req.user });
});

function canManagePlace(placeRow, user) {
  if (!placeRow || !user) return false;
  if (user.role === 'admin') return true;
  if (placeRow.owner_id && placeRow.owner_id === user.id) return true;
  if (placeRow.claimed_by && placeRow.claimed_by === user.id && placeRow.claim_status === 'pending') {
    return true;
  }
  return false;
}

app.patch('/api/me/paypal', (req, res) => {
  const cleanPaypal = String(req.body?.paypal_email || '').trim();
  if (!cleanPaypal || !cleanPaypal.includes('@')) {
    return res.status(400).json({ error: 'A valid PayPal email is required.' });
  }
  db.prepare('UPDATE users SET paypal_email = ? WHERE id = ?').run(cleanPaypal, req.user.id);
  if (req.user.role === 'admin') {
    db.prepare(
      `UPDATE quests
       SET merchant_email = ?
       WHERE budget_remaining_usd > 0
         AND place_id IN (SELECT id FROM places WHERE owner_id = ?)`
    ).run(cleanPaypal, req.user.id);
  }
  const updatedUser = resolveOrCreateUser({ email: req.user.email });
  return res.json({ user: updatedUser });
});

app.post('/api/me/business', (req, res) => {
  const { business_name, paypal_email, place, claim_note } = req.body || {};
  const cleanBiz = String(business_name || '').trim();
  const cleanPaypal = String(paypal_email || '').trim();
  if (!cleanBiz || !cleanPaypal) {
    return res.status(400).json({ error: 'business_name and paypal_email are required.' });
  }

  db.prepare(
    `UPDATE users SET business_name = ?, paypal_email = ? WHERE id = ?`
  ).run(cleanBiz, cleanPaypal, req.user.id);

  if (place && typeof place === 'object') {
    const existingForUser = db
      .prepare(
        "SELECT * FROM places WHERE owner_id = ? OR (claimed_by = ? AND claim_status IN ('pending', 'approved')) LIMIT 1"
      )
      .get(req.user.id, req.user.id);

    if (place.place_id) {
      const target = getPlaceRow(place.place_id);
      if (!target) {
        return res.status(404).json({ error: 'Selected place not found.' });
      }
      if (isDisallowedBusinessCategory(target.category, target.name)) {
        return res.status(400).json({
          error: 'Only commercial venues (Restaurant, Cafe, Run Club, Night Club, Shop, etc.) can be claimed — not monuments, parks, or museums.',
        });
      }
      if (existingForUser && existingForUser.id !== target.id) {
        return res.status(400).json({ error: 'Each business can keep only 1 place.' });
      }
      if (target.owner_id && target.owner_id !== req.user.id) {
        return res.status(400).json({ error: 'This place is already owned by another business.' });
      }
      if (target.owner_id !== req.user.id) {
        db.prepare(
          `UPDATE places
           SET claim_status = 'pending',
               claim_note = ?,
               claim_business_name = ?,
               claim_paypal_email = ?,
               claimed_by = ?
           WHERE id = ?`
        ).run(String(claim_note || '').trim(), cleanBiz, cleanPaypal, req.user.id, target.id);
      }
    } else if (place.name && typeof place.lat === 'number' && typeof place.lng === 'number') {
      const pName = String(place.name).trim();
      const pCat = String(place.category || 'Restaurant').trim();
      if (isDisallowedBusinessCategory(pCat, pName)) {
        return res.status(400).json({
          error: 'Only commercial venues (Restaurant, Cafe, Run Club, Night Club, Shop, etc.) are allowed — not monuments, parks, or museums.',
        });
      }
      if (existingForUser) {
        // Update their single pending place rather than creating a 2nd place
        db.prepare(
          `UPDATE places
           SET name = ?, address = ?, lat = ?, lng = ?, category = ?,
               claim_status = CASE WHEN owner_id IS NOT NULL THEN 'approved' ELSE 'pending' END,
               claim_business_name = ?, claim_paypal_email = ?, claim_note = ?
           WHERE id = ?`
        ).run(
          pName,
          String(place.address || `${pName}, ${place.city || 'Bengaluru'}`).trim(),
          Number(place.lat),
          Number(place.lng),
          pCat,
          cleanBiz,
          cleanPaypal,
          String(claim_note || '').trim(),
          existingForUser.id
        );
      } else {
        const placeId = `plc-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
        db.prepare(
          `INSERT INTO places (
            id, name, address, lat, lng, category, photo_url, city, maps_link,
            owner_id, claim_status, claim_note, claim_business_name, claim_paypal_email,
            claimed_by, created_by, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'pending', ?, ?, ?, ?, ?, ?)`
        ).run(
          placeId,
          pName,
          String(place.address || `${pName}, ${place.city || 'Bengaluru'}`).trim(),
          Number(place.lat),
          Number(place.lng),
          pCat,
          place.photo_url || null,
          String(place.city || 'Bengaluru').trim(),
          `https://www.google.com/maps/search/?api=1&query=${Number(place.lat)},${Number(place.lng)}`,
          String(claim_note || '').trim(),
          cleanBiz,
          cleanPaypal,
          req.user.id,
          req.user.id,
          new Date().toISOString()
        );
      }
    }
  }

  const refreshed = resolveOrCreateUser({ email: req.user.email });
  return res.json({ user: refreshed });
});

// Public Places & Quests endpoints (NEVER expose ai_private)
app.get('/api/places', (req, res) => {
  const fundedFilter = String(req.query?.funded || '').toLowerCase() === 'true';
  const rows = db.prepare('SELECT * FROM places ORDER BY created_at DESC').all();
  let places = rows.map(formatPlaceDto);
  if (fundedFilter) {
    places = places.filter((p) => p.has_funded_quests);
  }
  return res.json({ places });
});

app.get('/api/places/:id', (req, res) => {
  const placeRow = getPlaceRow(req.params.id);
  if (!placeRow) {
    return res.status(404).json({ error: 'Place not found.' });
  }
  const questRows = db
    .prepare('SELECT * FROM quests WHERE place_id = ? AND active = 1 ORDER BY created_at DESC')
    .all(placeRow.id);
  const quests = questRows.map((q) => formatQuestDto(q, placeRow, { includePrivate: false }));
  return res.json({
    place: formatPlaceDto(placeRow),
    quests,
  });
});

app.post('/api/places/:id/claim', (req, res) => {
  const placeRow = getPlaceRow(req.params.id);
  if (!placeRow) {
    return res.status(404).json({ error: 'Place not found.' });
  }
  if (placeRow.owner_id && placeRow.owner_id !== req.user.id) {
    return res.status(400).json({ error: 'This place is already owned.' });
  }
  if (isDisallowedBusinessCategory(placeRow.category, placeRow.name)) {
    return res.status(400).json({
      error: 'Only venues (Restaurant, Cafe, Run Club, Night Club, Shop, etc.) can be claimed by businesses — not monuments, parks, or museums.',
    });
  }
  const existingForUser = db
    .prepare(
      "SELECT id FROM places WHERE (owner_id = ? OR (claimed_by = ? AND claim_status IN ('pending', 'approved'))) AND id != ? LIMIT 1"
    )
    .get(req.user.id, req.user.id, placeRow.id);
  if (existingForUser) {
    return res.status(400).json({ error: 'Each business can claim or keep only 1 place.' });
  }
  const { business_name, paypal_email, claim_note } = req.body || {};
  if (!business_name || !paypal_email) {
    return res.status(400).json({ error: 'business_name and paypal_email are required.' });
  }

  db.prepare(
    `UPDATE places
     SET claim_status = 'pending',
         claim_note = ?,
         claim_business_name = ?,
         claim_paypal_email = ?,
         claimed_by = ?
     WHERE id = ?`
  ).run(
    String(claim_note || '').trim(),
    String(business_name).trim(),
    String(paypal_email).trim(),
    req.user.id,
    placeRow.id
  );

  db.prepare(
    `UPDATE users SET business_name = COALESCE(?, business_name), paypal_email = COALESCE(?, paypal_email) WHERE id = ?`
  ).run(String(business_name).trim(), String(paypal_email).trim(), req.user.id);

  const updated = getPlaceRow(placeRow.id);
  return res.json({ place: formatPlaceDto(updated) });
});

app.get('/api/quests', (req, res) => {
  const fundedOnly = String(req.query?.funded || '').toLowerCase() === 'true';
  return res.json({
    quests: listQuestDtos({ includePrivate: false, fundedOnly, activeOnly: true }),
  });
});

function persistQuestRefImages(questId, rawList, req) {
  if (!Array.isArray(rawList)) return [];
  const saved = [];
  rawList.slice(0, 3).forEach((entry, idx) => {
    const val = String(entry || '').trim();
    if (!val) return;
    if (val.startsWith('data:image/')) {
      try {
        const mimeMatch = val.match(/^data:(image\/\w+);base64,/);
        const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
        const ext = mime.includes('png') ? 'png' : 'jpg';
        const b64 = val.replace(/^data:image\/\w+;base64,/, '');
        const fileName = `ref-${questId}-${idx}.${ext}`;
        fs.writeFileSync(path.join(UPLOADS_DIR, fileName), Buffer.from(b64, 'base64'));
        saved.push(`${getServerBaseUrl(req)}/uploads/${fileName}`);
        return;
      } catch (err) {
        console.warn('[persistQuestRefImages] failed:', err.message);
      }
    }
    saved.push(val);
  });
  return saved;
}

function insertQuestIntoDb({ body, req, createdBy, forceAdmin = false }) {
  const b = body || {};
  const title = String(b.title || '').trim();
  const publicDescription = String(b.public_description ?? b.description ?? '').trim();
  const publicObjective = String(b.public_objective ?? b.objective ?? '').trim();

  if (!title || !publicObjective) {
    return { errorStatus: 400, error: 'title and public_objective are required.' };
  }

  let placeRow = b.place_id ? getPlaceRow(b.place_id) : null;

  if (!forceAdmin) {
    const userCategory = b.category || placeRow?.category || '';
    if (isDisallowedBusinessCategory(userCategory, title)) {
      return {
        errorStatus: 400,
        error: 'Business quests must be related to a venue (Restaurant, Cafe, Run Club, Night Club, Shop, etc.), not monuments, parks, or museums.',
      };
    }

    const userPlace = db
      .prepare(
        `SELECT * FROM places
         WHERE owner_id = ? OR (claimed_by = ? AND claim_status = 'pending')
         ORDER BY CASE WHEN owner_id = ? THEN 0 ELSE 1 END, created_at DESC
         LIMIT 1`
      )
      .get(createdBy, createdBy, createdBy);

    if (!userPlace) {
      return {
        errorStatus: 403,
        error: 'Register or claim your business place first before creating a quest.',
      };
    }
    if (placeRow && placeRow.id !== userPlace.id) {
      return {
        errorStatus: 403,
        error: 'Each business has 1 place only — quests must belong to your place.',
      };
    }
    placeRow = userPlace;
    if (isDisallowedBusinessCategory(placeRow.category, placeRow.name)) {
      return {
        errorStatus: 400,
        error: 'Your place category is not eligible for business quests.',
      };
    }

    // Unverified business lock rule: until approved (owner_id set), max 1 quest allowed at that place
    if (placeRow.owner_id !== createdBy) {
      const existingCount =
        db.prepare('SELECT COUNT(*) AS cnt FROM quests WHERE place_id = ?').get(placeRow.id)?.cnt ||
        0;
      if (existingCount >= 1) {
        return {
          errorStatus: 403,
          error:
            'Unverified business lock: you can keep only 1 quest until Superadmin verifies your business.',
        };
      }
    }
  } else if (!placeRow) {
    // Admin can create a new place inline if lat/lng provided
      const latNum =
        typeof b.lat === 'number'
          ? b.lat
          : typeof b.coordinates?.latitude === 'number'
          ? Number(b.coordinates.latitude)
          : null;
      const lngNum =
        typeof b.lng === 'number'
          ? b.lng
          : typeof b.coordinates?.longitude === 'number'
          ? Number(b.coordinates.longitude)
          : null;
      if (latNum == null || Number.isNaN(latNum) || lngNum == null || Number.isNaN(lngNum)) {
        return { errorStatus: 400, error: 'place_id or valid lat/lng coordinates required.' };
      }
      const placeId = `plc-${Date.now()}`;
      const pName = String(b.place_name || b.businessName || title).trim();
      const pAddr = String(b.address || `${pName}, ${b.city || 'Bengaluru'}`).trim();
      db.prepare(
        `INSERT INTO places (id, name, address, lat, lng, category, photo_url, city, maps_link, owner_id, claim_status, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'none', ?, ?)`
      ).run(
        placeId,
        pName,
        pAddr,
        latNum,
        lngNum,
        String(b.category || 'Explore').trim(),
        b.photo_url || null,
        String(b.city || 'Bengaluru').trim(),
        b.maps_link || null,
        b.owner_id || null,
        createdBy,
        new Date().toISOString()
      );
      placeRow = getPlaceRow(placeId);
  }

  if (!forceAdmin && !canManagePlace(placeRow, { id: createdBy, role: 'traveler' })) {
    return {
      errorStatus: 403,
      error: 'Owners can create quests only at their own place.',
    };
  }

  const questId = `quest-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
  const persistedRefImages = persistQuestRefImages(questId, b.aiReferenceImages, req);
  const rawReward = b.reward || {};
  const budgetUsd = Math.max(0, Number(b.budget_usd ?? b.budgetUsd ?? 0));
  const isFundedOnCreate = Boolean((b.funded === true || b.budget_remaining_usd > 0) && budgetUsd > 0);
  const budgetRemainingUsd = isFundedOnCreate
    ? Number(b.budget_remaining_usd ?? budgetUsd)
    : 0;
  const questType = b.quest_type === 'purchase' && budgetUsd > 0 ? 'purchase' : 'visit';
  const minBillInr = Number(rawReward.min_bill_inr ?? b.min_bill_inr ?? (questType === 'purchase' ? 200 : 0));
  const cashbackPercent = Number(rawReward.cashback_percent ?? b.cashback_percent ?? (questType === 'purchase' ? 15 : 0));
  const maxRewardUsd = Number(rawReward.max_reward_usd ?? b.max_reward_usd ?? b.rewardUsd ?? (questType === 'purchase' ? 2.0 : 0));
  const fixedRewardUsd = Number(rawReward.fixed_reward_usd ?? b.fixed_reward_usd ?? 0);
  const normalizeArr = (arr) =>
    Array.isArray(arr) ? arr.map((x) => String(x).trim()).filter(Boolean) : [];
  const rawAiPrivate = b.ai_private || {};
  const aiPrivate = {
    must_show: normalizeArr(rawAiPrivate.must_show),
    reject_if: normalizeArr(rawAiPrivate.reject_if),
    bill_checks: budgetUsd > 0 && questType === 'purchase' ? normalizeArr(rawAiPrivate.bill_checks) : [],
    notes: String(rawAiPrivate.notes || b.aiInstructions || '').trim(),
  };
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO quests (
      id, place_id, title, public_description, public_objective, photo_url,
      difficulty, est_minutes, xp, night_only, radius_m, quest_type,
      text_answer_prompt, proof_hint, min_bill_inr, cashback_percent,
      max_reward_usd, fixed_reward_usd, budget_usd, budget_remaining_usd,
      demo_budget, active, ai_private, ai_reference_images, created_by,
      verified_visits, spent_usd, merchant_email, created_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      0, 0, ?, ?
    )`
  ).run(
    questId,
    placeRow.id,
    title,
    publicDescription || `Discover ${placeRow.name} and complete a local quest.`,
    publicObjective,
    b.photo_url ? String(b.photo_url).trim() : null,
    String(b.difficulty || 'Easy').trim(),
    Number(b.est_minutes || 20),
    Number(b.xp || (budgetUsd > 0 ? 35 : 75)),
    b.night_only ? 1 : 0,
    Math.max(50, Math.min(500, Math.round(Number(b.radius_m || 150)))),
    questType,
    b.text_answer_prompt ? String(b.text_answer_prompt).trim() : null,
    b.proof_hint || (questType === 'purchase' ? 'Receipt' : 'Live Photo'),
    minBillInr,
    cashbackPercent,
    maxRewardUsd,
    fixedRewardUsd,
    budgetUsd,
    budgetRemainingUsd,
    b.demo_budget ? 1 : 0,
    b.active === false ? 0 : 1,
    JSON.stringify(aiPrivate),
    JSON.stringify(persistedRefImages),
    createdBy,
    String(b.merchantEmail || req.user?.paypal_email || process.env.PAYPAL_BUSINESS_EMAIL || '').trim(),
    now
  );

  return { questId };
}

app.post('/api/quests/draft-brief', async (req, res) => {
  try {
    const brief = await draftAiBriefWithAi(req.body || {});
    return res.json(brief);
  } catch (err) {
    console.error('[POST /api/quests/draft-brief]', err);
    return res.status(500).json({ error: err.message || 'Failed to draft AI brief.' });
  }
});

app.post('/api/bill/read', async (req, res) => {
  try {
    const { imageBase64, mimeType, demoMode } = req.body || {};
    const result = await readBillTotalWithAi({
      imageBase64,
      mimeType,
      demoMode: Boolean(demoMode),
    });
    return res.json(result);
  } catch (err) {
    console.error('[POST /api/bill/read]', err);
    return res.status(500).json({ bill_total_inr: null, error: err.message });
  }
});

// Owner: create quest (ONLY at places where owner_id = req.user.id; Admin anywhere)
app.post('/api/quests', (req, res) => {
  const isAdmin = req.user?.role === 'admin';
  const result = insertQuestIntoDb({
    body: req.body,
    req,
    createdBy: req.user.id,
    forceAdmin: isAdmin,
  });
  if (result.error) {
    return res.status(result.errorStatus).json({ error: result.error });
  }
  const pubQuest = getQuestDtoById(result.questId, { includePrivate: false });
  return res.status(201).json({ quest: pubQuest, hasAiBrief: true });
});

// Owner: view own quests (including ai_private) & owner-only stats
app.get('/api/owner/quests', (req, res) => {
  const quests = listQuestDtos({
    includePrivate: true,
    fundedOnly: false,
    activeOnly: false,
    ownerOrClaimantId: req.user.id,
  });
  return res.json({ quests });
});

app.get('/api/owner/stats', (req, res) => {
  const ownerId = req.user.id;
  const rows = db
    .prepare(
      `SELECT q.budget_usd, q.budget_remaining_usd, q.spent_usd, q.verified_visits
       FROM quests q
       JOIN places p ON q.place_id = p.id
       WHERE p.owner_id = ?`
    )
    .all(ownerId);

  const funded = Number(rows.reduce((s, r) => s + Number(r.budget_usd || 0), 0).toFixed(2));
  const remaining = Number(
    rows.reduce((s, r) => s + Number(r.budget_remaining_usd || 0), 0).toFixed(2)
  );
  const spent = Number(rows.reduce((s, r) => s + Number(r.spent_usd || 0), 0).toFixed(2));
  const paidVisits = rows.reduce((s, r) => s + Number(r.verified_visits || 0), 0);
  const receivedRow = db
    .prepare(
      `SELECT COALESCE(SUM(amount_usd), 0) AS total_received
       FROM payments
       WHERE owner_id = ? AND status = 'COMPLETED' AND capture_status = 'COMPLETED'`
    )
    .get(ownerId);
  const received = Number(Number(receivedRow?.total_received || 0).toFixed(2));

  return res.json({
    funded,
    spent,
    remaining,
    received,
    received_from_travelers_usd: received,
    paid_visits: paidVisits,
    quests_count: rows.length,
    owned_places_count: req.user.owned_places_count || 0,
    is_owner: Boolean(req.user.is_owner),
    is_verified_business: Boolean(req.user.is_verified_business),
    quest_lock_limit: req.user.quest_lock_limit ?? null,
    primary_place: req.user.primary_place || null,
  });
});

function getScopedOwnerClaims(ownerId) {
  const rows = db
    .prepare(
      `SELECT c.*, q.title AS quest_title, q.place_id, p.name AS place_name, p.owner_id
       FROM claims c
       JOIN quests q ON c.quest_id = q.id
       JOIN places p ON q.place_id = p.id
       WHERE p.owner_id = ?
       ORDER BY c.created_at DESC`
    )
    .all(ownerId);
  const storeClaims = listClaims({});
  const storeById = new Map(storeClaims.map((s) => [s.id, s]));
  return rows.map((r) => {
    const stored = storeById.get(r.id);
    if (stored) return stored;
    return {
      id: r.id,
      questId: r.quest_id,
      questTitle: r.quest_title,
      businessName: r.place_name,
      status: r.status,
      rewardUsd: Number(r.reward_usd || 0),
      distanceMeters: r.distance_m,
      aiVerdict: {
        verdict: r.ai_verdict || 'pass',
        confidence: Number(r.ai_confidence || 0),
        reasons: parseJsonColumn(r.ai_reasons, []),
      },
      order: r.paypal_order_id
        ? { orderId: r.paypal_order_id, amountUsd: Number(r.paid_usd || 0), status: 'COMPLETED' }
        : null,
      submittedAt: r.created_at,
    };
  });
}

app.get('/api/owner/claims', (req, res) => {
  const claims = getScopedOwnerClaims(req.user.id);
  return res.json({ claims });
});

app.get('/api/owner/audits', (req, res) => {
  const audits = getScopedOwnerClaims(req.user.id);
  return res.json({ audits, claims: audits });
});

app.get('/api/owner/funding', (req, res) => {
  const funding = db
    .prepare(
      `SELECT f.*, q.title AS quest_title, p.name AS place_name, p.owner_id
       FROM funding f
       JOIN quests q ON f.quest_id = q.id
       JOIN places p ON q.place_id = p.id
       WHERE p.owner_id = ?
       ORDER BY f.created_at DESC`
    )
    .all(req.user.id);
  return res.json({ funding });
});

app.get('/api/owner/dashboard', (req, res) => {
  const ownerId = req.user.id;
  const quests = listQuestDtos({
    includePrivate: true,
    fundedOnly: false,
    activeOnly: false,
    ownerOrClaimantId: ownerId,
  });
  const claims = getScopedOwnerClaims(ownerId);
  const funding = db
    .prepare(
      `SELECT f.* FROM funding f
       JOIN quests q ON f.quest_id = q.id
       JOIN places p ON q.place_id = p.id
       WHERE p.owner_id = ?
       ORDER BY f.created_at DESC`
    )
    .all(ownerId);
  const receivedRow = db
    .prepare(
      `SELECT COALESCE(SUM(amount_usd), 0) AS total_received
       FROM payments
       WHERE owner_id = ? AND status = 'COMPLETED' AND capture_status = 'COMPLETED'`
    )
    .get(ownerId);
  return res.json({
    quests,
    claims,
    funding,
    received: Number(Number(receivedRow?.total_received || 0).toFixed(2)),
  });
});

app.get('/api/business/quests/:id', (req, res) => {
  const q = db.prepare('SELECT * FROM quests WHERE id = ?').get(req.params.id);
  if (!q) {
    return res.status(404).json({ error: 'Quest not found.' });
  }
  const p = getPlaceRow(q.place_id);
  if (!canManagePlace(p, req.user)) {
    return res.status(403).json({ error: 'Only the place owner or admin can inspect private brief.' });
  }
  return res.json({ quest: formatQuestDto(q, p, { includePrivate: true }) });
});

app.put('/api/quests/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM quests WHERE id = ?').get(req.params.id);
  if (!existing) {
    return res.status(404).json({ error: 'Quest not found.' });
  }
  const placeRow = getPlaceRow(existing.place_id);
  if (!canManagePlace(placeRow, req.user)) {
    return res.status(403).json({ error: 'Only the place owner or admin can edit this quest.' });
  }

  const b = req.body || {};
  const title = b.title !== undefined ? String(b.title).trim() : existing.title;
  const publicDescription =
    b.public_description !== undefined || b.description !== undefined
      ? String(b.public_description ?? b.description ?? '').trim()
      : existing.public_description;
  const publicObjective =
    b.public_objective !== undefined || b.objective !== undefined
      ? String(b.public_objective ?? b.objective ?? '').trim()
      : existing.public_objective;

  if (!title || !publicObjective) {
    return res.status(400).json({ error: 'title and public_objective are required.' });
  }

  const budgetUsd =
    b.budget_usd !== undefined || b.budgetUsd !== undefined
      ? Math.max(0, Number(b.budget_usd ?? b.budgetUsd ?? 0))
      : Number(existing.budget_usd || 0);
  const questType =
    budgetUsd > 0 && (b.quest_type || existing.quest_type) === 'purchase' ? 'purchase' : 'visit';
  const rawReward = b.reward || {};
  const minBillInr = Number(rawReward.min_bill_inr ?? b.min_bill_inr ?? existing.min_bill_inr ?? 0);
  const cashbackPercent = Number(rawReward.cashback_percent ?? b.cashback_percent ?? existing.cashback_percent ?? 0);
  const maxRewardUsd = Number(rawReward.max_reward_usd ?? b.max_reward_usd ?? existing.max_reward_usd ?? 0);
  const fixedRewardUsd = Number(rawReward.fixed_reward_usd ?? b.fixed_reward_usd ?? existing.fixed_reward_usd ?? 0);

  const normalizeArr = (arr) =>
    Array.isArray(arr) ? arr.map((x) => String(x).trim()).filter(Boolean) : [];
  const aiPrivateJson = b.ai_private
    ? JSON.stringify({
        must_show: normalizeArr(b.ai_private.must_show),
        reject_if: normalizeArr(b.ai_private.reject_if),
        bill_checks: budgetUsd > 0 && questType === 'purchase' ? normalizeArr(b.ai_private.bill_checks) : [],
        notes: String(b.ai_private.notes || b.aiInstructions || '').trim(),
      })
    : existing.ai_private;

  const nextRemaining =
    b.budget_remaining_usd !== undefined
      ? Math.max(0, Number(b.budget_remaining_usd))
      : existing.budget_remaining_usd > 0
      ? Math.max(0, Number((budgetUsd - Number(existing.spent_usd || 0)).toFixed(2)))
      : 0;

  db.prepare(
    `UPDATE quests
     SET title = ?, public_description = ?, public_objective = ?, photo_url = ?,
         difficulty = ?, est_minutes = ?, xp = ?, night_only = ?, radius_m = ?,
         quest_type = ?, text_answer_prompt = ?, min_bill_inr = ?, cashback_percent = ?,
         max_reward_usd = ?, fixed_reward_usd = ?, budget_usd = ?, budget_remaining_usd = ?,
         active = ?, ai_private = ?
     WHERE id = ?`
  ).run(
    title,
    publicDescription,
    publicObjective,
    b.photo_url !== undefined ? (b.photo_url ? String(b.photo_url).trim() : null) : existing.photo_url,
    b.difficulty !== undefined ? String(b.difficulty).trim() : existing.difficulty,
    b.est_minutes !== undefined ? Number(b.est_minutes) : existing.est_minutes,
    b.xp !== undefined ? Number(b.xp) : existing.xp,
    b.night_only !== undefined ? (b.night_only ? 1 : 0) : existing.night_only,
    b.radius_m !== undefined
      ? Math.max(50, Math.min(500, Math.round(Number(b.radius_m))))
      : existing.radius_m,
    questType,
    b.text_answer_prompt !== undefined
      ? b.text_answer_prompt
        ? String(b.text_answer_prompt).trim()
        : null
      : existing.text_answer_prompt,
    minBillInr,
    cashbackPercent,
    maxRewardUsd,
    fixedRewardUsd,
    budgetUsd,
    nextRemaining,
    b.active !== undefined ? (b.active ? 1 : 0) : existing.active,
    aiPrivateJson,
    existing.id
  );

  return res.json({
    quest: getQuestDtoById(existing.id, { includePrivate: false }),
    hasAiBrief: true,
  });
});

app.delete('/api/quests/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM quests WHERE id = ?').get(req.params.id);
  if (existing) {
    const placeRow = getPlaceRow(existing.place_id);
    if (!canManagePlace(placeRow, req.user)) {
      return res.status(403).json({ error: 'Only the place owner or admin can delete this quest.' });
    }
    db.prepare('DELETE FROM quests WHERE id = ?').run(req.params.id);
  }
  return res.json({ deleted: true, id: req.params.id });
});

// Admin-only routes (403 for everyone except ADMIN_EMAIL)
app.post('/api/admin/places', requireAdmin, (req, res) => {
  const b = req.body || {};
  if (!b.name || !b.address) {
    return res.status(400).json({ error: 'name and address are required.' });
  }
  const placeId = `plc-${Date.now()}`;
  db.prepare(
    `INSERT INTO places (id, name, address, lat, lng, category, photo_url, city, maps_link, owner_id, claim_status, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    placeId,
    String(b.name).trim(),
    String(b.address).trim(),
    typeof b.lat === 'number' ? b.lat : null,
    typeof b.lng === 'number' ? b.lng : null,
    b.category ? String(b.category).trim() : 'Explore',
    b.photo_url || null,
    b.city ? String(b.city).trim() : 'Bengaluru',
    b.maps_link || null,
    b.owner_id || null,
    b.owner_id ? 'approved' : 'none',
    req.user.id,
    new Date().toISOString()
  );
  return res.status(201).json({ place: formatPlaceDto(getPlaceRow(placeId)) });
});

app.patch('/api/admin/places/:id', requireAdmin, (req, res) => {
  const existing = getPlaceRow(req.params.id);
  if (!existing) {
    return res.status(404).json({ error: 'Place not found.' });
  }
  const b = req.body || {};
  db.prepare(
    `UPDATE places
     SET name = COALESCE(?, name),
         address = COALESCE(?, address),
         lat = COALESCE(?, lat),
         lng = COALESCE(?, lng),
         category = COALESCE(?, category),
         photo_url = COALESCE(?, photo_url),
         city = COALESCE(?, city)
     WHERE id = ?`
  ).run(
    b.name !== undefined ? String(b.name).trim() : null,
    b.address !== undefined ? String(b.address).trim() : null,
    typeof b.lat === 'number' ? b.lat : null,
    typeof b.lng === 'number' ? b.lng : null,
    b.category !== undefined ? String(b.category).trim() : null,
    b.photo_url !== undefined ? b.photo_url : null,
    b.city !== undefined ? String(b.city).trim() : null,
    existing.id
  );
  return res.json({ place: formatPlaceDto(getPlaceRow(existing.id)) });
});

app.post('/api/admin/quests', requireAdmin, (req, res) => {
  const result = insertQuestIntoDb({
    body: req.body,
    req,
    createdBy: req.user.id,
    forceAdmin: true,
  });
  if (result.error) {
    return res.status(result.errorStatus).json({ error: result.error });
  }
  return res.status(201).json({
    quest: getQuestDtoById(result.questId, { includePrivate: true }),
  });
});

app.get('/api/admin/quests/:id', requireAdmin, (req, res) => {
  const quest = getQuestDtoById(req.params.id, { includePrivate: true });
  if (!quest) {
    return res.status(404).json({ error: 'Quest not found.' });
  }
  return res.json({ quest });
});

app.patch('/api/admin/quests/:id', requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT * FROM quests WHERE id = ?').get(req.params.id);
  if (!existing) {
    return res.status(404).json({ error: 'Quest not found.' });
  }
  const b = req.body || {};
  db.prepare(
    `UPDATE quests
     SET title = COALESCE(?, title),
         public_description = COALESCE(?, public_description),
         public_objective = COALESCE(?, public_objective),
         active = COALESCE(?, active),
         budget_usd = COALESCE(?, budget_usd),
         budget_remaining_usd = COALESCE(?, budget_remaining_usd),
         demo_budget = COALESCE(?, demo_budget),
         xp = COALESCE(?, xp),
         radius_m = COALESCE(?, radius_m),
         night_only = COALESCE(?, night_only),
         ai_private = COALESCE(?, ai_private)
     WHERE id = ?`
  ).run(
    b.title !== undefined ? String(b.title).trim() : null,
    b.public_description !== undefined ? String(b.public_description).trim() : null,
    b.public_objective !== undefined ? String(b.public_objective).trim() : null,
    b.active !== undefined ? (b.active ? 1 : 0) : null,
    typeof b.budget_usd === 'number' ? b.budget_usd : null,
    typeof b.budget_remaining_usd === 'number' ? b.budget_remaining_usd : null,
    b.demo_budget !== undefined ? (b.demo_budget ? 1 : 0) : null,
    typeof b.xp === 'number' ? b.xp : null,
    typeof b.radius_m === 'number' ? b.radius_m : null,
    b.night_only !== undefined ? (b.night_only ? 1 : 0) : null,
    b.ai_private ? JSON.stringify(b.ai_private) : null,
    existing.id
  );
  return res.json({ quest: getQuestDtoById(existing.id, { includePrivate: true }) });
});

app.get('/api/admin/claims', requireAdmin, (req, res) => {
  const status = String(req.query?.status || 'pending').toLowerCase();
  const baseSelect = `
    SELECT p.*, u.email AS claimant_email, u.name AS claimant_name
    FROM places p
    LEFT JOIN users u ON u.id = COALESCE(p.claimed_by, p.owner_id)
  `;
  const rows =
    status === 'all'
      ? db.prepare(`${baseSelect} WHERE p.claim_status != 'none' ORDER BY p.created_at DESC`).all()
      : db.prepare(`${baseSelect} WHERE p.claim_status = 'pending' ORDER BY p.created_at DESC`).all();
  return res.json({
    claims: rows.map((p) => ({
      ...formatPlaceDto(p),
      claimed_by: p.claimed_by,
      claimant_email: p.claimant_email || null,
      claimant_name: p.claimant_name || null,
      claim_business_name: p.claim_business_name || null,
      claim_paypal_email: p.claim_paypal_email || null,
    })),
  });
});

app.post('/api/admin/claims/:placeId/approve', requireAdmin, (req, res) => {
  const place = getPlaceRow(req.params.placeId);
  if (!place) {
    return res.status(404).json({ error: 'Place not found.' });
  }
  const ownerId = req.body?.owner_id || place.claimed_by;
  if (!ownerId) {
    return res.status(400).json({ error: 'No claimant user found on this place.' });
  }
  db.prepare(
    `UPDATE places SET owner_id = ?, claim_status = 'approved', claim_note = COALESCE(?, claim_note) WHERE id = ?`
  ).run(ownerId, req.body?.note ? String(req.body.note).trim() : null, place.id);

  if (place.claim_business_name || place.claim_paypal_email) {
    db.prepare(
      `UPDATE users
       SET business_name = COALESCE(?, business_name),
           paypal_email = COALESCE(?, paypal_email)
       WHERE id = ?`
    ).run(place.claim_business_name || null, place.claim_paypal_email || null, ownerId);
  }
  return res.json({ place: formatPlaceDto(getPlaceRow(place.id)) });
});

app.post('/api/admin/claims/:placeId/reject', requireAdmin, (req, res) => {
  const place = getPlaceRow(req.params.placeId);
  if (!place) {
    return res.status(404).json({ error: 'Place not found.' });
  }
  db.prepare(
    `UPDATE places SET owner_id = NULL, claim_status = 'rejected', claim_note = ? WHERE id = ?`
  ).run(req.body?.note ? String(req.body.note).trim() : 'Verification removed by Superadmin', place.id);
  return res.json({ place: formatPlaceDto(getPlaceRow(place.id)) });
});

app.post('/api/claims/:id/escalate', (req, res) => {
  const claim = getClaimById(req.params.id);
  if (!claim) {
    return res.status(404).json({ error: 'Claim not found.' });
  }
  const questRow = db.prepare('SELECT * FROM quests WHERE id = ?').get(claim.questId);
  const placeRow = questRow ? getPlaceRow(questRow.place_id) : null;
  if (!canManagePlace(placeRow, req.user)) {
    return res.status(403).json({
      error: 'Only the place owner can escalate this claim for Superhost cashback verification.',
    });
  }
  claim.status = 'pending_superhost';
  claim.reviewNote = String(
    req.body?.note || 'Owner verified visit as genuine — awaiting Superhost cashback release.'
  ).trim();
  claim.escalatedAt = new Date().toISOString();
  claim.escalatedBy = req.user.email;
  persistClaimRecord(claim, null);
  return res.json({ claim });
});

app.get('/api/admin/escalated-claims', requireAdmin, (req, res) => {
  const rows = listClaims({ status: 'pending_superhost' });
  return res.json({ claims: rows });
});

app.post('/api/admin/claims/:id/release-cashback', requireAdmin, async (req, res) => {
  try {
    const claim = getClaimById(req.params.id);
    if (!claim) {
      return res.status(404).json({ error: 'Claim not found.' });
    }
    const questRow = db.prepare('SELECT * FROM quests WHERE id = ?').get(claim.questId);
    if (!questRow) {
      return res.status(404).json({ error: 'Quest not found.' });
    }
    const remainingBudget = Number(questRow.budget_remaining_usd || 0);
    let rewardUsd = Number(claim.rewardUsd || 0);
    if (rewardUsd <= 0 && remainingBudget > 0) {
      if (questRow.quest_type === 'visit') {
        rewardUsd = Number(questRow.fixed_reward_usd || 0.25);
      } else {
        const pct = Number(questRow.cashback_percent || 15);
        const maxR = Number(questRow.max_reward_usd || 2.0);
        const billUsd = Number(claim.paidUsd || Number(claim.billInr || 0) / USD_TO_INR || 0);
        rewardUsd = Math.min(maxR, Number(((billUsd * pct) / 100).toFixed(2)));
      }
    }
    const finalRewardUsd = Math.min(remainingBudget, Math.max(0, Number(rewardUsd.toFixed(2))));
    const paidNow = new Date().toISOString();

    let payoutRecord = null;
    if (finalRewardUsd > 0) {
      const receiverEmail =
        claim.paypalEmail || process.env.PAYPAL_TEST_PAYOUT_EMAIL || 'sb-traveler@personal.example.com';
      const payout = await createTravelerPayout({
        receiverEmail,
        amountUsd: finalRewardUsd,
        questTitle: claim.questTitle || questRow.title,
        claimId: claim.id,
        simulate: Boolean(claim.demoMode),
      });
      payoutRecord = recordPayoutLedger({
        questId: questRow.id,
        questTitle: claim.questTitle || questRow.title,
        amountUsd: finalRewardUsd,
        payout,
      });
      const nextRemaining = Math.max(0, Number((remainingBudget - finalRewardUsd).toFixed(2)));
      db.prepare(
        `UPDATE quests
         SET budget_remaining_usd = ?, spent_usd = spent_usd + ?, verified_visits = verified_visits + 1
         WHERE id = ?`
      ).run(nextRemaining, finalRewardUsd, questRow.id);
      claim.budgetRemainingUsd = nextRemaining;
    } else {
      db.prepare('UPDATE quests SET verified_visits = verified_visits + 1 WHERE id = ?').run(questRow.id);
    }

    claim.rewardUsd = finalRewardUsd;
    claim.status = 'paid';
    claim.paidAt = paidNow;
    claim.reviewedAt = paidNow;
    claim.reviewNote = `Verified by owner & cashback ($${finalRewardUsd.toFixed(2)} USD) released by Superhost.`;
    claim.payout = payoutRecord;
    persistClaimRecord(claim, null);

    await notifyBusiness(claim, {
      event: 'claim_paid',
      budgetRemainingUsd: claim.budgetRemainingUsd ?? remainingBudget,
    }).catch(() => {});

    return res.json({ claim });
  } catch (err) {
    console.error('[POST /api/admin/claims/:id/release-cashback]', err);
    return res.status(err.status || 500).json({ error: err.message });
  }
});

// AI Vision Verification
app.post('/api/verify', async (req, res) => {
  try {
    const { imageBase64, mimeType, quest, demoMode } = req.body || {};
    if (!quest) {
      return res.status(400).json({ error: 'quest object is required.' });
    }
    const resolvedQuest =
      (quest.id ? getQuestDtoById(quest.id, { includePrivate: true }) : null) || quest;
    const result = await verifyQuestProof({
      imageBase64,
      mimeType,
      quest: resolvedQuest,
      demoMode: Boolean(demoMode),
    });
    res.json(result);
  } catch (err) {
    console.error('[POST /api/verify]', err);
    res.status(500).json({
      verified: false,
      confidence: 0,
      reason: 'Server verification error. Please try again.',
      error: err.message,
    });
  }
});

// PayPal Orders v2: create & capture
app.post('/api/quests/fund', async (req, res) => {
  try {
    const {
      action = 'create',
      questId,
      questTitle,
      amountUsd,
      orderId,
      appReturnUrl,
      simulate = false,
    } = req.body || {};

    const questRow = questId ? db.prepare('SELECT * FROM quests WHERE id = ?').get(questId) : null;
    const placeRow = questRow ? getPlaceRow(questRow.place_id) : null;
    if (placeRow && !canManagePlace(placeRow, req.user)) {
      return res.status(403).json({
        error: 'Only the place owner or Superadmin can fund this quest.',
      });
    }

    if (action !== 'capture') {
      const existingTarget = getQuestDtoById(questId);
      if (existingTarget?.funded) {
        return res.status(400).json({ error: 'Quest is already funded.' });
      }
    }

    if (action === 'capture') {
      const captureResult = await captureFundingOrder({ orderId, amountUsd });
      const target = getQuestDtoById(questId);
      const fundedAmt = Number(captureResult.amountUsd || target?.budget_usd || amountUsd || 20);
      if (target) {
        db.prepare(
          `UPDATE quests
           SET budget_usd = ?, budget_remaining_usd = ?, demo_budget = 0
           WHERE id = ?`
        ).run(fundedAmt, fundedAmt, target.id);
        db.prepare(
          `INSERT INTO funding (id, owner_id, quest_id, paypal_order_id, amount_usd, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(
          `fnd-${Date.now()}`,
          req.user?.id || null,
          target.id,
          captureResult.orderId,
          fundedAmt,
          captureResult.status || 'COMPLETED',
          new Date().toISOString()
        );
      }
      recordFundingOrder({
        id: captureResult.orderId,
        captureId: captureResult.captureId,
        questId: questId || target?.id || '',
        questTitle: target?.title || 'ROAMR Quest',
        amountUsd: fundedAmt,
        status: captureResult.status || 'COMPLETED',
        simulated: Boolean(captureResult.simulated),
        debugId: captureResult.debugId || null,
        createdAt: new Date().toISOString(),
      });
      return res.json({
        ...captureResult,
        quest: questId ? getQuestDtoById(questId, { includePrivate: false }) : null,
      });
    }

    const base = getServerBaseUrl(req);
    const encodedAppReturn = encodeURIComponent(appReturnUrl || 'roamr://paypal-return');
    const returnUrl = `${base}/paypal/return?questId=${encodeURIComponent(
      questId || ''
    )}&amountUsd=${encodeURIComponent(amountUsd || 50)}&appReturnUrl=${encodedAppReturn}`;
    const cancelUrl = `${base}/paypal/cancel?questId=${encodeURIComponent(
      questId || ''
    )}&appReturnUrl=${encodedAppReturn}`;

    const orderResult = await createFundingOrder({
      questId,
      questTitle,
      amountUsd,
      returnUrl,
      cancelUrl,
      simulate: Boolean(simulate),
    });
    return res.json(orderResult);
  } catch (err) {
    console.error('[POST /api/quests/fund]', err);
    res.status(err.status || 500).json({
      error: err.message,
      debugId: err.debugId || null,
      details: err.paypalBody || null,
    });
  }
});

// PayPal web return bridge -> captures order server-side, then redirects to Expo Go / app deep link
app.get('/paypal/return', async (req, res) => {
  const { token: orderId, questId, amountUsd, appReturnUrl } = req.query;
  const fallbackAppUrl = String(appReturnUrl || 'roamr://paypal-return');

  try {
    const captureResult = await captureFundingOrder({
      orderId: String(orderId || ''),
      amountUsd: Number(amountUsd || 50),
    });

    const target = getQuestDtoById(String(questId || ''));
    const fundedAmt = Number(captureResult.amountUsd || target?.budget_usd || amountUsd || 20);
    if (target) {
      db.prepare(
        `UPDATE quests
         SET budget_usd = ?, budget_remaining_usd = ?, demo_budget = 0
         WHERE id = ?`
      ).run(fundedAmt, fundedAmt, target.id);
      db.prepare(
        `INSERT INTO funding (id, owner_id, quest_id, paypal_order_id, amount_usd, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        `fnd-${Date.now()}`,
        target.owner_id || null,
        target.id,
        captureResult.orderId,
        fundedAmt,
        captureResult.status || 'COMPLETED',
        new Date().toISOString()
      );
    }

    recordFundingOrder({
      id: captureResult.orderId,
      captureId: captureResult.captureId,
      questId: String(questId || target?.id || ''),
      questTitle: target?.title || 'ROAMR Quest',
      amountUsd: Number(captureResult.amountUsd || amountUsd || 50),
      status: captureResult.status || 'COMPLETED',
      simulated: Boolean(captureResult.simulated),
      debugId: captureResult.debugId || null,
      createdAt: new Date().toISOString(),
    });

    const sep = fallbackAppUrl.includes('?') ? '&' : '?';
    const deepLink = `${fallbackAppUrl}${sep}status=captured&questId=${encodeURIComponent(
      String(questId || target?.id || '')
    )}&orderId=${encodeURIComponent(
      captureResult.orderId
    )}&captureId=${encodeURIComponent(captureResult.captureId)}&amountUsd=${encodeURIComponent(
      captureResult.amountUsd
    )}&simulated=${captureResult.simulated ? '1' : '0'}`;

    res.setHeader('Content-Type', 'text/html');
    res.send(
      renderReturnRedirectHtml({
        title: 'Payment Captured!',
        subtitle: `PayPal order ${captureResult.orderId} is complete ($${Number(
          captureResult.amountUsd
        ).toFixed(2)} USD). Returning you to ROAMR...`,
        deepLink,
      })
    );
  } catch (err) {
    const sep = fallbackAppUrl.includes('?') ? '&' : '?';
    const deepLink = `${fallbackAppUrl}${sep}status=error&message=${encodeURIComponent(err.message)}`;
    res.status(500).setHeader('Content-Type', 'text/html');
    res.send(
      renderReturnRedirectHtml({
        title: 'PayPal Capture Failed',
        subtitle: err.message,
        deepLink,
      })
    );
  }
});

app.get('/paypal/cancel', (req, res) => {
  const fallbackAppUrl = String(req.query.appReturnUrl || 'roamr://paypal-return');
  const sep = fallbackAppUrl.includes('?') ? '&' : '?';
  const deepLink = `${fallbackAppUrl}${sep}status=cancelled`;
  res.setHeader('Content-Type', 'text/html');
  res.send(
    renderReturnRedirectHtml({
      title: 'Payment Cancelled',
      subtitle: 'No funds were charged. Returning you to ROAMR...',
      deepLink,
    })
  );
});

// PayPal Payouts v1 after AI verification
app.post('/api/payouts', async (req, res) => {
  try {
    const { questId, questTitle, amountUsd, receiverEmail, verified } = req.body || {};
    if (!verified) {
      return res.status(400).json({
        error: 'Payout blocked: AI verification must pass before releasing funds.',
      });
    }

    const payout = await createTravelerPayout({
      questId,
      questTitle,
      amountUsd,
      receiverEmail,
    });

    const record = recordPayoutLedger({
      questId,
      questTitle,
      amountUsd,
      payout,
    });

    res.json({ payout: record });
  } catch (err) {
    console.error('[POST /api/payouts]', err);
    res.status(err.status || 500).json({ error: err.message, debugId: err.debugId || null });
  }
});

app.get('/api/payouts/:batchId', async (req, res) => {
  try {
    const status = await getPayoutStatus(req.params.batchId);
    const stored = payoutsStore.find((p) => p.id === req.params.batchId);
    if (stored && status.payoutStatus) {
      stored.status = status.payoutStatus;
    }
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/paypal/logs', (req, res) => {
  res.json({ logs: getPayPalLogs() });
});

app.get('/api/paypal/transactions', (req, res) => {
  res.json({
    fundingOrders: fundingOrdersStore,
    payouts: payoutsStore,
  });
});

// Traveler visit submissions & post-AI human verification
app.get('/api/submissions', (req, res) => {
  const { questId } = req.query || {};
  const list = questId
    ? submissionsStore.filter((s) => s.questId === String(questId))
    : submissionsStore;
  res.json({ submissions: list });
});

app.post('/api/submissions', (req, res) => {
  const body = req.body || {};
  if (!body.questId) {
    return res.status(400).json({ error: 'questId is required.' });
  }
  const submission = {
    id: body.id || `sub-${Date.now()}`,
    questId: String(body.questId),
    questTitle: body.questTitle || 'ROAMR Quest',
    businessName: body.businessName || 'Local Partner',
    travelerName: body.travelerName || 'ROAMR Explorer',
    travelerEmail: body.travelerEmail || '',
    travelerAvatar: body.travelerAvatar || null,
    paypalEmail: body.paypalEmail || 'sb-traveler@personal.example.com',
    photoUri: body.photoUri || null,
    submittedAt: body.submittedAt || new Date().toISOString(),
    aiVerified: Boolean(body.aiVerified ?? true),
    aiConfidence: Number(body.aiConfidence ?? 0.9),
    aiReason: body.aiReason || 'AI Vision check passed.',
    rewardUsd: Number(body.rewardUsd ?? 5),
    xp: Number(body.xp ?? 50),
    status: 'pending_review',
  };
  submissionsStore.unshift(submission);
  res.status(201).json({ submission });
});

app.post('/api/submissions/:id/review', async (req, res) => {
  try {
    const { decision = 'approve', reviewNote, submission: clientSubmission } = req.body || {};
    let sub = submissionsStore.find((s) => s.id === req.params.id);
    if (!sub && clientSubmission) {
      sub = { ...clientSubmission, id: req.params.id };
      submissionsStore.unshift(sub);
    }
    if (!sub) {
      return res.status(404).json({ error: 'Submission not found.' });
    }

    sub.reviewedAt = new Date().toISOString();
    sub.reviewNote = reviewNote || undefined;

    if (decision === 'reject') {
      sub.status = 'rejected';
      return res.json({ submission: sub, payout: null });
    }

    const payout = await createTravelerPayout({
      questId: sub.questId,
      questTitle: sub.questTitle,
      amountUsd: sub.rewardUsd,
      receiverEmail: sub.paypalEmail,
    });
    const record = recordPayoutLedger({
      questId: sub.questId,
      questTitle: sub.questTitle,
      amountUsd: sub.rewardUsd,
      payout,
    });

    sub.status = 'approved';
    sub.payoutId = record.id;
    sub.payoutStatus = record.status;

    res.json({ submission: sub, payout: record });
  } catch (err) {
    console.error('[POST /api/submissions/:id/review]', err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Business AI weekly insight
app.post('/api/business/insight', async (req, res) => {
  try {
    const { verifiedVisits = 0, moneySpent = 0, costPerVisit = 0, quests = [] } = req.body || {};
    const result = await generateWeeklyInsight({
      verifiedVisits,
      moneySpent,
      costPerVisit,
      quests: quests.length ? quests : listQuestDtos({ includePrivate: false }),
    });
    res.json(result);
  } catch (err) {
    console.error('[POST /api/business/insight]', err);
    res.status(500).json({ error: err.message });
  }
});

// AI personalized quest generation
app.post('/api/quests/generate', async (req, res) => {
  try {
    const { interests = [], city = 'San Francisco', businesses = [] } = req.body || {};
    const result = await generatePersonalizedQuests({
      interests,
      city,
      businesses: businesses.length ? businesses : listQuestDtos({ includePrivate: false }),
    });
    res.json(result);
  } catch (err) {
    console.error('[POST /api/quests/generate]', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// END-TO-END VERIFICATION PIPELINE (Check-in Order -> GPS+Camera Claim -> Gemini -> Business Review -> Payout)
// ============================================================================

function recordPaymentInDb(cap, questId, userId = null) {
  const orderStatus = String(cap?.status || '').toUpperCase();
  const captureStatus = String(cap?.captureStatus || 'COMPLETED').toUpperCase();
  if (orderStatus !== 'COMPLETED' || captureStatus !== 'COMPLETED') {
    return null;
  }
  const qRow = questId ? db.prepare('SELECT id, place_id FROM quests WHERE id = ?').get(questId) : null;
  const pRow = qRow?.place_id ? getPlaceRow(qRow.place_id) : null;
  let parsedCustom = {};
  if (cap?.customId) {
    try {
      parsedCustom = JSON.parse(cap.customId);
    } catch {}
  }
  const resolvedQuestId = qRow?.id || questId || parsedCustom.q || null;
  const resolvedPlaceId = pRow?.id || parsedCustom.p || null;
  const resolvedOwnerId = pRow?.owner_id || null;
  const resolvedUserId = userId || parsedCustom.u || null;
  const nowIso = new Date().toISOString();

  db.prepare(
    `INSERT INTO payments (
      id, order_id, capture_id, quest_id, place_id, owner_id, user_id,
      amount_usd, currency, status, capture_status, payee_email,
      payer_email, payer_name, custom_id, simulated, debug_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'USD', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(order_id) DO UPDATE SET
      capture_id = excluded.capture_id,
      status = excluded.status,
      capture_status = excluded.capture_status,
      payee_email = excluded.payee_email,
      payer_email = excluded.payer_email,
      payer_name = excluded.payer_name`
  ).run(
    `pay-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    cap.orderId,
    cap.captureId || cap.orderId,
    resolvedQuestId,
    resolvedPlaceId,
    resolvedOwnerId,
    resolvedUserId,
    Number(cap.amountUsd || 0),
    orderStatus,
    captureStatus,
    cap.payeeEmail || '',
    cap.payerEmail || '',
    cap.payerName || '',
    cap.customId || '',
    cap.simulated ? 1 : 0,
    cap.debugId || null,
    nowIso
  );
  return cap;
}

app.post('/api/checkin/order', async (req, res) => {
  try {
    const {
      action = 'create',
      questId,
      questTitle,
      merchantEmail,
      amountUsd,
      orderId,
      appReturnUrl,
      simulate = false,
      payerOverride,
    } = req.body || {};

    const quest = getQuestDtoById(questId);
    const placeRow = quest?.place_id ? getPlaceRow(quest.place_id) : null;
    const superadmin = ensureSuperadminUser();
    const isSuperadminOwned = Boolean(placeRow?.owner_id && placeRow.owner_id === superadmin.id);
    const resolvedMerchant = isSuperadminOwned
      ? getSuperadminPaypalEmail()
      : (merchantEmail && String(merchantEmail).trim()) ||
        quest?.merchantEmail ||
        getSuperadminPaypalEmail();
    const resolvedAmount = Number(amountUsd || quest?.minCheckinUsd || 1.0);

    if (action === 'capture') {
      const cap = await captureCheckinOrder({
        orderId,
        questId: questId || quest?.id || '',
        expectedAmountUsd: resolvedAmount,
        expectedMerchantEmail: resolvedMerchant,
        payerOverride,
      });
      const enriched = recordCapturedCheckinOrder({
        ...cap,
        ...(Number(req.body?.billInr) > 0 ? { billInr: Math.round(Number(req.body.billInr)) } : {}),
        ...(payerOverride?.name ? { payerName: payerOverride.name } : {}),
        ...(payerOverride?.email ? { payerEmail: payerOverride.email } : {}),
      }) || cap;
      recordPaymentInDb(enriched, questId || quest?.id || '', req.user?.id || null);
      console.log(
        `[CHECKIN CAPTURE] orderId=${enriched.orderId} captureStatus=${enriched.captureStatus || enriched.status} amount=$${enriched.amountUsd} payee=${enriched.payeeEmail}`
      );
      return res.json(enriched);
    }

    const base = getServerBaseUrl(req);
    const encodedAppReturn = encodeURIComponent(appReturnUrl || 'roamr://paypal-return');
    const billInrParam = Number(req.body?.billInr || 0);
    const travelerNameParam = String(payerOverride?.name || '').trim();
    const travelerEmailParam = String(payerOverride?.email || '').trim();
    const userIdParam = String(req.user?.id || '').trim();
    const returnUrl = `${base}/paypal/checkin-return?questId=${encodeURIComponent(
      questId || ''
    )}&userId=${encodeURIComponent(userIdParam)}&amountUsd=${encodeURIComponent(
      resolvedAmount
    )}&billInr=${encodeURIComponent(billInrParam)}&travelerName=${encodeURIComponent(
      travelerNameParam
    )}&travelerEmail=${encodeURIComponent(
      travelerEmailParam
    )}&appReturnUrl=${encodedAppReturn}`;
    const cancelUrl = `${base}/paypal/checkin-cancel?questId=${encodeURIComponent(
      questId || ''
    )}&appReturnUrl=${encodedAppReturn}`;

    const orderResult = await createCheckinOrder({
      questId,
      placeId: placeRow?.id || quest?.place_id || '',
      userId: userIdParam,
      questTitle: questTitle || quest?.title || 'ROAMR Check-in',
      merchantEmail: resolvedMerchant,
      amountUsd: resolvedAmount,
      returnUrl,
      cancelUrl,
      simulate: Boolean(simulate),
    });

    console.log(
      `[CHECKIN CREATE] quest=${questId} orderId=${orderResult.orderId} payee=${orderResult.payeeEmail} simulated=${orderResult.simulated}`
    );
    return res.json(orderResult);
  } catch (err) {
    console.error('[POST /api/checkin/order]', err);
    return res.status(err.status || 500).json({
      error: err.message,
      debugId: err.debugId || null,
      details: err.paypalBody || null,
    });
  }
});

app.get('/paypal/checkin-return', async (req, res) => {
  const {
    token: orderId,
    questId,
    userId,
    amountUsd,
    merchantEmail,
    billInr,
    travelerName,
    travelerEmail,
    appReturnUrl,
  } = req.query;
  const fallbackAppUrl = String(appReturnUrl || 'roamr://paypal-return');

  try {
    const cap = await captureCheckinOrder({
      orderId: String(orderId || ''),
      questId: String(questId || ''),
      expectedAmountUsd: Number(amountUsd || 1.0),
      expectedMerchantEmail: String(merchantEmail || ''),
      payerOverride:
        travelerName || travelerEmail
          ? { name: String(travelerName || ''), email: String(travelerEmail || '') }
          : undefined,
    });
    const enriched =
      recordCapturedCheckinOrder({
        ...cap,
        ...(Number(billInr) > 0 ? { billInr: Math.round(Number(billInr)) } : {}),
      }) || cap;
    recordPaymentInDb(enriched, String(questId || ''), userId ? String(userId) : null);

    const sep = fallbackAppUrl.includes('?') ? '&' : '?';
    const deepLink =
      `${fallbackAppUrl}${sep}checkin=1&status=captured` +
      `&questId=${encodeURIComponent(String(questId || ''))}` +
      `&orderId=${encodeURIComponent(cap.orderId)}` +
      `&captureId=${encodeURIComponent(cap.captureId)}` +
      `&captureStatus=${encodeURIComponent(cap.captureStatus || cap.status || 'COMPLETED')}` +
      `&amountUsd=${encodeURIComponent(cap.amountUsd)}` +
      `&payeeEmail=${encodeURIComponent(cap.payeeEmail || '')}` +
      `&payerName=${encodeURIComponent(cap.payerName || '')}` +
      `&payerEmail=${encodeURIComponent(cap.payerEmail || '')}` +
      `&payerId=${encodeURIComponent(cap.payerId || '')}` +
      `&simulated=${cap.simulated ? '1' : '0'}`;

    return res.redirect(302, deepLink);
  } catch (err) {
    const sep = fallbackAppUrl.includes('?') ? '&' : '?';
    const deepLink = `${fallbackAppUrl}${sep}checkin=1&status=error&message=${encodeURIComponent(
      err.message
    )}`;
    return res.redirect(302, deepLink);
  }
});

app.get('/api/dev/paypal/order/:id', async (req, res) => {
  try {
    const details = await fetchOrderFromPayPal(req.params.id);
    return res.json(details);
  } catch (err) {
    return res.status(err.status || 500).json({
      error: err.message,
      debugId: err.debugId || null,
      details: err.paypalBody || null,
    });
  }
});

app.get('/paypal/checkin-cancel', (req, res) => {
  const fallbackAppUrl = String(req.query.appReturnUrl || 'roamr://paypal-return');
  const sep = fallbackAppUrl.includes('?') ? '&' : '?';
  const deepLink = `${fallbackAppUrl}${sep}checkin=1&status=cancelled`;
  res.setHeader('Content-Type', 'text/html');
  res.send(
    renderReturnRedirectHtml({
      title: 'Check-In Cancelled',
      subtitle: 'No funds were charged. Returning to ROAMR...',
      deepLink,
    })
  );
});

function isDemoClaim(c) {
  const oid = String(c?.order?.orderId || '');
  return Boolean(
    c?.demoMode ||
      String(c?.id || '').startsWith('claim-test-') ||
      oid.startsWith('TEST-ORD-') ||
      oid.startsWith('SIM-') ||
      c?.order?.simulated === true
  );
}

app.get('/api/checkin/orders', (req, res) => {
  const { questId, includeDemo, demo } = req.query || {};
  const allowDemo =
    String(includeDemo || demo || '').toLowerCase() === '1' ||
    String(includeDemo || demo || '').toLowerCase() === 'true';
  const claimedOrderIds = new Set(
    listClaims({})
      .map((c) => c?.order?.orderId)
      .filter(Boolean)
  );
  const rows = listCheckinOrders({ questId }).filter((o) => {
    if (String(o.status || '').toUpperCase() !== 'COMPLETED') return false;
    if (claimedOrderIds.has(o.orderId)) return false;
    const isDemoOrder =
      Boolean(o.simulated) ||
      String(o.orderId || '').startsWith('SIM-') ||
      String(o.orderId || '').startsWith('TEST-');
    return allowDemo ? true : !isDemoOrder;
  });
  res.json({ orders: rows });
});

app.get('/api/claims', (req, res) => {
  const { questId, status, travelerEmail, includeDemo, demo, scope } = req.query || {};
  const allowDemo = String(includeDemo || demo || '').toLowerCase() === '1' ||
    String(includeDemo || demo || '').toLowerCase() === 'true';

  if (String(scope || '').toLowerCase() === 'owner') {
    let scoped = getScopedOwnerClaims(req.user.id);
    if (questId) scoped = scoped.filter((c) => c.questId === String(questId));
    if (status) scoped = scoped.filter((c) => c.status === String(status));
    return res.json({ claims: allowDemo ? scoped : scoped.filter((c) => !isDemoClaim(c)) });
  }

  const rows = listClaims({ questId, status, travelerEmail });
  const visible =
    req.user.role === 'admin'
      ? rows
      : rows.filter((c) => {
          const isTraveler =
            c.travelerEmail &&
            String(c.travelerEmail).toLowerCase() === String(req.user.email || '').toLowerCase();
          if (isTraveler) return true;
          const qRow = db.prepare('SELECT place_id FROM quests WHERE id = ?').get(c.questId);
          const pRow = qRow ? getPlaceRow(qRow.place_id) : null;
          return Boolean(pRow?.owner_id && pRow.owner_id === req.user.id);
        });
  res.json({ claims: allowDemo ? visible : visible.filter((c) => !isDemoClaim(c)) });
});

app.get('/api/claims/:id', (req, res) => {
  const claim = getClaimById(req.params.id);
  if (!claim) {
    return res.status(404).json({ error: 'Claim not found.' });
  }
  if (req.user.role !== 'admin') {
    const isTraveler =
      claim.travelerEmail &&
      String(claim.travelerEmail).toLowerCase() === String(req.user.email || '').toLowerCase();
    const qRow = db.prepare('SELECT place_id FROM quests WHERE id = ?').get(claim.questId);
    const pRow = qRow ? getPlaceRow(qRow.place_id) : null;
    const isOwner = Boolean(pRow?.owner_id && pRow.owner_id === req.user.id);
    if (!isTraveler && !isOwner) {
      return res.status(403).json({ error: 'You do not have access to this claim.' });
    }
  }
  res.json({ claim });
});

app.post('/api/dev/test-zapier', async (req, res) => {
  try {
    const superhostEmail = String(process.env.ADMIN_EMAIL || 'tsrinath2020@gmail.com').trim();
    const businessEmail = String(
      req.body?.to_email ||
        req.body?.business_email ||
        process.env.BUSINESS_TEST_EMAIL ||
        superhostEmail
    ).trim();

    const claimId = `claim-test-${Date.now()}`;
    const nowIso = new Date().toISOString();

    const sampleClaim = {
      id: claimId,
      questId: 'matteo-coffea',
      questTitle: 'Espresso Break at Matteo Coffea',
      businessName: 'Matteo Coffea',
      businessEmail,
      hostEmail: businessEmail,
      superhostEmail,
      billInr: 420,
      paidUsd: 5.0,
      rewardUsd: 0.75,
      budgetRemainingUsd: 19.25,
      xp: 25,
      travelerName: 'Alex Rivera',
      travelerEmail: 'alex@roamr.app',
      paypalEmail: 'sb-traveler@personal.example.com',
      photoUri:
        'https://images.unsplash.com/photo-1509042239860-f550ce710b93?auto=format&fit=crop&w=800&q=80',
      billPhotoUri:
        'https://images.unsplash.com/photo-1554224155-6726b3ff858f?auto=format&fit=crop&w=800&q=80',
      gps: { latitude: 12.9754, longitude: 77.6025, mocked: false },
      resolvedAddress: 'Church Street, Bengaluru',
      distanceMeters: 24,
      demoMode: true,
      order: {
        orderId: `TEST-ORD-${Date.now()}`,
        captureId: `TEST-CAP-${Date.now()}`,
        status: 'COMPLETED',
        amountUsd: 5.0,
        payeeEmail: businessEmail,
        payerName: 'Alex Rivera',
        payerEmail: 'alex@roamr.app',
      },
      aiVerdict: {
        verdict: 'pass',
        confidence: 0.92,
        reasons: [
          'Coffee cup and Matteo Coffea logo visible on table.',
          'Bill total (INR 420) matches $5.00 USD PayPal payment.',
          'GPS distance is 24 m within 150 m venue radius.',
        ],
      },
      status: 'paid',
      ownerNotified: false,
      webhookStatus: null,
      webhookStatusCode: null,
      submittedAt: nowIso,
      aiReviewedAt: nowIso,
      paidAt: nowIso,
    };

    saveClaim(sampleClaim);
    const result = await notifyBusiness(sampleClaim, {
      event: 'claim_paid',
      budgetRemainingUsd: 19.25,
    });
    sampleClaim.webhookStatus = result.skipped ? 'skipped' : result.ok ? 'sent' : 'failed';
    sampleClaim.webhookStatusCode = typeof result.status === 'number' ? result.status : null;
    sampleClaim.ownerNotified = Boolean(
      result.ok && typeof result.status === 'number' && result.status >= 200 && result.status < 300
    );
    saveClaim(sampleClaim);

    return res.status(result.skipped ? 200 : result.status || 200).json({
      ok: result.ok,
      skipped: Boolean(result.skipped),
      status: result.status || null,
      response: result.responseBody || result.error || '',
      payload: result.payload,
      claimId,
    });
  } catch (err) {
    console.error('[POST /api/dev/test-zapier]', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/claims', async (req, res) => {
  try {
    const body = req.body || {};
    const {
      questId,
      quest: clientQuest,
      orderId,
      orderSummary: clientOrderSummary,
      photoBase64,
      mimeType = 'image/jpeg',
      photoUri,
      billPhotoBase64,
      billMimeType = 'image/jpeg',
      billInr: rawBillInr,
      textAnswer = '',
      gps,
      resolvedAddress,
      distanceMeters: clientDistanceMeters,
      traveler = {},
      demoMode = false,
      _aiResultOverride = null,
      _nowIsoOverride = null,
    } = body;

    if (!questId && !clientQuest?.id) {
      return res.status(400).json({ error: 'questId is required to submit a claim.' });
    }

    const quest = getQuestDtoById(questId || clientQuest?.id, { includePrivate: true }) || clientQuest;
    if (!quest) {
      return res.status(404).json({ error: 'Quest not found on server.' });
    }
    const claimUserId = req.user?.id || null;

    recomputeQuestFunding(quest);
    const effectiveDemo = Boolean(demoMode) || process.env.DEMO_MODE === 'true';
    const isFundedQuest = Boolean(quest.funded && quest.budget_remaining_usd > 0);
    const wasOriginallyCashback = Boolean(quest.reward?.cashback_percent && Number(quest.budget_usd || 0) > 0);
    const questType = isFundedQuest
      ? quest.quest_type === 'purchase' || quest.reward?.cashback_percent
        ? 'purchase'
        : 'visit'
      : 'visit';
    const radiusM = Math.max(50, Math.min(1000, Number(quest.radius_m || 150)));
    const claimId = `claim-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const claimPlaceRow = quest?.place_id ? getPlaceRow(quest.place_id) : null;
    const superadmin = ensureSuperadminUser();
    const isSuperadminOwnedPlace = Boolean(
      claimPlaceRow?.owner_id && claimPlaceRow.owner_id === superadmin.id
    );
    const businessEmail = isSuperadminOwnedPlace
      ? getSuperadminPaypalEmail()
      : quest.merchantEmail ||
        process.env.PAYPAL_MERCHANT_EMAIL ||
        clientOrderSummary?.payeeEmail ||
        '';
    const nowDate = _nowIsoOverride ? new Date(_nowIsoOverride) : new Date();
    const nowIso = nowDate.toISOString();
    const persistedPhotoUri = persistClaimPhoto(claimId, photoBase64, mimeType, photoUri, req);
    const persistedBillPhotoUri = billPhotoBase64
      ? persistClaimPhoto(`${claimId}-bill`, billPhotoBase64, billMimeType, null, req)
      : null;
    const ownerUserRow = claimPlaceRow?.owner_id
      ? db.prepare('SELECT email FROM users WHERE id = ?').get(claimPlaceRow.owner_id)
      : null;
    const superhostEmail = String(process.env.ADMIN_EMAIL || 'tsrinath2020@gmail.com').trim();
    const hostEmail = String(ownerUserRow?.email || superhostEmail).trim();

    const parsedBillInr =
      isFundedQuest && questType === 'purchase'
        ? Math.round(
            Number(
              rawBillInr ||
                clientOrderSummary?.billInr ||
                (Number(clientOrderSummary?.amountUsd || 0) * USD_TO_INR) ||
                0
            )
          )
        : 0;
    const paidUsdNum =
      isFundedQuest && questType === 'purchase'
        ? Number(
            clientOrderSummary?.amountUsd ??
              (parsedBillInr > 0 ? (parsedBillInr / USD_TO_INR).toFixed(2) : 0)
          )
        : 0;

    let expectedRewardUsd = 0;
    if (isFundedQuest) {
      if (questType === 'visit') {
        expectedRewardUsd = Number(quest.reward?.fixed_reward_usd ?? quest.rewardUsd ?? 0.25);
      } else {
        const cashbackPct = Number(quest.reward?.cashback_percent ?? 15);
        const maxReward = Number(quest.reward?.max_reward_usd ?? quest.rewardUsd ?? 2.0);
        expectedRewardUsd = Math.min(
          maxReward,
          Number((((parsedBillInr / USD_TO_INR) * cashbackPct) / 100).toFixed(2))
        );
      }
    }

    const totalBudgetUsd = Number(quest.budget_usd ?? quest.budgetUsd ?? 0);
    const remainingBudgetBefore = Number(quest.budget_remaining_usd ?? 0);

    // STEP 1: Persist initial "submitted" claim
    let claim = {
      id: claimId,
      questId: quest.id,
      questTitle: quest.title,
      questType,
      rewardMode: isFundedQuest ? 'cashback' : 'xp_only',
      cashbackSoldOut: !isFundedQuest && wasOriginallyCashback,
      businessName: quest.place_name || quest.businessName || quest.title,
      businessEmail,
      hostEmail,
      superhostEmail,
      billInr: parsedBillInr,
      paidUsd: paidUsdNum,
      rewardUsd: expectedRewardUsd,
      xp: Number(quest.xp || 50),
      travelerName: traveler.name || 'ROAMR Explorer',
      travelerEmail: traveler.email || '',
      travelerAvatar: traveler.avatar || null,
      paypalEmail: traveler.paypalEmail || 'sb-traveler@personal.example.com',
      photoUri: persistedPhotoUri,
      billPhotoUri: persistedBillPhotoUri,
      textAnswer: String(textAnswer || '').trim(),
      gps: {
        latitude: typeof gps?.latitude === 'number' ? gps.latitude : null,
        longitude: typeof gps?.longitude === 'number' ? gps.longitude : null,
        mocked: Boolean(gps?.mocked),
      },
      resolvedAddress: resolvedAddress || '',
      distanceMeters: null,
      demoMode: effectiveDemo,
      order:
        isFundedQuest && questType === 'purchase'
          ? clientOrderSummary || { orderId: orderId || '', amountUsd: paidUsdNum }
          : null,
      hardChecks: null,
      aiVerdict: null,
      status: 'submitted',
      reviewNote: null,
      payout: null,
      budgetRemainingUsd: remainingBudgetBefore,
      webhookStatus: null,
      webhookStatusCode: null,
      ownerNotified: false,
      submittedAt: nowIso,
      aiReviewedAt: null,
      reviewedAt: null,
      paidAt: null,
    };

    persistClaimRecord(claim, claimUserId);
    console.log(
      `[CLAIM ${claimId}] STEP 1: Submitted (quest=${quest.id}, mode=${claim.rewardMode}, demo=${effectiveDemo})`
    );

    // STEP 2: Run hard checks in strict order and stop at the first failure
    const failHardCheck = (reason, extra = {}) => {
      claim.hardChecks = {
        hasPhoto: Boolean((photoBase64 && String(photoBase64).length >= 32) || photoUri),
        notMocked: !claim.gps.mocked || effectiveDemo,
        distancePassed: Boolean(extra.distancePassed),
        distanceMeters: claim.distanceMeters,
        nightCheckPassed: Boolean(extra.nightCheckPassed ?? true),
        uniqueClaimPassed: Boolean(extra.uniqueClaimPassed ?? true),
        budgetPassed: Boolean(extra.budgetPassed ?? true),
        orderVerified: Boolean(extra.orderVerified ?? !isFundedQuest),
        failures: [reason],
      };
      claim.status = 'rejected';
      claim.reviewNote = reason;
      claim.reviewedAt = new Date().toISOString();
      persistClaimRecord(claim, claimUserId);
      console.log(`[CLAIM ${claimId}] HARD CHECK FAILED -> "${reason}"`);
      return res.status(201).json({ claim, quest: toPublicQuest(quest) });
    };

    // 2a. Camera photo & Android mocked GPS check
    const hasPhoto = Boolean((photoBase64 && String(photoBase64).length >= 32) || photoUri);
    if (!hasPhoto) {
      return failHardCheck('Live camera proof photo is missing.');
    }
    if (claim.gps.mocked && !effectiveDemo) {
      return failHardCheck('Mocked GPS location detected on Android and rejected.');
    }

    // 2b. Distance <= radius_m
    const serverComputedDistance = computeDistanceMeters(claim.gps, quest.coordinates);
    const finalDistanceMeters =
      typeof serverComputedDistance === 'number'
        ? serverComputedDistance
        : typeof clientDistanceMeters === 'number'
        ? Math.round(clientDistanceMeters)
        : null;
    claim.distanceMeters = effectiveDemo && finalDistanceMeters === null ? 18 : finalDistanceMeters;
    const distancePassed = effectiveDemo
      ? true
      : typeof finalDistanceMeters === 'number' && finalDistanceMeters <= radiusM;
    if (!distancePassed) {
      return failHardCheck(
        typeof finalDistanceMeters === 'number'
          ? `Distance is ${finalDistanceMeters} m from ${quest.place_name || quest.title} (must be within ${radiusM} m).`
          : 'GPS coordinates are missing or invalid for distance verification.',
        { distancePassed: false }
      );
    }

    // 2c. Night-only check (Asia/Kolkata between 18:30 and 05:00), bypassed in Demo mode
    const nightOk = !quest.night_only || effectiveDemo || isNightTimeKolkata(nowDate);
    if (!nightOk) {
      return failHardCheck(
        'This night quest is only active between 18:30 and 05:00 IST (Asia/Kolkata).',
        { distancePassed: true, nightCheckPassed: false }
      );
    }

    // 2d. Fraud cap: one claim per user per quest + daily cap (max 10 per day IST)
    const travelerKey = String(claim.travelerEmail || claim.paypalEmail || claim.travelerName || '')
      .trim()
      .toLowerCase();
    const priorSameUserClaims = listClaims({ questId: quest.id }).filter((c) => {
      if (c.id === claimId) return false;
      const otherKey = String(c.travelerEmail || c.paypalEmail || c.travelerName || '')
        .trim()
        .toLowerCase();
      return Boolean(travelerKey && otherKey === travelerKey);
    });
    const alreadyPaid = priorSameUserClaims.some((c) => c.status === 'paid');
    const retakeCount = priorSameUserClaims.filter((c) => c.status === 'retake').length;
    const alreadyUsedRetry =
      priorSameUserClaims.filter((c) => c.status === 'paid' || c.status === 'rejected').length > 0 &&
      retakeCount > 0;

    const todayKey = getISTDateKey(nowDate);
    const todayPaidClaims = listClaims({}).filter((c) => {
      if (c.id === claimId || c.status !== 'paid') return false;
      const otherKey = String(c.travelerEmail || c.paypalEmail || c.travelerName || '')
        .trim()
        .toLowerCase();
      if (!travelerKey || otherKey !== travelerKey) return false;
      return getISTDateKey(new Date(c.submittedAt || c.paidAt || nowDate)) === todayKey;
    });

    if (!effectiveDemo) {
      if (alreadyPaid) {
        return failHardCheck(
          'One claim per user per quest: you have already completed this quest.',
          { distancePassed: true, nightCheckPassed: true, uniqueClaimPassed: false }
        );
      }
      if (retakeCount >= 2 || alreadyUsedRetry) {
        return failHardCheck(
          'Retry limit reached: only one retake is permitted per quest.',
          { distancePassed: true, nightCheckPassed: true, uniqueClaimPassed: false }
        );
      }
      if (todayPaidClaims.length >= 10) {
        return failHardCheck(
          'Daily cap reached: maximum 10 verified claims per day.',
          { distancePassed: true, nightCheckPassed: true, uniqueClaimPassed: false }
        );
      }
    }

    // 2e. Funded cashback quests ONLY: require captured PayPal order & bill >= min_bill_inr
    let orderVerification = { ok: true, checks: ['XP-only quest: no PayPal payment required'] };
    if (isFundedQuest && questType === 'purchase') {
      const minBillInr = Number(quest.reward?.min_bill_inr || 0);
      if (parsedBillInr < minBillInr) {
        return failHardCheck(
          `Bill total ₹${parsedBillInr} is below the minimum required ₹${minBillInr}.`,
          {
            distancePassed: true,
            nightCheckPassed: true,
            uniqueClaimPassed: true,
            orderVerified: false,
          }
        );
      }

      const expectedMerchant =
        quest.merchantEmail ||
        process.env.PAYPAL_MERCHANT_EMAIL ||
        clientOrderSummary?.payeeEmail ||
        '';
      const minAmountUsd = Number((minBillInr / USD_TO_INR).toFixed(2));
      orderVerification = await getAndVerifyOrder({
        orderId: orderId || clientOrderSummary?.orderId,
        expectedMerchantEmail: expectedMerchant,
        minAmountUsd,
      });

      if (orderVerification.order) {
        claim.order = orderVerification.order;
        claim.paidUsd = Number(orderVerification.order.amountUsd || paidUsdNum);
      }
      if (!orderVerification.ok) {
        return failHardCheck(
          orderVerification.failures.join(' ') || 'PayPal order is not COMPLETED.',
          {
            distancePassed: true,
            nightCheckPassed: true,
            uniqueClaimPassed: true,
            orderVerified: false,
          }
        );
      }
    }

    claim.hardChecks = {
      hasPhoto: true,
      notMocked: true,
      distancePassed: true,
      distanceMeters: claim.distanceMeters,
      nightCheckPassed: true,
      uniqueClaimPassed: true,
      budgetPassed: true,
      orderVerified: orderVerification.ok,
      orderChecks: orderVerification.checks,
      failures: [],
    };

    // STEP 3: AI check (uses PUBLIC objective + PRIVATE ai_private brief + proof + bill photo + textAnswer)
    const aiResult =
      _aiResultOverride && typeof _aiResultOverride === 'object'
        ? {
            verdict: _aiResultOverride.verdict || 'pass',
            confidence: Number(_aiResultOverride.confidence ?? 0.9),
            reasons: Array.isArray(_aiResultOverride.reasons)
              ? _aiResultOverride.reasons
              : ['Test AI verdict override.'],
            bill_total_read:
              _aiResultOverride.bill_total_read !== undefined
                ? _aiResultOverride.bill_total_read
                : questType === 'purchase'
                ? parsedBillInr
                : null,
            mode: 'test-override',
          }
        : await verifyClaimWithGemini({
            imageBase64: photoBase64,
            mimeType,
            billPhotoBase64,
            billMimeType,
            billInr: parsedBillInr,
            textAnswer,
            quest,
            orderSummary: claim.order,
            distanceResult: {
              distanceMeters: claim.distanceMeters,
              maxMeters: radiusM,
              passed: distancePassed,
              address: claim.resolvedAddress,
              demoMode: effectiveDemo,
            },
            demoMode: effectiveDemo,
          });

    // Purchase quests: require bill_total_read within 10% of confirmed/PayPal bill amount (unless demo)
    let confidence = Math.max(0, Math.min(1, Number(aiResult.confidence ?? 0)));
    let verdict = String(aiResult.verdict || '').toLowerCase() === 'pass' ? 'pass' : 'flag';
    const reasons = Array.isArray(aiResult.reasons) ? [...aiResult.reasons] : [];

    if (
      isFundedQuest &&
      questType === 'purchase' &&
      !effectiveDemo &&
      typeof aiResult.bill_total_read === 'number' &&
      aiResult.bill_total_read > 0 &&
      parsedBillInr > 0
    ) {
      const diffRatio = Math.abs(aiResult.bill_total_read - parsedBillInr) / parsedBillInr;
      if (diffRatio > 0.1) {
        verdict = 'flag';
        confidence = Math.min(confidence, 0.25);
        reasons.unshift(
          `Bill photo total (INR ${aiResult.bill_total_read}) differs by more than 10% from paid amount (INR ${parsedBillInr}).`
        );
      }
    }

    claim.aiVerdict = {
      verdict,
      confidence,
      reasons,
      bill_total_read: aiResult.bill_total_read ?? null,
      mode: aiResult.mode,
    };
    claim.aiReviewedAt = new Date().toISOString();

    // STEP 4: Threshold decision: >= 0.75 auto-pay/award XP | 0.40..0.75 retake | < 0.40 reject
    if (confidence >= 0.75 && verdict === 'pass') {
      const latestQuest = getQuestDtoById(quest.id, { includePrivate: true }) || quest;
      recomputeQuestFunding(latestQuest);
      const canPayCashback = Boolean(
        latestQuest.funded && latestQuest.budget_remaining_usd > 0 && expectedRewardUsd > 0
      );
      const paidNow = new Date().toISOString();

      if (canPayCashback) {
        // Atomically reserve cashback from budget_remaining_usd FIRST
        const finalRewardUsd = Number(
          Math.min(expectedRewardUsd, latestQuest.budget_remaining_usd).toFixed(2)
        );
        const nextBudgetRemaining = Number(
          Math.max(0, latestQuest.budget_remaining_usd - finalRewardUsd).toFixed(2)
        );
        const nextSpent = Number((Number(latestQuest.spentUsd || 0) + finalRewardUsd).toFixed(2));
        db.prepare(
          `UPDATE quests
           SET verified_visits = verified_visits + 1,
               spent_usd = ?,
               budget_remaining_usd = ?
           WHERE id = ?`
        ).run(nextSpent, nextBudgetRemaining, latestQuest.id);
        if (claimUserId) {
          db.prepare('UPDATE users SET xp = xp + ? WHERE id = ?').run(
            Number(claim.xp || 0),
            claimUserId
          );
        }

        latestQuest.verifiedVisits = (latestQuest.verifiedVisits || 0) + 1;
        latestQuest.spentUsd = nextSpent;
        latestQuest.budget_remaining_usd = nextBudgetRemaining;
        recomputeQuestFunding(latestQuest);

        claim.rewardMode = 'cashback';
        claim.cashbackSoldOut = false;
        claim.rewardUsd = finalRewardUsd;
        claim.budgetRemainingUsd = nextBudgetRemaining;

        const payout = await createTravelerPayout({
          questId: claim.questId,
          questTitle: claim.questTitle,
          amountUsd: finalRewardUsd,
          receiverEmail: claim.paypalEmail,
        });
        const record = recordPayoutLedger({
          questId: claim.questId,
          questTitle: claim.questTitle,
          amountUsd: finalRewardUsd,
          payout,
          skipQuestBudgetUpdate: true,
        });

        claim.status = 'paid';
        claim.paidAt = paidNow;
        claim.reviewedAt = paidNow;
        claim.reviewNote = `Auto-approved by AI (${Math.round(confidence * 100)}% confidence) — $${finalRewardUsd.toFixed(2)} USD cashback paid.`;
        claim.payout = record;
        persistClaimRecord(claim, claimUserId);

        const paidHook = await notifyBusiness(claim, {
          event: 'claim_paid',
          budgetRemainingUsd: nextBudgetRemaining,
        });
        claim.webhookStatus = paidHook.skipped ? 'skipped' : paidHook.ok ? 'sent' : 'failed';
        claim.webhookStatusCode = typeof paidHook.status === 'number' ? paidHook.status : null;
        claim.ownerNotified = Boolean(
          paidHook.ok && typeof paidHook.status === 'number' && paidHook.status >= 200 && paidHook.status < 300
        );
        persistClaimRecord(claim, claimUserId);

        if (totalBudgetUsd > 0 && nextBudgetRemaining < 0.2 * totalBudgetUsd) {
          await notifyBusiness(claim, {
            event: 'budget_low',
            budgetRemainingUsd: nextBudgetRemaining,
          });
        }
      } else {
        // Unfunded / sold-out quest: XP + passport stamp only, NO PayPal payouts & NO Zapier call
        db.prepare('UPDATE quests SET verified_visits = verified_visits + 1 WHERE id = ?').run(
          latestQuest.id
        );
        if (claimUserId) {
          db.prepare('UPDATE users SET xp = xp + ? WHERE id = ?').run(
            Number(claim.xp || 0),
            claimUserId
          );
        }
        const soldOutMidClaim = wasOriginallyCashback || totalBudgetUsd > 0;
        claim.rewardMode = 'xp_only';
        claim.cashbackSoldOut = soldOutMidClaim;
        claim.rewardUsd = 0;
        claim.paidUsd = 0;
        claim.payout = null;
        claim.budgetRemainingUsd = 0;
        claim.status = 'paid';
        claim.paidAt = paidNow;
        claim.reviewedAt = paidNow;
        claim.reviewNote = soldOutMidClaim
          ? "Cashback just ran out, you'll still earn XP."
          : `Auto-approved by AI (${Math.round(confidence * 100)}% confidence) — +${claim.xp} XP & passport stamp awarded!`;
        claim.webhookStatus = 'skipped_xp_only';
        persistClaimRecord(claim, claimUserId);
      }
    } else if (confidence >= 0.4 && retakeCount < 1) {
      claim.status = 'retake';
      claim.reviewedAt = new Date().toISOString();
      claim.reviewNote =
        reasons.join(' ') ||
        'Photo proof was borderline. Please capture one clearer retake showing the venue & objective.';
      persistClaimRecord(claim, claimUserId);
    } else {
      claim.status = 'rejected';
      claim.reviewedAt = new Date().toISOString();
      claim.reviewNote =
        reasons.join(' ') ||
        'Claim rejected by automated AI verification.';
      persistClaimRecord(claim, claimUserId);

      if (isFundedQuest) {
        const rejHook = await notifyBusiness(claim, {
          event: 'claim_rejected',
          budgetRemainingUsd: remainingBudgetBefore,
        });
        claim.webhookStatus = rejHook.skipped ? 'skipped' : rejHook.ok ? 'sent' : 'failed';
        claim.webhookStatusCode = typeof rejHook.status === 'number' ? rejHook.status : null;
        persistClaimRecord(claim, claimUserId);
      }
    }

    const updatedPublicQuest = getQuestDtoById(quest.id, { includePrivate: false }) || toPublicQuest(quest);
    return res.status(201).json({ claim, quest: updatedPublicQuest });
  } catch (err) {
    console.error('[POST /api/claims]', err);
    return res.status(500).json({ error: err.message || 'Failed to process claim.' });
  }
});

async function startServer() {
  const seedSummary = await seedDatabaseFromFile();
  return app.listen(PORT, HOST, () => {
    console.log(`ROAMR server listening on http://${HOST}:${PORT}`);
    console.log(
      `  SQLite Seed: ${seedSummary.totalPlaces} places, ${seedSummary.totalQuests} quests (${seedSummary.fundedQuests} funded)`
    );
    console.log(
      `  AI Provider: ${getActiveAiProvider().toUpperCase()} (Groq: ${hasValidGroqKey() ? 'CONFIGURED' : 'unset'}, Gemini: ${hasValidGeminiKey() ? 'CONFIGURED' : 'unset'})`
    );
    console.log(
      `  PayPal Sandbox: ${hasValidPayPalCredentials() ? 'CONFIGURED' : 'Simulated fallback (set PAYPAL_CLIENT_ID & PAYPAL_CLIENT_SECRET)'}`
    );
  });
}

if (require.main === module) {
  startServer().catch((err) => {
    console.error('[startServer]', err);
    process.exit(1);
  });
}

module.exports = {
  app,
  db,
  seedDatabaseFromFile,
  toPublicQuest,
  isNightTimeKolkata,
  startServer,
};
