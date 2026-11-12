const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const USD_TO_INR = 84;
const DB_PATH = process.env.SQLITE_DB_PATH
  ? path.resolve(process.env.SQLITE_DB_PATH)
  : path.resolve(__dirname, 'roamr.sqlite');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function runMigrations() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT,
      avatar TEXT,
      role TEXT NOT NULL DEFAULT 'traveler',
      paypal_email TEXT,
      business_name TEXT,
      xp INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS places (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      address TEXT NOT NULL,
      lat REAL,
      lng REAL,
      category TEXT,
      photo_url TEXT,
      city TEXT DEFAULT 'Bengaluru',
      maps_link TEXT,
      owner_id TEXT,
      claim_status TEXT NOT NULL DEFAULT 'none',
      claim_note TEXT,
      claim_business_name TEXT,
      claim_paypal_email TEXT,
      claimed_by TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS quests (
      id TEXT PRIMARY KEY,
      place_id TEXT NOT NULL,
      title TEXT NOT NULL,
      public_description TEXT,
      public_objective TEXT,
      photo_url TEXT,
      difficulty TEXT DEFAULT 'Easy',
      est_minutes INTEGER DEFAULT 20,
      xp INTEGER DEFAULT 50,
      night_only INTEGER NOT NULL DEFAULT 0,
      radius_m INTEGER NOT NULL DEFAULT 150,
      quest_type TEXT NOT NULL DEFAULT 'visit',
      text_answer_prompt TEXT,
      proof_hint TEXT,
      min_bill_inr INTEGER DEFAULT 0,
      cashback_percent REAL DEFAULT 0,
      max_reward_usd REAL DEFAULT 0,
      fixed_reward_usd REAL DEFAULT 0,
      budget_usd REAL NOT NULL DEFAULT 0,
      budget_remaining_usd REAL NOT NULL DEFAULT 0,
      demo_budget INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      ai_private TEXT,
      ai_reference_images TEXT,
      created_by TEXT,
      verified_visits INTEGER NOT NULL DEFAULT 0,
      spent_usd REAL NOT NULL DEFAULT 0,
      merchant_email TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (place_id) REFERENCES places(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS claims (
      id TEXT PRIMARY KEY,
      quest_id TEXT NOT NULL,
      user_id TEXT,
      status TEXT NOT NULL,
      photo_path TEXT,
      bill_photo_path TEXT,
      text_answer TEXT,
      lat REAL,
      lng REAL,
      distance_m REAL,
      paypal_order_id TEXT,
      bill_inr REAL DEFAULT 0,
      paid_usd REAL DEFAULT 0,
      ai_verdict TEXT,
      ai_confidence REAL DEFAULT 0,
      ai_reasons TEXT,
      reward_usd REAL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (quest_id) REFERENCES quests(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS funding (
      id TEXT PRIMARY KEY,
      owner_id TEXT,
      quest_id TEXT NOT NULL,
      paypal_order_id TEXT,
      amount_usd REAL NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (quest_id) REFERENCES quests(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      order_id TEXT UNIQUE NOT NULL,
      capture_id TEXT,
      quest_id TEXT,
      place_id TEXT,
      owner_id TEXT,
      user_id TEXT,
      amount_usd REAL NOT NULL DEFAULT 0,
      currency TEXT DEFAULT 'USD',
      status TEXT NOT NULL,
      capture_status TEXT NOT NULL,
      payee_email TEXT,
      payer_email TEXT,
      payer_name TEXT,
      custom_id TEXT,
      simulated INTEGER NOT NULL DEFAULT 0,
      debug_id TEXT,
      created_at TEXT NOT NULL
    );
  `);
}

const DISALLOWED_BUSINESS_PATTERN =
  /\b(monument|park|garden|museum|temple|shrine|fort|palace|statue|memorial|heritage|history|nature|cathedral|church|botanical|viewpoint|landmark)\b/i;

function isDisallowedBusinessCategory(category = '', name = '') {
  return (
    DISALLOWED_BUSINESS_PATTERN.test(String(category || '')) ||
    DISALLOWED_BUSINESS_PATTERN.test(String(name || ''))
  );
}

function getAdminEmail() {
  return String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
}

function ensureSuperadminUser() {
  const adminEmail = getAdminEmail() || 'tsrinath2020@gmail.com';
  const existing = db.prepare('SELECT * FROM users WHERE LOWER(email) = ?').get(adminEmail);
  if (existing) {
    return resolveOrCreateUser({ email: adminEmail });
  }
  return resolveOrCreateUser({
    email: adminEmail,
    name: 'ROAMR Superadmin',
    business_name: 'ROAMR Superadmin',
    paypal_email:
      String(process.env.PAYPAL_BUSINESS_EMAIL || process.env.PAYPAL_MERCHANT_EMAIL || '').trim() ||
      null,
  });
}

function getSuperadminPaypalEmail() {
  const adminEmail = getAdminEmail() || 'tsrinath2020@gmail.com';
  const row = db.prepare('SELECT paypal_email FROM users WHERE LOWER(email) = ?').get(adminEmail);
  return (
    String(row?.paypal_email || '').trim() ||
    String(process.env.PAYPAL_BUSINESS_EMAIL || '').trim() ||
    String(process.env.PAYPAL_MERCHANT_EMAIL || '').trim() ||
    'sb-merchant@business.example.com'
  );
}

function resolveServerRoleForEmail(email) {
  const adminEmail = getAdminEmail();
  const normalized = String(email || '').trim().toLowerCase();
  if (adminEmail && normalized && normalized === adminEmail) {
    return 'admin';
  }
  return 'traveler';
}

function resolveOrCreateUser({ email, name, avatar, paypal_email, business_name }) {
  const cleanEmail = String(email || 'demo@roamr.app').trim().toLowerCase();
  const serverRole = resolveServerRoleForEmail(cleanEmail);
  let row = db.prepare('SELECT * FROM users WHERE LOWER(email) = ?').get(cleanEmail);

  if (!row) {
    const userId = `usr-${Buffer.from(cleanEmail).toString('hex').slice(0, 16)}`;
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO users (id, email, name, avatar, role, paypal_email, business_name, xp, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`
    ).run(
      userId,
      cleanEmail,
      name || cleanEmail.split('@')[0] || 'Explorer',
      avatar || null,
      serverRole,
      paypal_email || null,
      business_name || null,
      now
    );
    row = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  } else {
    // Always re-evaluate admin role on server & keep profile fresh if provided
    const nextName = name ? String(name).trim() : row.name;
    const nextAvatar = avatar || row.avatar;
    const nextPaypal = paypal_email || row.paypal_email;
    const nextBiz = business_name || row.business_name;
    if (
      row.role !== serverRole ||
      nextName !== row.name ||
      nextAvatar !== row.avatar ||
      nextPaypal !== row.paypal_email ||
      nextBiz !== row.business_name
    ) {
      db.prepare(
        `UPDATE users SET role = ?, name = ?, avatar = ?, paypal_email = ?, business_name = ? WHERE id = ?`
      ).run(serverRole, nextName, nextAvatar, nextPaypal, nextBiz, row.id);
      row = db.prepare('SELECT * FROM users WHERE id = ?').get(row.id);
    }
  }

  const ownedCount = db
    .prepare('SELECT COUNT(*) AS cnt FROM places WHERE owner_id = ?')
    .get(row.id)?.cnt || 0;

  const primaryPlaceRow = db
    .prepare(
      `SELECT * FROM places
       WHERE owner_id = ? OR (claimed_by = ? AND claim_status IN ('pending', 'approved', 'rejected'))
       ORDER BY CASE WHEN owner_id = ? THEN 0 WHEN claim_status = 'pending' THEN 1 ELSE 2 END, created_at DESC
       LIMIT 1`
    )
    .get(row.id, row.id, row.id);

  return {
    ...row,
    role: serverRole,
    owned_places_count: ownedCount,
    is_owner: ownedCount > 0,
    is_verified_business: ownedCount > 0,
    quest_lock_limit: ownedCount > 0 ? null : 1,
    primary_place: primaryPlaceRow ? formatPlaceDto(primaryPlaceRow) : null,
  };
}

function parseJsonColumn(raw, fallback) {
  if (!raw) return fallback;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function buildRewardPreview(questRow, funded) {
  if (!funded) {
    return `${Number(questRow.xp || 50)} XP only`;
  }
  if (questRow.quest_type === 'purchase' && Number(questRow.cashback_percent || 0) > 0) {
    const pct = Number(questRow.cashback_percent || 15);
    const maxUsd = Number(questRow.max_reward_usd || 2);
    const minInr = Number(questRow.min_bill_inr || 200);
    return `${pct}% back, up to $${Number.isInteger(maxUsd) ? maxUsd : maxUsd.toFixed(2)}, on bills over ₹${minInr}`;
  }
  const fixed = Number(questRow.fixed_reward_usd || 0.25);
  return `Pays $${fixed.toFixed(2)}`;
}

function formatQuestDto(questRow, placeRow, { includePrivate = false } = {}) {
  const budgetUsd = Number(questRow.budget_usd || 0);
  const budgetRemainingUsd = Number(Math.max(0, Number(questRow.budget_remaining_usd || 0)).toFixed(2));
  const funded = budgetRemainingUsd > 0;
  const rewardMode = funded ? 'cashback' : 'xp_only';
  const maxReward = Number(questRow.max_reward_usd || 0);
  const fixedReward = Number(questRow.fixed_reward_usd || 0);
  const rewardUsd = funded ? (questRow.quest_type === 'purchase' ? maxReward || 2.0 : fixedReward || 0.25) : 0;
  const lat = placeRow?.lat ?? 12.9716;
  const lng = placeRow?.lng ?? 77.5946;
  const placeName = placeRow?.name || questRow.title;
  const superadmin = ensureSuperadminUser();
  const isSuperadminOwned = Boolean(placeRow?.owner_id && placeRow.owner_id === superadmin.id);
  const ownerRow = placeRow?.owner_id
    ? db.prepare('SELECT business_name, paypal_email, name FROM users WHERE id = ?').get(placeRow.owner_id)
    : null;
  const fundedBy = funded
    ? isSuperadminOwned
      ? placeName
      : ownerRow?.business_name || ownerRow?.name || (questRow.demo_budget ? placeName : 'ROAMR Host')
    : null;

  const rewardObj = !funded
    ? { xp_only: true }
    : questRow.quest_type === 'purchase'
    ? {
        min_bill_inr: Number(questRow.min_bill_inr || 200),
        cashback_percent: Number(questRow.cashback_percent || 15),
        max_reward_usd: maxReward || 2.0,
      }
    : {
        fixed_reward_usd: fixedReward || 0.25,
      };

  const dto = {
    id: questRow.id,
    place_id: questRow.place_id,
    title: questRow.title,
    place_name: placeName,
    businessName: fundedBy || placeName,
    funded_by: fundedBy,
    fundedBy: fundedBy || '',
    category: placeRow?.category || 'Explore',
    quest_type: questRow.quest_type || 'visit',
    address: placeRow?.address || '',
    city: placeRow?.city || 'Bengaluru',
    lat,
    lng,
    coordinates: { latitude: lat, longitude: lng },
    radius_m: Number(questRow.radius_m || 150),
    night_only: Boolean(questRow.night_only),
    difficulty: questRow.difficulty || 'Easy',
    est_minutes: Number(questRow.est_minutes || 20),
    estTime: `~ ${Number(questRow.est_minutes || 20)} min`,
    distance: '0.5 km',
    distanceKm: 0.5,
    xp: Number(questRow.xp || 50),
    public_description: questRow.public_description || '',
    description: questRow.public_description || '',
    public_objective: questRow.public_objective || '',
    objective: questRow.public_objective || '',
    text_answer_prompt: questRow.text_answer_prompt || null,
    proof_hint: questRow.proof_hint || (funded ? 'Receipt' : 'Live Photo'),
    proofType: funded && questRow.quest_type === 'purchase' ? 'receipt' : 'photo',
    maps_link: placeRow?.maps_link || null,
    photo_url: questRow.photo_url || placeRow?.photo_url || null,
    image: questRow.photo_url || placeRow?.photo_url || null,
    budget_usd: budgetUsd,
    budgetUsd,
    budget_remaining_usd: budgetRemainingUsd,
    demo_budget: Boolean(questRow.demo_budget),
    active: Boolean(questRow.active),
    spentUsd: Number(questRow.spent_usd || 0),
    verifiedVisits: Number(questRow.verified_visits || 0),
    funded,
    reward_mode: rewardMode,
    reward_preview: buildRewardPreview(questRow, funded),
    reward: rewardObj,
    rewardUsd,
    ...(funded && questRow.quest_type === 'purchase' && Number(questRow.min_bill_inr || 0) > 0
      ? { minCheckinUsd: Number((Number(questRow.min_bill_inr) / USD_TO_INR).toFixed(2)) }
      : {}),
    merchantEmail: isSuperadminOwned
      ? funded
        ? getSuperadminPaypalEmail()
        : ''
      : questRow.merchant_email ||
        ownerRow?.paypal_email ||
        (funded
          ? process.env.PAYPAL_MERCHANT_EMAIL ||
            `sb-merchant-${String(questRow.id).replace(/[^a-z0-9-]/gi, '')}@business.example.com`
          : ''),
    superadmin_owned: isSuperadminOwned,
    created_by: questRow.created_by || null,
    created_at: questRow.created_at,
  };

  if (includePrivate) {
    dto.ai_private = parseJsonColumn(questRow.ai_private, {
      must_show: [],
      reject_if: [],
      bill_checks: [],
      notes: '',
    });
    const refs = parseJsonColumn(questRow.ai_reference_images, []);
    if (Array.isArray(refs) && refs.length > 0) {
      dto.aiReferenceImages = refs;
    }
  }

  return dto;
}

function formatPlaceDto(placeRow) {
  const quests = db
    .prepare('SELECT * FROM quests WHERE place_id = ? AND active = 1')
    .all(placeRow.id);
  const fundedQuests = quests.filter((q) => Number(q.budget_remaining_usd || 0) > 0);
  const maxRewardUsd = fundedQuests.reduce((mx, q) => {
    const val = Number(q.max_reward_usd || q.fixed_reward_usd || 0);
    return val > mx ? val : mx;
  }, 0);
  const maxXp = quests.reduce((mx, q) => Math.max(mx, Number(q.xp || 0)), 0);

  return {
    id: placeRow.id,
    name: placeRow.name,
    address: placeRow.address,
    lat: placeRow.lat,
    lng: placeRow.lng,
    coordinates:
      typeof placeRow.lat === 'number' && typeof placeRow.lng === 'number'
        ? { latitude: placeRow.lat, longitude: placeRow.lng }
        : { latitude: 12.9716, longitude: 77.5946 },
    category: placeRow.category || 'Explore',
    photo_url: placeRow.photo_url || null,
    city: placeRow.city || 'Bengaluru',
    maps_link: placeRow.maps_link || null,
    owner_id: placeRow.owner_id || null,
    claim_status: placeRow.claim_status || 'none',
    claim_note: placeRow.claim_note || null,
    quest_count: quests.length,
    has_funded_quests: fundedQuests.length > 0,
    funded: fundedQuests.length > 0,
    max_reward_usd: maxRewardUsd,
    max_xp: maxXp,
  };
}

runMigrations();

module.exports = {
  db,
  DB_PATH,
  USD_TO_INR,
  runMigrations,
  isDisallowedBusinessCategory,
  getAdminEmail,
  ensureSuperadminUser,
  getSuperadminPaypalEmail,
  resolveServerRoleForEmail,
  resolveOrCreateUser,
  formatQuestDto,
  formatPlaceDto,
  parseJsonColumn,
};
