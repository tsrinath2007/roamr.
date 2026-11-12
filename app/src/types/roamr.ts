export type QuestCategory =
  | 'Cafe'
  | 'Food'
  | 'History'
  | 'Nature'
  | 'Photo'
  | 'Nightlife'
  | 'Shop';

export type QuestDifficulty = 'Easy' | 'Medium' | 'Hard';

export type ProofType = 'photo' | 'receipt' | 'photo_or_receipt';

export type QuestType = 'purchase' | 'visit';

export type RewardMode = 'cashback' | 'xp_only';

export interface QuestRewardConfig {
  min_bill_inr?: number;
  cashback_percent?: number;
  max_reward_usd?: number;
  fixed_reward_usd?: number;
  xp_only?: boolean;
}

export interface QuestAiPrivateBrief {
  must_show: string[];
  reject_if: string[];
  bill_checks: string[];
  notes?: string;
}

export interface Place {
  id: string;
  name: string;
  address: string;
  lat: number | null;
  lng: number | null;
  coordinates: {
    latitude: number;
    longitude: number;
  };
  category?: string;
  photo_url?: string | null;
  city?: string;
  maps_link?: string | null;
  owner_id?: string | null;
  claim_status?: 'none' | 'pending' | 'approved' | string;
  claim_note?: string | null;
  quest_count: number;
  has_funded_quests: boolean;
  funded: boolean;
  max_reward_usd: number;
  max_xp: number;
  distanceKm?: number;
  distance?: string;
}

export interface AdminBusinessClaim extends Place {
  claimed_by?: string | null;
  claimant_email?: string | null;
  claimant_name?: string | null;
  claim_business_name?: string | null;
  claim_paypal_email?: string | null;
}

export interface ServerUser {
  id: string;
  email: string;
  name?: string;
  avatar?: string | null;
  role: 'traveler' | 'admin';
  paypal_email?: string | null;
  business_name?: string | null;
  xp: number;
  owned_places_count: number;
  is_owner: boolean;
  is_verified_business?: boolean;
  quest_lock_limit?: number | null;
  primary_place?: Place | null;
}

export interface OwnerStats {
  funded: number;
  spent: number;
  remaining: number;
  received?: number;
  received_from_travelers_usd?: number;
  paid_visits: number;
  quests_count: number;
  owned_places_count: number;
  is_owner: boolean;
  is_verified_business?: boolean;
  quest_lock_limit?: number | null;
  primary_place?: Place | null;
}

export interface Quest {
  id: string;
  place_id?: string;
  owner_id?: string | null;
  title: string;
  businessName: string;
  place_name?: string;
  category: QuestCategory | string;
  quest_type?: QuestType;
  distance: string;
  distanceKm?: number;
  xp: number;
  rewardUsd: number;
  rewardCents?: number;
  reward?: QuestRewardConfig;
  difficulty: QuestDifficulty | string;
  estTime: string;
  est_minutes?: number;
  fundedBy: string;
  funded_by?: string;
  description: string;
  public_description?: string;
  objective: string;
  public_objective?: string;
  text_answer_prompt?: string | null;
  proof_hint?: string;
  proofType: ProofType;
  image: string | null;
  photo_url?: string | null;
  maps_link?: string | null;
  lat?: number | null;
  lng?: number | null;
  radius_m?: number;
  night_only?: boolean;
  coordinates: {
    latitude: number;
    longitude: number;
  };
  mapPosition: {
    xPercent: number;
    yPercent: number;
  };
  city?: string;
  address?: string;
  aiInstructions?: string;
  aiReferenceImages?: string[];
  maxParticipants?: number;
  budgetUsd?: number;
  budget_usd?: number;
  budget_remaining_usd?: number;
  budgetCents?: number;
  spentUsd?: number;
  spentCents?: number;
  verifiedVisits?: number;
  funded?: boolean;
  reward_mode?: RewardMode;
  isRecommended?: boolean;
  merchantEmail?: string;
  minCheckinUsd?: number;
  paypalOrderId?: string;
  paypalCaptureId?: string;
  durationHours?: number;
  expiresAt?: string;
}

export type ClaimStatus =
  | 'submitted'
  | 'retake'
  | 'paid'
  | 'rejected'
  | 'pending_business'
  | 'pending_superhost';

export interface CheckinOrderReceipt {
  orderId: string;
  captureId: string;
  questId: string;
  status: string;
  amountUsd: number;
  billInr?: number;
  billPhotoUri?: string;
  billPhotoBase64?: string;
  payeeEmail: string;
  payerName?: string;
  payerEmail?: string;
  payerId?: string;
  simulated?: boolean;
  debugId?: string | null;
  recordedAt?: string;
}

export interface AiClaimVerdict {
  verdict: 'pass' | 'flag';
  confidence: number;
  reasons: string[];
  bill_total_read?: number | null;
  mode?: string;
}

export interface ClaimRecord {
  id: string;
  questId: string;
  questTitle: string;
  questType?: QuestType;
  rewardMode?: RewardMode;
  cashbackSoldOut?: boolean;
  businessName: string;
  billInr?: number;
  paidUsd?: number;
  rewardUsd: number;
  budgetRemainingUsd?: number;
  xp: number;
  travelerName: string;
  travelerEmail: string;
  travelerAvatar?: string | null;
  paypalEmail: string;
  photoUri?: string | null;
  textAnswer?: string;
  gps: {
    latitude: number | null;
    longitude: number | null;
    mocked?: boolean;
  };
  resolvedAddress?: string;
  distanceMeters: number | null;
  demoMode?: boolean;
  order?: CheckinOrderReceipt | null;
  hardChecks?: {
    hasPhoto: boolean;
    notMocked: boolean;
    distancePassed: boolean;
    distanceMeters: number | null;
    nightCheckPassed?: boolean;
    uniqueClaimPassed?: boolean;
    budgetPassed?: boolean;
    orderVerified: boolean;
    failures: string[];
  } | null;
  aiVerdict?: AiClaimVerdict | null;
  status: ClaimStatus;
  reviewNote?: string | null;
  payout?: PayoutRecord | null;
  webhookStatus?: string | null;
  webhookStatusCode?: number | null;
  ownerNotified?: boolean;
  businessEmail?: string;
  submittedAt: string;
  aiReviewedAt?: string | null;
  reviewedAt?: string | null;
  paidAt?: string | null;
}

export type SubmissionStatus = 'pending_review' | 'approved' | 'rejected';

export interface QuestSubmission {
  id: string;
  questId: string;
  questTitle: string;
  businessName: string;
  travelerName: string;
  travelerEmail: string;
  travelerAvatar?: string;
  paypalEmail: string;
  photoUri?: string;
  submittedAt: string;
  aiVerified: boolean;
  aiConfidence: number;
  aiReason: string;
  rewardUsd: number;
  rewardCents?: number;
  xp: number;
  status: SubmissionStatus;
  reviewedAt?: string;
  reviewNote?: string;
  payoutId?: string;
  payoutStatus?: string;
}

export interface EarnedStamp {
  id: string;
  questId: string;
  businessName: string;
  questTitle: string;
  category: string;
  xp: number;
  rewardUsd: number;
  rewardCents?: number;
  completedAt: string;
  photoUri?: string;
}

export interface PayoutRecord {
  id: string;
  questId: string;
  questTitle: string;
  amountUsd: number;
  amountCents?: number;
  status: string;
  simulated: boolean;
  debugId?: string | null;
  receiverEmail: string;
  createdAt: string;
  message?: string;
}

export interface VerificationResult {
  verified: boolean;
  confidence: number;
  reason: string;
  mode?: string;
  questId: string;
  photoUri?: string;
}

export type AppRole = 'traveler' | 'business';

export type MapProjectionMode = 'globe' | 'mercator';

export type InterestKey = 'food' | 'history' | 'nature' | 'photography' | 'nightlife';

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  phone?: string;
  gender?: string;
  travelStyle?: string;
  onboardingDone?: boolean;
  isDemo: boolean;
  isTraveler: boolean;
  isBusiness: boolean;
  businessName?: string;
  businessCategory?: string;
  businessAddress?: string;
  businessPaypalEmail?: string;
  businessLogo?: string;
}
