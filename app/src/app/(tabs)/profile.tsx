import React, { useMemo } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useRoamr } from '../../context/RoamrContext';
import { formatMoney } from '../../../lib/currency';
import { TopHeader } from '../../components/TopHeader';
import { Card } from '../../components/Card';
import { LiquidBackdrop } from '../../components/LiquidBackdrop';
import { Pill } from '../../components/Pill';
import { PayPalLogo } from '../../components/PayPalLogo';
import { Button } from '../../components/Button';
import { PassportStamp } from '../../components/PassportStamp';
import { ModeSwitchPill } from '../../components/ModeSwitchPill';
import { ResponsiveContainer } from '../../components/ResponsiveContainer';
import { getExplorerLevel } from '../../data/leaderboard';
import { colors, fonts, radii } from '../../theme/tokens';

export default function ProfileScreen() {
  const {
    userProfile,
    serverUser,
    ownerStats,
    isSuperAdmin,
    totalXp,
    stamps,
    payouts,
    walletBalanceCents,
    city,
    interests,
    showInr,
    palette,
    setRole,
  } = useRoamr();

  const levelInfo = useMemo(() => getExplorerLevel(totalXp), [totalXp]);
  const levelSpan = Math.max(1, levelInfo.next - levelInfo.floor);
  const xpPct = Math.min(
    100,
    Math.max(4, Math.round(((totalXp - levelInfo.floor) / levelSpan) * 100))
  );
  const placesVisited = useMemo(
    () => new Set(stamps.map((s) => s.businessName)).size,
    [stamps]
  );
  const recentStamps = stamps.slice(0, 4);
  const lastPayout = payouts[0];

  const hasBusinessProfile =
    isSuperAdmin ||
    Boolean(userProfile?.isBusiness) ||
    Boolean(userProfile?.businessName) ||
    Boolean(serverUser?.business_name) ||
    Boolean(serverUser?.primary_place) ||
    (serverUser?.owned_places_count ?? ownerStats?.owned_places_count ?? 0) > 0;

  const handleSwitchToBusiness = () => {
    if (!hasBusinessProfile) {
      router.push('/business-onboarding');
      return;
    }
    setRole('business');
    router.replace('/(business)');
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.bgCream }]} edges={['top']}>
      <LiquidBackdrop variant="traveler" />
      <ResponsiveContainer maxWidth={760}>
        <TopHeader />
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {/* Identity Card */}
          <Card style={[styles.heroCard, { backgroundColor: palette.bgSage }]}>
            <View style={styles.heroTopRow}>
              <View style={[styles.avatarLarge, { backgroundColor: palette.primary }]}>
                {userProfile?.avatar ? (
                  <Image source={{ uri: userProfile.avatar }} style={styles.avatarLargeImg} />
                ) : (
                  <Ionicons name="compass" size={28} color={palette.white} />
                )}
              </View>
              <View style={styles.heroInfo}>
                <Text style={[styles.nameTitle, { color: palette.textPrimary }]} numberOfLines={1}>
                  {userProfile?.name || 'Neighborhood Explorer'}
                </Text>
                <Text style={[styles.levelSub, { color: palette.primaryDark }]}>
                  Level {levelInfo.level} • {levelInfo.title} • {city}
                </Text>
              </View>
              <Pill label={`${stamps.length} Stamps`} variant="sage" />
            </View>

            {/* XP Progress Bar */}
            <View style={styles.xpWrap}>
              <View style={styles.xpLabelRow}>
                <Text style={[styles.xpText, { color: palette.primaryDark }]}>{totalXp} XP</Text>
                <Text style={[styles.xpNextText, { color: palette.textSecondary }]}>
                  {Math.max(0, levelInfo.next - totalXp)} XP to {levelInfo.nextTitle}
                </Text>
              </View>
              <View style={[styles.xpTrack, { backgroundColor: palette.primarySoft }]}>
                <View
                  style={[
                    styles.xpFill,
                    { width: `${xpPct}%`, backgroundColor: palette.primary },
                  ]}
                />
              </View>
            </View>
          </Card>

          {/* 3-Column Stats Row */}
          <View style={styles.statsRow}>
            <Card style={styles.statCard}>
              <Text style={[styles.statValue, { color: palette.textPrimary }]}>{stamps.length}</Text>
              <Text style={[styles.statLabel, { color: palette.textSecondary }]}>Quests Done</Text>
            </Card>
            <Card style={styles.statCard}>
              <Text style={[styles.statValue, { color: palette.textPrimary }]}>{placesVisited}</Text>
              <Text style={[styles.statLabel, { color: palette.textSecondary }]}>
                Places Visited
              </Text>
            </Card>
            <Card style={styles.statCard}>
              <Text
                style={[styles.statValue, styles.statValueMoney, { color: palette.textPrimary }]}
                numberOfLines={2}
                adjustsFontSizeToFit
              >
                {formatMoney(walletBalanceCents, { showInr: true })}
              </Text>
              <Text style={[styles.statLabel, { color: palette.textSecondary }]}>
                Rewards Earned
              </Text>
            </Card>
          </View>

          {/* Passport Stamp Preview */}
          <Card style={styles.sectionCard}>
            <View style={styles.sectionHeaderRow}>
              <Text style={[styles.cardTitle, { color: palette.textPrimary }]}>Recent Stamps</Text>
              <Pressable onPress={() => router.push('/(tabs)/collection')} hitSlop={8}>
                <Text style={[styles.seeAllLink, { color: palette.primaryDark }]}>See all →</Text>
              </Pressable>
            </View>

            {recentStamps.length === 0 ? (
              <Pressable
                onPress={() => router.push('/(tabs)/collection')}
                style={styles.emptyStampsRow}
              >
                <View style={[styles.emptyStampIcon, { backgroundColor: palette.bgSage }]}>
                  <Ionicons name="ribbon-outline" size={20} color={palette.primary} />
                </View>
                <Text style={[styles.emptyStampsText, { color: palette.textSecondary }]}>
                  Complete a quest and verify your visit to earn your first passport stamp.
                </Text>
              </Pressable>
            ) : (
              <View style={styles.stampsPreviewRow}>
                {recentStamps.map((stamp) => (
                  <View key={stamp.id} style={styles.miniStampWrap}>
                    <PassportStamp
                      businessName={stamp.businessName}
                      category={stamp.category}
                      dateIso={stamp.completedAt}
                      animate={false}
                      compact
                    />
                  </View>
                ))}
              </View>
            )}
          </Card>

          {/* Wallet Shortcut */}
          <Pressable onPress={() => router.push('/(tabs)/wallet')}>
            <Card style={styles.shortcutCard}>
              <View style={styles.shortcutLeft}>
                <View style={[styles.walletIconCircle, { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: palette.border }]}>
                  <PayPalLogo size={22} />
                </View>
                <View style={styles.shortcutTextCol}>
                  <Text style={[styles.cardTitle, { color: palette.textPrimary }]}>
                    Wallet • {formatMoney(walletBalanceCents, { showInr })}
                  </Text>
                  <Text style={[styles.shortcutSub, { color: palette.textSecondary }]} numberOfLines={1}>
                    {lastPayout
                      ? `Last payout: ${lastPayout.questTitle} (${lastPayout.status})`
                      : 'No payouts yet • Tap to view history'}
                  </Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color={palette.textMuted} />
            </Card>
          </Pressable>

          {/* Traveler Interests */}
          <Card style={styles.sectionCard}>
            <Text style={[styles.cardTitle, { color: palette.textPrimary }]}>Traveler Interests</Text>
            <View style={styles.chipsWrap}>
              {interests.map((item) => (
                <Pill key={item} label={item} variant="sage" />
              ))}
            </View>
            <Button
              label="Personalize Quests with AI"
              variant="secondary"
              icon={<Ionicons name="sparkles" size={16} color={palette.primaryDark} />}
              onPress={() => router.push('/onboarding')}
              style={styles.inlineBtn}
            />
          </Card>

          {/* Settings Row */}
          <Pressable onPress={() => router.push('/settings')}>
            <Card style={styles.shortcutCard}>
              <View style={styles.shortcutLeft}>
                <View style={[styles.settingsIconCircle, { backgroundColor: palette.bgSage }]}>
                  <Ionicons name="settings-outline" size={20} color={palette.primaryDark} />
                </View>
                <View style={styles.shortcutTextCol}>
                  <Text style={[styles.cardTitle, { color: palette.textPrimary }]}>Settings</Text>
                  <Text style={[styles.shortcutSub, { color: palette.textSecondary }]}>
                    Payments, currency, globe display & account
                  </Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color={palette.textMuted} />
            </Card>
          </Pressable>
        </ScrollView>
      </ResponsiveContainer>

      <ModeSwitchPill
        label={isSuperAdmin ? 'Switch to Superadmin' : 'Switch to business'}
        onPress={handleSwitchToBusiness}
      />
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
    paddingBottom: 164,
    gap: 14,
  },
  heroCard: {
    backgroundColor: colors.bgSage,
    gap: 14,
    marginTop: 4,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  heroInfo: {
    flex: 1,
  },
  avatarLarge: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarLargeImg: {
    width: 52,
    height: 52,
  },
  nameTitle: {
    fontFamily: fonts.serif,
    fontSize: 20,
    color: colors.textPrimary,
  },
  levelSub: {
    fontFamily: fonts.sansSemi,
    fontSize: 12.5,
    color: colors.primary,
    marginTop: 2,
  },
  xpWrap: {
    gap: 6,
  },
  xpLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  xpText: {
    fontFamily: fonts.sansSemi,
    fontSize: 12,
    color: colors.primaryDark,
  },
  xpNextText: {
    fontFamily: fonts.sans,
    fontSize: 11.5,
    color: colors.textSecondary,
  },
  xpTrack: {
    height: 7,
    backgroundColor: 'rgba(31, 93, 58, 0.14)',
    borderRadius: radii.pill,
    overflow: 'hidden',
  },
  xpFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  statCard: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 8,
    gap: 3,
  },
  statValue: {
    fontFamily: fonts.serif,
    fontSize: 20,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  statValueMoney: {
    fontSize: 15,
    lineHeight: 20,
  },
  statLabel: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  sectionCard: {
    gap: 10,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardTitle: {
    fontFamily: fonts.serif,
    fontSize: 18,
    color: colors.textPrimary,
  },
  seeAllLink: {
    fontFamily: fonts.sansSemi,
    fontSize: 13,
    color: colors.primary,
  },
  emptyStampsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  emptyStampIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.bgSage,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyStampsText: {
    flex: 1,
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 18,
    color: colors.textSecondary,
  },
  stampsPreviewRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  miniStampWrap: {
    width: '47%',
  },
  shortcutCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  shortcutLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  shortcutTextCol: {
    flex: 1,
  },
  shortcutSub: {
    fontFamily: fonts.sans,
    fontSize: 12.5,
    color: colors.textSecondary,
    marginTop: 2,
  },
  walletIconCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingsIconCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.bgSage,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  inlineBtn: {
    height: 44,
  },
});
