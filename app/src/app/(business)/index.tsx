import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useRoamr } from '../../context/RoamrContext';
import {
  approveBusinessClaimOnServer,
  fetchAdminClaimsFromServer,
  fetchBusinessInsight,
  fetchSuperhostEscalatedClaims,
  rejectBusinessClaimOnServer,
  releaseSuperhostCashback,
} from '../../services/api';
import { AdminBusinessClaim, ClaimRecord } from '../../types/roamr';
import { TopHeader } from '../../components/TopHeader';
import { Card } from '../../components/Card';
import { LiquidBackdrop } from '../../components/LiquidBackdrop';
import { Pill } from '../../components/Pill';
import { Button } from '../../components/Button';
import { ResponsiveContainer } from '../../components/ResponsiveContainer';
import { centsToUsd, formatMoney, usdToCents } from '../../../lib/currency';
import { colors, fonts, radii } from '../../theme/tokens';

export default function BusinessDashboardTab() {
  const {
    ownerQuests,
    ownerStats,
    serverUser,
    isSuperAdmin,
    refreshPlacesAndOwner,
    claims,
    userProfile,
    showInr,
    palette,
    isDark,
  } = useRoamr();
  const [adminClaims, setAdminClaims] = useState<AdminBusinessClaim[]>([]);
  const [escalatedClaims, setEscalatedClaims] = useState<ClaimRecord[]>([]);
  const [loadingClaims, setLoadingClaims] = useState(false);
  const [processingPlaceId, setProcessingPlaceId] = useState<string | null>(null);
  const [processingClaimId, setProcessingClaimId] = useState<string | null>(null);

  const loadAdminApprovals = useCallback(async () => {
    if (!isSuperAdmin) return;
    setLoadingClaims(true);
    try {
      const [claimsRes, escalatedRes] = await Promise.all([
        fetchAdminClaimsFromServer('all'),
        fetchSuperhostEscalatedClaims(),
      ]);
      setAdminClaims(claimsRes.claims || []);
      setEscalatedClaims(escalatedRes.claims || []);
    } catch {
      // ignore if offline
    } finally {
      setLoadingClaims(false);
    }
  }, [isSuperAdmin]);

  useFocusEffect(
    useCallback(() => {
      void refreshPlacesAndOwner();
      if (isSuperAdmin) void loadAdminApprovals();
    }, [refreshPlacesAndOwner, isSuperAdmin, loadAdminApprovals])
  );

  const handleApproveBusiness = async (claim: AdminBusinessClaim) => {
    setProcessingPlaceId(claim.id);
    try {
      await approveBusinessClaimOnServer(claim.id, 'Verified by Superadmin');
      await Promise.all([loadAdminApprovals(), refreshPlacesAndOwner()]);
      Alert.alert(
        'Business Verified',
        `${claim.claim_business_name || claim.name} is now verified and unlocked.`
      );
    } catch (err) {
      Alert.alert(
        'Approval failed',
        err instanceof Error ? err.message : 'Could not verify business.'
      );
    } finally {
      setProcessingPlaceId(null);
    }
  };

  const handleRejectBusiness = async (claim: AdminBusinessClaim, reason = 'Rejected by Superadmin') => {
    setProcessingPlaceId(claim.id);
    try {
      await rejectBusinessClaimOnServer(claim.id, reason);
      await Promise.all([loadAdminApprovals(), refreshPlacesAndOwner()]);
      if (claim.claim_status === 'approved') {
        Alert.alert(
          'Verification Removed',
          `${claim.claim_business_name || claim.name} is no longer verified.`
        );
      }
    } catch (err) {
      Alert.alert(
        'Action failed',
        err instanceof Error ? err.message : 'Could not update business.'
      );
    } finally {
      setProcessingPlaceId(null);
    }
  };

  const handleReleaseSuperhostCashback = async (claim: ClaimRecord) => {
    setProcessingClaimId(claim.id);
    try {
      await releaseSuperhostCashback(claim.id);
      await Promise.all([loadAdminApprovals(), refreshPlacesAndOwner()]);
      Alert.alert(
        'Cashback Sent',
        `Cashback released to ${claim.travelerName || 'traveler'} for ${claim.questTitle || 'quest'}.`
      );
    } catch (err) {
      Alert.alert(
        'Cashback failed',
        err instanceof Error ? err.message : 'Could not release cashback.'
      );
    } finally {
      setProcessingClaimId(null);
    }
  };
  const ownerQuestIds = useMemo(() => new Set(ownerQuests.map((q) => q.id)), [ownerQuests]);
  const paidClaims = useMemo(
    () => claims.filter((c) => c.status === 'paid' && ownerQuestIds.has(c.questId)),
    [claims, ownerQuestIds]
  );
  const latestPaidClaims = useMemo(() => paidClaims.slice(0, 10), [paidClaims]);

  const metrics = useMemo(() => {
    const claimsPaid = ownerStats?.paid_visits ?? paidClaims.length;
    const totalBudgetCents = usdToCents(ownerStats?.funded ?? 0);
    const spentCents = usdToCents(ownerStats?.spent ?? 0);
    const remainingBudgetCents =
      ownerStats?.remaining !== undefined
        ? usdToCents(ownerStats.remaining)
        : Math.max(0, totalBudgetCents - spentCents);
    const costPerVisitCents =
      claimsPaid > 0 ? Math.round(spentCents / claimsPaid) : 0;
    return {
      verifiedVisits: claimsPaid,
      claimsPaid,
      spentCents,
      remainingBudgetCents,
      costPerVisitCents,
      moneySpent: centsToUsd(spentCents),
      costPerVisit: centsToUsd(costPerVisitCents),
    };
  }, [ownerStats, paidClaims.length]);

  const [insight, setInsight] = useState<string>(
    'Analyzing quest conversion and foot-traffic ROI with Gemini AI...'
  );
  const [insightMode, setInsightMode] = useState<string>('loading');
  const [loadingInsight, setLoadingInsight] = useState(true);

  const loadInsight = async () => {
    setLoadingInsight(true);
    try {
      const res = await fetchBusinessInsight({
        verifiedVisits: metrics.verifiedVisits,
        moneySpent: metrics.moneySpent,
        costPerVisit: metrics.costPerVisit,
        quests: ownerQuests,
      });
      setInsight(res.insight);
      setInsightMode(res.mode);
    } catch {
      setInsight(
        `Your funded quests generated ${metrics.verifiedVisits} verified visits at ${formatMoney(
          metrics.costPerVisitCents,
          { showInr }
        )} per visit. Consider allocating 20% more budget to Easy café quests during afternoon hours.`
      );
      setInsightMode('offline');
    } finally {
      setLoadingInsight(false);
    }
  };

  useEffect(() => {
    loadInsight();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metrics.verifiedVisits, metrics.moneySpent]);

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.bgCream }]} edges={['top']}>
      <LiquidBackdrop variant="business" />
      <ResponsiveContainer maxWidth={860}>
        <TopHeader />

        <ScrollView contentContainerStyle={styles.scrollContent}>
          {/* Gold-accented Business Banner */}
          <Card
            style={[
              styles.bizHero,
              {
                backgroundColor: isDark ? '#1A241B' : '#FFFDF6',
                borderColor: isDark ? 'rgba(244, 185, 66, 0.35)' : 'rgba(223, 159, 32, 0.45)',
              },
            ]}
          >
            <View style={styles.bizRow}>
              {userProfile?.businessLogo ? (
                <Image
                  source={{ uri: userProfile.businessLogo }}
                  style={[styles.bizLogo, { backgroundColor: palette.bgSage }]}
                />
              ) : (
                <View style={[styles.bizLogoPlaceholder, { backgroundColor: palette.goldSoft }]}>
                  <Ionicons name={isSuperAdmin ? 'shield-checkmark' : 'storefront'} size={22} color={palette.goldText} />
                </View>
              )}
              <View style={styles.bizTextCol}>
                <View style={styles.bizTitleRow}>
                  <Text style={[styles.bizName, { color: palette.textPrimary }]} numberOfLines={1}>
                    {isSuperAdmin ? 'Superadmin Console' : userProfile?.businessName || 'Your Business'}
                  </Text>
                  <Pill
                    label={
                      isSuperAdmin
                        ? 'Superadmin'
                        : serverUser?.is_verified_business || (ownerStats?.owned_places_count ?? 0) > 0
                        ? 'Verified Host'
                        : 'Pending Verification'
                    }
                    variant={
                      isSuperAdmin
                        ? 'gold'
                        : serverUser?.is_verified_business || (ownerStats?.owned_places_count ?? 0) > 0
                        ? 'success'
                        : 'neutral'
                    }
                  />
                </View>
                <Text style={[styles.bizAddr, { color: palette.textSecondary }]} numberOfLines={1}>
                  {isSuperAdmin
                    ? userProfile?.email || 'tsrinath2020@gmail.com'
                    : ownerStats?.primary_place?.name
                    ? `${ownerStats.primary_place.name} • ${userProfile?.businessPaypalEmail || ''}`
                    : userProfile?.businessPaypalEmail || userProfile?.email || 'Global Quest Host'}
                </Text>
              </View>
            </View>
          </Card>

          {/* Superadmin Business Approval Queue */}
          {isSuperAdmin ? (
            <Card style={{ gap: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Ionicons name="shield-checkmark" size={18} color={palette.goldText} />
                  <Text style={[styles.bizName, { fontSize: 17, color: palette.textPrimary }]}>
                    Approve Business Info
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Pill
                    label={`${adminClaims.filter((c) => c.claim_status === 'pending').length} Pending`}
                    variant="gold"
                  />
                  <Pressable onPress={loadAdminApprovals} hitSlop={8}>
                    <Ionicons name="refresh" size={18} color={palette.primaryDark} />
                  </Pressable>
                </View>
              </View>

              {loadingClaims ? (
                <ActivityIndicator size="small" color={palette.primary} />
              ) : adminClaims.length === 0 ? (
                <Text style={[styles.insightBody, { color: palette.textSecondary }]}>
                  No business registrations awaiting approval yet.
                </Text>
              ) : (
                adminClaims.map((claim) => {
                  const busy = processingPlaceId === claim.id;
                  const statusVariant =
                    claim.claim_status === 'approved'
                      ? 'success'
                      : claim.claim_status === 'rejected'
                      ? 'danger'
                      : 'gold';
                  const statusLabel =
                    claim.claim_status === 'approved'
                      ? 'Verified'
                      : claim.claim_status === 'rejected'
                      ? 'Rejected'
                      : 'Pending';
                  return (
                    <View
                      key={claim.id}
                      style={{
                        borderTopWidth: StyleSheet.hairlineWidth,
                        borderTopColor: palette.border,
                        paddingTop: 10,
                        gap: 6,
                      }}
                    >
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                        <Text style={{ fontFamily: fonts.sansBold, fontSize: 14.5, color: palette.textPrimary, flex: 1 }}>
                          {claim.claim_business_name || claim.name}
                        </Text>
                        <Pill label={statusLabel} variant={statusVariant} />
                      </View>
                      <Text style={{ fontFamily: fonts.sans, fontSize: 12.5, color: palette.textSecondary }}>
                        Venue: {claim.name} ({claim.category || 'Venue'}) • {claim.address}
                      </Text>
                      <Text style={{ fontFamily: fonts.sans, fontSize: 12.5, color: palette.textSecondary }}>
                        PayPal: {claim.claim_paypal_email || '—'} • Account: {claim.claimant_email || claim.claimed_by || '—'}
                      </Text>
                      {claim.claim_note ? (
                        <Text style={{ fontFamily: fonts.sans, fontSize: 12, color: palette.textMuted }}>
                          Note: {claim.claim_note}
                        </Text>
                      ) : null}
                      {claim.claim_status !== 'approved' ? (
                        <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                          <Button
                            label={busy ? 'Saving...' : 'Approve & Verify'}
                            loading={busy}
                            onPress={() => handleApproveBusiness(claim)}
                            style={{ flex: 1, minHeight: 40 }}
                          />
                          {claim.claim_status === 'pending' ? (
                            <Button
                              label="Reject"
                              variant="outline"
                              disabled={busy}
                              onPress={() => handleRejectBusiness(claim)}
                              style={{ minHeight: 40 }}
                            />
                          ) : null}
                        </View>
                      ) : (
                        <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                          <Button
                            label={busy ? 'Removing...' : 'Remove Verification'}
                            variant="outline"
                            disabled={busy}
                            onPress={() =>
                              handleRejectBusiness(claim, 'Verification removed by Superhost')
                            }
                            style={{ flex: 1, minHeight: 40 }}
                          />
                        </View>
                      )}
                    </View>
                  );
                })
              )}
            </Card>
          ) : null}

          {isSuperAdmin ? (
            <Card style={{ gap: 10, borderColor: palette.primary, borderWidth: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                  <Ionicons name="cash-outline" size={18} color={palette.primary} />
                  <Text style={[styles.bizName, { fontSize: 17, color: palette.textPrimary }]}>
                    Cashback Verifications (Owner Audits)
                  </Text>
                </View>
                <Pill label={`${escalatedClaims.length} pending`} variant="gold" />
              </View>
              <Text style={{ fontFamily: fonts.sans, fontSize: 12.5, color: palette.textSecondary }}>
                Visits flagged by business owners as genuine despite low AI confidence. Approve to release PayPal cashback.
              </Text>
              {escalatedClaims.length === 0 ? (
                <Text style={{ fontFamily: fonts.sans, fontSize: 13, color: palette.textMuted }}>
                  No owner-escalated visits awaiting cashback.
                </Text>
              ) : (
                escalatedClaims.map((claim) => {
                  const busy = processingClaimId === claim.id;
                  return (
                    <View
                      key={claim.id}
                      style={{
                        borderTopWidth: 1,
                        borderTopColor: palette.border,
                        paddingTop: 12,
                        marginTop: 6,
                        gap: 6,
                      }}
                    >
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                        <Text style={{ fontFamily: fonts.sansSemi, fontSize: 15, color: palette.textPrimary, flex: 1 }}>
                          {claim.travelerName || 'Traveler'} • {claim.questTitle || 'Quest'}
                        </Text>
                        <Pill label={`$${Number(claim.rewardUsd || 0).toFixed(2)}`} variant="gold" />
                      </View>
                      {claim.aiVerdict ? (
                        <Text style={{ fontFamily: fonts.sans, fontSize: 12.5, color: palette.textSecondary }}>
                          AI score: {Math.round((claim.aiVerdict.confidence || 0) * 100)}% ({claim.aiVerdict.verdict})
                        </Text>
                      ) : null}
                      {claim.reviewNote ? (
                        <Text style={{ fontFamily: fonts.sans, fontSize: 12, color: palette.textMuted }}>
                          {claim.reviewNote}
                        </Text>
                      ) : null}
                      <Button
                        label={busy ? 'Sending...' : 'Approve & Send Cashback'}
                        loading={busy}
                        onPress={() => handleReleaseSuperhostCashback(claim)}
                        style={{ minHeight: 40, marginTop: 4 }}
                      />
                    </View>
                  );
                })
              )}
            </Card>
          ) : null}

          {/* 4 Required KPI Cards */}
          <View style={styles.kpiRow}>
            <Card style={styles.kpiCard}>
              <Text style={[styles.kpiLabel, { color: palette.textSecondary }]}>Claims Paid</Text>
              <Text style={[styles.kpiValue, { color: palette.primaryDark }]}>
                {metrics.claimsPaid}
              </Text>
            </Card>
            <Card style={styles.kpiCard}>
              <Text style={[styles.kpiLabel, { color: palette.textSecondary }]}>
                Received from travelers
              </Text>
              <Text
                style={[styles.kpiValue, { color: palette.primaryDark }]}
                numberOfLines={1}
                adjustsFontSizeToFit
              >
                {`Received from travelers: $${Number(ownerStats?.received ?? ownerStats?.received_from_travelers_usd ?? 0).toFixed(2)}`}
              </Text>
            </Card>
          </View>
          <View style={styles.kpiRow}>
            <Card style={styles.kpiCard}>
              <Text style={[styles.kpiLabel, { color: palette.textSecondary }]}>Remaining Budget</Text>
              <Text
                style={[styles.kpiValue, { color: palette.primaryDark }]}
                numberOfLines={1}
                adjustsFontSizeToFit
              >
                {formatMoney(metrics.remainingBudgetCents, { showInr })}
              </Text>
            </Card>
            <Card style={styles.kpiCard}>
              <Text style={[styles.kpiLabel, { color: palette.textSecondary }]}>Cost / Visit</Text>
              <Text
                style={[styles.kpiValue, { color: palette.primaryDark }]}
                numberOfLines={1}
                adjustsFontSizeToFit
              >
                {formatMoney(metrics.costPerVisitCents, { showInr })}
              </Text>
            </Card>
          </View>

          {/* AI Weekly Insight */}
          <Card
            style={[
              styles.insightCard,
              {
                backgroundColor: palette.goldSoft,
                borderColor: isDark ? 'rgba(244, 185, 66, 0.35)' : 'rgba(223, 159, 32, 0.4)',
              },
            ]}
          >
            <View style={styles.insightTop}>
              <View style={styles.insightBadge}>
                <Ionicons name="sparkles" size={14} color={palette.goldText} />
                <Text style={[styles.insightBadgeText, { color: palette.goldText }]}>
                  Gemini Weekly Insight
                </Text>
              </View>
              <Pressable onPress={loadInsight} hitSlop={8}>
                <Ionicons name="refresh" size={16} color={palette.goldText} />
              </Pressable>
            </View>

            {loadingInsight ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator size="small" color={palette.primary} />
                <Text style={[styles.insightBody, { color: palette.textPrimary }]}>
                  Generating two-sentence advice...
                </Text>
              </View>
            ) : (
              <Text style={[styles.insightBody, { color: palette.textPrimary }]}>{insight}</Text>
            )}
            <Text style={[styles.modeNote, { color: palette.textMuted }]}>
              Source:{' '}
              {insightMode === 'groq'
                ? 'Live Groq AI'
                : insightMode === 'gemini'
                ? 'Live Gemini API'
                : 'Simulated AI fallback'}
            </Text>
          </Card>

          <Button
            label={
              paidClaims.length > 0
                ? `AI Claims Audit (${paidClaims.length} Paid)`
                : 'AI Claims Audit'
            }
            variant="secondary"
            icon={<Ionicons name="shield-checkmark-outline" size={19} color={palette.primaryDark} />}
            onPress={() => router.push('/(business)/review')}
          />

          <Button
            label="Create & Fund New Quest"
            icon={<Ionicons name="add-circle-outline" size={20} color={palette.white} />}
            onPress={() => router.push('/business/create')}
          />

          {/* Latest 10 Paid Claims with AI Reasons (Read-Only) */}
          <Card style={{ gap: 10 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={[styles.bizName, { fontSize: 18, color: palette.textPrimary }]}>
                Latest Paid Claims (Read-Only)
              </Text>
              <Pill label={`${latestPaidClaims.length} / 10`} variant="sage" />
            </View>
            {latestPaidClaims.length === 0 ? (
              <Text style={[styles.insightBody, { color: palette.textSecondary }]}>
                No auto-paid claims recorded yet. Once travelers complete check-ins and AI verifies them, their payouts and AI reasons appear here.
              </Text>
            ) : (
              latestPaidClaims.map((claim) => (
                <View
                  key={claim.id}
                  style={{
                    borderTopWidth: StyleSheet.hairlineWidth,
                    borderTopColor: palette.border,
                    paddingTop: 10,
                    gap: 4,
                  }}
                >
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <Text style={{ fontFamily: fonts.sansSemi, fontSize: 13.5, color: palette.textPrimary, flex: 1 }} numberOfLines={1}>
                      {claim.travelerName} • {claim.questTitle}
                    </Text>
                    <Text style={{ fontFamily: fonts.sansBold, fontSize: 13, color: palette.primaryDark }}>
                      {formatMoney(usdToCents(claim.rewardUsd), { showInr })}
                    </Text>
                  </View>
                  {claim.billInr ? (
                    <Text style={{ fontFamily: fonts.sans, fontSize: 12, color: palette.textSecondary }}>
                      Bill: ₹{claim.billInr} (${Number(claim.paidUsd || claim.order?.amountUsd || 0).toFixed(2)})
                    </Text>
                  ) : null}
                  {claim.aiVerdict?.reasons?.map((r, idx) => (
                    <Text
                      key={`${claim.id}-reason-${idx}`}
                      style={{ fontFamily: fonts.sans, fontSize: 12, color: palette.textSecondary }}
                    >
                      • {r}
                    </Text>
                  ))}
                </View>
              ))
            )}
          </Card>
        </ScrollView>
      </ResponsiveContainer>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.bgCream,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 104,
    gap: 14,
  },
  bizHero: {
    backgroundColor: '#FFFDF6',
    borderColor: 'rgba(223, 159, 32, 0.45)',
  },
  bizRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  bizLogo: {
    width: 50,
    height: 50,
    borderRadius: radii.md,
    backgroundColor: colors.bgSage,
  },
  bizLogoPlaceholder: {
    width: 50,
    height: 50,
    borderRadius: radii.md,
    backgroundColor: colors.goldSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bizTextCol: {
    flex: 1,
    gap: 3,
  },
  bizTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  bizName: {
    flex: 1,
    fontFamily: fonts.serif,
    fontSize: 20,
    color: colors.textPrimary,
  },
  bizAddr: {
    fontFamily: fonts.sans,
    fontSize: 12.5,
    color: colors.textSecondary,
  },
  kpiRow: {
    flexDirection: 'row',
    gap: 10,
  },
  kpiCard: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: 10,
    alignItems: 'center',
    borderColor: 'rgba(223, 159, 32, 0.35)',
  },
  kpiLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 11.5,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  kpiValue: {
    fontFamily: fonts.serif,
    fontSize: 24,
    color: colors.primaryDark,
    marginTop: 4,
  },
  insightCard: {
    backgroundColor: colors.goldSoft,
    borderColor: 'rgba(223, 159, 32, 0.4)',
    gap: 8,
  },
  insightTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  insightBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  insightBadgeText: {
    fontFamily: fonts.sansSemi,
    fontSize: 12.5,
    color: colors.goldText,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  insightBody: {
    fontFamily: fonts.sans,
    fontSize: 13.5,
    lineHeight: 20,
    color: colors.textPrimary,
  },
  modeNote: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.textMuted,
  },
});
