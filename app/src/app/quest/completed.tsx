import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useRoamr } from '../../context/RoamrContext';
import { formatMoney, usdToCents } from '../../../lib/currency';
import { Button } from '../../components/Button';
import { ClaimStatusTracker } from '../../components/ClaimStatusTracker';
import { GlassSurface } from '../../components/GlassSurface';
import { LiquidBackdrop } from '../../components/LiquidBackdrop';
import { PassportStamp } from '../../components/PassportStamp';
import { PayPalLogo } from '../../components/PayPalLogo';
import { ResponsiveContainer } from '../../components/ResponsiveContainer';
import { colors, fonts, radii, shadows } from '../../theme/tokens';

export default function QuestCompletedScreen() {
  const { id, claimId } = useLocalSearchParams<{
    id: string;
    claimId?: string;
  }>();
  const { quests, claims, lastCompletedStamp, payouts, showInr, palette, refreshClaims } =
    useRoamr();
  const [refreshingClaim, setRefreshingClaim] = useState(false);

  const activeClaim =
    (claimId ? claims.find((c) => c.id === claimId) : undefined) ||
    claims.find((c) => c.questId === id);
  const isRetake = activeClaim?.status === 'retake';
  const isRejected = activeClaim?.status === 'rejected';
  const isPaid = activeClaim?.status === 'paid';

  const quest = quests.find((q) => q.id === (id || lastCompletedStamp?.questId)) || quests[0];
  const latestPayout = activeClaim?.payout || payouts[0];

  const handleRefreshClaim = async () => {
    setRefreshingClaim(true);
    try {
      await refreshClaims();
    } finally {
      setRefreshingClaim(false);
    }
  };

  useEffect(() => {
    Haptics.notificationAsync(
      isRejected
        ? Haptics.NotificationFeedbackType.Error
        : isRetake
        ? Haptics.NotificationFeedbackType.Warning
        : Haptics.NotificationFeedbackType.Success
    ).catch(() => {});
  }, [isRejected, isRetake]);

  const businessName =
    lastCompletedStamp?.businessName || quest?.place_name || quest?.businessName || 'ROAMR Quest';
  const category = lastCompletedStamp?.category || quest?.category || 'Explore';
  const xp = activeClaim?.xp ?? lastCompletedStamp?.xp ?? quest?.xp ?? 50;
  const rewardUsd = activeClaim?.rewardUsd ?? lastCompletedStamp?.rewardUsd ?? quest?.rewardUsd ?? 0;
  const rewardCents = usdToCents(rewardUsd);
  const isXpOnly =
    activeClaim?.rewardMode === 'xp_only' ||
    (!isRejected && !isRetake && rewardCents <= 0);
  const completedAt = lastCompletedStamp?.completedAt || new Date().toISOString();

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.bgSage }]}>
      <LiquidBackdrop variant="traveler" />
      <ResponsiveContainer maxWidth={560}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {/* Subtle Confetti Dots */}
          <View style={styles.confettiLayer} pointerEvents="none">
            <View style={[styles.dot, { top: 28, left: '16%', backgroundColor: palette.primary }]} />
            <View style={[styles.dot, { top: 44, right: '18%', backgroundColor: palette.gold }]} />
            <View style={[styles.dot, { top: 82, left: '26%', backgroundColor: palette.primaryLight }]} />
            <View style={[styles.dot, { top: 76, right: '24%', backgroundColor: palette.primarySoft }]} />
          </View>

          <View style={styles.cardWrapper}>
            {/* Overlapping Checkmark / Retake / Rejected Badge */}
            <View style={styles.checkOuterGlow}>
              <View
                style={[
                  styles.checkCircle,
                  {
                    backgroundColor: isRejected
                      ? palette.danger
                      : isRetake
                      ? palette.gold
                      : palette.success,
                    borderColor: palette.white,
                  },
                ]}
              >
                <Ionicons
                  name={isRejected ? 'close' : isRetake ? 'refresh' : 'checkmark'}
                  size={38}
                  color={palette.white}
                />
              </View>
            </View>

            <GlassSurface borderRadius={radii.xl} intensity={65} style={styles.glassOuter}>
              <View style={styles.frostedCard}>
              <Text style={[styles.heading, { color: palette.textPrimary }]}>
                {isRejected
                  ? 'Claim Rejected'
                  : isRetake
                  ? 'One Retake Needed'
                  : isXpOnly
                  ? 'XP & Stamp Earned!'
                  : isPaid
                  ? 'Cashback Paid!'
                  : 'Quest Completed!'}
              </Text>
              <Text style={[styles.subheading, { color: palette.textSecondary, textAlign: 'center' }]}>
                {isRejected
                  ? activeClaim?.reviewNote || 'This claim failed verification checks.'
                  : isRetake
                  ? activeClaim?.reviewNote ||
                    'Photo confidence was borderline (0.40–0.75). Try one clearer retake!'
                  : activeClaim?.cashbackSoldOut
                  ? "Cashback just ran out, you'll still earn XP."
                  : isXpOnly
                  ? `ROAMR AI verified your visit — +${xp} XP & passport stamp added!`
                  : isPaid
                  ? 'ROAMR AI verified your proof — your PayPal cashback has been released automatically!'
                  : 'Great exploration, traveler!'}
              </Text>

              {/* Split Reward Pill (+XP | PayPal $USD or Passport Stamp for XP-only) */}
              <View
                style={[
                  styles.rewardSplitCard,
                  { backgroundColor: palette.bgSoft, borderColor: palette.border },
                ]}
              >
                <View style={styles.rewardHalf}>
                  <Ionicons name="star" size={18} color={palette.gold} />
                  <Text style={[styles.rewardValue, { color: palette.textPrimary }]}>+{xp} XP</Text>
                </View>

                <View style={[styles.rewardDivider, { backgroundColor: palette.border }]} />

                {isXpOnly ? (
                  <View style={styles.rewardHalf}>
                    <Ionicons name="ribbon" size={17} color={palette.primary} />
                    <Text style={[styles.rewardValue, { color: palette.primaryDark }]}>
                      Stamp Unlocked
                    </Text>
                  </View>
                ) : (
                  <View style={styles.rewardHalf}>
                    <View style={[styles.paypalBadge, { backgroundColor: '#FFFFFF' }]}>
                      <PayPalLogo size={14} />
                    </View>
                    <Text style={[styles.rewardValue, { color: palette.textPrimary }]}>
                      {formatMoney(rewardCents, { showInr })}
                    </Text>
                  </View>
                )}
              </View>

              {activeClaim ? (
                <View style={styles.trackerBox}>
                  <ClaimStatusTracker claim={activeClaim} />
                </View>
              ) : latestPayout ? (
                <Text style={[styles.payoutNote, { color: palette.textMuted }]}>
                  Payout status: {latestPayout.status}
                  {latestPayout.simulated ? ' (Simulated)' : ' (PayPal Sandbox)'}
                </Text>
              ) : null}

              {/* Animated Passport Stamp when Paid */}
              {!isRejected && !isRetake ? (
                <View style={styles.stampSection}>
                  <PassportStamp
                    businessName={businessName}
                    category={category}
                    dateIso={completedAt}
                    animate
                  />
                </View>
              ) : null}
              </View>
            </GlassSurface>

            <View style={styles.buttonsCol}>
              {isRetake && quest ? (
                <Button
                  label="Capture 1 Free Retake"
                  icon={<Ionicons name="camera" size={18} color={palette.white} />}
                  onPress={() =>
                    router.replace({
                      pathname: '/quest/submit',
                      params: { id: quest.id, retake: '1' },
                    })
                  }
                />
              ) : null}
              {activeClaim ? (
                <Button
                  label={refreshingClaim ? 'Refreshing Claim...' : 'Refresh Claim Status'}
                  variant="outline"
                  loading={refreshingClaim}
                  onPress={handleRefreshClaim}
                />
              ) : null}
              <Button
                label="View Wallet & Claim Tracker"
                trailingIcon={<Ionicons name="arrow-forward" size={18} color={palette.white} />}
                onPress={() => router.replace('/(tabs)/wallet')}
              />
              <Button
                label="Continue Exploring"
                variant="secondary"
                onPress={() => router.replace('/(tabs)')}
              />
            </View>
          </View>
        </ScrollView>
      </ResponsiveContainer>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.bgSage,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 28,
  },
  confettiLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  dot: {
    position: 'absolute',
    width: 10,
    height: 10,
    borderRadius: 5,
    opacity: 0.55,
  },
  cardWrapper: {
    alignItems: 'center',
  },
  checkOuterGlow: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: 'rgba(37, 126, 78, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 5,
    marginBottom: -44,
  },
  checkCircle: {
    width: 74,
    height: 74,
    borderRadius: 37,
    backgroundColor: colors.success,
    borderWidth: 3,
    borderColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.card,
  },
  glassOuter: {
    width: '100%',
  },
  frostedCard: {
    width: '100%',
    paddingTop: 58,
    paddingBottom: 20,
    paddingHorizontal: 18,
    alignItems: 'center',
  },
  heading: {
    fontFamily: fonts.serif,
    fontSize: 28,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  subheading: {
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 4,
  },
  rewardSplitCard: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    backgroundColor: colors.bgCream,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 14,
    marginTop: 18,
  },
  rewardHalf: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  rewardDivider: {
    width: 1,
    height: 24,
    backgroundColor: colors.border,
  },
  rewardValue: {
    fontFamily: fonts.sansBold,
    fontSize: 18,
    color: colors.textPrimary,
  },
  paypalBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.paypalSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  paypalP: {
    fontFamily: fonts.serif,
    fontSize: 15,
    color: colors.paypalBlue,
  },
  payoutNote: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 8,
  },
  stampSection: {
    width: '100%',
    marginTop: 16,
  },
  trackerBox: {
    width: '100%',
    marginTop: 14,
  },
  buttonsCol: {
    width: '100%',
    gap: 10,
    marginTop: 18,
  },
});
