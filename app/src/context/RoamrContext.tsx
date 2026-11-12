import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { formatDistance, haversineDistanceKm, LatLng } from '../utils/distance';
import { centsToUsd, usdToCents } from '../../lib/currency';
import { getPalette, ThemeMode, ThemePalette } from '../theme/tokens';
import {
  AppRole,
  CheckinOrderReceipt,
  ClaimRecord,
  EarnedStamp,
  InterestKey,
  MapProjectionMode,
  OwnerStats,
  PayoutRecord,
  Place,
  Quest,
  QuestSubmission,
  ServerUser,
  UserProfile,
  VerificationResult,
} from '../types/roamr';
import {
  createQuestOnServer,
  deleteQuestOnServer,
  fetchCheckinOrdersFromServer,
  fetchClaimsFromServer,
  fetchOwnerQuestsFromServer,
  fetchOwnerStatsFromServer,
  fetchPayoutStatus,
  fetchPlacesFromServer,
  fetchQuestsFromServer,
  fetchServerMe,
  fetchSubmissionsFromServer,
  generateQuestsWithApi,
  reviewSubmissionOnServer,
  saveMyPaypalEmailOnServer,
  setApiUserHeaders,
  submitClaimToServer,
  submitQuestForReviewOnServer,
  syncBusinessIdentityOnServer,
  triggerPayPalPayout,
  updateQuestOnServer,
} from '../services/api';
import {
  deleteQuestFromSupabase,
  ensureSupabaseProfile,
  fetchQuestsFromSupabase,
  fetchRemoteUserStats,
  fetchSubmissionsFromSupabase,
  fetchUserStampsAndPayoutsFromSupabase,
  getSupabaseClient,
  insertStampToSupabase,
  signInWithGoogleOAuth,
  signOutSupabase,
  syncProfileStatsToSupabase,
  updateRemoteBusinessProfile,
  upsertPayoutToSupabase,
  upsertQuestToSupabase,
  upsertSubmissionToSupabase,
} from '../services/supabase';

const STORAGE_KEY = 'roamr_app_state_v2';

function normalizeQuestCents(q: Quest): Quest {
  const budgetUsdVal = Number(q.budgetUsd ?? q.budget_usd ?? 0);
  const budgetCents = q.budgetCents ?? usdToCents(budgetUsdVal);
  const spentCents = q.spentCents ?? usdToCents(q.spentUsd ?? 0);
  const budgetRemainingUsd =
    q.budget_remaining_usd !== undefined
      ? Number(Math.max(0, Number(q.budget_remaining_usd)).toFixed(2))
      : Number(Math.max(0, budgetUsdVal - Number(q.spentUsd ?? 0)).toFixed(2));
  const isFunded = budgetRemainingUsd > 0 && q.funded !== false;
  const rewardUsdVal = isFunded
    ? q.rewardUsd ?? q.reward?.max_reward_usd ?? q.reward?.fixed_reward_usd ?? 2.0
    : 0;
  const rewardCents = isFunded ? (q.rewardCents ?? usdToCents(rewardUsdVal)) : 0;
  const latNum = typeof q.lat === 'number' ? q.lat : q.coordinates?.latitude ?? 12.9716;
  const lngNum = typeof q.lng === 'number' ? q.lng : q.coordinates?.longitude ?? 77.5946;
  return {
    ...q,
    coordinates: q.coordinates ?? { latitude: latNum, longitude: lngNum },
    description: q.public_description ?? q.description ?? '',
    objective: q.public_objective ?? q.objective ?? '',
    image: q.photo_url !== undefined ? q.photo_url : q.image ?? null,
    fundedBy: isFunded ? (q.funded_by ?? q.fundedBy ?? q.businessName ?? '') : '',
    funded: isFunded,
    reward_mode: isFunded ? 'cashback' : 'xp_only',
    budget_usd: budgetUsdVal,
    budget_remaining_usd: budgetRemainingUsd,
    rewardCents,
    rewardUsd: centsToUsd(rewardCents),
    budgetCents,
    budgetUsd: centsToUsd(budgetCents),
    spentCents,
    spentUsd: centsToUsd(spentCents),
  };
}

interface PersistedState {
  userProfile: UserProfile | null;
  quests: Quest[];
  stamps: EarnedStamp[];
  payouts: PayoutRecord[];
  submissions: QuestSubmission[];
  claims: ClaimRecord[];
  checkinOrders: Record<string, CheckinOrderReceipt>;
  walletBalanceCents: number;
  totalXp: number;
  bookmarkedIds: string[];
  role: AppRole;
  demoMode: boolean;
  onboardingDone: boolean;
  interests: InterestKey[];
  city: string;
  paypalEmail: string;
  phone: string;
  gender: string;
  travelStyle: string;
  lightPreset: 'day' | 'dusk';
  mapProjection: MapProjectionMode;
  enable3D: boolean;
  themeMode: ThemeMode;
  showInr: boolean;
}

function isDemoClaimRecord(c: ClaimRecord): boolean {
  const oid = String(c?.order?.orderId || '');
  return Boolean(
    c?.demoMode ||
      String(c?.id || '').startsWith('claim-test-') ||
      oid.startsWith('TEST-ORD-') ||
      oid.startsWith('SIM-') ||
      c?.order?.simulated === true
  );
}

const DEFAULT_STATE: PersistedState = {
  userProfile: null,
  quests: [],
  stamps: [],
  payouts: [],
  submissions: [],
  claims: [],
  checkinOrders: {},
  walletBalanceCents: 0,
  totalXp: 0,
  bookmarkedIds: [],
  role: 'traveler',
  demoMode: false,
  onboardingDone: false,
  interests: ['food', 'photography', 'history'],
  city: 'San Francisco',
  paypalEmail: 'sb-traveler@personal.example.com',
  phone: '',
  gender: 'Prefer not to say',
  travelStyle: 'Discover Hidden Gems',
  lightPreset: 'day',
  mapProjection: 'globe',
  enable3D: true,
  themeMode: 'light',
  showInr: false,
};

interface PendingProof {
  questId: string;
  photoUri: string;
  base64?: string;
  mimeType?: string;
}

interface BusinessOnboardingInput {
  businessName: string;
  businessPaypalEmail: string;
  businessCategory?: string;
  businessLogo?: string;
  place?: {
    place_id?: string;
    name?: string;
    address?: string;
    lat?: number;
    lng?: number;
    category?: string;
    city?: string;
  };
}

const EMPTY_OWNER_STATS: OwnerStats = {
  funded: 0,
  spent: 0,
  remaining: 0,
  paid_visits: 0,
  quests_count: 0,
  owned_places_count: 0,
  is_owner: false,
};

interface RoamrContextValue extends PersistedState {
  places: Place[];
  ownerQuests: Quest[];
  ownerStats: OwnerStats;
  serverUser: ServerUser | null;
  isSuperAdmin: boolean;
  refreshPlacesAndOwner: () => Promise<void>;
  walletBalanceUsd: number;
  isDark: boolean;
  palette: ThemePalette;
  hydrated: boolean;
  userCoords: LatLng | null;
  locationStatus: 'idle' | 'granted' | 'denied';
  refreshLocation: () => Promise<LatLng | null>;
  selectedQuestId: string | null;
  setSelectedQuestId: (id: string | null) => void;
  setLightPreset: (preset: 'day' | 'dusk') => void;
  setMapProjection: (projection: MapProjectionMode) => void;
  setEnable3D: (enabled: boolean) => void;
  setThemeMode: (mode: ThemeMode) => void;
  setShowInr: (showInr: boolean) => void;
  pendingProof: PendingProof | null;
  setPendingProof: (proof: PendingProof | null) => void;
  pendingCheckinOrders: CheckinOrderReceipt[];
  lastVerification: VerificationResult | null;
  setLastVerification: (v: VerificationResult | null) => void;
  lastCompletedStamp: EarnedStamp | null;
  signInWithGoogle: () => Promise<UserProfile>;
  signInAsDemoUser: () => void;
  signOut: () => Promise<void>;
  completeBusinessOnboarding: (input: BusinessOnboardingInput) => Promise<void>;
  toggleBookmark: (questId: string) => void;
  toggleDemoMode: () => void;
  setRole: (role: AppRole) => void;
  setPaypalEmail: (email: string) => void;
  saveOnboarding: (
    interests: InterestKey[],
    city: string,
    extras?: {
      paypalEmail?: string;
      phone?: string;
      gender?: string;
      travelStyle?: string;
      enable3D?: boolean;
    }
  ) => Promise<Quest[]>;
  completeQuestAndPayout: (quest: Quest, photoUri?: string) => Promise<{
    stamp: EarnedStamp;
    payout: PayoutRecord;
  }>;
  submitQuestForHumanReview: (
    quest: Quest,
    verification: { verified: boolean; confidence: number; reason: string },
    photoUri?: string
  ) => Promise<QuestSubmission>;
  reviewSubmission: (
    submissionId: string,
    decision: 'approve' | 'reject',
    reviewNote?: string
  ) => Promise<QuestSubmission | null>;
  refreshClaims: () => Promise<ClaimRecord[]>;
  recordCheckinOrder: (receipt: CheckinOrderReceipt) => void;
  submitClaimProof: (payload: {
    quest: Quest;
    order?: CheckinOrderReceipt | null;
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
  }) => Promise<ClaimRecord>;
  refreshPayoutStatus: (batchId: string) => Promise<void>;
  retryPayout: (payoutId: string) => Promise<void>;
  addBusinessQuest: (input: {
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
  }) => Promise<Quest>;
  updateBusinessQuest: (
    questId: string,
    input: Parameters<RoamrContextValue['addBusinessQuest']>[0]
  ) => Promise<Quest>;
  deleteBusinessQuest: (questId: string) => Promise<void>;
  markQuestFunded: (questId: string, amountUsd: number, orderId?: string, captureId?: string) => void;
  resetDemoData: () => Promise<void>;
}

const RoamrContext = createContext<RoamrContextValue | null>(null);

export function RoamrProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<PersistedState>(DEFAULT_STATE);
  const [hydrated, setHydrated] = useState(false);
  const [places, setPlaces] = useState<Place[]>([]);
  const [ownerQuests, setOwnerQuests] = useState<Quest[]>([]);
  const [ownerStats, setOwnerStats] = useState<OwnerStats>(EMPTY_OWNER_STATS);
  const [serverUser, setServerUser] = useState<ServerUser | null>(null);
  const [userCoords, setUserCoords] = useState<LatLng | null>(null);
  const [locationStatus, setLocationStatus] = useState<'idle' | 'granted' | 'denied'>('idle');
  const [selectedQuestId, setSelectedQuestId] = useState<string | null>(null);
  const [pendingProof, setPendingProof] = useState<PendingProof | null>(null);
  const [pendingCheckinOrders, setPendingCheckinOrders] = useState<CheckinOrderReceipt[]>([]);
  const [lastVerification, setLastVerification] = useState<VerificationResult | null>(null);
  const [lastCompletedStamp, setLastCompletedStamp] = useState<EarnedStamp | null>(null);

  const refreshLocation = useCallback(async (): Promise<LatLng | null> => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocationStatus('denied');
        return null;
      }
      setLocationStatus('granted');
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const coords: LatLng = {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
      };
      setUserCoords(coords);
      return coords;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    refreshLocation();
  }, [refreshLocation]);

  // Hydrate persisted state + Supabase session on launch
  useEffect(() => {
    let active = true;
    (async () => {
      let hydratedDemo = false;
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw && active) {
          const parsed = JSON.parse(raw) as Partial<PersistedState> & {
            walletBalanceUsd?: number;
          };
          hydratedDemo = false;
          const rawQuests = (parsed.quests?.length ? parsed.quests : []).map(
            normalizeQuestCents
          );
          const migratedCents =
            typeof parsed.walletBalanceCents === 'number'
              ? Math.round(parsed.walletBalanceCents)
              : usdToCents(parsed.walletBalanceUsd || 0);
          setState((prev) => ({
            ...prev,
            ...parsed,
            demoMode: false,
            walletBalanceCents: migratedCents,
            showInr: Boolean(parsed.showInr),
            quests: rawQuests,
          }));
        }
      } catch {
        // Ignore storage read error
      }

      // Check active Supabase session & hydrate real PostgreSQL data
      const supabase = getSupabaseClient();
      if (supabase && active) {
        try {
          const { data } = await supabase.auth.getSession();
          if (data.session && active) {
            const prof = await ensureSupabaseProfile(data.session);
            const [remoteStats, userLedger, remoteQuests, remoteSubs] = await Promise.all([
              fetchRemoteUserStats(prof.id),
              fetchUserStampsAndPayoutsFromSupabase(prof.id),
              fetchQuestsFromSupabase(),
              fetchSubmissionsFromSupabase(),
            ]);
            if (active) {
              setState((prev) => {
                const mergedProfile: UserProfile = {
                  ...prof,
                  phone: remoteStats?.phone || prev.phone || undefined,
                  gender: remoteStats?.gender || prev.gender || undefined,
                  travelStyle: remoteStats?.travelStyle || prev.travelStyle || undefined,
                  onboardingDone: remoteStats?.onboardingDone ?? prev.onboardingDone,
                  isBusiness: remoteStats?.isBusiness ?? prev.userProfile?.isBusiness ?? false,
                  businessName:
                    remoteStats?.businessName || prev.userProfile?.businessName || prof.businessName,
                  businessCategory:
                    remoteStats?.businessCategory ||
                    prev.userProfile?.businessCategory ||
                    prof.businessCategory,
                  businessAddress:
                    remoteStats?.businessAddress ||
                    prev.userProfile?.businessAddress ||
                    prof.businessAddress,
                  businessLogo:
                    remoteStats?.businessLogo || prev.userProfile?.businessLogo || prof.businessLogo,
                };
                return {
                  ...prev,
                  userProfile: mergedProfile,
                  ...(remoteStats?.city ? { city: remoteStats.city } : {}),
                  ...(remoteStats?.paypalEmail ? { paypalEmail: remoteStats.paypalEmail } : {}),
                  ...(remoteStats?.phone ? { phone: remoteStats.phone } : {}),
                  ...(remoteStats?.gender ? { gender: remoteStats.gender } : {}),
                  ...(remoteStats?.travelStyle ? { travelStyle: remoteStats.travelStyle } : {}),
                  ...(typeof remoteStats?.onboardingDone === 'boolean'
                    ? { onboardingDone: remoteStats.onboardingDone }
                    : {}),
                  ...(remoteStats?.interests?.length ? { interests: remoteStats.interests } : {}),
                  ...(typeof remoteStats?.totalXp === 'number'
                    ? { totalXp: remoteStats.totalXp }
                    : {}),
                  ...(typeof remoteStats?.walletBalanceCents === 'number'
                    ? { walletBalanceCents: remoteStats.walletBalanceCents }
                    : {}),
                  ...(userLedger.stamps.length ? { stamps: userLedger.stamps } : {}),
                  ...(userLedger.payouts.length ? { payouts: userLedger.payouts } : {}),
                  ...(remoteQuests.length ? { quests: remoteQuests } : {}),
                  ...(remoteSubs.length ? { submissions: remoteSubs } : {}),
                };
              });
            }
          }
        } catch {
          // Ignore session lookup errors offline
        }
      }

      if (active) setHydrated(true);

      // Sync places, quests, owner stats, submissions & claims from Express backend if reachable
      try {
        const [placesRes, res, subRes, claimsRes, meRes, ownerQuestsRes, ownerStatsRes] = await Promise.all([
          fetchPlacesFromServer().catch(() => ({ places: [] as Place[] })),
          fetchQuestsFromServer(),
          fetchSubmissionsFromServer().catch(() => ({ submissions: [] as QuestSubmission[] })),
          fetchClaimsFromServer({ includeDemo: hydratedDemo }).catch(() => ({
            claims: [] as ClaimRecord[],
          })),
          fetchServerMe().catch(() => ({ user: null as ServerUser | null })),
          fetchOwnerQuestsFromServer().catch(() => ({ quests: [] as Quest[] })),
          fetchOwnerStatsFromServer().catch(() => EMPTY_OWNER_STATS),
        ]);
        if (active) {
          if (placesRes.places?.length) setPlaces(placesRes.places);
          if (meRes.user) setServerUser(meRes.user);
          setOwnerQuests((ownerQuestsRes.quests || []).map(normalizeQuestCents));
          setOwnerStats(ownerStatsRes || EMPTY_OWNER_STATS);
          setState((prev) => {
            const existingRecommended = prev.quests.filter((q) => q.isRecommended);
            const serverIds = new Set(res.quests.map((q) => q.id));
            const mergedQuests = res.quests?.length
              ? [
                  ...existingRecommended.filter((q) => !serverIds.has(q.id)),
                  ...res.quests.map(normalizeQuestCents),
                ]
              : prev.quests;

            const localIds = new Set(prev.submissions.map((s) => s.id));
            const mergedSubmissions = [
              ...prev.submissions,
              ...(subRes.submissions || []).filter((s) => !localIds.has(s.id)),
            ];

            const serverClaimIds = new Set((claimsRes.claims || []).map((c) => c.id));
            const mergedClaims = [
              ...(claimsRes.claims || []),
              ...prev.claims.filter((c) => !serverClaimIds.has(c.id)),
            ];

            return {
              ...prev,
              quests: mergedQuests,
              submissions: mergedSubmissions,
              claims: mergedClaims,
            };
          });
        }
      } catch {
        // Offline / server not running
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  // Keep API auth headers synced with active user & refresh SQLite places/owner stats
  const refreshPlacesAndOwner = useCallback(async () => {
    try {
      const [placesRes, questsRes, meRes, ownerQRes, ownerStatsRes] = await Promise.all([
        fetchPlacesFromServer().catch(() => ({ places: [] as Place[] })),
        fetchQuestsFromServer().catch(() => ({ quests: [] as Quest[] })),
        fetchServerMe().catch(() => ({ user: null as ServerUser | null })),
        fetchOwnerQuestsFromServer().catch(() => ({ quests: [] as Quest[] })),
        fetchOwnerStatsFromServer().catch(() => EMPTY_OWNER_STATS),
      ]);
      if (placesRes.places) setPlaces(placesRes.places);
      if (meRes.user) {
        setServerUser(meRes.user);
      }
      setOwnerQuests((ownerQRes.quests || []).map(normalizeQuestCents));
      setOwnerStats(ownerStatsRes || EMPTY_OWNER_STATS);
      setState((prev) => {
        const existingRecommended = prev.quests.filter((q) => q.isRecommended);
        const serverIds = new Set((questsRes.quests || []).map((q) => q.id));
        const nextQuests = questsRes.quests?.length
          ? [
              ...existingRecommended.filter((q) => !serverIds.has(q.id)),
              ...questsRes.quests.map(normalizeQuestCents),
            ]
          : prev.quests;
        const serverPaypal = meRes.user ? String(meRes.user.paypal_email || '').trim() : prev.paypalEmail;
        const serverBizName = meRes.user?.business_name || prev.userProfile?.businessName || '';
        const serverHasBiz = Boolean(
          meRes.user?.business_name ||
            meRes.user?.primary_place ||
            (meRes.user?.owned_places_count ?? 0) > 0
        );
        return {
          ...prev,
          quests: nextQuests,
          paypalEmail: serverPaypal,
          userProfile: prev.userProfile
            ? {
                ...prev.userProfile,
                isBusiness: Boolean(prev.userProfile.isBusiness || serverHasBiz),
                businessPaypalEmail: serverPaypal,
                businessName: serverBizName,
              }
            : prev.userProfile,
        };
      });
    } catch {
      // Offline
    }
  }, []);

  useEffect(() => {
    setApiUserHeaders(
      state.userProfile
        ? { email: state.userProfile.email, name: state.userProfile.name }
        : null
    );
    if (hydrated) {
      void refreshPlacesAndOwner();
    }
  }, [state.userProfile?.email, state.userProfile?.name, hydrated, refreshPlacesAndOwner]);

  // Persist changes
  useEffect(() => {
    if (!hydrated) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch(() => {});
  }, [state, hydrated]);

  const isSuperAdmin = useMemo(() => {
    if (serverUser) {
      return serverUser.role === 'admin';
    }
    const email = String(state.userProfile?.email || '').trim().toLowerCase();
    return email === 'tsrinath2020@gmail.com';
  }, [serverUser, state.userProfile?.email]);

  const signInWithGoogle = useCallback(async () => {
    const profile = await signInWithGoogleOAuth();
    const [remoteStats, userLedger, remoteQuests, remoteSubs] = await Promise.all([
      fetchRemoteUserStats(profile.id),
      fetchUserStampsAndPayoutsFromSupabase(profile.id),
      fetchQuestsFromSupabase(),
      fetchSubmissionsFromSupabase(),
    ]);
    const hydratedProfile: UserProfile = {
      ...profile,
      phone: remoteStats?.phone,
      gender: remoteStats?.gender,
      travelStyle: remoteStats?.travelStyle,
      onboardingDone: remoteStats?.onboardingDone,
      isBusiness: remoteStats?.isBusiness ?? false,
      businessName: remoteStats?.businessName,
      businessCategory: remoteStats?.businessCategory,
      businessAddress: remoteStats?.businessAddress,
      businessLogo: remoteStats?.businessLogo,
    };
    setState((prev) => ({
      ...prev,
      userProfile: hydratedProfile,
      role: 'traveler',
      ...(remoteStats?.city ? { city: remoteStats.city } : {}),
      ...(remoteStats?.paypalEmail ? { paypalEmail: remoteStats.paypalEmail } : {}),
      ...(remoteStats?.phone ? { phone: remoteStats.phone } : {}),
      ...(remoteStats?.gender ? { gender: remoteStats.gender } : {}),
      ...(remoteStats?.travelStyle ? { travelStyle: remoteStats.travelStyle } : {}),
      ...(typeof remoteStats?.onboardingDone === 'boolean'
        ? { onboardingDone: remoteStats.onboardingDone }
        : {}),
      ...(remoteStats?.interests?.length ? { interests: remoteStats.interests } : {}),
      totalXp: typeof remoteStats?.totalXp === 'number' ? remoteStats.totalXp : prev.totalXp,
      walletBalanceCents:
        typeof remoteStats?.walletBalanceCents === 'number'
          ? remoteStats.walletBalanceCents
          : prev.walletBalanceCents,
      stamps: userLedger.stamps.length ? userLedger.stamps : prev.stamps,
      payouts: userLedger.payouts.length ? userLedger.payouts : prev.payouts,
      ...(remoteQuests.length ? { quests: remoteQuests } : {}),
      ...(remoteSubs.length ? { submissions: remoteSubs } : {}),
    }));
    return hydratedProfile;
  }, []);

  const signInAsDemoUser = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    const demoUser: UserProfile = {
      id: 'demo-user-roamr',
      name: 'Alex Explorer',
      email: 'demo@roamr.app',
      isDemo: true,
      isTraveler: true,
      isBusiness: false,
    };
    setState((prev) => ({
      ...prev,
      userProfile: prev.userProfile?.isDemo ? prev.userProfile : demoUser,
      role: 'traveler',
      demoMode: true,
      onboardingDone: true,
    }));
  }, []);

  const signOut = useCallback(async () => {
    await signOutSupabase();
    setServerUser(null);
    setOwnerQuests([]);
    setOwnerStats(EMPTY_OWNER_STATS);
    setState((prev) => ({
      ...prev,
      userProfile: null,
      paypalEmail: '',
      role: 'traveler',
    }));
  }, []);

  const completeBusinessOnboarding = useCallback(
    async (input: BusinessOnboardingInput) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      const base: UserProfile = state.userProfile || {
        id: 'demo-user-roamr',
        name: 'Alex Explorer',
        email: 'demo@roamr.app',
        isDemo: true,
        isTraveler: true,
        isBusiness: false,
      };
      const updatedProfile: UserProfile = {
        ...base,
        isBusiness: true,
        businessName: input.businessName.trim() || base.name,
        businessPaypalEmail: input.businessPaypalEmail.trim(),
        businessCategory: input.businessCategory?.trim() || undefined,
        businessLogo: input.businessLogo?.trim() || undefined,
      };
      setState((prev) => ({
        ...prev,
        userProfile: updatedProfile,
        role: 'business',
      }));
      setApiUserHeaders({ email: updatedProfile.email, name: updatedProfile.name });
      await syncBusinessIdentityOnServer({
        business_name: updatedProfile.businessName || updatedProfile.name,
        paypal_email: updatedProfile.businessPaypalEmail || updatedProfile.email,
        ...(input.place ? { place: input.place } : {}),
      });
      void updateRemoteBusinessProfile(updatedProfile).catch(() => {});
      await refreshPlacesAndOwner();
    },
    [state.userProfile, refreshPlacesAndOwner]
  );

  const toggleBookmark = useCallback((questId: string) => {
    Haptics.selectionAsync().catch(() => {});
    setState((prev) => {
      const exists = prev.bookmarkedIds.includes(questId);
      return {
        ...prev,
        bookmarkedIds: exists
          ? prev.bookmarkedIds.filter((id) => id !== questId)
          : [...prev.bookmarkedIds, questId],
      };
    });
  }, []);

  const toggleDemoMode = useCallback(() => {
    setState((prev) => ({
      ...prev,
      demoMode: false,
    }));
  }, []);

  const setRole = useCallback((role: AppRole) => {
    Haptics.selectionAsync().catch(() => {});
    setState((prev) => ({ ...prev, role }));
  }, []);

  const setPaypalEmail = useCallback(
    (paypalEmail: string) => {
      const clean = paypalEmail.trim();
      setState((prev) => ({
        ...prev,
        paypalEmail: clean,
        userProfile: prev.userProfile
          ? {
              ...prev.userProfile,
              businessPaypalEmail: clean,
            }
          : prev.userProfile,
      }));
      if (clean && clean.includes('@')) {
        void saveMyPaypalEmailOnServer(clean)
          .then(() => refreshPlacesAndOwner())
          .catch(() => {});
      }
      if (state.userProfile?.id) {
        void syncProfileStatsToSupabase(state.userProfile.id, { paypalEmail: clean });
      }
    },
    [state.userProfile?.id, refreshPlacesAndOwner]
  );

  const setLightPreset = useCallback((lightPreset: 'day' | 'dusk') => {
    Haptics.selectionAsync().catch(() => {});
    setState((prev) => ({ ...prev, lightPreset }));
  }, []);

  const setMapProjection = useCallback((mapProjection: MapProjectionMode) => {
    Haptics.selectionAsync().catch(() => {});
    setState((prev) => ({ ...prev, mapProjection }));
  }, []);

  const setEnable3D = useCallback((enable3D: boolean) => {
    Haptics.selectionAsync().catch(() => {});
    setState((prev) => ({ ...prev, enable3D }));
  }, []);

  const setShowInr = useCallback((showInr: boolean) => {
    Haptics.selectionAsync().catch(() => {});
    setState((prev) => ({ ...prev, showInr }));
  }, []);

  const setThemeMode = useCallback((themeMode: ThemeMode) => {
    Haptics.selectionAsync().catch(() => {});
    setState((prev) => ({
      ...prev,
      themeMode,
      lightPreset: themeMode === 'dark' ? 'dusk' : 'day',
    }));
  }, []);

  const saveOnboarding = useCallback(
    async (
      interests: InterestKey[],
      city: string,
      extras?: {
        paypalEmail?: string;
        phone?: string;
        gender?: string;
        travelStyle?: string;
        enable3D?: boolean;
      }
    ): Promise<Quest[]> => {
      let recommended: Quest[] = [];
      try {
        const res = await generateQuestsWithApi({
          interests,
          city,
          businesses: state.quests,
        });
        recommended = res.quests.map((q) => ({ ...q, isRecommended: true }));
      } catch {
        const isBlr = /bangal|bengal/i.test(city);
        recommended = state.quests.slice(0, 3).map((q, idx) => ({
          ...q,
          id: `ai-local-${Date.now()}-${idx}`,
          city,
          coordinates: isBlr
            ? {
                latitude: 12.9716 + idx * 0.004,
                longitude: 77.5946 + idx * 0.005,
              }
            : q.coordinates,
          isRecommended: true,
        }));
      }

      setState((prev) => {
        const nonRecommended = prev.quests.filter((q) => !q.isRecommended);
        const nextPaypalEmail = extras?.paypalEmail?.trim() || prev.paypalEmail;
        const nextPhone = extras?.phone !== undefined ? extras.phone.trim() : prev.phone;
        const nextGender = extras?.gender || prev.gender;
        const nextTravelStyle = extras?.travelStyle || prev.travelStyle;
        const next3D = extras?.enable3D !== undefined ? extras.enable3D : prev.enable3D;
        return {
          ...prev,
          interests,
          city,
          paypalEmail: nextPaypalEmail,
          phone: nextPhone,
          gender: nextGender,
          travelStyle: nextTravelStyle,
          enable3D: next3D,
          onboardingDone: true,
          userProfile: prev.userProfile
            ? {
                ...prev.userProfile,
                phone: nextPhone,
                gender: nextGender,
                travelStyle: nextTravelStyle,
                onboardingDone: true,
              }
            : null,
          quests: [...recommended, ...nonRecommended],
        };
      });

      if (state.userProfile?.id) {
        void syncProfileStatsToSupabase(state.userProfile.id, {
          city,
          interests,
          onboardingDone: true,
          ...(extras?.paypalEmail?.trim() ? { paypalEmail: extras.paypalEmail.trim() } : {}),
          ...(extras?.phone !== undefined ? { phone: extras.phone.trim() } : {}),
          ...(extras?.gender ? { gender: extras.gender } : {}),
          ...(extras?.travelStyle ? { travelStyle: extras.travelStyle } : {}),
        });
      }

      if (recommended[0]) {
        setSelectedQuestId(recommended[0].id);
      }
      return recommended;
    },
    [state.quests, state.userProfile?.id]
  );

  const completeQuestAndPayout = useCallback(
    async (quest: Quest, photoUri?: string) => {
      const rewardCents = quest.rewardCents ?? usdToCents(quest.rewardUsd);
      const rewardUsd = centsToUsd(rewardCents);
      const stamp: EarnedStamp = {
        id: `stamp-${Date.now()}`,
        questId: quest.id,
        businessName: quest.businessName || quest.title,
        questTitle: quest.title,
        category: quest.category,
        xp: quest.xp,
        rewardUsd,
        rewardCents,
        completedAt: new Date().toISOString(),
        photoUri,
      };

      let payout: PayoutRecord;
      try {
        const res = await triggerPayPalPayout({
          questId: quest.id,
          questTitle: quest.title,
          amountUsd: rewardUsd,
          receiverEmail: state.paypalEmail,
          verified: true,
        });
        payout = {
          ...res.payout,
          amountCents: usdToCents(res.payout.amountUsd),
        };
      } catch (err) {
        payout = {
          id: `SIM-LOCAL-${Date.now()}`,
          questId: quest.id,
          questTitle: quest.title,
          amountUsd: rewardUsd,
          amountCents: rewardCents,
          status: 'sandbox-simulated',
          simulated: true,
          receiverEmail: state.paypalEmail,
          createdAt: new Date().toISOString(),
          message:
            err instanceof Error
              ? `Recorded reward in wallet ledger (${err.message}).`
              : 'Recorded reward in wallet ledger (sandbox-simulated).',
        };
      }

      setLastCompletedStamp(stamp);
      setState((prev) => ({
        ...prev,
        stamps: [stamp, ...prev.stamps],
        payouts: [payout, ...prev.payouts],
        walletBalanceCents: prev.walletBalanceCents + rewardCents,
        totalXp: prev.totalXp + quest.xp,
        quests: prev.quests.map((q) => {
          if (q.id !== quest.id) return q;
          const nextSpentCents = (q.spentCents ?? usdToCents(q.spentUsd)) + rewardCents;
          return {
            ...q,
            verifiedVisits: (q.verifiedVisits || 0) + 1,
            spentCents: nextSpentCents,
            spentUsd: centsToUsd(nextSpentCents),
          };
        }),
      }));

      return { stamp, payout };
    },
    [state.paypalEmail]
  );

  const submitQuestForHumanReview = useCallback(
    async (
      quest: Quest,
      verification: { verified: boolean; confidence: number; reason: string },
      photoUri?: string
    ): Promise<QuestSubmission> => {
      const submission: QuestSubmission = {
        id: `sub-${Date.now()}`,
        questId: quest.id,
        questTitle: quest.title,
        businessName: quest.businessName || quest.title,
        travelerName: state.userProfile?.name || 'ROAMR Explorer',
        travelerEmail: state.userProfile?.email || 'explorer@roamr.app',
        travelerAvatar: state.userProfile?.avatar,
        paypalEmail: state.paypalEmail,
        photoUri,
        submittedAt: new Date().toISOString(),
        aiVerified: verification.verified,
        aiConfidence: verification.confidence,
        aiReason: verification.reason,
        rewardUsd: quest.rewardUsd,
        xp: quest.xp,
        status: 'pending_review',
      };

      try {
        await submitQuestForReviewOnServer(submission);
      } catch {
        // Persist cleanly in local state if server is unreachable
      }
      void upsertSubmissionToSupabase(submission, state.userProfile?.id);

      const pendingStamp: EarnedStamp = {
        id: `stamp-${Date.now()}`,
        questId: quest.id,
        businessName: quest.businessName || quest.title,
        questTitle: quest.title,
        category: quest.category,
        xp: quest.xp,
        rewardUsd: quest.rewardUsd,
        completedAt: submission.submittedAt,
        photoUri,
      };
      setLastCompletedStamp(pendingStamp);

      setState((prev) => ({
        ...prev,
        submissions: [submission, ...prev.submissions],
      }));

      return submission;
    },
    [state.userProfile, state.paypalEmail]
  );

  const reviewSubmission = useCallback(
    async (
      submissionId: string,
      decision: 'approve' | 'reject',
      reviewNote?: string
    ): Promise<QuestSubmission | null> => {
      const target = state.submissions.find((s) => s.id === submissionId);
      if (!target) return null;

      let updated: QuestSubmission = {
        ...target,
        status: decision === 'approve' ? 'approved' : 'rejected',
        reviewedAt: new Date().toISOString(),
        reviewNote,
      };
      let payoutRecord: PayoutRecord | null = null;

      try {
        const res = await reviewSubmissionOnServer(submissionId, decision, target, reviewNote);
        updated = res.submission || updated;
        payoutRecord = res.payout || null;
      } catch (err) {
        if (decision === 'approve') {
          payoutRecord = {
            id: `SIM-LOCAL-${Date.now()}`,
            questId: target.questId,
            questTitle: target.questTitle,
            amountUsd: target.rewardUsd,
            status: 'sandbox-simulated',
            simulated: true,
            receiverEmail: target.paypalEmail,
            createdAt: new Date().toISOString(),
            message:
              err instanceof Error
                ? `Approved offline (${err.message}). Recorded in wallet ledger.`
                : 'Approved offline. Recorded in wallet ledger (sandbox-simulated).',
          };
          updated.payoutId = payoutRecord.id;
          updated.payoutStatus = payoutRecord.status;
        }
      }

      let approvedStamp: EarnedStamp | null = null;
      let approvedPayout: PayoutRecord | null = null;
      let nextXpForDb: number | undefined;
      let nextStampsForDb: number | undefined;
      let nextWalletCentsForDb: number | undefined;
      let updatedQuestForDb: Quest | undefined;

      setState((prev) => {
        const rewardCents = target.rewardCents ?? usdToCents(target.rewardUsd);
        const alreadyStamped = prev.stamps.some(
          (st) => st.questId === target.questId && st.completedAt === target.submittedAt
        );
        const newStamp: EarnedStamp | null =
          decision === 'approve' && !alreadyStamped
            ? {
                id: `stamp-${Date.now()}`,
                questId: target.questId,
                businessName: target.businessName || target.questTitle,
                questTitle: target.questTitle,
                category:
                  prev.quests.find((q) => q.id === target.questId)?.category || 'Cafe',
                xp: target.xp,
                rewardUsd: centsToUsd(rewardCents),
                rewardCents,
                completedAt: target.submittedAt,
                photoUri: target.photoUri,
              }
            : null;
        approvedStamp = newStamp;

        const normalizedPayout = payoutRecord
          ? {
              ...payoutRecord,
              amountCents: payoutRecord.amountCents ?? usdToCents(payoutRecord.amountUsd),
            }
          : null;
        approvedPayout = normalizedPayout;

        const nextStamps = newStamp ? [newStamp, ...prev.stamps] : prev.stamps;
        const nextWalletCents = prev.walletBalanceCents + rewardCents;
        const nextTotalXp = prev.totalXp + target.xp;
        if (decision === 'approve') {
          nextXpForDb = nextTotalXp;
          nextStampsForDb = nextStamps.length;
          nextWalletCentsForDb = nextWalletCents;
        }

        const nextQuests = prev.quests.map((q) => {
          if (q.id !== target.questId) return q;
          const nextSpentCents = (q.spentCents ?? usdToCents(q.spentUsd)) + rewardCents;
          const uq = {
            ...q,
            verifiedVisits: (q.verifiedVisits || 0) + 1,
            spentCents: nextSpentCents,
            spentUsd: centsToUsd(nextSpentCents),
          };
          updatedQuestForDb = uq;
          return uq;
        });

        return {
          ...prev,
          submissions: prev.submissions.map((s) => (s.id === submissionId ? updated : s)),
          ...(decision === 'approve'
            ? {
                stamps: nextStamps,
                payouts: normalizedPayout ? [normalizedPayout, ...prev.payouts] : prev.payouts,
                walletBalanceCents: nextWalletCents,
                totalXp: nextTotalXp,
                quests: nextQuests,
              }
            : {}),
        };
      });

      void upsertSubmissionToSupabase(updated);
      if (decision === 'approve') {
        if (approvedStamp && state.userProfile?.id) {
          void insertStampToSupabase(approvedStamp, state.userProfile.id);
        }
        if (approvedPayout && state.userProfile?.id) {
          void upsertPayoutToSupabase(approvedPayout, state.userProfile.id);
        }
        if (updatedQuestForDb) {
          void upsertQuestToSupabase(updatedQuestForDb);
        }
        if (state.userProfile?.id && typeof nextXpForDb === 'number') {
          void syncProfileStatsToSupabase(state.userProfile.id, {
            totalXp: nextXpForDb,
            stampsCount: nextStampsForDb,
            walletBalanceCents: nextWalletCentsForDb,
          });
        }
      }

      return updated;
    },
    [state.submissions, state.userProfile?.id]
  );

  const refreshClaims = useCallback(async (): Promise<ClaimRecord[]> => {
    try {
      const [res, ordersRes] = await Promise.all([
        fetchClaimsFromServer({ includeDemo: state.demoMode }),
        fetchCheckinOrdersFromServer({ includeDemo: state.demoMode }).catch(() => ({
          orders: [] as CheckinOrderReceipt[],
        })),
      ]);
      const serverClaims = res.claims || [];
      setPendingCheckinOrders(ordersRes.orders || []);
      setState((prev) => {
        const serverIds = new Set(serverClaims.map((c) => c.id));
        const keptLocal = prev.demoMode
          ? prev.claims.filter((c) => !serverIds.has(c.id))
          : prev.claims.filter((c) => !serverIds.has(c.id) && !isDemoClaimRecord(c));
        return {
          ...prev,
          claims: [...serverClaims, ...keptLocal],
        };
      });
      return serverClaims;
    } catch {
      return state.demoMode
        ? state.claims
        : state.claims.filter((c) => !isDemoClaimRecord(c));
    }
  }, [state.claims, state.demoMode]);

  const recordCheckinOrder = useCallback((receipt: CheckinOrderReceipt) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setState((prev) => ({
      ...prev,
      checkinOrders: {
        ...prev.checkinOrders,
        [receipt.questId]: receipt,
      },
    }));
  }, []);

  const submitClaimProof = useCallback(
    async (payload: {
      quest: Quest;
      order?: CheckinOrderReceipt | null;
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
    }): Promise<ClaimRecord> => {
      const res = await submitClaimToServer({
        questId: payload.quest.id,
        quest: payload.quest,
        orderId: payload.order?.orderId,
        orderSummary: payload.order || null,
        photoBase64: payload.photoBase64,
        mimeType: payload.mimeType,
        photoUri: payload.photoUri,
        billPhotoBase64: payload.billPhotoBase64 ?? payload.order?.billPhotoBase64,
        billMimeType: payload.billMimeType || 'image/jpeg',
        billInr: payload.billInr ?? payload.order?.billInr,
        textAnswer: payload.textAnswer,
        gps: payload.gps,
        resolvedAddress: payload.resolvedAddress,
        distanceMeters: payload.distanceMeters,
        traveler: {
          name: state.userProfile?.name || 'ROAMR Explorer',
          email: state.userProfile?.email || 'explorer@roamr.app',
          avatar: state.userProfile?.avatar,
          paypalEmail: state.paypalEmail,
        },
        demoMode: state.demoMode,
      });

      const createdClaim = res.claim;
      const actualRewardCents = usdToCents(createdClaim.rewardUsd ?? payload.quest.rewardUsd);
      const newStamp: EarnedStamp = {
        id: `stamp-${Date.now()}`,
        questId: payload.quest.id,
        businessName: payload.quest.place_name || payload.quest.businessName || payload.quest.title,
        questTitle: payload.quest.title,
        category: payload.quest.category,
        xp: createdClaim.xp ?? payload.quest.xp,
        rewardUsd: centsToUsd(actualRewardCents),
        rewardCents: actualRewardCents,
        completedAt: createdClaim.submittedAt,
        photoUri: payload.photoUri,
      };
      setLastCompletedStamp(newStamp);

      const autoPaid = createdClaim.status === 'paid';
      let nextXpForDb: number | undefined;
      let nextStampsForDb: number | undefined;
      let nextWalletCentsForDb: number | undefined;
      let updatedQuestForDb: Quest | undefined;

      setState((prev) => {
        if (!autoPaid) {
          return {
            ...prev,
            claims: [createdClaim, ...prev.claims.filter((c) => c.id !== createdClaim.id)],
          };
        }

        const { [payload.quest.id]: _consumedOrder, ...remainingCheckinOrders } =
          prev.checkinOrders;
        const rewardCents = usdToCents(createdClaim.rewardUsd);
        const normalizedPayout = createdClaim.payout
          ? {
              ...createdClaim.payout,
              amountCents:
                createdClaim.payout.amountCents ?? usdToCents(createdClaim.payout.amountUsd),
            }
          : null;
        const alreadyStamped = prev.stamps.some(
          (st) => st.questId === createdClaim.questId && st.completedAt === createdClaim.submittedAt
        );
        const alreadyPaid = prev.payouts.some((p) => p.id === normalizedPayout?.id);
        const nextStamps = alreadyStamped ? prev.stamps : [newStamp, ...prev.stamps];
        const nextWalletCents = alreadyPaid
          ? prev.walletBalanceCents
          : prev.walletBalanceCents + rewardCents;
        const nextTotalXp = alreadyPaid ? prev.totalXp : prev.totalXp + createdClaim.xp;
        nextXpForDb = nextTotalXp;
        nextStampsForDb = nextStamps.length;
        nextWalletCentsForDb = nextWalletCents;

        const nextQuests = prev.quests.map((q) => {
          if (q.id !== createdClaim.questId) return q;
          if (res.quest) {
            return normalizeQuestCents(res.quest);
          }
          const nextSpentCents = (q.spentCents ?? usdToCents(q.spentUsd)) + rewardCents;
          const nextRemaining = Math.max(
            0,
            Number(((q.budget_remaining_usd ?? q.budgetUsd ?? 0) - centsToUsd(rewardCents)).toFixed(2))
          );
          const uq = normalizeQuestCents({
            ...q,
            verifiedVisits: (q.verifiedVisits || 0) + 1,
            spentCents: nextSpentCents,
            spentUsd: centsToUsd(nextSpentCents),
            budget_remaining_usd: nextRemaining,
            funded: nextRemaining > 0,
            reward_mode: nextRemaining > 0 ? 'cashback' : 'xp_only',
          });
          updatedQuestForDb = uq;
          return uq;
        });

        return {
          ...prev,
          checkinOrders: remainingCheckinOrders,
          claims: [createdClaim, ...prev.claims.filter((c) => c.id !== createdClaim.id)],
          stamps: nextStamps,
          payouts:
            normalizedPayout && !alreadyPaid
              ? [normalizedPayout, ...prev.payouts]
              : prev.payouts,
          walletBalanceCents: nextWalletCents,
          totalXp: nextTotalXp,
          quests: nextQuests,
        };
      });

      if (autoPaid) {
        if (state.userProfile?.id) {
          void insertStampToSupabase(newStamp, state.userProfile.id);
        }
        if (createdClaim.payout && state.userProfile?.id) {
          void upsertPayoutToSupabase(createdClaim.payout, state.userProfile.id);
        }
        if (updatedQuestForDb) {
          void upsertQuestToSupabase(updatedQuestForDb);
        }
        if (state.userProfile?.id && typeof nextXpForDb === 'number') {
          void syncProfileStatsToSupabase(state.userProfile.id, {
            totalXp: nextXpForDb,
            stampsCount: nextStampsForDb,
            walletBalanceCents: nextWalletCentsForDb,
          });
        }
      }

      return createdClaim;
    },
    [state.userProfile, state.paypalEmail, state.demoMode]
  );

  const refreshPayoutStatus = useCallback(async (batchId: string) => {
    try {
      const res = await fetchPayoutStatus(batchId);
      setState((prev) => ({
        ...prev,
        payouts: prev.payouts.map((p) =>
          p.id === batchId ? { ...p, status: res.payoutStatus } : p
        ),
      }));
    } catch {
      // Ignore if offline or simulated
    }
  }, []);

  const retryPayout = useCallback(
    async (payoutId: string) => {
      const target = state.payouts.find((p) => p.id === payoutId);
      if (!target) return;
      try {
        const res = await triggerPayPalPayout({
          questId: target.questId,
          questTitle: target.questTitle,
          amountUsd: target.amountUsd,
          receiverEmail: state.paypalEmail,
          verified: true,
        });
        setState((prev) => ({
          ...prev,
          payouts: prev.payouts.map((p) => (p.id === payoutId ? res.payout : p)),
        }));
      } catch (err) {
        setState((prev) => ({
          ...prev,
          payouts: prev.payouts.map((p) =>
            p.id === payoutId
              ? {
                  ...p,
                  message:
                    err instanceof Error
                      ? `Retry failed: ${err.message}`
                      : 'Retry failed — check server connection.',
                }
              : p
          ),
        }));
      }
    },
    [state.payouts, state.paypalEmail]
  );

  const addBusinessQuest = useCallback(
    async (input: {
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
    }): Promise<Quest> => {
      const expiresAt =
        input.durationHours && input.durationHours > 0
          ? new Date(Date.now() + input.durationHours * 3600000).toISOString()
          : undefined;
      let created: Quest;
      try {
        const res = await createQuestOnServer({
          ...input,
          merchantEmail: input.merchantEmail || state.userProfile?.businessPaypalEmail,
          expiresAt,
        });
        created = res.quest;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const isOffline =
          msg.includes('Cannot reach ROAMR backend') ||
          msg.includes('EXPO_PUBLIC_API_URL') ||
          msg.includes('Aborted');
        if (!isOffline) {
          throw err;
        }
        const lat = input.lat ?? input.coordinates?.latitude ?? 12.9716;
        const lng = input.lng ?? input.coordinates?.longitude ?? 77.5946;
        const questType = input.quest_type || 'visit';
        created = {
          id: `quest-${Date.now()}`,
          title: input.title,
          businessName: input.businessName,
          place_name: input.place_name || input.businessName,
          category: input.category,
          quest_type: questType,
          distance: '0.5 km',
          distanceKm: 0.5,
          xp: input.xp || Math.round(input.rewardUsd * 10),
          rewardUsd: input.rewardUsd,
          reward: input.reward,
          difficulty: input.difficulty || 'Easy',
          estTime: `~ ${input.est_minutes || 20} min`,
          est_minutes: input.est_minutes || 20,
          fundedBy: input.businessName,
          description:
            input.public_description ||
            input.description ||
            `Explore ${input.place_name || input.businessName} and complete a quick local quest.`,
          public_description: input.public_description || input.description || '',
          objective: input.public_objective || input.objective,
          public_objective: input.public_objective || input.objective,
          text_answer_prompt: input.text_answer_prompt || null,
          ...(input.address ? { address: input.address } : {}),
          lat,
          lng,
          radius_m: input.radius_m || 150,
          night_only: Boolean(input.night_only),
          proofType: questType === 'purchase' ? 'receipt' : 'photo',
          image: input.photo_url || null,
          photo_url: input.photo_url || null,
          coordinates: { latitude: lat, longitude: lng },
          mapPosition: { xPercent: 58, yPercent: 38 },
          city: input.city || state.city,
          budgetUsd: input.budgetUsd,
          budget_usd: input.budget_usd ?? input.budgetUsd,
          spentUsd: 0,
          verifiedVisits: 0,
          funded: false,
          ...(expiresAt ? { durationHours: input.durationHours, expiresAt } : {}),
        };
      }

      const normalized = normalizeQuestCents(created);
      setState((prev) => ({
        ...prev,
        quests: [normalized, ...prev.quests],
      }));
      setOwnerQuests((prev) => [normalized, ...prev.filter((q) => q.id !== normalized.id)]);
      void refreshPlacesAndOwner();
      void upsertQuestToSupabase(normalized, state.userProfile?.id);
      return normalized;
    },
    [state.city, state.userProfile?.id, state.userProfile?.businessPaypalEmail, refreshPlacesAndOwner]
  );

  const updateBusinessQuest = useCallback(
    async (
      questId: string,
      input: Parameters<RoamrContextValue['addBusinessQuest']>[0]
    ): Promise<Quest> => {
      const existing = state.quests.find((q) => q.id === questId);
      let updatedQuest: Quest;
      try {
        const res = await updateQuestOnServer(questId, {
          ...input,
          merchantEmail: input.merchantEmail || state.userProfile?.businessPaypalEmail,
        });
        updatedQuest = res.quest;
      } catch {
        const lat = input.lat ?? input.coordinates?.latitude ?? existing?.coordinates?.latitude ?? 12.9716;
        const lng = input.lng ?? input.coordinates?.longitude ?? existing?.coordinates?.longitude ?? 77.5946;
        const budgetVal = Number(input.budgetUsd ?? 0);
        const isFundedVal = Boolean(existing?.funded && budgetVal > 0);
        updatedQuest = {
          ...(existing || ({} as Quest)),
          id: questId,
          title: input.title,
          businessName: input.businessName,
          place_name: input.place_name || input.businessName,
          category: input.category,
          quest_type: input.quest_type || 'visit',
          difficulty: input.difficulty || 'Easy',
          est_minutes: input.est_minutes || 20,
          estTime: `~ ${input.est_minutes || 20} min`,
          xp: input.xp || existing?.xp || 50,
          fundedBy: budgetVal > 0 ? input.businessName : '',
          description: input.public_description || input.description || '',
          public_description: input.public_description || input.description || '',
          objective: input.public_objective || input.objective,
          public_objective: input.public_objective || input.objective,
          text_answer_prompt: input.text_answer_prompt || null,
          address: input.address,
          city: input.city || existing?.city || state.city,
          lat,
          lng,
          coordinates: { latitude: lat, longitude: lng },
          radius_m: input.radius_m || 150,
          night_only: Boolean(input.night_only),
          image: input.photo_url !== undefined ? input.photo_url : existing?.image || null,
          photo_url: input.photo_url !== undefined ? input.photo_url : existing?.photo_url || null,
          rewardUsd: budgetVal > 0 ? input.rewardUsd : 0,
          reward: input.reward,
          budgetUsd: budgetVal,
          budget_usd: budgetVal,
          budget_remaining_usd: isFundedVal
            ? Math.max(0, Number((budgetVal - Number(existing?.spentUsd || 0)).toFixed(2)))
            : 0,
          funded: isFundedVal,
          reward_mode: isFundedVal ? 'cashback' : 'xp_only',
        };
      }

      const normalized = normalizeQuestCents(updatedQuest);
      setState((prev) => ({
        ...prev,
        quests: prev.quests.map((q) => (q.id === questId ? normalized : q)),
      }));
      setOwnerQuests((prev) => prev.map((q) => (q.id === questId ? normalized : q)));
      void refreshPlacesAndOwner();
      void upsertQuestToSupabase(normalized, state.userProfile?.id);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      return normalized;
    },
    [state.quests, state.city, state.userProfile?.id, state.userProfile?.businessPaypalEmail, refreshPlacesAndOwner]
  );

  const deleteBusinessQuest = useCallback(async (questId: string) => {
    Haptics.selectionAsync().catch(() => {});
    try {
      await deleteQuestOnServer(questId);
    } catch {
      // Remove locally even if backend is offline
    }
    void deleteQuestFromSupabase(questId);
    setSelectedQuestId((prevId) => (prevId === questId ? null : prevId));
    setState((prev) => ({
      ...prev,
      quests: prev.quests.filter((q) => q.id !== questId),
    }));
    setOwnerQuests((prev) => prev.filter((q) => q.id !== questId));
    void refreshPlacesAndOwner();
  }, [refreshPlacesAndOwner]);

  const markQuestFunded = useCallback(
    (questId: string, amountUsd: number, orderId?: string, captureId?: string) => {
      const budgetCents = usdToCents(amountUsd);
      let fundedQuest: Quest | undefined;
      setState((prev) => ({
        ...prev,
        quests: prev.quests.map((q) => {
          if (q.id !== questId) return q;
          fundedQuest = {
            ...q,
            funded: true,
            budgetCents,
            budgetUsd: centsToUsd(budgetCents),
            paypalOrderId: orderId,
            paypalCaptureId: captureId,
          };
          return fundedQuest;
        }),
      }));
      if (fundedQuest) {
        void upsertQuestToSupabase(fundedQuest, state.userProfile?.id);
      }
    },
    [state.userProfile?.id]
  );

  const resetDemoData = useCallback(async () => {
    await AsyncStorage.removeItem(STORAGE_KEY);
    setState((prev) => ({
      ...DEFAULT_STATE,
      userProfile: prev.userProfile,
    }));
    setSelectedQuestId(null);
    setPendingProof(null);
    setLastVerification(null);
    setLastCompletedStamp(null);
  }, []);

  const placesWithDistance = useMemo(() => {
    if (!userCoords) return places;
    return places.map((p) => {
      const km = haversineDistanceKm(userCoords, p.coordinates);
      return {
        ...p,
        distanceKm: Number(km.toFixed(2)),
        distance: formatDistance(km),
      };
    });
  }, [places, userCoords]);

  const questsWithDistance = useMemo(() => {
    if (!userCoords) return state.quests;
    return state.quests.map((q) => {
      const km = haversineDistanceKm(userCoords, q.coordinates);
      return {
        ...q,
        distanceKm: Number(km.toFixed(2)),
        distance: formatDistance(km),
      };
    });
  }, [state.quests, userCoords]);

  const visibleClaims = useMemo(
    () => (state.demoMode ? state.claims : state.claims.filter((c) => !isDemoClaimRecord(c))),
    [state.claims, state.demoMode]
  );

  const visibleSubmissions = useMemo(
    () =>
      state.demoMode
        ? state.submissions
        : state.submissions.filter(
            (s) => !String(s.id || '').startsWith('sub-demo') && !String(s.id || '').startsWith('sub-test')
          ),
    [state.submissions, state.demoMode]
  );

  const isDark = state.themeMode === 'dark';
  const palette = useMemo(() => getPalette(state.themeMode), [state.themeMode]);

  return (
    <RoamrContext.Provider
      value={{
        ...state,
        places: placesWithDistance,
        ownerQuests,
        ownerStats,
        serverUser,
        isSuperAdmin,
        refreshPlacesAndOwner,
        claims: visibleClaims,
        submissions: visibleSubmissions,
        walletBalanceUsd: centsToUsd(state.walletBalanceCents),
        isDark,
        palette,
        quests: questsWithDistance,
        hydrated,
        userCoords,
        locationStatus,
        refreshLocation,
        selectedQuestId,
        setSelectedQuestId,
        setLightPreset,
        setMapProjection,
        setEnable3D,
        setThemeMode,
        setShowInr,
        pendingProof,
        setPendingProof,
        pendingCheckinOrders,
        lastVerification,
        setLastVerification,
        lastCompletedStamp,
        signInWithGoogle,
        signInAsDemoUser,
        signOut,
        completeBusinessOnboarding,
        toggleBookmark,
        toggleDemoMode,
        setRole,
        setPaypalEmail,
        saveOnboarding,
        completeQuestAndPayout,
        submitQuestForHumanReview,
        reviewSubmission,
        refreshClaims,
        recordCheckinOrder,
        submitClaimProof,
        refreshPayoutStatus,
        retryPayout,
        addBusinessQuest,
        updateBusinessQuest,
        deleteBusinessQuest,
        markQuestFunded,
        resetDemoData,
      }}
    >
      {children}
    </RoamrContext.Provider>
  );
}

export function useRoamr() {
  const ctx = useContext(RoamrContext);
  if (!ctx) throw new Error('useRoamr must be used inside RoamrProvider');
  return ctx;
}
