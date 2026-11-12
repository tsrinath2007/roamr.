const fs = require('fs');
const path = require('path');
const { db, ensureSuperadminUser, getSuperadminPaypalEmail } = require('./index');

const SEED_JSON_PATH = path.resolve(__dirname, '../data/roamr-quests.seed.json');

async function geocodeAddressWithMapbox(query) {
  const token = (
    process.env.MAPBOX_TOKEN ||
    process.env.EXPO_PUBLIC_MAPBOX_TOKEN ||
    ''
  ).trim();
  if (!query || !token || !token.startsWith('pk.')) {
    return null;
  }
  try {
    const url = `https://api.mapbox.com/search/geocode/v6/forward?q=${encodeURIComponent(
      query
    )}&limit=1&access_token=${encodeURIComponent(token)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) return null;
      const data = await res.json();
      const coords = data?.features?.[0]?.geometry?.coordinates;
      if (Array.isArray(coords) && coords.length >= 2) {
        return { lng: Number(coords[0]), lat: Number(coords[1]) };
      }
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    console.warn('[seed] Mapbox geocode failed:', err.message);
  }
  return null;
}

async function seedDatabaseFromFile() {
  if (!fs.existsSync(SEED_JSON_PATH)) {
    console.warn('[seed] Missing seed file:', SEED_JSON_PATH);
    return {
      totalPlaces: 0,
      totalQuests: 0,
      fundedQuests: 0,
      insertedPlaces: 0,
      insertedQuests: 0,
    };
  }

  const parsed = JSON.parse(fs.readFileSync(SEED_JSON_PATH, 'utf8'));
  const cityDefault = String(parsed.city || 'Bengaluru').trim();
  const entries = Array.isArray(parsed.quests) ? parsed.quests : [];
  const now = new Date().toISOString();
  const superadmin = ensureSuperadminUser();
  const superadminPaypal = getSuperadminPaypalEmail();

  // Backfill any previously seeded Bengaluru places so only Superadmin owns & can edit them
  db.prepare(
    `UPDATE places
     SET owner_id = ?, claim_status = 'approved'
     WHERE owner_id IS NULL
       AND created_by = 'seed'
       AND (claimed_by IS NULL OR claimed_by = '')
       AND claim_status = 'none'`
  ).run(superadmin.id);

  db.prepare(
    `UPDATE quests
     SET merchant_email = ?
     WHERE created_by = 'seed' AND budget_remaining_usd > 0`
  ).run(superadminPaypal);

  let insertedPlaces = 0;
  let insertedQuests = 0;

  const findPlaceByNameAddr = db.prepare(
    'SELECT * FROM places WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) AND LOWER(TRIM(address)) = LOWER(TRIM(?))'
  );
  const findQuestById = db.prepare('SELECT id FROM quests WHERE id = ?');

  const insertPlaceStmt = db.prepare(`
    INSERT INTO places (
      id, name, address, lat, lng, category, photo_url, city, maps_link,
      owner_id, claim_status, claim_note, created_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', NULL, 'seed', ?)
  `);

  const insertQuestStmt = db.prepare(`
    INSERT INTO quests (
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
      ?, 1, ?, '[]', 'seed',
      0, 0, ?, ?
    )
  `);

  for (const raw of entries) {
    const placeName = String(raw.place_name || raw.title || 'Local Venue').trim();
    const address = String(raw.address || `${placeName}, ${cityDefault}`).trim();

    let placeRow = findPlaceByNameAddr.get(placeName, address);
    if (!placeRow) {
      let lat = typeof raw.lat === 'number' ? raw.lat : null;
      let lng = typeof raw.lng === 'number' ? raw.lng : null;

      if ((lat === null || lng === null) && raw.geocode_query) {
        const resolved = await geocodeAddressWithMapbox(raw.geocode_query);
        if (resolved) {
          lat = resolved.lat;
          lng = resolved.lng;
          console.log(`[seed] Geocoded "${placeName}" -> (${lat.toFixed(5)}, ${lng.toFixed(5)})`);
        }
      }

      const placeId = `plc-${String(raw.id || Date.now()).trim()}`;
      insertPlaceStmt.run(
        placeId,
        placeName,
        address,
        lat,
        lng,
        String(raw.category || 'Explore').trim(),
        raw.photo_url || null,
        String(raw.city || cityDefault).trim(),
        raw.maps_link || null,
        superadmin.id,
        now
      );
      placeRow = db.prepare('SELECT * FROM places WHERE id = ?').get(placeId);
      insertedPlaces += 1;
    } else if ((placeRow.lat === null || placeRow.lng === null) && raw.geocode_query) {
      const resolved = await geocodeAddressWithMapbox(raw.geocode_query);
      if (resolved) {
        db.prepare('UPDATE places SET lat = ?, lng = ? WHERE id = ?').run(
          resolved.lat,
          resolved.lng,
          placeRow.id
        );
      }
    }

    const questId = String(raw.id || `qst-${Date.now()}`).trim();
    const existingQuest = findQuestById.get(questId);
    if (!existingQuest) {
      const rewardObj = raw.reward || {};
      const budgetUsd = Number(raw.budget_usd || 0);
      const isFundedDemo = Boolean(raw.funded && budgetUsd > 0);
      const budgetRemainingUsd = isFundedDemo ? budgetUsd : 0;
      const questType = raw.quest_type === 'purchase' ? 'purchase' : 'visit';
      const merchantEmail = isFundedDemo ? superadminPaypal : '';

      insertQuestStmt.run(
        questId,
        placeRow.id,
        String(raw.title || placeName).trim(),
        String(raw.public_description || '').trim(),
        String(raw.public_objective || '').trim(),
        raw.photo_url || null,
        String(raw.difficulty || 'Easy').trim(),
        Number(raw.est_minutes || 20),
        Number(raw.xp || 50),
        raw.night_only ? 1 : 0,
        Number(raw.radius_m || 150),
        questType,
        raw.text_answer_prompt || null,
        raw.proof_hint || (isFundedDemo ? 'Receipt' : 'Live Photo'),
        Number(rewardObj.min_bill_inr || 0),
        Number(rewardObj.cashback_percent || 0),
        Number(rewardObj.max_reward_usd || 0),
        Number(rewardObj.fixed_reward_usd || 0),
        budgetUsd,
        budgetRemainingUsd,
        isFundedDemo ? 1 : 0,
        JSON.stringify(
          raw.ai_private || {
            must_show: [],
            reject_if: [],
            bill_checks: [],
            notes: '',
          }
        ),
        merchantEmail,
        now
      );
      insertedQuests += 1;
    }
  }

  const totalPlaces = db.prepare('SELECT COUNT(*) AS cnt FROM places').get().cnt;
  const totalQuests = db.prepare('SELECT COUNT(*) AS cnt FROM quests').get().cnt;
  const fundedQuests = db
    .prepare('SELECT COUNT(*) AS cnt FROM quests WHERE budget_remaining_usd > 0 AND active = 1')
    .get().cnt;

  return {
    totalPlaces,
    totalQuests,
    fundedQuests,
    insertedPlaces,
    insertedQuests,
  };
}

module.exports = {
  geocodeAddressWithMapbox,
  seedDatabaseFromFile,
};
