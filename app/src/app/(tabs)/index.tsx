import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { setStatusBarStyle } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useRoamr } from '../../context/RoamrContext';
import { formatMoney, usdToCents } from '../../../lib/currency';
import { TopHeader } from '../../components/TopHeader';
import { GlobeMap, GlobeMapHandle } from '../../components/GlobeMap';
import { QuestCard } from '../../components/QuestCard';
import { Pill } from '../../components/Pill';
import { Button } from '../../components/Button';
import { ResponsiveContainer } from '../../components/ResponsiveContainer';
import { colors, fonts, radii, shadows } from '../../theme/tokens';

const CATEGORIES = [
  'All',
  'Cafe',
  'Food',
  'Nature',
  'History',
  'Shop',
  'Nightlife',
] as const;

function normalizeCategoryText(val?: string | null): string {
  return String(val || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function matchesQuestCategory(questCategory: string, nightOnly: boolean | undefined, filter: string): boolean {
  if (filter === 'All') return true;
  const c = normalizeCategoryText(questCategory);
  switch (filter) {
    case 'Cafe':
      return /cafe|coffee|bakery/.test(c);
    case 'Food':
      return /restaurant|pizz|burger|biryani|dessert|food/.test(c);
    case 'Nature':
      return /park|lake|garden|nature|viewpoint/.test(c);
    case 'History':
      return /museum|gallery|landmark|heritage|cathedral|history/.test(c);
    case 'Shop':
      return /market|bookstore|shop|arcade|bowling/.test(c);
    case 'Nightlife':
      return Boolean(nightOnly) || /night|bar|pub/.test(c);
    default:
      return c.includes(filter.toLowerCase());
  }
}

export default function MapScreen() {
  const {
    places,
    quests,
    userCoords,
    refreshLocation,
    selectedQuestId,
    setSelectedQuestId,
    bookmarkedIds,
    toggleBookmark,
    onboardingDone,
    lightPreset,
    setLightPreset,
    mapProjection,
    enable3D,
    showInr,
    isDark,
    palette,
  } = useRoamr();

  const globeRef = useRef<GlobeMapHandle | null>(null);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [paidOnly, setPaidOnly] = useState(false);
  const [xpOnly, setXpOnly] = useState(false);
  const [isCityView, setIsCityView] = useState(false);
  const [showFilters, setShowFilters] = useState(true);
  const [showRecommended, setShowRecommended] = useState(false);
  const [overlayTop, setOverlayTop] = useState(146);

  useFocusEffect(
    useCallback(() => {
      setStatusBarStyle('light', true);
      return () => {
        setStatusBarStyle(isDark ? 'light' : 'dark', true);
      };
    }, [isDark])
  );

  const filteredQuests = useMemo(() => {
    const q = normalizeCategoryText(search.trim());
    return quests.filter((item) => {
      const isItemFunded = Boolean(
        item.funded && (item.budget_remaining_usd ?? item.budgetUsd ?? 0) > 0
      );
      if (paidOnly && !isItemFunded) return false;
      if (xpOnly && isItemFunded) return false;
      const catMatch = matchesQuestCategory(item.category, item.night_only, selectedCategory);
      const textMatch =
        !q ||
        normalizeCategoryText(item.title).includes(q) ||
        normalizeCategoryText(item.place_name).includes(q) ||
        normalizeCategoryText(item.businessName).includes(q) ||
        normalizeCategoryText(item.category).includes(q) ||
        normalizeCategoryText(item.address).includes(q) ||
        normalizeCategoryText(item.description).includes(q) ||
        normalizeCategoryText(item.city).includes(q);
      return catMatch && textMatch;
    });
  }, [quests, search, selectedCategory, paidOnly, xpOnly]);

  const filteredPlaces = useMemo(() => {
    const matchingPlaceIds = new Set(
      filteredQuests.map((item) => item.place_id).filter(Boolean) as string[]
    );
    const matchingNames = new Set(
      filteredQuests.map((item) => normalizeCategoryText(item.place_name || item.businessName))
    );
    const q = normalizeCategoryText(search.trim());
    return places.filter((p) => {
      if (matchingPlaceIds.size > 0 || paidOnly || xpOnly || selectedCategory !== 'All' || q) {
        return (
          matchingPlaceIds.has(p.id) ||
          matchingNames.has(normalizeCategoryText(p.name))
        );
      }
      return true;
    });
  }, [places, filteredQuests, search, paidOnly, xpOnly, selectedCategory]);

  React.useEffect(() => {
    if (selectedQuestId && !filteredQuests.some((item) => item.id === selectedQuestId)) {
      setSelectedQuestId(null);
    }
  }, [filteredQuests, selectedQuestId, setSelectedQuestId]);

  const revealFilteredOnMapIfZoomedOut = useCallback(
    (nextList: typeof quests) => {
      if (!isCityView && nextList.length > 0) {
        const targetCity = nextList[0]?.city || 'Bengaluru';
        globeRef.current?.postMessage({ type: 'flyToCity', city: targetCity });
      }
    },
    [isCityView]
  );

  const recommendedQuests = useMemo(
    () => quests.filter((q) => q.isRecommended),
    [quests]
  );

  const activeQuest = useMemo(
    () => (selectedQuestId ? filteredQuests.find((q) => q.id === selectedQuestId) || null : null),
    [filteredQuests, selectedQuestId]
  );

  const handleSearchSubmit = () => {
    const q = search.trim().toLowerCase();
    if (!q) return;
    const cityMatch = filteredQuests.find((item) =>
      item.city?.toLowerCase().includes(q)
    );
    if (cityMatch?.city) {
      globeRef.current?.postMessage({ type: 'flyToCity', city: cityMatch.city });
      return;
    }
    if (filteredQuests[0]) {
      setSelectedQuestId(filteredQuests[0].id);
      globeRef.current?.postMessage({ type: 'selectQuest', id: filteredQuests[0].id });
    }
  };

  const handleLocateMe = async () => {
    const coords = userCoords || (await refreshLocation());
    if (!coords) {
      Alert.alert(
        'Location Access Needed',
        'Allow location permission in your phone settings so ROAMR can compute live quest distances and center on you.'
      );
      return;
    }
    globeRef.current?.postMessage({ type: 'flyToUser', coords });
  };

  return (
    <View style={styles.screen}>
      {/* Full-Bleed Edge-to-Edge 3D Globe */}
      <GlobeMap
        ref={globeRef}
        places={filteredPlaces}
        quests={filteredQuests}
        selectedQuestId={selectedQuestId}
        userCoords={userCoords}
        lightPreset={lightPreset}
        projection={mapProjection}
        enable3D={enable3D}
        topControlsOffset={overlayTop}
        onToggleLightPreset={() =>
          setLightPreset(lightPreset === 'day' ? 'dusk' : 'day')
        }
        onLocateMe={handleLocateMe}
        onPlaceSelected={(placeId) => {
          setShowRecommended(false);
          const matching = filteredQuests.filter((q) => q.place_id === placeId);
          const placeQuests =
            matching.length > 0 ? matching : quests.filter((q) => q.place_id === placeId);
          if (placeQuests.length >= 1) {
            setSelectedQuestId(placeQuests[0].id);
          } else {
            router.push({ pathname: '/place/[id]', params: { id: placeId } });
          }
        }}
        onQuestSelected={(id) => {
          setSelectedQuestId(id);
          setShowRecommended(false);
        }}
        onQuestDeselected={() => {
          setSelectedQuestId(null);
        }}
        onCitySelected={() => {
          setIsCityView(true);
          setShowRecommended(false);
        }}
        onZoomModeChange={(nextCityView) => {
          setIsCityView(nextCityView);
        }}
        onBackToGlobe={() => {
          setIsCityView(false);
          setSelectedQuestId(null);
        }}
      />

      {/* Clean Soft-Frosted Floating Top Controls (no mirror glare) */}
      <View
        style={styles.floatingTopContainer}
        pointerEvents="box-none"
        onLayout={(e) => {
          const next = Math.round(e.nativeEvent.layout.height + 8);
          if (Math.abs(next - overlayTop) > 2) setOverlayTop(next);
        }}
      >
        <SafeAreaView edges={['top']} pointerEvents="box-none">
          <ResponsiveContainer maxWidth={760}>
            <TopHeader floating />

            <View style={styles.searchRow}>
              <View
                style={[
                  styles.searchBox,
                  {
                    backgroundColor: palette.floatingPillBg,
                    borderColor: palette.floatingPillBorder,
                  },
                ]}
              >
                <Ionicons name="search" size={17} color={palette.textSecondary} />
                <TextInput
                  value={search}
                  onChangeText={setSearch}
                  onSubmitEditing={handleSearchSubmit}
                  returnKeyType="search"
                  placeholder="Search city or nearby quests..."
                  placeholderTextColor={palette.textMuted}
                  style={[styles.searchInput, { color: palette.textPrimary }]}
                />
                {search.length > 0 ? (
                  <Pressable onPress={() => setSearch('')} hitSlop={8}>
                    <Ionicons name="close-circle" size={18} color={palette.textMuted} />
                  </Pressable>
                ) : null}
              </View>

              <Pressable
                onPress={() => setShowFilters((v) => !v)}
                style={[
                  styles.filterBtn,
                  {
                    backgroundColor: showFilters || paidOnly || xpOnly || selectedCategory !== 'All'
                      ? palette.primary
                      : palette.floatingPillBg,
                    borderColor: showFilters || paidOnly || xpOnly || selectedCategory !== 'All'
                      ? palette.primary
                      : palette.floatingPillBorder,
                  },
                ]}
                accessibilityLabel="Toggle category filters"
              >
                <Ionicons
                  name="options-outline"
                  size={19}
                  color={
                    showFilters || paidOnly || xpOnly || selectedCategory !== 'All'
                      ? palette.white
                      : palette.primaryDark
                  }
                />
              </Pressable>
            </View>

            {showFilters ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.filterStrip}
              >
                <Pressable
                  onPress={() => {
                    const nextPaid = !paidOnly;
                    setPaidOnly(nextPaid);
                    if (nextPaid) setXpOnly(false);
                    if (nextPaid) {
                      revealFilteredOnMapIfZoomedOut(
                        quests.filter((item) => item.funded && (item.budget_remaining_usd ?? item.budgetUsd ?? 0) > 0)
                      );
                    }
                  }}
                  style={[
                    styles.catChip,
                    {
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 5,
                      backgroundColor: paidOnly ? palette.gold : palette.floatingPillBg,
                      borderColor: paidOnly ? palette.gold : palette.floatingPillBorder,
                    },
                  ]}
                >
                  <Ionicons
                    name="cash-outline"
                    size={13}
                    color={paidOnly ? palette.white : palette.goldText}
                  />
                  <Text
                    style={[
                      styles.catChipText,
                      { color: paidOnly ? palette.white : palette.goldText },
                    ]}
                  >
                    Paid quests
                  </Text>
                </Pressable>

                <Pressable
                  onPress={() => {
                    const nextXp = !xpOnly;
                    setXpOnly(nextXp);
                    if (nextXp) setPaidOnly(false);
                    if (nextXp) {
                      revealFilteredOnMapIfZoomedOut(
                        quests.filter((item) => !(item.funded && (item.budget_remaining_usd ?? item.budgetUsd ?? 0) > 0))
                      );
                    }
                  }}
                  style={[
                    styles.catChip,
                    {
                      backgroundColor: xpOnly ? palette.primary : palette.floatingPillBg,
                      borderColor: xpOnly ? palette.primary : palette.floatingPillBorder,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.catChipText,
                      { color: xpOnly ? palette.white : palette.textPrimary },
                    ]}
                  >
                    XP only
                  </Text>
                </Pressable>

                {CATEGORIES.map((cat) => {
                  const chipActive =
                    cat === selectedCategory && (cat !== 'All' || (!paidOnly && !xpOnly));
                  return (
                    <Pressable
                      key={cat}
                      onPress={() => {
                        setSelectedCategory(cat);
                        if (cat === 'All') {
                          setPaidOnly(false);
                          setXpOnly(false);
                        } else {
                          revealFilteredOnMapIfZoomedOut(
                            quests.filter((item) =>
                              matchesQuestCategory(item.category, item.night_only, cat)
                            )
                          );
                        }
                      }}
                      style={[
                        styles.catChip,
                        {
                          backgroundColor: chipActive ? palette.primary : palette.floatingPillBg,
                          borderColor: chipActive ? palette.primary : palette.floatingPillBorder,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.catChipText,
                          {
                            color: chipActive ? palette.white : palette.textPrimary,
                          },
                        ]}
                      >
                        {cat}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            ) : null}
          </ResponsiveContainer>
        </SafeAreaView>
      </View>

      {/* Top-Left Compact Recommendations Pill */}
      {recommendedQuests.length > 0 ? (
        <View style={[styles.recommendedWrap, { top: overlayTop }]} pointerEvents="box-none">
          <Pressable
            onPress={() => setShowRecommended((v) => !v)}
            style={[
              styles.recHeaderPill,
              {
                backgroundColor: palette.floatingPillBg,
                borderColor: palette.floatingPillBorder,
              },
            ]}
          >
            <Ionicons name="sparkles" size={13} color={palette.primary} />
            <Text style={[styles.recHeaderText, { color: palette.primaryDark }]}>
              For You ({recommendedQuests.length})
            </Text>
            <Ionicons
              name={showRecommended ? 'chevron-up' : 'chevron-down'}
              size={13}
              color={palette.primaryDark}
            />
          </Pressable>

          {showRecommended ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.recScroll}
            >
              {recommendedQuests.map((rq) => {
                const selected = rq.id === activeQuest?.id;
                return (
                  <Pressable
                    key={rq.id}
                    onPress={() => {
                      setSelectedQuestId(rq.id);
                      setShowRecommended(false);
                      globeRef.current?.postMessage({ type: 'selectQuest', id: rq.id });
                    }}
                    style={[
                      styles.recChipCard,
                      {
                        backgroundColor: palette.bgCard,
                        borderColor: selected ? palette.primary : palette.border,
                      },
                      selected && styles.recChipActive,
                    ]}
                  >
                    <Text style={[styles.recTitle, { color: palette.textPrimary }]} numberOfLines={1}>
                      {rq.title}
                    </Text>
                    <Pill
                      label={`${formatMoney(rq.rewardCents ?? usdToCents(rq.rewardUsd), { showInr })} • ${rq.distance}`}
                      variant="gold"
                    />
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : null}
        </View>
      ) : !onboardingDone ? (
        <Pressable
          onPress={() => router.push('/onboarding')}
          style={[
            styles.personalizePill,
            {
              top: overlayTop,
              backgroundColor: palette.floatingPillBg,
              borderColor: palette.floatingPillBorder,
            },
          ]}
        >
          <Ionicons name="sparkles" size={14} color={palette.primary} />
          <Text style={[styles.personalizeText, { color: palette.primaryDark }]}>AI Quests</Text>
        </Pressable>
      ) : null}

      {/* Floating Solid Bottom QuestCard OR Empty Search */}
      {filteredQuests.length === 0 ? (
        <View style={styles.bottomCardWrap}>
          <View
            style={[
              styles.emptyCardSolid,
              { backgroundColor: palette.bgCard, borderColor: palette.border },
            ]}
          >
            <Ionicons name="compass-outline" size={28} color={palette.primary} />
            <Text style={[styles.emptyTitle, { color: palette.textPrimary }]}>
              No quests match "{search}"
            </Text>
            <Text style={[styles.emptySub, { color: palette.textSecondary }]}>
              Try clearing your search or switching category filters.
            </Text>
            <Button
              label="Reset Filters"
              variant="secondary"
              onPress={() => {
                setSearch('');
                setSelectedCategory('All');
              }}
              style={styles.resetBtn}
            />
          </View>
        </View>
      ) : activeQuest ? (
        <View style={styles.bottomCardWrap}>
          {(() => {
            const placeQuestsCount = activeQuest.place_id
              ? quests.filter((q) => q.place_id === activeQuest.place_id).length
              : 0;
            return (
              <QuestCard
                quest={activeQuest}
                bookmarked={bookmarkedIds.includes(activeQuest.id)}
                onToggleBookmark={() => toggleBookmark(activeQuest.id)}
                onDismiss={() => setSelectedQuestId(null)}
                onStartQuest={() => router.push(`/quest/${activeQuest.id}`)}
                secondaryActionLabel={
                  placeQuestsCount >= 2 ? `Place (${placeQuestsCount})` : undefined
                }
                onSecondaryAction={
                  placeQuestsCount >= 2 && activeQuest.place_id
                    ? () =>
                        router.push({
                          pathname: '/place/[id]',
                          params: { id: activeQuest.place_id! },
                        })
                    : undefined
                }
              />
            );
          })()}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#08100E',
    position: 'relative',
  },
  floatingTopContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 20,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    marginTop: 2,
  },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(248, 250, 247, 0.84)',
    borderRadius: radii.pill,
    paddingHorizontal: 14,
    height: 44,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.9)',
    gap: 8,
    ...shadows.soft,
  },
  searchInput: {
    flex: 1,
    fontFamily: fonts.sansMedium,
    fontSize: 14,
    color: colors.textPrimary,
  },
  filterBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(248, 250, 247, 0.84)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.9)',
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.soft,
  },
  filterBtnActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  filterStrip: {
    paddingHorizontal: 16,
    paddingTop: 10,
    gap: 8,
  },
  catChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(248, 250, 247, 0.84)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.9)',
  },
  catChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  catChipText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12.5,
    color: colors.textPrimary,
  },
  catChipTextActive: {
    color: colors.white,
  },
  personalizePill: {
    position: 'absolute',
    left: 14,
    zIndex: 15,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 13,
    paddingVertical: 8,
    backgroundColor: 'rgba(248, 250, 247, 0.82)',
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.88)',
    ...shadows.soft,
  },
  personalizeText: {
    fontFamily: fonts.sansSemi,
    fontSize: 12.5,
    color: colors.primaryDark,
  },
  recommendedWrap: {
    position: 'absolute',
    left: 0,
    right: 74,
    zIndex: 15,
  },
  recHeaderPill: {
    alignSelf: 'flex-start',
    marginLeft: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: 'rgba(248, 250, 247, 0.82)',
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.88)',
    ...shadows.soft,
  },
  recHeaderText: {
    fontFamily: fonts.sansSemi,
    fontSize: 12.5,
    color: colors.primaryDark,
  },
  recScroll: {
    paddingHorizontal: 14,
    paddingTop: 8,
    gap: 8,
  },
  recChipCard: {
    backgroundColor: colors.white,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 4,
    maxWidth: 184,
    ...shadows.soft,
  },
  recChipActive: {
    borderColor: colors.primary,
    borderWidth: 1.5,
  },
  recTitle: {
    fontFamily: fonts.sansSemi,
    fontSize: 12.5,
    color: colors.textPrimary,
  },
  bottomCardWrap: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 94,
    zIndex: 25,
  },
  emptyCardSolid: {
    backgroundColor: colors.white,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
    alignItems: 'center',
    gap: 6,
    ...shadows.card,
  },
  emptyTitle: {
    fontFamily: fonts.serif,
    fontSize: 18,
    color: colors.textPrimary,
  },
  emptySub: {
    fontFamily: fonts.sans,
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  resetBtn: {
    marginTop: 8,
    height: 42,
    paddingHorizontal: 20,
  },
});
