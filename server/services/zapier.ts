type ZapierEventType = 'claim_paid' | 'claim_rejected' | 'budget_low';

type ZapierClaimInput = {
  id: string;
  questTitle?: string;
  businessName?: string;
  businessEmail?: string;
  hostEmail?: string;
  superhostEmail?: string;
  travelerName?: string;
  billInr?: number;
  paidUsd?: number;
  rewardUsd?: number;
  distanceMeters?: number | null;
  budgetRemainingUsd?: number;
  submittedAt?: string;
  photoUri?: string | null;
  billPhotoUri?: string | null;
  order?: {
    orderId?: string;
    captureId?: string;
    amountUsd?: number;
    payeeEmail?: string;
  } | null;
  aiVerdict?: {
    confidence?: number;
    reasons?: string[] | string;
  } | null;
};

type ZapierPayload = {
  event: ZapierEventType;
  claim_id: string;
  quest_title: string;
  business_name: string;
  business_email: string;
  to_email: string;
  cc_email: string;
  traveler_name: string;
  bill_inr: string;
  paid_usd: string;
  reward_usd: string;
  distance_m: string;
  ai_confidence: string;
  ai_reasons: string;
  budget_remaining_usd: string;
  submitted_at: string;
  photo_url: string;
  bill_photo_url: string;
  paypal_order_id: string;
  paypal_capture_id: string;
  paypal_ref: string;
  email_subject: string;
  email_html: string;
};

type ZapierNotifyOptions = {
  event?: ZapierEventType;
  budgetRemainingUsd?: number;
};

type ZapierNotifyResult = {
  ok: boolean;
  status?: number;
  skipped?: boolean;
  responseBody?: string;
  payload?: ZapierPayload;
  error?: string;
};

function getFirstName(fullName?: string): string {
  const cleaned = String(fullName || 'Explorer').trim();
  if (!cleaned) return 'Explorer';
  return cleaned.split(/\s+/)[0] || 'Explorer';
}

function buildZapierPayload(
  claim: ZapierClaimInput,
  options: ZapierNotifyOptions = {}
): ZapierPayload {
  const event: ZapierEventType = options.event || 'claim_paid';
  const confidenceNum = Number(claim.aiVerdict?.confidence ?? 0);
  const clampedConfidence = Number.isFinite(confidenceNum)
    ? Math.max(0, Math.min(1, confidenceNum))
    : 0;
  const reasonsRaw = claim.aiVerdict?.reasons;
  const reasonsJoined = Array.isArray(reasonsRaw)
    ? reasonsRaw.map((r) => String(r).trim()).filter(Boolean).join(' ')
    : String(reasonsRaw || '').trim();

  const distanceVal =
    typeof claim.distanceMeters === 'number' && Number.isFinite(claim.distanceMeters)
      ? Math.round(claim.distanceMeters)
      : 0;

  const billInrVal = Number(claim.billInr ?? 0);
  const paidUsdVal = Number(claim.paidUsd ?? claim.order?.amountUsd ?? 0);
  const rewardUsdVal = Number(claim.rewardUsd ?? 0);
  const remainingUsdVal = Number(
    options.budgetRemainingUsd ?? claim.budgetRemainingUsd ?? 0
  );

  const superhostEmail = String(
    claim.superhostEmail || process.env.ADMIN_EMAIL || 'tsrinath2020@gmail.com'
  ).trim();
  const rawHost = String(claim.hostEmail || claim.businessEmail || superhostEmail).trim();
  const toEmail =
    rawHost && rawHost.includes('@') && !rawHost.endsWith('@example.com')
      ? rawHost
      : superhostEmail;
  const ccEmail = superhostEmail;

  const toHttpUrl = (uri?: string | null) => {
    const clean = String(uri || '').trim();
    return /^https?:\/\//i.test(clean) ? clean : '';
  };
  const photoUrl = toHttpUrl(claim.photoUri);
  const billPhotoUrl = toHttpUrl(claim.billPhotoUri);
  const questTitle = String(claim.questTitle || '');
  const businessName = String(claim.businessName || '');
  const travelerFirst = getFirstName(claim.travelerName);
  const paidStr = Number.isFinite(paidUsdVal) ? paidUsdVal.toFixed(2) : '0.00';
  const rewardStr = Number.isFinite(rewardUsdVal) ? rewardUsdVal.toFixed(2) : '0.00';
  const billInrStr = Number.isFinite(billInrVal) ? String(Math.round(billInrVal)) : '0';
  const remainingStr = Number.isFinite(remainingUsdVal)
    ? Math.max(0, remainingUsdVal).toFixed(2)
    : '0.00';
  const aiReasonsText =
    reasonsJoined ||
    (event === 'claim_paid'
      ? 'Verified live visit and cashback paid.'
      : event === 'budget_low'
      ? 'Quest budget fell below 20%.'
      : 'Claim rejected by automated verification.');

  const paypalOrderId = String(claim.order?.orderId || '').trim();
  const paypalCaptureId = String(claim.order?.captureId || '').trim();
  const paypalRef = paypalCaptureId || paypalOrderId || String(claim.id || '');
  const eventTitle =
    event === 'claim_paid'
      ? 'Verified Visit & Cashback Paid'
      : event === 'budget_low'
      ? 'Quest Budget Low Alert'
      : 'Claim Rejected';
  const emailSubject = `[ROAMR] ${eventTitle}: ${questTitle || businessName} (${travelerFirst})`;
  const emailHtml = [
    `<div style="font-family:Arial,sans-serif;max-width:600px;color:#111827;">`,
    `<h2 style="color:#003087;">${eventTitle}</h2>`,
    `<p><strong>Business:</strong> ${businessName}<br/>`,
    `<strong>Quest:</strong> ${questTitle}<br/>`,
    `<strong>Traveler:</strong> ${travelerFirst}<br/>`,
    `<strong>Bill:</strong> INR ${billInrStr} ($${paidStr} USD)<br/>`,
    `<strong>Cashback Reward:</strong> $${rewardStr} USD<br/>`,
    `<strong>Remaining Budget:</strong> $${remainingStr} USD<br/>`,
    `<strong>PayPal Ref:</strong> ${paypalRef}<br/>`,
    `<strong>AI Confidence:</strong> ${clampedConfidence.toFixed(2)}</p>`,
    `<p><strong>AI Notes:</strong> ${aiReasonsText}</p>`,
    photoUrl
      ? `<p><strong>Live Photo Proof:</strong><br/><img src="${photoUrl}" alt="Photo Proof" style="max-width:100%;border-radius:10px;margin-top:6px;"/></p>`
      : '',
    billPhotoUrl
      ? `<p><strong>Bill / Receipt Photo:</strong><br/><img src="${billPhotoUrl}" alt="Bill Photo" style="max-width:100%;border-radius:10px;margin-top:6px;"/></p>`
      : '',
    `<p style="font-size:12px;color:#6B7280;">Claim ID: ${String(claim.id || '')}</p>`,
    `</div>`,
  ].join('');

  return {
    event,
    claim_id: String(claim.id || ''),
    quest_title: questTitle,
    business_name: businessName,
    business_email: toEmail,
    to_email: toEmail,
    cc_email: ccEmail,
    traveler_name: travelerFirst,
    bill_inr: billInrStr,
    paid_usd: paidStr,
    reward_usd: rewardStr,
    distance_m: String(distanceVal),
    ai_confidence: clampedConfidence.toFixed(2),
    ai_reasons: aiReasonsText,
    budget_remaining_usd: remainingStr,
    submitted_at: String(claim.submittedAt || new Date().toISOString()),
    photo_url: photoUrl,
    bill_photo_url: billPhotoUrl,
    paypal_order_id: paypalOrderId,
    paypal_capture_id: paypalCaptureId,
    paypal_ref: paypalRef,
    email_subject: emailSubject,
    email_html: emailHtml,
  };
}

async function notifyBusiness(
  claim: ZapierClaimInput,
  options: ZapierNotifyOptions = {}
): Promise<ZapierNotifyResult> {
  const payload = buildZapierPayload(claim, options);
  const webhookUrl = (process.env.ZAPIER_WEBHOOK_URL || '').trim();
  if (!webhookUrl) {
    console.log('Zapier webhook not configured');
    return { ok: false, skipped: true, payload };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const responseBody = await res.text().catch(() => '');
    console.log(`[Zapier] event=${payload.event} claim_id=${payload.claim_id} status=${res.status}`);

    return {
      ok: res.ok,
      status: res.status,
      responseBody: responseBody.slice(0, 500),
      payload,
    };
  } catch (err: any) {
    console.warn('[Zapier] webhook error:', err?.message || err);
    return {
      ok: false,
      error: err?.message || 'Zapier webhook request failed.',
      payload,
    };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  buildZapierPayload,
  notifyBusiness,
};
