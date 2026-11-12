import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, SupabaseClient, Session } from '@supabase/supabase-js';
import * as WebBrowser from 'expo-web-browser';
import { getExpoAwareDeepLink } from '../utils/deepLink';
import { RemoteExplorerRow } from '../data/leaderboard';
import {
  EarnedStamp,
  InterestKey,
  PayoutRecord,
  Quest,
  QuestSubmission,
  UserProfile,
} from '../types/roamr';
import { centsToUsd, usdToCents } from '../../lib/currency';

WebBrowser.maybeCompleteAuthSession();

const SUPABASE_URL = (process.env.EXPO_PUBLIC_SUPABASE_URL || '').trim();
const SUPABASE_ANON_KEY = (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '').trim();

export function isSupabaseConfigured(): boolean {
  return Boolean(
    SUPABASE_URL &&
      SUPABASE_ANON_KEY &&
      SUPABASE_URL.startsWith('http') &&
      !SUPABASE_URL.includes('your-project')
  );
}

let client: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient | null {
  if (!isSupabaseConfigured()) return null;
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        storage: AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: Platform.OS === 'web',
      },
    });
  }
  return client;
}

function parseParamsFromUrl(url: string): Record<string, string> {
  const result: Record<string, string> = {};
  const parts = url.split(/[?#]/).slice(1);
  for (const part of parts) {
    for (const pair of part.split('&')) {
      if (!pair) continue;
      const [k, v] = pair.split('=');
      if (k) {
        result[decodeURIComponent(k)] = decodeURIComponent(v || '');
      }
    }
  }
  return result;
}

export async function warmUpGoogleAuthBrowser(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await WebBrowser.warmUpAsync();
    if (SUPABASE_URL) {
      await WebBrowser.mayInitWithUrlAsync(`${SUPABASE_URL}/auth/v1/authorize?provider=google`);
    }
  } catch {
    // Warm-up is best-effort
  }
}

export async function coolDownGoogleAuthBrowser(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await WebBrowser.coolDownAsync();
  } catch {
    // Best-effort cleanup
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out.`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function ensureSupabaseProfile(session: Session): Promise<UserProfile> {
  const supabase = getSupabaseClient();
  const user = session.user;
  const meta = user.user_metadata || {};
  const fallbackProfile: UserProfile = {
    id: user.id,
    name: String(meta.full_name || meta.name || user.email?.split('@')[0] || 'ROAMR Explorer'),
    email: user.email || '',
    avatar: meta.avatar_url || meta.picture || undefined,
    isDemo: false,
    isTraveler: true,
    isBusiness: false,
  };

  if (supabase) {
    // Sync remote profiles table in the background so sign-in navigates instantly
    void (async () => {
      try {
        await supabase.from('profiles').upsert({
          id: user.id,
          email: fallbackProfile.email || null,
          name: fallbackProfile.name,
          avatar: fallbackProfile.avatar || null,
          is_traveler: true,
        });
      } catch {
        // Profiles table may not be created yet; session metadata suffices
      }
    })();
  }

  return fallbackProfile;
}

export async function fetchRemoteUserStats(userId: string): Promise<{
  totalXp?: number;
  walletBalanceCents?: number;
  city?: string;
  paypalEmail?: string;
  phone?: string;
  gender?: string;
  travelStyle?: string;
  onboardingDone?: boolean;
  interests?: InterestKey[];
  isBusiness?: boolean;
  businessName?: string;
  businessCategory?: string;
  businessAddress?: string;
  businessLogo?: string;
} | null> {
  const supabase = getSupabaseClient();
  if (!supabase || !userId || userId === 'demo-user-roamr') return null;
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select(
        'total_xp, wallet_balance_cents, city, paypal_email, phone_number, gender, travel_style, onboarding_done, interests, is_business, business_name, business_category, business_address, business_logo'
      )
      .eq('id', userId)
      .maybeSingle();
    if (error || !data) return null;
    return {
      totalXp: typeof data.total_xp === 'number' ? data.total_xp : undefined,
      walletBalanceCents:
        typeof data.wallet_balance_cents === 'number' ? data.wallet_balance_cents : undefined,
      city: typeof data.city === 'string' && data.city ? data.city : undefined,
      paypalEmail:
        typeof data.paypal_email === 'string' && data.paypal_email ? data.paypal_email : undefined,
      phone:
        typeof data.phone_number === 'string' && data.phone_number ? data.phone_number : undefined,
      gender: typeof data.gender === 'string' && data.gender ? data.gender : undefined,
      travelStyle:
        typeof data.travel_style === 'string' && data.travel_style ? data.travel_style : undefined,
      onboardingDone:
        typeof data.onboarding_done === 'boolean' ? data.onboarding_done : undefined,
      interests: Array.isArray(data.interests) ? (data.interests as InterestKey[]) : undefined,
      isBusiness: Boolean(data.is_business),
      businessName: data.business_name || undefined,
      businessCategory: data.business_category || undefined,
      businessAddress: data.business_address || undefined,
      businessLogo: data.business_logo || undefined,
    };
  } catch {
    return null;
  }
}

export async function syncProfileStatsToSupabase(
  userId: string,
  stats: {
    name?: string;
    email?: string;
    avatar?: string;
    totalXp?: number;
    stampsCount?: number;
    walletBalanceCents?: number;
    city?: string;
    paypalEmail?: string;
    phone?: string;
    gender?: string;
    travelStyle?: string;
    onboardingDone?: boolean;
    interests?: InterestKey[];
  }
): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase || !userId || userId === 'demo-user-roamr') return;
  try {
    const patch: Record<string, unknown> = { id: userId };
    if (stats.name !== undefined) patch.name = stats.name;
    if (stats.email !== undefined) patch.email = stats.email;
    if (stats.avatar !== undefined) patch.avatar = stats.avatar;
    if (stats.totalXp !== undefined) patch.total_xp = Math.max(0, Math.round(stats.totalXp));
    if (stats.stampsCount !== undefined) patch.stamps_count = Math.max(0, Math.round(stats.stampsCount));
    if (stats.walletBalanceCents !== undefined)
      patch.wallet_balance_cents = Math.max(0, Math.round(stats.walletBalanceCents));
    if (stats.city !== undefined) patch.city = stats.city;
    if (stats.paypalEmail !== undefined) patch.paypal_email = stats.paypalEmail;
    if (stats.phone !== undefined) patch.phone_number = stats.phone;
    if (stats.gender !== undefined) patch.gender = stats.gender;
    if (stats.travelStyle !== undefined) patch.travel_style = stats.travelStyle;
    if (stats.onboardingDone !== undefined) patch.onboarding_done = stats.onboardingDone;
    if (stats.interests !== undefined) patch.interests = stats.interests;
    await supabase.from('profiles').upsert(patch);
  } catch {
    // Best-effort sync
  }
}

export async function fetchRealLeaderboardFromSupabase(): Promise<RemoteExplorerRow[]> {
  const supabase = getSupabaseClient();
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, name, avatar, city, total_xp, stamps_count')
      .order('total_xp', { ascending: false })
      .order('stamps_count', { ascending: false })
      .limit(50);
    if (error || !data) return [];
    return data.map((row) => ({
      id: String(row.id),
      name: String(row.name || 'ROAMR Explorer'),
      avatar: row.avatar || undefined,
      city: String(row.city || 'Local'),
      xp: Number(row.total_xp || 0),
      stampsCount: Number(row.stamps_count || 0),
    }));
  } catch {
    return [];
  }
}

export async function fetchQuestsFromSupabase(): Promise<Quest[]> {
  const supabase = getSupabaseClient();
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from('quests')
      .select('*')
      .order('created_at', { ascending: false });
    if (error || !data) return [];
    return data.map((r) => {
      const rewardCents = Number(r.reward_cents ?? 50);
      const budgetCents = Number(r.budget_cents ?? 500);
      const spentCents = Number(r.spent_cents ?? 0);
      return {
        id: String(r.id),
        title: String(r.title),
        businessName: String(r.business_name),
        category: String(r.category || 'Cafe'),
        distance: String(r.distance || '0.5 km'),
        xp: Number(r.xp || 50),
        rewardCents,
        rewardUsd: centsToUsd(rewardCents),
        difficulty: String(r.difficulty || 'Easy'),
        estTime: String(r.est_time || '~ 15 min'),
        fundedBy: String(r.funded_by || r.business_name),
        description: String(r.description || ''),
        objective: String(r.objective || ''),
        proofType: (r.proof_type || 'photo_or_receipt') as Quest['proofType'],
        image:
          r.image ||
          'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=1000&q=80',
        coordinates: {
          latitude: Number(r.latitude || 37.7885),
          longitude: Number(r.longitude || -122.4315),
        },
        mapPosition: { xPercent: 50, yPercent: 50 },
        city: r.city || undefined,
        budgetCents,
        budgetUsd: centsToUsd(budgetCents),
        spentCents,
        spentUsd: centsToUsd(spentCents),
        verifiedVisits: Number(r.verified_visits || 0),
        funded: Boolean(r.funded),
        paypalOrderId: r.paypal_order_id || undefined,
        paypalCaptureId: r.paypal_capture_id || undefined,
        durationHours: r.duration_hours || undefined,
        expiresAt: r.expires_at || undefined,
      };
    });
  } catch {
    return [];
  }
}

export async function upsertQuestToSupabase(quest: Quest, ownerId?: string): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) return;
  try {
    await supabase.from('quests').upsert({
      id: quest.id,
      ...(ownerId && ownerId !== 'demo-user-roamr' ? { owner_id: ownerId } : {}),
      title: quest.title,
      business_name: quest.businessName,
      category: quest.category,
      distance: quest.distance,
      xp: quest.xp,
      reward_cents: quest.rewardCents ?? usdToCents(quest.rewardUsd),
      difficulty: quest.difficulty,
      est_time: quest.estTime,
      funded_by: quest.fundedBy,
      description: quest.description,
      objective: quest.objective,
      proof_type: quest.proofType,
      image: quest.image,
      latitude: quest.coordinates.latitude,
      longitude: quest.coordinates.longitude,
      city: quest.city || 'San Francisco',
      budget_cents: quest.budgetCents ?? usdToCents(quest.budgetUsd ?? 50),
      spent_cents: quest.spentCents ?? usdToCents(quest.spentUsd ?? 0),
      verified_visits: quest.verifiedVisits || 0,
      funded: Boolean(quest.funded),
      paypal_order_id: quest.paypalOrderId || null,
      paypal_capture_id: quest.paypalCaptureId || null,
      duration_hours: quest.durationHours || null,
      expires_at: quest.expiresAt || null,
    });
  } catch {
    // Best-effort sync
  }
}

export async function deleteQuestFromSupabase(questId: string): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) return;
  try {
    await supabase.from('quests').delete().eq('id', questId);
  } catch {
    // Best-effort sync
  }
}

export async function fetchSubmissionsFromSupabase(): Promise<QuestSubmission[]> {
  const supabase = getSupabaseClient();
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from('quest_submissions')
      .select('*')
      .order('submitted_at', { ascending: false });
    if (error || !data) return [];
    return data.map((r) => {
      const rewardCents = Number(r.reward_cents ?? 50);
      return {
        id: String(r.id),
        questId: String(r.quest_id),
        questTitle: String(r.quest_title),
        businessName: String(r.business_name),
        travelerName: String(r.traveler_name),
        travelerEmail: String(r.traveler_email || ''),
        travelerAvatar: r.traveler_avatar || undefined,
        paypalEmail: String(r.paypal_email),
        photoUri: r.photo_uri || undefined,
        submittedAt: String(r.submitted_at),
        aiVerified: Boolean(r.ai_verified),
        aiConfidence: Number(r.ai_confidence || 0),
        aiReason: String(r.ai_reason || ''),
        rewardCents,
        rewardUsd: centsToUsd(rewardCents),
        xp: Number(r.xp || 50),
        status: r.status as QuestSubmission['status'],
        reviewedAt: r.reviewed_at || undefined,
        reviewNote: r.review_note || undefined,
        payoutId: r.payout_id || undefined,
        payoutStatus: r.payout_status || undefined,
      };
    });
  } catch {
    return [];
  }
}

export async function upsertSubmissionToSupabase(
  sub: QuestSubmission,
  travelerId?: string
): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) return;
  try {
    await supabase.from('quest_submissions').upsert({
      id: sub.id,
      quest_id: sub.questId,
      quest_title: sub.questTitle,
      business_name: sub.businessName,
      ...(travelerId && travelerId !== 'demo-user-roamr' ? { traveler_id: travelerId } : {}),
      traveler_name: sub.travelerName,
      traveler_email: sub.travelerEmail || null,
      traveler_avatar: sub.travelerAvatar || null,
      paypal_email: sub.paypalEmail,
      photo_uri: sub.photoUri || null,
      submitted_at: sub.submittedAt,
      ai_verified: sub.aiVerified,
      ai_confidence: sub.aiConfidence,
      ai_reason: sub.aiReason,
      reward_cents: sub.rewardCents ?? usdToCents(sub.rewardUsd),
      xp: sub.xp,
      status: sub.status,
      reviewed_at: sub.reviewedAt || null,
      review_note: sub.reviewNote || null,
      payout_id: sub.payoutId || null,
      payout_status: sub.payoutStatus || null,
    });
  } catch {
    // Best-effort sync
  }
}

export async function fetchUserStampsAndPayoutsFromSupabase(userId: string): Promise<{
  stamps: EarnedStamp[];
  payouts: PayoutRecord[];
}> {
  const supabase = getSupabaseClient();
  if (!supabase || !userId || userId === 'demo-user-roamr') {
    return { stamps: [], payouts: [] };
  }
  try {
    const [stRes, payRes] = await Promise.all([
      supabase
        .from('stamps')
        .select('*')
        .eq('user_id', userId)
        .order('completed_at', { ascending: false }),
      supabase
        .from('payouts')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false }),
    ]);

    const stamps: EarnedStamp[] = (stRes.data || []).map((r) => {
      const rewardCents = Number(r.reward_cents ?? 50);
      return {
        id: String(r.id),
        questId: String(r.quest_id),
        businessName: String(r.business_name),
        questTitle: String(r.quest_title),
        category: String(r.category || 'Cafe'),
        xp: Number(r.xp || 50),
        rewardCents,
        rewardUsd: centsToUsd(rewardCents),
        completedAt: String(r.completed_at),
        photoUri: r.photo_uri || undefined,
      };
    });

    const payouts: PayoutRecord[] = (payRes.data || []).map((r) => {
      const amountCents = Number(r.amount_cents ?? 50);
      return {
        id: String(r.id),
        questId: String(r.quest_id),
        questTitle: String(r.quest_title),
        amountCents,
        amountUsd: centsToUsd(amountCents),
        status: String(r.status),
        simulated: Boolean(r.simulated),
        debugId: r.debug_id || null,
        receiverEmail: String(r.receiver_email),
        createdAt: String(r.created_at),
        message: r.message || undefined,
      };
    });

    return { stamps, payouts };
  } catch {
    return { stamps: [], payouts: [] };
  }
}

export async function insertStampToSupabase(stamp: EarnedStamp, userId?: string): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase || !userId || userId === 'demo-user-roamr') return;
  try {
    await supabase.from('stamps').upsert({
      id: stamp.id,
      user_id: userId,
      quest_id: stamp.questId,
      business_name: stamp.businessName,
      quest_title: stamp.questTitle,
      category: stamp.category,
      xp: stamp.xp,
      reward_cents: stamp.rewardCents ?? usdToCents(stamp.rewardUsd),
      photo_uri: stamp.photoUri || null,
      completed_at: stamp.completedAt,
    });
  } catch {
    // Best-effort sync
  }
}

export async function upsertPayoutToSupabase(payout: PayoutRecord, userId?: string): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase || !userId || userId === 'demo-user-roamr') return;
  try {
    await supabase.from('payouts').upsert({
      id: payout.id,
      user_id: userId,
      quest_id: payout.questId,
      quest_title: payout.questTitle,
      amount_cents: payout.amountCents ?? usdToCents(payout.amountUsd),
      status: payout.status,
      simulated: payout.simulated,
      debug_id: payout.debugId || null,
      receiver_email: payout.receiverEmail,
      message: payout.message || null,
      created_at: payout.createdAt,
    });
  } catch {
    // Best-effort sync
  }
}

export async function updateRemoteBusinessProfile(profile: UserProfile): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase || profile.isDemo) return;
  try {
    await supabase.from('profiles').upsert({
      id: profile.id,
      name: profile.name,
      avatar: profile.avatar || null,
      is_traveler: profile.isTraveler,
      is_business: profile.isBusiness,
      business_name: profile.businessName || null,
      business_category: profile.businessCategory || null,
      business_address: profile.businessAddress || null,
      business_logo: profile.businessLogo || null,
    });
  } catch {
    // Local AsyncStorage keeps business onboarding persisted even if Supabase table isn't migrated
  }
}

export function getAuthRedirectUrl(): string {
  return getExpoAwareDeepLink('auth-callback');
}

export async function signInWithGoogleOAuth(): Promise<UserProfile> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    throw new Error(
      'Supabase is not configured. Add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to app/.env, or tap "Continue as demo user".'
    );
  }

  const redirectTo = getAuthRedirectUrl();
  console.log('[ROAMR Auth] Using OAuth redirectTo:', redirectTo);
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      skipBrowserRedirect: true,
    },
  });

  if (error || !data?.url) {
    throw new Error(error?.message || 'Unable to start Google sign-in.');
  }

  const res = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (res.type !== 'success' || !res.url) {
    throw new Error('Google sign-in was cancelled.');
  }

  const params = parseParamsFromUrl(res.url);

  if (params.error_description || params.error) {
    throw new Error(params.error_description || params.error);
  }

  let session: Session | null = null;

  if (params.access_token && params.refresh_token) {
    const { data: sessData, error: sessErr } = await withTimeout(
      supabase.auth.setSession({
        access_token: params.access_token,
        refresh_token: params.refresh_token,
      }),
      8000,
      'Google session verification'
    );
    if (sessErr) throw new Error(sessErr.message);
    session = sessData.session;
  } else if (params.code) {
    const { data: codeData, error: codeErr } = await withTimeout(
      supabase.auth.exchangeCodeForSession(params.code),
      8000,
      'Google OAuth code exchange'
    );
    if (codeErr) throw new Error(codeErr.message);
    session = codeData.session;
  }

  if (!session) {
    const { data: current } = await supabase.auth.getSession();
    session = current.session;
  }

  if (!session) {
    throw new Error('Google sign-in completed without a Supabase session.');
  }

  return ensureSupabaseProfile(session);
}

export async function signOutSupabase(): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) return;
  try {
    await supabase.auth.signOut();
  } catch {
    // Ignore sign-out network errors
  }
}
