import React, { useCallback, useState } from 'react';
import {
  Alert,
  Image,
  Modal,
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
import { formatRemainingTime } from '../../utils/time';
import { formatMoney, usdToCents } from '../../../lib/currency';
import { TopHeader } from '../../components/TopHeader';
import { LiquidBackdrop } from '../../components/LiquidBackdrop';
import { Card } from '../../components/Card';
import { Pill } from '../../components/Pill';
import { PayPalLogo } from '../../components/PayPalLogo';
import { Button } from '../../components/Button';
import { ResponsiveContainer } from '../../components/ResponsiveContainer';
import { colors, fonts, radii } from '../../theme/tokens';

export default function BusinessQuestsTab() {
  const {
    ownerQuests,
    ownerStats,
    serverUser,
    isSuperAdmin,
    claims,
    pendingCheckinOrders,
    submissions,
    showInr,
    refreshClaims,
    refreshPlacesAndOwner,
    deleteBusinessQuest,
    palette,
  } = useRoamr();
  const isVerifiedBusiness = Boolean(
    isSuperAdmin ||
      serverUser?.is_verified_business ||
      ownerStats?.is_verified_business ||
      (serverUser?.owned_places_count ?? 0) > 0
  );
  const isUnverifiedLocked = Boolean(!isSuperAdmin && !isVerifiedBusiness && ownerQuests.length >= 1);
  const [expandedQuestId, setExpandedQuestId] = useState<string | null>(null);
  const [previewPhoto, setPreviewPhoto] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      void refreshClaims();
      void refreshPlacesAndOwner();
    }, [refreshClaims, refreshPlacesAndOwner])
  );

  const ownerQuestIds = new Set(ownerQuests.map((q) => q.id));
  const paidClaimsTotal = claims.filter(
    (c) => c.status === 'paid' && ownerQuestIds.has(c.questId)
  ).length;

  const handleDeleteQuest = (questId: string, title: string) => {
    Alert.alert(
      'Delete Quest',
      `Remove "${title}" from live traveler quests?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void deleteBusinessQuest(questId);
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.bgCream }]} edges={['top']}>
      <LiquidBackdrop variant="business" />
      <ResponsiveContainer maxWidth={860}>
        <TopHeader />
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={styles.headerRow}>
            <View style={styles.headerTextCol}>
              <Text style={[styles.heading, { color: palette.textPrimary }]}>Your Quests</Text>
              <Text style={[styles.subheading, { color: palette.textSecondary }]}>
                Track visitor photos, PayPal bills paid, escrow funding status, and AI-verified payouts.
              </Text>
            </View>
            {paidClaimsTotal > 0 ? (
              <Pill label={`${paidClaimsTotal} Verified Visits`} variant="success" />
            ) : null}
          </View>

          {isUnverifiedLocked ? (
            <Card style={{ backgroundColor: palette.goldSoft, borderColor: palette.gold, gap: 6 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Ionicons name="lock-closed" size={16} color={palette.goldText} />
                <Text style={{ fontFamily: fonts.sansBold, fontSize: 14, color: palette.goldText }}>
                  Unverified Business Lock (1 / 1 Quest Used)
                </Text>
              </View>
              <Text style={{ fontFamily: fonts.sans, fontSize: 12.5, color: palette.textPrimary }}>
                You can keep only 1 quest until Superadmin approves your business info. Edit your quest anytime, or wait for verification to add more.
              </Text>
            </Card>
          ) : null}

          <Button
            label={isUnverifiedLocked ? 'Locked (Max 1 Quest Until Verified)' : 'Create New Quest'}
            disabled={isUnverifiedLocked}
            icon={<Ionicons name={isUnverifiedLocked ? 'lock-closed-outline' : 'add-circle-outline'} size={20} color={palette.white} />}
            onPress={() => router.push('/business/create')}
          />

          <View style={styles.list}>
            {ownerQuests.length === 0 ? (
              <Card style={styles.questCard}>
                <Text style={[styles.title, { color: palette.textPrimary }]}>
                  No quests owned yet
                </Text>
                <Text style={[styles.meta, { color: palette.textSecondary }]}>
                  Only quests belonging to places approved for your business account appear here.
                </Text>
              </Card>
            ) : null}
            {ownerQuests.map((q) => {
              const budgetCents = q.budgetCents ?? usdToCents(q.budgetUsd ?? 100);
              const spentCents = q.spentCents ?? usdToCents(q.spentUsd ?? 0);
              const rewardCents = q.rewardCents ?? usdToCents(q.rewardUsd);
              const pct = Math.min(100, Math.round((spentCents / Math.max(1, budgetCents)) * 100));
              const timerInfo = formatRemainingTime(q.expiresAt);
              const questSubs = submissions.filter((s) => s.questId === q.id);
              const questClaims = claims.filter((c) => c.questId === q.id);
              const questPendingOrders = pendingCheckinOrders.filter(
                (o) =>
                  o.questId === q.id &&
                  !questClaims.some((c) => c.order?.orderId === o.orderId)
              );
              const visitorsTotal =
                questClaims.length + questPendingOrders.length + questSubs.length;
              const isExpanded = expandedQuestId === q.id;

              return (
                <Card key={q.id} style={styles.questCard}>
                  <View style={styles.topRow}>
                    <View style={styles.info}>
                      <Text style={[styles.title, { color: palette.textPrimary }]} numberOfLines={1}>
                        {q.title}
                      </Text>
                      <Text style={[styles.meta, { color: palette.textSecondary }]}>
                        {q.city || 'Local'} • {q.funded ? formatMoney(rewardCents, { showInr }) : `${q.xp} XP only`} •{' '}
                        {q.verifiedVisits || 0} paid visits
                      </Text>
                    </View>

                    <View style={styles.topRightActions}>
                      <Pill
                        label={q.funded ? 'Funded' : 'XP Only'}
                        variant={q.funded ? 'success' : 'sage'}
                      />
                      <Pressable
                        onPress={() =>
                          router.push({
                            pathname: '/business/create',
                            params: { editId: q.id },
                          })
                        }
                        style={[styles.deleteBtn, { backgroundColor: palette.primarySoft }]}
                        hitSlop={8}
                        accessibilityLabel={`Edit ${q.title}`}
                      >
                        <Ionicons name="pencil-outline" size={16} color={palette.primaryDark} />
                      </Pressable>
                      <Pressable
                        onPress={() => handleDeleteQuest(q.id, q.title)}
                        style={[styles.deleteBtn, { backgroundColor: palette.dangerSoft }]}
                        hitSlop={8}
                        accessibilityLabel={`Delete ${q.title}`}
                      >
                        <Ionicons name="trash-outline" size={16} color={palette.danger} />
                      </Pressable>
                    </View>
                  </View>

                  {timerInfo ? (
                    <View style={styles.timerRow}>
                      <Pill
                        label={timerInfo.label}
                        variant={timerInfo.expired ? 'danger' : 'paypal'}
                        icon={
                          <Ionicons
                            name="time-outline"
                            size={12}
                            color={timerInfo.expired ? palette.danger : palette.paypalBlue}
                          />
                        }
                      />
                    </View>
                  ) : null}

                  <View style={[styles.progressTrack, { backgroundColor: palette.bgSage }]}>
                    <View
                      style={[
                        styles.progressFill,
                        { width: `${pct}%`, backgroundColor: palette.goldText },
                      ]}
                    />
                  </View>

                  <View style={styles.footerRow}>
                    <Text style={[styles.budgetText, { color: palette.textMuted }]}>
                      {formatMoney(spentCents, { showInr })} / {formatMoney(budgetCents, { showInr })} spent
                    </Text>

                    <View style={styles.footerActions}>
                      <Pressable
                        onPress={() =>
                          setExpandedQuestId(isExpanded ? null : q.id)
                        }
                        style={[styles.insightsBtn, { backgroundColor: palette.bgSage }]}
                      >
                        <Ionicons
                          name="people-outline"
                          size={14}
                          color={palette.primaryDark}
                        />
                        <Text style={[styles.insightsLink, { color: palette.primaryDark }]}>
                          Visitors ({visitorsTotal})
                        </Text>
                        <Ionicons
                          name={isExpanded ? 'chevron-up' : 'chevron-down'}
                          size={13}
                          color={palette.primaryDark}
                        />
                      </Pressable>

                      {q.funded ? (
                        <View
                          style={[
                            styles.insightsBtn,
                            { backgroundColor: palette.successSoft },
                          ]}
                        >
                          <Ionicons name="checkmark-circle" size={14} color={palette.success} />
                          <Text style={[styles.insightsLink, { color: palette.success }]}>
                            Funded
                          </Text>
                        </View>
                      ) : q.quest_type === 'purchase' || Number(q.budget_usd ?? q.budgetUsd ?? 0) > 0 ? (
                        <Pressable
                          onPress={() =>
                            router.push({
                              pathname: '/business/fund',
                              params: { id: q.id },
                            })
                          }
                        >
                          <Text style={[styles.fundLink, { color: palette.paypalBlue }]}>
                            Fund →
                          </Text>
                        </Pressable>
                      ) : (
                        <View
                          style={[
                            styles.insightsBtn,
                            { backgroundColor: palette.bgSoft },
                          ]}
                        >
                          <Text style={[styles.insightsLink, { color: palette.textMuted }]}>
                            XP Only
                          </Text>
                        </View>
                      )}
                    </View>
                  </View>

                  {/* Expandable Visitor Check-Ins, Photos & Bill Amounts */}
                  {isExpanded ? (
                    <View style={[styles.submissionsBox, { borderTopColor: palette.border }]}>
                      {visitorsTotal === 0 ? (
                        <Text style={[styles.emptySubsText, { color: palette.textMuted }]}>
                          No visitor check-ins yet. When travelers pay their bill or capture live photo proof, their status appears here.
                        </Text>
                      ) : (
                        <>
                          {questPendingOrders.map((order) => (
                            <View
                              key={order.orderId}
                              style={[
                                styles.subCard,
                                {
                                  backgroundColor: palette.paypalSoft,
                                  borderColor: palette.paypalBlue,
                                },
                              ]}
                            >
                              <View style={styles.subHeader}>
                                <View style={styles.travelerRow}>
                                  <View
                                    style={[
                                      styles.travelerAvatarFallback,
                                      { backgroundColor: palette.bgCard },
                                    ]}
                                  >
                                    <PayPalLogo size={14} variant="badge" />
                                  </View>
                                  <View style={styles.travelerInfo}>
                                    <Text
                                      style={[styles.travelerName, { color: palette.textPrimary }]}
                                      numberOfLines={1}
                                    >
                                      {order.payerName || order.payerEmail || 'Traveler'}
                                    </Text>
                                    <Text
                                      style={[styles.travelerMeta, { color: palette.textSecondary }]}
                                      numberOfLines={1}
                                    >
                                      {order.recordedAt
                                        ? new Date(order.recordedAt).toLocaleString('en-US', {
                                            month: 'short',
                                            day: 'numeric',
                                            hour: 'numeric',
                                            minute: '2-digit',
                                          })
                                        : 'Just now'}
                                    </Text>
                                  </View>
                                </View>

                                <Pill label="Payment Done • Waiting for AI" variant="paypal" />
                              </View>

                              <Text style={[styles.travelerName, { color: palette.paypalBlue, fontSize: 12.5 }]}>
                                Paid Bill: {formatMoney(usdToCents(order.amountUsd), { showInr })}
                                {order.billInr ? ` (₹${order.billInr})` : ''} • Order #{order.orderId.slice(-8)}
                              </Text>
                              <Text style={[styles.aiReasonText, { color: palette.textSecondary }]}>
                                PayPal payment done — waiting for traveler camera proof & AI analysis.
                              </Text>
                            </View>
                          ))}

                          {questClaims.map((claim) => {
                            const paidBillCents = usdToCents(claim.order?.amountUsd || 0);
                            const claimRewardCents = usdToCents(claim.rewardUsd);
                            return (
                              <View
                                key={claim.id}
                                style={[
                                  styles.subCard,
                                  { backgroundColor: palette.bgSoft, borderColor: palette.border },
                                ]}
                              >
                                <View style={styles.subHeader}>
                                  <View style={styles.travelerRow}>
                                    {claim.travelerAvatar ? (
                                      <Image
                                        source={{ uri: claim.travelerAvatar }}
                                        style={styles.travelerAvatar}
                                      />
                                    ) : (
                                      <View
                                        style={[
                                          styles.travelerAvatarFallback,
                                          { backgroundColor: palette.primarySoft },
                                        ]}
                                      >
                                        <Ionicons
                                          name="person"
                                          size={14}
                                          color={palette.primaryDark}
                                        />
                                      </View>
                                    )}
                                    <View style={styles.travelerInfo}>
                                      <Text
                                        style={[styles.travelerName, { color: palette.textPrimary }]}
                                        numberOfLines={1}
                                      >
                                        {claim.travelerName}
                                      </Text>
                                      <Text
                                        style={[styles.travelerMeta, { color: palette.textMuted }]}
                                        numberOfLines={1}
                                      >
                                        {new Date(claim.submittedAt).toLocaleString('en-US', {
                                          month: 'short',
                                          day: 'numeric',
                                          hour: 'numeric',
                                          minute: '2-digit',
                                        })}
                                        {typeof claim.distanceMeters === 'number'
                                          ? ` • ${claim.distanceMeters} m away`
                                          : ''}
                                      </Text>
                                    </View>
                                  </View>

                                  <Pill
                                    label={
                                      claim.status === 'paid'
                                        ? claim.rewardMode === 'xp_only'
                                          ? 'XP Awarded'
                                          : 'Paid'
                                        : claim.status === 'submitted'
                                        ? 'Payment Done • AI Analyzing'
                                        : claim.status === 'retake'
                                        ? 'Retake'
                                        : claim.status === 'rejected'
                                        ? 'Rejected'
                                        : claim.status
                                    }
                                    variant={
                                      claim.status === 'paid'
                                        ? 'success'
                                        : claim.status === 'rejected'
                                        ? 'danger'
                                        : claim.status === 'submitted'
                                        ? 'paypal'
                                        : 'gold'
                                    }
                                  />
                                </View>

                                <View style={styles.subBodyRow}>
                                  {claim.photoUri ? (
                                    <Pressable
                                      onPress={() => setPreviewPhoto(claim.photoUri || null)}
                                    >
                                      <Image
                                        source={{ uri: claim.photoUri }}
                                        style={[styles.proofThumb, { backgroundColor: palette.bgSage }]}
                                      />
                                    </Pressable>
                                  ) : (
                                    <View
                                      style={[
                                        styles.proofThumbEmpty,
                                        { backgroundColor: palette.bgSage },
                                      ]}
                                    >
                                      <Ionicons
                                        name="image-outline"
                                        size={20}
                                        color={palette.textMuted}
                                      />
                                    </View>
                                  )}

                                  <View style={styles.aiVerdictCol}>
                                    <View
                                      style={{
                                        flexDirection: 'row',
                                        alignItems: 'center',
                                        gap: 6,
                                      }}
                                    >
                                      <PayPalLogo size={13} variant="badge" />
                                      <Text
                                        style={[
                                          styles.travelerName,
                                          { color: palette.paypalBlue, fontSize: 12.5 },
                                        ]}
                                      >
                                        Paid Bill: {formatMoney(paidBillCents, { showInr })}
                                      </Text>
                                    </View>
                                    <Text
                                      style={[styles.travelerMeta, { color: palette.primaryDark }]}
                                    >
                                      Reward Released: {formatMoney(claimRewardCents, { showInr })}
                                      {claim.order?.orderId ? ` • #${claim.order.orderId.slice(-8)}` : ''}
                                    </Text>
                                    {claim.aiVerdict?.reasons?.[0] ? (
                                      <Text
                                        style={[
                                          styles.aiReasonText,
                                          { color: palette.textSecondary },
                                        ]}
                                        numberOfLines={2}
                                      >
                                        AI: {claim.aiVerdict.reasons[0]}
                                      </Text>
                                    ) : null}
                                  </View>
                                </View>
                              </View>
                            );
                          })}
                          {questSubs.map((sub) => (
                          <View
                            key={sub.id}
                            style={[
                              styles.subCard,
                              { backgroundColor: palette.bgSoft, borderColor: palette.border },
                            ]}
                          >
                            <View style={styles.subHeader}>
                              <View style={styles.travelerRow}>
                                {sub.travelerAvatar ? (
                                  <Image
                                    source={{ uri: sub.travelerAvatar }}
                                    style={styles.travelerAvatar}
                                  />
                                ) : (
                                  <View
                                    style={[
                                      styles.travelerAvatarFallback,
                                      { backgroundColor: palette.primarySoft },
                                    ]}
                                  >
                                    <Ionicons name="person" size={14} color={palette.primaryDark} />
                                  </View>
                                )}
                                <View style={styles.travelerInfo}>
                                  <Text
                                    style={[styles.travelerName, { color: palette.textPrimary }]}
                                    numberOfLines={1}
                                  >
                                    {sub.travelerName}
                                  </Text>
                                  <Text
                                    style={[styles.travelerMeta, { color: palette.textMuted }]}
                                    numberOfLines={1}
                                  >
                                    {new Date(sub.submittedAt).toLocaleString('en-US', {
                                      month: 'short',
                                      day: 'numeric',
                                      hour: 'numeric',
                                      minute: '2-digit',
                                    })}
                                  </Text>
                                </View>
                              </View>

                              <Pill
                                label={
                                  sub.status === 'approved'
                                    ? 'Paid'
                                    : sub.status === 'rejected'
                                    ? 'Rejected'
                                    : 'Human Review'
                                }
                                variant={
                                  sub.status === 'approved'
                                    ? 'success'
                                    : sub.status === 'rejected'
                                    ? 'danger'
                                    : 'gold'
                                }
                              />
                            </View>

                            <View style={styles.subBodyRow}>
                              {sub.photoUri ? (
                                <Pressable onPress={() => setPreviewPhoto(sub.photoUri || null)}>
                                  <Image
                                    source={{ uri: sub.photoUri }}
                                    style={[styles.proofThumb, { backgroundColor: palette.bgSage }]}
                                  />
                                </Pressable>
                              ) : (
                                <View
                                  style={[styles.proofThumbEmpty, { backgroundColor: palette.bgSage }]}
                                >
                                  <Ionicons name="image-outline" size={20} color={palette.textMuted} />
                                </View>
                              )}

                            <View style={styles.aiVerdictCol}>
                              <Pill
                                label={`AI ${sub.aiVerified ? 'Passed' : 'Flagged'} • ${Math.round(
                                  sub.aiConfidence * 100
                                )}%`}
                                variant={sub.aiVerified ? 'sage' : 'danger'}
                              />
                              <Text
                                style={[styles.aiReasonText, { color: palette.textSecondary }]}
                                numberOfLines={3}
                              >
                                {sub.aiReason}
                              </Text>
                            </View>
                          </View>
                        </View>
                      ))}
                        </>
                      )}
                    </View>
                  ) : null}
                </Card>
              );
            })}
          </View>
        </ScrollView>
      </ResponsiveContainer>

      {/* Fullscreen Proof Photo Preview Modal */}
      <Modal
        visible={Boolean(previewPhoto)}
        transparent
        animationType="fade"
        onRequestClose={() => setPreviewPhoto(null)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setPreviewPhoto(null)}>
          {previewPhoto ? (
            <Image source={{ uri: previewPhoto }} style={styles.modalImage} resizeMode="contain" />
          ) : null}
          <Pressable style={styles.modalClosePill} onPress={() => setPreviewPhoto(null)}>
            <Ionicons name="close" size={20} color={colors.white} />
            <Text style={styles.modalCloseText}>Close Photo</Text>
          </Pressable>
        </Pressable>
      </Modal>
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
  headerRow: {
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
  },
  headerTextCol: {
    flex: 1,
  },
  heading: {
    fontFamily: fonts.serif,
    fontSize: 28,
    color: colors.textPrimary,
  },
  subheading: {
    fontFamily: fonts.sans,
    fontSize: 13.5,
    color: colors.textSecondary,
    marginTop: 2,
  },
  list: {
    gap: 10,
  },
  questCard: {
    gap: 10,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
  },
  info: {
    flex: 1,
  },
  topRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  deleteBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.dangerSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  title: {
    fontFamily: fonts.sansSemi,
    fontSize: 15.5,
    color: colors.textPrimary,
  },
  meta: {
    fontFamily: fonts.sans,
    fontSize: 12.5,
    color: colors.textSecondary,
    marginTop: 2,
  },
  progressTrack: {
    height: 6,
    backgroundColor: colors.bgSage,
    borderRadius: radii.pill,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.goldText,
    borderRadius: radii.pill,
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  footerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  insightsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.bgSage,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radii.pill,
  },
  insightsLink: {
    fontFamily: fonts.sansSemi,
    fontSize: 12,
    color: colors.primaryDark,
  },
  budgetText: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.textMuted,
  },
  fundLink: {
    fontFamily: fonts.sansSemi,
    fontSize: 12.5,
    color: colors.paypalBlue,
  },
  submissionsBox: {
    marginTop: 6,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: 10,
  },
  emptySubsText: {
    fontFamily: fonts.sans,
    fontSize: 12.5,
    lineHeight: 18,
    color: colors.textMuted,
  },
  subCard: {
    backgroundColor: colors.bgCream,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    gap: 10,
  },
  subHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  travelerRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  travelerAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
  },
  travelerAvatarFallback: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  travelerInfo: {
    flex: 1,
  },
  travelerName: {
    fontFamily: fonts.sansSemi,
    fontSize: 13.5,
    color: colors.textPrimary,
  },
  travelerMeta: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.textMuted,
  },
  subBodyRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  proofThumb: {
    width: 68,
    height: 68,
    borderRadius: radii.sm,
    backgroundColor: colors.bgSage,
  },
  proofThumbEmpty: {
    width: 68,
    height: 68,
    borderRadius: radii.sm,
    backgroundColor: colors.bgSage,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiVerdictCol: {
    flex: 1,
    gap: 4,
    alignItems: 'flex-start',
  },
  aiReasonText: {
    fontFamily: fonts.sans,
    fontSize: 12,
    lineHeight: 17,
    color: colors.textSecondary,
  },
  reviewBtnsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  approveBtn: {
    flex: 1,
    height: 40,
  },
  rejectBtn: {
    height: 40,
    paddingHorizontal: 14,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: 'rgba(184, 56, 45, 0.35)',
    backgroundColor: colors.dangerSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rejectBtnText: {
    fontFamily: fonts.sansSemi,
    fontSize: 12.5,
    color: colors.danger,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(10, 18, 14, 0.9)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    gap: 18,
  },
  modalImage: {
    width: '100%',
    height: '70%',
    borderRadius: radii.lg,
  },
  modalClosePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: radii.pill,
  },
  modalCloseText: {
    fontFamily: fonts.sansSemi,
    fontSize: 14,
    color: colors.white,
  },
});
