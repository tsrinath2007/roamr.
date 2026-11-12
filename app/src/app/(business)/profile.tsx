import React, { useMemo } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useRoamr } from '../../context/RoamrContext';
import { formatMoney, usdToCents } from '../../../lib/currency';
import { TopHeader } from '../../components/TopHeader';
import { LiquidBackdrop } from '../../components/LiquidBackdrop';
import { Card } from '../../components/Card';
import { Pill } from '../../components/Pill';
import { ModeSwitchPill } from '../../components/ModeSwitchPill';
import { ResponsiveContainer } from '../../components/ResponsiveContainer';
import { colors, fonts, radii } from '../../theme/tokens';

export default function BusinessProfileTab() {
  const { userProfile, ownerStats, serverUser, isSuperAdmin, showInr, setRole, palette, isDark } = useRoamr();

  const isVerifiedOwner = (serverUser?.owned_places_count ?? ownerStats?.owned_places_count ?? 0) > 0;

  const budgetStats = useMemo(() => {
    const fundedCents = usdToCents(ownerStats?.funded ?? 0);
    const spentCents = usdToCents(ownerStats?.spent ?? 0);
    const remainingCents = usdToCents(ownerStats?.remaining ?? 0);
    const totalVisits = ownerStats?.paid_visits ?? 0;
    return { fundedCents, spentCents, remainingCents, totalVisits };
  }, [ownerStats]);

  const handleSwitchToTraveling = () => {
    setRole('traveler');
    router.replace('/(tabs)');
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.bgCream }]} edges={['top']}>
      <LiquidBackdrop variant="business" />
      <ResponsiveContainer maxWidth={760}>
        <TopHeader />
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {/* Business Identity Card */}
          <Card style={styles.bizCard}>
            <View style={styles.bizHeader}>
              {userProfile?.businessLogo ? (
                <Image
                  source={{ uri: userProfile.businessLogo }}
                  style={[styles.bizLogo, { backgroundColor: palette.bgSage }]}
                />
              ) : (
                <View style={[styles.bizLogoFallback, { backgroundColor: palette.goldSoft }]}>
                  <Ionicons name="storefront" size={26} color={palette.goldText} />
                </View>
              )}
              <View style={styles.bizInfo}>
                <Text style={[styles.bizName, { color: palette.textPrimary }]}>
                  {userProfile?.businessName || 'Your Business'}
                </Text>
                <View style={styles.badgesRow}>
                  {isSuperAdmin ? (
                    <Pill
                      label="Superadmin"
                      variant="gold"
                      icon={<Ionicons name="shield-checkmark" size={12} color={palette.goldText} />}
                    />
                  ) : null}
                  {isVerifiedOwner ? (
                    <Pill
                      label="Verified Host"
                      variant="success"
                      icon={<Ionicons name="checkmark-circle" size={12} color={palette.success} />}
                    />
                  ) : isSuperAdmin ? (
                    <Pill
                      label="Sandbox host"
                      variant="neutral"
                      icon={<Ionicons name="flask-outline" size={12} color={palette.textSecondary} />}
                    />
                  ) : (
                    <Pill
                      label="Pending Verification"
                      variant="neutral"
                      icon={<Ionicons name="time-outline" size={12} color={palette.textSecondary} />}
                    />
                  )}
                  <Pill label={userProfile?.businessCategory || 'Local Host'} variant="gold" />
                </View>
              </View>
            </View>

            <View style={styles.metaRow}>
              <Ionicons name="mail-outline" size={16} color={palette.textSecondary} />
              <Text style={[styles.metaText, { color: palette.textSecondary }]}>
                {userProfile?.businessPaypalEmail || userProfile?.email || 'PayPal not set'}
              </Text>
            </View>

            <View style={styles.metaRow}>
              <Ionicons name="people-outline" size={16} color={palette.textSecondary} />
              <Text style={[styles.metaText, { color: palette.textSecondary }]}>
                {ownerStats?.quests_count ?? 0} Active Quests • {budgetStats.totalVisits} Verified Traveler Visits
              </Text>
            </View>
          </Card>

          {/* Funded vs Spent vs Remaining */}
          <View style={styles.statsRow}>
            <Card style={styles.statCard}>
              <Text style={[styles.statValue, { color: palette.textPrimary }]} numberOfLines={2} adjustsFontSizeToFit>
                {formatMoney(budgetStats.fundedCents, { showInr })}
              </Text>
              <Text style={[styles.statLabel, { color: palette.textSecondary }]}>Funded</Text>
            </Card>
            <Card style={styles.statCard}>
              <Text style={[styles.statValue, { color: palette.textPrimary }]} numberOfLines={2} adjustsFontSizeToFit>
                {formatMoney(budgetStats.spentCents, { showInr })}
              </Text>
              <Text style={[styles.statLabel, { color: palette.textSecondary }]}>Spent</Text>
            </Card>
            <Card style={styles.statCard}>
              <Text
                style={[styles.statValue, { color: palette.primary }]}
                numberOfLines={2}
                adjustsFontSizeToFit
              >
                {formatMoney(budgetStats.remainingCents, { showInr })}
              </Text>
              <Text style={[styles.statLabel, { color: palette.textSecondary }]}>Remaining</Text>
            </Card>
          </View>

          {/* Settings Row (PayPal connection, business address & category, sign out) */}
          <Pressable onPress={() => router.push('/settings')}>
            <Card style={styles.shortcutCard}>
              <View style={styles.shortcutLeft}>
                <View style={[styles.settingsIconCircle, { backgroundColor: palette.goldSoft }]}>
                  <Ionicons name="settings-outline" size={20} color={palette.goldText} />
                </View>
                <View style={styles.shortcutTextCol}>
                  <Text style={[styles.cardTitle, { color: palette.textPrimary }]}>Settings</Text>
                  <Text style={[styles.shortcutSub, { color: palette.textSecondary }]}>
                    PayPal connection, business address & category, sign out
                  </Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color={palette.textMuted} />
            </Card>
          </Pressable>
        </ScrollView>
      </ResponsiveContainer>

      <ModeSwitchPill label="Switch to traveling" onPress={handleSwitchToTraveling} />
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
  bizCard: {
    gap: 12,
    marginTop: 4,
  },
  bizHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  bizLogo: {
    width: 60,
    height: 60,
    borderRadius: radii.md,
    backgroundColor: colors.bgSage,
  },
  bizLogoFallback: {
    width: 60,
    height: 60,
    borderRadius: radii.md,
    backgroundColor: colors.goldSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bizInfo: {
    flex: 1,
    gap: 6,
  },
  bizName: {
    fontFamily: fonts.serif,
    fontSize: 22,
    color: colors.textPrimary,
  },
  badgesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  metaText: {
    flex: 1,
    fontFamily: fonts.sans,
    fontSize: 13.5,
    color: colors.textSecondary,
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
    fontSize: 16,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  statLabel: {
    fontFamily: fonts.sans,
    fontSize: 11.5,
    color: colors.textSecondary,
    textAlign: 'center',
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
  settingsIconCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.goldSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shortcutTextCol: {
    flex: 1,
  },
  cardTitle: {
    fontFamily: fonts.serif,
    fontSize: 18,
    color: colors.textPrimary,
  },
  shortcutSub: {
    fontFamily: fonts.sans,
    fontSize: 12.5,
    color: colors.textSecondary,
    marginTop: 2,
  },
});
