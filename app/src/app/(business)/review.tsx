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
import { useFocusEffect } from 'expo-router';
import { useRoamr } from '../../context/RoamrContext';
import { escalateClaimToSuperhost, fetchOwnerAuditsFromServer } from '../../services/api';
import { ClaimRecord } from '../../types/roamr';
import { formatMoney, usdToCents } from '../../../lib/currency';
import { TopHeader } from '../../components/TopHeader';
import { LiquidBackdrop } from '../../components/LiquidBackdrop';
import { Card } from '../../components/Card';
import { Pill } from '../../components/Pill';
import { PayPalLogo } from '../../components/PayPalLogo';
import { Button } from '../../components/Button';
import { ResponsiveContainer } from '../../components/ResponsiveContainer';
import { colors, fonts, radii } from '../../theme/tokens';

function getMapboxStaticPinUrl(claim: ClaimRecord, questCoords?: { latitude: number; longitude: number }): string | null {
  const token = (process.env.EXPO_PUBLIC_MAPBOX_TOKEN || '').trim();
  const lat = claim.gps?.latitude ?? questCoords?.latitude;
  const lng = claim.gps?.longitude ?? questCoords?.longitude;
  if (!token || !token.startsWith('pk.') || typeof lat !== 'number' || typeof lng !== 'number') {
    return null;
  }
  const travelerPin = `pin-s-person+0070BA(${lng.toFixed(5)},${lat.toFixed(5)})`;
  const questPin = questCoords
    ? `,pin-s-star+1F5D3A(${questCoords.longitude.toFixed(5)},${questCoords.latitude.toFixed(5)})`
    : '';
  return `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/${travelerPin}${questPin}/${lng.toFixed(
    5
  )},${lat.toFixed(5)},15,0/360x140@2x?access_token=${encodeURIComponent(token)}`;
}

export default function BusinessReviewQueueScreen() {
  const {
    ownerQuests,
    claims,
    showInr,
    palette,
    isDark,
    refreshClaims,
    refreshPlacesAndOwner,
  } = useRoamr();

  const [filter, setFilter] = useState<'all' | 'paid'>('all');
  const [previewPhoto, setPreviewPhoto] = useState<string | null>(null);
  const [ownerAudits, setOwnerAudits] = useState<ClaimRecord[] | null>(null);
  const [escalatingId, setEscalatingId] = useState<string | null>(null);

  const loadOwnerAudits = useCallback(async () => {
    try {
      const res = await fetchOwnerAuditsFromServer();
      setOwnerAudits(res.audits || res.claims || []);
    } catch {
      // fallback to scoped context claims if offline
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refreshPlacesAndOwner();
      void refreshClaims();
      void loadOwnerAudits();
    }, [refreshClaims, refreshPlacesAndOwner, loadOwnerAudits])
  );

  const ownerQuestIds = new Set(ownerQuests.map((q) => q.id));
  const fallbackScoped = claims.filter((c) => ownerQuestIds.has(c.questId));
  const scopedClaims = ownerAudits !== null ? ownerAudits : fallbackScoped;
  const paidClaims = scopedClaims.filter((c) => c.status === 'paid');
  const visibleClaims = filter === 'paid' ? paidClaims : scopedClaims;

  const handleEscalateClaim = async (claim: ClaimRecord) => {
    setEscalatingId(claim.id);
    try {
      await escalateClaimToSuperhost(
        claim.id,
        'Owner verified visit as genuine despite low AI score'
      );
      await Promise.all([loadOwnerAudits(), refreshClaims()]);
      Alert.alert(
        'Sent to Superhost',
        'This visit has been escalated to Superhost to release cashback.'
      );
    } catch (err) {
      Alert.alert(
        'Escalation failed',
        err instanceof Error ? err.message : 'Could not escalate visit.'
      );
    } finally {
      setEscalatingId(null);
    }
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.bgCream }]} edges={['top']}>
      <LiquidBackdrop variant="business" />
      <ResponsiveContainer maxWidth={860}>
        <TopHeader />
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={styles.headerRow}>
            <View style={styles.headerTextCol}>
              <Text style={[styles.heading, { color: palette.textPrimary }]}>AI Claims Audit</Text>
              <Text style={[styles.subheading, { color: palette.textSecondary }]}>
                Transparent ledger of GPS proofs, paid PayPal bills, and automated AI payouts — no manual host gatekeeping.
              </Text>
            </View>
            <Pressable
              onPress={() => void refreshClaims()}
              style={[styles.refreshPill, { backgroundColor: palette.bgCard, borderColor: palette.border }]}
            >
              <Ionicons name="refresh" size={16} color={palette.primaryDark} />
            </Pressable>
          </View>

          {/* All vs Paid Filter */}
          <View style={styles.filterRow}>
            {(
              [
                { key: 'all', label: `All Claims (${scopedClaims.length})` },
                { key: 'paid', label: `Auto-Paid (${paidClaims.length})` },
              ] as const
            ).map((opt) => {
              const active = filter === opt.key;
              return (
                <Pressable
                  key={opt.key}
                  onPress={() => setFilter(opt.key)}
                  style={[
                    styles.filterChip,
                    {
                      backgroundColor: active ? palette.primary : palette.bgCard,
                      borderColor: active ? palette.primary : palette.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.filterText,
                      { color: active ? palette.white : palette.textSecondary },
                    ]}
                  >
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {visibleClaims.length === 0 ? (
            <Card style={styles.emptyCard}>
              <Ionicons name="checkmark-done-circle-outline" size={34} color={palette.primary} />
              <Text style={[styles.emptyTitle, { color: palette.textPrimary }]}>
                {filter === 'paid' ? 'No paid claims yet' : 'No claims submitted yet'}
              </Text>
              <Text style={[styles.emptyBody, { color: palette.textSecondary }]}>
                When travelers pay their venue bill via PayPal and capture live camera proof within 100 m, ROAMR AI verifies it against your private AI rules and releases their reward automatically.
              </Text>
            </Card>
          ) : (
            <View style={styles.list}>
              {visibleClaims.map((claim) => {
                const matchedQuest = ownerQuests.find((q) => q.id === claim.questId);
                const staticMapUrl = getMapboxStaticPinUrl(claim, matchedQuest?.coordinates);
                const verdictPass = claim.aiVerdict?.verdict === 'pass';
                const rewardCents = usdToCents(claim.rewardUsd);
                const orderCents = usdToCents(claim.order?.amountUsd || 0);

                return (
                  <Card key={claim.id} style={styles.claimCard}>
                    {/* Traveler + Claim Status Header */}
                    <View style={styles.claimHeader}>
                      <View style={styles.travelerRow}>
                        {claim.travelerAvatar ? (
                          <Image
                            source={{ uri: claim.travelerAvatar }}
                            style={styles.avatar}
                          />
                        ) : (
                          <View
                            style={[
                              styles.avatarFallback,
                              { backgroundColor: palette.primarySoft },
                            ]}
                          >
                            <Ionicons name="person" size={15} color={palette.primaryDark} />
                          </View>
                        )}
                        <View style={styles.travelerInfo}>
                          <Text style={[styles.travelerName, { color: palette.textPrimary }]}>
                            {claim.travelerName}
                          </Text>
                          <Text style={[styles.questTitleSub, { color: palette.textSecondary }]}>
                            {claim.questTitle} •{' '}
                            {new Date(claim.submittedAt).toLocaleString('en-US', {
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
                          claim.status === 'paid'
                            ? 'Paid'
                            : claim.status === 'rejected'
                            ? 'Rejected'
                            : claim.status === 'retake'
                            ? 'Retake'
                            : claim.status
                        }
                        variant={
                          claim.status === 'paid'
                            ? 'success'
                            : claim.status === 'rejected'
                            ? 'danger'
                            : 'gold'
                        }
                      />
                    </View>

                    {/* Photo Proof + Map Pin Card */}
                    <View style={styles.mediaRow}>
                      {claim.photoUri ? (
                        <Pressable
                          onPress={() => setPreviewPhoto(claim.photoUri || null)}
                          style={styles.photoBox}
                        >
                          <Image source={{ uri: claim.photoUri }} style={styles.proofImg} />
                          <View style={styles.zoomBadge}>
                            <Ionicons name="expand-outline" size={12} color={colors.white} />
                          </View>
                        </Pressable>
                      ) : (
                        <View
                          style={[
                            styles.photoBox,
                            styles.emptyMedia,
                            { backgroundColor: palette.bgSage },
                          ]}
                        >
                          <Ionicons name="camera-outline" size={24} color={palette.textMuted} />
                        </View>
                      )}

                      <View
                        style={[
                          styles.mapPinCard,
                          { backgroundColor: palette.bgSoft, borderColor: palette.border },
                        ]}
                      >
                        {staticMapUrl ? (
                          <Image source={{ uri: staticMapUrl }} style={styles.staticMapImg} />
                        ) : (
                          <View style={[styles.staticMapFallback, { backgroundColor: palette.bgSage }]}>
                            <Ionicons name="pin" size={20} color={palette.primary} />
                          </View>
                        )}
                        <View style={styles.pinMeta}>
                          <Pill
                            label={
                              typeof claim.distanceMeters === 'number'
                                ? `${claim.distanceMeters} m away`
                                : 'Distance N/A'
                            }
                            variant={
                              typeof claim.distanceMeters === 'number' &&
                              claim.distanceMeters <= 100
                                ? 'success'
                                : 'gold'
                            }
                            icon={<Ionicons name="location" size={11} color={palette.primaryDark} />}
                          />
                          <Text
                            style={[styles.addressLine, { color: palette.textSecondary }]}
                            numberOfLines={2}
                          >
                            {claim.resolvedAddress ||
                              (claim.gps?.latitude
                                ? `${claim.gps.latitude.toFixed(4)}, ${claim.gps.longitude?.toFixed(4)}`
                                : 'Address unavailable')}
                          </Text>
                        </View>
                      </View>
                    </View>

                    {/* PayPal Order Summary */}
                    <View
                      style={[
                        styles.orderBox,
                        { backgroundColor: palette.paypalSoft, borderColor: palette.border },
                      ]}
                    >
                      <View style={styles.orderTopRow}>
                        <View style={styles.inlineRow}>
                          <PayPalLogo size={14} variant="badge" />
                          <Text style={[styles.orderHeading, { color: palette.paypalBlue }]}>
                            Order {claim.order?.orderId || 'N/A'}
                          </Text>
                        </View>
                        <Text style={[styles.orderAmount, { color: palette.textPrimary }]}>
                          {formatMoney(orderCents, { showInr })} • {claim.order?.status || 'UNKNOWN'}
                        </Text>
                      </View>
                      <Text style={[styles.orderSub, { color: palette.textSecondary }]}>
                        Payee: {claim.order?.payeeEmail || 'N/A'} • Payer:{' '}
                        {claim.order?.payerName || claim.order?.payerEmail || 'Sandbox Buyer'}
                      </Text>
                    </View>

                    {/* AI Verdict + Confidence + Bulleted Reasons */}
                    {claim.aiVerdict ? (
                      <View
                        style={[
                          styles.aiBox,
                          {
                            backgroundColor: isDark ? palette.bgSoft : palette.bgCream,
                            borderColor: palette.border,
                          },
                        ]}
                      >
                        <View style={styles.aiTopRow}>
                          <Pill
                            label={`AI ${claim.aiVerdict.verdict.toUpperCase()} • ${Math.round(
                              claim.aiVerdict.confidence * 100
                            )}% confidence`}
                            variant={verdictPass ? 'success' : 'gold'}
                            icon={
                              <Ionicons
                                name="sparkles"
                                size={12}
                                color={verdictPass ? palette.success : palette.goldText}
                              />
                            }
                          />
                          {claim.demoMode ? <Pill label="Demo Auto-Pass" variant="sage" /> : null}
                        </View>
                        {claim.aiVerdict.reasons.map((reason, idx) => (
                          <Text
                            key={`${claim.id}-r-${idx}`}
                            style={[styles.aiReasonBullet, { color: palette.textSecondary }]}
                          >
                            • {reason}
                          </Text>
                        ))}
                      </View>
                    ) : null}

                    {/* Automated Payout / Flag Summary */}
                    {claim.payout ? (
                      <Text style={[styles.payoutSummary, { color: palette.primary }]}>
                        Auto-Paid • Payout {claim.payout.id} • {claim.payout.status}
                        {claim.payout.simulated ? ' (Sandbox-Simulated)' : ' (PayPal Live)'}
                      </Text>
                    ) : claim.reviewNote ? (
                      <Text
                        style={[
                          styles.payoutSummary,
                          {
                            color:
                              claim.status === 'rejected' ? palette.danger : palette.textSecondary,
                          },
                        ]}
                      >
                        {claim.reviewNote}
                      </Text>
                    ) : null}

                    {claim.status === 'pending_superhost' ? (
                      <View style={{ marginTop: 8, alignSelf: 'flex-start' }}>
                        <Pill label="Sent to Superhost for Cashback" variant="gold" />
                      </View>
                    ) : claim.status === 'rejected' ||
                      claim.status === 'retake' ||
                      claim.status === 'pending_business' ? (
                      <Button
                        label={
                          escalatingId === claim.id
                            ? 'Sending to Superhost...'
                            : 'Verify Genuine & Request Superhost Cashback'
                        }
                        variant="outline"
                        loading={escalatingId === claim.id}
                        onPress={() => handleEscalateClaim(claim)}
                        style={{ marginTop: 10, minHeight: 40 }}
                      />
                    ) : null}
                  </Card>
                );
              })}
            </View>
          )}
        </ScrollView>
      </ResponsiveContainer>

      <Modal
        visible={Boolean(previewPhoto)}
        transparent
        animationType="fade"
        onRequestClose={() => setPreviewPhoto(null)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setPreviewPhoto(null)}>
          {previewPhoto ? (
            <Image source={{ uri: previewPhoto }} style={styles.modalImg} resizeMode="contain" />
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
    paddingBottom: 108,
    gap: 14,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 4,
  },
  headerTextCol: {
    flex: 1,
  },
  heading: {
    fontFamily: fonts.serif,
    fontSize: 28,
  },
  subheading: {
    fontFamily: fonts.sans,
    fontSize: 13.5,
    marginTop: 2,
  },
  refreshPill: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterRow: {
    flexDirection: 'row',
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radii.pill,
    borderWidth: 1,
  },
  filterText: {
    fontFamily: fonts.sansSemi,
    fontSize: 12.5,
  },
  errorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  errorText: {
    flex: 1,
    fontFamily: fonts.sansMedium,
    fontSize: 12.5,
  },
  emptyCard: {
    alignItems: 'center',
    paddingVertical: 28,
    gap: 8,
  },
  emptyTitle: {
    fontFamily: fonts.serif,
    fontSize: 19,
  },
  emptyBody: {
    fontFamily: fonts.sans,
    fontSize: 13.5,
    textAlign: 'center',
    lineHeight: 20,
  },
  list: {
    gap: 12,
  },
  claimCard: {
    gap: 12,
  },
  claimHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  travelerRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  avatarFallback: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  travelerInfo: {
    flex: 1,
  },
  travelerName: {
    fontFamily: fonts.sansSemi,
    fontSize: 14.5,
  },
  questTitleSub: {
    fontFamily: fonts.sans,
    fontSize: 12,
  },
  mediaRow: {
    flexDirection: 'row',
    gap: 10,
  },
  photoBox: {
    width: 112,
    height: 136,
    borderRadius: radii.md,
    overflow: 'hidden',
    position: 'relative',
  },
  emptyMedia: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  proofImg: {
    width: '100%',
    height: '100%',
  },
  zoomBadge: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(12, 20, 16, 0.72)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapPinCard: {
    flex: 1,
    borderRadius: radii.md,
    borderWidth: 1,
    overflow: 'hidden',
  },
  staticMapImg: {
    width: '100%',
    height: 76,
  },
  staticMapFallback: {
    width: '100%',
    height: 76,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinMeta: {
    padding: 8,
    gap: 4,
    alignItems: 'flex-start',
  },
  addressLine: {
    fontFamily: fonts.sans,
    fontSize: 11,
    lineHeight: 15,
  },
  orderBox: {
    padding: 10,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: 4,
  },
  orderTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
    flexWrap: 'wrap',
  },
  inlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  orderHeading: {
    fontFamily: fonts.sansSemi,
    fontSize: 12.5,
  },
  orderAmount: {
    fontFamily: fonts.sansBold,
    fontSize: 12.5,
  },
  orderSub: {
    fontFamily: fonts.sans,
    fontSize: 11.5,
  },
  aiBox: {
    padding: 10,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: 5,
  },
  aiTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  aiReasonBullet: {
    fontFamily: fonts.sans,
    fontSize: 12,
    lineHeight: 17,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  approveBtn: {
    flex: 1,
    minHeight: 44,
    height: undefined,
    paddingVertical: 10,
  },
  rejectBtn: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: 'rgba(184, 56, 45, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rejectText: {
    fontFamily: fonts.sansSemi,
    fontSize: 13,
  },
  payoutSummary: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(10, 18, 14, 0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    gap: 18,
  },
  modalImg: {
    width: '100%',
    height: '72%',
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
