const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

// Isolate test database so roamr.sqlite remains clean for live server runs
const tmpDbPath = path.join(os.tmpdir(), `roamr-prompt1-test-${Date.now()}.sqlite`);
process.env.SQLITE_DB_PATH = tmpDbPath;
process.env.DEMO_MODE = 'true';

const { app, db, seedDatabaseFromFile } = require('./src/index');

function httpReq(server, method, urlPath, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: addr.port,
        path: urlPath,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {
            json = text;
          }
          resolve({ status: res.statusCode, body: json });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function run() {
  let server;
  try {
    // 1. Seed & idempotency
    const seed1 = await seedDatabaseFromFile();
    assert.strictEqual(seed1.totalPlaces, 18, `Expected 18 places, got ${seed1.totalPlaces}`);
    assert.strictEqual(seed1.totalQuests, 18, `Expected 18 quests, got ${seed1.totalQuests}`);
    assert.strictEqual(seed1.fundedQuests, 7, `Expected 7 funded quests, got ${seed1.fundedQuests}`);

    const seed2 = await seedDatabaseFromFile();
    assert.strictEqual(seed2.insertedPlaces, 0, 'Second seed run must insert 0 places');
    assert.strictEqual(seed2.insertedQuests, 0, 'Second seed run must insert 0 quests');

    const smashPlace = db
      .prepare("SELECT * FROM places WHERE name LIKE '%Smash Guys%'")
      .get();
    assert(smashPlace, 'Smash Guys place should exist in places');
    assert(
      typeof smashPlace.lat === 'number' && typeof smashPlace.lng === 'number',
      'Smash Guys lat/lng should be populated'
    );
    console.log('[PASS] 1. Seed idempotent: 18 places, 18 quests, 7 funded, coordinates ready.');

    server = await new Promise((resolve) => {
      const srv = app.listen(0, '127.0.0.1', () => resolve(srv));
    });

    const adminEmail = String(process.env.ADMIN_EMAIL || 'tsrinath2020@gmail.com').trim();
    const travelerHeaders = {
      'x-user-email': 'traveler@roamr.test',
      'x-user-name': 'Test Traveler',
      'x-user-role': 'admin', // Spoof attempt must be ignored
    };
    const ownerHeaders = {
      'x-user-email': 'matteo.owner@roamr.test',
      'x-user-name': 'Matteo Owner',
    };
    const adminHeaders = {
      'x-user-email': adminEmail,
      'x-user-name': 'ROAMR Admin',
    };

    // 2. Traveler GET /api/quests and GET /api/places/:id NEVER contain ai_private
    const questsRes = await httpReq(server, 'GET', '/api/quests', { headers: travelerHeaders });
    assert.strictEqual(questsRes.status, 200);
    assert.strictEqual(questsRes.body.quests.length, 18);
    for (const q of questsRes.body.quests) {
      assert(!('ai_private' in q), `ai_private leaked in GET /api/quests for ${q.id}`);
      assert(!('aiReferenceImages' in q), `aiReferenceImages leaked in GET /api/quests for ${q.id}`);
      assert(!('aiInstructions' in q), `aiInstructions leaked in GET /api/quests for ${q.id}`);
    }

    const fundedRes = await httpReq(server, 'GET', '/api/quests?funded=true', { headers: travelerHeaders });
    assert.strictEqual(fundedRes.status, 200);
    assert.strictEqual(fundedRes.body.quests.length, 7);

    const placesRes = await httpReq(server, 'GET', '/api/places', { headers: travelerHeaders });
    assert.strictEqual(placesRes.status, 200);
    assert.strictEqual(placesRes.body.places.length, 18);

    const firstPlaceId = placesRes.body.places[0].id;
    const commercialPlaces = placesRes.body.places.filter(
      (p) =>
        !/history|nature|museum|park/i.test(p.category || '') &&
        !/museum|park|memorial|cathedral|gallery/i.test(p.name || '')
    );
    const venuePlaceId = commercialPlaces[0].id;
    const otherVenueId = commercialPlaces[1].id;
    const monumentPlace = placesRes.body.places.find((p) =>
      /museum|park|cathedral|gallery|heritage|nature|history/i.test(`${p.category || ''} ${p.name || ''}`)
    );
    const placeDetailRes = await httpReq(server, 'GET', `/api/places/${firstPlaceId}`, {
      headers: travelerHeaders,
    });
    assert.strictEqual(placeDetailRes.status, 200);
    assert(placeDetailRes.body.quests.length >= 1, 'Place should return its quests');
    for (const q of placeDetailRes.body.quests) {
      assert(!('ai_private' in q), `ai_private leaked in GET /api/places/${firstPlaceId}`);
    }
    console.log('[PASS] 2. GET /api/quests and GET /api/places/:id expose zero ai_private to travelers.');

    // 3. Role decided strictly on server
    const meTraveler = await httpReq(server, 'GET', '/api/me', { headers: travelerHeaders });
    assert.strictEqual(meTraveler.body.user.role, 'traveler', 'Client header must never grant admin');
    const forbiddenAdmin = await httpReq(server, 'GET', '/api/admin/claims', {
      headers: travelerHeaders,
    });
    assert.strictEqual(forbiddenAdmin.status, 403);

    const meAdmin = await httpReq(server, 'GET', '/api/me', { headers: adminHeaders });
    assert.strictEqual(meAdmin.body.user.role, 'admin', 'ADMIN_EMAIL must resolve role=admin');
    console.log('[PASS] 3. Admin role resolved strictly on server and non-admin receives 403.');

    // 3b. All 18 seeded Bengaluru places belong to Superadmin & money routes to Superadmin only
    for (const p of placesRes.body.places) {
      assert.strictEqual(
        p.owner_id,
        meAdmin.body.user.id,
        `Seeded place ${p.name} must be owned by Superadmin`
      );
      assert.strictEqual(p.claim_status, 'approved');
    }
    const seededFundedQuest = fundedRes.body.quests[0];
    assert.strictEqual(seededFundedQuest.superadmin_owned, true);

    const claimSeededFail = await httpReq(server, 'POST', `/api/places/${venuePlaceId}/claim`, {
      headers: ownerHeaders,
      body: {
        business_name: 'Hijack Matteo',
        paypal_email: 'hijack@business.example.com',
      },
    });
    assert.strictEqual(claimSeededFail.status, 400, 'Non-superadmin cannot claim seeded Bengaluru places');

    const editSeededFail = await httpReq(server, 'PUT', `/api/quests/${seededFundedQuest.id}`, {
      headers: ownerHeaders,
      body: { title: 'Hijacked Title' },
    });
    assert.strictEqual(editSeededFail.status, 403, 'Non-superadmin cannot edit seeded Bengaluru quests');

    const fundSeededFail = await httpReq(server, 'POST', '/api/quests/fund', {
      headers: ownerHeaders,
      body: { questId: seededFundedQuest.id, amountUsd: 25, simulate: true },
    });
    assert.strictEqual(fundSeededFail.status, 403, 'Non-superadmin cannot fund seeded Bengaluru quests');

    const adminEditSeededOk = await httpReq(server, 'PUT', `/api/quests/${seededFundedQuest.id}`, {
      headers: adminHeaders,
      body: { est_minutes: 25 },
    });
    assert.strictEqual(adminEditSeededOk.status, 200, 'Superadmin can edit seeded Bengaluru quests');

    const checkinRouteRes = await httpReq(server, 'POST', '/api/checkin/order', {
      headers: travelerHeaders,
      body: {
        questId: seededFundedQuest.id,
        merchantEmail: 'hijack-merchant@evil.example.com',
        amountUsd: 3.0,
        simulate: true,
      },
    });
    assert.strictEqual(checkinRouteRes.status, 200);
    assert.notStrictEqual(
      checkinRouteRes.body.payeeEmail,
      'hijack-merchant@evil.example.com',
      'Seeded Bengaluru place check-in must ignore client merchantEmail override'
    );
    assert.strictEqual(
      checkinRouteRes.body.payeeEmail,
      seededFundedQuest.merchantEmail,
      'Seeded Bengaluru place check-in must route money strictly to Superadmin PayPal'
    );
    console.log('[PASS] 3b. All 18 Bengaluru seed places locked to Superadmin & PayPal routed to Superadmin.');

    // 4. New owner starts with zeros in /api/owner/stats, registers 1 commercial place, respects 1-quest lock until approved
    const initialStats = await httpReq(server, 'GET', '/api/owner/stats', { headers: ownerHeaders });
    assert.strictEqual(initialStats.status, 200);
    assert.strictEqual(initialStats.body.funded, 0);
    assert.strictEqual(initialStats.body.spent, 0);
    assert.strictEqual(initialStats.body.paid_visits, 0);
    assert.strictEqual(initialStats.body.owned_places_count, 0);

    const unownedCreate = await httpReq(server, 'POST', '/api/quests', {
      headers: ownerHeaders,
      body: {
        place_id: venuePlaceId,
        title: 'Unauthorized Quest',
        public_objective: 'Try to create quest before owning place',
      },
    });
    assert.strictEqual(unownedCreate.status, 403, 'Non-owner must receive 403 on POST /api/quests');

    if (monumentPlace) {
      const rejectMonument = await httpReq(server, 'POST', '/api/me/business', {
        headers: ownerHeaders,
        body: {
          business_name: 'Bad Monument Biz',
          paypal_email: 'sb-bad@business.example.com',
          category: 'Museum',
          place: {
            name: 'Fake City Museum',
            address: 'Cubbon Park, Bengaluru',
            lat: 12.9763,
            lng: 77.5929,
            category: 'Museum',
            city: 'Bengaluru',
          },
        },
      });
      assert.strictEqual(rejectMonument.status, 400, 'Monuments/parks must be rejected for business venues');
    }

    // Register 1 commercial venue via /api/me/business -> pending verification -> admin approves -> lock lifted
    const regOwnerRes = await httpReq(server, 'POST', '/api/me/business', {
      headers: ownerHeaders,
      body: {
        business_name: 'Owner Test Biz',
        paypal_email: 'sb-owner@business.example.com',
        category: 'Cafe',
        place: {
          name: 'Owner Custom Roastery',
          address: 'Indiranagar 12th Main, Bengaluru',
          lat: 12.9718,
          lng: 77.6411,
          category: 'Cafe',
          city: 'Bengaluru',
        },
      },
    });
    assert.strictEqual(regOwnerRes.status, 200);
    const ownerCustomPlaceId = regOwnerRes.body.user.primary_place.id;
    assert.strictEqual(regOwnerRes.body.user.primary_place.claim_status, 'pending');

    // Second place claim must fail (1 place only per business)
    const secondPlaceFail = await httpReq(server, 'POST', `/api/places/${otherVenueId}/claim`, {
      headers: ownerHeaders,
      body: {
        business_name: 'Second Place Attempt',
        paypal_email: 'sb-owner@business.example.com',
      },
    });
    assert.strictEqual(secondPlaceFail.status, 400, 'Businesses can keep only 1 place');

    // Note: seed venue already has 1 quest; test 1-lock on a freshly registered business place via /api/me/business
    const lockTestHeaders = {
      'x-user-email': 'locked.cafe@roamr.test',
      'x-user-name': 'Locked Cafe Owner',
    };
    const bizRegRes = await httpReq(server, 'POST', '/api/me/business', {
      headers: lockTestHeaders,
      body: {
        business_name: 'Locked Cafe',
        paypal_email: 'sb-locked@business.example.com',
        place: {
          name: 'Locked Test Cafe',
          address: '100 Feet Road, Indiranagar',
          lat: 12.9719,
          lng: 77.6412,
          category: 'Cafe',
          city: 'Bengaluru',
        },
      },
    });
    assert.strictEqual(bizRegRes.status, 200);
    const lockedPlaceId = bizRegRes.body.user.primary_place.id;
    assert.strictEqual(bizRegRes.body.user.is_verified_business, false);

    // Unverified business can create 1 quest (1 lock)
    const firstLockQuest = await httpReq(server, 'POST', '/api/quests', {
      headers: lockTestHeaders,
      body: {
        place_id: lockedPlaceId,
        title: 'First Locked Cafe Quest',
        public_objective: 'Snap an espresso shot at Locked Cafe',
        category: 'Cafe',
        quest_type: 'purchase',
        budget_usd: 15,
        funded: true,
      },
    });
    assert.strictEqual(firstLockQuest.status, 201, `Expected 201 on 1st quest, got ${firstLockQuest.status}`);

    // Creating a 2nd quest before Superadmin verification must fail with 403 lock
    const secondLockFail = await httpReq(server, 'POST', '/api/quests', {
      headers: lockTestHeaders,
      body: {
        place_id: lockedPlaceId,
        title: 'Second Quest While Unverified',
        public_objective: 'Should be blocked until verified',
        category: 'Cafe',
      },
    });
    assert.strictEqual(secondLockFail.status, 403, '2nd quest while unverified must be blocked with 403');

    const pendingClaimsRes = await httpReq(server, 'GET', '/api/admin/claims', { headers: adminHeaders });
    assert.strictEqual(pendingClaimsRes.status, 200);
    const pendingLocked = pendingClaimsRes.body.claims.find((p) => p.id === lockedPlaceId);
    assert(pendingLocked && pendingLocked.claimant_email === 'locked.cafe@roamr.test');
    assert(pendingClaimsRes.body.claims.some((p) => p.id === ownerCustomPlaceId));

    const approveLocked = await httpReq(server, 'POST', `/api/admin/claims/${lockedPlaceId}/approve`, {
      headers: adminHeaders,
    });
    assert.strictEqual(approveLocked.status, 200);
    assert.strictEqual(approveLocked.body.place.claim_status, 'approved');

    const approveRes = await httpReq(server, 'POST', `/api/admin/claims/${ownerCustomPlaceId}/approve`, {
      headers: adminHeaders,
    });
    assert.strictEqual(approveRes.status, 200);
    assert.strictEqual(approveRes.body.place.claim_status, 'approved');
    assert(approveRes.body.place.owner_id, 'Approved place must have owner_id');

    const ownerCreateOk = await httpReq(server, 'POST', '/api/quests', {
      headers: ownerHeaders,
      body: {
        place_id: ownerCustomPlaceId,
        title: 'Owner Custom Quest',
        public_description: 'Created after place approval',
        public_objective: 'Snap a photo of your coffee cup',
        category: 'Cafe',
        quest_type: 'purchase',
        budget_usd: 15,
        funded: true,
        ai_private: {
          must_show: ['cup with latte art'],
          reject_if: ['stock photo'],
          bill_checks: ['receipt total visible'],
          notes: 'Internal owner note',
        },
      },
    });
    assert.strictEqual(ownerCreateOk.status, 201, `Expected 201, got ${ownerCreateOk.status}`);

    const ownerCreateOtherFail = await httpReq(server, 'POST', '/api/quests', {
      headers: ownerHeaders,
      body: {
        place_id: otherVenueId,
        title: 'Cross-place Unauthorized Quest',
        public_objective: 'Should fail',
        category: 'Cafe',
      },
    });
    assert.strictEqual(ownerCreateOtherFail.status, 403);

    const ownerQuestsRes = await httpReq(server, 'GET', '/api/owner/quests', { headers: ownerHeaders });
    assert.strictEqual(ownerQuestsRes.status, 200);
    const createdOwnerQuest = ownerQuestsRes.body.quests.find((q) => q.title === 'Owner Custom Quest');
    assert(createdOwnerQuest, 'Owner should see their created quest');
    assert(createdOwnerQuest.ai_private, 'Owner must receive ai_private for their own quest');
    assert.strictEqual(createdOwnerQuest.ai_private.notes, 'Internal owner note');

    const travelerCheckAgain = await httpReq(server, 'GET', '/api/quests', { headers: travelerHeaders });
    const publicCopy = travelerCheckAgain.body.quests.find((q) => q.id === createdOwnerQuest.id);
    assert(publicCopy, 'Public quest list should include newly created quest');
    assert(!('ai_private' in publicCopy), 'Traveler must NEVER see ai_private even on owner-created quests');
    console.log('[PASS] 4. 1-place rule, non-monument validation, unverified 1-lock, Superadmin verify & owner scoping verified.');

    // 5. Claim payout updates SQLite quest budget & claims table
    const fundedTarget = fundedRes.body.quests[0];
    const tinyJpegB64 = Buffer.from('fake-jpeg-payload-for-test-claim-at-least-40-bytes').toString('base64');
    const simOrderId = `SIM-CHECKIN-${Date.now()}`;
    const checkinCap = await httpReq(server, 'POST', '/api/checkin/order', {
      headers: travelerHeaders,
      body: {
        action: 'capture',
        questId: fundedTarget.id,
        orderId: simOrderId,
        amountUsd: 5,
        billInr: 420,
        simulate: true,
        payerOverride: { name: 'Test Traveler', email: 'traveler@roamr.test' },
      },
    });
    assert.strictEqual(checkinCap.status, 200);

    const claimSubmitRes = await httpReq(server, 'POST', '/api/claims', {
      headers: travelerHeaders,
      body: {
        questId: fundedTarget.id,
        demoMode: true,
        orderId: simOrderId,
        order: checkinCap.body,
        photoBase64: tinyJpegB64,
        billInr: 420,
        gps: {
          latitude: fundedTarget.lat,
          longitude: fundedTarget.lng,
          mocked: false,
        },
        traveler: {
          name: 'Test Traveler',
          email: 'traveler@roamr.test',
          paypalEmail: 'sb-traveler@personal.example.com',
        },
      },
    });
    assert.strictEqual(claimSubmitRes.status, 201);
    assert.strictEqual(claimSubmitRes.body.claim.status, 'paid');
    assert(claimSubmitRes.body.claim.rewardUsd > 0, 'Funded claim must pay rewardUsd > 0');
    assert(
      claimSubmitRes.body.quest.budget_remaining_usd < fundedTarget.budget_remaining_usd,
      'SQLite budget_remaining_usd must decrement after paid claim'
    );
    const dbClaimRow = db
      .prepare('SELECT * FROM claims WHERE id = ?')
      .get(claimSubmitRes.body.claim.id);
    assert(dbClaimRow && dbClaimRow.status === 'paid', 'Claim must be persisted in SQLite claims table');
    console.log('[PASS] 5. Claim verification decrements SQLite budget and records claim row.');

    // 6. Business data scoping & strict Admin 403 enforcement
    const bizBHeaders = {
      'x-user-email': 'brandnew.biz@roamr.test',
      'x-user-name': 'Brand New Business',
    };
    const ownerAId = (await httpReq(server, 'GET', '/api/me', { headers: ownerHeaders })).body.user.id;

    // Brand-new business sees empty states & zeros even if passing ?owner_id=<ownerAId>&business_id=<ownerAId>
    const bStats = await httpReq(
      server,
      'GET',
      `/api/owner/stats?owner_id=${ownerAId}&business_id=${ownerAId}`,
      { headers: bizBHeaders }
    );
    assert.strictEqual(bStats.status, 200);
    assert.strictEqual(bStats.body.funded, 0);
    assert.strictEqual(bStats.body.spent, 0);
    assert.strictEqual(bStats.body.received, 0);
    assert.strictEqual(bStats.body.paid_visits, 0);
    assert.strictEqual(bStats.body.quests_count, 0);

    const bQuests = await httpReq(
      server,
      'GET',
      `/api/owner/quests?owner_id=${ownerAId}&business_id=${ownerAId}`,
      { headers: bizBHeaders }
    );
    assert.strictEqual(bQuests.status, 200);
    assert.strictEqual(bQuests.body.quests.length, 0);

    const bAudits = await httpReq(
      server,
      'GET',
      `/api/owner/audits?owner_id=${ownerAId}&business_id=${ownerAId}`,
      { headers: bizBHeaders }
    );
    assert.strictEqual(bAudits.status, 200);
    assert.strictEqual(bAudits.body.audits.length, 0);

    const bClaims = await httpReq(server, 'GET', '/api/owner/claims', { headers: bizBHeaders });
    assert.strictEqual(bClaims.status, 200);
    assert.strictEqual(bClaims.body.claims.length, 0);

    const bFunding = await httpReq(server, 'GET', '/api/owner/funding', { headers: bizBHeaders });
    assert.strictEqual(bFunding.status, 200);
    assert.strictEqual(bFunding.body.funding.length, 0);

    const bDash = await httpReq(server, 'GET', '/api/owner/dashboard', { headers: bizBHeaders });
    assert.strictEqual(bDash.status, 200);
    assert.strictEqual(bDash.body.quests.length, 0);
    assert.strictEqual(bDash.body.claims.length, 0);
    assert.strictEqual(bDash.body.funding.length, 0);
    assert.strictEqual(bDash.body.received, 0);

    // Business B cannot read, edit, disable, or delete Business A's quest
    const bReadA = await httpReq(server, 'GET', `/api/business/quests/${createdOwnerQuest.id}`, {
      headers: bizBHeaders,
    });
    assert.strictEqual(bReadA.status, 403);

    const bEditA = await httpReq(server, 'PUT', `/api/quests/${createdOwnerQuest.id}`, {
      headers: bizBHeaders,
      body: { title: 'Tampered', active: false },
    });
    assert.strictEqual(bEditA.status, 403);

    const bDeleteA = await httpReq(server, 'DELETE', `/api/quests/${createdOwnerQuest.id}`, {
      headers: bizBHeaders,
    });
    assert.strictEqual(bDeleteA.status, 403);

    // Business B cannot read a claim on another business's quest
    const bReadClaim = await httpReq(
      server,
      'GET',
      `/api/claims/${claimSubmitRes.body.claim.id}`,
      { headers: bizBHeaders }
    );
    assert.strictEqual(bReadClaim.status, 403);

    // Non-admin gets 403 on EVERY /api/admin route
    const adminChecks = [
      ['POST', '/api/admin/places', { name: 'X', address: 'Y' }],
      ['PATCH', `/api/admin/places/${venuePlaceId}`, { name: 'X' }],
      ['POST', '/api/admin/quests', { place_id: venuePlaceId, title: 'X', public_objective: 'Y' }],
      ['GET', `/api/admin/quests/${fundedTarget.id}`, null],
      ['PATCH', `/api/admin/quests/${fundedTarget.id}`, { title: 'X' }],
      ['GET', '/api/admin/claims', null],
      ['POST', `/api/admin/claims/${venuePlaceId}/approve`, {}],
      ['POST', `/api/admin/claims/${venuePlaceId}/reject`, {}],
      ['GET', '/api/admin/escalated-claims', null],
      ['POST', `/api/admin/claims/${claimSubmitRes.body.claim.id}/release-cashback`, {}],
    ];
    for (const [method, urlPath, body] of adminChecks) {
      const r = await httpReq(server, method, urlPath, { headers: bizBHeaders, body });
      assert.strictEqual(r.status, 403, `Expected 403 for non-admin on ${method} ${urlPath}, got ${r.status}`);
    }
    console.log('[PASS] 6. Business scoping & 403 on every /api/admin route verified.');

    // 7. Owner escalation for low-AI visit -> Superhost cashback release & Remove Verification
    const ownerClaimSubmit = await httpReq(server, 'POST', '/api/claims', {
      headers: {
        'x-user-email': 'traveler@roamr.test',
        'x-user-name': 'Test Traveler',
      },
      body: {
        questId: createdOwnerQuest.id,
        travelerName: 'Test Traveler',
        travelerPaypalEmail: 'sb-traveler@personal.example.com',
        photoUri: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==',
        gps: { latitude: 12.9718, longitude: 77.6411 },
        demo_mode: true,
        order: {
          orderId: 'SIM-ESC-1',
          captureId: 'SIM-ESC-CAP-1',
          questId: createdOwnerQuest.id,
          status: 'COMPLETED',
          amountUsd: 5,
        },
      },
    });
    assert.strictEqual(ownerClaimSubmit.status, 201);
    const ownerClaimId = ownerClaimSubmit.body.claim.id;

    const escWrongOwner = await httpReq(
      server,
      'POST',
      `/api/claims/${ownerClaimId}/escalate`,
      { headers: bizBHeaders, body: { note: 'Unauthorized escalate' } }
    );
    assert.strictEqual(escWrongOwner.status, 403, 'Wrong owner cannot escalate another business claim');

    const escOwner = await httpReq(
      server,
      'POST',
      `/api/claims/${ownerClaimId}/escalate`,
      { headers: ownerHeaders, body: { note: 'Genuine visitor at counter' } }
    );
    assert.strictEqual(escOwner.status, 200);
    assert.strictEqual(escOwner.body.claim.status, 'pending_superhost');

    const escList = await httpReq(server, 'GET', '/api/admin/escalated-claims', {
      headers: adminHeaders,
    });
    assert.strictEqual(escList.status, 200);
    assert(escList.body.claims.some((c) => c.id === ownerClaimId));

    const releaseRes = await httpReq(
      server,
      'POST',
      `/api/admin/claims/${ownerClaimId}/release-cashback`,
      { headers: adminHeaders }
    );
    assert.strictEqual(releaseRes.status, 200);
    assert.strictEqual(releaseRes.body.claim.status, 'paid');

    const removeVerify = await httpReq(
      server,
      'POST',
      `/api/admin/claims/${ownerCustomPlaceId}/reject`,
      { headers: adminHeaders, body: { note: 'Verification removed by Superhost' } }
    );
    assert.strictEqual(removeVerify.status, 200);
    assert.strictEqual(removeVerify.body.place.claim_status, 'rejected');
    assert.strictEqual(removeVerify.body.place.owner_id, null);
    console.log('[PASS] 7. Owner escalation, Superhost cashback release, and Remove Verification verified.');
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    db.close();
    try {
      fs.unlinkSync(tmpDbPath);
      fs.unlinkSync(`${tmpDbPath}-wal`);
      fs.unlinkSync(`${tmpDbPath}-shm`);
    } catch {
      // ignore cleanup errors
    }
  }
}

run().catch((err) => {
  console.error('[FAIL]', err);
  process.exit(1);
});
