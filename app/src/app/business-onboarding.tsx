import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useRoamr } from '../context/RoamrContext';
import { MapboxPlaceResult, searchPlacesWithMapbox } from '../services/api';
import { PlacePinPickerMap } from '../components/PlacePinPickerMap';
import { Card } from '../components/Card';
import { LiquidBackdrop } from '../components/LiquidBackdrop';
import { Pill } from '../components/Pill';
import { Button } from '../components/Button';
import { ResponsiveContainer } from '../components/ResponsiveContainer';
import { colors, fonts, radii } from '../theme/tokens';

const BUSINESS_CATEGORIES = [
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

const DISALLOWED_VENUE_RE =
  /\b(monument|park|garden|museum|temple|shrine|fort|palace|statue|memorial|heritage|history|nature|cathedral|church|botanical|viewpoint|landmark)\b/i;

export default function BusinessOnboardingScreen() {
  const {
    userProfile,
    places,
    serverUser,
    paypalEmail: travelerPaypalEmail,
    completeBusinessOnboarding,
    palette,
  } = useRoamr();

  const existingPlace = serverUser?.primary_place || null;

  const [businessName, setBusinessName] = useState(
    userProfile?.businessName || existingPlace?.name || ''
  );
  const [businessPaypalEmail, setBusinessPaypalEmail] = useState(
    userProfile?.businessPaypalEmail || travelerPaypalEmail || ''
  );
  const [category, setCategory] = useState(
    userProfile?.businessCategory || existingPlace?.category || 'Restaurant'
  );
  const [logoUri, setLogoUri] = useState(userProfile?.businessLogo || '');
  const [selectedExistingPlaceId, setSelectedExistingPlaceId] = useState<string | null>(
    existingPlace?.id || null
  );
  const [placeQuery, setPlaceQuery] = useState('');
  const [searchingPlace, setSearchingPlace] = useState(false);
  const [placeResults, setPlaceResults] = useState<MapboxPlaceResult[]>([]);
  const [placeName, setPlaceName] = useState(existingPlace?.name || '');
  const [placeAddress, setPlaceAddress] = useState(existingPlace?.address || '');
  const [placeCity, setPlaceCity] = useState(existingPlace?.city || 'Bengaluru');
  const [coords, setCoords] = useState<{ latitude: number; longitude: number }>(
    existingPlace?.coordinates || { latitude: 12.9716, longitude: 77.5946 }
  );
  const [pinReady, setPinReady] = useState(Boolean(existingPlace));
  const [saving, setSaving] = useState(false);

  const eligiblePlaces = useMemo(
    () =>
      places.filter(
        (p) =>
          !p.owner_id &&
          !DISALLOWED_VENUE_RE.test(`${p.category || ''} ${p.name || ''}`)
      ),
    [places]
  );

  const handlePickLogo = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Allow photo library access to pick a business logo.');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.6,
    });
    if (!res.canceled && res.assets[0]) {
      setLogoUri(res.assets[0].uri);
    }
  };

  const handleSearchPlaces = async () => {
    const q = placeQuery.trim();
    if (!q) return;
    setSearchingPlace(true);
    try {
      const res = await searchPlacesWithMapbox(q);
      setPlaceResults(res);
      if (!res.length) {
        Alert.alert('No venues found', 'Try searching a restaurant, cafe, run club, night club, or street.');
      }
    } finally {
      setSearchingPlace(false);
    }
  };

  const handleContinue = async () => {
    if (!businessName.trim() || !businessPaypalEmail.trim()) {
      Alert.alert(
        'Missing Business Info',
        'Business Name and PayPal Email are required.'
      );
      return;
    }
    if (!category.trim() || DISALLOWED_VENUE_RE.test(category)) {
      Alert.alert(
        'Select Venue Category',
        'Choose a venue category such as Restaurant, Cafe, Run Club, Night Club, or Shop.'
      );
      return;
    }
    if (!selectedExistingPlaceId && (!placeName.trim() || !pinReady)) {
      Alert.alert(
        'Pick Your 1 Business Place',
        'Each business must register 1 commercial venue (select one below or search/pin your venue on the map).'
      );
      return;
    }
    if (DISALLOWED_VENUE_RE.test(placeName)) {
      Alert.alert(
        'Venues Only (No Monuments/Parks)',
        'Business places must be commercial venues like restaurants, cafes, run clubs, or night clubs — not monuments, parks, or museums.'
      );
      return;
    }

    setSaving(true);
    try {
      await completeBusinessOnboarding({
        businessName: businessName.trim(),
        businessPaypalEmail: businessPaypalEmail.trim(),
        businessCategory: category.trim(),
        businessLogo: logoUri.trim() || undefined,
        place: selectedExistingPlaceId
          ? { place_id: selectedExistingPlaceId, category: category.trim() }
          : {
              name: placeName.trim(),
              address: placeAddress.trim() || `${placeName.trim()}, ${placeCity}`,
              lat: coords.latitude,
              lng: coords.longitude,
              category: category.trim(),
              city: placeCity,
            },
      });
      router.replace('/(business)');
    } catch (err) {
      Alert.alert(
        'Could not save business',
        err instanceof Error ? err.message : 'Please check your inputs and try again.'
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.bgCream }]}>
      <LiquidBackdrop variant="business" />
      <ResponsiveContainer maxWidth={640} style={{ flex: 1 }}>
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
          <Pill label="Business Registration (Required)" variant="gold" />
          <View style={{ width: 40 }} />
        </View>

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
          style={{ flex: 1 }}
        >
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            automaticallyAdjustKeyboardInsets
          >
            <Text style={[styles.heading, { color: palette.textPrimary }]}>
              Register Your Business Place
            </Text>
            <Text style={[styles.subheading, { color: palette.textSecondary }]}>
              One place per business (restaurants, cafes, run clubs, night clubs, shops — no monuments). Unverified businesses can keep 1 locked quest until Superadmin verifies your info.
            </Text>

            <Card style={styles.card}>
              <Text style={[styles.label, { color: palette.textPrimary }]}>Business Name *</Text>
              <TextInput
                value={businessName}
                onChangeText={setBusinessName}
                placeholder="e.g. Matteo Coffea or Stride Run Club"
                placeholderTextColor={palette.textMuted}
                style={[
                  styles.input,
                  {
                    backgroundColor: palette.bgSoft,
                    borderColor: palette.border,
                    color: palette.textPrimary,
                  },
                ]}
              />

              <Text style={[styles.label, { color: palette.textPrimary }]}>PayPal Business Email *</Text>
              <TextInput
                value={businessPaypalEmail}
                onChangeText={setBusinessPaypalEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                placeholder="payments@yourbusiness.com"
                placeholderTextColor={palette.textMuted}
                style={[
                  styles.input,
                  {
                    backgroundColor: palette.bgSoft,
                    borderColor: palette.border,
                    color: palette.textPrimary,
                  },
                ]}
              />

              <View style={[styles.divider, { backgroundColor: palette.border }]} />

              <View style={styles.logoRow}>
                {logoUri.trim() ? (
                  <Image
                    source={{ uri: logoUri }}
                    style={[
                      styles.logoPreview,
                      { backgroundColor: palette.bgSage, borderColor: palette.border },
                    ]}
                  />
                ) : (
                  <View
                    style={[
                      styles.logoPreview,
                      styles.logoPlaceholder,
                      { backgroundColor: palette.goldSoft, borderColor: palette.border },
                    ]}
                  >
                    <Ionicons name="storefront-outline" size={24} color={palette.goldText} />
                  </View>
                )}
                <View style={styles.logoActions}>
                  <Text style={[styles.label, { color: palette.textPrimary }]}>Logo (optional)</Text>
                  <Pressable
                    onPress={handlePickLogo}
                    style={[styles.uploadChip, { backgroundColor: palette.primarySoft }]}
                  >
                    <Ionicons name="image-outline" size={15} color={palette.primary} />
                    <Text style={[styles.uploadChipText, { color: palette.primaryDark }]}>
                      Choose from Photos
                    </Text>
                  </Pressable>
                </View>
              </View>

              <Text style={[styles.label, { color: palette.textPrimary }]}>Venue Category * (No monuments/parks)</Text>
              <View style={styles.chipWrap}>
                {BUSINESS_CATEGORIES.map((cat) => {
                  const selected = category === cat;
                  return (
                    <Pressable
                      key={cat}
                      onPress={() => setCategory(cat)}
                      style={[
                        styles.catChip,
                        {
                          backgroundColor: selected ? palette.goldSoft : palette.bgSoft,
                          borderColor: selected ? palette.gold : palette.border,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.catText,
                          { color: selected ? palette.goldText : palette.textSecondary },
                        ]}
                      >
                        {cat}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </Card>

            <Card style={styles.card}>
              <View style={styles.placeHeaderRow}>
                <Text style={[styles.label, { color: palette.textPrimary, fontSize: 15 }]}>
                  Your 1 Business Place *
                </Text>
                <Pill label="1 Place Only" variant="gold" />
              </View>

              {eligiblePlaces.length > 0 ? (
                <>
                  <Text style={[styles.helperSmall, { color: palette.textSecondary }]}>
                    Claim an existing listed venue, or search/pin your own venue below:
                  </Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                    {eligiblePlaces.map((p) => {
                      const active = selectedExistingPlaceId === p.id;
                      return (
                        <Pressable
                          key={p.id}
                          onPress={() => {
                            setSelectedExistingPlaceId(active ? null : p.id);
                            if (!active) {
                              setPlaceName(p.name);
                              setPlaceAddress(p.address);
                              setCoords(p.coordinates);
                              setPinReady(true);
                              if (!businessName.trim()) setBusinessName(p.name);
                              if (p.category && BUSINESS_CATEGORIES.includes(p.category)) {
                                setCategory(p.category);
                              }
                            }
                          }}
                          style={[
                            styles.catChip,
                            {
                              backgroundColor: active ? palette.primary : palette.bgSoft,
                              borderColor: active ? palette.primary : palette.border,
                            },
                          ]}
                        >
                          <Text
                            style={[
                              styles.catText,
                              { color: active ? palette.white : palette.textPrimary },
                            ]}
                          >
                            {p.name}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </>
              ) : null}

              <Text style={[styles.helperSmall, { color: palette.textSecondary }]}>
                Or search your venue name / address on the map:
              </Text>
              <View style={styles.searchRow}>
                <TextInput
                  value={placeQuery}
                  onChangeText={setPlaceQuery}
                  onSubmitEditing={handleSearchPlaces}
                  placeholder="Search cafe, restaurant, club..."
                  placeholderTextColor={palette.textMuted}
                  style={[
                    styles.input,
                    {
                      flex: 1,
                      backgroundColor: palette.bgSoft,
                      borderColor: palette.border,
                      color: palette.textPrimary,
                    },
                  ]}
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
                  {placeResults.map((r) => (
                    <Pressable
                      key={r.id}
                      onPress={() => {
                        setSelectedExistingPlaceId(null);
                        setPlaceName(r.name);
                        setPlaceAddress(r.fullAddress);
                        setPlaceCity(r.city || 'Bengaluru');
                        setCoords({ latitude: r.latitude, longitude: r.longitude });
                        setPinReady(true);
                        setPlaceResults([]);
                        if (!businessName.trim()) setBusinessName(r.name);
                      }}
                      style={[styles.resultRow, { borderBottomColor: palette.border }]}
                    >
                      <Ionicons name="location-outline" size={15} color={palette.primary} />
                      <Text style={{ fontFamily: fonts.sans, fontSize: 13, color: palette.textPrimary, flex: 1 }}>
                        {r.fullAddress}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}

              <PlacePinPickerMap
                latitude={coords.latitude}
                longitude={coords.longitude}
                radiusMeters={150}
                onChangeCoords={(next) => {
                  setSelectedExistingPlaceId(null);
                  setCoords(next);
                  setPinReady(true);
                }}
              />

              <Text style={[styles.label, { color: palette.textPrimary }]}>Venue Name *</Text>
              <TextInput
                value={placeName}
                onChangeText={(txt) => {
                  setSelectedExistingPlaceId(null);
                  setPlaceName(txt);
                }}
                placeholder="e.g. Corner House Residency Road"
                placeholderTextColor={palette.textMuted}
                style={[
                  styles.input,
                  {
                    backgroundColor: palette.bgSoft,
                    borderColor: palette.border,
                    color: palette.textPrimary,
                  },
                ]}
              />

              <Text style={[styles.label, { color: palette.textPrimary }]}>Venue Address</Text>
              <TextInput
                value={placeAddress}
                onChangeText={setPlaceAddress}
                placeholder="Street, area, city"
                placeholderTextColor={palette.textMuted}
                style={[
                  styles.input,
                  {
                    backgroundColor: palette.bgSoft,
                    borderColor: palette.border,
                    color: palette.textPrimary,
                  },
                ]}
              />
            </Card>

            <Button
              label={saving ? 'Submitting for Superadmin Review...' : 'Submit Business for Verification'}
              loading={saving}
              onPress={handleContinue}
              trailingIcon={<Ionicons name="arrow-forward" size={18} color={palette.white} />}
            />
          </ScrollView>
        </KeyboardAvoidingView>
      </ResponsiveContainer>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.bgCream,
  },
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
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 120,
    gap: 14,
  },
  heading: {
    fontFamily: fonts.serif,
    fontSize: 27,
    lineHeight: 33,
  },
  subheading: {
    fontFamily: fonts.sans,
    fontSize: 13.5,
    lineHeight: 19,
  },
  card: {
    gap: 10,
  },
  label: {
    fontFamily: fonts.sansSemi,
    fontSize: 13,
    marginTop: 2,
  },
  helperSmall: {
    fontFamily: fonts.sans,
    fontSize: 12.5,
    lineHeight: 17,
  },
  input: {
    borderRadius: radii.md,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontFamily: fonts.sans,
    fontSize: 14.5,
  },
  divider: {
    height: 1,
    marginVertical: 6,
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  logoPreview: {
    width: 60,
    height: 60,
    borderRadius: radii.md,
    borderWidth: 1,
  },
  logoPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoActions: {
    flex: 1,
    gap: 6,
  },
  uploadChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radii.pill,
  },
  uploadChipText: {
    fontFamily: fonts.sansSemi,
    fontSize: 12.5,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  catChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radii.pill,
    borderWidth: 1,
  },
  catText: {
    fontFamily: fonts.sansMedium,
    fontSize: 12.5,
  },
  placeHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
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
    borderWidth: 1,
    borderRadius: radii.md,
    overflow: 'hidden',
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
