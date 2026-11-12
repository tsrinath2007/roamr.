const fs = require('fs');
const path = require('path');

const USD_TO_INR = 84;
const SEED_JSON_PATH = path.resolve(__dirname, '../../data/roamr-quests.seed.json');
const GEOCACHE_PATH = path.resolve(__dirname, '../../data/geocode-cache.json');

function loadRawSeed() {
  try {
    const raw = fs.readFileSync(SEED_JSON_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      city: parsed.city || 'Bengaluru',
      quests: Array.isArray(parsed.quests) ? parsed.quests : [],
    };
  } catch (err) {
    console.warn('[seedQuests] failed to read roamr-quests.seed.json:', err.message);
    return { city: 'Bengaluru', quests: [] };
  }
}

function loadGeocodeCache() {
  try {
    if (fs.existsSync(GEOCACHE_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(GEOCACHE_PATH, 'utf8'));
      return parsed && typeof parsed === 'object' ? parsed : {};
    }
  } catch {
    // ignore corrupt cache
  }
  return {};
}

function saveGeocodeCache(cache) {
  try {
    fs.mkdirSync(path.dirname(GEOCACHE_PATH), { recursive: true });
    fs.writeFileSync(GEOCACHE_PATH, JSON.stringify(cache, null, 2));
  } catch (err) {
    console.warn('[seedQuests] could not save geocode cache:', err.message);
  }
}

function normalizeSeedQuest(raw, cityDefault, geocodeCache) {
  const rewardObj = raw.reward || { xp_only: true };
  const budgetUsd = Number(raw.budget_usd ?? 0);
  const budgetRemainingUsd = Number(
    (raw.budget_remaining_usd !== undefined ? raw.budget_remaining_usd : budgetUsd).toFixed(2)
  );
  const funded = budgetRemainingUsd > 0 && raw.funded !== false;
  const rewardMode = funded ? 'cashback' : 'xp_only';
  const questType = raw.quest_type === 'purchase' || (funded && rewardObj.cashback_percent) ? 'purchase' : 'visit';
  const minBillInr = Number(rewardObj.min_bill_inr || 0);
  const maxRewardUsd = Number(rewardObj.max_reward_usd || 0);
  const fixedRewardUsd = Number(rewardObj.fixed_reward_usd || 0);

  const cached = raw.id ? geocodeCache[raw.id] : null;
  const lat =
    typeof raw.lat === 'number'
      ? raw.lat
      : typeof cached?.lat === 'number'
      ? cached.lat
      : null;
  const lng =
    typeof raw.lng === 'number'
      ? raw.lng
      : typeof cached?.lng === 'number'
      ? cached.lng
      : null;

  const rewardUsd = funded ? (maxRewardUsd || fixedRewardUsd || 2.0) : 0;
  const minCheckinUsd =
    funded && questType === 'purchase' && minBillInr > 0
      ? Number((minBillInr / USD_TO_INR).toFixed(2))
      : undefined;

  const estMinutes = Number(raw.est_minutes || 20);
  const placeName = String(raw.place_name || raw.title || 'Local Venue').trim();
  const fundedBy = raw.funded_by ? String(raw.funded_by).trim() : null;

  return {
    id: String(raw.id || `quest-${Date.now()}`),
    title: String(raw.title || placeName),
    place_name: placeName,
    businessName: fundedBy || placeName,
    funded_by: fundedBy,
    fundedBy: fundedBy || '',
    category: String(raw.category || 'Explore'),
    quest_type: questType,
    address: String(raw.address || ''),
    city: String(raw.city || cityDefault || 'Bengaluru'),
    lat,
    lng,
    geocode_query: raw.geocode_query || null,
    coordinates:
      typeof lat === 'number' && typeof lng === 'number'
        ? { latitude: lat, longitude: lng }
        : { latitude: 12.9716, longitude: 77.5946 },
    radius_m: Number(raw.radius_m || 150),
    night_only: Boolean(raw.night_only),
    difficulty: String(raw.difficulty || 'Easy'),
    est_minutes: estMinutes,
    estTime: `~ ${estMinutes} min`,
    distance: '0.5 km',
    distanceKm: 0.5,
    xp: Number(raw.xp || 50),
    public_description: String(raw.public_description || ''),
    description: String(raw.public_description || ''),
    public_objective: String(raw.public_objective || ''),
    objective: String(raw.public_objective || ''),
    text_answer_prompt: raw.text_answer_prompt || null,
    proof_hint: raw.proof_hint || (funded ? 'Receipt' : 'Live Photo'),
    proofType: funded && questType === 'purchase' ? 'receipt' : 'photo',
    maps_link: raw.maps_link || null,
    photo_url: raw.photo_url || null,
    image: raw.photo_url || null,
    budget_usd: budgetUsd,
    budgetUsd,
    budget_remaining_usd: budgetRemainingUsd,
    spentUsd: 0,
    verifiedVisits: 0,
    funded,
    reward_mode: rewardMode,
    reward: rewardObj,
    rewardUsd,
    ...(minCheckinUsd ? { minCheckinUsd } : {}),
    merchantEmail: funded
      ? process.env.PAYPAL_MERCHANT_EMAIL ||
        `sb-merchant-${String(raw.id || 'roamr').replace(/[^a-z0-9-]/gi, '')}@business.example.com`
      : '',
    ai_private: raw.ai_private || {
      must_show: [],
      reject_if: [],
      bill_checks: [],
      notes: '',
    },
  };
}

const rawSeed = loadRawSeed();
const geocodeCache = loadGeocodeCache();
const SEED_QUESTS = rawSeed.quests.map((q) => normalizeSeedQuest(q, rawSeed.city, geocodeCache));

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
    const t = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) return null;
      const data = await res.json();
      const coords = data?.features?.[0]?.geometry?.coordinates;
      if (Array.isArray(coords) && coords.length >= 2) {
        return { lng: Number(coords[0]), lat: Number(coords[1]) };
      }
    } finally {
      clearTimeout(t);
    }
  } catch (err) {
    console.warn('[seedQuests] Mapbox geocode error:', err.message);
  }
  return null;
}

async function geocodeMissingSeedQuests(quests) {
  let updated = false;
  const cache = loadGeocodeCache();

  for (const quest of quests) {
    if ((quest.lat == null || quest.lng == null) && quest.geocode_query) {
      const resolved = await geocodeAddressWithMapbox(quest.geocode_query);
      if (resolved) {
        quest.lat = resolved.lat;
        quest.lng = resolved.lng;
        quest.coordinates = { latitude: resolved.lat, longitude: resolved.lng };
        cache[quest.id] = { lat: resolved.lat, lng: resolved.lng };
        updated = true;
        console.log(
          `[seedQuests] Geocoded "${quest.id}" -> (${resolved.lat.toFixed(5)}, ${resolved.lng.toFixed(5)})`
        );
      } else {
        console.warn(
          `[seedQuests] Could not geocode "${quest.id}" (${quest.geocode_query}); using fallback coords.`
        );
      }
    }
  }

  if (updated) {
    saveGeocodeCache(cache);
  }
  return quests;
}

module.exports = {
  USD_TO_INR,
  SEED_QUESTS,
  geocodeAddressWithMapbox,
  geocodeMissingSeedQuests,
};
