import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  LayoutChangeEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useRoamr } from '../../context/RoamrContext';
import {
  draftAiBriefOnServer,
  fetchBusinessQuestForEdit,
  MapboxPlaceResult,
  reverseGeocodeWithMapbox,
  searchPlacesWithMapbox,
} from '../../services/api';
import { formatMoney, usdToCents, USD_TO_INR } from '../../../lib/currency';
import { QuestDifficulty, QuestType } from '../../types/roamr';
import { Card } from '../../components/Card';
import { Pill } from '../../components/Pill';
import { Button } from '../../components/Button';
import { LiquidBackdrop } from '../../components/LiquidBackdrop';
import { PlacePinPickerMap } from '../../components/PlacePinPickerMap';
import { ResponsiveContainer } from '../../components/ResponsiveContainer';
import { fonts, radii } from '../../theme/tokens';

const CATEGORIES = [
  'Cafe',
  'Restaurant',
  'Bakery',
  'Dessert Shop',
  'Run Club',
  'Night Club',
  'Bar & Pub',
  'Shop',
  'Arcade',
];
const DIFFICULTIES: QuestDifficulty[] = ['Easy', 'Medium', 'Hard'];

function parseLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^[\-\•\*]\s*/, '').trim())
    .filter(Boolean);
}

export default function CreateQuestScreen() {
  const { editId } = useLocalSearchParams<{ editId?: string }>();
  const isEditing = Boolean(editId);
  const {
    userProfile,
    quests,
    ownerQuests,
    ownerStats,
    serverUser,
    isSuperAdmin,
    addBusinessQuest,
    updateBusinessQuest,
    showInr,
    palette,
  } = useRoamr();
  const existingQuest = isEditing ? quests.find((q) => q.id === editId) : undefined;
  const primaryPlace = serverUser?.primary_place || ownerStats?.primary_place || null;
  const isVerifiedBusiness = Boolean(
    isSuperAdmin || serverUser?.is_verified_business || ownerStats?.is_verified_business || (serverUser?.owned_places_count ?? 0) > 0
  );
  const isLockedUnverifiedLimit = Boolean(!isSuperAdmin && !isEditing && !isVerifiedBusiness && ownerQuests.length >= 1);

  // Section 1: Basics
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('Cafe');
  const [difficulty, setDifficulty] = useState<QuestDifficulty>('Easy');
  const [estMinutes, setEstMinutes] = useState('20');
  const [publicDescription, setPublicDescription] = useState('');
  const [publicObjective, setPublicObjective] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [textAnswerPrompt, setTextAnswerPrompt] = useState('');

  // Section 2: Place (Map picker is ONLY source of quest location)
  const [placeQuery, setPlaceQuery] = useState('');
  const [searchingPlace, setSearchingPlace] = useState(false);
  const [placeResults, setPlaceResults] = useState<MapboxPlaceResult[]>([]);
  const [placeName, setPlaceName] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [coords, setCoords] = useState<{ latitude: number; longitude: number }>({
    latitude: 12.9716,
    longitude: 77.5946,
  });
  const [locationPicked, setLocationPicked] = useState(false);
  const [locatingGps, setLocatingGps] = useState(false);
  const [radiusMeters, setRadiusMeters] = useState(150);
  const [sliderWidth, setSliderWidth] = useState(260);
  const [nightOnly, setNightOnly] = useState(false);

  // Section 3: Reward
  const [questType, setQuestType] = useState<QuestType>('purchase');
  const [minBillInr, setMinBillInr] = useState('200');
  const [cashbackPercent, setCashbackPercent] = useState('15');
  const [maxRewardUsd, setMaxRewardUsd] = useState('2.00');
  const [fixedRewardUsd, setFixedRewardUsd] = useState('0.35');

  // Section 4: Budget ("Fund this quest" optional: 0 => XP-only, > 0 => PayPal fund)
  const [fundQuest, setFundQuest] = useState(true);
  const [budgetUsd, setBudgetUsd] = useState('20');

  // Section 5: AI Verification Brief ("Only the AI sees this")
  const [mustShowText, setMustShowText] = useState('');
  const [rejectIfText, setRejectIfText] = useState(
    'screenshot or photo of a screen\nstock or internet image\nphoto clearly taken at a different place'
  );
  const [billChecksText, setBillChecksText] = useState(
    'receipt or bill shows the place name\nbill date is today\nbill total matches the PayPal payment within 10%'
  );
  const [aiNotes, setAiNotes] = useState('');
  const [aiReferenceImages, setAiReferenceImages] = useState<string[]>([]);
  const [draftingBrief, setDraftingBrief] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isEditing || isSuperAdmin || !primaryPlace) return;
    setPlaceName(primaryPlace.name);
    setAddress(primaryPlace.address || '');
    setCity(primaryPlace.city || 'Bengaluru');
    if (primaryPlace.coordinates) {
      setCoords(primaryPlace.coordinates);
    }
    setLocationPicked(true);
    if (primaryPlace.category && CATEGORIES.includes(primaryPlace.category)) {
      setCategory(primaryPlace.category);
    }
  }, [isEditing, isSuperAdmin, primaryPlace]);

  useEffect(() => {
    if (!editId) return;
    let active = true;
    const applyQuestToForm = (q: NonNullable<typeof existingQuest> & {
      ai_private?: {
        must_show?: string[];
        reject_if?: string[];
        bill_checks?: string[];
        notes?: string;
      };
    }) => {
      setTitle(q.title || '');
      setCategory(q.category || 'Cafe');
      setDifficulty((q.difficulty as QuestDifficulty) || 'Easy');
      setEstMinutes(String(q.est_minutes || 20));
      setPublicDescription(q.public_description || q.description || '');
      setPublicObjective(q.public_objective || q.objective || '');
      setPhotoUrl(q.photo_url || q.image || '');
      setTextAnswerPrompt(q.text_answer_prompt || '');
      setPlaceName(q.place_name || q.businessName || '');
      setAddress(q.address || '');
      setCity(q.city || '');
      setPlaceQuery(q.address || q.place_name || '');
      const lat = q.lat ?? q.coordinates?.latitude;
      const lng = q.lng ?? q.coordinates?.longitude;
      if (typeof lat === 'number' && typeof lng === 'number') {
        setCoords({ latitude: lat, longitude: lng });
        setLocationPicked(true);
      }
      setRadiusMeters(Math.max(50, Math.min(500, Number(q.radius_m || 150))));
      setNightOnly(Boolean(q.night_only));
      const isPurchase = q.quest_type === 'purchase' || Boolean(q.reward?.cashback_percent);
      setQuestType(isPurchase ? 'purchase' : 'visit');
      if (q.reward?.min_bill_inr) setMinBillInr(String(q.reward.min_bill_inr));
      if (q.reward?.cashback_percent) setCashbackPercent(String(q.reward.cashback_percent));
      if (q.reward?.max_reward_usd) setMaxRewardUsd(String(q.reward.max_reward_usd));
      if (q.reward?.fixed_reward_usd) setFixedRewardUsd(String(q.reward.fixed_reward_usd));
      const budgetAmt = Number(q.budget_usd ?? q.budgetUsd ?? 0);
      setFundQuest(budgetAmt > 0 || Boolean(q.funded));
      if (budgetAmt > 0) setBudgetUsd(String(budgetAmt));
      if (q.ai_private) {
        if (Array.isArray(q.ai_private.must_show)) {
          setMustShowText(q.ai_private.must_show.join('\n'));
        }
        if (Array.isArray(q.ai_private.reject_if)) {
          setRejectIfText(q.ai_private.reject_if.join('\n'));
        }
        if (Array.isArray(q.ai_private.bill_checks)) {
          setBillChecksText(q.ai_private.bill_checks.join('\n'));
        }
        if (q.ai_private.notes) setAiNotes(q.ai_private.notes);
      } else if (q.aiInstructions) {
        setMustShowText(q.aiInstructions);
      }
      if (Array.isArray(q.aiReferenceImages)) {
        setAiReferenceImages(q.aiReferenceImages);
      }
    };

    if (existingQuest) {
      applyQuestToForm(existingQuest);
    }

    fetchBusinessQuestForEdit(editId)
      .then((res) => {
        if (active && res?.quest) {
          applyQuestToForm(res.quest);
        }
      })
      .catch(() => {
        // Offline / server fallback already prefilled from existingQuest
      });

    return () => {
      active = false;
    };
  }, [editId]);

  const handleSearchPlaces = async () => {
    const q = placeQuery.trim();
    if (!q) return;
    setSearchingPlace(true);
    try {
      const results = await searchPlacesWithMapbox(q);
      setPlaceResults(results);
      if (!results.length) {
        Alert.alert('No matching places', 'Try searching a street, café, landmark, or city.');
      }
    } finally {
      setSearchingPlace(false);
    }
  };

  const handleSelectPlace = (place: MapboxPlaceResult) => {
    setPlaceName(place.name);
    setAddress(place.fullAddress);
    setCity(place.city);
    setCoords({ latitude: place.latitude, longitude: place.longitude });
    setLocationPicked(true);
    setPlaceResults([]);
    setPlaceQuery(place.fullAddress);
  };

  const handleUseMyLocation = async () => {
    setLocatingGps(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        Alert.alert('Location denied', 'Allow GPS access or search / drag the pin on the map.');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const next = {
        latitude: Number(pos.coords.latitude.toFixed(6)),
        longitude: Number(pos.coords.longitude.toFixed(6)),
      };
      const resolved = await reverseGeocodeWithMapbox(next.latitude, next.longitude);
      setCoords(next);
      setAddress(resolved);
      if (!placeName.trim()) {
        setPlaceName(resolved.split(',')[0] || 'Pinned Spot');
      }
      setLocationPicked(true);
      setPlaceQuery(resolved);
    } catch (err) {
      Alert.alert(
        'Location unavailable',
        err instanceof Error ? err.message : 'Could not fetch current GPS location.'
      );
    } finally {
      setLocatingGps(false);
    }
  };

  const handleMapCoordsChange = async (next: { latitude: number; longitude: number }) => {
    setCoords(next);
    setLocationPicked(true);
    const resolved = await reverseGeocodeWithMapbox(next.latitude, next.longitude);
    setAddress(resolved);
    if (!placeName.trim()) {
      setPlaceName(resolved.split(',')[0] || 'Pinned Place');
    }
  };

  const handleRadiusTouch = (locationX: number) => {
    if (sliderWidth <= 0) return;
    const ratio = Math.max(0, Math.min(1, locationX / sliderWidth));
    const snapped = Math.round((50 + ratio * 450) / 25) * 25;
    setRadiusMeters(Math.max(50, Math.min(500, snapped)));
  };

  const handlePickPhoto = async (target: 'cover' | 'ref') => {
    if (target === 'ref' && aiReferenceImages.length >= 3) {
      Alert.alert('Limit reached', 'Attach up to 3 reference photos.');
      return;
    }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Allow photo library access to pick an image.');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.65,
      base64: target === 'ref',
    });
    if (!res.canceled && res.assets[0]) {
      const asset = res.assets[0];
      if (target === 'cover') {
        setPhotoUrl(asset.uri);
      } else {
        const encoded = asset.base64
          ? `data:${asset.mimeType || 'image/jpeg'};base64,${asset.base64}`
          : asset.uri;
        setAiReferenceImages((prev) => [...prev, encoded].slice(0, 3));
      }
    }
  };

  const handleHelpMeWrite = async () => {
    if (!publicObjective.trim() && !title.trim() && !placeName.trim()) {
      Alert.alert(
        'Add Basics First',
        'Fill in Quest Title, Place Name, or What to Do so AI can tailor the verification brief.'
      );
      return;
    }
    setDraftingBrief(true);
    try {
      const draft = await draftAiBriefOnServer({
        title: title.trim(),
        place_name: placeName.trim() || address.split(',')[0] || title.trim(),
        category,
        quest_type: questType,
        public_description: publicDescription.trim(),
        public_objective: publicObjective.trim(),
        min_bill_inr: Number(minBillInr) || 0,
        text_answer_prompt: textAnswerPrompt.trim() || undefined,
      });
      setMustShowText((draft.must_show || []).join('\n'));
      setRejectIfText((draft.reject_if || []).join('\n'));
      setBillChecksText((draft.bill_checks || []).join('\n'));
      if (draft.notes) setAiNotes(draft.notes);
    } catch (err) {
      Alert.alert(
        'Could not reach server',
        err instanceof Error ? err.message : 'Check server connection to auto-draft rules.'
      );
    } finally {
      setDraftingBrief(false);
    }
  };

  const handlePublish = async () => {
    if (!title.trim() || !publicObjective.trim()) {
      Alert.alert('Missing Basics', 'Enter a Quest Title and Public Objective.');
      return;
    }
    if (!locationPicked) {
      Alert.alert(
        'Pick Quest Place on Map',
        'Search for the place, tap Use My Location, or drag the map pin so travelers have an exact GPS pin.'
      );
      return;
    }

    const budgetNum = fundQuest ? Number(budgetUsd) : 0;
    if (fundQuest && (!budgetNum || budgetNum < 1)) {
      Alert.alert('Invalid Budget', 'Enter a PayPal quest budget of at least $1 USD, or turn off funding for an XP-only quest.');
      return;
    }

    const effectiveRewardType: QuestType = budgetNum > 0 ? questType : 'visit';
    const minBillNum = Number(minBillInr) || 200;
    const cashbackNum = Number(cashbackPercent) || 15;
    const maxRewardNum = Number(maxRewardUsd) || 2.0;
    const fixedRewardNum = Number(fixedRewardUsd) || 0.35;
    const estMinutesNum = Math.max(5, Number(estMinutes) || 20);
    const rewardCapUsd = budgetNum > 0 ? (effectiveRewardType === 'purchase' ? maxRewardNum : fixedRewardNum) : 0;
    const mustShowList = parseLines(mustShowText);
    const rejectIfList = parseLines(rejectIfText);
    const billChecksList = budgetNum > 0 && effectiveRewardType === 'purchase' ? parseLines(billChecksText) : [];

    const hostName =
      userProfile?.businessName?.trim() ||
      userProfile?.name?.trim() ||
      placeName.trim() ||
      'Local Host';

    setSubmitting(true);
    try {
      const payload = {
        ...(!isSuperAdmin && primaryPlace?.id ? { place_id: primaryPlace.id } : {}),
        title: title.trim(),
        businessName: hostName,
        place_name: placeName.trim() || address.split(',')[0] || title.trim(),
        category,
        quest_type: effectiveRewardType,
        public_description: publicDescription.trim() || undefined,
        description: publicDescription.trim() || undefined,
        public_objective: publicObjective.trim(),
        objective: publicObjective.trim(),
        photo_url: photoUrl.trim() || null,
        city: city.trim() || placeName.trim() || 'Global',
        address: address.trim() || undefined,
        lat: coords.latitude,
        lng: coords.longitude,
        coordinates: coords,
        radius_m: radiusMeters,
        night_only: nightOnly,
        difficulty,
        est_minutes: estMinutesNum,
        xp: budgetNum > 0 ? 35 : 80,
        text_answer_prompt:
          effectiveRewardType === 'visit' && textAnswerPrompt.trim()
            ? textAnswerPrompt.trim()
            : null,
        reward:
          budgetNum <= 0
            ? { xp_only: true }
            : effectiveRewardType === 'purchase'
            ? {
                min_bill_inr: minBillNum,
                cashback_percent: cashbackNum,
                max_reward_usd: maxRewardNum,
              }
            : {
                fixed_reward_usd: fixedRewardNum,
              },
        rewardUsd: rewardCapUsd,
        budgetUsd: budgetNum,
        budget_usd: budgetNum,
        budget_remaining_usd: isEditing
          ? existingQuest?.budget_remaining_usd ?? 0
          : 0,
        funded: isEditing ? Boolean(existingQuest?.funded && budgetNum > 0) : false,
        reward_mode: (budgetNum > 0 ? 'cashback' : 'xp_only') as 'cashback' | 'xp_only',
        minCheckinUsd:
          budgetNum > 0 && effectiveRewardType === 'purchase'
            ? Number((minBillNum / USD_TO_INR).toFixed(2))
            : undefined,
        ai_private: {
          must_show: mustShowList,
          reject_if: rejectIfList,
          bill_checks: billChecksList,
          notes: aiNotes.trim(),
        },
        aiInstructions: mustShowList.join('; '),
        aiReferenceImages: aiReferenceImages.length ? aiReferenceImages : undefined,
      };

      if (isEditing && editId) {
        const updated = await updateBusinessQuest(editId, payload);
        if (fundQuest && !updated.funded && budgetNum > 0) {
          router.replace({ pathname: '/business/fund', params: { id: updated.id } });
        } else {
          router.replace('/(business)/quests');
        }
        return;
      }

      const quest = await addBusinessQuest(payload);

      if (budgetNum <= 0) {
        router.replace('/(business)/quests');
      } else {
        router.replace({ pathname: '/business/fund', params: { id: quest.id } });
      }
    } catch (err) {
      Alert.alert(
        'Could not create quest',
        err instanceof Error ? err.message : 'Please try again.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const budgetCents = usdToCents(Number(budgetUsd) || 0);
  const sliderPct = ((radiusMeters - 50) / 450) * 100;

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.bgCream }]}>
      <LiquidBackdrop variant="business" />
      <ResponsiveContainer maxWidth={700}>
        <View style={styles.topBar}>
          <Pressable
            onPress={() => router.back()}
            style={[
              styles.backBtn,
              { backgroundColor: palette.bgCard, borderColor: palette.border },
            ]}
          >
            <Ionicons name="chevron-back" size={22} color={palette.textPrimary} />
          </Pressable>
          <Text style={[styles.topTitle, { color: palette.textPrimary }]}>
            {isEditing ? 'Edit Quest' : 'Create Global Quest'}
          </Text>
          <Pill label="Any Location" variant="gold" />
        </View>

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
          style={styles.flex}
        >
          <ScrollView
            contentContainerStyle={[styles.scrollContent, { paddingBottom: 120 }]}
            keyboardShouldPersistTaps="handled"
            automaticallyAdjustKeyboardInsets
          >
            {isLockedUnverifiedLimit ? (
              <Card style={[styles.card, { backgroundColor: palette.goldSoft, borderColor: palette.gold }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Ionicons name="lock-closed" size={18} color={palette.goldText} />
                  <Text style={{ fontFamily: fonts.sansBold, fontSize: 15, color: palette.goldText }}>
                    Unverified Lock (1 / 1 Quest Used)
                  </Text>
                </View>
                <Text style={{ fontFamily: fonts.sans, fontSize: 13, color: palette.textPrimary }}>
                  Until Superadmin approves your business registration, you can keep only 1 quest at {primaryPlace?.name || 'your venue'}.
                </Text>
              </Card>
            ) : null}
            {/* SECTION 1: BASICS */}
            <Card style={styles.card}>
              <Text style={[styles.sectionHeader, { color: palette.primaryDark }]}>
                1. Basics (Public to Travelers)
              </Text>

              <Text style={[styles.label, { color: palette.textPrimary }]}>Quest Title *</Text>
              <TextInput
                value={title}
                onChangeText={setTitle}
                placeholder="e.g. Espresso Break at Matteo Coffea"
                placeholderTextColor={palette.textMuted}
                style={[styles.input, { backgroundColor: palette.bgSoft, borderColor: palette.border, color: palette.textPrimary }]}
              />

              <Text style={[styles.label, { color: palette.textPrimary }]}>Story (Public Description)</Text>
              <TextInput
                value={publicDescription}
                onChangeText={setPublicDescription}
                placeholder="Why is this spot special?"
                placeholderTextColor={palette.textMuted}
                multiline
                style={[styles.input, styles.textArea, { backgroundColor: palette.bgSoft, borderColor: palette.border, color: palette.textPrimary }]}
              />

              <Text style={[styles.label, { color: palette.textPrimary }]}>What to Do (Public Objective) *</Text>
              <TextInput
                value={publicObjective}
                onChangeText={setPublicObjective}
                placeholder="e.g. Order a coffee and photograph it with the cafe logo."
                placeholderTextColor={palette.textMuted}
                multiline
                style={[styles.input, styles.textArea, { backgroundColor: palette.bgSoft, borderColor: palette.border, color: palette.textPrimary }]}
              />

              <Text style={[styles.label, { color: palette.textPrimary }]}>Photo URL (or Pick Photo)</Text>
              <View style={styles.inlineRow}>
                <TextInput
                  value={photoUrl}
                  onChangeText={setPhotoUrl}
                  placeholder="https://... (optional)"
                  placeholderTextColor={palette.textMuted}
                  autoCapitalize="none"
                  style={[styles.input, styles.flex, { backgroundColor: palette.bgSoft, borderColor: palette.border, color: palette.textPrimary }]}
                />
                <Pressable
                  onPress={() => handlePickPhoto('cover')}
                  style={[styles.iconChipBtn, { backgroundColor: palette.primarySoft }]}
                >
                  <Ionicons name="image-outline" size={18} color={palette.primaryDark} />
                </Pressable>
              </View>

              <Text style={[styles.label, { color: palette.textPrimary }]}>Category</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
                {CATEGORIES.map((cat) => {
                  const active = category === cat;
                  return (
                    <Pressable
                      key={cat}
                      onPress={() => setCategory(cat)}
                      style={[
                        styles.chip,
                        {
                          backgroundColor: active ? palette.primary : palette.bgSoft,
                          borderColor: active ? palette.primary : palette.border,
                        },
                      ]}
                    >
                      <Text style={[styles.chipText, { color: active ? palette.white : palette.textSecondary }]}>
                        {cat}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>

              <View style={styles.row2}>
                <View style={styles.col}>
                  <Text style={[styles.label, { color: palette.textPrimary }]}>Difficulty</Text>
                  <View style={styles.inlineRow}>
                    {DIFFICULTIES.map((d) => {
                      const active = difficulty === d;
                      return (
                        <Pressable
                          key={d}
                          onPress={() => setDifficulty(d)}
                          style={[
                            styles.smallChip,
                            {
                              backgroundColor: active ? palette.goldSoft : palette.bgSoft,
                              borderColor: active ? palette.gold : palette.border,
                            },
                          ]}
                        >
                          <Text style={[styles.smallChipText, { color: active ? palette.goldText : palette.textSecondary }]}>
                            {d}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>

                <View style={styles.colNarrow}>
                  <Text style={[styles.label, { color: palette.textPrimary }]}>Time (min)</Text>
                  <TextInput
                    value={estMinutes}
                    onChangeText={setEstMinutes}
                    keyboardType="numeric"
                    style={[styles.input, { backgroundColor: palette.bgSoft, borderColor: palette.border, color: palette.textPrimary }]}
                  />
                </View>
              </View>
            </Card>

            {/* SECTION 2: PLACE */}
            <Card style={styles.card}>
              <View style={styles.sectionHeaderRow}>
                <Text style={[styles.sectionHeader, { color: palette.primaryDark }]}>
                  {!isSuperAdmin && primaryPlace ? '2. Your Business Place (1 Place Only)' : '2. Place (Map Picker Worldwide)'}
                </Text>
                {locationPicked ? <Pill label={!isSuperAdmin && primaryPlace ? '1 Place Locked' : 'Pin Set'} variant="success" /> : <Pill label="Pick Pin" variant="gold" />}
              </View>
              {!isSuperAdmin && primaryPlace ? (
                <View style={{ gap: 8, padding: 12, borderRadius: radii.md, backgroundColor: palette.bgSoft, borderWidth: 1, borderColor: palette.border }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <Text style={{ fontFamily: fonts.sansBold, fontSize: 15, color: palette.textPrimary, flex: 1 }}>
                      {primaryPlace.name}
                    </Text>
                    <Pill
                      label={isVerifiedBusiness ? 'Verified Venue' : 'Pending Approval'}
                      variant={isVerifiedBusiness ? 'success' : 'gold'}
                    />
                  </View>
                  <Text style={{ fontFamily: fonts.sans, fontSize: 13, color: palette.textSecondary }}>
                    {primaryPlace.address}
                  </Text>
                  <Text style={{ fontFamily: fonts.sans, fontSize: 12, color: palette.primaryDark }}>
                    Quests created in business mode must relate strictly to your 1 registered place.
                  </Text>
                </View>
              ) : (
                <>
              <Text style={[styles.helperText, { color: palette.textSecondary }]}>
                Search any address globally, use your GPS, or drag the pin on the map. Quests live at their pin, not your account profile.
              </Text>

              <View style={styles.searchRow}>
                <TextInput
                  value={placeQuery}
                  onChangeText={setPlaceQuery}
                  onSubmitEditing={handleSearchPlaces}
                  placeholder="Search place, street, city..."
                  placeholderTextColor={palette.textMuted}
                  style={[styles.input, styles.flex, { backgroundColor: palette.bgSoft, borderColor: palette.border, color: palette.textPrimary }]}
                />
                <Pressable
                  onPress={handleSearchPlaces}
                  disabled={searchingPlace}
                  style={[styles.searchBtn, { backgroundColor: palette.primary }]}
                >
                  {searchingPlace ? (
                    <ActivityIndicator size="small" color={palette.white} />
                  ) : (
                    <Ionicons name="search" size={18} color={palette.white} />
                  )}
                </Pressable>
              </View>

              {placeResults.length > 0 ? (
                <View style={[styles.resultsList, { borderColor: palette.border, backgroundColor: palette.bgSoft }]}>
                  {placeResults.map((p) => (
                    <Pressable
                      key={p.id}
                      onPress={() => handleSelectPlace(p)}
                      style={[styles.resultRow, { borderBottomColor: palette.border }]}
                    >
                      <Ionicons name="location-outline" size={16} color={palette.primary} />
                      <Text style={[styles.resultText, { color: palette.textPrimary }]} numberOfLines={2}>
                        {p.fullAddress}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}

              <Pressable
                onPress={handleUseMyLocation}
                disabled={locatingGps}
                style={[styles.gpsBtn, { backgroundColor: palette.primarySoft, borderColor: palette.border }]}
              >
                {locatingGps ? (
                  <ActivityIndicator size="small" color={palette.primaryDark} />
                ) : (
                  <Ionicons name="navigate" size={16} color={palette.primaryDark} />
                )}
                <Text style={[styles.gpsBtnText, { color: palette.primaryDark }]}>
                  Use my current location
                </Text>
              </Pressable>

              <PlacePinPickerMap
                latitude={coords.latitude}
                longitude={coords.longitude}
                radiusMeters={radiusMeters}
                onChangeCoords={handleMapCoordsChange}
              />

              <Text style={[styles.label, { color: palette.textPrimary }]}>Place Name</Text>
              <TextInput
                value={placeName}
                onChangeText={setPlaceName}
                placeholder="e.g. Matteo Coffea Church Street"
                placeholderTextColor={palette.textMuted}
                style={[styles.input, { backgroundColor: palette.bgSoft, borderColor: palette.border, color: palette.textPrimary }]}
              />
                </>
              )}

              {/* Radius Slider 50-500 m */}
              <View style={styles.sliderHeader}>
                <Text style={[styles.label, { color: palette.textPrimary }]}>GPS Check Radius</Text>
                <Text style={[styles.radiusValue, { color: palette.primaryDark }]}>{radiusMeters} m</Text>
              </View>
              <View style={styles.sliderRow}>
                <Pressable
                  onPress={() => setRadiusMeters((r) => Math.max(50, r - 25))}
                  style={[styles.stepBtn, { backgroundColor: palette.bgSoft, borderColor: palette.border }]}
                >
                  <Ionicons name="remove" size={16} color={palette.textPrimary} />
                </Pressable>
                <Pressable
                  onLayout={(e: LayoutChangeEvent) => setSliderWidth(e.nativeEvent.layout.width)}
                  onPress={(e) => handleRadiusTouch(e.nativeEvent.locationX)}
                  style={[styles.sliderTrack, { backgroundColor: palette.bgSage }]}
                >
                  <View
                    style={[
                      styles.sliderFill,
                      { width: `${sliderPct}%`, backgroundColor: palette.primary },
                    ]}
                  />
                  <View
                    style={[
                      styles.sliderThumb,
                      { left: `${sliderPct}%`, backgroundColor: palette.primaryDark },
                    ]}
                  />
                </Pressable>
                <Pressable
                  onPress={() => setRadiusMeters((r) => Math.min(500, r + 25))}
                  style={[styles.stepBtn, { backgroundColor: palette.bgSoft, borderColor: palette.border }]}
                >
                  <Ionicons name="add" size={16} color={palette.textPrimary} />
                </Pressable>
              </View>

              <View style={[styles.switchRow, { borderTopColor: palette.border }]}>
                <View style={styles.flex}>
                  <Text style={[styles.label, { color: palette.textPrimary }]}>Night-Only Quest</Text>
                  <Text style={[styles.helperText, { color: palette.textSecondary }]}>
                    Valid 18:30–05:00 IST (bypassed in Demo Mode).
                  </Text>
                </View>
                <Switch
                  value={nightOnly}
                  onValueChange={setNightOnly}
                  trackColor={{ false: palette.border, true: palette.primary }}
                  thumbColor={palette.white}
                />
              </View>
            </Card>

            {/* SECTION 3: REWARD */}
            <Card style={styles.card}>
              <Text style={[styles.sectionHeader, { color: palette.primaryDark }]}>3. Reward Model</Text>
              <View style={styles.typeRow}>
                {(
                  [
                    { key: 'purchase', title: 'Purchase Cashback', sub: 'Traveler pays bill via PayPal' },
                    { key: 'visit', title: 'Free Visit Quest', sub: 'Fixed sponsor reward, no bill' },
                  ] as const
                ).map((opt) => {
                  const active = questType === opt.key;
                  return (
                    <Pressable
                      key={opt.key}
                      onPress={() => {
                        setQuestType(opt.key);
                        if (opt.key === 'purchase') {
                          setFundQuest(true);
                        }
                      }}
                      style={[
                        styles.typeCard,
                        {
                          backgroundColor: active ? palette.primarySoft : palette.bgSoft,
                          borderColor: active ? palette.primary : palette.border,
                        },
                      ]}
                    >
                      <Text style={[styles.typeTitle, { color: active ? palette.primaryDark : palette.textPrimary }]}>
                        {opt.title}
                      </Text>
                      <Text style={[styles.typeSub, { color: palette.textSecondary }]}>{opt.sub}</Text>
                    </Pressable>
                  );
                })}
              </View>

              {questType === 'purchase' ? (
                <View style={styles.row3}>
                  <View style={styles.col}>
                    <Text style={[styles.label, { color: palette.textPrimary }]}>Min Bill (₹)</Text>
                    <TextInput
                      value={minBillInr}
                      onChangeText={setMinBillInr}
                      keyboardType="numeric"
                      style={[styles.input, { backgroundColor: palette.bgSoft, borderColor: palette.border, color: palette.textPrimary }]}
                    />
                  </View>
                  <View style={styles.col}>
                    <Text style={[styles.label, { color: palette.textPrimary }]}>Cashback (%)</Text>
                    <TextInput
                      value={cashbackPercent}
                      onChangeText={setCashbackPercent}
                      keyboardType="numeric"
                      style={[styles.input, { backgroundColor: palette.bgSoft, borderColor: palette.border, color: palette.textPrimary }]}
                    />
                  </View>
                  <View style={styles.col}>
                    <Text style={[styles.label, { color: palette.textPrimary }]}>Max Reward ($)</Text>
                    <TextInput
                      value={maxRewardUsd}
                      onChangeText={setMaxRewardUsd}
                      keyboardType="decimal-pad"
                      style={[styles.input, { backgroundColor: palette.bgSoft, borderColor: palette.border, color: palette.textPrimary }]}
                    />
                  </View>
                </View>
              ) : (
                <>
                  <Text style={[styles.label, { color: palette.textPrimary }]}>Fixed Reward per Visit ($ USD)</Text>
                  <TextInput
                    value={fixedRewardUsd}
                    onChangeText={setFixedRewardUsd}
                    keyboardType="decimal-pad"
                    style={[styles.input, { backgroundColor: palette.bgSoft, borderColor: palette.border, color: palette.textPrimary }]}
                  />
                  <Text style={[styles.label, { color: palette.textPrimary }]}>
                    Optional Text Question Prompt
                  </Text>
                  <TextInput
                    value={textAnswerPrompt}
                    onChangeText={setTextAnswerPrompt}
                    placeholder="e.g. Which plaque year did you find?"
                    placeholderTextColor={palette.textMuted}
                    style={[styles.input, { backgroundColor: palette.bgSoft, borderColor: palette.border, color: palette.textPrimary }]}
                  />
                </>
              )}
            </Card>

            {/* SECTION 4: BUDGET */}
            <Card style={styles.card}>
              <View style={[styles.switchRow, { borderTopWidth: 0, paddingTop: 0 }]}>
                <View style={styles.flex}>
                  <Text style={[styles.sectionHeader, { color: palette.primaryDark }]}>
                    4. Fund This Quest (Optional)
                  </Text>
                  <Text style={[styles.helperText, { color: palette.textSecondary }]}>
                    Turn off ($0 budget) to publish an XP-only quest with no PayPal charge.
                  </Text>
                </View>
                <Switch
                  value={fundQuest}
                  onValueChange={setFundQuest}
                  trackColor={{ false: palette.border, true: palette.primary }}
                  thumbColor={palette.white}
                />
              </View>
              {fundQuest ? (
                <>
                  <Text style={[styles.label, { color: palette.textPrimary }]}>
                    Escrow Budget to Fund via PayPal ($ USD)
                  </Text>
                  <TextInput
                    value={budgetUsd}
                    onChangeText={setBudgetUsd}
                    keyboardType="decimal-pad"
                    style={[styles.input, { backgroundColor: palette.bgSoft, borderColor: palette.border, color: palette.textPrimary }]}
                  />
                  <Text style={[styles.helperText, { color: palette.textSecondary }]}>
                    Escrow budget: {formatMoney(budgetCents, { showInr })} • Cashback pays automatically until budget runs out.
                  </Text>
                </>
              ) : (
                <Text style={[styles.helperText, { color: palette.primaryDark }]}>
                  XP-only mode: Budget $0 — no PayPal order needed. Travelers earn XP and a passport stamp.
                </Text>
              )}
            </Card>

            {/* SECTION 5: AI VERIFICATION BRIEF */}
            <Card
              style={[
                styles.card,
                { backgroundColor: palette.goldSoft, borderColor: palette.gold },
              ]}
            >
              <View style={styles.sectionHeaderRow}>
                <View style={styles.inlineRow}>
                  <Ionicons name="eye-off" size={16} color={palette.goldText} />
                  <Text style={[styles.sectionHeader, { color: palette.goldText }]}>
                    5. AI Verification Brief
                  </Text>
                </View>
                <Pill label="Only the AI sees this" variant="gold" />
              </View>

              <Pressable
                onPress={handleHelpMeWrite}
                disabled={draftingBrief}
                style={[styles.aiDraftBtn, { backgroundColor: palette.bgCard, borderColor: palette.gold }]}
              >
                {draftingBrief ? (
                  <ActivityIndicator size="small" color={palette.goldText} />
                ) : (
                  <Ionicons name="sparkles" size={16} color={palette.goldText} />
                )}
                <Text style={[styles.aiDraftText, { color: palette.goldText }]}>
                  {draftingBrief ? 'Drafting AI Brief...' : 'Help me write this'}
                </Text>
              </Pressable>

              <Text style={[styles.label, { color: palette.textPrimary }]}>
                What the photo MUST show (one rule per line)
              </Text>
              <TextInput
                value={mustShowText}
                onChangeText={setMustShowText}
                placeholder={'coffee cup on table\nMatteo Coffea branding or sign'}
                placeholderTextColor={palette.textMuted}
                multiline
                style={[styles.input, styles.textArea, { backgroundColor: palette.bgCard, borderColor: palette.border, color: palette.textPrimary }]}
              />

              <Text style={[styles.label, { color: palette.textPrimary }]}>
                What to REJECT (one rule per line)
              </Text>
              <TextInput
                value={rejectIfText}
                onChangeText={setRejectIfText}
                multiline
                style={[styles.input, styles.textArea, { backgroundColor: palette.bgCard, borderColor: palette.border, color: palette.textPrimary }]}
              />

              {questType === 'purchase' ? (
                <>
                  <Text style={[styles.label, { color: palette.textPrimary }]}>
                    Bill Checks (one rule per line)
                  </Text>
                  <TextInput
                    value={billChecksText}
                    onChangeText={setBillChecksText}
                    multiline
                    style={[styles.input, styles.textArea, { backgroundColor: palette.bgCard, borderColor: palette.border, color: palette.textPrimary }]}
                  />
                </>
              ) : null}

              <Text style={[styles.label, { color: palette.textPrimary }]}>
                Reference Photos (optional, up to 3)
              </Text>
              <Pressable
                onPress={() => handlePickPhoto('ref')}
                style={[styles.refBtn, { backgroundColor: palette.bgCard, borderColor: palette.border }]}
              >
                <Ionicons name="images-outline" size={16} color={palette.primaryDark} />
                <Text style={[styles.refBtnText, { color: palette.primaryDark }]}>
                  Add Private Reference Photo ({aiReferenceImages.length}/3)
                </Text>
              </Pressable>
              {aiReferenceImages.length > 0 ? (
                <View style={styles.refGrid}>
                  {aiReferenceImages.map((img, i) => (
                    <View key={`ref-${i}`} style={styles.refItem}>
                      <Image source={{ uri: img }} style={styles.refImg} />
                      <Pressable
                        onPress={() => setAiReferenceImages((prev) => prev.filter((_, idx) => idx !== i))}
                        style={[styles.refRemove, { backgroundColor: palette.danger }]}
                      >
                        <Ionicons name="close" size={12} color={palette.white} />
                      </Pressable>
                    </View>
                  ))}
                </View>
              ) : null}
            </Card>

              <Button
              label={
                isLockedUnverifiedLimit
                  ? 'Locked (Max 1 Quest Until Verified)'
                  : submitting
                  ? 'Saving Quest...'
                  : isEditing
                  ? fundQuest && !existingQuest?.funded
                    ? 'Save & Fund with PayPal'
                    : 'Save Quest Changes'
                  : fundQuest
                  ? 'Create Quest & Fund with PayPal'
                  : 'Publish XP-Only Quest'
              }
              disabled={isLockedUnverifiedLimit || submitting}
              loading={submitting}
              onPress={handlePublish}
              trailingIcon={<Ionicons name={isLockedUnverifiedLimit ? 'lock-closed' : 'arrow-forward'} size={18} color={palette.white} />}
            />
          </ScrollView>
        </KeyboardAvoidingView>
      </ResponsiveContainer>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  flex: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  topTitle: {
    fontFamily: fonts.serif,
    fontSize: 20,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 44,
    gap: 14,
  },
  card: { gap: 10 },
  sectionHeader: {
    fontFamily: fonts.serif,
    fontSize: 18,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  helperText: {
    fontFamily: fonts.sans,
    fontSize: 12.5,
    lineHeight: 17,
  },
  label: {
    fontFamily: fonts.sansSemi,
    fontSize: 13,
  },
  input: {
    borderRadius: radii.md,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: fonts.sans,
    fontSize: 14,
  },
  textArea: {
    minHeight: 74,
    textAlignVertical: 'top',
  },
  inlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconChipBtn: {
    width: 42,
    height: 42,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipRow: {
    gap: 8,
    paddingVertical: 2,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radii.pill,
    borderWidth: 1,
  },
  chipText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12.5,
  },
  row2: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-end',
  },
  row3: {
    flexDirection: 'row',
    gap: 8,
  },
  col: { flex: 1, gap: 6 },
  colNarrow: { width: 92, gap: 6 },
  smallChip: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: radii.pill,
    borderWidth: 1,
  },
  smallChipText: {
    fontFamily: fonts.sansSemi,
    fontSize: 12,
  },
  searchRow: {
    flexDirection: 'row',
    gap: 8,
  },
  searchBtn: {
    width: 44,
    height: 44,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultsList: {
    borderRadius: radii.md,
    borderWidth: 1,
    overflow: 'hidden',
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  resultText: {
    flex: 1,
    fontFamily: fonts.sans,
    fontSize: 13,
  },
  gpsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingVertical: 9,
  },
  gpsBtnText: {
    fontFamily: fonts.sansSemi,
    fontSize: 13,
  },
  sliderHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  radiusValue: {
    fontFamily: fonts.sansBold,
    fontSize: 14,
  },
  sliderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  stepBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sliderTrack: {
    flex: 1,
    height: 12,
    borderRadius: 6,
    overflow: 'visible',
    justifyContent: 'center',
  },
  sliderFill: {
    height: 12,
    borderRadius: 6,
  },
  sliderThumb: {
    position: 'absolute',
    width: 20,
    height: 20,
    borderRadius: 10,
    marginLeft: -10,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  typeRow: {
    flexDirection: 'row',
    gap: 10,
  },
  typeCard: {
    flex: 1,
    borderRadius: radii.md,
    borderWidth: 1.5,
    padding: 12,
    gap: 4,
  },
  typeTitle: {
    fontFamily: fonts.sansSemi,
    fontSize: 13.5,
  },
  typeSub: {
    fontFamily: fonts.sans,
    fontSize: 11.5,
    lineHeight: 15,
  },
  aiDraftBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    borderRadius: radii.pill,
    borderWidth: 1,
  },
  aiDraftText: {
    fontFamily: fonts.sansSemi,
    fontSize: 13.5,
  },
  refBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingVertical: 10,
  },
  refBtnText: {
    fontFamily: fonts.sansSemi,
    fontSize: 13,
  },
  refGrid: {
    flexDirection: 'row',
    gap: 8,
  },
  refItem: {
    width: 72,
    height: 72,
    borderRadius: radii.sm,
    overflow: 'hidden',
  },
  refImg: {
    width: '100%',
    height: '100%',
  },
  refRemove: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
