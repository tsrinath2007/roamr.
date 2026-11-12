import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
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
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useRoamr } from '../context/RoamrContext';
import { InterestKey } from '../types/roamr';
import { Card } from '../components/Card';
import { LiquidBackdrop } from '../components/LiquidBackdrop';
import { PayPalLogo } from '../components/PayPalLogo';
import { Button } from '../components/Button';
import { Wordmark } from '../components/Wordmark';
import { RoamrMark } from '../components/RoamrMark';
import { ResponsiveContainer } from '../components/ResponsiveContainer';
import { colors, fonts, radii } from '../theme/tokens';

const INTEREST_OPTIONS: {
  key: InterestKey;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  { key: 'food', label: 'Food & Cafés', icon: 'cafe-outline' },
  { key: 'history', label: 'History', icon: 'business-outline' },
  { key: 'nature', label: 'Nature', icon: 'leaf-outline' },
  { key: 'photography', label: 'Photography', icon: 'camera-outline' },
  { key: 'nightlife', label: 'Nightlife', icon: 'musical-notes-outline' },
];

const GENDER_OPTIONS = ['Prefer not to say', 'Woman', 'Man', 'Non-binary'];

const TRAVEL_PURPOSE_OPTIONS = [
  'Discover Hidden Gems',
  'Earn USD Rewards',
  'Food & Cafe Hunting',
  'Photo Walks',
  'Support Local Shops',
];

export default function OnboardingScreen() {
  const {
    interests,
    city,
    paypalEmail,
    phone,
    gender,
    travelStyle,
    enable3D,
    saveOnboarding,
    palette,
    isDark,
  } = useRoamr();

  const [selected, setSelected] = useState<InterestKey[]>(interests);
  const [cityDraft, setCityDraft] = useState(city || 'San Francisco');
  const [paypalDraft, setPaypalDraft] = useState(paypalEmail || '');
  const [phoneDraft, setPhoneDraft] = useState(phone || '');
  const [genderDraft, setGenderDraft] = useState(gender || 'Prefer not to say');
  const [purposeDraft, setPurposeDraft] = useState(travelStyle || 'Discover Hidden Gems');
  const [use3D, setUse3D] = useState(enable3D);
  const [loading, setLoading] = useState(false);

  const toggleInterest = (key: InterestKey) => {
    setSelected((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  const handleGenerate = async () => {
    setLoading(true);
    try {
      const picks: InterestKey[] = selected.length ? selected : ['food', 'photography'];
      await saveOnboarding(picks, cityDraft.trim() || 'San Francisco', {
        paypalEmail: paypalDraft.trim(),
        phone: phoneDraft.trim(),
        gender: genderDraft,
        travelStyle: purposeDraft,
        enable3D: use3D,
      });
      router.replace('/(tabs)');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: palette.bgCream }]}>
      <LiquidBackdrop variant="traveler" />
      <ResponsiveContainer maxWidth={600} style={{ flex: 1 }}>
        <View style={styles.topBar}>
          <Pressable
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))}
            style={[
              styles.backBtn,
              { backgroundColor: palette.bgCard, borderColor: palette.border },
            ]}
          >
            <Ionicons name="chevron-back" size={22} color={palette.textPrimary} />
          </Pressable>
          <Wordmark
            size={25}
            theme={isDark ? 'dark' : 'light'}
            showTagline={false}
            rightAccessory={<RoamrMark size={24} theme={isDark ? 'dark' : 'light'} />}
          />
          <Pressable onPress={() => router.replace('/(tabs)')} hitSlop={8}>
            <Text style={[styles.skipText, { color: palette.textSecondary }]}>Skip</Text>
          </Pressable>
        </View>

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
          style={{ flex: 1 }}
        >
        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingBottom: 120 }]}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
        >
          <View style={[styles.heroBadge, { backgroundColor: palette.primarySoft }]}>
            <Ionicons name="sparkles" size={20} color={palette.primary} />
          </View>
          <Text style={[styles.heading, { color: palette.textPrimary }]}>
            Set Up Your Explorer Profile
          </Text>
          <Text style={[styles.subheading, { color: palette.textSecondary }]}>
            Personalize AI quests, connect your PayPal receiver for instant USD rewards, and tune your 3D map experience.
          </Text>

          {/* Location & Contact Details */}
          <Card style={styles.card}>
            <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>
              Location & Contact
            </Text>

            <Text style={[styles.label, { color: palette.textPrimary }]}>
              Where are you exploring?
            </Text>
            <View
              style={[
                styles.inputWrap,
                { backgroundColor: palette.bgSoft, borderColor: palette.border },
              ]}
            >
              <Ionicons name="location-outline" size={18} color={palette.primary} />
              <TextInput
                value={cityDraft}
                onChangeText={setCityDraft}
                placeholder="San Francisco"
                placeholderTextColor={palette.textMuted}
                style={[styles.inputText, { color: palette.textPrimary }]}
              />
            </View>

            <Text style={[styles.label, { color: palette.textPrimary, marginTop: 14 }]}>
              Phone Number (for quest & payout alerts)
            </Text>
            <View
              style={[
                styles.inputWrap,
                { backgroundColor: palette.bgSoft, borderColor: palette.border },
              ]}
            >
              <Ionicons name="call-outline" size={18} color={palette.primary} />
              <TextInput
                value={phoneDraft}
                onChangeText={setPhoneDraft}
                keyboardType="phone-pad"
                placeholder="+1 555 234 5678"
                placeholderTextColor={palette.textMuted}
                style={[styles.inputText, { color: palette.textPrimary }]}
              />
            </View>

            <Text style={[styles.label, { color: palette.textPrimary, marginTop: 14 }]}>
              Gender
            </Text>
            <View style={styles.grid}>
              {GENDER_OPTIONS.map((g) => {
                const active = genderDraft === g;
                return (
                  <Pressable
                    key={g}
                    onPress={() => setGenderDraft(g)}
                    style={[
                      styles.chipSmall,
                      {
                        backgroundColor: active ? palette.primary : palette.bgSage,
                        borderColor: active ? palette.primary : palette.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.chipSmallText,
                        { color: active ? palette.white : palette.primaryDark },
                      ]}
                    >
                      {g}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </Card>

          {/* PayPal Receiver */}
          <Card style={styles.card}>
            <View style={styles.cardHeaderRow}>
              <PayPalLogo size={18} variant="badge" />
              <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>
                PayPal Receiver Email
              </Text>
            </View>
            <Text style={[styles.helperText, { color: palette.textSecondary }]}>
              Where verified quest rewards are sent. Payouts are made in USD (PayPal Sandbox).
            </Text>
            <View
              style={[
                styles.inputWrap,
                { backgroundColor: palette.bgSoft, borderColor: palette.border },
              ]}
            >
              <Ionicons name="mail-outline" size={18} color={palette.paypalBlue} />
              <TextInput
                value={paypalDraft}
                onChangeText={setPaypalDraft}
                autoCapitalize="none"
                keyboardType="email-address"
                placeholder="sb-traveler@personal.example.com"
                placeholderTextColor={palette.textMuted}
                style={[styles.inputText, { color: palette.textPrimary }]}
              />
            </View>
          </Card>

          {/* Platform Goal & Interests */}
          <Card style={styles.card}>
            <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>
              How will you use ROAMR?
            </Text>
            <View style={[styles.grid, { marginTop: 8 }]}>
              {TRAVEL_PURPOSE_OPTIONS.map((p) => {
                const active = purposeDraft === p;
                return (
                  <Pressable
                    key={p}
                    onPress={() => setPurposeDraft(p)}
                    style={[
                      styles.chipSmall,
                      {
                        backgroundColor: active ? palette.primary : palette.bgSage,
                        borderColor: active ? palette.primary : palette.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.chipSmallText,
                        { color: active ? palette.white : palette.primaryDark },
                      ]}
                    >
                      {p}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={[styles.label, { color: palette.textPrimary, marginTop: 18 }]}>
              Select your quest interests
            </Text>
            <View style={styles.grid}>
              {INTEREST_OPTIONS.map((opt) => {
                const active = selected.includes(opt.key);
                return (
                  <Pressable
                    key={opt.key}
                    onPress={() => toggleInterest(opt.key)}
                    style={[
                      styles.interestChip,
                      {
                        backgroundColor: active ? palette.primary : palette.bgSage,
                        borderColor: active ? palette.primary : palette.border,
                      },
                    ]}
                  >
                    <Ionicons
                      name={opt.icon}
                      size={18}
                      color={active ? palette.white : palette.primary}
                    />
                    <Text
                      style={[
                        styles.interestText,
                        { color: active ? palette.white : palette.primaryDark },
                      ]}
                    >
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </Card>

          {/* 3D Map Preference */}
          <Card style={styles.card}>
            <View style={styles.switchRow}>
              <View style={styles.switchTextCol}>
                <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>
                  3D Map & Buildings
                </Text>
                <Text style={[styles.helperText, { color: palette.textSecondary, marginBottom: 0 }]}>
                  Turn tilted 3D globe/city buildings on or off (can also change anytime in Settings).
                </Text>
              </View>
              <Switch
                value={use3D}
                onValueChange={setUse3D}
                trackColor={{ false: palette.border, true: palette.primary }}
                thumbColor={palette.white}
              />
            </View>
          </Card>

          <Button
            label={loading ? 'Saving & Generating Quests...' : 'Save Profile & Generate Quests'}
            loading={loading}
            onPress={handleGenerate}
            icon={<Ionicons name="sparkles" size={18} color={palette.white} />}
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
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandMini: {
    fontFamily: fonts.serif,
    fontSize: 20,
    color: colors.primaryDark,
  },
  skipText: {
    fontFamily: fonts.sansSemi,
    fontSize: 13.5,
    paddingHorizontal: 6,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 42,
    gap: 14,
  },
  heroBadge: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
  },
  heading: {
    fontFamily: fonts.serif,
    fontSize: 28,
    lineHeight: 34,
    color: colors.textPrimary,
  },
  subheading: {
    fontFamily: fonts.sans,
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
  },
  card: {
    marginVertical: 2,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  sectionTitle: {
    fontFamily: fonts.serif,
    fontSize: 18,
  },
  helperText: {
    fontFamily: fonts.sans,
    fontSize: 12.5,
    lineHeight: 18,
    marginBottom: 10,
  },
  label: {
    fontFamily: fonts.sansSemi,
    fontSize: 13.5,
    color: colors.textPrimary,
    marginBottom: 8,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.bgCream,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    height: 46,
  },
  inputText: {
    flex: 1,
    fontFamily: fonts.sansMedium,
    fontSize: 14.5,
    color: colors.textPrimary,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chipSmall: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radii.pill,
    borderWidth: 1,
  },
  chipSmallText: {
    fontFamily: fonts.sansSemi,
    fontSize: 12.5,
  },
  interestChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radii.pill,
    backgroundColor: colors.bgSage,
    borderWidth: 1,
    borderColor: colors.border,
  },
  interestText: {
    fontFamily: fonts.sansSemi,
    fontSize: 13.5,
    color: colors.primaryDark,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  switchTextCol: {
    flex: 1,
    gap: 3,
  },
});
