const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Preserve existing claims.json & checkin_orders.json around the test
const CLAIMS_PATH = path.resolve(__dirname, 'data/claims.json');
const ORDERS_PATH = path.resolve(__dirname, 'data/checkin_orders.json');
const CLAIMS_BAK = fs.existsSync(CLAIMS_PATH) ? fs.readFileSync(CLAIMS_PATH, 'utf8') : null;
const ORDERS_BAK = fs.existsSync(ORDERS_PATH) ? fs.readFileSync(ORDERS_PATH, 'utf8') : null;

const { app, questsStore, startServer } = require('./src/index');
const { geocodeMissingSeedQuests } = require('./src/data/seedQuests');
const { buildZapierPayload } = require('./services/zapier.ts');
const { getAndVerifyOrder } = require('./src/services/paypalService');

async function runTests() {
  await geocodeMissingSeedQuests(questsStore);

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`Test server started on ${baseUrl}`);

  try {
    // 1. Prompt A test: GET /api/quests returns all seeded quests & ZERO ai_private anywhere
    const qRes = await fetch(`${baseUrl}/api/quests`);
    assert.strictEqual(qRes.status, 200, 'GET /api/quests must return 200');
    const qBody = await qRes.json();
    assert.ok(Array.isArray(qBody.quests), 'quests should be an array');
    assert.ok(qBody.quests.length >= 18, `Expected >= 18 quests, got ${qBody.quests.length}`);
    for (const q of qBody.quests) {
      assert.strictEqual('ai_private' in q, false, `Quest ${q.id} leaked ai_private!`);
      assert.strictEqual('aiInstructions' in q, false, `Quest ${q.id} leaked aiInstructions!`);
      assert.strictEqual('aiReferenceImages' in q, false, `Quest ${q.id} leaked aiReferenceImages!`);
    }
    const rawJson = JSON.stringify(qBody);
    assert.strictEqual(rawJson.includes('ai_private'), false, 'Response JSON must never contain ai_private');

    const fundedSeed = qBody.quests.filter((q) => q.funded === true);
    const xpSeed = qBody.quests.filter((q) => q.funded === false && q.reward_mode === 'xp_only');
    assert.strictEqual(fundedSeed.length, 7, 'Seed must have exactly 7 funded quests');
    assert.strictEqual(xpSeed.length, 11, 'Seed must have exactly 11 xp_only quests');

    const smash = qBody.quests.find((q) => q.id === 'smash-guys-burger-kitchen');
    assert.ok(smash, 'smash-guys-burger-kitchen seed present');
    console.log('PASS 1: GET /api/quests exposes 0 ai_private fields; 7 funded + 11 xp_only; smash-guys coords =', smash.lat, smash.lng);

    // 2. Prompt A test: POST /api/quests with budget=0 saves as XP-only cleanly without PayPal
    const xpCreateRes = await fetch(`${baseUrl}/api/quests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Free XP Temple Walk',
        businessName: 'Local Guide',
        place_name: 'Bull Temple',
        category: 'History',
        quest_type: 'visit',
        public_description: 'Historic granite temple.',
        public_objective: 'Photograph the outer pavilion.',
        lat: 12.9419,
        lng: 77.5681,
        budget_usd: 0,
        ai_private: { must_show: ['granite pavilion'], reject_if: ['stock image'], bill_checks: [] },
      }),
    });
    assert.strictEqual(xpCreateRes.status, 201);
    const xpCreated = (await xpCreateRes.json()).quest;
    assert.strictEqual(xpCreated.funded, false);
    assert.strictEqual(xpCreated.reward_mode, 'xp_only');
    assert.strictEqual('ai_private' in xpCreated, false, 'POST /api/quests must not echo ai_private');

    // Also test global funded quest creation
    const createRes = await fetch(`${baseUrl}/api/quests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Test Global Tokyo Stop',
        businessName: 'Tokyo Tea Host',
        place_name: 'Kissa Koffee Tokyo',
        category: 'Cafe',
        quest_type: 'purchase',
        public_description: 'Small coffee bar in Shibuya.',
        public_objective: 'Order pour-over coffee and snap receipt.',
        lat: 35.6595,
        lng: 139.7004,
        radius_m: 200,
        night_only: false,
        reward: { min_bill_inr: 250, cashback_percent: 20, max_reward_usd: 2.0 },
        rewardUsd: 2.0,
        budget_usd: 15,
        ai_private: {
          must_show: ['pour-over carafe', 'Kissa receipt'],
          reject_if: ['stock photo'],
          bill_checks: ['date is today'],
          notes: 'Secret AI rule',
        },
      }),
    });
    assert.strictEqual(createRes.status, 201, 'POST /api/quests should return 201');
    const createdBody = await createRes.json();
    assert.strictEqual('ai_private' in createdBody.quest, false, 'POST /api/quests must not echo ai_private');

    const qResAfterCreate = await fetch(`${baseUrl}/api/quests`);
    const qBody2 = await qResAfterCreate.json();
    const createdPublic = qBody2.quests.find((q) => q.id === createdBody.quest.id);
    assert.ok(createdPublic, 'Newly created quest appears in GET /api/quests');
    assert.strictEqual('ai_private' in createdPublic, false, 'Newly created quest in GET must not leak ai_private');

    // Verify business edit endpoint & PUT /api/quests/:id
    const unauthEdit = await fetch(`${baseUrl}/api/business/quests/${createdPublic.id}`);
    assert.strictEqual(unauthEdit.status, 403, 'Host edit endpoint requires business role header');
    const authEdit = await fetch(`${baseUrl}/api/business/quests/${createdPublic.id}`, {
      headers: { 'x-roamr-role': 'business' },
    });
    assert.strictEqual(authEdit.status, 200);
    const editJson = await authEdit.json();
    assert.ok(editJson.quest.ai_private, 'Business edit endpoint includes ai_private');

    const updateRes = await fetch(`${baseUrl}/api/quests/${createdPublic.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Test Global Tokyo Stop (Edited)',
        public_objective: 'Order matcha latte and snap receipt.',
        radius_m: 250,
      }),
    });
    assert.strictEqual(updateRes.status, 200);
    const updatedJson = await updateRes.json();
    assert.strictEqual(updatedJson.quest.title, 'Test Global Tokyo Stop (Edited)');
    assert.strictEqual(updatedJson.quest.radius_m, 250);
    assert.strictEqual('ai_private' in updatedJson.quest, false, 'PUT /api/quests/:id must not echo ai_private');
    console.log('PASS 2: POST/PUT /api/quests & /api/business/quests/:id work cleanly & ai_private stays hidden');

    // 3. Prompt B: Hard checks & Visit vs Purchase flow + Retake & Auto-Pay thresholds
    const visitQuest = qBody.quests.find((q) => q.id === 'cubbon-park');
    assert.ok(visitQuest && visitQuest.quest_type === 'visit', 'cubbon-park visit quest present');

    // 3a. Distance failure (> radius_m) stops immediately
    const farRes = await fetch(`${baseUrl}/api/claims`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        questId: visitQuest.id,
        photoUri: 'https://example.com/photo.jpg',
        gps: { latitude: 13.05, longitude: 77.59, mocked: false },
        traveler: { name: 'Tester One', email: 't1@roamr.app', paypalEmail: 'sb1@personal.example.com' },
        demoMode: false,
      }),
    });
    const farClaim = (await farRes.json()).claim;
    assert.strictEqual(farClaim.status, 'rejected');
    assert.ok(farClaim.reviewNote.includes('Distance is'), `Expected distance reason, got: ${farClaim.reviewNote}`);
    console.log('PASS 3a: Distance hard check rejected cleanly:', farClaim.reviewNote);

    // 3b. Night-only quest daytime failure in Asia/Kolkata IST
    const nightQuest = qBody.quests.find((q) => q.night_only === true);
    assert.ok(nightQuest, 'Night quest present in seed');
    const dayRes = await fetch(`${baseUrl}/api/claims`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        questId: nightQuest.id,
        photoUri: 'https://example.com/night.jpg',
        gps: { latitude: nightQuest.lat, longitude: nightQuest.lng, mocked: false },
        traveler: { name: 'Day Tester', email: 'day@roamr.app', paypalEmail: 'sb-day@personal.example.com' },
        demoMode: false,
        _nowIsoOverride: '2026-11-12T06:30:00.000Z', // 12:00 PM IST -> daytime!
      }),
    });
    const dayClaim = (await dayRes.json()).claim;
    assert.strictEqual(dayClaim.status, 'rejected');
    assert.ok(dayClaim.reviewNote.includes('18:30'), `Expected night check failure, got: ${dayClaim.reviewNote}`);
    console.log('PASS 3b: Night-only IST daytime check rejected cleanly');

    // 3c. Confidence 0.40-0.75 -> "retake", then 1 retry >= 0.75 -> auto-paid, then 2nd paid claim blocked (1 per user)
    const retakeRes = await fetch(`${baseUrl}/api/claims`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        questId: visitQuest.id,
        photoUri: 'https://example.com/blurry.jpg',
        gps: { latitude: visitQuest.lat, longitude: visitQuest.lng, mocked: false },
        traveler: { name: 'Riya Patel', email: 'riya@roamr.app', paypalEmail: 'sb-riya@personal.example.com' },
        demoMode: false,
        _aiResultOverride: {
          verdict: 'flag',
          confidence: 0.58,
          reasons: ['Bandstand roof is partially cropped; step back slightly.'],
        },
      }),
    });
    const retakeClaim = (await retakeRes.json()).claim;
    assert.strictEqual(retakeClaim.status, 'retake');

    const retryPaidRes = await fetch(`${baseUrl}/api/claims`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        questId: visitQuest.id,
        photoUri: 'https://example.com/clear.jpg',
        gps: { latitude: visitQuest.lat, longitude: visitQuest.lng, mocked: false },
        traveler: { name: 'Riya Patel', email: 'riya@roamr.app', paypalEmail: 'sb-riya@personal.example.com' },
        demoMode: false,
        _aiResultOverride: {
          verdict: 'pass',
          confidence: 0.91,
          reasons: ['Bandstand and pathway clearly visible.'],
        },
      }),
    });
    const paidVisitJson = await retryPaidRes.json();
    const paidVisitClaim = paidVisitJson.claim;
    assert.strictEqual(paidVisitClaim.status, 'paid');
    assert.strictEqual(paidVisitClaim.rewardMode, 'xp_only');
    assert.strictEqual(paidVisitClaim.rewardUsd, 0, 'Unfunded XP-only quest pays $0');
    assert.strictEqual(paidVisitClaim.webhookStatus, 'skipped_xp_only', 'XP-only skips Zapier webhook');

    // Duplicate user claim after paid must reject
    const dupRes = await fetch(`${baseUrl}/api/claims`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        questId: visitQuest.id,
        photoUri: 'https://example.com/clear2.jpg',
        gps: { latitude: visitQuest.lat, longitude: visitQuest.lng, mocked: false },
        traveler: { name: 'Riya Patel', email: 'riya@roamr.app', paypalEmail: 'sb-riya@personal.example.com' },
        demoMode: false,
      }),
    });
    const dupClaim = (await dupRes.json()).claim;
    assert.strictEqual(dupClaim.status, 'rejected');
    assert.ok(dupClaim.reviewNote.includes('One claim per user'));
    console.log('PASS 3c: Retake -> 1 Retry -> Auto-Paid -> Duplicate blocked cleanly');

    // 4. Purchase quest cashback math + 10% bill mismatch check + Demo SIM order verification
    const matteo = qBody.quests.find((q) => q.id === 'matteo-coffea'); // min 200 INR, 15%, max $2.00
    const createOrderRes = await fetch(`${baseUrl}/api/checkin/order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'create',
        questId: matteo.id,
        questTitle: matteo.title,
        merchantEmail: matteo.merchantEmail,
        amountUsd: 5.0,
        simulate: true,
      }),
    });
    assert.strictEqual(createOrderRes.status, 200, 'checkin order create on funded quest must succeed!');
    const simOrder = await createOrderRes.json();
    const capRes = await fetch(`${baseUrl}/api/checkin/order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'capture',
        questId: matteo.id,
        orderId: simOrder.orderId,
        merchantEmail: simOrder.payeeEmail,
        amountUsd: 5.0,
      }),
    });
    const capturedOrder = await capRes.json();
    assert.strictEqual(capturedOrder.status, 'COMPLETED');

    // Before claim submission, GET /api/checkin/orders?includeDemo=1 must show this paid order waiting for AI analysis
    const pendingOrdersBeforeRes = await fetch(`${baseUrl}/api/checkin/orders?questId=${matteo.id}&includeDemo=1`);
    const pendingOrdersBefore = (await pendingOrdersBeforeRes.json()).orders;
    assert.ok(
      pendingOrdersBefore.some((o) => o.orderId === capturedOrder.orderId),
      'Captured PayPal check-in order must appear in pending visitors list awaiting AI'
    );

    // Bill mismatch (>10% difference between bill_total_read=200 and paid billInr=420) must reject even if confidence was 0.85!
    const mismatchRes = await fetch(`${baseUrl}/api/claims`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        questId: matteo.id,
        orderId: capturedOrder.orderId,
        orderSummary: capturedOrder,
        billInr: 420,
        photoUri: 'https://example.com/coffee.jpg',
        gps: { latitude: matteo.lat, longitude: matteo.lng, mocked: false },
        traveler: { name: 'Kabir Shah', email: 'kabir@roamr.app', paypalEmail: 'sb-k@personal.example.com' },
        demoMode: false,
        _aiResultOverride: {
          verdict: 'pass',
          confidence: 0.88,
          reasons: ['Coffee cup matches venue.'],
          bill_total_read: 200,
        },
      }),
    });
    const mismatchClaim = (await mismatchRes.json()).claim;
    assert.strictEqual(mismatchClaim.status, 'rejected', 'Bill mismatch >10% must reject');
    console.log('PASS 4a: Purchase bill >10% mismatch rejected automatically');

    // Valid matching bill (420 INR = $5.00 USD -> 15% cashback = $0.75) pays $0.75
    const validPurchaseRes = await fetch(`${baseUrl}/api/claims`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        questId: matteo.id,
        orderId: capturedOrder.orderId,
        orderSummary: capturedOrder,
        billInr: 420,
        photoUri: 'https://example.com/coffee.jpg',
        gps: { latitude: matteo.lat, longitude: matteo.lng, mocked: false },
        traveler: { name: 'Ananya Rao', email: 'ananya@roamr.app', paypalEmail: 'sb-a@personal.example.com' },
        demoMode: false,
        _aiResultOverride: {
          verdict: 'pass',
          confidence: 0.92,
          reasons: ['Espresso cup + Matteo Coffea branding confirmed.'],
          bill_total_read: 420,
        },
      }),
    });
    const paidPurchaseJson = await validPurchaseRes.json();
    const paidPurchase = paidPurchaseJson.claim;
    assert.strictEqual(paidPurchase.status, 'paid');
    assert.strictEqual(paidPurchase.rewardMode, 'cashback');
    assert.strictEqual(paidPurchase.rewardUsd, 0.75);
    assert.strictEqual(paidPurchaseJson.quest.budget_remaining_usd, 19.25);

    const pendingOrdersAfterRes = await fetch(`${baseUrl}/api/checkin/orders?questId=${matteo.id}&includeDemo=1`);
    const pendingOrdersAfter = (await pendingOrdersAfterRes.json()).orders;
    assert.strictEqual(
      pendingOrdersAfter.some((o) => o.orderId === capturedOrder.orderId),
      false,
      'Once claim is submitted for the order, it moves from awaiting-AI orders into claims'
    );
    console.log('PASS 4b: Purchase claim auto-paid exact 15% cashback ($0.75 on $5.00 / INR 420) & decremented budget_remaining_usd to $19.25');

    // 4c. Budget exhaustion mid-claim: drain corner-house remaining budget -> flips to funded=false, next claim gets XP only!
    const corner = questsStore.find((q) => q.id === 'corner-house');
    corner.budget_remaining_usd = 0.50;
    const cornerOrderRes = await fetch(`${baseUrl}/api/checkin/order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'create',
        questId: corner.id,
        questTitle: corner.title,
        merchantEmail: corner.merchantEmail,
        amountUsd: 5.0,
        simulate: true,
      }),
    });
    const cornerSimOrder = await cornerOrderRes.json();
    const cornerCapRes = await fetch(`${baseUrl}/api/checkin/order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'capture',
        questId: corner.id,
        orderId: cornerSimOrder.orderId,
        merchantEmail: cornerSimOrder.payeeEmail,
        amountUsd: 5.0,
      }),
    });
    const cornerCapturedOrder = await cornerCapRes.json();

    const drainRes = await fetch(`${baseUrl}/api/claims`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        questId: corner.id,
        orderId: cornerCapturedOrder.orderId,
        orderSummary: cornerCapturedOrder,
        billInr: 420,
        photoUri: 'https://example.com/dbc1.jpg',
        gps: { latitude: corner.lat, longitude: corner.lng, mocked: false },
        traveler: { name: 'Meera Nair', email: 'meera@roamr.app', paypalEmail: 'sb-m@personal.example.com' },
        demoMode: false,
        _aiResultOverride: { verdict: 'pass', confidence: 0.9, reasons: ['DBC dessert shown.'], bill_total_read: 420 },
      }),
    });
    const drainData = await drainRes.json();
    assert.strictEqual(drainData.claim.rewardUsd, 0.5);
    assert.strictEqual(drainData.quest.budget_remaining_usd, 0);
    assert.strictEqual(drainData.quest.funded, false);
    assert.strictEqual(drainData.quest.reward_mode, 'xp_only');

    // Next traveler on sold-out corner-house receives XP-only fallback without error!
    const soldOutRes = await fetch(`${baseUrl}/api/claims`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        questId: corner.id,
        photoUri: 'https://example.com/dbc2.jpg',
        gps: { latitude: corner.lat, longitude: corner.lng, mocked: false },
        traveler: { name: 'Rohan Das', email: 'rohan@roamr.app', paypalEmail: 'sb-r@personal.example.com' },
        demoMode: false,
        _aiResultOverride: { verdict: 'pass', confidence: 0.9, reasons: ['DBC dessert shown.'] },
      }),
    });
    const soldOutData = await soldOutRes.json();
    assert.strictEqual(soldOutData.claim.status, 'paid');
    assert.strictEqual(soldOutData.claim.rewardMode, 'xp_only');
    assert.strictEqual(soldOutData.claim.rewardUsd, 0);
    assert.strictEqual(soldOutData.claim.cashbackSoldOut, true);
    assert.ok(soldOutData.claim.reviewNote.includes('Cashback just ran out'));
    console.log('PASS 4c: Sold-out quest automatically flipped to XP-only with fallback message!');

    // 5. Prompt B & C: Verify /review & /approve & /reject removed (404), and /api/dev/test-zapier sends exact 14 keys
    const revRes = await fetch(`${baseUrl}/review/${paidPurchase.id}`);
    assert.strictEqual(revRes.status, 404, '/review/:id must be removed');
    const appRes = await fetch(`${baseUrl}/api/claims/${paidPurchase.id}/approve`, { method: 'POST' });
    assert.strictEqual(appRes.status, 404, '/approve endpoint must be removed');

    const zapRes = await fetch(`${baseUrl}/api/dev/test-zapier`, { method: 'POST' });
    const zapJson = await zapRes.json();
    const expectedKeys = [
      'event',
      'claim_id',
      'quest_title',
      'business_name',
      'business_email',
      'traveler_name',
      'bill_inr',
      'paid_usd',
      'reward_usd',
      'distance_m',
      'ai_confidence',
      'ai_reasons',
      'budget_remaining_usd',
      'submitted_at',
    ];
    assert.deepStrictEqual(Object.keys(zapJson.payload).sort(), expectedKeys.sort());
    for (const k of expectedKeys) {
      assert.strictEqual(typeof zapJson.payload[k], 'string', `Zapier key ${k} must be string`);
    }
    assert.strictEqual(zapJson.payload.traveler_name, 'Alex', 'First name only in Zapier payload');
    assert.strictEqual(zapJson.payload.event, 'claim_paid');
    assert.strictEqual('review_url' in zapJson.payload, false, 'No review_url in Zapier payload');
    console.log('PASS 5: Removed human approval routes (404) & verified exact 14-key Zapier payload');

    // 6. Live PayPal Sandbox OAuth + Order Create check (real API call!)
    const ppHealth = await fetch(`${baseUrl}/api/paypal/health`);
    const ppJson = await ppHealth.json();
    console.log('PAYPAL HEALTH:', ppJson);
    const liveOrderRes = await fetch(`${baseUrl}/api/checkin/order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'create',
        questId: matteo.id,
        questTitle: matteo.title,
        amountUsd: 5.0,
        simulate: false,
      }),
    });
    const liveOrder = await liveOrderRes.json();
    console.log('PAYPAL LIVE SANDBOX ORDER CREATE:', {
      status: liveOrderRes.status,
      orderId: liveOrder.orderId,
      simulated: liveOrder.simulated,
      hasApproveUrl: Boolean(liveOrder.approveUrl),
      debugId: liveOrder.debugId || null,
    });
    assert.ok(liveOrderRes.ok && liveOrder.orderId && !liveOrder.simulated && liveOrder.approveUrl, 'Live PayPal Sandbox order creation succeeded');

    console.log('\nALL PROMPTS A, B, C & PAYPAL LIVE ORDER CHECK PASSED!');
  } finally {
    server.close();
    if (CLAIMS_BAK !== null) {
      fs.writeFileSync(CLAIMS_PATH, CLAIMS_BAK, 'utf8');
    } else if (fs.existsSync(CLAIMS_PATH)) {
      fs.unlinkSync(CLAIMS_PATH);
    }
    if (ORDERS_BAK !== null) {
      fs.writeFileSync(ORDERS_PATH, ORDERS_BAK, 'utf8');
    } else if (fs.existsSync(ORDERS_PATH)) {
      fs.unlinkSync(ORDERS_PATH);
    }
  }
}

runTests().catch((err) => {
  console.error('TEST FAILED:', err);
  if (CLAIMS_BAK !== null) {
    fs.writeFileSync(CLAIMS_PATH, CLAIMS_BAK, 'utf8');
  }
  process.exit(1);
});
