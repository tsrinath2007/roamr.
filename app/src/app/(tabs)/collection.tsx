import React from 'react';
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useRoamr } from '../../context/RoamrContext';
import { TopHeader } from '../../components/TopHeader';
import { Card } from '../../components/Card';
import { LiquidBackdrop } from '../../components/LiquidBackdrop';
import { Button } from '../../components/Button';
import { PassportStamp } from '../../components/PassportStamp';
import { ResponsiveContainer } from '../../components/ResponsiveContainer';
import { colors, fonts } from '../../theme/tokens';

export default function CollectionScreen() {
  const { stamps, totalXp, palette } = useRoamr();
  const { width } = useWindowDimensions();
  const columns = width >= 720 ? 3 : 2;

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.bgCream }]} edges={['top']}>
      <LiquidBackdrop variant="traveler" />
      <ResponsiveContainer maxWidth={760}>
        <TopHeader />
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <Text style={[styles.heading, { color: palette.textPrimary }]}>Passport Collection</Text>
          <Text style={[styles.subheading, { color: palette.textSecondary }]}>
            Every verified local visit adds an ink stamp to your travel passport.
          </Text>

          {/* Summary Strip */}
          <Card style={[styles.summaryCard, { backgroundColor: palette.bgSage }]}>
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: palette.primaryDark }]}>{stamps.length}</Text>
              <Text style={[styles.statLabel, { color: palette.textSecondary }]}>Stamps Earned</Text>
            </View>
            <View style={[styles.divider, { backgroundColor: palette.border }]} />
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: palette.primaryDark }]}>{totalXp} XP</Text>
              <Text style={[styles.statLabel, { color: palette.textSecondary }]}>Explorer XP</Text>
            </View>
          </Card>

          {stamps.length === 0 ? (
            <Card style={styles.emptyCard}>
              <View style={[styles.emptyIconWrap, { backgroundColor: palette.primarySoft }]}>
                <Ionicons name="ribbon-outline" size={32} color={palette.primary} />
              </View>
              <Text style={[styles.emptyTitle, { color: palette.textPrimary }]}>
                Your passport is waiting
              </Text>
              <Text style={[styles.emptyBody, { color: palette.textSecondary }]}>
                Complete your first local quest and pass AI verification to earn an animated stamp and USD reward.
              </Text>
              <Button
                label="Explore Nearby Quests"
                onPress={() => router.replace('/(tabs)')}
                style={styles.exploreBtn}
              />
            </Card>
          ) : (
            <View style={styles.grid}>
              {stamps.map((stamp) => (
                <View
                  key={stamp.id}
                  style={[
                    styles.gridItem,
                    { width: columns === 3 ? '31.5%' : '48%' },
                  ]}
                >
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
  },
  heading: {
    fontFamily: fonts.serif,
    fontSize: 28,
    color: colors.textPrimary,
    marginTop: 6,
  },
  subheading: {
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 4,
    marginBottom: 16,
  },
  summaryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    backgroundColor: colors.bgSage,
    marginBottom: 18,
  },
  statItem: {
    alignItems: 'center',
  },
  statValue: {
    fontFamily: fonts.serif,
    fontSize: 24,
    color: colors.primaryDark,
  },
  statLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  divider: {
    width: 1,
    height: 36,
    backgroundColor: colors.border,
  },
  emptyCard: {
    alignItems: 'center',
    paddingVertical: 28,
    paddingHorizontal: 20,
    gap: 10,
  },
  emptyIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    fontFamily: fonts.serif,
    fontSize: 20,
    color: colors.textPrimary,
  },
  emptyBody: {
    fontFamily: fonts.sans,
    fontSize: 13.5,
    lineHeight: 20,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  exploreBtn: {
    marginTop: 8,
    paddingHorizontal: 26,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 12,
  },
  gridItem: {
    marginBottom: 4,
  },
});
