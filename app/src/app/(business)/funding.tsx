import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useRoamr } from '../../context/RoamrContext';
import {
  checkPayPalHealth,
  fetchPayPalLogs,
  fetchPayPalTransactions,
} from '../../services/api';
import { TopHeader } from '../../components/TopHeader';
import { LiquidBackdrop } from '../../components/LiquidBackdrop';
import { Card } from '../../components/Card';
import { Pill } from '../../components/Pill';
import { PayPalLogo } from '../../components/PayPalLogo';
import { Button } from '../../components/Button';
import { ResponsiveContainer } from '../../components/ResponsiveContainer';
import { formatInrApprox, formatMoney, usdToCents } from '../../../lib/currency';
import { colors, fonts, radii, shadows } from '../../theme/tokens';

export default function BusinessFundingTab() {
  const { ownerQuests, showInr, palette } = useRoamr();
  const [flipped, setFlipped] = useState(false);
  const flipProgress = useSharedValue(0);
  const [healthText, setHealthText] = useState<string | null>(null);
  const [healthOk, setHealthOk] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(false);
  const [fundingOrders, setFundingOrders] = useState<
    {
      id: string;
      captureId: string;
      questId: string;
      questTitle: string;
      amountUsd: number;
      status: string;
      simulated: boolean;
      debugId?: string | null;
      createdAt: string;
    }[]
  >([]);
  const [logs, setLogs] = useState<
    {
      id: string;
      timestamp: string;
      method: string;
      url: string;
      status: number;
      debugId?: string | null;
      simulated: boolean;
      summary: string;
    }[]
  >([]);

  const totals = useMemo(() => {
    const totalBudgetCents = ownerQuests.reduce(
      (s, q) => s + (q.budgetCents ?? usdToCents(q.budgetUsd || 0)),
      0
    );
    const totalSpentCents = ownerQuests.reduce(
      (s, q) => s + (q.spentCents ?? usdToCents(q.spentUsd || 0)),
      0
    );
    const activeBudgetCents = Math.max(0, totalBudgetCents - totalSpentCents);
    const fundedCount = ownerQuests.filter((q) => q.funded).length;
    const travelersPaid = ownerQuests.reduce((s, q) => s + (q.verifiedVisits || 0), 0);
    const pendingReviewCount = 0;
    return {
      totalBudgetCents,
      activeBudgetCents,
      totalSpentCents,
      fundedCount,
      travelersPaid,
      pendingReviewCount,
    };
  }, [ownerQuests]);

  const handleToggleFlip = () => {
    Haptics.selectionAsync().catch(() => {});
    const next = !flipped;
    setFlipped(next);
    flipProgress.value = withSpring(next ? 180 : 0, {
      damping: 16,
      stiffness: 170,
      mass: 0.9,
    });
  };

  const frontStyle = useAnimatedStyle(() => ({
    transform: [
      { perspective: 1000 },
      { rotateY: `${flipProgress.value}deg` },
      { scale: interpolate(flipProgress.value, [0, 90, 180], [1, 0.96, 1]) },
    ],
  }));

  const backStyle = useAnimatedStyle(() => ({
    transform: [
      { perspective: 1000 },
      { rotateY: `${flipProgress.value + 180}deg` },
      { scale: interpolate(flipProgress.value, [0, 90, 180], [1, 0.96, 1]) },
    ],
  }));

  const loadData = useCallback(async () => {
    try {
      const [logRes, txRes] = await Promise.all([
        fetchPayPalLogs(),
        fetchPayPalTransactions(),
      ]);
      setLogs(logRes.logs || []);
      setFundingOrders(txRes.fundingOrders || []);
    } catch {
      // Ignore offline fetch error
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const handleCheckPayPal = async () => {
    setChecking(true);
    try {
      const res = await checkPayPalHealth();
      setHealthOk(res.ok);
      setHealthText(
        res.ok
          ? `Connected to ${res.baseUrl} (HTTP ${res.status}, debug_id: ${res.debugId || 'none'})`
          : `Error (${res.status}): ${res.error}`
      );
      await loadData();
    } catch (err) {
      setHealthOk(false);
      setHealthText(err instanceof Error ? err.message : 'Unable to reach /api/paypal/health');
    } finally {
      setChecking(false);
    }
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.bgCream }]} edges={['top']}>
      <LiquidBackdrop variant="business" />
      <ResponsiveContainer maxWidth={860}>
        <TopHeader />
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={styles.headingRow}>
            <PayPalLogo size={22} variant="badge" />
            <Text style={[styles.heading, { color: palette.textPrimary }]}>PayPal Funding</Text>
          </View>
          <Text style={[styles.subheading, { color: palette.textSecondary }]}>
            Fund quest budgets via PayPal Orders v2 and track payments sent. Payouts are made in USD (PayPal Sandbox).
          </Text>

          {/* 3D Flip Budget Card: Front = Active Budget, Back = Paid to Travelers + Count */}
          <Pressable
            onPress={handleToggleFlip}
            style={styles.flipContainer}
            accessibilityRole="button"
            accessibilityLabel="Tap to flip between Active Budget and Paid to Travelers"
          >
            <Animated.View
              style={[
                styles.flipCard,
                styles.flipFront,
                { backgroundColor: palette.primary, borderColor: palette.primaryDark },
                frontStyle,
              ]}
              pointerEvents={flipped ? 'none' : 'auto'}
            >
              <View style={styles.flipTopRow}>
                <Text style={styles.escrowLabel}>Active Escrow Budget</Text>
                <View style={styles.flipHintChip}>
                  <Ionicons name="sync" size={12} color={palette.white} />
                  <Text style={styles.flipHintText}>Tap to flip</Text>
                </View>
              </View>
              <Text style={styles.escrowValue}>
                {formatMoney(totals.activeBudgetCents, { showInr: false })}{' '}
                <Text style={styles.escrowCurrency}>
                  USD{showInr ? ` (${formatInrApprox(totals.activeBudgetCents)})` : ''}
                </Text>
              </Text>
              <View style={styles.flipMetaRow}>
                <Text style={styles.flipMetaText}>
                  Total Pool: {formatMoney(totals.totalBudgetCents, { showInr })}
                </Text>
                <Text style={styles.flipMetaDot}>•</Text>
                <Text style={styles.flipMetaText}>
                  {totals.fundedCount} Funded Quests
                </Text>
              </View>
            </Animated.View>

            <Animated.View
              style={[styles.flipCard, styles.flipBack, backStyle]}
              pointerEvents={flipped ? 'auto' : 'none'}
            >
              <View style={styles.flipTopRow}>
                <Text style={styles.escrowLabel}>Paid to Travelers</Text>
                <View style={styles.flipHintChip}>
                  <Ionicons name="sync" size={12} color={palette.white} />
                  <Text style={styles.flipHintText}>Tap to flip</Text>
                </View>
              </View>
              <Text style={styles.escrowValue}>
                {formatMoney(totals.totalSpentCents, { showInr: false })}{' '}
                <Text style={styles.escrowCurrency}>
                  USD{showInr ? ` (${formatInrApprox(totals.totalSpentCents)})` : ''}
                </Text>
              </Text>
              <View style={styles.flipMetaRow}>
                <Ionicons name="people" size={14} color={colors.goldSoft} />
                <Text style={styles.flipMetaText}>
                  {totals.travelersPaid}{' '}
                  {totals.travelersPaid === 1 ? 'traveler paid' : 'travelers paid'}
                </Text>
                {totals.pendingReviewCount > 0 ? (
                  <>
                    <Text style={styles.flipMetaDot}>•</Text>
                    <Text style={[styles.flipMetaText, { color: colors.goldSoft }]}>
                      {totals.pendingReviewCount} pending review
                    </Text>
                  </>
                ) : null}
              </View>
            </Animated.View>
          </Pressable>

          {/* PayPal OAuth Health Card */}
          <Card style={styles.healthCard}>
            <View style={styles.healthHeader}>
              <View style={styles.healthTitleRow}>
                <PayPalLogo size={17} variant="badge" />
                <Text style={[styles.cardTitle, { color: palette.textPrimary }]}>
                  PayPal Sandbox Health
                </Text>
              </View>
              {healthOk !== null ? (
                <Pill
                  label={healthOk ? 'OAuth OK' : 'Error'}
                  variant={healthOk ? 'success' : 'danger'}
                />
              ) : null}
            </View>
            {healthText ? (
              <Text
                style={[
                  styles.healthText,
                  { color: palette.primaryDark, backgroundColor: palette.bgSoft },
                  healthOk === false && { color: palette.danger },
                ]}
              >
                {healthText}
              </Text>
            ) : (
              <Text style={[styles.cardDesc, { color: palette.textSecondary }]}>
                Tests GET /api/paypal/health against PayPal Sandbox OAuth2.
              </Text>
            )}
            <Button
              label={checking ? 'Checking PayPal OAuth...' : 'Test PayPal Sandbox OAuth'}
              variant="paypal"
              loading={checking}
              onPress={handleCheckPayPal}
              icon={<PayPalLogo size={14} variant="badge" />}
              style={styles.healthBtn}
            />
          </Card>

          <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>
            Select Quest to Fund
          </Text>
          <View style={styles.list}>
            {ownerQuests.length === 0 ? (
              <Card>
                <Text style={[styles.cardDesc, { color: palette.textSecondary }]}>
                  You have no quests yet. Create one first to fund it.
                </Text>
              </Card>
            ) : (
              ownerQuests.slice(0, 6).map((q) => (
              <Card key={q.id} style={styles.questRow}>
                <View style={styles.questInfo}>
                  <Text style={[styles.questTitle, { color: palette.textPrimary }]} numberOfLines={1}>
                    {q.title}
                  </Text>
                  <Text style={[styles.questMeta, { color: palette.textSecondary }]}>
                    Budget: {formatMoney(q.budgetCents ?? usdToCents(q.budgetUsd || 50), { showInr })} •{' '}
                    {formatMoney(q.rewardCents ?? usdToCents(q.rewardUsd), { showInr })}/visit
                  </Text>
                  {q.paypalOrderId ? (
                    <Text style={[styles.orderTag, { color: palette.paypalBlue }]} numberOfLines={1}>
                      Last Order: {q.paypalOrderId}
                    </Text>
                  ) : null}
                </View>
                <Button
                  label="Fund"
                  variant="paypal"
                  icon={<PayPalLogo size={13} variant="badge" />}
                  onPress={() =>
                    router.push({
                      pathname: '/business/fund',
                      params: { id: q.id },
                    })
                  }
                  style={styles.miniBtn}
                />
              </Card>
              ))
            )}

          </View>

          <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>
            Payments Sent (PayPal Orders)
          </Text>
          {fundingOrders.length === 0 ? (
            <Card>
              <Text style={[styles.cardDesc, { color: palette.textSecondary }]}>
                No captured funding orders yet in this session. Tap "Fund" on any quest above to send a PayPal Sandbox order.
              </Text>
            </Card>
          ) : (
            <View style={styles.list}>
              {fundingOrders.map((ord) => (
                <Card key={`${ord.id}-${ord.createdAt}`} style={styles.logCard}>
                  <View style={styles.logTop}>
                    <Text style={[styles.questTitle, { color: palette.textPrimary }]}>
                      {ord.questTitle}
                    </Text>
                    <Text style={[styles.amountSent, { color: palette.textPrimary }]}>
                      {formatMoney(-usdToCents(ord.amountUsd), { showInr })}
                    </Text>
                  </View>
                  <View style={styles.logTop}>
                    <Pill
                      label={ord.simulated ? 'Simulated Order' : 'PayPal Sandbox Captured'}
                      variant={ord.simulated ? 'gold' : 'success'}
                      icon={!ord.simulated ? <PayPalLogo size={11} /> : undefined}
                    />
                    <Text style={[styles.debugId, { color: palette.textMuted }]}>Order: {ord.id}</Text>
                  </View>
                </Card>
              ))}
            </View>
          )}

          <View style={styles.logHeader}>
            <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>
              Recent PayPal API Logs
            </Text>
            <Button
              label="Refresh"
              variant="outline"
              onPress={loadData}
              style={styles.refreshBtn}
            />
          </View>

          {logs.length === 0 ? (
            <Card>
              <Text style={[styles.cardDesc, { color: palette.textSecondary }]}>
                No PayPal calls recorded yet on the running server.
              </Text>
            </Card>
          ) : (
            <View style={styles.list}>
              {logs.slice(0, 6).map((log) => (
                <Card key={log.id} style={styles.logCard}>
                  <View style={styles.logTop}>
                    <Pill
                      label={`${log.method} ${log.status}`}
                      variant={log.status >= 400 ? 'danger' : log.simulated ? 'gold' : 'paypal'}
                    />
                    <Text style={[styles.debugId, { color: palette.textMuted }]}>
                      debug_id: {log.debugId || 'none'}
                    </Text>
                  </View>
                  <Text style={[styles.logUrl, { color: palette.textSecondary }]} numberOfLines={1}>
                    {log.url}
                  </Text>
                  <Text style={[styles.logSummary, { color: palette.textPrimary }]}>
                    {log.summary}
                  </Text>
                </Card>
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
    gap: 14,
  },
  headingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 4,
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
  },
  flipContainer: {
    height: 142,
    position: 'relative',
  },
  flipCard: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: radii.xl,
    padding: 20,
    justifyContent: 'space-between',
    backfaceVisibility: 'hidden',
    borderWidth: 1,
    ...shadows.card,
  },
  flipFront: {
    backgroundColor: colors.primary,
    borderColor: colors.primaryDark,
  },
  flipBack: {
    backgroundColor: '#114A6E',
    borderColor: '#0A3550',
  },
  flipTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  flipHintChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radii.pill,
  },
  flipHintText: {
    fontFamily: fonts.sansSemi,
    fontSize: 11,
    color: colors.white,
  },
  escrowLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    color: 'rgba(255,255,255,0.86)',
  },
  escrowValue: {
    fontFamily: fonts.serif,
    fontSize: 34,
    color: colors.white,
  },
  escrowCurrency: {
    fontFamily: fonts.sansSemi,
    fontSize: 15,
    color: 'rgba(255,255,255,0.85)',
  },
  flipMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  flipMetaText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12.5,
    color: 'rgba(255,255,255,0.9)',
  },
  flipMetaDot: {
    color: 'rgba(255,255,255,0.5)',
  },
  healthCard: {
    gap: 10,
    borderColor: 'rgba(0, 112, 186, 0.28)',
  },
  healthHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  healthTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardTitle: {
    fontFamily: fonts.serif,
    fontSize: 18,
    color: colors.textPrimary,
  },
  cardDesc: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.textSecondary,
  },
  healthText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12.5,
    color: colors.primaryDark,
    backgroundColor: colors.bgCream,
    padding: 10,
    borderRadius: radii.sm,
  },
  healthBtn: {
    height: 44,
  },
  sectionTitle: {
    fontFamily: fonts.serif,
    fontSize: 20,
    color: colors.textPrimary,
    marginTop: 4,
  },
  list: {
    gap: 10,
  },
  questRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  questInfo: {
    flex: 1,
  },
  questTitle: {
    fontFamily: fonts.sansSemi,
    fontSize: 15,
    color: colors.textPrimary,
  },
  questMeta: {
    fontFamily: fonts.sans,
    fontSize: 12.5,
    color: colors.textSecondary,
    marginTop: 2,
  },
  orderTag: {
    fontFamily: fonts.sansMedium,
    fontSize: 11,
    color: colors.paypalBlue,
    marginTop: 2,
  },
  amountSent: {
    fontFamily: fonts.serif,
    fontSize: 18,
    color: colors.textPrimary,
  },
  miniBtn: {
    height: 38,
    paddingHorizontal: 16,
  },
  logHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  refreshBtn: {
    height: 34,
    paddingHorizontal: 14,
  },
  logCard: {
    gap: 6,
  },
  logTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  debugId: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.textMuted,
  },
  logUrl: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    color: colors.textSecondary,
  },
  logSummary: {
    fontFamily: fonts.sans,
    fontSize: 12.5,
    color: colors.textPrimary,
  },
});
