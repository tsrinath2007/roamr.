import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, PanResponder, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useRoamr } from '../../context/RoamrContext';
import {
  buildRealExplorerLeaderboard,
  getExplorerLevel,
  RemoteExplorerRow,
} from '../../data/leaderboard';
import { fetchRealLeaderboardFromSupabase } from '../../services/supabase';
import { TopHeader } from '../../components/TopHeader';
import { Card } from '../../components/Card';
import { GlassSurface } from '../../components/GlassSurface';
import { LiquidBackdrop } from '../../components/LiquidBackdrop';
import { RollingBalanceText } from '../../components/RollingBalanceText';
import { Pill } from '../../components/Pill';
import { PayPalLogo } from '../../components/PayPalLogo';
import { ClaimStatusTracker } from '../../components/ClaimStatusTracker';
import { formatInrApprox, formatMoney, usdToCents } from '../../../lib/currency';
import { Button } from '../../components/Button';
import { ResponsiveContainer } from '../../components/ResponsiveContainer';
import { colors, fonts, radii } from '../../theme/tokens';

function getPayoutBadgeVariant(status: string) {
  const upper = status.toUpperCase();
  if (upper === 'SUCCESS') return 'success';
  if (upper.includes('SIMULATED')) return 'gold';
  if (upper === 'DENIED' || upper === 'FAILED') return 'danger';
  return 'paypal';
}

export default function WalletScreen() {
  const {
    userProfile,
    walletBalanceCents,
    walletBalanceUsd,
    totalXp,
    stamps,
    city,
    payouts,
    submissions,
    claims,
    paypalEmail,
    showInr,
    palette,
    isDark,
    refreshClaims,
    refreshPayoutStatus,
    retryPayout,
  } = useRoamr();
  const pendingSubs = submissions.filter((s) => s.status === 'pending_review');
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [balanceRevealed, setBalanceRevealed] = useState(false);
  const [showingXp, setShowingXp] = useState(false);
  const [boardScope, setBoardScope] = useState<'city' | 'global'>('global');
  const [remoteExplorers, setRemoteExplorers] = useState<RemoteExplorerRow[]>([]);

  const loadLeaderboard = useCallback(async () => {
    const rows = await fetchRealLeaderboardFromSupabase();
    setRemoteExplorers(rows);
  }, []);

  useEffect(() => {
    void loadLeaderboard();
  }, [loadLeaderboard, showingXp, totalXp]);

  const cardWidthRef = useRef(340);
  const flipDeg = useSharedValue(0);
  const targetDegRef = useRef(0);
  const startDegRef = useRef(0);
  const crossedMidRef = useRef(false);

  const levelInfo = useMemo(() => getExplorerLevel(totalXp), [totalXp]);
  const xpSpan = Math.max(1, levelInfo.next - levelInfo.floor);
  const xpPct = Math.min(100, Math.max(5, Math.round(((totalXp - levelInfo.floor) / xpSpan) * 100)));
  const placesVisited = useMemo(() => new Set(stamps.map((s) => s.businessName)).size, [stamps]);

  const leaderboard = useMemo(
    () =>
      buildRealExplorerLeaderboard({
        remoteExplorers,
        currentUserId: userProfile?.id,
        userName: userProfile?.name,
        userAvatar: userProfile?.avatar,
        userCity: city,
        totalXp,
        stampsCount: stamps.length,
        scope: boardScope,
      }),
    [
      remoteExplorers,
      userProfile?.id,
      userProfile?.name,
      userProfile?.avatar,
      city,
      totalXp,
      stamps.length,
      boardScope,
    ]
  );

  // Horizontal finger-swipe rotates the 3D Liquid Glass card; taps are left free to reveal USD amount.
  const swipeFlipResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gs) =>
          Math.abs(gs.dx) > 10 && Math.abs(gs.dx) > Math.abs(gs.dy) * 1.25,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          startDegRef.current = targetDegRef.current;
          crossedMidRef.current = false;
        },
        onPanResponderMove: (_, gs) => {
          const width = Math.max(cardWidthRef.current, 240);
          const nextDeg = startDegRef.current + (gs.dx / width) * 180;
          flipDeg.value = nextDeg;
          if (!crossedMidRef.current && Math.abs(nextDeg - startDegRef.current) >= 90) {
            crossedMidRef.current = true;
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
          }
        },
        onPanResponderRelease: (_, gs) => {
          const width = Math.max(cardWidthRef.current, 240);
          const dragDeg = (gs.dx / width) * 180;
          const shouldFlip = Math.abs(dragDeg) >= 50 || Math.abs(gs.vx) >= 0.35;
          let snapped = startDegRef.current;
          if (shouldFlip) {
            const dir = gs.dx !== 0 ? Math.sign(gs.dx) : Math.sign(gs.vx) || 1;
            snapped = startDegRef.current + dir * 180;
            Haptics.selectionAsync().catch(() => {});
          }
          targetDegRef.current = snapped;
          flipDeg.value = withSpring(snapped, { damping: 16, stiffness: 175, mass: 0.85 });
          const isBack = ((Math.round(snapped / 180) % 2) + 2) % 2 === 1;
          setShowingXp(isBack);
        },
        onPanResponderTerminate: () => {
          flipDeg.value = withSpring(startDegRef.current, {
            damping: 16,
            stiffness: 175,
            mass: 0.85,
          });
        },
      }),
    [flipDeg]
  );

  const frontCardStyle = useAnimatedStyle(() => {
    const mod = ((flipDeg.value % 360) + 360) % 360;
    const isFront = mod < 90 || mod > 270;
    return {
      transform: [{ perspective: 1100 }, { rotateY: `${flipDeg.value}deg` }],
      opacity: isFront ? 1 : 0,
    };
  });

  const backCardStyle = useAnimatedStyle(() => {
    const mod = ((flipDeg.value % 360) + 360) % 360;
    const isBack = mod >= 90 && mod <= 270;
    return {
      transform: [{ perspective: 1100 }, { rotateY: `${flipDeg.value + 180}deg` }],
      opacity: isBack ? 1 : 0,
    };
  });

  const toggleBalanceReveal = () => {
    Haptics.selectionAsync().catch(() => {});
    setBalanceRevealed((v) => !v);
  };

  const handleRefresh = async (id: string) => {
    setRefreshingId(id);
    await refreshPayoutStatus(id);
    setRefreshingId(null);
  };

  const handleRetry = async (id: string) => {
    setRefreshingId(id);
    await retryPayout(id);
    setRefreshingId(null);
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.bgCream }]} edges={['top']}>
      <LiquidBackdrop variant="traveler" />
      <ResponsiveContainer maxWidth={760}>
        <TopHeader />
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={styles.headingRow}>
            {!showingXp ? <PayPalLogo size={22} variant="badge" /> : null}
            <Text style={[styles.heading, { color: palette.textPrimary }]}>
              {showingXp ? 'Explorer XP & Rank' : 'PayPal Wallet'}
            </Text>
          </View>
          <Text style={[styles.subheading, { color: palette.textSecondary }]}>
            {showingXp
              ? `Rank #${leaderboard.currentUserRank} in ${boardScope === 'city' ? city : 'Explorer Community'} • Swipe card horizontally to return to USD.`
              : 'Instant USD rewards sent to your PayPal account after AI verification.'}
          </Text>

          {/* 3D Finger-Swipe Card: Front = USD Balance (Tap reveals amount), Back = XP & Leaderboard */}
          <View
            style={styles.flipContainer}
            onLayout={(e) => {
              cardWidthRef.current = e.nativeEvent.layout.width;
            }}
            {...swipeFlipResponder.panHandlers}
          >
            {/* FRONT FACE — PayPal USD Earnings */}
            <Animated.View
              style={[
                styles.flipFace,
                { zIndex: showingXp ? 1 : 2 },
                frontCardStyle,
              ]}
              pointerEvents={showingXp ? 'none' : 'auto'}
            >
              <GlassSurface
                borderRadius={radii.xl}
                intensity={82}
                tone="forest"
                contentStyle={styles.balanceCardInner}
              >
                <View style={styles.balanceTop}>
                  <Pressable
                    onPress={toggleBalanceReveal}
                    style={styles.balancePressCol}
                    accessibilityLabel={
                      balanceRevealed ? 'Hide wallet balance' : 'Reveal wallet balance'
                    }
                  >
                    <View style={styles.balanceLabelRow}>
                      <Text style={styles.balanceLabel}>Total Quest Earnings</Text>
                      <View style={styles.revealHintPill}>
                        <Ionicons
                          name={balanceRevealed ? 'eye-outline' : 'eye-off-outline'}
                          size={12}
                          color={colors.white}
                        />
                        <Text style={styles.revealHintText}>
                          {balanceRevealed ? 'Hide' : 'Tap'}
                        </Text>
                      </View>
                    </View>
                    <RollingBalanceText
                      amountUsd={walletBalanceUsd}
                      revealed={balanceRevealed}
                    />
                    {balanceRevealed && showInr ? (
                      <Text style={styles.approxInrHero}>
                        {formatInrApprox(walletBalanceCents)} (approx.)
                      </Text>
                    ) : null}
                  </Pressable>
                  <View style={styles.paypalLogoCircle}>
                    <PayPalLogo size={25} />
                  </View>
                </View>

                <Pressable
                  onPress={() => router.push('/(tabs)/profile')}
                  style={styles.receiverRow}
                >
                  <PayPalLogo size={12} variant="badge" />
                  <Text style={styles.receiverText} numberOfLines={1}>
                    PayPal Receiver: {paypalEmail}
                  </Text>
                  <Text style={styles.editEmailTag}>Edit</Text>
                </Pressable>

                <View style={styles.cardBottomCueRow}>
                  <Text style={styles.sandboxUsdCaption}>
                    Payouts are made in USD (PayPal Sandbox)
                  </Text>
                  <View style={styles.swipeHintPill}>
                    <Ionicons name="swap-horizontal" size={12} color={colors.goldSoft} />
                    <Text style={styles.swipeHintText}>Swipe for XP</Text>
                  </View>
                </View>
              </GlassSurface>
            </Animated.View>

            {/* BACK FACE — Explorer XP, Level Progress & Leaderboard Rank */}
            <Animated.View
              style={[
                styles.flipFace,
                styles.flipBackAbsolute,
                { zIndex: showingXp ? 2 : 1 },
                backCardStyle,
              ]}
              pointerEvents={showingXp ? 'auto' : 'none'}
            >
              <GlassSurface
                borderRadius={radii.xl}
                intensity={82}
                tone="forest"
                contentStyle={styles.balanceCardInner}
              >
                <View style={styles.xpFaceHeader}>
                  <View style={styles.xpTitleBlock}>
                    <Text style={styles.balanceLabel}>
                      Level {levelInfo.level} • {levelInfo.title}
                    </Text>
                    <View style={styles.xpBigRow}>
                      <Text style={styles.xpHeroNumber}>{totalXp}</Text>
                      <Text style={styles.xpHeroUnit}>XP</Text>
                    </View>
                  </View>

                  <View style={styles.rankBadgeHero}>
                    <Ionicons name="trophy" size={15} color="#FFD86B" />
                    <Text style={styles.rankBadgeText}>#{leaderboard.currentUserRank}</Text>
                  </View>
                </View>

                {/* Progress toward next level */}
                <View style={styles.xpCardProgressWrap}>
                  <View style={styles.xpCardProgressLabels}>
                    <Text style={styles.xpProgressSub}>
                      {Math.max(0, levelInfo.next - totalXp)} XP to {levelInfo.nextTitle}
                    </Text>
                    <Text style={styles.xpProgressSub}>
                      {stamps.length} stamps • {placesVisited} places
                    </Text>
                  </View>
                  <View style={styles.xpCardTrack}>
                    <View style={[styles.xpCardFill, { width: `${xpPct}%` }]} />
                  </View>
                </View>

                <View style={styles.cardBottomCueRow}>
                  <Text style={styles.sandboxUsdCaption}>
                    {leaderboard.nextRival
                      ? `${leaderboard.xpToAbove} XP behind #${leaderboard.nextRival.rank} (${leaderboard.nextRival.name})`
                      : 'Top #1 explorer on the leaderboard!'}
                  </Text>
                  <View style={styles.swipeHintPill}>
                    <Ionicons name="swap-horizontal" size={12} color={colors.goldSoft} />
                    <Text style={styles.swipeHintText}>Swipe for USD</Text>
                  </View>
                </View>
              </GlassSurface>
            </Animated.View>
          </View>

          {showingXp ? (
            /* Explorer Leaderboard & Rank Ladder when card is turned to XP */
            <View style={styles.leaderboardSection}>
              <View style={styles.boardHeaderRow}>
                <View style={styles.boardTitleCol}>
                  <Text style={[styles.sectionTitle, { color: palette.textPrimary, marginBottom: 2 }]}>
                    Explorer Leaderboard
                  </Text>
                  <Text style={[styles.boardSubtitle, { color: palette.textSecondary }]}>
                    Complete quests & collect stamps to climb your rank
                  </Text>
                </View>

                <View
                  style={[
                    styles.scopeToggle,
                    { backgroundColor: palette.bgSage, borderColor: palette.border },
                  ]}
                >
                  {(['city', 'global'] as const).map((sc) => {
                    const active = boardScope === sc;
                    const cityChip = city && city.trim().length <= 9 ? city.trim() : 'Local';
                    return (
                      <Pressable
                        key={sc}
                        onPress={() => {
                          Haptics.selectionAsync().catch(() => {});
                          setBoardScope(sc);
                        }}
                        style={[
                          styles.scopeChip,
                          active && { backgroundColor: palette.primary },
                        ]}
                      >
                        <Text
                          style={[
                            styles.scopeText,
                            { color: active ? palette.white : palette.textSecondary },
                          ]}
                        >
                          {sc === 'city' ? cityChip : 'Global'}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              <View style={styles.list}>
                {leaderboard.entries.map((entry) => {
                  const isTop3 = entry.rank <= 3;
                  const medalColor =
                    entry.rank === 1
                      ? '#E5A93B'
                      : entry.rank === 2
                      ? '#9BA8B5'
                      : entry.rank === 3
                      ? '#C47D4D'
                      : palette.textMuted;
                  return (
                    <Card
                      key={entry.id}
                      style={[
                        styles.leaderRowCard,
                        entry.isCurrentUser && {
                          borderColor: palette.primary,
                          backgroundColor: isDark ? '#182D21' : palette.primarySoft,
                        },
                      ]}
                    >
                      <View
                        style={[
                          styles.rankNumBox,
                          {
                            backgroundColor: isTop3
                              ? isDark
                                ? 'rgba(244, 185, 66, 0.16)'
                                : palette.goldSoft
                              : palette.bgSoft,
                          },
                        ]}
                      >
                        {isTop3 ? (
                          <Ionicons name="trophy" size={14} color={medalColor} />
                        ) : (
                          <Text style={[styles.rankNumText, { color: palette.textSecondary }]}>
                            #{entry.rank}
                          </Text>
                        )}
                      </View>

                      {entry.avatar ? (
                        <Image source={{ uri: entry.avatar }} style={styles.leaderAvatar} />
                      ) : (
                        <View
                          style={[styles.leaderAvatarFallback, { backgroundColor: palette.primary }]}
                        >
                          <Ionicons name="compass" size={16} color={palette.white} />
                        </View>
                      )}

                      <View style={styles.leaderInfoCol}>
                        <View style={styles.leaderNameRow}>
                          <Text
                            style={[styles.leaderName, { color: palette.textPrimary }]}
                            numberOfLines={1}
                          >
                            {entry.name}
                          </Text>
                          {entry.isCurrentUser ? <Pill label="You" variant="success" /> : null}
                        </View>
                        <Text
                          style={[styles.leaderMeta, { color: palette.textSecondary }]}
                          numberOfLines={1}
                        >
                          {entry.levelTitle} • {entry.stampsCount}{' '}
                          {entry.stampsCount === 1 ? 'stamp' : 'stamps'} • {entry.city}
                        </Text>
                      </View>

                      <View style={styles.leaderXpCol}>
                        <Text style={[styles.leaderXpVal, { color: palette.primary }]}>
                          {entry.xp} XP
                        </Text>
                        <Text style={[styles.leaderRankSub, { color: palette.textMuted }]}>
                          Rank #{entry.rank}
                        </Text>
                      </View>
                    </Card>
                  );
                })}
                {leaderboard.entries.length <= 1 ? (
                  <Card style={styles.realBoardHintCard}>
                    <Text style={[styles.realBoardHintText, { color: palette.textSecondary }]}>
                      Live Supabase leaderboard: only your account is ranked right now. Other explorers appear here automatically once they sign in and earn XP.
                    </Text>
                  </Card>
                ) : null}
              </View>
            </View>
          ) : (
            <>
              {claims.length > 0 ? (
                <>
                  <View style={styles.claimsHeaderRow}>
                    <Text style={[styles.sectionTitle, { color: palette.textPrimary, marginBottom: 0 }]}>
                      Quest Claim Tracker
                    </Text>
                    <Pressable onPress={() => void refreshClaims()} hitSlop={8}>
                      <Ionicons name="refresh" size={17} color={palette.primary} />
                    </Pressable>
                  </View>
                  <View style={[styles.list, { marginBottom: 18 }]}>
                    {claims.slice(0, 5).map((claim) => (
                      <Card key={claim.id} style={styles.payoutCard}>
                        <View style={styles.payoutTop}>
                          <View style={styles.payoutInfo}>
                            <Text
                              style={[styles.payoutTitle, { color: palette.textPrimary }]}
                              numberOfLines={1}
                            >
                              {claim.questTitle}
                            </Text>
                            <Text style={[styles.payoutMeta, { color: palette.textMuted }]}>
                              Order {claim.order?.orderId || 'N/A'} •{' '}
                              {typeof claim.distanceMeters === 'number'
                                ? `${claim.distanceMeters} m`
                                : 'GPS'}
                            </Text>
                          </View>
                          <Text style={[styles.payoutAmount, { color: palette.primary }]}>
                            +{formatMoney(usdToCents(claim.rewardUsd), { showInr })}
                          </Text>
                        </View>
                        <ClaimStatusTracker claim={claim} />
                      </Card>
                    ))}
                  </View>
                </>
              ) : null}

              {pendingSubs.length > 0 ? (
                <>
                  <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>
                    Pending Owner Approval
                  </Text>
                  <View style={[styles.list, { marginBottom: 18 }]}>
                    {pendingSubs.map((sub) => (
                      <Card key={sub.id} style={styles.payoutCard}>
                        <View style={styles.payoutTop}>
                          <View style={styles.payoutInfo}>
                            <Text
                              style={[styles.payoutTitle, { color: palette.textPrimary }]}
                              numberOfLines={1}
                            >
                              {sub.questTitle}
                            </Text>
                            <Text style={[styles.payoutMeta, { color: palette.textMuted }]}>
                              {sub.businessName} • AI Passed ({Math.round(sub.aiConfidence * 100)}%)
                            </Text>
                          </View>
                          <Text style={[styles.payoutAmount, { color: palette.primary }]}>
                            +{formatMoney(sub.rewardCents ?? usdToCents(sub.rewardUsd), { showInr })}
                          </Text>
                        </View>
                        <View style={styles.badgesRow}>
                          <Pill label="Awaiting Human Review" variant="gold" />
                        </View>
                      </Card>
                    ))}
                  </View>
                </>
              ) : null}

              <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>
                Payout History
              </Text>

              {payouts.length === 0 ? (
                <Card style={styles.emptyCard}>
                  <Ionicons name="cash-outline" size={30} color={palette.primary} />
                  <Text style={[styles.emptyTitle, { color: palette.textPrimary }]}>
                    No payouts yet
                  </Text>
                  <Text style={[styles.emptyBody, { color: palette.textSecondary }]}>
                    Complete a funded quest and verify your visit photo to receive your first PayPal USD payout.
                  </Text>
                  <Button
                    label="Find Funded Quests"
                    onPress={() => router.replace('/(tabs)')}
                    style={styles.emptyBtn}
                  />
                </Card>
              ) : (
                <View style={styles.list}>
                  {payouts.map((item) => (
                    <Card key={item.id} style={styles.payoutCard}>
                      <View style={styles.payoutTop}>
                        <View style={styles.payoutInfo}>
                          <Text
                            style={[styles.payoutTitle, { color: palette.textPrimary }]}
                            numberOfLines={1}
                          >
                            {item.questTitle}
                          </Text>
                          <Text style={[styles.payoutMeta, { color: palette.textMuted }]}>
                            {new Date(item.createdAt).toLocaleString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              hour: 'numeric',
                              minute: '2-digit',
                            })}{' '}
                            • Batch {item.id.slice(0, 14)}
                          </Text>
                        </View>
                        <Text style={[styles.payoutAmount, { color: palette.primary }]}>
                          +{formatMoney(item.amountCents ?? usdToCents(item.amountUsd), { showInr })}
                        </Text>
                      </View>

                      <View style={styles.payoutFooter}>
                        <View style={styles.badgesRow}>
                          <Pill
                            label={item.status}
                            variant={getPayoutBadgeVariant(item.status)}
                          />
                          {item.simulated ? (
                            <Pill
                              label="Sandbox Payout (Simulated)"
                              variant="paypal"
                              icon={<PayPalLogo size={11} />}
                            />
                          ) : (
                            <Pill
                              label="PayPal Sandbox Live"
                              variant="success"
                              icon={<PayPalLogo size={11} />}
                            />
                          )}
                        </View>

                        {!item.simulated ? (
                          <Pressable
                            onPress={() => handleRefresh(item.id)}
                            style={styles.refreshBtn}
                          >
                            <Ionicons
                              name="refresh"
                              size={14}
                              color={palette.primary}
                            />
                            <Text style={[styles.refreshText, { color: palette.primary }]}>
                              {refreshingId === item.id ? 'Checking...' : 'Check status'}
                            </Text>
                          </Pressable>
                        ) : item.id.startsWith('SIM-LOCAL-') ? (
                          <Pressable
                            onPress={() => handleRetry(item.id)}
                            style={styles.refreshBtn}
                          >
                            <Ionicons name="sync" size={14} color={palette.paypalBlue} />
                            <Text style={[styles.refreshText, { color: palette.paypalBlue }]}>
                              {refreshingId === item.id ? 'Retrying...' : 'Retry via Server'}
                            </Text>
                          </Pressable>
                        ) : null}
                      </View>
                      {item.message ? (
                        <Text style={[styles.payoutNote, { color: palette.textSecondary }]}>
                          {item.message}
                        </Text>
                      ) : null}
                    </Card>
                  ))}
                </View>
              )}
            </>
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
  headingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 6,
  },
  heading: {
    fontFamily: fonts.serif,
    fontSize: 28,
    color: colors.textPrimary,
  },
  subheading: {
    fontFamily: fonts.sans,
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 4,
    marginBottom: 16,
  },
  flipContainer: {
    position: 'relative',
    minHeight: 196,
    marginBottom: 22,
  },
  flipFace: {
    width: '100%',
    minHeight: 196,
    backfaceVisibility: 'hidden',
  },
  flipBackAbsolute: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  balanceCardInner: {
    padding: 20,
    minHeight: 196,
    justifyContent: 'space-between',
  },
  balanceTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  balancePressCol: {
    flex: 1,
    paddingRight: 10,
  },
  balanceLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  revealHintPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
    borderRadius: radii.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  revealHintText: {
    fontFamily: fonts.sansSemi,
    fontSize: 10.5,
    color: colors.white,
  },
  balanceLabel: {
    fontFamily: fonts.sansMedium,
    fontSize: 13,
    color: 'rgba(255,255,255,0.82)',
  },
  paypalLogoCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  paypalP: {
    fontFamily: fonts.serif,
    fontSize: 24,
    color: colors.paypalBlue,
  },
  receiverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 14,
    backgroundColor: 'rgba(255,255,255,0.14)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radii.pill,
    alignSelf: 'flex-start',
  },
  receiverText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    color: colors.white,
    flexShrink: 1,
  },
  editEmailTag: {
    fontFamily: fonts.sansBold,
    fontSize: 11,
    color: colors.goldSoft,
    marginLeft: 6,
    textDecorationLine: 'underline',
  },
  approxInrHero: {
    fontFamily: fonts.sansMedium,
    fontSize: 12.5,
    color: colors.goldSoft,
    marginTop: 2,
  },
  cardBottomCueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 10,
  },
  sandboxUsdCaption: {
    flex: 1,
    fontFamily: fonts.sans,
    fontSize: 11,
    color: 'rgba(255,255,255,0.78)',
  },
  swipeHintPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
    borderRadius: radii.pill,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  swipeHintText: {
    fontFamily: fonts.sansSemi,
    fontSize: 10.5,
    color: colors.goldSoft,
  },
  xpFaceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  xpTitleBlock: {
    flex: 1,
  },
  xpBigRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
    marginTop: 4,
  },
  xpHeroNumber: {
    fontFamily: fonts.serif,
    fontSize: 38,
    lineHeight: 42,
    color: colors.white,
  },
  xpHeroUnit: {
    fontFamily: fonts.sansBold,
    fontSize: 15,
    color: colors.goldSoft,
  },
  rankBadgeHero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255, 216, 107, 0.16)',
    borderWidth: 1,
    borderColor: 'rgba(255, 216, 107, 0.36)',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radii.pill,
  },
  rankBadgeText: {
    fontFamily: fonts.sansBold,
    fontSize: 14,
    color: '#FFD86B',
  },
  xpCardProgressWrap: {
    marginTop: 12,
    gap: 6,
  },
  xpCardProgressLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  xpProgressSub: {
    fontFamily: fonts.sansMedium,
    fontSize: 11.5,
    color: 'rgba(255, 255, 255, 0.84)',
  },
  xpCardTrack: {
    height: 7,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    overflow: 'hidden',
  },
  xpCardFill: {
    height: '100%',
    borderRadius: radii.pill,
    backgroundColor: '#FFD86B',
  },
  leaderboardSection: {
    gap: 12,
  },
  boardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
  },
  boardTitleCol: {
    flex: 1,
    minWidth: 0,
  },
  boardSubtitle: {
    fontFamily: fonts.sans,
    fontSize: 12.5,
  },
  scopeToggle: {
    flexDirection: 'row',
    flexShrink: 0,
    borderRadius: radii.pill,
    borderWidth: 1,
    padding: 3,
    gap: 2,
  },
  scopeChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radii.pill,
  },
  scopeText: {
    fontFamily: fonts.sansSemi,
    fontSize: 11.5,
  },
  leaderRowCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
  },
  rankNumBox: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankNumText: {
    fontFamily: fonts.sansBold,
    fontSize: 12,
  },
  leaderAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
  },
  leaderAvatarFallback: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  leaderInfoCol: {
    flex: 1,
    gap: 2,
  },
  leaderNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  leaderName: {
    fontFamily: fonts.sansSemi,
    fontSize: 14.5,
    flexShrink: 1,
  },
  leaderMeta: {
    fontFamily: fonts.sans,
    fontSize: 12,
  },
  leaderXpCol: {
    alignItems: 'flex-end',
  },
  leaderXpVal: {
    fontFamily: fonts.serif,
    fontSize: 16.5,
  },
  leaderRankSub: {
    fontFamily: fonts.sans,
    fontSize: 10.5,
  },
  realBoardHintCard: {
    paddingVertical: 12,
  },
  realBoardHintText: {
    fontFamily: fonts.sans,
    fontSize: 12.5,
    lineHeight: 18,
  },
  sectionTitle: {
    fontFamily: fonts.serif,
    fontSize: 20,
    color: colors.textPrimary,
    marginBottom: 12,
  },
  claimsHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  emptyCard: {
    alignItems: 'center',
    paddingVertical: 28,
    gap: 8,
  },
  emptyTitle: {
    fontFamily: fonts.serif,
    fontSize: 19,
    color: colors.textPrimary,
  },
  emptyBody: {
    fontFamily: fonts.sans,
    fontSize: 13.5,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  emptyBtn: {
    marginTop: 8,
    paddingHorizontal: 24,
  },
  list: {
    gap: 12,
  },
  payoutCard: {
    gap: 12,
  },
  payoutTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10,
  },
  payoutInfo: {
    flex: 1,
  },
  payoutTitle: {
    fontFamily: fonts.sansSemi,
    fontSize: 15.5,
    color: colors.textPrimary,
  },
  payoutMeta: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 3,
  },
  payoutAmount: {
    fontFamily: fonts.serif,
    fontSize: 20,
    color: colors.primary,
  },
  payoutFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
  },
  badgesRow: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
  },
  refreshBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  refreshText: {
    fontFamily: fonts.sansSemi,
    fontSize: 12,
    color: colors.primary,
  },
  payoutNote: {
    fontFamily: fonts.sans,
    fontSize: 11.5,
    lineHeight: 16,
    color: colors.textSecondary,
  },
});
