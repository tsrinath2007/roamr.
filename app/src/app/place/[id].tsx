import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useRoamr } from '../../context/RoamrContext';
import { fetchPlaceDetailFromServer } from '../../services/api';
import { Place, Quest } from '../../types/roamr';
import { fonts, radii, shadows } from '../../theme/tokens';
import { Pill } from '../../components/Pill';
import { QuestCard } from '../../components/QuestCard';
import { CategoryIcon } from '../../components/CategoryIcon';

export default function PlaceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { places, quests, bookmarkedIds, toggleBookmark, palette } = useRoamr();

  const fallbackPlace = useMemo(
    () => places.find((p) => p.id === id) || null,
    [places, id]
  );
  const fallbackQuests = useMemo(
    () => quests.filter((q) => q.place_id === id || q.place_name === fallbackPlace?.name),
    [quests, id, fallbackPlace?.name]
  );

  const [place, setPlace] = useState<Place | null>(fallbackPlace);
  const [placeQuests, setPlaceQuests] = useState<Quest[]>(fallbackQuests);
  const [loading, setLoading] = useState(!fallbackPlace);

  useEffect(() => {
    if (!id) return;
    let active = true;
    (async () => {
      try {
        const res = await fetchPlaceDetailFromServer(String(id));
        if (active) {
          setPlace(res.place);
          setPlaceQuests(res.quests || []);
        }
      } catch {
        if (active && fallbackPlace) {
          setPlace(fallbackPlace);
          setPlaceQuests(fallbackQuests);
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [id, fallbackPlace, fallbackQuests]);

  const handleOpenMaps = () => {
    if (!place) return;
    const url =
      place.maps_link ||
      (typeof place.lat === 'number' && typeof place.lng === 'number'
        ? `https://www.google.com/maps/search/?api=1&query=${place.lat},${place.lng}`
        : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
            `${place.name} ${place.address || ''}`
          )}`);
    void Linking.openURL(url);
  };

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: palette.bgCream }]} edges={['top']}>
      <View
        style={[
          styles.topBar,
          { backgroundColor: palette.bgCard, borderBottomColor: palette.border },
        ]}
      >
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={10}>
          <Ionicons name="arrow-back" size={22} color={palette.textPrimary} />
        </Pressable>
        <Text style={[styles.topTitle, { color: palette.textPrimary }]} numberOfLines={1}>
          {place?.name || 'Place Details'}
        </Text>
        <View style={{ width: 36 }} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={palette.primary} />
        </View>
      ) : !place ? (
        <View style={styles.center}>
          <Text style={[styles.emptyTitle, { color: palette.textPrimary }]}>
            Place not found
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <View
            style={[
              styles.headerCard,
              { backgroundColor: palette.bgCard, borderColor: palette.border },
            ]}
          >
            <View style={styles.headerRow}>
              <View style={[styles.iconBox, { backgroundColor: palette.bgSage }]}>
                <CategoryIcon
                  category={place.category || 'Explore'}
                  size={24}
                  color={palette.primary}
                />
              </View>
              <View style={styles.headerInfo}>
                <Text style={[styles.placeName, { color: palette.textPrimary }]}>{place.name}</Text>
                <Text style={[styles.placeAddress, { color: palette.textSecondary }]}>
                  {place.address}
                </Text>
              </View>
            </View>

            <View style={styles.pillRow}>
              {place.category ? <Pill label={place.category} variant="sage" /> : null}
              <Pill
                label={
                  place.has_funded_quests
                    ? `Pays up to $${Number.isInteger(place.max_reward_usd) ? place.max_reward_usd : place.max_reward_usd.toFixed(2)}`
                    : `XP only • ${place.max_xp} XP`
                }
                variant={place.has_funded_quests ? 'gold' : 'neutral'}
              />
              {fallbackPlace?.distance ? (
                <Pill label={fallbackPlace.distance} variant="neutral" />
              ) : null}
            </View>

            <Pressable
              onPress={handleOpenMaps}
              style={[
                styles.mapsBtn,
                { backgroundColor: palette.bgCream, borderColor: palette.border },
              ]}
            >
              <Ionicons name="navigate-outline" size={16} color={palette.primary} />
              <Text style={[styles.mapsBtnText, { color: palette.primary }]}>
                Open in Google Maps
              </Text>
            </Pressable>
          </View>

          <Text style={[styles.sectionHeading, { color: palette.textPrimary }]}>
            Quests at {place.name} ({placeQuests.length})
          </Text>

          {placeQuests.length === 0 ? (
            <View
              style={[
                styles.emptyCard,
                { backgroundColor: palette.bgCard, borderColor: palette.border },
              ]}
            >
              <Text style={[styles.emptyText, { color: palette.textSecondary }]}>
                No active quests at this place yet.
              </Text>
            </View>
          ) : (
            placeQuests.map((q) => (
              <View key={q.id} style={styles.questWrap}>
                <QuestCard
                  quest={q}
                  bookmarked={bookmarkedIds.includes(q.id)}
                  onToggleBookmark={() => toggleBookmark(q.id)}
                  onStartQuest={() =>
                    router.push({ pathname: '/quest/[id]', params: { id: q.id } })
                  }
                />
              </View>
            ))
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topTitle: {
    fontFamily: fonts.sansBold,
    fontSize: 17,
    flex: 1,
    textAlign: 'center',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 36,
    gap: 14,
  },
  headerCard: {
    borderRadius: radii.xl,
    borderWidth: 1,
    padding: 16,
    gap: 12,
    ...shadows.soft,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconBox: {
    width: 52,
    height: 52,
    borderRadius: radii.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerInfo: {
    flex: 1,
    gap: 4,
  },
  placeName: {
    fontFamily: fonts.serif,
    fontSize: 20,
    fontWeight: '700',
  },
  placeAddress: {
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 18,
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  mapsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    borderRadius: radii.md,
    borderWidth: 1,
  },
  mapsBtnText: {
    fontFamily: fonts.sansSemi,
    fontSize: 13,
  },
  sectionHeading: {
    fontFamily: fonts.serif,
    fontSize: 18,
    fontWeight: '700',
    marginTop: 4,
  },
  emptyTitle: {
    fontFamily: fonts.sansBold,
    fontSize: 17,
  },
  emptyCard: {
    borderRadius: radii.lg,
    borderWidth: 1,
    padding: 20,
    alignItems: 'center',
  },
  emptyText: {
    fontFamily: fonts.sans,
    fontSize: 14,
  },
  questWrap: {
    marginBottom: 4,
  },
});
