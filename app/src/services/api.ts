import { Platform } from 'react-native';
import { getExpoAwareDeepLink } from '../utils/deepLink';
import {
  AdminBusinessClaim,
  CheckinOrderReceipt,
  ClaimRecord,
  OwnerStats,
  PayoutRecord,
  Place,
  Quest,
  QuestSubmission,
  ServerUser,
} from '../types/roamr';

let currentUserHeaders: { email?: string; name?: string } = {};

export function setApiUserHeaders(user: { email?: string | null; name?: string | null } | null) {
  currentUserHeaders = {
    email: user?.email?.trim() || undefined,
    name: user?.name?.trim() || undefined,
  };
}

export function getApiBaseUrl(): string {
  const configured = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (configured) {
    return configured.replace(/\/+$/, '');
  }
  if (Platform.OS === 'web') {
    return 'http://localhost:5000';
  }
  return '';
}

async function requestJson<T>(path: string, options: RequestInit = {}): Promise<T> {
  const baseUrl = getApiBaseUrl();
  if (!baseUrl) {
    throw new Error(
      'EXPO_PUBLIC_API_URL is not set. Add your computer LAN IP (e.g. http://192.168.1.100:5000) to app/.env so your phone can reach the server.'
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 14000);

  try {
    const res = await fetch(`${baseUrl}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(currentUserHeaders.email ? { 'x-user-email': currentUserHeaders.email } : {}),
        ...(currentUserHeaders.name ? { 'x-user-name': currentUserHeaders.name } : {}),
        ...(options.headers || {}),
      },
    });

    let data: Record<string, unknown> = {};
    try {
      data = (await res.json()) as Record<string, unknown>;
    } catch {
      data = {};
    }

    if (!res.ok) {
      const serverMsg =
        typeof data?.error === 'string'
          ? data.error
          : `Server error (${res.status})`;
      throw new Error(serverMsg);
    }
    return data as T;
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    if (
      raw.includes('unexpected end of stream') ||
      raw.includes('Network request failed') ||
      raw.includes('Failed to fetch') ||
      raw.includes('ECONNREFUSED')
    ) {
      throw new Error(
        `Cannot reach ROAMR backend at ${baseUrl}. Make sure the server is running on port 5000 (npm run server) and USB forwarding is active (adb reverse tcp:5000 tcp:5000).`
      );
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export async function checkServerHealth() {
  return requestJson<{
    ok: boolean;
    integrations: {
      aiProvider?: string;
      groqConfigured?: boolean;
      geminiConfigured: boolean;
      paypalConfigured: boolean;
    };
  }>('/api/health');
}

export async function checkPayPalHealth() {
  return requestJson<{
    ok: boolean;
    baseUrl: string;
    status: number;
    appId?: string;
    debugId?: string | null;
    error?: string;
  }>('/api/paypal/health');
}

export async function fetchPayPalLogs() {
  return requestJson<{
    logs: {
      id: string;
      timestamp: string;
      method: string;
      url: string;
      status: number;
      debugId?: string | null;
      simulated: boolean;
      summary: string;
    }[];
  }>('/api/paypal/logs');
}

export async function fetchPayPalTransactions() {
  return requestJson<{
    fundingOrders: {
      id: string;
      captureId: string;
      questId: string;
      questTitle: string;
      amountUsd: number;
      status: string;
      simulated: boolean;
      debugId?: string | null;
      createdAt: string;
    }[];
    payouts: {
      id: string;
      questId: string;
      questTitle: string;
      amountUsd: number;
      status: string;
      simulated: boolean;
      debugId?: string | null;
      receiverEmail: string;
      createdAt: string;
      message?: string;
    }[];
  }>('/api/paypal/transactions');
}

export async function fetchQuestsFromServer(options?: { funded?: boolean }) {
  const qs = options?.funded ? '?funded=true' : '';
  return requestJson<{ quests: Quest[] }>(`/api/quests${qs}`);
}

export async function fetchPlacesFromServer(options?: { funded?: boolean }) {
  const qs = options?.funded ? '?funded=true' : '';
  return requestJson<{ places: Place[] }>(`/api/places${qs}`);
}

export async function fetchPlaceDetailFromServer(placeId: string) {
  return requestJson<{ place: Place; quests: Quest[] }>(
    `/api/places/${encodeURIComponent(placeId)}`
  );
}

export async function fetchServerMe() {
  return requestJson<{ user: ServerUser }>('/api/me');
}

export async function saveMyPaypalEmailOnServer(paypalEmail: string) {
  return requestJson<{ user: ServerUser }>('/api/me/paypal', {
    method: 'PATCH',
    body: JSON.stringify({ paypal_email: paypalEmail }),
  });
}

export async function syncBusinessIdentityOnServer(payload: {
  business_name: string;
  paypal_email: string;
  place?: {
    place_id?: string;
    name?: string;
    address?: string;
    lat?: number;
    lng?: number;
    category?: string;
    city?: string;
  };
  claim_note?: string;
}) {
  return requestJson<{ user: ServerUser }>('/api/me/business', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function fetchAdminClaimsFromServer(status: 'pending' | 'all' = 'all') {
  return requestJson<{ claims: AdminBusinessClaim[] }>(
    `/api/admin/claims?status=${encodeURIComponent(status)}`
  );
}

export async function approveBusinessClaimOnServer(placeId: string, note?: string) {
  return requestJson<{ place: Place }>(
    `/api/admin/claims/${encodeURIComponent(placeId)}/approve`,
    {
      method: 'POST',
      body: JSON.stringify({ note }),
    }
  );
}

export async function rejectBusinessClaimOnServer(placeId: string, note?: string) {
  return requestJson<{ place: Place }>(
    `/api/admin/claims/${encodeURIComponent(placeId)}/reject`,
    {
      method: 'POST',
      body: JSON.stringify({ note }),
    }
  );
}

export async function escalateClaimToSuperhost(claimId: string, note?: string) {
  return requestJson<{ claim: ClaimRecord }>(
    `/api/claims/${encodeURIComponent(claimId)}/escalate`,
    {
      method: 'POST',
      body: JSON.stringify({ note }),
    }
  );
}

export async function fetchSuperhostEscalatedClaims() {
  return requestJson<{ claims: ClaimRecord[] }>('/api/admin/escalated-claims');
}

export async function releaseSuperhostCashback(claimId: string) {
  return requestJson<{ claim: ClaimRecord }>(
    `/api/admin/claims/${encodeURIComponent(claimId)}/release-cashback`,
    {
      method: 'POST',
      body: JSON.stringify({}),
    }
  );
}

export async function fetchOwnerQuestsFromServer() {
  return requestJson<{ quests: Quest[] }>('/api/owner/quests');
}

export async function fetchOwnerStatsFromServer() {
  return requestJson<OwnerStats>('/api/owner/stats');
}

export async function createQuestOnServer(payload: {
  place_id?: string;
  title: string;
  businessName: string;
  place_name?: string;
  category: string;
  quest_type?: 'purchase' | 'visit';
  objective: string;
  public_objective?: string;
  public_description?: string;
  description?: string;
  photo_url?: string | null;
  city?: string;
  address?: string;
  lat?: number;
  lng?: number;
  coordinates?: { latitude: number; longitude: number };
  radius_m?: number;
  night_only?: boolean;
  difficulty?: string;
  est_minutes?: number;
  xp?: number;
  text_answer_prompt?: string | null;
  reward?: {
    min_bill_inr?: number;
    cashback_percent?: number;
    max_reward_usd?: number;
    fixed_reward_usd?: number;
    xp_only?: boolean;
  };
  rewardUsd: number;
  budgetUsd: number;
  budget_usd?: number;
  budget_remaining_usd?: number;
  funded?: boolean;
  reward_mode?: 'cashback' | 'xp_only';
  merchantEmail?: string;
  ai_private?: {
    must_show: string[];
    reject_if: string[];
    bill_checks: string[];
    notes?: string;
  };
  aiInstructions?: string;
  aiReferenceImages?: string[];
  maxParticipants?: number;
  minCheckinUsd?: number;
  durationHours?: number;
  expiresAt?: string;
}) {
  return requestJson<{ quest: Quest; hasAiBrief?: boolean }>('/api/quests', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function draftAiBriefOnServer(payload: {
  title?: string;
  place_name?: string;
  category?: string;
  quest_type?: 'purchase' | 'visit';
  public_description?: string;
  public_objective?: string;
  min_bill_inr?: number;
  text_answer_prompt?: string;
}) {
  return requestJson<{
    must_show: string[];
    reject_if: string[];
    bill_checks: string[];
    notes?: string;
    mode?: string;
  }>('/api/quests/draft-brief', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function readBillOnServer(payload: {
  imageBase64?: string;
  mimeType?: string;
  demoMode?: boolean;
}) {
  return requestJson<{
    bill_total_inr: number | null;
    merchant_name?: string | null;
    detected_date?: string | null;
    confidence?: number;
    mode?: string;
  }>('/api/bill/read', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function fetchBusinessQuestForEdit(questId: string) {
  return requestJson<{
    quest: Quest & {
      ai_private?: {
        must_show?: string[];
        reject_if?: string[];
        bill_checks?: string[];
        notes?: string;
      };
    };
  }>(`/api/business/quests/${encodeURIComponent(questId)}`, {
    headers: { 'x-roamr-role': 'business' },
  });
}

export async function updateQuestOnServer(
  questId: string,
  payload: Parameters<typeof createQuestOnServer>[0]
) {
  return requestJson<{ quest: Quest; hasAiBrief?: boolean }>(
    `/api/quests/${encodeURIComponent(questId)}`,
    {
      method: 'PUT',
      body: JSON.stringify(payload),
    }
  );
}

export async function deleteQuestOnServer(questId: string) {
  return requestJson<{ deleted: boolean; id: string }>(
    `/api/quests/${encodeURIComponent(questId)}`,
    { method: 'DELETE' }
  );
}

export async function fetchSubmissionsFromServer(questId?: string) {
  const qs = questId ? `?questId=${encodeURIComponent(questId)}` : '';
  return requestJson<{ submissions: QuestSubmission[] }>(`/api/submissions${qs}`);
}

export async function submitQuestForReviewOnServer(submission: QuestSubmission) {
  return requestJson<{ submission: QuestSubmission }>('/api/submissions', {
    method: 'POST',
    body: JSON.stringify(submission),
  });
}

export async function reviewSubmissionOnServer(
  submissionId: string,
  decision: 'approve' | 'reject',
  submission?: QuestSubmission,
  reviewNote?: string
) {
  return requestJson<{ submission: QuestSubmission; payout: PayoutRecord | null }>(
    `/api/submissions/${encodeURIComponent(submissionId)}/review`,
    {
      method: 'POST',
      body: JSON.stringify({ decision, submission, reviewNote }),
    }
  );
}

export async function verifyProofWithApi(payload: {
  imageBase64?: string;
  mimeType?: string;
  quest: Quest;
  demoMode: boolean;
}) {
  return requestJson<{
    verified: boolean;
    confidence: number;
    reason: string;
    mode: string;
  }>('/api/verify', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function createPayPalFundingOrder(payload: {
  questId: string;
  questTitle: string;
  amountUsd: number;
  simulate?: boolean;
}) {
  const appReturnUrl = getExpoAwareDeepLink('paypal-return');
  return requestJson<{
    orderId: string;
    status: string;
    approveUrl: string | null;
    amountUsd: number;
    simulated: boolean;
    debugId?: string | null;
    message: string;
    appReturnUrl?: string;
  }>('/api/quests/fund', {
    method: 'POST',
    body: JSON.stringify({ action: 'create', appReturnUrl, ...payload }),
  });
}

export async function capturePayPalFundingOrder(payload: {
  questId: string;
  orderId: string;
  amountUsd: number;
}) {
  return requestJson<{
    orderId: string;
    captureId: string;
    status: string;
    amountUsd: number;
    simulated: boolean;
    debugId?: string | null;
    message: string;
    quest: Quest | null;
  }>('/api/quests/fund', {
    method: 'POST',
    body: JSON.stringify({ action: 'capture', ...payload }),
  });
}

export async function triggerPayPalPayout(payload: {
  questId: string;
  questTitle: string;
  amountUsd: number;
  receiverEmail: string;
  verified: boolean;
}) {
  return requestJson<{
    payout: {
      id: string;
      questId: string;
      questTitle: string;
      amountUsd: number;
      status: string;
      simulated: boolean;
      debugId?: string | null;
      receiverEmail: string;
      createdAt: string;
      message?: string;
    };
  }>('/api/payouts', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function fetchPayoutStatus(batchId: string) {
  return requestJson<{
    payoutBatchId: string;
    payoutStatus: string;
    simulated: boolean;
  }>(`/api/payouts/${encodeURIComponent(batchId)}`);
}

export async function fetchBusinessInsight(payload: {
  verifiedVisits: number;
  moneySpent: number;
  costPerVisit: number;
  quests: Quest[];
}) {
  return requestJson<{ insight: string; mode: string }>('/api/business/insight', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function generateQuestsWithApi(payload: {
  interests: string[];
  city: string;
  businesses: Quest[];
}) {
  return requestJson<{ quests: Quest[]; mode: string }>('/api/quests/generate', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// ============================================================================
// End-to-End Check-In Order + GPS + Reverse Geocode + Claims Pipeline API
// ============================================================================

export async function createPayPalCheckinOrder(payload: {
  questId: string;
  questTitle: string;
  merchantEmail?: string;
  amountUsd: number;
  billInr?: number;
  payerOverride?: { name?: string; email?: string };
  simulate?: boolean;
}) {
  const appReturnUrl = getExpoAwareDeepLink('paypal-return');
  return requestJson<{
    orderId: string;
    status: string;
    approveUrl: string | null;
    amountUsd: number;
    payeeEmail: string;
    simulated: boolean;
    debugId?: string | null;
    message: string;
  }>('/api/checkin/order', {
    method: 'POST',
    body: JSON.stringify({ action: 'create', appReturnUrl, ...payload }),
  });
}

export async function capturePayPalCheckinOrder(payload: {
  questId: string;
  orderId: string;
  merchantEmail?: string;
  amountUsd: number;
  billInr?: number;
  payerOverride?: { name?: string; email?: string; payerId?: string };
}) {
  return requestJson<CheckinOrderReceipt & { message: string }>('/api/checkin/order', {
    method: 'POST',
    body: JSON.stringify({ action: 'capture', ...payload }),
  });
}

export async function fetchOwnerAuditsFromServer() {
  return requestJson<{ audits: ClaimRecord[]; claims: ClaimRecord[] }>('/api/owner/audits');
}

export async function fetchDevPayPalOrder(orderId: string) {
  return requestJson<{
    orderId: string;
    status: string;
    captures: Array<{ id: string; status: string; amount?: { currency_code: string; value: string } }>;
    payeeEmail: string;
    amountUsd: number;
    customId?: string;
    simulated?: boolean;
  }>(`/api/dev/paypal/order/${encodeURIComponent(orderId)}`);
}

export async function fetchCheckinOrdersFromServer(params?: {
  questId?: string;
  includeDemo?: boolean;
}) {
  const query = new URLSearchParams();
  if (params?.questId) query.set('questId', params.questId);
  if (params?.includeDemo) query.set('includeDemo', '1');
  const qs = query.toString() ? `?${query.toString()}` : '';
  return requestJson<{ orders: CheckinOrderReceipt[] }>(`/api/checkin/orders${qs}`);
}

export async function fetchClaimsFromServer(params?: {
  questId?: string;
  status?: string;
  travelerEmail?: string;
  includeDemo?: boolean;
}) {
  const query = new URLSearchParams();
  if (params?.questId) query.set('questId', params.questId);
  if (params?.status) query.set('status', params.status);
  if (params?.travelerEmail) query.set('travelerEmail', params.travelerEmail);
  if (params?.includeDemo) query.set('includeDemo', '1');
  const qs = query.toString() ? `?${query.toString()}` : '';
  return requestJson<{ claims: ClaimRecord[] }>(`/api/claims${qs}`);
}

export async function fetchClaimByIdFromServer(claimId: string) {
  return requestJson<{ claim: ClaimRecord }>(`/api/claims/${encodeURIComponent(claimId)}`);
}

export async function submitClaimToServer(payload: {
  questId: string;
  quest: Quest;
  orderId?: string;
  orderSummary?: CheckinOrderReceipt | null;
  photoBase64?: string;
  mimeType?: string;
  photoUri?: string;
  billPhotoBase64?: string;
  billMimeType?: string;
  billInr?: number;
  textAnswer?: string;
  gps: { latitude: number | null; longitude: number | null; mocked?: boolean };
  resolvedAddress: string;
  distanceMeters: number | null;
  traveler: {
    name: string;
    email: string;
    avatar?: string;
    paypalEmail: string;
  };
  demoMode: boolean;
}) {
  return requestJson<{ claim: ClaimRecord; quest?: Quest }>('/api/claims', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function reverseGeocodeWithMapbox(
  latitude: number,
  longitude: number
): Promise<string> {
  const token = (process.env.EXPO_PUBLIC_MAPBOX_TOKEN || '').trim();
  if (!token || !token.startsWith('pk.')) {
    return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
  }
  try {
    const url = `https://api.mapbox.com/search/geocode/v6/reverse?longitude=${encodeURIComponent(
      longitude
    )}&latitude=${encodeURIComponent(latitude)}&limit=1&access_token=${encodeURIComponent(token)}`;
    const res = await fetch(url);
    if (!res.ok) {
      return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
    }
    const data = (await res.json()) as {
      features?: {
        properties?: {
          full_address?: string;
          place_formatted?: string;
          name?: string;
        };
      }[];
    };
    const props = data?.features?.[0]?.properties;
    return (
      props?.full_address ||
      [props?.name, props?.place_formatted].filter(Boolean).join(', ') ||
      `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`
    );
  } catch {
    return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
  }
}

export interface MapboxPlaceResult {
  id: string;
  name: string;
  fullAddress: string;
  city: string;
  latitude: number;
  longitude: number;
}

export async function searchPlacesWithMapbox(
  query: string,
  proximity?: { latitude: number; longitude: number }
): Promise<MapboxPlaceResult[]> {
  const q = query.trim();
  const token = (process.env.EXPO_PUBLIC_MAPBOX_TOKEN || '').trim();
  if (!q || !token || !token.startsWith('pk.')) {
    return [];
  }
  const proxLng = proximity?.longitude ?? 77.5946;
  const proxLat = proximity?.latitude ?? 12.9716;
  try {
    const searchBoxUrl = `https://api.mapbox.com/search/searchbox/v1/forward?q=${encodeURIComponent(
      q
    )}&proximity=${proxLng},${proxLat}&limit=6&access_token=${encodeURIComponent(token)}`;
    const sbRes = await fetch(searchBoxUrl);
    if (sbRes.ok) {
      const sbData = (await sbRes.json()) as {
        features?: {
          id?: string;
          geometry?: { coordinates?: [number, number] };
          properties?: {
            mapbox_id?: string;
            name?: string;
            full_address?: string;
            place_formatted?: string;
            context?: {
              place?: { name?: string };
              locality?: { name?: string };
              region?: { name?: string };
              country?: { name?: string };
            };
          };
        }[];
      };
      const mapped = (sbData.features || [])
        .filter((f) => Array.isArray(f.geometry?.coordinates) && f.geometry!.coordinates!.length >= 2)
        .map((f, idx) => {
          const [lng, lat] = f.geometry!.coordinates!;
          const props = f.properties || {};
          const cityName =
            props.context?.place?.name ||
            props.context?.locality?.name ||
            props.context?.region?.name ||
            props.name ||
            'Bengaluru';
          return {
            id: props.mapbox_id || f.id || `sb-${idx}-${lat}`,
            name: props.name || q,
            fullAddress:
              props.full_address ||
              [props.name, props.place_formatted].filter(Boolean).join(', ') ||
              q,
            city: cityName,
            latitude: lat,
            longitude: lng,
          };
        });
      if (mapped.length > 0) return mapped;
    }

    const url = `https://api.mapbox.com/search/geocode/v6/forward?q=${encodeURIComponent(
      q
    )}&proximity=${proxLng},${proxLat}&autocomplete=true&limit=5&access_token=${encodeURIComponent(token)}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = (await res.json()) as {
      features?: {
        id?: string;
        geometry?: { coordinates?: [number, number] };
        properties?: {
          name?: string;
          full_address?: string;
          place_formatted?: string;
          context?: {
            place?: { name?: string };
            locality?: { name?: string };
            region?: { name?: string };
            country?: { name?: string };
          };
        };
      }[];
    };
    return (data.features || [])
      .filter((f) => Array.isArray(f.geometry?.coordinates) && f.geometry!.coordinates!.length >= 2)
      .map((f, idx) => {
        const [lng, lat] = f.geometry!.coordinates!;
        const props = f.properties || {};
        const cityName =
          props.context?.place?.name ||
          props.context?.locality?.name ||
          props.context?.region?.name ||
          props.name ||
          'Global';
        return {
          id: f.id || `place-${idx}-${lat}`,
          name: props.name || cityName,
          fullAddress:
            props.full_address ||
            [props.name, props.place_formatted].filter(Boolean).join(', ') ||
            `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
          city: cityName,
          latitude: lat,
          longitude: lng,
        };
      });
  } catch {
    return [];
  }
}

export async function testZapierWebhookOnServer(businessEmail?: string) {
  return requestJson<{
    ok: boolean;
    skipped?: boolean;
    status: number | null;
    response: string;
    claimId: string;
  }>('/api/dev/test-zapier', {
    method: 'POST',
    body: JSON.stringify(businessEmail ? { business_email: businessEmail } : {}),
  });
}
